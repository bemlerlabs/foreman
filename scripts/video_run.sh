#!/usr/bin/env bash
# phase7: Video-Runden-Runner für die Hackathon-Aufnahmen (09.11.).
# Bewusst PHASEN-WEISE statt e2e_demo.sh: der Lead braucht Meldungs-/Aufnahme-Fenster
# zwischen den Schritten, und S6 verlangt die accept-ohne-Receipt-Ablehnung VOR dem
# echten Receipt-Pfad (S7/S8).
#
# aufruf: scripts/video_run.sh <post|bids|middle|acceptdemo|finish>
#   post       — biets+artifact erzeugen, post_job, Job-ID ausgeben (danach: job-ID melden!)
#   bids       — 25-30s Handbremse (Countdown >60s im Frame), dann 5 Bids parallel
#   middle     — counter_offer (boss) + award (boss)
#   acceptdemo — S6: accept VOR receipt -> Erwartung NOT_DELIVERED (rc!=0, im Terminal sichtbar)
#   finish     — attach_receipt+submit_work (winner), Payout-Beweis, accept, Sidecar, VIDEO_OK
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
source "$HERE/_demo_common.sh"

export E2E_SEED="${E2E_SEED:-video-final-09nov}"
export LOG="${LOG:-/tmp/foreman_e2e_video_09nov.log}"
BREMSE="${BREMSE:-27}"   # Handbremse nach post: Bids eintreffend bei Countdown ~90s (120s-Fenster, 4s Skew-Puffer)
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
    say POSTED "job=$JOB_ID txid=$TX seed=$E2E_SEED budget=0.9NEAR deadline=+${DEADLINE_SECONDS}s — JETZT job-ID melden, dann bids-Phase"
    ;;
  bids)
    JOB_ID=$(cat "$JOB_FILE")
    say BRAKE "Handbremse ${BREMSE}s laufen lassen (Countdown im Frame prüfen), dann 5 Bids parallel"
    sleep "$BREMSE"
    BIDS_FILE=/tmp/foreman_bids.json "$HERE/bid_loop.sh" "$JOB_ID"
    ;;
  middle)
    JOB_ID=$(cat "$JOB_FILE")
    "$HERE/counter_offer.sh" "$JOB_ID"
    TX=$(near_call "$FOREMAN" "$CONTRACT" award "{\"job_id\":$JOB_ID}")
    WINNER=$(python3 -c "import json;print(json.load(open('/tmp/foreman_artifact.json'))['winner'])")
    say AWARD "job=$JOB_ID winner=$WINNER txid=$TX"
    ;;
  acceptdemo)
    JOB_ID=$(cat "$JOB_FILE")
    say S6 "accept OHNE receipt/submit — erwartet: Contract-Panic NOT_DELIVERED (Terminal-Shot)"
    set +e
    TX=$(near_call "$FOREMAN" "$CONTRACT" accept "{\"job_id\":$JOB_ID,\"delivery_score\":90}")
    RC=$?
    set -e
    if [[ $RC -ne 0 ]] && grep -q "NOT_DELIVERED" "${LAST_CALL_FILE:-/tmp/foreman_last_call_out}"; then
      say S6_OK "accept ohne Deliverable abgewiesen: NOT_DELIVERED (rc=$RC) — Board zeigt weiter Awarded"
    else
      echo "VIDEO_FAIL S6: accept wurde NICHT wie erwartet abgewiesen (rc=$RC) — LAUF HALTEN, lead informieren" >&2
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
    say ACCEPT "job=$JOB_ID score=90 txid=$TX — JETZT accept gemeldet: S7/S8-Shots"
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
      echo "VIDEO_FAIL verify: state=$STATE rep=$REP (erwartet Accepted/$REP_EXPECT bei $REP_BEFORE) — $LOG" >&2; exit 1; }
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
    "payout_tx_label": "accept-tx mit payout-transfer (90/10, RULES.md) — Video-Runde 09.11.",
    "accept_tx": os.environ["SC_ACCEPT_TX"],
    "counter_reason": reason,
    "winner": os.environ["SC_WINNER"],
    "e2e_log": os.environ["SC_LOG"],
}
open(sys.argv[1], "w").write(json.dumps(doc, indent=2, ensure_ascii=False) + "\n")
print("SIDECAR_OK", sys.argv[1])
PY
    say OK "job=$JOB_ID winner=$WINNER state=$STATE rep=$REP (vorher $REP_BEFORE) sidecar=$SIDECAR log=$LOG"
    ;;
  *)
    echo "usage: scripts/video_run.sh <post|bids|middle|acceptdemo|finish>" >&2
    exit 2
    ;;
esac
