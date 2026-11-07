# MARKET_NOTES — NEAR Agent Market (market.near.ai) API-Erkundung, real
Erkundungslauf: 2026-11-06 · asset-scout · alle Calls read-only bzw. Auth-Gate-Probe
Tokens: kein `aat_`-Token vorhanden (`.env MARKET_AGENT_TOKEN` leer) ⇒ Auth-Gates als 401 dokumentiert.
**Registrierung (POST /v1/agents/register) wurde NICHT ausgeführt** — braucht USER-Entscheidung
(Handle-Vergabe + Account-Bezug); als Beweismittel nur die Validierungs-Antwort auf leeren Body (422).

## Quelle & Basis
- API-Basis: `https://market.near.ai` — OpenAPI: `/openapi.json` (agents-market API v2.0.0, 107 Pfade), Swagger: `/docs/`
- MCP (für Worker-Tools): `.env MARKET_MCP=https://market.near.ai/mcp`
- Auth: `Authorization: Bearer aat_REDACTED` (Agent-Token, `aat_…` aus market.near.ai-Dashboard; `.env MARKET_AGENT_TOKEN`)
- Buyer-Pfade (Jobs posten/bids annehmen) laufen über Account-Session; Agent-Pfade (bidnen, submit) über `aat_`-Token.

## Die vier Call-Gruppen (echte Beispiele, 2026-11-06)

### 1. Discovery — `GET /v1/agents` ⇒ HTTP 200 (public, ohne Token)
```
GET https://market.near.ai/v1/agents?limit=5&sort=rating
Accept: application/json
```
Response (Auszug, 14.242 B gesamt):
```json
{"agents":[{"agent_id":"30ba50df-5509-452f-b936-8211e516979f",
  "handle":"web-research","name":"Web Research","category":"research",
  "delivered_jobs":47,"success_rate":70,"listing_status":"live",
  "payable_with":["USDC"],"runtime":"http","availability":"available", ...}]}
```
Parameter: `q, category, sort, verification, proven, limit, offset`.

### 2. Listing — `GET /v1/agents/{id_or_handle}` + `GET /v1/agents/{agent_id}/pricing-plans` ⇒ HTTP 200 (public)
```
GET https://market.near.ai/v1/agents/web-research        → 200 (Agent-Detail, handle-Auflösung OK)
GET https://market.near.ai/v1/agents/30ba50df-5509-452f-b936-8211e516979f/pricing-plans → 200
```
Response pricing-plans (Auszug):
```json
[{"pricing_plan_id":"003adf80-75fc-4259-8c7e-5394af1c8dc6",
  "agent_id":"30ba50df-…","model":"per_call","display_name":"Default",
  "price_amount":"0.5000", …}]
```
Preise der 5 Discovery-Treffer: web-research 0.50 · codecitationdrift 0.01 · shoplet 0.10 · ai-gen-text-detector 0.25 · wallet-activity-lookup 0.50 (USD per_call).

### 3. Register — `POST /v1/agents/register` ⇒ 422 (leerer Body; KEINE Registrierung ausgeführt)
```
POST https://market.near.ai/v1/agents/register
Content-Type: application/json
{}
→ HTTP 422 Failed to deserialize the JSON body: missing field `handle` at line 1 column 2
```
Schema (OpenAPI RegisterRequest): `required: handle, name, category`; handle = DNS-Label
(3–30 Zeichen, `[a-z][a-z0-9-]*`), optional `email`, `sla_seconds`.
**USER-Entscheidung nötig:** Handle (z. B. `foreman-foreman` vs. Team-Branding), Email, Owner-Account.
Empfehlung: Registrierung über Dashboard durch den Menschen, danach Token in `.env MARKET_AGENT_TOKEN`.

### 4. Order — Bieten/Beauftragen ⇒ Auth-Gate real gemessen
```
POST /v1/jobs/00000000-0000-0000-0000-000000000000/bids   → HTTP 401 {"error":"unauthorized"}
GET  /v1/jobs/board                                        → HTTP 401 {"error":"unauthorized"} (board ist auth-gated, liefert aber öffentlichen Satz)
GET  /v1/hire-draft                                        → HTTP 404 hire_draft_not_found (session-scoped Draft existiert nicht)
```
Order-Flow laut OpenAPI (für unsere Bid-Runde):
1. `POST /v1/agents/{agent_id}/hire-draft` (Buyer-Brief: `required: brief`, `acceptanceWindowDays` 3–7) → Draft
2. Buyer bestätigt Draft (`GET /v1/hire-draft` als Buyer) → Job entsteht, Escrow via Wallet/Intents
3. Worker-Seite (unser Fall mit `aat_`): `POST /v1/jobs/{id}/bids` —
   PlaceBidRequest: `required: amount (String, z. B. "25.00"), proposal`; `agentId` entfällt bei aat_-Caller (Bidder kommt aus dem Token!)
4. `POST /v1/assignments/{id}/start` → `POST /v1/assignments/{id}/submit` (Deliverable) → Buyer `POST /v1/assignments/{id}/review`

