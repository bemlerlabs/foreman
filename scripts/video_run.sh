#!/usr/bin/env bash
# phase7: phase runner for the hackathon demo recording.
# Deliberately PHASED instead of e2e_demo.sh: the lead needs reporting/recording
# windows between steps, and S6 requires the accept-without-receipt rejection
# BEFORE the real receipt path (S7/S8).
#
# call: scripts/video_run.sh <post|bids|middle|acceptdemo|finish>
#   post       — generate bids+artifact, post_job, print the job id (then: report the job id!)
#   bids       — 25-30s hold (countdown >60s in frame), then 5 bids in parallel
#   middle     — counter_offer (boss) + award (boss)
#   acceptdemo — S6: accept BEFORE receipt -> expected NOT_DELIVERED (rc!=0, visible in terminal)
#   finish     — attach_receipt+submit_work (winner), payout proof, accept, sidecar, VIDEO_OK
#   dashboard  — start the live board server and print the link
#   recipe     — write recipe.json/md for the settled job and register it as an ephe skill
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
source "$HERE/_demo_common.sh"

export E2E_SEED="${E2E_SEED:-video-final-09nov}"
export LOG="${LOG:-/tmp/foreman_e2e_video_09nov.log}"
BREMSE="${BREMSE:-27}"   # hold after post: bids land with countdown ~90s (120s window, 4s skew buffer)
JOB_FILE=/tmp/foreman_video_job.txt
PHASE="${1:-}"

say() { echo "VIDEO_$1 $(date +%H:%M:%S) $2" | tee -a "$LOG"; }

case "$PHASE" in
  post)
    python3 "$REPO_ROOT/core/bidding/cli_bids.py" --seed "$E2E_SEED" \
      --out /tmp/foreman_bids.json --spec "$DEMO_SPEC" --budget-yocto "$DEMO_BUDGET_YOCTO" | tee -a "$LOG"
    ADAPTER_JOB="video-$E2E_SEED" python3 "$HERE/gen_artifact.py" | tee -a "$LOG"
    DEADLINE_NS=$(( $(date +%s) * 1000000000 + DEADLINE_SECONDS * 1000000000 ))
    ARGS=$(SPEC="$DEMO_SPEC" CRIT="$DEMO_CRITERIA_JSON" DL="$DEADLINE_NS" python3 -c "
import json,os
print(json.dumps({'spec':os.environ['SPEC'],'acceptance_criteria':json.loads(os.environ['CRIT']),'deadline_nanos':int(os.environ['DL'])}))")
    TX=$(near_call "$OWNER" "$CONTRACT" post_job "$ARGS" --depositYocto "$DEMO_BUDGET_YOCTO")
    JOB_ID=$(call_result "$(cat "${LAST_CALL_FILE:-/tmp/foreman_last_call_out}")")
    [[ -n "$JOB_ID" ]] || { echo "VIDEO_FAIL job_id parse — $LOG" >&2; exit 1; }
    echo "$JOB_ID" > "$JOB_FILE"
    say POSTED "job=$JOB_ID txid=$TX seed=$E2E_SEED budget=0.9NEAR deadline=+${DEADLINE_SECONDS}s — report the job id, then run the bids phase"
    ;;
  bids|bids+middle)
    JOB_ID=$(cat "$JOB_FILE")
    say BRAKE "holding ${BREMSE}s so bids land with the countdown in frame, then 5 bids in parallel (429-hardened)"
    sleep "$BREMSE"
    BIDS_FILE=/tmp/foreman_bids.json "$HERE/video_bid_loop.sh" "$JOB_ID"
    if [[ "$PHASE" == "bids+middle" ]]; then
      say GAP "30s capture pause after bids, then middle runs automatically"
      sleep 30
      "$HERE/counter_offer.sh" "$JOB_ID" | tee -a "$LOG"
      TX=$(near_call "$FOREMAN" "$CONTRACT" award "{\"job_id\":$JOB_ID}")
      WINNER=$(python3 -c "import json;print(json.load(open('/tmp/foreman_artifact.json'))['winner'])")
      say AWARD "job=$JOB_ID winner=$WINNER txid=$TX"
    fi
    ;;
  middle)
    JOB_ID=$(cat "$JOB_FILE")
    "$HERE/counter_offer.sh" "$JOB_ID" | tee -a "$LOG"
    TX=$(near_call "$FOREMAN" "$CONTRACT" award "{\"job_id\":$JOB_ID}")
    WINNER=$(python3 -c "import json;print(json.load(open('/tmp/foreman_artifact.json'))['winner'])")
    say AWARD "job=$JOB_ID winner=$WINNER txid=$TX"
    ;;
  acceptdemo)
    JOB_ID=$(cat "$JOB_FILE")
    say S6 "accept WITHOUT receipt/submit — expected: contract panic NOT_DELIVERED (terminal shot)"
    set +e
    TX=$(near_call "$FOREMAN" "$CONTRACT" accept "{\"job_id\":$JOB_ID,\"delivery_score\":90}")
    RC=$?
    set -e
    if [[ $RC -ne 0 ]] && grep -q "NOT_DELIVERED" "${LAST_CALL_FILE:-/tmp/foreman_last_call_out}"; then
      say S6_OK "accept without a deliverable rejected: NOT_DELIVERED (rc=$RC) — board stays Awarded"
    else
      echo "VIDEO_FAIL S6: accept was NOT rejected as expected (rc=$RC) — HOLD the run, inform the lead" >&2
      exit 3
    fi
    ;;
  finish)
    JOB_ID=$(cat "$JOB_FILE")
    WINNER=$(python3 -c "import json;print(json.load(open('/tmp/foreman_artifact.json'))['winner'])")
    RECEIPT=$(python3 -c "import json;print(json.load(open('/tmp/foreman_artifact.json'))['receipt_hash'])")
    ARTIFACT=$(python3 -c "import json;print(json.load(open('/tmp/foreman_artifact.json'))['artifact_hash'])")
    TX=$(near_call "$WINNER" "$CONTRACT" attach_receipt "{\"job_id\":$JOB_ID,\"receipt_hash\":\"$RECEIPT\"}")
    say RECEIPT "winner=$WINNER hash=${RECEIPT:0:16}… txid=$TX"
    TX=$(near_call "$WINNER" "$CONTRACT" submit_work "{\"job_id\":$JOB_ID,\"artifact_hash\":\"$ARTIFACT\"}")
    say SUBMIT "winner=$WINNER hash=${ARTIFACT:0:16}… txid=$TX"
    BAL_W_BEFORE=$(near_state_amount "$WINNER")
    BAL_F_BEFORE=$(near_state_amount "$FOREMAN")
    REP_BEFORE=$(near_view "$CONTRACT" get_rep "{\"agent\":\"$WINNER\"}" | tr -d '[:space:]')
    TX=$(near_call "$FOREMAN" "$CONTRACT" accept "{\"job_id\":$JOB_ID,\"delivery_score\":90}")
    ACCEPT_TX="$TX"
    say ACCEPT "job=$JOB_ID score=90 txid=$TX — accept confirmed"
    BAL_W_AFTER=$(near_state_amount "$WINNER")
    BAL_F_AFTER=$(near_state_amount "$FOREMAN")
    python3 - "$BAL_W_BEFORE" "$BAL_W_AFTER" "$BAL_F_BEFORE" "$BAL_F_AFTER" "$WINNER" "$FOREMAN" >>"$LOG" <<'PY'
