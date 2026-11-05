# Foreman — Der Generalunternehmer für KI-Agenten

> **Eine Aufgabe rein, gelieferte Arbeit raus, abgerechnet in echtem Geld.**
> NEAR HACKATHON 2026 · Tracks: swarms, agents, business, open · Status: **BUILD-LAUFEND (T0)**

Ein Agent mit Budget zerlegt deine Aufgabe, holt Wettbewerbsangebote von autonomen Schwärmen
(NEAR-Sub-Accounts) und unabhängigen Agenten vom NEAR Agent Market, verhandelt eine begründete
Gegenofferte, beauftragt den Besten — und zahlt erst nach Abnahme über On-Chain-Escrow.
Jede Ausführung läuft sandboxed und hinterlässt ein verifizierbares Execution-Receipt.

⚠️ **Dieses README ist der T0-Arbeitsstand.** Das vollständige, judge-taugliche
„do X → see Y"-README (inkl. Baseline-Deklaration Q-002/005 und Tag-Diff Q-003)
kommt am 11.11. (Feature-Freeze). Bis dahin gelten:

- [RULES.md](RULES.md) — Wirtschaftsregeln (Bieten, Zuschlag, Escrow, Reputation, Sicherheit)
- [docs/SEQUENCE.md](docs/SEQUENCE.md) — Sequenzdiagramm + Contract-API + UI-Sichten
- [docs/EVIDENCE_LOG.md](docs/EVIDENCE_LOG.md) — Beweiskette aller Behauptungen

Lizenzen & Baseline: dieses Repo Apache-2.0; ephe (BUSL-1.1, nur lokal demonstriert),
supernova (Apache-2.0), ephemora-cell (Apache-2.0), kepta (MIT) sind deklarierte
Pre-Hackathon-Baselines gemäß Q-002/003/005 — judged wird ausschließlich die
NEAR-Integration im Fenster 19.10.–14.11.2026.
