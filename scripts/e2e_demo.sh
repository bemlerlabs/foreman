#!/usr/bin/env bash
# phase3: Voll-Runner der Live-Biet-Runde (T3/T4-Beweis, T5-Gate: 2x identischer Ablauf).
# Ablauf: gen_bids -> post_job -> sleep 5 -> bids (parallel) -> counter_offer -> award
#         -> attach_receipt -> submit_work -> accept -> View-Verifikation.
# Alle Tx-IDs + Kommandos nach /tmp/foreman_e2e_run<N>.log (N = laufender Zaehler).
# Aufruf:   ./scripts/e2e_demo.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"

N=1
while [[ -f "/tmp/foreman_e2e_run${N}.log" ]]; do N=$((N + 1)); done
export LOG="/tmp/foreman_e2e_run${N}.log"
: >"$LOG"
echo "== foreman e2e run $N — $(date -u +%FT%TZ) ==" >>"$LOG"

source "$HERE/_demo_common.sh"

# 0) Receipt-Umgebung: echter WASM-Pfad, wenn die Werkzeuge da sind (sonst sagt der Lauf "mock")
# shellcheck disable=SC1091
source "$HERE/receipt_env.sh"

# 1) Seed-deterministische Bids (offizieller Generator von asset-scout) + Artefakt-Hashes
E2E_SEED="${E2E_SEED:-foreman-demo}"
python3 "$REPO_ROOT/core/bidding/cli_bids.py" --seed "$E2E_SEED" \
  --out /tmp/foreman_bids.json --spec "$DEMO_SPEC" --budget-yocto "$DEMO_BUDGET_YOCTO" | tee -a "$LOG"
ADAPTER_JOB="e2e-demo-$E2E_SEED" python3 "$HERE/gen_artifact.py" | tee -a "$LOG"

# 2) Owner postet Job (Deposit 0.9 NEAR, Deadline now+10min)
POST_OUT=$("$HERE/post_job.sh" | tee -a "$LOG")
JOB_ID=$(sed -nE 's/.*job_id=([0-9]+).*/\1/p' <<<"$POST_OUT")
[[ -n "$JOB_ID" ]] || { echo "E2E_FAIL: keine JobId geparst — $LOG pruefen" >&2; exit 1; }

# 3) 5s Puffer, dann alle 5 Bids parallel (Fenster 120s)
sleep 5
"$HERE/bid_loop.sh" "$JOB_ID" | tee -a "$LOG"

# 3b) Das Dritt-Angebot: ein echter Fremd-Agent vom NEAR Agent Market, Preis live gelesen.
#     Ohne Token, ohne Hire — die beiden oeffentlichen Routen (/v1/agents, /v1/agents/{id}/pricing-plans)
#     tragen die Identitaet und den Preis. Ist der Markt weg, sagt die Zeile live=0 und nennt den Grund.
"$HERE/market_offer.sh" | tee -a "$LOG"

# 4) Eine Gegenofferte vom boss (Begruendung mit acceptance_criteria-Referenz)
"$HERE/counter_offer.sh" "$JOB_ID" | tee -a "$LOG"

# 5) Award durch Foreman — guenstigster Bid gewinnt (RULES: price -> rep -> zeit)
TX=$(near_call "$FOREMAN" "$CONTRACT" award "{\"job_id\":$JOB_ID}")
echo "AWARD_OK job=$JOB_ID by=$FOREMAN txid=$TX" | tee -a "$LOG"

