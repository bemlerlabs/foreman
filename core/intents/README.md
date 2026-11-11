# core/intents — Intents Agent API treasury loop (Foreman)

The treasury is **one** account via the [NEAR Intents Agent API](https://api.agentsonintents.com)
(`X-API-Key: naa_…` from `.env`, backend-only). The agent holds money but **no keys**: every rule
(budget, destinations whitelist, timelock) lives in a **policy signed by the human**
(NEP-366 gasless / NEP-413 off-chain — 0 gas for the owner). Foreman code **never** signs.

> Screener summary: `dry:true` is hard-enforced in code while `AGENT_EXECUTE != "true"`
> (default false, `treasury.ts`). Assets are fixed to the NEAR/USDC whitelist (`env.ts::ALLOWED_ASSETS`),
> the USD cap is hard at 3 $ (`HARD_MAX_DEMO_USD`, RULES.md demo discipline). Secrets are masked in every
> output path via `redact()` (`naa_…`, `ngt_…`, JWTs, `ed25519:…`).

## do X → see Y

| # | do X | see Y |
|---|------|-------|
| 1 | `npm run quote-demo` | `Status: DRY (dry:true — no execution)` + quote with `amount_out`, `fee`, `warnings`, `spend.amount_usd`. Without an agent: a clear pointer to step 3. |
| 2 | `npm run execute-demo` (without the flag) | `GATE: AGENT_EXECUTE != 'true' → no execution` — abort **before** any API dispatch. Default false, hard in `treasury.executeDemo()`. |
| 3a | **T2 path (passkey/O3):** `npm run popup` → `http://localhost:8789/register` | Touch ID dialog; then `✅ Passkey registered` — `.state/passkey.json` (public-only, 0600) with `credential_id` + DER P-256 key (API pattern `MFkwEwYHKo…`). |
| 3b | `npm run policy:create -- --owner-type passkey` | Generated `agent_create` intent (standard=webauthn): `correlation_id` (`intent_…`), `preview.policy` (budget 3 $/day, destinations `only`+whitelist, timelock 60 s, assets NEAR/USDC only) + signing pointer to the popup page. No auto-sign, **exactly one** generate run per demo round (admission!). |
| 3c | Human: `http://localhost:8789/sign?cid=…` → read policy → Touch ID → `npm run policy:submit -- --cid …` | Plain-text policy preview (moment of trust), `signed_data` byte-exact from the original intent → `lifecycle=…`, on success `Agent id remembered: …` → continue with 1. |
| 4 | (Legacy NEAR owner) `npm run policy:create` + `npm run owner:sign -- --cid … --keystore … --i-am-the-owner` + `policy:submit` | Like 3b/3c with `standard=nep366`/keystore; works only if `OWNER_PUBLIC_KEY` is an on-chain access key (precheck). |
| 5 | `npm run policy-status` | Policy revision, `provider_policy_synced`, budget usage (daily/weekly spent vs. free), timelock countdown, recent operations. |
| 6 | `npm run policy-status -- --cid <correlation_id>` | API status + classified lifecycle (`PENDING`/`UNCERTAIN`/`NEEDS_REVIEW`/`COMPLETED`/`FAILED`). After `UNCERTAIN`: **observe, never resend**. |
| 7 | `AGENT_EXECUTE=true npm run execute-demo` (after dry proof + grant) | Live micro swap NEAR→USDC: correlation id + state machine with bounded polling; `min_amount_out` from the preparation quote (1 % slippage). |

## File map

- `env.ts` — dotenv loads the repo-root `.env` (chmod 600, gitignored); `redact()` masks ALL secret patterns
  in every output; defaults: prod base URL, `AGENT_EXECUTE=false`, `DEMO_MAX_USD=3` (hard-capped).
- `client.ts` — Node-22-compatible raw-fetch REST wrapper (the SDK declares `engines: node>=24`; HTTP is
  plain JSON, 1:1 per `examples/09-raw-http`). JSON:API errors → `ApiError{code,layer,retryable}` —
  branch only on `code` (never title/detail); header values never leave the file.
- `lifecycle.ts` — state machine `PENDING/UNCERTAIN/NEEDS_REVIEW/COMPLETED(+FAILED)`, persistent
  idempotency store (`.state/operations.json`, 0600, gitignored), bounded retries **only with the identical
  key**, quota guard (100 agent admissions/24 h; 429/5xx retryable, custody-ops limit 1,000/24 h covered
  by 429 handling).
- `policy.ts` — owner policy builder: budget cap (USD), destinations whitelist `only` (only
  contract/payout addresses from `TREASURY_DESTINATIONS`), `timelock_ms`, assets NEAR/USDC only,
  `actions:["swap"]`, `native`/`confidential` off.
- `sign-policy.ts` — generate → **human signs** → submit → status. `owner-sign-helper.ts` is a
  signing TOOL that only the owner starts themselves (`--i-am-the-owner`); product code never imports it.
- `grant-prepare.ts` — grant credential (`ngt_…` via SDK, runs on Node 22) + `grant_issue` intent;
  token only in `.state/grants/` (0600) or `INTENTS_GRANT_TOKEN`, never on the console.
- `owner-sign-popup-server.ts` — local loopback server (127.0.0.1 only, open via `http://localhost:8789`,
  Safari WebAuthn needs the localhost rpId): `/register` (startRegistration via esm.sh @simplewebauthn/browser@13,
  server verifies challenge/origin and builds COSE→DER-SPKI) and `/sign?cid=…` (plain-text policy preview +
  startAuthentication with `intent.payload` byte-for-byte → `signed_data` 0600 into `.state/`). No API key,
  no secrets in the page; parsing via `vendor/simplewebauthn-helpers.bundle.mjs` (pinned 13.3.3, E2E tested).

## API contracts used (references)

`GET {base}/llms.txt` · `POST /v1/generate-intent` · `POST /v1/submit-intent` · `GET /v1/status` ·
`POST /v1/agents/{id}/swap` (`dry:true` without grant/idempotency key; live with `X-Grant-Token` +
`Idempotency-Key`) · `GET /v1/quotas` · `GET /v1/tokens`. Example chapters: 05-money-moves
(payments/idempotency), 08-errors-and-recovery (state machine), 09-raw-http (header parity).

## Environment setup (table)

| Variable | Required? | Meaning |
|---|---|---|
| `INTENTS_API_KEY` | yes | `naa_…` partner key — ONLY `.env`/process environment, never repo/log/commit. |
| `INTENTS_BASE_URL` | no | Default **prod** `https://api.agentsonintents.com`; demo deploy `https://api.demo.agentsonintents.com` only after team approval. |
| `OWNER_ACCOUNT_MAINNET` / `OWNER_PUBLIC_KEY` | near-owner path only | The human's **mainnet** NEAR account + `ed25519:…` signing key (API network: mainnet!). `OWNER_ACCOUNT` (.testnet) belongs to the deploy scripts — off-limits for Intents. The passkey path needs neither (`.state/passkey.json`). |
| `AGENT_EXECUTE` | no | Default `false` ⇒ `dry:true` only. `true` only after the dry proof (RULES.md). |
| `DEMO_MAX_USD` / `DEMO_AMOUNT_USD` | no | Cap (hard ≤ 3) / micro amount (default 0.25 $). |
| `TREASURY_DESTINATIONS` | no | Comma list of whitelist entries (`near:acct`, `intents:acct`, `chain:addr`). |
| `INTENTS_GRANT_TOKEN` | for execute | `ngt_…` from the `grant:prepare` store. |
| `INTENTS_TIMELOCK_MS` | no | Policy timelock, default 60,000 ms. |

## Admission budget (quota discipline)

**Admission budget: never regenerate the agent within a demo run, reuse the grant.** Every `generate-intent`
agent creation counts as an agent admission (100/24 h; demo-deploy baseline 2026-11-05 21:20: 5/100 used,
95 remaining — see EVIDENCE_LOG) and is NOT refundable. Within one demo round therefore: create the agent
exactly ONCE (`policy:create` once), then run all actions through the same `agent_id` + reused grant
(`grant:prepare`, token in `.state/grants/`). Never call `policy:create` in loops/automation —
the on-chain key precheck slows things down but does not replace this rule.

## Security — non-negotiables (RULES.md §Security)

1. **Secrets:** `.env` (chmod 600, gitignored) holds `INTENTS_API_KEY`, `ONECLICK_JWT` and others — this
   code reads them only for headers; every console/log output passes through `redact()`. No secrets in
   commits, logs or error messages.
2. **No auto-signing:** owner signatures (agent_create, policy_update, grant_issue, approvals) are produced
   exclusively by the human in their wallet or via the explicitly self-started signing tool.
3. **dry:true first:** execution is impossible in code without `AGENT_EXECUTE=true`; every quote first
   dry, then check cap/warnings, then (after approval) live — idempotency key persisted stably per
   operation, UNCERTAIN is observed, never duplicated.
4. **Identity separation:** owner ≠ treasury ≠ contract ≠ swarms (RULES.md) — the treasury signs only
   swaps within its policy; payouts are authorized by the escrow contract.
