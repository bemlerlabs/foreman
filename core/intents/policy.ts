/**
 * Owner-Policy-Builder für das Foreman-Treasury (RULES.md §Rollen/§Sicherheit):
 *
 * - Budget-Deckel: daily/weekly USD aus DEMO_MAX_USD (hart ≤ 3 $ Gegenwert).
 * - Destinations-Whitelist: `mode: "only"` — Einträge sind NUR Contract-/Payout-Adressen
 *   (TREASURY_DESTINATIONS in .env). Neue Konten starten sicher: `only` + leere Liste ⇒
 *   Geld bleibt im Agenten.
 * - Timelock: timelock_ms (Default 60 s) — jede Geld-Aktion wartet sichtbar.
 * - Assets: Verkauf/Transfer nur NEAR (nep141:wrap.near) und USDC (nep141:17208…) —
 *   rote Liste: BTC etc. sind tabu.
 * - actions: nur `swap` (Settlement der Demo); transfer/withdraw erst wenn der
 *   Escrow-Contract-Settlement-Pfad (task-1) verdrahtet und freigegeben ist.
 * - native: komplett aus (kein Block ⇒ alle Agent-eigenen Keys aus).
 * - confidential: false (intents.far ist permissioned, nicht beweisbar — rote Liste #2).
 * - owner_approval: optional via INTENTS_OWNER_APPROVAL=true (dann PENDING_APPROVAL für den Menschen).
 */
import { ALLOWED_ASSETS, HARD_MAX_DEMO_USD, type TreasuryConfig } from "./env.js";

export type TreasuryPolicy = {
  frozen: false;
  actions: string[];
  confidential: false;
  owner_approval: boolean;
  assets: string[];
  limits: Record<string, unknown>;
  max_actions_per_hour: number;
  destinations: { mode: "only"; list: DestinationEntry[] };
  budget: { daily_usd: string; weekly_usd: string; monthly_usd: null };
  timelock_ms: number;
};

export type DestinationEntry =
  | { action: "withdraw"; chain: string; address: string; memo: string | null }
  | { action: "transfer"; address: string; confidential: false };

/**
 * TREASURY_DESTINATIONS-Formate (Komma-liste):
 *   "near:<account>"                    → withdraw auf NEAR-Konto (Payout-/Contract-Account)
 *   "<chain>:<address>"                 → withdraw auf anderer Chain
 *   "intents:<account>"                 → transfer an NEAR-Intents-Account
 *   "<account>"                         → withdraw auf NEAR (chain=near implizit)
 * Alles andere wird abgewiesen — Whitelist heißt: exakte Einträge, kein Ratetn.
 */
export function parseDestination(raw: string): DestinationEntry {
  const value = raw.trim();
  if (!value) throw new Error("Leere Destination nicht erlaubt");
  const parts = value.split(":");
  if (parts[0] === "intents") {
    const address = parts.slice(1).join(":");
    assertNearLike(address, value);
    return { action: "transfer", address, confidential: false };
  }
  if (parts.length >= 2 && parts[0].length <= 12 && /^[a-z0-9]+$/.test(parts[0])) {
    const chain = parts[0];
    const address = parts.slice(1).join(":");
    if (!address) throw new Error(`Destination ohne Adresse: ${redactedName(value)}`);
    if (chain === "near") assertNearLike(address, value);
    return { action: "withdraw", chain, address, memo: null };
  }
  assertNearLike(value, value);
  return { action: "withdraw", chain: "near", address: value, memo: null };
}

function assertNearLike(address: string, source: string): void {
  // NEAR-Account-Id oder implicit (64 hex); validiert der Server nochmal (invalid_address).
  const ok =
    /^[0-9a-f]{64}$/.test(address) ||
    /^[0-9a-z_-]{2,62}(\.[0-9a-z_-]{2,62})*$/.test(address);
  if (!ok) throw new Error(`Unzulässiger Destinations-Eintrag: ${redactedName(source)}`);
}

function redactedName(value: string): string {
  // Destinations sind keine Secrets, aber wir ziehen Account-Namen nicht durch Fehlerstacks.
  return value.length > 70 ? `${value.slice(0, 24)}…` : value;
}

/**
 * Policy für Foreman-Treasury bauen. `contractPayoutAddresses` = WHITELIST, typischerweise
 * nur der Escrow-Contract und die Payout-Adressen des Contracts (RULES.md: „Destinations-
 * Whitelist = nur Contract-/Payout-Adressen des Contracts").
 */
export function buildTreasuryPolicy(
  cfg: TreasuryConfig,
  contractPayoutAddresses: string[] = cfg.destinations,
): TreasuryPolicy {
  if (!contractPayoutAddresses.every((d) => typeof d === "string")) {
    throw new Error("Destinations müssen Strings sein");
  }
  const cap = Math.min(cfg.demoMaxUsd, HARD_MAX_DEMO_USD).toFixed(2);
  return {
    frozen: false,
    actions: ["swap"],
    confidential: false,
    owner_approval: cfg.ownerApproval,
    assets: [ALLOWED_ASSETS.NEAR, ALLOWED_ASSETS.USDC],
    limits: {}, // USD-Budget + max_actions_per_hour genügen für die Demo; per-Asset-Limits nach Bedarf
    max_actions_per_hour: 10,
    destinations: {
      mode: "only",
      list: contractPayoutAddresses.map(parseDestination),
    },
    budget: { daily_usd: cap, weekly_usd: cap, monthly_usd: null },
    timelock_ms: cfg.timelockMs,
  };
}

/** Kurzfassung für Konsole/Evidenz — keine Secrets, nur Regeln. */
export function policySummary(policy: TreasuryPolicy) {
  return {
    actions: policy.actions,
    assets: policy.assets,
    budget_usd: policy.budget,
    timelock_ms: policy.timelock_ms,
    max_actions_per_hour: policy.max_actions_per_hour,
    owner_approval: policy.owner_approval,
    destinations: {
      mode: policy.destinations.mode,
      count: policy.destinations.list.length,
      entries: policy.destinations.list.map((e) =>
        e.action === "withdraw" ? `withdraw:${e.chain}:${short(e.address)}` : `transfer:${short(e.address)}`,
      ),
    },
  };
}

function short(a: string): string {
  return a.length > 20 ? `${a.slice(0, 10)}…${a.slice(-6)}` : a;
}
