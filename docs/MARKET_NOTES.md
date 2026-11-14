# MARKET_NOTES — NEAR Agent Market (market.near.ai) API exploration, real
Exploration run: 2026-11-06 · asset-scout · all calls read-only or auth-gate probe
Tokens: no `aat_` token present (`.env MARKET_AGENT_TOKEN` empty) ⇒ auth gates documented as 401.
**Registration (POST /v1/agents/register) was NOT executed** — needs a USER decision
(handle assignment + account linkage); as evidence only the validation response to an empty body (422).

## Source & basis
- API base: `https://market.near.ai` — OpenAPI: `/openapi.json` (agents-market API v2.0.0, 107 paths), Swagger: `/docs/`
- MCP (for worker tools): `.env MARKET_MCP=https://market.near.ai/mcp`
- Auth: `Authorization: Bearer aat_REDACTED` (agent token, `aat_…` from the market.near.ai dashboard; `.env MARKET_AGENT_TOKEN`)
- Buyer paths (post jobs/accept bids) run via account session; agent paths (bid, submit) via `aat_` token.

## The four call groups (real examples, 2026-11-06)

### 1. Discovery — `GET /v1/agents` ⇒ HTTP 200 (public, no token)
```
GET https://market.near.ai/v1/agents?limit=5&sort=rating
Accept: application/json
```
Response (excerpt, 14.242 B total):
```json
{"agents":[{"agent_id":"30ba50df-5509-452f-b936-8211e516979f",
  "handle":"web-research","name":"Web Research","category":"research",
  "delivered_jobs":47,"success_rate":70,"listing_status":"live",
  "payable_with":["USDC"],"runtime":"http","availability":"available", ...}]}
```
Parameters: `q, category, sort, verification, proven, limit, offset`.

### 2. Listing — `GET /v1/agents/{id_or_handle}` + `GET /v1/agents/{agent_id}/pricing-plans` ⇒ HTTP 200 (public)
```
GET https://market.near.ai/v1/agents/web-research        → 200 (agent detail, handle resolution OK)
GET https://market.near.ai/v1/agents/30ba50df-5509-452f-b936-8211e516979f/pricing-plans → 200
```
Response pricing-plans (excerpt):
```json
[{"pricing_plan_id":"003adf80-75fc-4259-8c7e-5394af1c8dc6",
  "agent_id":"30ba50df-…","model":"per_call","display_name":"Default",
  "price_amount":"0.5000", …}]
```
Prices of the 5 discovery hits: web-research 0.50 · codecitationdrift 0.01 · shoplet 0.10 · ai-gen-text-detector 0.25 · wallet-activity-lookup 0.50 (USD per_call).

### 3. Register — `POST /v1/agents/register` ⇒ 422 (empty body; NO registration executed)
```
POST https://market.near.ai/v1/agents/register
Content-Type: application/json
{}
→ HTTP 422 Failed to deserialize the JSON body: missing field `handle` at line 1 column 2
```
Schema (OpenAPI RegisterRequest): `required: handle, name, category`; handle = DNS label
(3–30 chars, `[a-z][a-z0-9-]*`), optional `email`, `sla_seconds`.
**USER decision needed:** handle (e.g. `foreman-foreman` vs. team branding), email, owner account.
Recommendation: registration via the dashboard by the human, then token into `.env MARKET_AGENT_TOKEN`.

### 4. Order — bidding/hiring ⇒ auth gate measured for real
```
POST /v1/jobs/00000000-0000-0000-0000-000000000000/bids   → HTTP 401 {"error":"unauthorized"}
GET  /v1/jobs/board                                        → HTTP 401 {"error":"unauthorized"} (board is auth-gated but returns a public set)
GET  /v1/hire-draft                                        → HTTP 404 hire_draft_not_found (session-scoped draft does not exist)
```
Order flow per OpenAPI (for our bidding round):
1. `POST /v1/agents/{agent_id}/hire-draft` (buyer brief: `required: brief`, `acceptanceWindowDays` 3–7) → draft
2. Buyer confirms draft (`GET /v1/hire-draft` as buyer) → job is created, escrow via wallet/Intents
3. Worker side (our case with `aat_`): `POST /v1/jobs/{id}/bids` —
   PlaceBidRequest: `required: amount (String, e.g. "25.00"), proposal`; `agentId` is omitted for an aat_ caller (the bidder comes from the token!)
4. `POST /v1/assignments/{id}/start` → `POST /v1/assignments/{id}/submit` (deliverable) → buyer `POST /v1/assignments/{id}/review`

## The 5 most real listings (proof of "real foreign agents", as of 06.11. 11:40 CET)
| Handle | Name | Category | Price (USD/call) | Asset | delivered | success | Runtime |
|---|---|---|---|---|---|---|---|
| web-research | Web Research | research | 0.50 | USDC | 47 | 70% | http |
| codecitationdrift | Code Citation Drift Checker | legal_compliance | 0.01 | USDC | 28 | 97% | http |
| shoplet | Shoplet | research | 0.10 | USDC | 24 | 77% | managed |
| ai-gen-text-detector | AI Gen Text Detector | creative | 0.25 | USDC | 22 | 92% | managed |
| wallet-activity-lookup | NEAR Wallet Activity Lookup | finance | 0.50 | USDC | 20 | 83% | managed |

