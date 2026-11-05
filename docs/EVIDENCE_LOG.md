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
| 2026-11-05 | phase1 | FLAG für Lead/USER: accept() ist nur Foreman erlaubt, RULES.md §Abnahme sagt "nur durch Owner/Foreman"; Payout 90/10 = 100 % des Budgets, RULES "Rest bleibt Reserve" hat 0 % Reserve — beides bewusst nicht still geändert | lib.rs accept()/ FOREMAN_FEE_NUM vs. RULES.md; Entscheidung braucht USER (RULES-Änderung nur per PR) | ⚠️ offen |
| — | T2 | Intents Quote→Execute Zyklus | Quote-IDs + dry:true-Log + Execute-Tx | ⬜ |
| — | T3 | 5 Bids < 30 s | Board-Screenshot + Bid-Tx-IDs | ⬜ |
| — | T4 | Receipt on-chain verifizierbar | Explorer-Link + Cell-Signatur-Check | ⬜ |
| — | T5 | Voll-Demo 2× in Folge | Screenshots + Logs Läufe 1+2 | ⬜ |
| — | T6 | Kalttest ≤10 Min | qa-coldtest-Protokoll | ⬜ |
| — | T7 | Hosted Demo extern erreichbar | URL + externer Test | ⬜ |
| — | T8 | Submission 201 | API-Antwort + requestId | ⬜ |
