# Foreman — Video-Sketch T7 (Ziel: 90–110 s, 1920×1080, 2 Screenshots/Videos pro Shot beweisbar)

**Regel von heute:** Jeder Shot braucht ein reproduzierbares Artefakt (Terminal/Tx/Quote > Ästhetik).
Sprechstil: sachlich, Zahlen statt Adjektive. Kein AI-Slop-Pathos. Untertitel-Track Deutsch, On-Screen-Englisch.

| # | Zeit | Shot | Quelle / Aufnahme | Beweis-Artefakt im Frame |
|---|------|------|-------------------|--------------------------|
| S1 | 0:00–0:08 | Titelkarte: FOREMAN — agents hire agents on NEAR | HyperFrames-Komposition (DESIGN.md-Tokens) | Tagline + 4 Track-Pills (swarms/agents/business/open) |
| S2 | 0:08–0:16 | Problem: Agenten haben kein Bankkonto das darf | Komposition, 3 Stat-Kacheln | „no enforceable money layer" These |
| S3 | 0:16–0:30 | ephe-Plugin aktiv: `/foreman-hire research-report … budget 0.9` | Live-Aufnahme ephe SSE-Chat + `ephe plugin list` | „foreman on 0.1.0" + Tx D7ZgMP… |
| S4 | 0:30–0:45 | Board: offene Biet-Runde, Countdown läuft, 5 Bids trudeln ein | Bildschirmaufnahme web/board `?job=N` (Frischlauf video-final-09nov) | 5 Bids mit Cent-Preisen, LIVE-Puls, RPC-Kette |
| S5 | 0:45–0:55 | Gegenofferte: GENAU EINE, Begründung on-chain | Zoom Panel 3 | `ON-CHAIN: GET_COUNTER_REASON(JOB=N) LIVE` |
| S6 | 0:55–1:05 | Fail-closed: accept ohne Receipt → `NOT_DELIVERED` | Terminal-Mitschnitt take12-Muster (Frischlauf) | rc=3 contract_error=NOT_DELIVERED + leere Receipt-Karte |
| S7 | 1:05–1:15 | Receipt: Worker in Ephemora-Cell → signiert → verifiziert | Terminal `verify_receipt: True` + Panel 4 | record_sha256 437d0f76… + fuel-Report |
| S8 | 1:15–1:25 | Abnahme → Payout → Reputation | Board Panel 5 + nearblocks-Link + Rep-Kurve | +0.81/+0.0897, Rep 50→72 Kurve |
| S9 | 1:25–1:35 | Geld-Echtheit: Intents-Policy per Touch-ID + dry:true-Quote | /tmp/board_proof Popup-Shots + CLI-Output | agent 7a317e59…, policy_hash 07426bce…, Quote-ID |
| S10 | 1:35–1:45 | Dritt-Hire ODER deklarierte Alternative | Montag Entscheidung | echt: Fremd-Wallet ≠ eigene 8 Konten |
| S11 | 1:45–1:52 | Zahlenkarte: cost per deliverable in Cent, Biet-Spread, Rep-Δ | Daten aus Sidecars (gemessen) | {cost_per_deliverable} real gemessen |
| S12 | 1:52–2:00 | Ende: GitHub + Tracks + Disclaimer (Mock-Schwärme offengelegt) | Komposition | bemlerlabs/foreman · Apache-2.0 |

**Offen:** S10 Entscheidung (Markt-Registrierung/Guthaben), S4/S6 Frischlauf-Timing (near-feasibility postet, scout nimmt auf).
**Sound:** ruhiger Bed-Track, Voiceover erst nach Schnitt-Freigabe.

---

## Judge-Beschuss 09.11. (video-final-09nov, 94 s, 11 Szenen) — judge-backsolver
**Votum:** Freigabe reif nach 5 kleinen Eingriffen; 3 der 4 Kernbeweise sind in 35 s sichtbar, die Lese- und Glaubwürdigkeitsdetails tragen den Rest. Bewiesene Kernkette: post → 5 Bids on-chain → genau EINE begründete Gegenofferte → Fail-closed → signiertes Receipt.

