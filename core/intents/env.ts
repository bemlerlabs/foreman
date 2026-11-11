/**
 * Env loader + secret hygiene for the Foreman Intents treasury.
 *
 * Rules (RULES.md §Security, mission):
 * - `INTENTS_API_KEY` (naa_…) and all tokens are read ONLY from the process environment or the
 *   gitignored `.env` at the repo root. This module never prints secret values.
 * - Every output originating from the API (error texts, details) passes through `redact()`,
 *   so even a leaky API field cannot let a `naa_`/`ngt_`/JWT slip through.
 * - AGENT_EXECUTE default false; DEMO_MAX_USD default 3, hard-capped at HARD_MAX_DEMO_USD.
 */
import { config as loadDotenv } from "dotenv";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** Repo root = two levels above core/intents/ */
export const REPO_ROOT = path.resolve(HERE, "..", "..");
export const STATE_DIR = path.join(HERE, ".state");

// Load .env only when the variable is not already explicitly set in the environment:
// process env beats .env (dotenv does not override by default).
const dotenvPath = path.join(REPO_ROOT, ".env");
if (existsSync(dotenvPath)) loadDotenv({ path: dotenvPath, quiet: true });

/** Production API. Demo deploy only via INTENTS_BASE_URL override (lead clarifies usage). */
export const PROD_BASE_URL = "https://api.agentsonintents.com";
export const DEMO_BASE_URL = "https://api.demo.agentsonintents.com";

/** Hard demo caps — independent of .env. RULES.md: budgets ≤ $3 equivalent. */
export const HARD_MAX_DEMO_USD = 3;
/** Only these assets may move in the demo (mission: NEAR/USDC ONLY). */
export const ALLOWED_ASSETS = {
  NEAR: "nep141:wrap.near",
  USDC: "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
} as const;

function env(name: string): string | undefined {
  const v = process.env[name];
  if (v === undefined) return undefined;
  const t = v.trim();
  return t.length > 0 ? t : undefined;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export type TreasuryConfig = ReturnType<typeof treasuryConfig>;

export function treasuryConfig() {
  const baseUrl = (env("INTENTS_BASE_URL") ?? PROD_BASE_URL).replace(/\/+$/, "");
  const apiKey = env("INTENTS_API_KEY");
  if (!apiKey) {
    throw new ConfigError(
      "INTENTS_API_KEY missing (naa_… from partners.near-intents.org). Set it only in .env or the process environment — never in the repo.",
    );
  }
  // Formats: classic naa_ partner key OR JWT from the partner portal (eyJ…, portal migration 2026-11-06).
  // Format check without printing values — guards against typos, leaks nothing; redact() masks both patterns.
  if (!apiKey.startsWith("naa_") && !apiKey.startsWith("eyJ")) {
    throw new ConfigError(
      "INTENTS_API_KEY has no recognizable format (naa_… or portal JWT eyJ…) — please copy it from the partner portal.",
    );
  }

  const executeGate = env("AGENT_EXECUTE") === "true"; // default false, strictly "true".

  const rawCap = Number(env("DEMO_MAX_USD") ?? "3");
  if (!Number.isFinite(rawCap) || rawCap <= 0) {
    throw new ConfigError(`DEMO_MAX_USD is not a positive number: ${env("DEMO_MAX_USD")}`);
  }
  const demoMaxUsd = Math.min(rawCap, HARD_MAX_DEMO_USD); // hard cap, even on .env errors

  const rawAmount = Number(env("DEMO_AMOUNT_USD") ?? "0.25");
  if (!Number.isFinite(rawAmount) || rawAmount <= 0 || rawAmount > demoMaxUsd) {
    throw new ConfigError(
      `DEMO_AMOUNT_USD must lie in (0, ${demoMaxUsd}] (cap from DEMO_MAX_USD, hard at ${HARD_MAX_DEMO_USD}).`,
    );
  }

  return {
    baseUrl,
    /** DO NOT print, DO NOT log. Only client.ts reads this for the X-API-Key header. */
    apiKey,
    agentId: env("INTENTS_AGENT_ID"),
    // The Intents flow deliberately reads the MAINNET variant (API network=mainnet). OWNER_ACCOUNT
    // (testnet) belongs to the deploy scripts — do NOT use it silently here:
    // fallback only when it is recognizably not a testnet account.
    ownerAccount:
      env("OWNER_ACCOUNT_MAINNET") ??
      (() => {
        const legacy = env("OWNER_ACCOUNT");
        return legacy && !legacy.endsWith(".testnet") ? legacy : undefined;
      })(),
    /** ed25519:… — the key the human signs the intent with (agent_create needs it). */
    ownerPublicKey: env("OWNER_PUBLIC_KEY"),
    nearRpcMainnet: env("NEAR_RPC_MAINNET") ?? "https://free.rpc.fastnear.com",
    executeGate,
    demoMaxUsd,
    demoAmountUsd: rawAmount,
    timelockMs: intEnv("INTENTS_TIMELOCK_MS", 60_000),
    /** Whitelist for policy destinations: comma list "chain:address[:memo]" or NEAR Intents receivers. */
    destinations: (env("TREASURY_DESTINATIONS") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    grantToken: env("INTENTS_GRANT_TOKEN"),
    ownerApproval: env("INTENTS_OWNER_APPROVAL") === "true",
  };
}

function intEnv(name: string, fallback: number): number {
  const raw = env(name);
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) throw new ConfigError(`${name} must be a non-negative integer.`);
  return n;
}

/** Secret patterns that must never land in any output. */
const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/\bnaa_[A-Za-z0-9_]+/g, "naa_[redacted]"],
  [/\bngt_[A-Za-z0-9_]+/g, "ngt_[redacted]"],
  [/\bwk_[A-Za-z0-9_]+/g, "wk_[redacted]"],
  [/\baat_[A-Za-z0-9_]+/g, "aat_[redacted]"],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, "jwt_[redacted]"], // ONECLICK_JWT etc.
  [/\bed25519:[A-Za-z0-9]+/g, "ed25519_[redacted]"],
  [/\bsk_[A-Za-z0-9]{16,}/g, "sk_[redacted]"],
];

/**
 * Redact secret patterns from text before it goes into logs/evidence/CLI output.
 * Mandatory in client.ts and on every CLI output path.
 */
export function redact(text: string, knownSecrets: string[] = []): string {
  let out = text;
  for (const secret of knownSecrets) {
    if (secret.length >= 8) out = out.split(secret).join("[redacted]");
  }
  for (const [pattern, replacement] of SECRET_PATTERNS) out = out.replace(pattern, replacement);
  return out;
}

/** JSON -> redacted text for console/evidence. */
export function redactJson(value: unknown, knownSecrets: string[] = []): string {
  return redact(JSON.stringify(value, null, 2), knownSecrets);
}
