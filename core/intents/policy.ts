/**
 * Owner policy builder for the Foreman treasury (RULES.md §Roles/§Security):
 *
 * - Budget caps: daily/weekly USD from DEMO_MAX_USD (hard ≤ $3 equivalent).
 * - Destinations whitelist: `mode: "only"` — entries are ONLY contract/payout addresses
 *   (TREASURY_DESTINATIONS in .env). New accounts start safe: `only` + empty list ⇒
 *   money stays with the agent.
 * - Timelock: timelock_ms (default 60 s) — every money action waits visibly.
 * - Assets: sell/transfer only NEAR (nep141:wrap.near) and USDC (nep141:17208…) —
 *   red list: BTC etc. are taboo.
 * - actions: only `swap` (settlement of the demo); transfer/withdraw only once the
 *   escrow contract settlement path (task-1) is wired and approved.
 * - native: completely off (no block ⇒ all agent-owned keys off).
 * - confidential: false (intents.far is permissioned, not provable — red list #2).
 * - owner_approval: optional via INTENTS_OWNER_APPROVAL=true (then PENDING_APPROVAL for the human).
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
 * TREASURY_DESTINATIONS formats (comma list):
 *   "near:<account>"                    → withdraw to a NEAR account (payout/contract account)
 *   "<chain>:<address>"                 → withdraw on another chain
 *   "intents:<account>"                 → transfer to a NEAR Intents account
 *   "<account>"                         → withdraw on NEAR (chain=near implicit)
 * Everything else is rejected — whitelist means: exact entries, no guessing.
 */
export function parseDestination(raw: string): DestinationEntry {
  const value = raw.trim();
  if (!value) throw new Error("Empty destination not allowed");
  const parts = value.split(":");
  if (parts[0] === "intents") {
    const address = parts.slice(1).join(":");
    assertNearLike(address, value);
    return { action: "transfer", address, confidential: false };
  }
  if (parts.length >= 2 && parts[0].length <= 12 && /^[a-z0-9]+$/.test(parts[0])) {
    const chain = parts[0];
    const address = parts.slice(1).join(":");
    if (!address) throw new Error(`Destination without address: ${redactedName(value)}`);
    if (chain === "near") assertNearLike(address, value);
    return { action: "withdraw", chain, address, memo: null };
  }
  assertNearLike(value, value);
  return { action: "withdraw", chain: "near", address: value, memo: null };
}

function assertNearLike(address: string, source: string): void {
  // NEAR account id or implicit (64 hex); the server validates again (invalid_address).
  const ok =
    /^[0-9a-f]{64}$/.test(address) ||
    /^[0-9a-z_-]{2,62}(\.[0-9a-z_-]{2,62})*$/.test(address);
  if (!ok) throw new Error(`Invalid destination entry: ${redactedName(source)}`);
}

function redactedName(value: string): string {
  // Destinations are not secrets, but we do not drag account names through error stacks.
  return value.length > 70 ? `${value.slice(0, 24)}…` : value;
}

/**
 * Build the policy for the Foreman treasury. `contractPayoutAddresses` = WHITELIST, typically
 * only the escrow contract and the contract's payout addresses (RULES.md: "destinations
 * whitelist = only the contract's contract/payout addresses").
 */
export function buildTreasuryPolicy(
  cfg: TreasuryConfig,
  contractPayoutAddresses: string[] = cfg.destinations,
): TreasuryPolicy {
  if (!contractPayoutAddresses.every((d) => typeof d === "string")) {
    throw new Error("Destinations must be strings");
  }
  const cap = Math.min(cfg.demoMaxUsd, HARD_MAX_DEMO_USD).toFixed(2);
  return {
    frozen: false,
    actions: ["swap"],
    confidential: false,
    owner_approval: cfg.ownerApproval,
    assets: [ALLOWED_ASSETS.NEAR, ALLOWED_ASSETS.USDC],
    limits: {}, // USD budget + max_actions_per_hour suffice for the demo; per-asset limits as needed
    max_actions_per_hour: 10,
    destinations: {
      mode: "only",
      list: contractPayoutAddresses.map(parseDestination),
    },
    budget: { daily_usd: cap, weekly_usd: cap, monthly_usd: null },
    timelock_ms: cfg.timelockMs,
  };
}

/** Short form for console/evidence — no secrets, only rules. */
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
