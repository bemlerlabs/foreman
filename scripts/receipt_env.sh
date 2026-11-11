#!/usr/bin/env bash
# phase5: find the environment for the real receipt path, or say honestly that it is missing.
#
# Three things are looked for: the built worker, an interpreter with wasmtime, and the
# ephemora_cell package (Apache-2.0). A self-contained venv (.venv-receipts, built from the
# vendored wheel) ships ephemora_cell itself, so no external checkout is required. When all
# three are there the execution really runs and the receipt is signed; when one is missing the
# run says receipt_source=mock. Nothing is swapped in silently.
set -uo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

export EMPHORA_WASM="${EMPHORA_WASM:-$REPO_ROOT/artifacts/worker/latency_stats.wasm}"
# An external source checkout is only a fallback for interpreters without the package installed.
CELL_FALLBACK="${EPHEMORA_CELL_PATH:-$HOME/ephemora-cell}"

if [[ -z "${EPHEMORA_PY:-}" ]]; then
  for candidate in "$REPO_ROOT/.venv-receipts/bin/python" "$REPO_ROOT/.venv/bin/python" python3.13 python3.12 python3; do
    command -v "$candidate" >/dev/null 2>&1 || [[ -x "$candidate" ]] || continue
    if PYTHONPATH="$CELL_FALLBACK" "$candidate" -c "import wasmtime, cryptography, ephemora_cell" 2>/dev/null; then
      EPHEMORA_PY="$candidate"; break
    fi
  done
fi
export EPHEMORA_PY="${EPHEMORA_PY:-}"

# Prefer the interpreter's own installed package (self-contained venv) over an external checkout.
if [[ -n "$EPHEMORA_PY" ]]; then
  OWN_CELL="$("$EPHEMORA_PY" -c 'import ephemora_cell, os; print(os.path.dirname(os.path.dirname(ephemora_cell.__file__)))' 2>/dev/null || true)"
  export EPHEMORA_CELL_PATH="${EPHEMORA_CELL_PATH:-${OWN_CELL:-$CELL_FALLBACK}}"
else
  export EPHEMORA_CELL_PATH="${EPHEMORA_CELL_PATH:-$CELL_FALLBACK}"
fi

if [[ -f "$EMPHORA_WASM" && -n "$EPHEMORA_PY" && -d "$EPHEMORA_CELL_PATH" ]]; then
  echo "RECEIPT_ENV ok wasm=$EMPHORA_WASM py=$EPHEMORA_PY cell=$EPHEMORA_CELL_PATH"
else
  echo "RECEIPT_ENV missing wasm=${EMPHORA_WASM:+nein} py=${EPHEMORA_PY:-nein} cell=${EPHEMORA_CELL_PATH:+ja}"
  echo "RECEIPT_ENV hint: ./scripts/build_receipt_worker.sh; python -m venv .venv-receipts && .venv-receipts/bin/pip install wasmtime cryptography vendor/ephemora_cell-*.whl"
fi