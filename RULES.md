# RULES.md — Foreman-Wirtschaftsregeln (verbindlich VOR jedem Code-Commit)
Version 0.1 · 05.11.2026 · Änderungen nur per PR durch den USER.

## Rollen
- **Owner (Mensch):** postet Aufgabe + Budget, sieht alles, approvt Abnahme. Einzige Signatur-Instanz außerhalb des Contracts.
- **Foreman (Generalunternehmer-Agent, ephe-Host):** zerlegt Aufgabe, holt Angebote, verhandelt genau EINE begründete Gegenofferte, beauftragt, prüft, nimmt ab.
- **Swarms (Bieter, agent1..5.<org>.testnet):** Supernova-Schwärme mit eigenem Sub-Account + FC-Key.
- **Third-Party-Agenten:** unabhängige Agenten vom NEAR Agent Market (market.near.ai).
- **Escrow-Contract:** einzige Autorität über Geld, Bids, Receipts, Reputation.
- **Intents-Treasury:** EIN Konto über die Intents Agent API, Destinations-Whitelist = nur Contract-/Payout-Adressen des Contracts.

## Job
Felder: `id, spec (Text), acceptance_criteria[] , budget (YOCTO), deadline (Timestamp), created_by, state`.
Zustände: `Open → Bidding → Awarded → Delivered → Accepted | Refunded | Expired`.

## Bieten
1. Bid = `{job_id, bidder, price≤budget, eta_secs, rep_snapshot}` — vom Sub-Account-Key des Schwarms signiert (Contract prüft `env::predecessor_account_id`).
2. Bid-Fenster: 120 s ab post_job (Demo-Konstante, testbar).
3. Keine Bid-Änderung nach Ablauf des Fensters; neue Runde nur durch neuen Job (kein Orderbook, keine Komplexität).
4. Foreman darf GENAU EINE begründete Gegenofferte platzieren (`counter_offer` mit `reason`-Pflicht — Pflicht des offiziellen 07-Prompts; Grund muss sich auf acceptance_criteria beziehen).

## Zuschlag
Score = `price` (aufsteigend) · gleicher Preis: bessere Reputation · dann frühester Bid. `award(winner)` durch Foreman, vom Contract gegen Score-Matrix validiert.

## Arbeit & Receipt
1. Gewinner führt untrusted Worker-Code ausschließlich in der Ephemora-Cell aus (Caps: fuel/mem/egress, vorgepinnt).
2. Vor `submit_work` MUSS ein signierter Execution-Report (Receipt: fuel_used, mem_peak, egress_log_hash, artifact_hash, cell_signature) via `attach_receipt` verankert sein. Ohne Receipt kein submit_work.
3. `submit_work` liefert `artifact_hash` + Ergebnis-Referenz.

## Abnahme & Geld
1. `accept(job)` nur durch Owner/Foreman → `release_payout`: Escrow-Guthaben an Gewinner (payout-Anteil), Foreman-Fee an Foreman-Konto (Split in RULES: 10 %), Rest bleibt Reserve.
2. Kein Deliverable bis deadline → `refund` an Owner (automatisch nach deadline + 60 s durch beliebigen Aufrufer, Auszahlung geht NUR an Owner).
3. Keine Schiedsgerichts-Komplexität in v1: Unzufriedenheit = Frist-Refund-Pfad. (Ehrlichkeit > Feature.)
4. Mainnet-Geld fließt NALS Demo über das Intents-Treasury (Policy-whitelistet, Cent-Beträge, jede Quote erst `dry:true`).

## Reputation
`rep[bidder]` = gleitender Durchschnitt der Liefer-Scores (0–100), Start 50. Aktualisierung ausschließlich durch `accept` (Score aus Foreman-Abnahme) bzw. `refund_expired` (Score 0 für den Gewinner). Reputation ist on-chain, KEPTA-Snapshot-Hash des Schwarms wird mitgeführt (`rep_snapshot_hash`).

## Sicherheit (Non-Negotiable)
- FC-Keys der Swarm-Accounts: allowance-limitiert, nur Contract-Methoden; **Policy-Logik sitzt im Contract, nie im Key.**
- Kein Full-Access-Key im Repo, in Logs oder im Produkt. Secrets nur .env.
- Owner-Konto ≠ Treasury ≠ Contract ≠ Swarm-Accounts (getrennte Identitäten, im README dokumentiert).
- Jede Quote/Transaktion: Log in docs/EVIDENCE_LOG.md (Datum, Typ, ID, Artefakt-Link). Ohne Artefakt = nicht erledigt.

## Demo-Konstanten (T5-Gate-tauglich)
5 Schwärme, 1 Dritt-Angebot (Market), Bid-Fenster 120 s, 1 Gegenofferte, Budgets ≤ 3 $ Gegenwert, Beträge in NEAR/USDC-Cents.
