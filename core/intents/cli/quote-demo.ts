/**
 * CLI: quote-demo — dry:true Micro-Quote NEAR→USDC. Führt NIEMALS aus (dry:true hart im Code).
 * Ausgabe: Quote-ID + Status, OHNE Secrets (env.ts redact() in allen Pfaden).
 * Run: npm run quote-demo
 */
import { treasuryConfig, redact, redactJson } from "../env.js";
import { quoteDemo } from "../treasury.js";
import { resolveAgentId } from "../sign-policy.js";
import { ApiError } from "../client.js";

try {
  const cfg = treasuryConfig();
  console.log(`Base: ${cfg.baseUrl}`);
  console.log(`Gate: AGENT_EXECUTE=${cfg.executeGate ? "true" : "false (dry-only Modus)"}, Cap=${cfg.demoMaxUsd} USD, Betrag≈${cfg.demoAmountUsd} USD`);
  const agentId = resolveAgentId();
  const outcome = await quoteDemo(agentId, cfg);
  console.log(`\nQuote-ID: ${outcome.quoteId}`);
  console.log(`Status:   ${outcome.lifecycle} (dry:true — keine Ausführung)`);
  console.log(redactJson(outcome));
  if (!cfg.executeGate) console.log("\nHinweis: Ausführung gesperrt (AGENT_EXECUTE default false). dry:true-Beweis first — RULES.md §Sicherheit.");
} catch (err) {
  if (err instanceof ApiError) {
    console.error(`\nQuote fehlgeschlagen: code=${err.code} layer=${err.layer ?? "?"} http=${err.httpStatus}`);
    if (err.code === "agent_not_found") {
      console.error("→ Agent fehlt noch. USER-Schritt: npm run policy:create und Signier-Message im Wallet bestätigen.");
    }
    if (err.retryable) console.error("→ retryable: identischen Request mit gleichem Idempotency-Key wiederholen.");
  } else {
    console.error(`\n${redact(err instanceof Error ? err.message : String(err))}`);
  }
  process.exit(1);
}
