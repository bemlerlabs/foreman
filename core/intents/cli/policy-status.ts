/**
 * CLI: policy-status — Policy-Revision, Budget-Usage, Operations-Historie, optional ein
 * einzelner correlation_id (Status-Beobachtung nach UNCERTAIN/NEEDS_REVIEW — beobachten,
 * niemals neu senden). Keine Secrets in der Ausgabe.
 * Run: npm run policy-status            (Policy + letzte Operationen)
 *      npm run policy-status -- --cid <correlation_id>   (ein Status beobachten)
 */
import { treasuryConfig, redact, redactJson } from "../env.js";
import { IntentsClient } from "../client.js";
import { resolveAgentId } from "../sign-policy.js";
import { listOperations, toLifecycleStatus } from "../lifecycle.js";

try {
  const cfg = treasuryConfig();
  const api = new IntentsClient(cfg);
  const cidIdx = process.argv.indexOf("--cid");
  const cid = cidIdx >= 0 ? process.argv[cidIdx + 1] : undefined;

  if (cid) {
    const status = await api.getStatus(cid, { waitMs: 30_000 });
    console.log(`correlation_id: ${status.correlation_id}`);
    console.log(`API-Status:     ${status.status}  → Lifecycle: ${toLifecycleStatus(status.status)}`);
    if (status.failure_code) console.log(`failure_code:   ${status.failure_code}`);
    console.log(redactJson(status));
    process.exit(0);
  }

  const agentId = resolveAgentId();
  const policy = await api.getPolicy(agentId);
  console.log(`Agent: ${agentId}  Base: ${cfg.baseUrl}`);
  console.log(`Policy-Revision: ${policy.revision}  Status: ${policy.status}  provider_synced: ${policy.provider_policy_synced}`);
  console.log(redactJson({ policy: policy.policy, usage: policy.usage, cooldowns: policy.cooldowns }));
  console.log("\nLetzte Operationen (lokal persistiert):");
  console.log(redactJson(listOperations().slice(0, 8)));
} catch (err) {
  console.error(`\n${redact(err instanceof Error ? err.message : String(err))}`);
  process.exit(1);
}