# 6) Gewinner: Receipt -> Artefakt (Pflichtreihenfolge RULES/Receipt-before-submit)
WINNER=$(python3 -c "import json;print(json.load(open('/tmp/foreman_artifact.json'))['winner'])")
RECEIPT=$(python3 -c "import json;print(json.load(open('/tmp/foreman_artifact.json'))['receipt_hash'])")
ARTIFACT=$(python3 -c "import json;print(json.load(open('/tmp/foreman_artifact.json'))['artifact_hash'])")
TX=$(near_call "$WINNER" "$CONTRACT" attach_receipt "{\"job_id\":$JOB_ID,\"receipt_hash\":\"$RECEIPT\"}")
echo "RECEIPT_OK winner=$WINNER hash=${RECEIPT:0:16}… txid=$TX" | tee -a "$LOG"
TX=$(near_call "$WINNER" "$CONTRACT" submit_work "{\"job_id\":$JOB_ID,\"artifact_hash\":\"$ARTIFACT\"}")
echo "SUBMIT_OK winner=$WINNER hash=${ARTIFACT:0:16}… txid=$TX" | tee -a "$LOG"

# 7) Payout-Beweis: Balancen VOR accept (nach submit, Gas des Winners bereits abgezogen)
BAL_W_BEFORE=$(near_state_amount "$WINNER")
BAL_F_BEFORE=$(near_state_amount "$FOREMAN")
REP_BEFORE=$(near_view "$CONTRACT" get_rep "{\"agent\":\"$WINNER\"}" | tr -d '[:space:]')

# Abnahme durch Foreman (Payout 90/10 on-chain, rep-Update)
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
print(f"PAYOUT_{'OK' if ok else 'FAIL'} winner={w} delta={dw:.6f} NEAR (soll 0.9*0.9=0.81 abzgl. Gas) "
      f"foreman={f} delta={df:.6f} NEAR (soll 0.09 abzgl. accept-Gas)")
sys.exit(0 if ok else 1)
PY
grep "PAYOUT_" "$LOG" | tail -1

# 8) Verifikation per View: state=Accepted, Rep des Gewinners 54 ((50*9+90)/10)
JOB_JSON=$(near_view "$CONTRACT" get_job "{\"job_id\":$JOB_ID}")
REP=$(near_view "$CONTRACT" get_rep "{\"agent\":\"$WINNER\"}" | tr -d '[:space:]')
# near-cli 4 druckt View-Ergebnisse als JS-Objekt (Einfachquoten) — Regex statt JSON-Parser
STATE=$(sed -nE "s/^[[:space:]]*state: '([A-Za-z]+)',?\$/\1/p" <<<"$JOB_JSON" | head -1)
# Rep-Check als Formel (persistent über Läufe!): (rep_before*9 + 90) // 10 — RULES.md sliding avg
REP_EXPECT=$(python3 -c "print(($REP_BEFORE * 9 + 90) // 10)")
[[ "$STATE" == "Accepted" && "$REP" == "$REP_EXPECT" ]] || {
  echo "E2E_FAIL: state=$STATE rep=$REP (erwartet Accepted/$REP_EXPECT bei rep_before=$REP_BEFORE) — $LOG" >&2; exit 1; }

# 8b) Sidecar fürs Biet-Board (phase4.2, asset-scout liest web/board/sidecar/job<N>.json):
# payout occurs innerhalb der accept-tx (Transfer-Receipts) — beiden Feldern gleiche Tx-ID.
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
else:  # near-cli JS-Objekt-Ausgabe: 'text' oder "text"
    reason = raw.strip().strip("'\"")
doc = {
    "job_id": int(os.environ["SC_JOB"]),
    "payout_tx": os.environ["SC_PAYOUT_TX"],
    "payout_tx_label": "accept-tx mit payout-transfer (90/10, RULES.md)",
    "accept_tx": os.environ["SC_ACCEPT_TX"],
    "counter_reason": reason,
    "winner": os.environ["SC_WINNER"],
    "e2e_log": os.environ["SC_LOG"],
}
open(sys.argv[1], "w").write(json.dumps(doc, indent=2, ensure_ascii=False) + "\n")
print("SIDECAR_OK", sys.argv[1])
PY
grep SIDECAR_OK "$LOG" || echo "SIDECAR_OK $SIDECAR" >>"$LOG"

echo "E2E_OK run=$N job=$JOB_ID winner=$WINNER state=$STATE rep=$REP (vorher $REP_BEFORE) sidecar=$SIDECAR log=$LOG" | tee -a "$LOG"
