# Foreman — video sketch T7 (target: 90–110 s, 1920×1080, 2 screenshots/videos per shot provable)

**Rule of the day:** every shot needs a reproducible artifact (terminal/tx/quote > aesthetics).
Speaking style: factual, numbers instead of adjectives. No AI-slop pathos. Subtitle track German, on-screen English.

| # | Time | Shot | Source / recording | Proof artifact in frame |
|---|------|------|-------------------|--------------------------|
| S1 | 0:00–0:08 | Title card: FOREMAN — agents hire agents on NEAR | HyperFrames composition (DESIGN.md tokens) | Tagline + 4 track pills (swarms/agents/business/open) |
| S2 | 0:08–0:16 | Problem: agents have no bank account that may | Composition, 3 stat tiles | "no enforceable money layer" thesis |
| S3 | 0:16–0:30 | ephe plugin active: `/foreman-hire research-report … budget 0.9` | Live recording ephe SSE chat + `ephe plugin list` | "foreman on 0.1.0" + tx D7ZgMP… |
| S4 | 0:30–0:45 | Board: open bidding round, countdown running, 5 bids trickling in | Screen recording web/board `?job=N` (fresh run video-final-09nov) | 5 bids with cent prices, LIVE pulse, RPC chain |
| S5 | 0:45–0:55 | Counter-offer: EXACTLY ONE, reason on-chain | Zoom panel 3 | `ON-CHAIN: GET_COUNTER_REASON(JOB=N) LIVE` |
| S6 | 0:55–1:05 | Fail-closed: accept without receipt → `NOT_DELIVERED` | Terminal recording take12 pattern (fresh run) | rc=3 contract_error=NOT_DELIVERED + empty receipt card |
| S7 | 1:05–1:15 | Receipt: worker in Ephemora cell → signed → verified | Terminal `verify_receipt: True` + panel 4 | record_sha256 437d0f76… + fuel report |
| S8 | 1:15–1:25 | Acceptance → payout → reputation | Board panel 5 + nearblocks link + rep curve | +0.81/+0.0897, rep 50→72 curve |
| S9 | 1:25–1:35 | Money realness: Intents policy via Touch ID + dry:true quote | /tmp/board_proof popup shots + CLI output | agent 7a317e59…, policy_hash 07426bce…, quote ID |
| S10 | 1:35–1:45 | Third-party hire OR declared alternative | Monday decision | real: foreign wallet ≠ own 8 accounts |
| S11 | 1:45–1:52 | Numbers card: cost per deliverable in cents, bid spread, rep Δ | Data from sidecars (measured) | {cost_per_deliverable} really measured |
| S12 | 1:52–2:00 | End: GitHub + tracks + disclaimer (mock swarms disclosed) | Composition | bemlerlabs/foreman · Apache-2.0 |

**Open:** S10 decision (market registration/balance), S4/S6 fresh-run timing (near-feasibility posts, scout records).
**Sound:** calm bed track, voiceover only after edit approval.

---

## Judge review 09.11. (video-final-09nov, 94 s, 11 scenes) — judge-backsolver
**Verdict:** ready for approval after 5 small interventions; 3 of the 4 core proofs are visible in 35 s, the readability and credibility details carry the rest. Proven core chain: post → 5 bids on-chain → exactly ONE reasoned counter-offer → fail-closed → signed receipt.

### TOP-5 CHANGES (impact/effort)
1. **Most-honest-error-must-be-readable principle:** the strongest proof asset is the raw terminal screenshot `/tmp/ephe_take12_3_accept_error.png` (take12, job 31): line "00:21 accept WITHOUT receipt/submit … contract panic NOT_DELIVERED", a real near-cli error blob `FunctionCallError {ExecutionError: Smart contract panicked: NOT_DELIVERED}` + a real call tx `gzWA9Q5HVh9ktoXaJ6UPZFrXFSHVRAZoRxFPHQ3OO`. In the film the same shot is scaled down so far that it yields ~35 lines of unreadable gray mush. **Fix:** show the real screenshot 1:1 and zoom statically onto the error line for 2–3 s (the 740 px wide strip in t46 is unusable). This is the Haseeb shot of the film.
2. **Correct the S06 caption (Haseeb trap):** "… — even when your own agent asks" is false as a claim: accept is executed by the BOSS account (EVIDENCE: accept accountID boss.foreman-team.testnet), not by the worker agent. The claim distracts from the actual, stronger fact. **Fix:** "— even when the boss himself calls it."
3. **Fill the receipt window:** in S07 the terminal window is ~90% black area; `verify_receipt: True` + the 64-char `record_sha256 437d0f765847…268de46` (verified as reproduced in EVIDENCE) float lost top left. **Fix:** add `fuel_consumed`/`mem_peak`/`egress_log_hash` of the signed record (3–4 lines from EVIDENCE/receipt JSON); one frame = a sandbox attestation instead of a one-line claim.
4. **Make the S04 bid wall readable on mobile:** account names are cut off on the right in full screen ("gent4.foreman-team.testnet"), all five "ETA 24 s" = suspiciously uniform. **Fix:** crop the right columns (ETA/score), account names complete; one really measured score value per row instead of a uniform ETA.
5. **S11 disclosure look:** the text is exemplary in content (team-controlled accounts + no backend + EVIDENCE_LOG reference, consistent across README/X post), but on 1080p it is gray-blue on black with ~2:1 contrast and looks faded out. **Fix:** hold 1–2 s longer, raise contrast/brightness, make the "DISCLOSURE" label clearly visible. Additionally (small): S03 "The boss agent posts the job" shows only `ephe plugin list` — the tx panels only appear from S04; add 2 s of `/foreman-hire` SSE chat with a tx ID, otherwise the autonomy-documents claim stays unproven in the same shot. **Do not change:** the "no middleman database" claim is covered — the board polls directly against RPC (EVIDENCE: board_cli reads contract views).

