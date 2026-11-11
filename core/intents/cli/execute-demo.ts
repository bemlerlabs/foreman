/**
 * CLI: execute-demo — live swap NEAR→USDC in the cent range. ONLY with AGENT_EXECUTE=true
 * (hard gate in treasury.executeDemo(); without the flag it aborts here before any request).
 * Output: quote/correlation id + status, WITHOUT secrets.
 * Run (after the dry:true proof): AGENT_EXECUTE=true npm run execute-demo
 */
import { treasuryConfig, redact, redactJson } from "../env.js";
import { executeDemo } from "../treasury.js";
import { resolveAgentId } from "../sign-policy.js";
import { ApiError } from "../client.js";

try {
  const cfg = treasuryConfig();
  console.log(`Base: ${cfg.baseUrl}`);
  if (!cfg.executeGate) {
    // Up-front message for the log; the actual gate is treasury.executeDemo().
    console.log("GATE: AGENT_EXECUTE != 'true' → no execution, dry abort without API dispatch.");
  }
  const agentId = resolveAgentId();
  const outcome = await executeDemo(agentId, cfg);
  console.log(`\nCorrelation-ID: ${outcome.correlationId}`);
  console.log(`Status:         ${outcome.lifecycle} (API: ${outcome.apiStatus})`);
  if (outcome.failureCode) console.log(`Failure-Code:   ${outcome.failureCode}`);
  console.log(redactJson(outcome));
} catch (err) {
  if (err instanceof ApiError) {
    console.error(`\nExecute failed: code=${err.code} layer=${err.layer ?? "?"} http=${err.httpStatus}`);
    if (["UNCERTAIN", "NEEDS_REVIEW"].includes(String(err.code))) {
      console.error("→ DO NOT resend — observe the status with the same correlation_id.");
    }
  } else {
    console.error(`\n${redact(err instanceof Error ? err.message : String(err))}`);
  }
  process.exit(1);
}