### TOP-5-ÄNDERUNGEN (Impact/Aufwand)
1. **Ehrlichster-Fehler-muss-lesbar-sein-Prinzip:** Das stärkste Beweis-Asset ist der Terminal-Roh-Screenshot `/tmp/ephe_take12_3_accept_error.png` (take12, Job 31): Zeile „00:21 accept OHNE receipt/submit … Contract-Panic NOT_DELIVERED", echter near-cli-Fehlerblob `FunctionCallError {ExecutionError: Smart contract panicked: NOT_DELIVERED}` + echte Call-tx `gzWA9Q5HVh9ktoXaJ6UPZFrXFSHVRAZoRxFPHQ3OO`. Im Film ist derselbe Shot so weit runterskaliert, dass er ~35 Zeilen unlesbaren Graubrei ergibt. **Fix:** echten Screenshot 1:1 einblenden und 2–3 s statisch auf die Fehlerzeile zoomen (der 740 px breite Streifen in t46 ist unbrauchbar). Das ist der Haseeb-Shot des Films.
2. **S06-Bildunterschrift korrigieren (Haseeb-Falle):** „… — even when your own agent asks" ist als Claim falsch: accept wird vom BOSS-Konto ausgeführt (EVIDENCE: accept accountID boss.foreman-team.testnet), nicht vom Worker-Agenten. Die Behauptung lenkt vom eigentlichen, stärkeren Fakt ab. **Fix:** „— even when the boss himself calls it."
3. **Receipt-Fenster füllen:** In S07 ist das Terminal-Fenster zu ~90 % Schwarzfläche; `verify_receipt: True` + 64-Zeichen-`record_sha256 437d0f765847…268de46` (in EVIDENCE als reproduziert verifiziert) schwimmen verloren oben links. **Fix:** `fuel_consumed`/`mem_peak`/`egress_log_hash` des signed Records (3–4 Zeilen aus EVIDENCE/Receipt-JSON) dazustellen; ein Frame = Sandbox-Attest statt Einzeiler-Behauptung.
4. **S04-Bid-Wand mobil lesbar machen:** Kontonamen sind im Vollbild rechts angeschnitten („gent4.foreman-team.testnet"), alle fünf „ETA 24 s" = verdächtig uniform. **Fix:** rechte Spalten (ETA/Score) beschneiden, Kontonamen vollständig; ein real gemessener Score-Wert pro Zeile statt uniformer ETA.
5. **S11-Disclosure-Anmutung:** Der Text ist inhaltlich vorbildlich (team-controlled accounts + no backend + EVIDENCE_LOG-Verweis, drittstellen-konsistent zu README/X-Post), aber auf 1080p graublau auf schwarz mit ~2:1-Kontrast und wirkt ausgeblendet. **Fix:** 1–2 s länger halten, Kontrast/Helligkeit hoch, Label „DISCLOSURE" gut sichtbar. Zusätzlich (klein): S03 „The boss agent posts the job" zeigt nur `ephe plugin list` — die Tx-Panels tauchen erst ab S04 auf; 2 s `/foreman-hire`-SSE-Chat mit Tx-ID nachrüsten, sonst bleibt die Autonomie-Dokumente-Behauptung im selben Shot unbelegt. **Nicht ändern:** das „no middleman database"-Claim ist gedeckt — Board pollt direkt gegen RPC (EVIDENCE: board_cli liest contract views).

### K-MATRIX-BEWERTUNG DER REIHENFOLGE
Problem (These, gut getimt „They just don't") → Plugin/Autonomie (K1) → Bids (K2-Live) → Counter (K2-Tiefe) → Fail-closed (Beweiskultur-Highlight) → Receipt (K2-Tiefe) → Payout (K2-Geld) → Treasury/Policy (K2-Treasury) → Zahlen (Impact) → Ende. Passt: die vier stärksten Beweise sind in den ersten 55 s, der Zuschauer muss nichts zurückspulen. Einzige Schwäche: S01 (0–6 s) verkauft nicht, warum das jemanden außerhalb von NEAR kümmert — ein 3-Sekunden-„why care"-Satz in S02 (z. B. „Every agent that wants to buy work has the same missing piece") wäre der Billigste aller Fixes; Titel „Agents have ideas" (S02) funktioniert, „with real money rails" (S01) ist nah dran — nicht blockierend.

### KÜRZUNG AUF 100 s (realistisch: 94 → ~75 s)
**NIEMALS schneiden:** S03 (Plugin + Autonomie, K1), S04 (Live-Bids + RPC-Kette), S05 (eine begründete Gegenofferte — Unique Feature), S06 (Fail-closed — stärkstes Unterscheidungsmerkmal, mit Fix 1), S07 (signed Receipt), S08 (Payout-Zahlen + Panel mit `release_payout`/`accept`-Tx-IDs), S11 (Disclosure).
**VERZICHTBAR (gestrichen):** S09 Treasury/Policy — dry:true ist als einziger Intents-Beweis im Film (kein Execute-Tx, s. Glaubwürdigkeitsblock) und der Overlay-„quote …dry:true" in S09 konserviert; S10 Zahlenkarte — Zahlen stecken bereits in S04/S08; S02 These-Kacheln — These in 3 s in S01/S03 unterbringen.
**S10 Dritt-Hire (Szenenplan):** nur mit echtem Fremd-Hire (Verkäufer-Handle + Wallet ≠ eigene 8 Konten, tx im Frame, Negativ-Check im EVIDENCE_LOG dokumentiert); wenn unklar: ganz raus + X-Post V2 statt V3 — niemals „declared self" einspielen und V3 behalten.

### CLAIMS vs. EVIDENCE
1. S09 „Caps enforced by policy, not by trust" — im Film nur dry:true-Quote + policy_hash; **kein Execute-Tx**, kein Wallet-Funding, kein Intents-Settlement. Claim-Grad zu hoch. **Fix:** Satz auf „Spending caps live in the policy — dry-run verified; mainnet settlement follows Q-007." umformulieren ODER Execute-Tx-Beweis in 1–2 s nachreichen, dann kann der X-Post „paid actual cents via Intents" wahr bleiben (V3-Rückgrat).
2. S01 „with real money rails" — gedeckt durch NEAR-Testnet-Payout (EVIDENCE PAYOUT_OK), aber nicht durch Intents-Settlement; S08 „real transaction that accepts" ist sauber formuliert. Kein Film-Fix nötig, nur kein „real money"-Narrativ ohne den Execute-Tx.
3. S04 „no middleman database" — gedeckt (direct contract polling), OK.
4. S05 „10 % unter Bestbid" — 13,55 → 12,19 sind faktisch 10,04 %, „10 %" ist korrekt gerundet.
5. S10 „5/5 on-chain tx" — durch die fünf place_bid-tx gedeckt, wenn die 5/5-Anzahl im S04-Overlay auf die fünf Bid-Transaktionen referenziert (ist plausibel, kurz verifizieren).

### GLAUEWÜRDIGKEIT / AI-SLOP-SPUREN
- **EN/DE-Mix in Beweismitteln:** Gegenofferten-Text deutsch („Festpreis 10 % unter Bestbid"), Counter-Overlay gemischt, Film sonst EN-on-screen — wirkt generiert statt dokumentiert. Fix: Zitat-Overlay einheitlich; die deutsche Original-Zeile ist authentisch und darf bleiben, aber dann konsequent.
- Disclosure-Kontrast (s. Fix 5), „quote …dry:true"-Overlay-Verkürzung (kein Trick, aber schlechtes Licht), S10 „31 jobs on escrow.foreman-team.testnet" ist stark (echte Betriebslast, kein Mock-Verdacht), Ephemora-Cell Apache-Attribution auf S11 ✓, „Built with ephe" ✓, keine Testnet-Warnung nötig (steht in jeder Kontoadresse).
