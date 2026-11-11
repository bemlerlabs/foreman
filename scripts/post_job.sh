#!/usr/bin/env bash
# phase3: owner posts the demo job with an escrow deposit on escrow.foreman-team.testnet.
# Deposit 0.9 NEAR (07 prompt), deadline now+10min. JobId -> stdout + /tmp/foreman_job_id.txt.
# call:   ./scripts/post_job.sh            (LOG=/tmp/foreman_e2e_manual.log overridable)
source "$(dirname "$0")/_demo_common.sh"

NOW_NS=$(($(date +%s) * 1000000000))
DEADLINE_NS=$((NOW_NS + DEADLINE_SECONDS * 1000000000))

ARGS=$(python3 -c "
import json, os
print(json.dumps({
  'spec': os.environ['DEMO_SPEC'],
  'acceptance_criteria': json.loads(os.environ['DEMO_CRITERIA_JSON']),
  'deadline_nanos': $DEADLINE_NS,
}, separators=(',',':')))")

TX=$(near_call "$OWNER" "$CONTRACT" post_job "$ARGS" --depositYocto "$DEMO_BUDGET_YOCTO")
JOB_ID=$(call_result "$(cat "${LAST_CALL_FILE:-/tmp/foreman_last_call_out}")")
if [[ -z "$JOB_ID" ]]; then
  echo "WARN: could not parse JobId from output — check via get_bids/board" >&2
  tail -6 "${LAST_CALL_FILE:-/tmp/foreman_last_call_out}" >&2
fi
echo "$JOB_ID" >/tmp/foreman_job_id.txt
echo "POST_OK job_id=$JOB_ID deposit_yocto=$DEMO_BUDGET_YOCTO deadline_nanos=$DEADLINE_NS txid=$TX"