## Die 5 realsten Listings (Beweis „echte fremde Agenten", Stand 06.11. 11:40 MEZ)
| Handle | Name | Kategorie | Preis (USD/call) | Asset | delivered | success | Runtime |
|---|---|---|---|---|---|---|---|
| web-research | Web Research | research | 0.50 | USDC | 47 | 70 % | http |
| codecitationdrift | Code Citation Drift Checker | legal_compliance | 0.01 | USDC | 28 | 97 % | http |
| shoplet | Shoplet | research | 0.10 | USDC | 24 | 77 % | managed |
| ai-gen-text-detector | AI Gen Text Detector | creative | 0.25 | USDC | 22 | 92 % | managed |
| wallet-activity-lookup | NEAR Wallet Activity Lookup | finance | 0.50 | USDC | 20 | 83 % | managed |

Demo-Story-Pick: **wallet-activity-lookup** (finance, USDC, echtes NEAR-Thema — „fremder Agent liefert Onchain-Analyse für unseren Job").

## Konsequenzen für foreman
- Discovery/Listings: ohne Token nutzbar → `market_client.py` kann echte Demo-Listings ohne Registrierung zeigen (Screenshot-Beweis).
- Bid/Order: `aat_`-Token Pflicht → Registrierung = USER-Klick (Dashboard market.near.ai), danach in `.env` eintragen. **Nicht blind registriert.**
- Bid-Beträge sind USD-Strings ("25.00"), nicht yocto — unser Escrow-Budget muss auf USD-Cent gemünzt werden (intents-engineer/lead: DEMO_MAX_USD passt).
- Mock-Mode im Client spiegelt exakt diese 5 echten Listings (Vertrag identisch, e2e läuft ohne Netz/Token).

## Käufer-Bezahlung — Fakten aus OpenAPI mkt.json v2.0.0 (intents-engineer, 07.11., read-only)

**Wallet-System (Käuferseite):** `GET /v1/wallet/balance` → drei Zahlungs-Schienen:
`fiat` (USD, via Stripe-Verbindung), `crypto` (USDC, Custody-Provider **OutLayer** via
`CryptoWalletService::ensure_wallet_and_balance`) und `credit_remaining` ("Allowance left to spend
on hires, beside the rails… Drawn in USDC" — Ledger-Schienen-Triple fiat|crypto|**credits**).
Zitat Detailseite: „Balances a hire can be paid from, at one price: USDC, plus USD once the
builder connected Stripe."

**Wann fließt Geld:** beim Kauf-Aufruf selbst. Competition: „Humans only: the call spends" +
503 „No USDC rail here, or the pool was not funded"; „The whole prize pool, debited into escrow
at once". Hiring: `GET /v1/me/job-drafts/{draft_id}/hire` → `DraftHireResponse{jobId,
assignmentId, funded}` mit funded=false „while the escrow is still being funded" — Job entsteht
also, aber Escrow-Einzahlung ist ein separater (asynchroner) Schritt aus den Rails. Zuweisung:
`Assignment{escrowAmount, escrowToken=USDC, slaSeconds, slaDeadlineAt, acceptanceWindowDays}`.
Storno: „a row reads cancelled… whether or not its escrow made it home" — Rückerstattung ist
separat nachweisbar (`cancelled_assignment_ids`).

**Einzahlung in die Crypto-Rail:** `GET /v1/wallet/crypto/deposit-intents` (nur GET — Anlage
offenbar im Webapp-Flow) → `DepositIntentItem{chain, depositAddress, sourceAssetId,
amountInMinor (Quell-Asset!), amountOutMinor (USDC minor units locked at quote time), status,
expiresAt}`. Deposit-Adresse akzeptiert ein Quell-Asset beliebiger chain; USDC-Menge wird zum
Quote-Zeitpunkt fixiert; `DepositChecker`-Worker finalisiert. Kein POST-Endpoint im Spec ⇒
Intent-Erzeugung braucht die Webapp/Session.

**Order-Payment-Felder:** `Job{budgetAmount ("100.000000000000"), budgetToken, jobKind
standard|instant|competition, isTestRun, origin(a2a|null), acceptanceWindowDays 3–7,
requiresVerifiable}`; Competition `poolToken`: „USDC, the default and the only token a prize pool
is held in".

**Dry-Run/Sandbox:** NEIN für Orders. `sandbox`/`dry_run`/`simulat`: 0 Treffer im Spec.
`isTestRun` existiert nur im Job-RESPONSE-Schema („A free run by the owner or an allowed admin:
no bid, nothing held") — in KEINEM Request-Setzfeld ⇒ kein Käufer-Dry-Run.
`/v1/agents/{id}/webhook/test` ist Worker-seitig, nicht Käufer-seitig.
Spec-Lücke: `POST /v1/jobs/instant` wird im claim-Text referenziert („takes it as draftId"),
fehlt aber in den 107 Pfaden (vermutlich Webapp-intern).

**Konsequenz HERO-Shot:** 0.25–0.50-USDC-Fremd-Hire erfordert Marktwallet-Funding (USDC-Rail)
oder credit_remaining>0 (Höhe erst nach Token-Besitz via /v1/wallet/balance sichtbar).
Kleiner Funding-Pfad: Portal-Registrierung (USER-Klick) → deposit-intent-Quote abholen →
kleinstes akzeptiertes Quell-Asset an depositAddress senden → USDC-Rail → instant hire.
