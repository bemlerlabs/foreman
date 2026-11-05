# EVIDENCE_LOG — jede Behauptung braucht ein Artefakt (OKC-Regel: Zahlen ohne Beweis existieren nicht)
Format: Datum | Phase | Behauptung | Artefakt (Tx-ID/Explorer/Pfad/Log) | Status

| Datum | Phase | Behauptung | Artefakt | Status |
|---|---|---|---|---|
| 2026-11-05 | T0 | Scaffold + RULES + Sequenz existieren vor Code | Commits cccb152 + SDK5-Migration | ✅ |
| 2026-11-05 | T0 | Repo privat unter bemlerlabs/foreman angelegt | https://github.com/bemlerlabs/foreman (PRIVATE verifiziert via gh) | ✅ |
| 2026-11-05 | T0 | Toolchain: cargo-near 0.22.0 + near-cli 4.0.13 + wasm32-unknown-unknown | Versionsausgaben (PATH-Notiz: rustup-Shims vor Homebrew) | ✅ |
| 2026-11-05 | T0 | Contract kompiliert zu wasm | target/wasm32-unknown-unknown/release/foreman.wasm (322.955 B) | ✅ |
| 2026-11-05 | T0 | Baselines getaggt (Q-003): supernova(04/26), kepta(09/26), ephemora(08/30) — alle pre-Fenster | git tag pre-hackathon, Commit-Daten verifiziert | ✅ (Push steht aus — USER-Freigabe) |
| — | T1 | Contract-Methoden testnet-fähig | Tx-IDs near-explorer | ⬜ |
| 2026-11-05 | phase1 | Unit-Tests grün: 44 tests, 0 failed (alle 11 Methoden + jede require!-Rejection) | `cargo test` → "test result: ok. 44 passed; 0 failed" (contracts/foreman, PATH=rustup-Shims) | ✅ |
| 2026-11-05 | phase1 | clippy strict grün | `cargo clippy --all-targets -- -D warnings` → Finished, Exit 0; `cargo fmt` gelaufen | ✅ |
| 2026-11-05 | phase1 | wasm-Build nach Härtung grün | target/wasm32-unknown-unknown/release/foreman.wasm (322.953 B, Release, LTO) | ✅ |
| 2026-11-05 | phase1 | opened_at ist echtes per-Job-Feld, Bid-Fenster job-scharf (T0-Hack existiert nicht mehr, jetzt testiert) | Test `bid_window_is_per_job_not_global_t0` (Job A Fenster zu, Job B offen) | ✅ |
| 2026-11-05 | phase1 | Gas-Disziplin: max_bids=20 hart limitiert | `const MAX_BIDS` + require "MAX_BIDS_REACHED"; Tests `place_bid_max_bids_enforced` (20 ok, 21. abgewiesen) | ✅ |
| 2026-11-05 | phase1 | Prüfreihenfolge attach_receipt spezifiziert: Winner-Check vor State-Check (bei winner=None greift ONLY_WINNER statt NOT_AWARDED) | Tests `attach_receipt_before_award_hits_only_winner_first` + `attach_receipt_not_awarded_after_accept` | ✅ |
| 2026-11-05 | phase1 | Deploy-Skript testnet (cargo-near 0.22, init new(owner,treasury,foreman), Accounts aus .env, Testnet-Guard) | scripts/deploy-testnet.sh (`bash -n` grün; echter Deploy läuft erst mit near-login-Credentials durch USER — T1-Zeile bleibt ⬜ bis Tx-ID existiert) | ✅ |
| 2026-11-05 | phase1 | FLAG für Lead/USER: accept() ist nur Foreman erlaubt, RULES.md §Abnahme sagt "nur durch Owner/Foreman"; Payout 90/10 = 100 % des Budgets, RULES "Rest bleibt Reserve" hat 0 % Reserve — beides bewusst nicht still geändert | lib.rs accept()/ FOREMAN_FEE_NUM vs. RULES.md; Entscheidung braucht USER (RULES-Änderung nur per PR) | ✅ erledigt (phase1.1: (a) gefixt per Lead-Entscheid, (b) 90/10 bleibt — RULES-Text wird per PR-Kommentar korrigiert) |
| 2026-11-05 | phase1.1 | accept() jetzt RULES-konform: Owner ODER Foreman; Dritter abgewiesen; Payout unverändert 90/10 | Commit "phase1.1: accept() owner-or-foreman per RULES-Konformitaet"; Tests `accept_by_owner_ok` + `accept_rejects_third_party` (ONLY_OWNER_OR_FOREMAN); `cargo test` → "45 passed; 0 failed"; clippy -D warnings Exit 0; foreman.wasm 323.036 B | ✅ |
| 2026-11-05 | phase1.1 | attach_receipt: Identitäts- vor State-Check verankert (Lead-Freigabe: "security: identity check precedes state check") | lib.rs attach_receipt Kommentar + Tests `attach_receipt_before_award_hits_only_winner_first` / `_not_awarded_after_accept` | ✅ |
| — | T2 | Intents Quote→Execute Zyklus | Quote-IDs + dry:true-Log + Execute-Tx | ⬜ |
| — | T3 | 5 Bids < 30 s | Board-Screenshot + Bid-Tx-IDs | ⬜ |
| — | T4 | Receipt on-chain verifizierbar | Explorer-Link + Cell-Signatur-Check | ⬜ |
| — | T5 | Voll-Demo 2× in Folge | Screenshots + Logs Läufe 1+2 | ⬜ |
| — | T6 | Kalttest ≤10 Min | qa-coldtest-Protokoll | ⬜ |
| — | T7 | Hosted Demo extern erreichbar | URL + externer Test | ⬜ |
| — | T8 | Submission 201 | API-Antwort + requestId | ⬜ |
| 2026-11-05 | phase3 | bidding-Adapter grün: 12/12 pytest (Bid-Range, Cap-Wurf, eta=Pakete×8s, Jitter, Replay-Determinismus) | core/bidding/tests/test_supernova_adapter.py · `23 passed in 0.04s` (23 = bidding+reputation, Runner supernova-venv Py3.12) | ✅ |
| 2026-11-05 | phase3 | reputation-Parität: 11/11 pytest, (old*9+score)//10 gegen Contract-Referenz + Handanker 50→55→49→44 | core/reputation/tests/test_kepta_hook.py · Commits 12d120c/96f5d6a | ✅ |
| 2026-11-05 | phase3 | Supernova real importierbar über Adapter (build_swarm_graph+TaskInput, SUPERNOVA_PATH=/Users/sanji/supernova) — T3-Real-Lauf nur noch Provider-Key-abhängig; Mock ist Demo-Fallback | stdout-Beleg + core/bidding/supernova_adapter.py::RealSupernovaEngine | ✅ |
| 2026-11-05 | T1 | Contract LIVE auf Testnet: escrow.foreman-team.testnet | cargo-near deploy grün; code_hash Ej3Yk3q8XJbbzGJFdfx2Ue5UoPkqjTQyWCu4WU81NZgZ; near state bestätigt | ✅ |
| 2026-11-05 | T1 | On-chain Identität: deployed == phase1.1-Build | sha256-base58(target/near/foreman.wasm)==code_hash — MATCH (Verifikation 14:52) | ✅ |
| 2026-11-05 | T1 | Live-View-Call funktioniert | near view get_rep(agent1.foreman-team.testnet) → 50 | ✅ |
| 2026-11-05 | T1 | Init-Schutz greift | Re-Init → "already been initialized"; Code-Update via without-init-call | ✅ |
