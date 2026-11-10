# Submission readiness — 2026-11-10

Stand nach dem T5-Gate. Ziel: Einreichen am **12. oder 13.11. tagsüber** (User-Regel), niemals 14.11.
Was hier steht, ist belegt; was fehlt, ist als USER-Schritt markiert.

## Fertig (LEAD/Team, belegt)

| Stück | Stand | Beleg |
|---|---|---|
| Kette end-to-end | 2× in Folge bestanden, deterministisch | `docs/T5_GATE_2026-11-10.md`, `docs/EVIDENCE_LOG.md` (10.11.) |
| Signierter Receipt | echte WASM-Ausführung unter Fuel-Budget, ES256, verifiziert | Receipt-Record `0037679e…` / `4b9c5993…`; `receipt_source=wasm+es256` |
| Dritt-Angebot | live vom NEAR Agent Market gelesen (`web-research`, 0,50 USD) | `MARKET_OFFER_OK … live=1` in beiden Läufen |
| Judge-Quickstart kalt | Sandbox-Wheel **im Repo** (Apache-2.0, 99 kB) + gebauter Worker im Repo | `vendor/`, `artifacts/worker/latency_stats.wasm` |
| Board | Sidecars der Gate-Jobs 44/45 liegen bei, `board_cli.py --job 44` | `web/board/sidecar/job44.json` |
| Film | 98 s, 1920×1080, 30 fps, Zahlen aus dem Gate-Lauf | `foreman-film/renders/foreman-film_2026-11-10_09-52-56.mp4` |
| Submission-Payload | `requestId` gesetzt, `size "1"`, 4 Tracks, `idea` 1921 Zeichen | `docs/SUBMISSION_2026-11-13.json` |
| X-Post-Text | Variante 2 (Demo-Moment) passt zum Film; Variante 3 ist gesperrt (kein echter Dritt-Hire) | `docs/X_POST_DRAFT.md` |

## USER-Schritte vor dem Submit (nur der Owner)

1. **Repo public schalten** `bemlerlabs/foreman` — erst nach dem Freeze (11.11. 12:00), bleibt bis 25.11.
2. **Film hochladen** (X verlangt das Video beim Post; 98 s, 108 MB).
3. **X-Post publizieren** — erste Zeile = Problem, NEAR-Rolle benannt, Tags `@NEARProtocol #NEARHackathon @NearLegion @NearBuilders`; Repo + Demo-Link als Antwort, damit der Post unter 280 Zeichen bleibt.
4. **`demoUrl` liefern** für das Payload-Feld (`website` existiert nicht — nur `demoUrl` in der Submission-Maske).
5. **Payload laut vorlesen, „JA" sagen** — dann POST (201 quittieren). Regeln: nie zweimal pro Repo; 409 → request-changes, nie Link/Email wechseln; 503 → 1 Min warten, gleiche `requestId`; 403 → STOP.

## Was der Film bewusst nicht behauptet

- Kein echter Dritt-*Hire* (Zahlung an einen Fremd-Agenten): gezeigt wird ein reales **Angebot** des
  Markts, keine Hire-Transaktion. Deshalb ist X-Variante 3 gesperrt.
- Die Schwarm-Konten sind team-kontrolliert; das steht als Disclosure im Film und im README.

## Offen für Phase 6/7 (LEAD)

- Freeze 11.11. 12:00: keine neuen Ideen, README-Q-003-Diff, LICENSE-Notes, Cold-Test (G6).
- Film-Take mit den neuen Zeilen ist gerendert; wenn der Owner eine Sprecher-Stimme will, bleibt der
  Soundtrack unverändert (Voiceover ist im Sketch optional).