Demo story pick: **wallet-activity-lookup** (finance, USDC, a real NEAR topic — "a foreign agent delivers an on-chain analysis for our job").

## Consequences for foreman
- Discovery/listings: usable without a token → `market_client.py` can show real demo listings without registration (screenshot proof).
- Bid/order: `aat_` token mandatory → registration = USER click (dashboard market.near.ai), then enter into `.env`. **Not blindly registered.**
- Bid amounts are USD strings ("25.00"), not yocto — our escrow budget must be denominated in USD cents (intents-engineer/lead: DEMO_MAX_USD fits).
- Mock mode in the client mirrors exactly these 5 real listings (identical contract, e2e runs without network/token).

## Buyer payment — facts from OpenAPI mkt.json v2.0.0 (intents-engineer, 07.11., read-only)

**Wallet system (buyer side):** `GET /v1/wallet/balance` → three payment rails:
`fiat` (USD, via Stripe connection), `crypto` (USDC, custody provider **OutLayer** via
`CryptoWalletService::ensure_wallet_and_balance`) and `credit_remaining` ("Allowance left to spend
on hires, beside the rails… Drawn in USDC" — ledger rail triple fiat|crypto|**credits**).
Detail-page quote: "Balances a hire can be paid from, at one price: USDC, plus USD once the
builder connected Stripe."

**When money flows:** on the buy call itself. Competition: "Humans only: the call spends" +
503 "No USDC rail here, or the pool was not funded"; "The whole prize pool, debited into escrow
at once". Hiring: `GET /v1/me/job-drafts/{draft_id}/hire` → `DraftHireResponse{jobId,
assignmentId, funded}` with funded=false "while the escrow is still being funded" — the job is
created, but the escrow deposit is a separate (asynchronous) step from the rails. Assignment:
`Assignment{escrowAmount, escrowToken=USDC, slaSeconds, slaDeadlineAt, acceptanceWindowDays}`.
Cancellation: "a row reads cancelled… whether or not its escrow made it home" — the refund is
separately provable (`cancelled_assignment_ids`).

**Deposit into the crypto rail:** `GET /v1/wallet/crypto/deposit-intents` (GET only — creation
apparently in the webapp flow) → `DepositIntentItem{chain, depositAddress, sourceAssetId,
amountInMinor (source asset!), amountOutMinor (USDC minor units locked at quote time), status,
expiresAt}`. The deposit address accepts a source asset of any chain; the USDC amount is fixed at
quote time; a `DepositChecker` worker finalizes. No POST endpoint in the spec ⇒
intent creation needs the webapp/session.

**Order payment fields:** `Job{budgetAmount ("100.000000000000"), budgetToken, jobKind
standard|instant|competition, isTestRun, origin(a2a|null), acceptanceWindowDays 3–7,
requiresVerifiable}`; competition `poolToken`: "USDC, the default and the only token a prize pool
is held in".

**Dry-run/sandbox:** NO for orders. `sandbox`/`dry_run`/`simulat`: 0 hits in the spec.
`isTestRun` exists only in the job RESPONSE schema ("A free run by the owner or an allowed admin:
no bid, nothing held") — in NO request settable field ⇒ no buyer dry-run.
`/v1/agents/{id}/webhook/test` is worker-side, not buyer-side.
Spec gap: `POST /v1/jobs/instant` is referenced in claim text ("takes it as draftId")
but missing from the 107 paths (probably webapp-internal).

**Consequence for the HERO shot:** a 0.25–0.50 USDC foreign hire requires market-wallet funding (USDC rail)
or credit_remaining>0 (the amount only visible after owning a token via /v1/wallet/balance).
Small funding path: portal registration (USER click) → fetch deposit-intent quote →
send the smallest accepted source asset to depositAddress → USDC rail → instant hire.

## Cost framing (honest, S4 — supersedes any "N× cheaper" copy)

The demo job and the market quote are **not like-for-like**; never publish a multiplier.

- **Foreman demo job (job 50):** a cent-scale *testnet* latency computation. Budget 900 NEAR-cent,
  worker payout 810 NEAR-cent (~0.81 testnet NEAR), 10 % fee. Testnet money, not USD.
- **Market quote:** `web-research` at 0.50 USD `per_call` — a *different* task (web research) on a
  mainnet USDC rail.

Comparing a testnet cent-job to a 0.50 USD mainnet per_call quote mixes task, rail and network.
The honest statement is the two raw numbers side by side, each with its scope, labelled
"not like-for-like". A true like-for-like benchmark would require quoting the *identical* task on
both venues; the market's fixed listings do not accept arbitrary tasks, so it is not feasible
zero-cost. **Rule for all public copy:** raw numbers + explicit scope; no "× cheaper", no implied
savings.