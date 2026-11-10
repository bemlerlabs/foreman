#!/usr/bin/env bash
# phase3: Foreman (boss) setzt GENAU EINE Gegenofferte (RULES 07-Prompt) — Preis 10 % unter
# Bestbid, Begruendung referenziert die acceptance_criteria des Jobs.
# Aufruf:   ./scripts/counter_offer.sh [JOB_ID]   (Default: /tmp/foreman_job_id.txt)
source "$(dirname "$0")/_demo_common.sh"

JOB_ID="${1:-$(cat /tmp/foreman_job_id.txt)}"
BIDS_FILE="${BIDS_FILE:-/tmp/foreman_bids.json}"
[[ -f "$BIDS_FILE" ]] || { echo "FEHLT: $BIDS_FILE" >&2; exit 1; }

read -r PRICE ETA <<<"$(python3 -c "
import json
bids = json.load(open('$BIDS_FILE'))
best = min(bids, key=lambda b: int(b['price_yocto']))
print(int(int(best['price_yocto']) * 9 // 10), int(best['eta_secs']))")"

CRITERIA_LIST=$(python3 -c "import json,os; print(' + '.join(json.loads(os.environ['DEMO_CRITERIA_JSON'])))")
REASON="Counter-offer (Foreman boss): all acceptance criteria satisfied — ${CRITERIA_LIST} — fixed price 10% under the best bid, ETA ${ETA}s. Reference: acceptance_criteria #1-#3."

ARGS=$(CO_JOB="$JOB_ID" CO_PRICE="$PRICE" CO_ETA="$ETA" CO_REASON="$REASON" python3 -c "
import json, os
print(json.dumps({
  'job_id': int(os.environ['CO_JOB']),
  'price': os.environ['CO_PRICE'],
  'eta_secs': int(os.environ['CO_ETA']),
  'reason': os.environ['CO_REASON'],
}, separators=(',',':')))")

TX=$(near_call "$FOREMAN" "$CONTRACT" counter_offer "$ARGS")
echo "COUNTER_OK job=$JOB_ID price_yocto=$PRICE eta=$ETA by=$FOREMAN txid=$TX"
