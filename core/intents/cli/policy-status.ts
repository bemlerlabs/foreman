/**
 * CLI: policy-status — policy revision, budget usage, operations history, optionally a
 * single correlation_id (status observation after UNCERTAIN/NEEDS_REVIEW — observe,
 * never resend). No secrets in the output.
 * Run: npm run policy-status            (policy + recent operations)
 *      npm run policy-status -- --cid <correlation_id>   (observe one status)
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
    console.log(`API status:     ${status.status}  → lifecycle: ${toLifecycleStatus(status.status)}`);
    if (status.failure_code) console.log(`failure_code:   ${status.failure_code}`);
    console.log(redactJson(status));
    process.exit(0);
  }

  const agentId = resolveAgentId();
  const policy = await api.getPolicy(agentId);
  console.log(`Agent: ${agentId}  Base: ${cfg.baseUrl}`);
  console.log(`Policy revision: ${policy.revision}  status: ${policy.status}  provider_synced: ${policy.provider_policy_synced}`);
  console.log(redactJson({ policy: policy.policy, usage: policy.usage, cooldowns: policy.cooldowns }));
  console.log("\nRecent operations (persisted locally):");
  console.log(redactJson(listOperations().slice(0, 8)));
} catch (err) {
  console.error(`\n${redact(err instanceof Error ? err.message : String(err))}`);
  process.exit(1);
}
