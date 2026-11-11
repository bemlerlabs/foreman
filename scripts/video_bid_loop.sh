#!/usr/bin/env bash
# phase7: video bid loop — uses the 429-hardened near_call from _demo_common.sh,
# incl. retry+backoff and the near_send.cjs fallback against dRPC (send_tx).
# place_bid is @payable: --depositYocto 0 is set explicitly (lead note).
# call:   ./scripts/video_bid_loop.sh <JOB_ID>
source "$(dirname "$0")/_demo_common.sh"

JOB_ID="${1:?JOB_ID required}"
BIDS_FILE="${BIDS_FILE:-$STATE_DIR/bids.json}"
[[ -f "$BIDS_FILE" ]] || { echo "MISSING: $BIDS_FILE (run scripts/cli_bids.py first)" >&2; exit 1; }

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
  grep -E 'BID_OK|BID_FAIL' "$f" | tee -a "$LOG" || true
  grep -q BID_FAIL "$f" && FAILS=$((FAILS + 1))
done
rm -f "$STATE_DIR"/bid_*.out
[[ $FAILS -eq 0 ]] || { echo "BID_LOOP_ERROR: $FAILS of $i bids failed" >&2; exit 1; }
echo "BID_LOOP_OK bids=$i elapsed=${ELAPSED}s (window 120s) job=$JOB_ID" | tee -a "$LOG"
