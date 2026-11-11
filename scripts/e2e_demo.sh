#!/usr/bin/env bash
# phase3: full runner of the live bidding round (T3/T4 proof, T5 gate: 2x identical flow).
# Flow: gen_bids -> post_job -> sleep 5 -> bids (parallel) -> counter_offer -> award
#       -> attach_receipt -> submit_work -> accept -> view verification.
# All tx ids + commands go to .state/e2e_run<N>.log (N = running counter).
# call:   ./scripts/e2e_demo.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"

source "$HERE/_demo_common.sh"

N=1
while [[ -f "$STATE_DIR/e2e_run${N}.log" ]]; do N=$((N + 1)); done
export LOG="$STATE_DIR/e2e_run${N}.log"
: >"$LOG"
echo "== foreman e2e run $N — $(date -u +%FT%TZ) ==" >>"$LOG"

# 0) Receipt environment: real WASM path when the tools are present (otherwise the run says "mock")
# shellcheck disable=SC1091
source "$HERE/receipt_env.sh"

# 1) Seed-deterministic bids (official generator) + artifact hashes
E2E_SEED="${E2E_SEED:-foreman-demo}"
python3 "$REPO_ROOT/core/bidding/cli_bids.py" --seed "$E2E_SEED" \
  --out "$STATE_DIR/bids.json" --spec "$DEMO_SPEC" --budget-yocto "$DEMO_BUDGET_YOCTO" | tee -a "$LOG"
ADAPTER_JOB="e2e-demo-$E2E_SEED" python3 "$HERE/gen_artifact.py" | tee -a "$LOG"

# 2) Owner posts the job (deposit 0.9 NEAR, deadline now+10min)
POST_OUT=$("$HERE/post_job.sh" | tee -a "$LOG")
JOB_ID=$(sed -nE 's/.*job_id=([0-9]+).*/\1/p' <<<"$POST_OUT")
[[ -n "$JOB_ID" ]] || { echo "E2E_FAIL: no JobId parsed — check $LOG" >&2; exit 1; }

# 3) 5s buffer, then all 5 bids in parallel (window 120s)
sleep 5
"$HERE/bid_loop.sh" "$JOB_ID" | tee -a "$LOG"

# 3b) The third-party quote: a real external agent from the NEAR Agent Market, price read live.
#     No token, no hire — the two public routes (/v1/agents, /v1/agents/{id}/pricing-plans)
#     carry the identity and the price. If the market is down, the line says live=0 and names the reason.
"$HERE/market_offer.sh" | tee -a "$LOG"

# 4) One counter-offer from the boss (reasoning references acceptance_criteria)
"$HERE/counter_offer.sh" "$JOB_ID" | tee -a "$LOG"

# 5) Award by Foreman — cheapest bid wins (RULES: price -> rep -> time)
TX=$(near_call "$FOREMAN" "$CONTRACT" award "{\"job_id\":$JOB_ID}")
echo "AWARD_OK job=$JOB_ID by=$FOREMAN txid=$TX" | tee -a "$LOG"

# 6) Winner: receipt -> artifact (mandatory order RULES/receipt-before-submit)
WINNER=$(python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['winner'])" "$STATE_DIR/artifact.json")
RECEIPT=$(python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['receipt_hash'])" "$STATE_DIR/artifact.json")
ARTIFACT=$(python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['artifact_hash'])" "$STATE_DIR/artifact.json")
TX=$(near_call "$WINNER" "$CONTRACT" attach_receipt "{\"job_id\":$JOB_ID,\"receipt_hash\":\"$RECEIPT\"}")
echo "RECEIPT_OK winner=$WINNER hash=${RECEIPT:0:16}… txid=$TX" | tee -a "$LOG"
TX=$(near_call "$WINNER" "$CONTRACT" submit_work "{\"job_id\":$JOB_ID,\"artifact_hash\":\"$ARTIFACT\"}")
echo "SUBMIT_OK winner=$WINNER hash=${ARTIFACT:0:16}… txid=$TX" | tee -a "$LOG"

# 7) Payout proof: balances BEFORE accept (after submit, winner's gas already deducted)
BAL_W_BEFORE=$(near_state_amount "$WINNER")
BAL_F_BEFORE=$(near_state_amount "$FOREMAN")
REP_BEFORE=$(near_view "$CONTRACT" get_rep "{\"agent\":\"$WINNER\"}" | tr -d '[:space:]')