### K-MATRIX ASSESSMENT OF THE ORDER
Problem (thesis, well timed "They just don't") → plugin/autonomy (K1) → bids (K2-live) → counter (K2-depth) → fail-closed (proof-culture highlight) → receipt (K2-depth) → payout (K2-money) → treasury/policy (K2-treasury) → numbers (impact) → end. Fits: the four strongest proofs are in the first 55 s, the viewer need not rewind anything. Only weakness: S01 (0–6 s) does not sell why anyone outside NEAR should care — a 3-second "why care" sentence in S02 (e.g. "Every agent that wants to buy work has the same missing piece") would be the cheapest of all fixes; the title "Agents have ideas" (S02) works, "with real money rails" (S01) is close — not blocking.

### CUT TO 100 s (realistic: 94 → ~75 s)
**NEVER cut:** S03 (plugin + autonomy, K1), S04 (live bids + RPC chain), S05 (one reasoned counter-offer — unique feature), S06 (fail-closed — strongest differentiator, with fix 1), S07 (signed receipt), S08 (payout numbers + panel with `release_payout`/`accept` tx IDs), S11 (disclosure).
**DISPENSABLE (struck):** S09 treasury/policy — dry:true is the only Intents proof in the film (no execute tx, see credibility block) and the overlay "quote …dry:true" in S09 preserves it; S10 numbers card — numbers already sit in S04/S08; S02 thesis tiles — fit the thesis into 3 s in S01/S03.
**S10 third-party hire (scene plan):** only with a real foreign hire (seller handle + wallet ≠ own 8 accounts, tx in frame, negative check documented in EVIDENCE_LOG); if unclear: drop entirely + X post V2 instead of V3 — never play "declared self" and keep V3.

### CLAIMS vs. EVIDENCE
1. S09 "Caps enforced by policy, not by trust" — in the film only a dry:true quote + policy_hash; **no execute tx**, no wallet funding, no Intents settlement. Claim level too high. **Fix:** reword the sentence to "Spending caps live in the policy — dry-run verified; mainnet settlement follows Q-007." OR add execute-tx proof in 1–2 s, then the X post "paid actual cents via Intents" can stay true (V3 backbone).
2. S01 "with real money rails" — covered by the NEAR testnet payout (EVIDENCE PAYOUT_OK), but not by Intents settlement; S08 "real transaction that accepts" is cleanly worded. No film fix needed, just no "real money" narrative without the execute tx.
3. S04 "no middleman database" — covered (direct contract polling), OK.
4. S05 "10% below best bid" — 13.55 → 12.19 is actually 10.04%, "10%" is correctly rounded.
5. S10 "5/5 on-chain tx" — covered by the five place_bid tx, if the 5/5 count in the S04 overlay references the five bid transactions (plausible, verify briefly).

### CREDIBILITY / AI-SLOP TRACES
- **EN/DE mix in evidence:** counter-offer text German ("Festpreis 10 % unter Bestbid"), counter overlay mixed, film otherwise EN on-screen — looks generated rather than documented. Fix: make the quote overlay uniform; the German original line is authentic and may stay, but then consistently.
- Disclosure contrast (see fix 5), "quote …dry:true" overlay shortening (no trick, but bad light), S10 "31 jobs on escrow.foreman-team.testnet" is strong (real operating load, no mock suspicion), Ephemora cell Apache attribution on S11 ✓, "Built with ephe" ✓, no testnet warning needed (it is in every account address).