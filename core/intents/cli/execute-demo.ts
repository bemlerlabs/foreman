/**
 * CLI: execute-demo — Live-Swap NEAR→USDC im Cent-Bereich. NUR mit AGENT_EXECUTE=true
 * (hartes Gate in treasury.executeDemo(); ohne Flag bricht es hier ab, bevor ein Request geht).
 * Ausgabe: Quote-/Correlation-ID + Status, OHNE Secrets.
 * Run (nach dry:true-Beweis): AGENT_EXECUTE=true npm run execute-demo
 */
import { treasuryConfig, redact, redactJson } from "../env.js";
import { executeDemo } from "../treasury.js";
import { resolveAgentId } from "../sign-policy.js";
import { ApiError } from "../client.js";

try {
  const cfg = treasuryConfig();
  console.log(`Base: ${cfg.baseUrl}`);
  if (!cfg.executeGate) {
    // Vorab-Botschaft fürs Protokoll; das eigentliche Gate ist treasury.executeDemo().
    console.log("GATE: AGENT_EXECUTE != 'true' → keine Ausführung, trockener Abbruch ohne API-Dispatch.");
  }
  const agentId = resolveAgentId();
  const outcome = await executeDemo(agentId, cfg);
  console.log(`\nCorrelation-ID: ${outcome.correlationId}`);
  console.log(`Status:         ${outcome.lifecycle} (API: ${outcome.apiStatus})`);
  if (outcome.failureCode) console.log(`Failure-Code:   ${outcome.failureCode}`);
  console.log(redactJson(outcome));
} catch (err) {
  if (err instanceof ApiError) {
    console.error(`\nExecute fehlgeschlagen: code=${err.code} layer=${err.layer ?? "?"} http=${err.httpStatus}`);
    if (["UNCERTAIN", "NEEDS_REVIEW"].includes(String(err.code))) {
      console.error("→ NICHT erneut senden — Status mit gleichem correlation_id beobachten.");
    }
  } else {
    console.error(`\n${redact(err instanceof Error ? err.message : String(err))}`);
  }
  process.exit(1);
}
