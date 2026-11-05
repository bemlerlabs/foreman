# core/intents — Intents Agent API Treasury-Loop (Foreman)

Das Treasury ist **ein** Konto über die [NEAR Intents Agent API](https://api.agentsonintents.com)
(`X-API-Key: naa_…` aus `.env`, Backend-only). Der Agent hat Geld, aber **keine Keys**: Jede Regel
(Budget, Destinations-Whitelist, Timelock) sitzt in einer **vom Menschen signierten Policy**
(NEP-366 gaslos / NEP-413 off-chain — 0 Gas für den Owner). Der Foreman-Code signiert **nie**.

> Codex-Screener-Kurzfassung: `dry:true` ist hart im Code erzwungen, solange `AGENT_EXECUTE != "true"`
> (Default false, `treasury.ts`). Assets sind fest auf NEAR/USDC whitelistet (`env.ts::ALLOWED_ASSETS`),
> der USD-Cap ist hart bei 3 $ (`HARD_MAX_DEMO_USD`, RULES.md Demo-Disziplin). Secrets werden in jedem
> Ausgabe-Pfad über `redact()` maskiert (`naa_…`, `ngt_…`, JWTs, `ed25519:…`).

## do X → see Y

| # | do X | see Y |
|---|------|-------|
| 1 | `npm run quote-demo` | `Status: DRY (dry:true — keine Ausführung)` + Quote mit `amount_out`, `fee`, `warnings`, `spend.amount_usd`. Ohne Agent: klarer Hinweis auf Schritt 3. |
| 2 | `npm run execute-demo` (ohne Flag) | `GATE: AGENT_EXECUTE != 'true' → keine Ausführung` — Abbruch **vor** jedem API-Dispatch. Default false, hart in `treasury.executeDemo()`. |
| 3 | `npm run policy:create` (Owner-Daten in `.env`) | Generierter `agent_create`-Intent: `correlation_id` (`intent_…`), `preview.policy` (Budget 3 $/Tag, Destinations `only`+Whitelist, Timelock 60 s, assets nur NEAR/USDC) + **Signier-Message für den Menschen**. Kein Auto-Sign. |
| 4 | Mensch: `npm run owner:sign -- --cid … --keystore … --i-am-the-owner` dann `npm run policy:submit -- --cid … --signed …` | `Intent …: API-Status=… → Lifecycle=…`; bei Erfolg `Agent-ID gemerkt: …` → weiter mit 1. |
| 5 | `npm run policy-status` | Policy-Revision, `provider_policy_synced`, Budget-Usage (täglich/wöchentlich geladen vs. frei), Timelock-Countdown, letzte Operationen. |
| 6 | `npm run policy-status -- --cid <correlation_id>` | API-Status + klassifizierter Lifecycle (`PENDING`/`UNCERTAIN`/`NEEDS_REVIEW`/`COMPLETED`/`FAILED`). Nach `UNCERTAIN`: **beobachten, nie neu senden**. |
| 7 | `AGENT_EXECUTE=true npm run execute-demo` (nach dry-Beweis + Grant) | Live-Micro-Swap NEAR→USDC: `Correlation-ID` + Statusmaschine mit bounded Polling; `min_amount_out` aus der Vorberechtigungs-Quote (1 % Slippage). |

## Datei-Landkarte

- `env.ts` — dotenv lädt Repo-Root `.env` (chmod 600, gitignored); `redact()` maskiert ALLE Secret-Muster
  in jeder Ausgabe; Defaults: Prod-Base-URL, `AGENT_EXECUTE=false`, `DEMO_MAX_USD=3` (hart gedeckelt).
- `client.ts` — Node-22-kompatibler Raw-fetch-REST-Wrapper (SDK deklariert `engines: node>=24`; HTTP ist
  reines JSON, 1:1 nach `examples/09-raw-http`). JSON:API-Fehler → `ApiError{code,layer,retryable}` —
  Verzweigung nur auf `code` (nie title/detail), Header-Werte verlassen die Datei nie.
- `lifecycle.ts` — Statusmaschine `PENDING/UNCERTAIN/NEEDS_REVIEW/COMPLETED(+FAILED)`, persistenter
  Idempotency-Store (`.state/operations.json`, 0600, gitignored), bounded Retries **nur mit identischem
  Key**, Quota-Guard (100 Agent-Admissionen/24 h; 429/5xx retrybar, Custody-Ops-Limit 1.000/24 h über
  429-Behandlung).
- `policy.ts` — Owner-Policy-Builder: Budget-Deckel (USD), Destinations-Whitelist `only` (nur
  Contract-/Payout-Adressen aus `TREASURY_DESTINATIONS`), `timelock_ms`, assets nur NEAR/USDC,
  `actions:["swap"]`, `native`/`confidential` aus.
- `sign-policy.ts` — generate → **Mensch signiert** → submit → Status. `owner-sign-helper.ts` ist ein
  Signier-WERKZEUG, das nur der Eigentümer selbst startet (`--i-am-the-owner`); Produktcode importiert es nie.
- `grant-prepare.ts` — Grant-Credential (`ngt_…` via SDK, läuft auf Node 22) + `grant_issue`-Intent;
  Token nur in `.state/grants/` (0600) bzw. `INTENTS_GRANT_TOKEN`, nie auf die Konsole.

## benutzte API-Verträge (Referenzen)

`GET {base}/llms.txt` · `POST /v1/generate-intent` · `POST /v1/submit-intent` · `GET /v1/status` ·
`POST /v1/agents/{id}/swap` (`dry:true` ohne Grant/Idempotency-Key; live mit `X-Grant-Token` +
`Idempotency-Key`) · `GET /v1/quotas` · `GET /v1/tokens`. Beispiele-Kapitel: 05-money-moves
(Zahlungen/Idempotenz), 08-errors-and-recovery (Statusmaschine), 09-raw-http (Header-Parität).

## Umwelt-Setup (Tabelle)

| Variable | Pflicht? | Bedeutung |
|---|---|---|
| `INTENTS_API_KEY` | ja | `naa_…` Partner-Key — NUR `.env`/Prozessumgebung, nie Repo/Log/Commit. |
| `INTENTS_BASE_URL` | nein | Default **Prod** `https://api.agentsonintents.com`; Demo-Deploy `https://api.demo.agentsonintents.com` nur nach Team-Freigabe. |
| `OWNER_ACCOUNT` / `OWNER_PUBLIC_KEY` | für create/create-Sign | **mainnet** NEAR-Konto des Menschen + `ed25519:…` Signier-Key (API-Netz: mainnet!). |
| `AGENT_EXECUTE` | nein | Default `false` ⇒ nur `dry:true`. `true` erst nach dry-Beweis (RULES.md). |
| `DEMO_MAX_USD` / `DEMO_AMOUNT_USD` | nein | Cap (hart ≤ 3) / Micro-Betrag (Default 0.25 $). |
| `TREASURY_DESTINATIONS` | nein | Komma-Liste Whitelist-Einträge (`near:acct`, `intents:acct`, `chain:addr`). |
| `INTENTS_GRANT_TOKEN` | für execute | `ngt_…` aus `grant:prepare`-Store. |
| `INTENTS_TIMELOCK_MS` | nein | Policy-Timelock, Default 60 000 ms. |

## Admissions-Budget (Quota-Disziplin)

**Admission budget: never regenerate the agent within a demo run, reuse grant.** Jede `generate-intent`-Agent-Erstellung
zählt als Agent-Admission (100/24 h, Demo-Deploy-Baseline 2026-11-05 21:20: 5/100 verbraucht, Rest 95 — siehe
EVIDENCE_LOG) und ist NICHT erstattungsfähig. Innerhalb einer Demo-Runde gilt daher: Agent genau EINMAL anlegen
(`policy:create` einmalig), dann alle Aktionen über denselben `agent_id` + wiederverwendeten Grant
(`grant:prepare`, Token in `.state/grants/`) fahren. `policy:create` niemals in Schleifen/Automation aufrufen —
der Onchain-Key-Precheck bremst zwar, ersetzt aber nicht diese Regel.

## Sicherheit — Non-Negotiables (RULES.md §Sicherheit)

1. **Secrets:** `.env` (chmod 600, gitignored) enthält `INTENTS_API_KEY`, `ONECLICK_JWT` u. a. — dieser
   Code liest sie nur für Header; jede Konsole-/Log-Ausgabe läuft durch `redact()`. Keine Secrets in
   Commits, Logs oder Fehlermeldungen.
2. **Kein Auto-Signing:** Owner-Signaturen (agent_create, policy_update, grant_issue, approvals) erzeugt
   ausschließlich der Mensch im Wallet bzw. über das explizit selbstgestartete Signier-Werkzeug.
3. **dry:true-First:** Ausführung ist ohne `AGENT_EXECUTE=true` Code-seitig unmöglich; jede Quote zuerst
   dry, dann Cap/Warnings prüfen, dann (nach Freigabe) live — Idempotency-Key pro Operation stabil
   persistiert, UNCERTAIN wird beobachtet, nie dupliziert.
4. **Identitätstrennung:** Owner ≠ Treasury ≠ Contract ≠ Swarms (RULES.md) — das Treasury signiert nur
   Swaps innerhalb seiner Policy; Payouts autorisiert der Escrow-Contract.
