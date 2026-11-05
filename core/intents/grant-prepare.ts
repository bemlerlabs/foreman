/**
 * grant-prepare.ts — Bereitet den Grant für delegierte Executions vor (Mission: Quote-Lifecycle
 * braucht X-Grant-Token für Live-Aktionen).
 *
 * Ablauf:
 *   1. createGrantCredential() (SDK, läuft auf Node 22) erzeugt token (ngt_…) + commitment.
 *   2. Token wird lokal persistiert (.state/grants/, 0600, gitignored) und zusätzlich als
 *      INTENTS_GRANT_TOKEN in die PROZESSUMGEBUNG des späteren execute-demo gehört — der Token
 *      wird hier NICHT auf die Konsole gedruckt.
 *   3. grant_issue-Intent wird generiert — der MENSCH signiert (kein Auto-Sign).
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
  console.log(`Vorhandener Grant "${label}" wiederverwendet.`);
} else {
  credential = createGrantCredential();
  mkdirSync(grantsDir, { recursive: true, mode: 0o700 });
  writeFileSync(storeFile, JSON.stringify({ label, agent_id: agentId, ...credential }, null, 2), { mode: 0o600 });
  console.log(`Grant-Credential erzeugt und lokal gespeichert (0600): core/intents/.state/grants/${label}.json`);
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
  token_printed: false, // Token bewusst nie auf die Konsole — nur via .state/grants/ oder INTENTS_GRANT_TOKEN
}));
console.log("\nSCHRITT FÜR DEN MENSCHEN: Signier-Message bestätigen, dann einreichen:");
console.log(`  npm run owner:sign -- --cid ${generated.correlation_id} --keystore <credential.json> --i-am-the-owner`);
console.log(`  npm run policy:submit -- --cid ${generated.correlation_id} --signed core/intents/.state/intents/${generated.correlation_id}.signed.json`);
console.log("\nDanach execute-demo mit dem Token aus .state/grants/ (nie committen):");
console.log(`  INTENTS_GRANT_TOKEN=$(cat core/intents/.state/grants/${label}.json | node -e 'process.stdin.on("data",d=>console.log(JSON.parse(d).token))') AGENT_EXECUTE=true npm run execute-demo`);
