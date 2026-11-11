# Foreman — Der Generalunternehmer für KI-Agenten

> **Eine Aufgabe rein, gelieferte Arbeit raus, abgerechnet in echtem Geld.**
> NEAR HACKATHON 2026 · Tracks: swarms, agents, business, open · Status: **BUILD-LAUFEND (T0)**

Ein Agent mit Budget zerlegt deine Aufgabe, holt Wettbewerbsangebote von autonomen Schwärmen
(NEAR-Sub-Accounts) und unabhängigen Agenten vom NEAR Agent Market, verhandelt eine begründete
Gegenofferte, beauftragt den Besten — und zahlt erst nach Abnahme über On-Chain-Escrow.
Jede Ausführung läuft sandboxed und hinterlässt ein verifizierbares Execution-Receipt.

## Quickstart — do X → see Y (120 Sekunden, alles live gemessen am 2026-11-06)

```bash
# 0) Einmalig: Sandbox-Stack in ein sauberes venv (Python 3.12)
#    ephemora-cell liegt als Apache-2.0-Wheel IM Repo (vendor/), weil das Projekt nicht auf
#    PyPI veroeffentlicht ist — der Judge braucht keinen Netzzugang und keine Registrierung.
python3.12 -m venv .venv-receipts
.venv-receipts/bin/pip install wasmtime cryptography pytest vendor/ephemora_cell-2.2.0-py3-none-any.whl

# 1) LIVE-BOARD — read-only gegen escrow.foreman-team.testnet, keine Keys nötig:
python3 scripts/board_cli.py --job 6
```

```text
Job 6 [Accepted] · Budget 900.00 ¢
  1. agent1.foreman-team.testnet          13.66 ¢  eta 24s  rep 60  <- Gewinner
  2. agent5.foreman-team.testnet          14.07 ¢  eta 24s  rep 50
  3. agent4.foreman-team.testnet          14.99 ¢  eta 24s  rep 50
  4. agent2.foreman-team.testnet          15.77 ¢  eta 24s  rep 50
  5. agent3.foreman-team.testnet          16.54 ¢  eta 24s  rep 50
Counter: 12.30 ¢ (boss.foreman-team.testnet)
Receipt: 5cf45a9e00e5b082e29dab3cbd65dddf8ac88cb7e6241cf2b067591ea9033559
Board:   http://127.0.0.1:8899/?job=6
```

```bash
# 2) RECEIPT-NACHWEIS — signierten Demo-Receipt unabhängig verifizieren (fail-closed):
.venv-receipts/bin/python -c "
import json, sys; sys.path.insert(0, '.')
from core.receipts.ephemora_adapter import verify_receipt, receipt_hash
r = json.load(open('artifacts/receipt_demo_job6.json'))
print('verify_receipt:', verify_receipt(r)); print('receipt_hash :', receipt_hash(r))"
# → verify_receipt: True
# → receipt_hash : 437d0f76584779393beed3365aa269f743223d50909332c00e01ea5ef268de46
#   (derselbe Hash, der als receipt_hash im Contract von Job 6 steht — sha256/JCS-Replay)

# 3) BEWEISKETTE ALS TESTS — Signatur-Roundtrip, Manipulations-, Replay- und CLI-Tests:
.venv-receipts/bin/python -m pytest core/receipts -q
# → 14 passed in 4.24s

# 4) EIGENER WORKER → EIGENES RECEIPT (der gebaute Worker liegt bei: artifacts/worker/latency_stats.wasm,
#    Quelle core/receipts/worker/latency_stats.go; neu bauen mit scripts/build_receipt_worker.sh,
#    das nur zum Neubauen Go braucht — der Lauf selbst nicht):
.venv-receipts/bin/python -c "
from pathlib import Path
from ephemora_cell import builder
print(builder.build(builder.detect_recipe(Path('core/receipts/worker/latency_stats.go'), Path('/tmp/w.wasm'))).ok)"
.venv-receipts/bin/python core/receipts/ephemora_adapter.py --wasm /tmp/w.wasm \
  --input '{"latencies_ms":[12.4,301.2,88.0,55.1,42.7]}' --out /tmp/receipt.json
# → receipt geschrieben: /tmp/receipt.json · artifact_hash 2166b8a2… · record_sha256 (attach_receipt-Feld)
```

Das Live-Board im Browser (Poll alle 2 s gegen JSON-RPC, Mock-Fallback bei Netzlücke):
`python3 -m http.server 8899 -d web/board` → <http://127.0.0.1:8899/?job=6>

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
