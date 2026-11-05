/**
 * treasury.ts — der Treasury-Loop: Quote → Gate → (Execute) → Lifecycle.
 *
 * SICHERHEITS-GATE (Mission Punkt 5, hart im Code, nicht konfigurierbar abschaltbar):
 *   AGENT_EXECUTE !== "true"  ⇒ ausschließlich dry:true-Quotes. Default false.
 *   DEMO_MAX_USD              ⇒ harter USD-Cap (zusätzlich hart bei 3 $, RULES.md Demo-Disziplin).
 *   Assets                    ⇒ nur NEAR (nep141:wrap.near) und USDC (nep141:17208…).
 *
 * Quote-Lifecycle (Mission Punkt 4):
 *   - Idempotency-Key pro logischer Operation, stabil persistiert (.state/operations.json).
 *   - Statusmaschine PENDING/UNCERTAIN/NEEDS_REVIEW/COMPLETED (+FAILED) in lifecycle.ts.
 *   - Bounded Retries: gleicher Key bei retryable-Fehlern; UNCERTAIN wird NIE neu gesendet.
 *   - Quota-Respekt: assertQuotaHeadroom() vor Dispatch; 429/5xx als retryable behandelt.
 */
import { ALLOWED_ASSETS, redact, type TreasuryConfig } from "./env.js";
import { ApiError, IntentsClient, type QuoteResponse, type StatusResponse } from "./client.js";
import {
  assertQuotaHeadroom,
  operationFor,
  retryable,
  toLifecycleStatus,
  trackOperation,
  updateOperation,
  type LifecycleState,
} from "./lifecycle.js";

export type QuoteOutcome = {
  quoteId: string;
  lifecycle: LifecycleState | "DRY";
  apiStatus?: string;
  dry: true;
  quote?: unknown;
  fee?: unknown;
  spendUsd?: unknown;
  warnings?: unknown;
  ownerApproval?: boolean;
  note?: string;
};

export type ExecuteOutcome = {
  quoteId: string;
  correlationId: string;
  lifecycle: LifecycleState;
  apiStatus?: string;
  dry: false;
  polls?: number;
  capped?: boolean;
  failureCode?: string | null;
  details?: unknown;
  note?: string;
};

function client(cfg: TreasuryConfig): IntentsClient {
  return new IntentsClient(cfg);
}

/** Asset-Whitelist-Gate: alles außer NEAR/USDC ist tabu (Mission: nur Assets NEAR/USDC). */
export function assertAllowedAsset(assetId: string): void {
  if (assetId !== ALLOWED_ASSETS.NEAR && assetId !== ALLOWED_ASSETS.USDC) {
    throw new Error(`Asset nicht in der Demo-Whitelist (nur NEAR/USDC): ${redact(assetId)}`);
  }
}

/** USD-Cap-Gate: Quote-Ausgabe darf DEMO_MAX_USD nie überschreiten. */
export function assertDemoCapUsd(amountUsd: unknown, cap: number): void {
  if (amountUsd === null || amountUsd === undefined) return; // API nennt keinen Wert → Live-Check greift trotzdem
  const value = Number(amountUsd);
  if (!Number.isFinite(value)) return;
  if (value > cap) {
    throw new Error(`Demo-Cap verletzt: Quote ${value} USD > DEMO_MAX_USD=${cap}. Abbruch, keine Ausführung.`);
  }
}

/**
 * dry:true-Micro-Quote NEAR→USDC. Immer dry — dieses Modul führt NIE aus; dafür ist
 * executeDemo() mit AGENT_EXECUTE-Gate zuständig.
 */
export async function quoteDemo(
  agentId: string,
  cfg: TreasuryConfig,
  amountRaw?: string,
): Promise<QuoteOutcome> {
  assertAllowedAsset(ALLOWED_ASSETS.NEAR);
  assertAllowedAsset(ALLOWED_ASSETS.USDC);
  await assertQuotaHeadroom(client(cfg), false);

  const op = operationFor(`quote-demo-${agentId}-${Date.now()}`, "quote-demo");
  const api = client(cfg);
  const body: Record<string, unknown> = {
    origin_asset: ALLOWED_ASSETS.NEAR,
    destination_asset: ALLOWED_ASSETS.USDC,
    amount: amountRaw ?? microNearAmount(cfg.demoAmountUsd),
    dry: true, // HART: dry-Quote ist immer dry
  };
  // dry:true braucht bewusst KEINEN Idempotency-Key und KEINEN Grant (API-Vertrag).
  const quote = (await retryable(() => api.swap(agentId, body), {
    attempts: 3,
    onRetry: (n, err) => console.error(`retry ${n}/3 (gleicher Request): ${(err as Error).name}`),
  })) as QuoteResponse;

  assertDemoCapUsd(quote.spend?.amount_usd, cfg.demoMaxUsd);

  const outcome: QuoteOutcome = {
    quoteId: quote.correlation_id ?? op.idempotencyKey,
    lifecycle: "DRY",
    dry: true,
    quote: quote.quote,
    fee: quote.fee,
    spendUsd: quote.spend?.amount_usd,
    warnings: quote.warnings,
    ownerApproval: quote.owner_approval,
    note: "dry:true — Quote nur. Ausführung erst mit AGENT_EXECUTE=true und execute-demo.",
  };
  updateOperation(op.key, {
    state: "DRY" as never,
    correlationId: quote.correlation_id,
    details: { warnings: quote.warnings ?? [], spend_usd: quote.spend?.amount_usd ?? null },
  });
  return outcome;
}

