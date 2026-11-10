#!/usr/bin/env bash
# phase5: find the environment for the real receipt path, or say honestly that it is missing.
#
# Three things are looked for: the built worker, an interpreter with wasmtime, and the
# ephemora_cell package (Apache-2.0, present locally under ~/ephemora-cell). When all three are
# there the execution really runs and the receipt is signed; when one is missing the run says
# receipt_source=mock. Nothing is swapped in silently.
set -uo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

export EMPHORA_WASM="${EMPHORA_WASM:-$REPO_ROOT/artifacts/worker/latency_stats.wasm}"
export EPHEMORA_CELL_PATH="${EPHEMORA_CELL_PATH:-$HOME/ephemora-cell}"

if [[ -z "${EPHEMORA_PY:-}" ]]; then
  for candidate in "$REPO_ROOT/.venv/bin/python" /tmp/rcpt313/bin/python python3.13 python3.12 python3; do
    command -v "$candidate" >/dev/null 2>&1 || [[ -x "$candidate" ]] || continue
    if PYTHONPATH="$EPHEMORA_CELL_PATH" "$candidate" -c "import wasmtime, cryptography, ephemora_cell" 2>/dev/null; then
      EPHEMORA_PY="$candidate"; break
    fi
  done
fi
export EPHEMORA_PY="${EPHEMORA_PY:-}"

if [[ -f "$EMPHORA_WASM" && -n "$EPHEMORA_PY" && -d "$EPHEMORA_CELL_PATH" ]]; then
  echo "RECEIPT_ENV ok wasm=$EMPHORA_WASM py=$EPHEMORA_PY cell=$EPHEMORA_CELL_PATH"
else
  echo "RECEIPT_ENV missing wasm=${EMPHORA_WASM:+nein} py=${EPHEMORA_PY:-nein} cell=${EPHEMORA_CELL_PATH:+ja}"
  echo "RECEIPT_ENV hint: ./scripts/build_receipt_worker.sh; an interpreter with wasmtime (pip install wasmtime cryptography); ephemora_cell under ~/ephemora-cell"
fi
