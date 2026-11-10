#!/usr/bin/env bash
# phase5: build the receipt worker (a Go program compiled to wasip1 WASM).
#
# The worker is the code the demo really executes: it receives the run's bid prices as a series
# of values, computes over them and emits an artifact. The adapter runs it under a fuel budget and
# signs the report with ES256 (core/receipts/ephemora_adapter.py).
#
# Call: ./scripts/build_receipt_worker.sh   -> artifacts/worker/latency_stats.wasm
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$HERE/.." && pwd)"
OUT_DIR="$REPO_ROOT/artifacts/worker"
mkdir -p "$OUT_DIR"
command -v go >/dev/null || { echo "build_receipt_worker: go is missing (https://go.dev/dl)" >&2; exit 2; }
( cd "$REPO_ROOT/core/receipts/worker" \
  && GOOS=wasip1 GOARCH=wasm go build -trimpath -o "$OUT_DIR/latency_stats.wasm" latency_stats.go )
ls -l "$OUT_DIR/latency_stats.wasm" | awk '{print "WORKER_OK " $9 " " $5 "B"}'
