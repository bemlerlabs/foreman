# Submission readiness — final handoff, 2026-11-12

Stand: Film final, README EN, Payload vorbereitet. **Nichts ist veröffentlicht** (Owner-Entscheidung
12.11.: „nur vorbereiten"). Alles unten ist copy-paste-fertig; die öffentlichen Schritte klickt der Owner.

## Fertig (belegt)

| Stück | Stand | Beleg |
|---|---|---|
| Film | 98 s, 1920×1080, 30 fps, neue VO (Stimme vom Owner abgenommen), alle Zahlen = Job 50, keine Home-Pfade | `foreman-film/renders/foreman-film_final.mp4` (Desktop-Kopie inhaltsgleich) |
| README | Englisch, do-X→see-Y live gemessen (16 Receipt-Tests, 47 Contract-Tests, verify True) | Commit `9e83e31` |
| Board-Payout-Fix | Budget − 10 % statt Bid-Preis | Commit `f69ffa2` |
| Payload | `docs/SUBMISSION_2026-11-13.json`: requestId fix, size "1", tracks [swarms,agents,business,open], projectName Foreman, leadName bemlerlabs, nearAddress bemlerlabs.near, idea 1691 Z. ohne Platzhalter/Handles, Intents ehrlich formuliert | Commit `bb1e656` + leadName-Fill |
| X-Text | Variante 2-final, 274 Zeichen inkl. Tags, „Built at NEAR HACKATHON", alle vier Handles | `docs/X_POST_DRAFT.md` |
| Offen im Payload | `email` (Owner trägt ein), `demoUrl` (entsteht mit dem X-Post), `consent` (Owner-Klick) | — |

## Owner-Schritte (in dieser Reihenfolge, jeder öffentlich/irreversibel)

1. **Push** (Repo ist noch privat, 12 Commits ahead):
   `git push origin main`
2. **Repo public**: `gh repo edit bemlerlabs/foreman --visibility public` (oder GitHub Settings).
   Muss bis 14.11. 23:59 UTC public bleiben; LICENSE (Apache-2.0) liegt.
3. **Optional Hosting** (Organizer: „hosted demo helps", online bis ≥ 18.11.): auf Zuruf baue ich
   einen Qoder-Sites-Entwurf des Read-only-Boards; veröffentlichen erst nach Owner-Okay.
4. **X-Post** vom Account **@MimiT3chAi (Michael Bemler)**, Video anhängen: `foreman-film_final.mp4`, Text exakt (265 Zeichen):
   > AI agents can't pay each other safely. Foreman on NEAR: 5 swarms bid → ONE reasoned counter-offer → sandboxed work, ES256 receipt on-chain → escrow pays 90/10 after acceptance. Built at NEAR HACKATHON @NEARProtocol #NEARHackathon #AIAgents @NearLegion @NearBuilders

   Danach **Antwort unter den Post**: `Repo: https://github.com/bemlerlabs/foreman` (+ Live-Board-URL falls gehostet).
   Die Post-URL ist das `demoUrl` Feld.
5. **Formular** <https://nearhackathon.com/#apply> — Felder:
   | Feld | Wert |
   |---|---|
   | Project name | Foreman |
   | Team lead | bemlerlabs |
   | Email | (Owner trägt ein; max. 2 Submissionen pro E-Mail) |
   | Team size | 1 (solo) |
   | Tracks | swarms · agents · business · open (AI Swarms, Agent Economy, Business, Open Innovation) |
   | NEAR wallet | bemlerlabs.near |
   | Repository link | https://github.com/bemlerlabs/foreman |
   | Demo post link | (X-Post-URL aus Schritt 4) |
   | What did you build? | idea aus dem Payload, 1691 Zeichen — in die Zwischenablage: `python3 -c "import json;print(json.load(open('docs/SUBMISSION_2026-11-13.json'))['idea'])" \| pbcopy` |
   | Website | **leer lassen** (Spam-Trap, jeder Wert rejectet) |
   | Consent | Checkbox erst nach eigenem Lesen setzen |
6. **Absenden, einmal.** Fehlerregeln: 409 → `/request-changes` (nie Zweit-Submit, nie Link/Email wechseln);
   503 → 1 Min warten, gleiche requestId; 403 → STOP (Fenster zu).

## Was der Film bewusst nicht behauptet

- Kein echter Dritt-*Hire*: gezeigt wird ein reales Markt-**Angebot** (0,50 USD, live gelesen), keine Hire-Transaktion.
- Settlement läuft über `accept()` des Escrow-Contracts (90/10); Intents ist als dry:true-vorbereitete
  Policy-Treasury belegt — Payload und X-Text sind entsprechend formuliert (kein Overclaim).
- Schwarm-Konten team-kontrolliert; Disclosure im Film (Endkarte) und README.

## Regeln-Abgleich (live gegen nearhackathon.com/HACKATHON.md, 12.11.)

- Videolänge: keine Vorgabe → 98 s ok. Problem-first ✓, ein vollständiger Moment ✓, NEAR-Rolle konkret ✓.
- X-Post: „built at NEAR HACKATHON" ✓, @NEARProtocol #NEARHackathon ✓, Video attached ✓.
- AI-Screening (Q-017): README maschinenlesbar ✓, Evidence-Log ✓, Cold-Start via vendored Wheel ✓.
- Baselines deklariert ✓; judged wird nur die NEAR-Integration im Fenster 19.10.–14.11.
- Tracks-Endkarte = offizielle Namen ✓; Payload-IDs = Formular-IDs ✓.