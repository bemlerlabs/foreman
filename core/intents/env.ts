/**
 * Env-Loader + Secret-Hygiene für den Foreman-Intents-Treasury.
 *
 * Regeln (RULES.md §Sicherheit, Mission):
 * - `INTENTS_API_KEY` (naa_…) und alle Tokens werden NUR aus der Prozessumgebung bzw. der
 *   gitignorierten `.env` im Repo-Root gelesen. Dieser Module druckt niemals Secret-Werte.
 * - Jede Ausgabe, die aus der API stammt (Fehlertexte, details), läuft durch `redact()`,
 *   damit auch ein undichtes API-Feld kein `naa_`/`ngt_`/JWT durchsickern lässt.
 * - AGENT_EXECUTE default false; DEMO_MAX_USD default 3, hart gedeckelt auf HARD_MAX_DEMO_USD.
 */
import { config as loadDotenv } from "dotenv";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** Repo-Root = zwei Ebenen über core/intents/ */
export const REPO_ROOT = path.resolve(HERE, "..", "..");
export const STATE_DIR = path.join(HERE, ".state");

// .env nur laden, wenn die Variable nicht schon explizit in der Umgebung steht:
// Prozessumgebung schlägt .env (dotenv überschreibt per Default nichts).
const dotenvPath = path.join(REPO_ROOT, ".env");
if (existsSync(dotenvPath)) loadDotenv({ path: dotenvPath, quiet: true });

/** Produktions-API. Demo-Deploy nur via INTENTS_BASE_URL-Override (Lead klärt Nutzung). */
export const PROD_BASE_URL = "https://api.agentsonintents.com";
export const DEMO_BASE_URL = "https://api.demo.agentsonintents.com";

/** Harte Demo-Deckel — unabhängig von .env. RULES.md: Budgets ≤ 3 $ Gegenwert. */
export const HARD_MAX_DEMO_USD = 3;
/** Nur diese Assets dürfen in der Demo bewegt werden (Mission: NUR NEAR/USDC). */
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
      "INTENTS_API_KEY fehlt (naa_… aus partners.near-intents.org). Nur in .env oder Prozessumgebung setzen — niemals ins Repo.",
    );
  }
  if (!apiKey.startsWith("naa_")) {
    // Format-Check ohne Werte-Ausgabe — schützt vor Tippfehlern, leakt nichts.
    throw new ConfigError("INTENTS_API_KEY hat kein naa_-Präfix — bitte aus dem Partner-Dashboard kopieren.");
  }

  const executeGate = env("AGENT_EXECUTE") === "true"; // Default false, streng "true".

  const rawCap = Number(env("DEMO_MAX_USD") ?? "3");
  if (!Number.isFinite(rawCap) || rawCap <= 0) {
    throw new ConfigError(`DEMO_MAX_USD ist keine positive Zahl: ${env("DEMO_MAX_USD")}`);
  }
  const demoMaxUsd = Math.min(rawCap, HARD_MAX_DEMO_USD); // harter Cap, auch bei .env-Fehler

  const rawAmount = Number(env("DEMO_AMOUNT_USD") ?? "0.25");
  if (!Number.isFinite(rawAmount) || rawAmount <= 0 || rawAmount > demoMaxUsd) {
    throw new ConfigError(
      `DEMO_AMOUNT_USD muss in (0, ${demoMaxUsd}] liegen (Cap aus DEMO_MAX_USD, hart bei ${HARD_MAX_DEMO_USD}).`,
    );
  }

  return {
    baseUrl,
    /** NICHT drucken, NICHT loggen. Nur client.ts liest das für den X-API-Key-Header. */
    apiKey,
    agentId: env("INTENTS_AGENT_ID"),
    ownerAccount: env("OWNER_ACCOUNT"),
    /** ed25519:… — der Key, mit dem der Mensch den Intent signiert (agent_create braucht ihn). */
    ownerPublicKey: env("OWNER_PUBLIC_KEY"),
    nearRpcMainnet: env("NEAR_RPC_MAINNET") ?? "https://free.rpc.fastnear.com",
    executeGate,
    demoMaxUsd,
    demoAmountUsd: rawAmount,
    timelockMs: intEnv("INTENTS_TIMELOCK_MS", 60_000),
    /** Whitelist für Policy-Destinations: Komma-liste "chain:address[:memo]" bzw. NEAR-Intents-Receiver. */
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
  if (!Number.isInteger(n) || n < 0) throw new ConfigError(`${name} muss eine nicht-negative Ganzzahl sein.`);
  return n;
}

/** Secret-Muster, die in keiner Ausgabe landen dürfen. */
const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/\bnaa_[A-Za-z0-9_]+/g, "naa_[redacted]"],
  [/\bngt_[A-Za-z0-9_]+/g, "ngt_[redacted]"],
  [/\bwk_[A-Za-z0-9_]+/g, "wk_[redacted]"],
  [/\baat_[A-Za-z0-9_]+/g, "aat_[redacted]"],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, "jwt_[redacted]"], // ONECLICK_JWT u.ä.
  [/\bed25519:[A-Za-z0-9]+/g, "ed25519_[redacted]"],
  [/\bsk_[A-Za-z0-9]{16,}/g, "sk_[redacted]"],
];

/**
 * Redact Secret-Muster aus Text, bevor er in Logs/Evidenz/CLI-Ausgabe geht.
 * Wird in client.ts und in allen CLI-Ausgabe-Pfaden Pflicht verwendet.
 */
export function redact(text: string, knownSecrets: string[] = []): string {
  let out = text;
  for (const secret of knownSecrets) {
    if (secret.length >= 8) out = out.split(secret).join("[redacted]");
  }
  for (const [pattern, replacement] of SECRET_PATTERNS) out = out.replace(pattern, replacement);
  return out;
}

/** JSON -> roter Text für Konsole/Evidenz. */
export function redactJson(value: unknown, knownSecrets: string[] = []): string {
  return redact(JSON.stringify(value, null, 2), knownSecrets);
}
