/**
 * CLI: quote-demo — dry:true micro quote NEAR→USDC. NEVER executes (dry:true hard in code).
 * Output: quote id + status, WITHOUT secrets (env.ts redact() on all paths).
 * Run: npm run quote-demo
 */
import { treasuryConfig, redact, redactJson } from "../env.js";
import { quoteDemo } from "../treasury.js";
import { resolveAgentId } from "../sign-policy.js";
import { ApiError } from "../client.js";

try {
  const cfg = treasuryConfig();
  console.log(`Base: ${cfg.baseUrl}`);
  console.log(`Gate: AGENT_EXECUTE=${cfg.executeGate ? "true" : "false (dry-only mode)"}, Cap=${cfg.demoMaxUsd} USD, amount≈${cfg.demoAmountUsd} USD`);
  const agentId = resolveAgentId();
  const outcome = await quoteDemo(agentId, cfg);
  console.log(`\nQuote-ID: ${outcome.quoteId}`);
  console.log(`Status:   ${outcome.lifecycle} (dry:true — no execution)`);
  console.log(redactJson(outcome));
  if (!cfg.executeGate) console.log("\nNote: execution locked (AGENT_EXECUTE default false). dry:true proof first — RULES.md §Security.");
} catch (err) {
  if (err instanceof ApiError) {
    console.error(`\nQuote failed: code=${err.code} layer=${err.layer ?? "?"} http=${err.httpStatus}`);
    if (err.code === "agent_not_found") {
      console.error("→ Agent missing. Owner step: npm run policy:create and confirm the signing message in the wallet.");
    }
    if (err.retryable) console.error("→ retryable: repeat the identical request with the same idempotency key.");
  } else {
    console.error(`\n${redact(err instanceof Error ? err.message : String(err))}`);
  }
  process.exit(1);
}
