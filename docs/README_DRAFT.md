# Foreman — General-Contractor-Agent auf NEAR
<!-- README_DRAFT — Zielzustand für Submission (11.11. Freeze). Statusspalten: jede Zeile muss beim Freeze ✅+Artefakt in docs/EVIDENCE_LOG.md sein oder wird GELÖSCHT. Keine Marketingsprache. Kein API-Key jemals im Repo. -->

**One-Liner:** Ein Agent mit Budget zerlegt deine Aufgabe, holt Angebote von autonomen Schwärmen und Dritt-Agenten, verhandelt eine Gegenofferte, beauftragt, prüft — und zahlt erst nach Abnahme über On-Chain-Escrow auf NEAR.

**Tracks:** `swarms` (lead) · `agents` · `business` · `open` — Belegung je Track: `swarms` = Coordinator-Contract + Biet-Runden + Sub-Accounts je Agent (siehe RULES.md §Bieten/Zuschlag, Replay unten Schritt 5); `agents` = Einkaufen/Hiring über market.near.ai + Intents Agent API Policy-Treasury (Schritt 4+5); `business` = Budget, Foreman-Fee 10 %, Escrow-Zustandsmaschine inkl. Refund-Pfad (RULES.md §Geld); `open` = Ephemora-Execution-Receipts als On-Chain-Arbeitsnachweis (Schritt 5, Panel 4).

## Problem
Autonome KI-Agenten können heute weder verlässlich Arbeit einkaufen noch verkaufen: Es gibt keine durchsetzbare Geldführung zwischen Agenten — wer zahlt, bevor Lieferung und Qualität bewiesen sind, und wer belegt, was im eigenen Namen geschah? Bestehende Agent-Beispiele (Task-Zerlegung + Payment) haben einen Käufer ohne Markt: Es fehlt die Wettbewerbsseite (Bieten), der Zahlungsschutz (Escrow mit Abnahmegate) und der Ausführungsnachweis (Receipt).

## Der eine Demo-Moment (< 60 s, Maßstab: docs/SEQUENCE.md)
Aufgabe + Budget rein → Job-Event an 5 Supernova-Schwärme (je Sub-Account + FC-Key) + 1 Dritt-Angebot vom NEAR Agent Market → Foreman platziert GENAU EINE begründete Gegenofferte → score-validierter Zuschlag → Gewinner arbeitet in Ephemora-Cell (fuel/mem/egress-Caps) → signiertes Execution-Receipt on-chain verankert → Owner-Abnahme → Payout über Intents-Treasury (Policy-Whitelist, Cent-Beträge) → Reputation-Update. Ende-zu-Ende in einer Browser-Seite (Bietboard, 5 Panels).

## PREREQUISITES
| Komponente | Version | Prüfen mit | Hinweis |
|---|---|---|---|
| Node.js | ≥ 20 | `node -v` | tsx läuft über `npx tsx` (dev-Dep im Repo) |
| Python | ≥ 3.11 | `python3 -V` | `core/foreman_core` (Foreman-Agent, ephe-Host) |
| rustup + stable | 1.8x | `rustup show` | ⚠️ rustup-Shims müssen VOR Homebrew-cargo im PATH stehen: `export PATH="$HOME/.cargo/bin:$PATH"` |
| wasm32-unknown-unknown | — | `rustup target list --installed` | Contract-Build |
| cargo-near | 0.22.0 | `cargo near --version` | Contract-Build/Deploy |
| near-cli | 4.0.13 | `near --version` | Konto-/State-Operationen |
| Secrets | — | `cp .env.example .env` und ausfüllen | `INTENTS_API_KEY` (partners.near-intents.org), `NEAR_AI_API_KEY` (cloud.near.ai; 10 $ via nearbuilders.org/join), `MARKET_AGENT_TOKEN` (market.near.ai). NIE ins Repo, NIE ins Log. |
| Testnet-Konten | 8 | Schritt 1 unten | Parent: `foreman-team.testnet`; Identitätstrennung Owner/Treasury/Contract/Swarms gemäß RULES.md §Sicherheit |

## Reproduzierbarkeit — "do X → see Y"
Jede Zeile ist 1:1 ausführbar. Status: ✅ = verifiziert in docs/EVIDENCE_LOG.md (mit Artefakt) · ⏳ = Build-Ziel bis Freeze, Zeile fliegt raus, falls nicht grün.

### 1 — Contract-Tests
| | |
|---|---|
| **Do** | `cd contracts/foreman && cargo test` |
| **See** | `test result: ok. {N_TESTS} passed; 0 failed; …` (Unit-Tests via near-sdk 5 `unit-testing`; decken: post_job→Bidding, Bid-Fenster 120 s, counter_offer max 1× + reason-Pflicht, award-Score-Matrix, attach_receipt-Pflicht vor submit_work, refund an Owner nur, rep-Update nur via accept/refund_expired) |
| **Fehlerbild** | `error: link command ... not found` oder `MockedBlockchain`-Compile-Fehler |
| **Fix** | rustup-Pfad prüfen (s. PREREQUISITES); dev-dependency `near-sdk = { features = ["unit-testing"] }` muss gesetzt sein (bereits in Cargo.toml) |
| **Status** | ⏳ (Tests geschrieben, Artefakt fehlt noch — EVIDENCE T1) |

