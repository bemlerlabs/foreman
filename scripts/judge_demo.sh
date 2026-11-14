#!/usr/bin/env bash
# One-command judge demo (S5). Live by default; --offline uses only repo artifacts.
#   bash scripts/judge_demo.sh            # live read-only board + proofs + tests
#   bash scripts/judge_demo.sh --offline  # no network: recorded recipe + proofs + tests
# Prereq: the receipts venv from the README Quickstart (python3.12 -m venv .venv-receipts ...).
set -euo pipefail
cd "$(dirname "$0")/.."
PY=.venv-receipts/bin/python
[ -x "$PY" ] || PY=python3
OFFLINE=0
[ "${1:-}" = "--offline" ] && OFFLINE=1

echo "== Foreman judge demo =="
if [ "$OFFLINE" = 1 ]; then
  echo "-- offline: settled job 50 from the recorded recipe --"
  sed -n '1,32p' artifacts/recipes/recipe_job50.md
else
  echo "-- live board (read-only, no keys) --"
  if ! "$PY" scripts/board_cli.py --job 50; then
    echo "(RPC unreachable; falling back to the recorded recipe)"
    sed -n '1,32p' artifacts/recipes/recipe_job50.md
  fi
fi

echo "-- receipt proof (independent fail-closed verify) --"
"$PY" -c "
import json, sys; sys.path.insert(0, '.')
from core.receipts.ephemora_adapter import verify_receipt, receipt_hash
r = json.load(open('artifacts/receipt_demo_job50.json'))
print('verify_receipt:', verify_receipt(r)); print('receipt_hash :', receipt_hash(r))"

echo "-- acceptance gate (machine-checkable criteria) --"
"$PY" scripts/verify_acceptance.py --deliverable artifacts/deliverable_demo.json \
  --out /tmp/judge_acceptance.json

echo "-- proof-chain tests --"
"$PY" -m pytest core/acceptance core/receipts -q

echo "== evidence: docs/EVIDENCE_LOG.md · RULES.md · docs/WHY_FOREMAN.md =="