# Acceptance by Foreman (payout 90/10 on-chain, rep update)
TX=$(near_call "$FOREMAN" "$CONTRACT" accept "{\"job_id\":$JOB_ID,\"delivery_score\":90}")
ACCEPT_TX="$TX"
echo "ACCEPT_OK job=$JOB_ID score=90 txid=$TX" | tee -a "$LOG"

BAL_W_AFTER=$(near_state_amount "$WINNER")
BAL_F_AFTER=$(near_state_amount "$FOREMAN")
python3 - "$BAL_W_BEFORE" "$BAL_W_AFTER" "$BAL_F_BEFORE" "$BAL_F_AFTER" "$WINNER" "$FOREMAN" >>"$LOG" <<'PY'
import sys
wb, wa, fb, fa, w, f = sys.argv[1:7]
dw = (int(wa) - int(wb)) / 10**24
df = (int(fa) - int(fb)) / 10**24
ok = 0.80 <= dw <= 0.812 and 0.085 <= df <= 0.092
print(f"PAYOUT_{'OK' if ok else 'FAIL'} winner={w} delta={dw:.6f} NEAR (expected 0.9*0.9=0.81 minus gas) "
      f"foreman={f} delta={df:.6f} NEAR (expected 0.09 minus accept gas)")
sys.exit(0 if ok else 1)
PY
grep "PAYOUT_" "$LOG" | tail -1

# 8) Verification via view: state=Accepted, winner rep 54 ((50*9+90)/10)
JOB_JSON=$(near_view "$CONTRACT" get_job "{\"job_id\":$JOB_ID}")
REP=$(near_view "$CONTRACT" get_rep "{\"agent\":\"$WINNER\"}" | tr -d '[:space:]')
# near-cli 4 prints view results as a JS object (single quotes) — regex instead of a JSON parser
STATE=$(sed -nE "s/^[[:space:]]*state: '([A-Za-z]+)',?\$/\1/p" <<<"$JOB_JSON" | head -1)
# Rep check as a formula (persistent across runs!): (rep_before*9 + 90) // 10 — RULES.md sliding avg
REP_EXPECT=$(python3 -c "print(($REP_BEFORE * 9 + 90) // 10)")
[[ "$STATE" == "Accepted" && "$REP" == "$REP_EXPECT" ]] || {
  echo "E2E_FAIL: state=$STATE rep=$REP (expected Accepted/$REP_EXPECT from rep_before=$REP_BEFORE) — $LOG" >&2; exit 1; }

# 8b) Sidecar for the bid board (phase4.2, reads web/board/sidecar/job<N>.json):
# payout occurs inside the accept tx (transfer receipts) — same tx id in both fields.
COUNTER_REASON_RAW=$(near_view "$CONTRACT" get_counter_reason "{\"job_id\":$JOB_ID}" | tr -d '\n')
SIDECAR="$REPO_ROOT/web/board/sidecar/job${JOB_ID}.json"
mkdir -p "$(dirname "$SIDECAR")"
SC_JOB="$JOB_ID" SC_PAYOUT_TX="$ACCEPT_TX" SC_ACCEPT_TX="$ACCEPT_TX" SC_REASON="$COUNTER_REASON_RAW" \
  SC_WINNER="$WINNER" SC_LOG="$LOG" \
  python3 - "$SIDECAR" <<'PY'
import json, os, sys
raw = os.environ["SC_REASON"].strip()
if raw == "null":
    reason = ""
else:  # near-cli JS object output: 'text' or "text"
    reason = raw.strip().strip("'\"")
doc = {
    "job_id": int(os.environ["SC_JOB"]),
    "payout_tx": os.environ["SC_PAYOUT_TX"],
    "payout_tx_label": "accept tx with payout transfer (90/10, RULES.md)",
    "accept_tx": os.environ["SC_ACCEPT_TX"],
    "counter_reason": reason,
    "winner": os.environ["SC_WINNER"],
    "e2e_log": os.environ["SC_LOG"],
}
open(sys.argv[1], "w").write(json.dumps(doc, indent=2, ensure_ascii=False) + "\n")
print("SIDECAR_OK", sys.argv[1])
PY
grep SIDECAR_OK "$LOG" || echo "SIDECAR_OK $SIDECAR" >>"$LOG"

echo "E2E_OK run=$N job=$JOB_ID winner=$WINNER state=$STATE rep=$REP (before $REP_BEFORE) sidecar=web/board/sidecar/job${JOB_ID}.json log=$LOG" | tee -a "$LOG"