### 1.5 — Contract-Deploy per cargo-near (Phase-1.5, Konten aus Schritt 2 vorausgesetzt)
| | |
|---|---|
| **Do** | `cd contracts/foreman && cargo near deploy testnet --id escrow.foreman-team.testnet --key-path ~/.near-credentials/testnet/escrow.foreman-team.testnet.json` (baut wasm selbst, cargo-near 0.22.0) |
| **See** | `Deploy done` + `near state escrow.foreman-team.testnet --networkId testnet | grep code_hash` → `"code_hash": "<64-stellig>"` auf **escrow.foreman-team.testnet** |
| **Fehlerbild** | `key not found` / `wasm preparation failed` |
| **Fix** | Schritt 2 (Kaltstart) erneut laufen lassen (idempotent); Build-Target wasm32 + Profile opt-level-z laut Cargo.toml prüfen |
| **Status** | ⏳ (T1.5-Gate vor Voll-Demo) |

### 2 — Kaltstart: 8 Testnet-Konten
| | |
|---|---|
| **Do** | `bash ops/setup-testnet-accounts.sh` (idempotent, mehrfach ausführbar) |
| **See** | 8 Zeilen `exists: …` bzw. Anlage-Logs für `escrow|treasury|boss|agent1..5.foreman-team.testnet`; danach liefert `for a in escrow treasury boss agent1 agent2 agent3 agent4 agent5; do near state "$a.foreman-team.testnet" --networkId testnet | grep -c account_id; done` achtmal `1`; Credentials landen in `~/.near-credentials/testnet/` |
| **Fehlerbild** | `near: command not found` / Faucet-Fehler `transaction failed` |
| **Fix** | `npm i -g near-cli@4`; Faucet-Rate-Limit: 60 s warten, Skript erneut starten (idempotent); Testnet-NEAR gratis via near-cli-Faucet (Q-008) |
| **Status** | ⏳ |

### 3 — Contract-Deploy (testnet)
| | |
|---|---|
| **Do** | `bash scripts/deploy-testnet.sh` (legt `foreman.foreman-team.testnet` an, deployed `contracts/foreman/target/wasm32-unknown-unknown/release/foreman.wasm`, init mit treasury-Account) |
| **See** | `Deploying foreman.foreman-team.testnet … Done` + danach `near state foreman.foreman-team.testnet --networkId testnet | grep code_hash` → `"code_hash": "<64-stellig>"` (nicht null); `near view … get_rep '{"account":"agent1.foreman-team.testnet"}'` → `50` (Start-Reputation RULES.md) |
| **Fehlerbild** | `wasm error … preparation failed` / `AccountAlreadyExists` |
| **Fix** | wasm mit cargo-near 0.22.0 + opt-level z neu bauen (`cargo near build`); Account-Kollision: `CONTRACT_ACCOUNT` in .env ändern |
| **Status** | ⏳ |

### 4 — Intents dry:true-Quote (Zahlungsbeweis, nichts fließt)
| | |
|---|---|
| **Do** | `npx tsx core/intents/cli.ts quote --dry true --sell NEAR --buy USDC --amount 0.10` (Policy-Treasury der Intents Agent API; Whitelist = nur Contract-/Payout-Adressen) |
| **See** | JSON mit `{"quote_id": "<uuid>", "status": "quoted" (bzw. "dry_run"), "receive_amount": …}`; kein Execute-Aufruf; Eintrag in docs/EVIDENCE_LOG.md (Datum, Quote-ID) |
| **Fehlerbild** | `401 unauthorized` / `policy violation: destination not whitelisted` |
| **Fix** | `INTENTS_API_KEY` in .env prüfen (Partner-Dashboard); Zieladresse in Treasury-Whitelist eintragen; Testnet gibt es für Intents nicht (Q-007) — für Execute-Tests separates Dev-Konto + Cent-Beträge, `AGENT_EXECUTE=true` nur manuell |
| **Status** | ⏳ (CLI-Modul T2) |

