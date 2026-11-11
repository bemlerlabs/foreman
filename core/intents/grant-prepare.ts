/**
 * grant-prepare.ts — prepares the grant for delegated executions (mission: the quote lifecycle
 * needs an X-Grant-Token for live actions).
 *
 * Flow:
 *   1. createGrantCredential() (SDK, runs on Node 22) creates token (ngt_…) + commitment.
 *   2. The token is persisted locally (.state/grants/, 0600, gitignored) and additionally
 *      belongs into the PROCESS ENV of the later execute-demo as INTENTS_GRANT_TOKEN —
 *      the token is NOT printed to the console here.
 *   3. The grant_issue intent is generated — the HUMAN signs (no auto-sign).
 *
 * Run: npm run grant:prepare [-- --label bot-1] [-- --expires 2026-11-15T00:00:00Z]
 */
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createGrantCredential } from "@near-intents-agent-api/sdk";
import { STATE_DIR, treasuryConfig, redactJson } from "./env.js";
import { IntentsClient } from "./client.js";
import { newIdempotencyKey } from "./lifecycle.js";
import { resolveAgentId } from "./sign-policy.js";

const argv = process.argv.slice(2);
const arg = (n: string) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 ? argv[i + 1] : undefined;
};

const cfg = treasuryConfig();
const api = new IntentsClient(cfg);
const agentId = resolveAgentId();

const grantsDir = path.join(STATE_DIR, "grants");
const label = arg("label") ?? `foreman-demo-${Date.now()}`;
const expires = arg("expires") ?? new Date(Date.now() + 7 * 864e5).toISOString();

const storeFile = path.join(grantsDir, `${label}.json`);
let credential: { token: string; commitment: string };
if (existsSync(storeFile)) {
  credential = JSON.parse(readFileSync(storeFile, "utf8"));
  console.log(`Reusing existing grant "${label}".`);
} else {
  credential = createGrantCredential();
  mkdirSync(grantsDir, { recursive: true, mode: 0o700 });
  writeFileSync(storeFile, JSON.stringify({ label, agent_id: agentId, ...credential }, null, 2), { mode: 0o600 });
  console.log(`Grant credential created and stored locally (0600): core/intents/.state/grants/${label}.json`);
}

const generated = await api.generateIntent(
  { type: "grant_issue", agent_id: agentId, label, credential: credential.commitment, expires_at: expires },
  newIdempotencyKey(`grant-${label}`),
);

const intentsDir = path.join(STATE_DIR, "intents");
mkdirSync(intentsDir, { recursive: true, mode: 0o700 });
writeFileSync(path.join(intentsDir, `${generated.correlation_id}.json`), JSON.stringify(generated, null, 2), { mode: 0o600 });

console.log(redactJson({
  correlation_id: generated.correlation_id,
  type: generated.type,
  standard: generated.intent.standard,
  expires_at: expires,
  token_printed: false, // token deliberately never on the console — only via .state/grants/ or INTENTS_GRANT_TOKEN
}));
console.log("\nSTEP FOR THE HUMAN: confirm the signing message, then submit:");
console.log(`  npm run owner:sign -- --cid ${generated.correlation_id} --keystore <credential.json> --i-am-the-owner`);
console.log(`  npm run policy:submit -- --cid ${generated.correlation_id} --signed core/intents/.state/intents/${generated.correlation_id}.signed.json`);
console.log("\nThen execute-demo with the token from .state/grants/ (never commit it):");
console.log(`  INTENTS_GRANT_TOKEN=$(cat core/intents/.state/grants/${label}.json | node -e 'process.stdin.on("data",d=>console.log(JSON.parse(d).token))') AGENT_EXECUTE=true npm run execute-demo`);
