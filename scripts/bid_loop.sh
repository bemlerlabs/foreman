#!/usr/bin/env bash
# phase3: reads bids from .state/bids.json ([{bidder,price_yocto,eta_secs}]) and
# calls place_bid for all swarms IN PARALLEL (bid window only 120s — speed counts).
# place_bid is @payable: --depositYocto 0 is set explicitly (lead note).
# Usage:   ./scripts/bid_loop.sh [JOB_ID]     (default: .state/job_id.txt)
source "$(dirname "$0")/_demo_common.sh"

JOB_ID="${1:-$(cat "$STATE_DIR/job_id.txt")}"
BIDS_FILE="${BIDS_FILE:-$STATE_DIR/bids.json}"
[[ -f "$BIDS_FILE" ]] || { echo "MISSING: $BIDS_FILE (run scripts/gen_bids.py first)" >&2; exit 1; }

T0=$(date +%s)
i=0
while read -r bidder price eta; do
  i=$((i + 1))
  (
    ARGS=$(printf '{"job_id":%s,"price":"%s","eta_secs":%s}' "$JOB_ID" "$price" "$eta")
    TX=$(near_call "$bidder" "$CONTRACT" place_bid "$ARGS" --depositYocto 0) && \
      echo "BID_OK bidder=$bidder price_yocto=$price eta=$eta txid=$TX" >"$STATE_DIR/bid_$i.out" || \
      echo "BID_FAIL bidder=$bidder price_yocto=$price" >"$STATE_DIR/bid_$i.out"
  ) &
done < <(python3 -c "
import json
for b in json.load(open('$BIDS_FILE')):
    print(b['bidder'], b['price_yocto'], b['eta_secs'])")
wait
ELAPSED=$(( $(date +%s) - T0 ))

FAILS=0
for f in "$STATE_DIR"/bid_*.out; do
  grep -E 'BID_OK|BID_FAIL' "$f" || true
  grep -q BID_FAIL "$f" && FAILS=$((FAILS + 1))
done
rm -f "$STATE_DIR"/bid_*.out
[[ $FAILS -eq 0 ]] || { echo "BID_LOOP_ERROR: $FAILS of $i bids failed" >&2; exit 1; }
echo "BID_LOOP_OK bids=$i elapsed=${ELAPSED}s (Fenster 120s) job=$JOB_ID"