### 5 — Voll-Demo (der eine Moment)
| | |
|---|---|
| **Do** | `npx tsx core/foreman_core/demo_run.ts "Fasse 3 NEAR-Testnet-Quellen zu 5 Bullets zusammen" --budget 3` (Startet: Bietboard im Browser + Job + Schwarm-Bieter + Dritt-Angebot) |
| **See** | Countdown 120 s → 6 Bids (5× `agent{n}.foreman-team.testnet`, 1× Dritt-Agent via market.near.ai) → Gegenofferte-Karte mit `reason` → Zuschlag → Receipt-Panel zeigt `cell_signature` + `artifact_hash` (verifizierbar via `near view … get_job`) → `accept` → Payout-Tx (Explorer-Link, Cent) + `rep[gewinner] > 50` → Endpreis-Karte mit **{cost_per_deliverable}** |
| **Fehlerbild** | nur 5 Bids (Dritter fehlt) / Cell-Timeout / `INSUFFICIENT_ALLOWANCE` |
| **Fix** | Agent-Market-Token + Listing prüfen (Vorabend-Checkliste); `EPHEMORA_VERSION_PIN` gesetzt lassen; FC-Key-Allowance der Schwarm-Konten = nur Contract-Methoden (RULES.md: Policy im Contract, nie im Key) |
| **Status** | ⏳ (T5-Gate: 2× in Folge, Beweise in EVIDENCE_LOG) |

## Contract-API (v1-minimal, Quelle: docs/SEQUENCE.md)
`new(treasury) · post_job · place_bid · counter_offer · award · attach_receipt · submit_work · accept · release_payout · refund_expired · get_job · get_bids · get_rep`

## Baseline & Lizenzen (Q-002 / Q-005 / Q-003)
| Asset | Rolle im Projekt | Lizenz | Baseline-Status (pre-Hackathon-Fenster 19.10.–14.11.2026) |
|---|---|---|---|
| **ephe** (Agent-Host) | Foreman-Host (lokal) | BUSL-1.1 | **nur lokal demonstriert, nicht verteilt/deployed**; {EPHE_REPO}@{EPHE_TAG} / {EPHE_HASH} |
| **supernova** | Schwarm-Runtime der 5 Bieter | Apache-2.0 | Tag `pre-hackathon` (26.04.2026), verifiziert EVIDENCE T0; {SUP_TAG_HASH} |
| **ephemora-cell** | Sandbox-Ausführung + signierte Receipts | Apache-2.0 | **Produkt des Co-Founders**, von uns als Standard-Infra genutzt (auch in ephe); Tag `pre-hackathon` (30.08.2026); {EPH_TAG_HASH}; pip-installierbare Dependency des Receipt-Adapters (`core/receipts/`, Worker-Bau via package-eigenem Go→wasip1-Builder) |
| **kepta** | Reputation-Snapshots (`rep_snapshot_hash`) | MIT | Tag `pre-hackathon` (26.09.2026); {KEP_TAG_HASH} |
| dieses Repo | NEAR-Integration: Contract, Coordinator-Logik, Bietboard, Intents/Treasury-Anbindung, Agent-Market-Hiring | Apache-2.0 | judged wird **ausschließlich** die Fenster-Integration; `package.json` license-Feld = Apache-2.0 (korrigiert per docs-prep license fix) |

**Q-003 Diff-Referenz:** Baseline-Tags `pre-hackathon` + Finalstand `hackathon-submission` je Repo. Diff dieses Repos: `{BASELINE_SCAFFOLD_HASH}…{HACKATHON_SUBMISSION_HASH}` (`git log --oneline pre-hackathon..hackathon-submission` als Anhang im Evidence-Log).

## Sicherheit (Kurzform, vollständig in RULES.md)
Kein Full-Access-Key im Repo/Log/Produkt · getrennte Identitäten Owner≠Treasury≠Contract≠Swarm · FC-Keys allowance-limitiert, Policy im Contract · jede Quote erst `dry:true`, Execute nur manuell + Cent-Beträge (DEMO_MAX_USD=3) · Secrets nur `.env`.

## Submission-Protokoll (Maschinenlesbar für Coding-Agenten — Q-017-konform)
Felder: `requestId` (UUID, einmal generieren, bei Retry GLEICHEN), `projectName`, `leadName`, `email`, `size`, `tracks: ["swarms","agents","business","open"]`, `nearAddress` (Payout, mainnet, vom Menschen), `projectUrl` (öffentliches Repo), `demoUrl` (X-Post), `idea` (< 2000 Zeichen, Langfassung in docs/X_POST_DRAFT.md), `consent: true`.
**NO-GOs:** `website`-Feld = Spam-Trap, zwingend leer · kein `idea` ohne Menschen-Freigabe · kein Double-Submit (409 → `request-changes`-Seite) · Repo vor 14.11.23:59 UTC public.

## Weiterführende Dokumente
- [RULES.md](../RULES.md) — verbindliche Wirtschaftsregeln (Rollen, Bieten, Zuschlag, Escrow, Reputation, Sicherheit)
- [docs/SEQUENCE.md](SEQUENCE.md) — Sequenzdiagramm des Demo-Moments + Contract-API + UI-Sichten
- [docs/EVIDENCE_LOG.md](EVIDENCE_LOG.md) — jede Behauptung mit Artefakt (Zahlen ohne Beweis existieren nicht)
- Judge-/Sättigungs-Analyse des Teams (nicht im Repo): `near-hackathon/analysis/02_JUDGE_SATURATION.md`
