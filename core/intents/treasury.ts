/**
 * treasury.ts — the treasury loop: quote → gate → (execute) → lifecycle.
 *
 * SECURITY GATE (mission point 5, hard in code, cannot be configured off):
 *   AGENT_EXECUTE !== "true"  ⇒ dry:true quotes only. Default false.
 *   DEMO_MAX_USD              ⇒ hard USD cap (additionally hard at $3, RULES.md demo discipline).
 *   Assets                    ⇒ only NEAR (nep141:wrap.near) and USDC (nep141:17208…).
 *
 * Quote lifecycle (mission point 4):
 *   - Idempotency key per logical operation, stably persisted (.state/operations.json).
 *   - State machine PENDING/UNCERTAIN/NEEDS_REVIEW/COMPLETED (+FAILED) in lifecycle.ts.
 *   - Bounded retries: same key on retryable errors; UNCERTAIN is NEVER resent.
 *   - Quota respect: assertQuotaHeadroom() before dispatch; 429/5xx treated as retryable.
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

/** Asset whitelist gate: anything but NEAR/USDC is taboo (mission: assets NEAR/USDC only). */
export function assertAllowedAsset(assetId: string): void {
  if (assetId !== ALLOWED_ASSETS.NEAR && assetId !== ALLOWED_ASSETS.USDC) {
    throw new Error(`Asset not in the demo whitelist (NEAR/USDC only): ${redact(assetId)}`);
  }
}

/** USD cap gate: quote output must never exceed DEMO_MAX_USD. */
export function assertDemoCapUsd(amountUsd: unknown, cap: number): void {
  if (amountUsd === null || amountUsd === undefined) return; // API names no value → live check still applies
  const value = Number(amountUsd);
  if (!Number.isFinite(value)) return;
  if (value > cap) {
    throw new Error(`Demo cap violated: quote ${value} USD > DEMO_MAX_USD=${cap}. Aborting, no execution.`);
  }
}

/**
 * dry:true micro quote NEAR→USDC. Always dry — this module NEVER executes;
 * executeDemo() with the AGENT_EXECUTE gate is responsible for that.
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
    dry: true, // HARD: a dry quote is always dry
  };
  // dry:true deliberately needs NO idempotency key and NO grant (API contract).
  const quote = (await retryable(() => api.swap(agentId, body), {
    attempts: 3,
    onRetry: (n, err) => console.error(`retry ${n}/3 (same request): ${(err as Error).name}`),
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
    note: "dry:true — quote only. Execution only with AGENT_EXECUTE=true and execute-demo.",
  };
  updateOperation(op.key, {
    state: "DRY" as never,
    correlationId: quote.correlation_id,
    details: { warnings: quote.warnings ?? [], spend_usd: quote.spend?.amount_usd ?? null },
  });
  return outcome;
}

/**
 * Live execution — LOCKED BY THE GATE until AGENT_EXECUTE === "true".
 * Order: gate → quote check (cap) → live swap with min_amount_out → lifecycle tracking.
 */
export async function executeDemo(
  agentId: string,
  cfg: TreasuryConfig,
  amountRaw?: string,
): Promise<ExecuteOutcome> {
  if (!cfg.executeGate) {
    throw new Error(
      'AGENT_EXECUTE != "true" — execution locked (default false). ' +
        "Double safety: AGENT_EXECUTE=true npm run execute-demo  (only after the dry:true proof, RULES.md §Security).",
    );
  }
  assertAllowedAsset(ALLOWED_ASSETS.NEAR);
  assertAllowedAsset(ALLOWED_ASSETS.USDC);
  await assertQuotaHeadroom(client(cfg), false);

  const api = client(cfg);
  const amount = amountRaw ?? microNearAmount(cfg.demoAmountUsd);

  // 1) Mandatory preparation: the same quote dry, cap check on it.
  const dry = (await api.swap(agentId, {
    origin_asset: ALLOWED_ASSETS.NEAR,
    destination_asset: ALLOWED_ASSETS.USDC,
    amount,
    dry: true,
  })) as QuoteResponse;
  assertDemoCapUsd(dry.spend?.amount_usd, cfg.demoMaxUsd);
  const expectedOut = (dry.quote as { amount_out?: string } | null | undefined)?.amount_out;

  // 2) Live swap with a stable idempotency key + min_amount_out (1 % slippage buffer).
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
      "INTENTS_GRANT_TOKEN missing — a live swap needs a valid grant (X-Grant-Token). " +
        "Prepare: npm run grant:prepare, then the human signs grant_issue.",
    );
  }

  const result = await retryable(
    () => api.swap(agentId, body, { idempotencyKey: op.idempotencyKey, grantToken }),
    { attempts: 3, onRetry: (n) => console.error(`retry ${n}/3 with the IDENTICAL idempotency key`) },
  ) as StatusResponse;

  updateOperation(op.key, { correlationId: result.correlation_id, state: toLifecycleStatus(result.status) });

  // 3) Bounded tracking — UNCERTAIN/NEEDS_REVIEW stop immediately, never resend blindly.
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
        ? "UNCERTAIN: outcome unknown. DO NOT resend. Later: npm run policy-status -- --cid " + tracked.correlationId
        : tracked.state === "NEEDS_REVIEW"
          ? "NEEDS_REVIEW: automatic settlement stopped — check details.reason, do not retry."
          : undefined,
  };
}

/** Micro amount: demoAmountUsd in NEAR atomics (24 decimals) at a rough NEAR/USD price. */
export function microNearAmount(usd: number, nearUsdPrice = 2.0): string {
  const near = usd / nearUsdPrice;
  const atomic = BigInt(Math.round(near * 1e24));
  return atomic.toString();
}

/** min_amount_out with p % slippage buffer, rounded in atomics. */
export function slippageFloor(amountOut: string, percent = 1): string {
  try {
    const v = BigInt(amountOut);
    return ((v * BigInt(100 - percent)) / 100n).toString();
  } catch {
    return amountOut;
  }
}

export { ApiError, toLifecycleStatus };