/**
 * Live-Ausführung — VOM GATE GESPERRT bis AGENT_EXECUTE === "true".
 * Reihenfolge: Gate → Quote-Check (Cap) → Live-Swap mit min_amount_out → Lifecycle-Tracking.
 */
export async function executeDemo(
  agentId: string,
  cfg: TreasuryConfig,
  amountRaw?: string,
): Promise<ExecuteOutcome> {
  if (!cfg.executeGate) {
    throw new Error(
      'AGENT_EXECUTE != "true" — Ausführung gesperrt (Default false). ' +
        "Doppelt absichern: AGENT_EXECUTE=true npm run execute-demo  (nur nach dry:true-Beweis, RULES.md §Sicherheit).",
    );
  }
  assertAllowedAsset(ALLOWED_ASSETS.NEAR);
  assertAllowedAsset(ALLOWED_ASSETS.USDC);
  await assertQuotaHeadroom(client(cfg), false);

  const api = client(cfg);
  const amount = amountRaw ?? microNearAmount(cfg.demoAmountUsd);

  // 1) Pflicht-Vorbereitung: dieselbe Quote dry, Cap-Check daran.
  const dry = (await api.swap(agentId, {
    origin_asset: ALLOWED_ASSETS.NEAR,
    destination_asset: ALLOWED_ASSETS.USDC,
    amount,
    dry: true,
  })) as QuoteResponse;
  assertDemoCapUsd(dry.spend?.amount_usd, cfg.demoMaxUsd);
  const expectedOut = (dry.quote as { amount_out?: string } | null | undefined)?.amount_out;

  // 2) Live-Swap mit stabilem Idempotency-Key + min_amount_out (1 % Slippage-Puffer).
  const op = operationFor(`execute-${agentId}-${new Date().toISOString().slice(0, 10)}`, "execute-swap");
  const body: Record<string, unknown> = {
    origin_asset: ALLOWED_ASSETS.NEAR,
    destination_asset: ALLOWED_ASSETS.USDC,
    amount,
  };
  if (expectedOut) body.min_amount_out = slippageFloor(expectedOut, 1);

  const grantToken = cfg.grantToken;
  if (!grantToken) {
    throw new Error(
      "INTENTS_GRANT_TOKEN fehlt — Live-Swap braucht einen gültigen Grant (X-Grant-Token). " +
        "Vorbereiten: npm run grant:prepare, dann Mensch signiert grant_issue.",
    );
  }

  const result = await retryable(
    () => api.swap(agentId, body, { idempotencyKey: op.idempotencyKey, grantToken }),
    { attempts: 3, onRetry: (n) => console.error(`retry ${n}/3 mit IDENTISCHEM Idempotency-Key`) },
  ) as StatusResponse;

  updateOperation(op.key, { correlationId: result.correlation_id, state: toLifecycleStatus(result.status) });

  // 3) Bounded Tracking — UNCERTAIN/NEEDS_REVIEW stoppen sofort, nie blind neu senden.
  const tracked = await trackOperation(api, result.correlation_id, op.key, { maxPolls: 12 });
  return {
    quoteId: tracked.correlationId,
    correlationId: tracked.correlationId,
    lifecycle: tracked.state,
    apiStatus: tracked.apiStatus,
    dry: false,
    failureCode: tracked.failureCode,
    polls: tracked.polls,
    capped: tracked.capped,
    details: tracked.status.details,
    note:
      tracked.state === "UNCERTAIN"
        ? "UNCERTAIN: Outcome unbekannt. NICHT neu senden. Später: npm run policy-status -- --cid " + tracked.correlationId
        : tracked.state === "NEEDS_REVIEW"
          ? "NEEDS_REVIEW: automatische Abwicklung gestoppt — details.reason prüfen, nicht retryn."
          : undefined,
  };
}

/** Micro-Betrag: demoAmountUsd in NEAR-Atomics (24 Decimals) zum groben NEAR/USD-Preis. */
export function microNearAmount(usd: number, nearUsdPrice = 2.0): string {
  const near = usd / nearUsdPrice;
  const atomic = BigInt(Math.round(near * 1e24));
  return atomic.toString();
}

/** min_amount_out mit p % Slippage-Puffer, atomar gerundet. */
export function slippageFloor(amountOut: string, percent = 1): string {
  try {
    const v = BigInt(amountOut);
    return ((v * BigInt(100 - percent)) / 100n).toString();
  } catch {
    return amountOut;
  }
}

export { ApiError, toLifecycleStatus };
