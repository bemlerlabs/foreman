#!/usr/bin/env bash
# phase7: Video-Biet-Schleife — nutzt die 429-gehärtete near_call aus _demo_common.sh,
# incl. Retry+Backoff und near_send.cjs-Fallback gegen dRPC (send_tx).
# place_bid ist @payable: --depositYocto 0 wird explizit gesetzt (Lead-Hinweis).
# Aufruf:   ./scripts/video_bid_loop.sh <JOB_ID>
source "$(dirname "$0")/_demo_common.sh"

JOB_ID="${1:?JOB_ID noetig}"
BIDS_FILE="${BIDS_FILE:-/tmp/foreman_bids.json}"
[[ -f "$BIDS_FILE" ]] || { echo "FEHLT: $BIDS_FILE (zuerst scripts/cli_bids.py laufen lassen)" >&2; exit 1; }

T0=$(date +%s)
i=0
while read -r bidder price eta; do
  i=$((i + 1))
  (
    ARGS=$(printf '{"job_id":%s,"price":"%s","eta_secs":%s}' "$JOB_ID" "$price" "$eta")
    TX=$(near_call "$bidder" "$CONTRACT" place_bid "$ARGS" --depositYocto 0) && \
      echo "BID_OK bidder=$bidder price_yocto=$price eta=$eta txid=$TX" >"/tmp/foreman_bid_$i.out" || \
      echo "BID_FAIL bidder=$bidder price_yocto=$price" >"/tmp/foreman_bid_$i.out"
  ) &
done < <(python3 -c "
import json
for b in json.load(open('$BIDS_FILE')):
    print(b['bidder'], b['price_yocto'], b['eta_secs'])")
wait
ELAPSED=$(( $(date +%s) - T0 ))

FAILS=0
for f in /tmp/foreman_bid_*.out; do
  grep -E 'BID_OK|BID_FAIL' "$f" | tee -a "$LOG" || true
  grep -q BID_FAIL "$f" && FAILS=$((FAILS + 1))
done
rm -f /tmp/foreman_bid_*.out
[[ $FAILS -eq 0 ]] || { echo "BID_LOOP_FEHLER: $FAILS von $i Bids fehlgeschlagen" >&2; exit 1; }
echo "BID_LOOP_OK bids=$i elapsed=${ELAPSED}s (Fenster 120s) job=$JOB_ID" | tee -a "$LOG"