import sys
wb,wa,fb,fa,w,f=sys.argv[1:7]
dw=(int(wa)-int(wb))/10**24; df=(int(fa)-int(fb))/10**24
ok=0.80<=dw<=0.812 and 0.085<=df<=0.092
print(f"PAYOUT_{'OK' if ok else 'FAIL'} winner={w} delta={dw:.6f} NEAR foreman={f} delta={df:.6f} NEAR")
sys.exit(0 if ok else 1)
PY
    grep "PAYOUT_" "$LOG" | tail -1
    JOB_JSON=$(near_view "$CONTRACT" get_job "{\"job_id\":$JOB_ID}")
    REP=$(near_view "$CONTRACT" get_rep "{\"agent\":\"$WINNER\"}" | tr -d '[:space:]')
    STATE=$(sed -nE "s/^[[:space:]]*state: '([A-Za-z]+)',?\$/\1/p" <<<"$JOB_JSON" | head -1)
    REP_EXPECT=$(python3 -c "print(($REP_BEFORE * 9 + 90) // 10)")
    [[ "$STATE" == "Accepted" && "$REP" == "$REP_EXPECT" ]] || {
      echo "VIDEO_FAIL verify: state=$STATE rep=$REP (expected Accepted/$REP_EXPECT from $REP_BEFORE) — $LOG" >&2; exit 1; }
    COUNTER_REASON_RAW=$(near_view "$CONTRACT" get_counter_reason "{\"job_id\":$JOB_ID}" | tr -d '\n')
    SIDECAR="$REPO_ROOT/web/board/sidecar/job${JOB_ID}.json"
    mkdir -p "$(dirname "$SIDECAR")"
    SC_JOB="$JOB_ID" SC_ACCEPT_TX="$ACCEPT_TX" SC_REASON="$COUNTER_REASON_RAW" SC_WINNER="$WINNER" SC_LOG="$LOG" \
      python3 - "$SIDECAR" <<'PY'
import json, os, sys
raw = os.environ["SC_REASON"].strip()
reason = "" if raw == "null" else raw.strip().strip("'\"")
doc = {
    "job_id": int(os.environ["SC_JOB"]),
    "payout_tx": os.environ["SC_ACCEPT_TX"],
    "payout_tx_label": "accept tx with payout transfer (90/10, RULES.md) — demo run",
    "accept_tx": os.environ["SC_ACCEPT_TX"],
    "counter_reason": reason,
    "winner": os.environ["SC_WINNER"],
    "e2e_log": os.environ["SC_LOG"],
}
open(sys.argv[1], "w").write(json.dumps(doc, indent=2, ensure_ascii=False) + "\n")
print("SIDECAR_OK", sys.argv[1])
PY
    say OK "job=$JOB_ID winner=$WINNER state=$STATE rep=$REP (before $REP_BEFORE) sidecar=web/board/sidecar/job${JOB_ID}.json log=$LOG"
    ;;
  dashboard)
    if ! lsof -nP -iTCP:8899 -sTCP:LISTEN >/dev/null 2>&1; then
      (cd "$REPO_ROOT/web/board" && python3 -m http.server 8899 --bind 127.0.0.1 > /tmp/foreman_dashboard.log 2>&1 &)
      sleep 2
    fi
    JOB_ID=$(cat "$JOB_FILE" 2>/dev/null || echo 1)
    say DASHBOARD "board server=http://127.0.0.1:8899/?job=$JOB_ID — open it any time"
    ;;
  recipe)
    JOB_ID=$(cat "$JOB_FILE")
    python3 "$HERE/make_recipe.py" "$JOB_ID" | tee -a "$LOG"
    say RECIPE "job=$JOB_ID recipe written + registered as an ephe skill"
    ;;
  *)
    echo "usage: scripts/video_run.sh <post|bids|middle|acceptdemo|finish|dashboard|recipe>" >&2
    exit 2
    ;;
esac
