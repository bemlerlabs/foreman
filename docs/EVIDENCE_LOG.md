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
| — | T2 | Intents Quote→Execute Zyklus | Quote-IDs + dry:true-Log + Execute-Tx | ⬜ |
| — | T3 | 5 Bids < 30 s | Board-Screenshot + Bid-Tx-IDs | ⬜ |
| — | T4 | Receipt on-chain verifizierbar | Explorer-Link + Cell-Signatur-Check | ⬜ |
| — | T5 | Voll-Demo 2× in Folge | Screenshots + Logs Läufe 1+2 | ⬜ |
| — | T6 | Kalttest ≤10 Min | qa-coldtest-Protokoll | ⬜ |
| — | T7 | Hosted Demo extern erreichbar | URL + externer Test | ⬜ |
| — | T8 | Submission 201 | API-Antwort + requestId | ⬜ |
