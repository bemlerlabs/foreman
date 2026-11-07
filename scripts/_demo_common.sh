#!/usr/bin/env bash
# phase3: gemeinsame Bibliothek für die Live-Biet-Runde (post_job/bid_loop/counter_offer/e2e_demo).
# KEINE Secrets hier — Accounts aus .env (Repository-Regel), Signatur via ~/.near-credentials/testnet.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PATH="$HOME/.cargo/bin:$PATH"

if [[ -f "$REPO_ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$REPO_ROOT/.env"
  set +a
fi

# Accounts (.env-Belegung hat Vorrang, Defaults laut deployed-Setup T1)
CONTRACT="${CONTRACT_ACCOUNT:-escrow.foreman-team.testnet}"
OWNER="${OWNER_ACCOUNT:-foreman-team.testnet}"
FOREMAN="${FOREMAN_ACCOUNT:-boss.foreman-team.testnet}"
AGENTS_DEFAULT="agent1.foreman-team.testnet,agent2.foreman-team.testnet,agent3.foreman-team.testnet,agent4.foreman-team.testnet,agent5.foreman-team.testnet"
AGENTS="${SWARM_ACCOUNTS:-$AGENTS_DEFAULT}"

# Demo-Job (KANONISCH — gen_bids.py muss identische Werte sehen, sonst falsche Preise)
export DEMO_SPEC="${DEMO_SPEC:-research-report: NEAR testnet RPC latency, finality and gas costs across 3 regions; deliver CSV + summary + sources}"
export DEMO_CRITERIA_JSON="${DEMO_CRITERIA_JSON:-[\"#1 summary <=300 words\",\"#2 CSV data table\",\"#3 cited sources\"]}"
export DEMO_BUDGET_YOCTO="${DEMO_BUDGET_YOCTO:-900000000000000000000000}" # 0.9 NEAR (RULES: Budget <= 3 USD)
DEADLINE_SECONDS="${DEADLINE_SECONDS:-600}"                                # Lead-Vorgabe: now + 10 min
GAS="${GAS:-100000000000000}"                                              # 100 TGas

LOG="${LOG:-/tmp/foreman_e2e_manual.log}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Fund 07.11.: Der Default-Testnet-RPC war zeitweise DEPRECATED-429 (TooManyRequests bei Biet-Bursts);
# 11:15 Uhr wieder gesund (6/6 gas_price OK). near-cli 4 (config.js) liest den Endpoint aus
# NEAR_TESTNET_RPC; --networkId bleibt testnet (Keychain-Pfad ~/.near-credentials/testnet unverändert).
# Fallback nur zum LESEN: https://near-testnet.drpc.org (block/view/gas OK; broadcast_* deaktiviert,
# send_tx für vorzeichen-signierte Txs vorhanden). Override via RPC_URL=<url>.
RPC_URL="${RPC_URL:-https://rpc.testnet.near.org}"
export NEAR_TESTNET_RPC="$RPC_URL"

# near_call <signer> <contract> <method> <json-args> [extra near-flags...]
# Loggt Kommando + Ausgabe in $LOG, prueft auf Failure, gibt Tx-ID auf stdout zurueck.
near_call() {
  local who="$1" contract="$2" method="$3" args="$4"
  shift 4
  local out rc txid attempt=1
  echo "+ near call $contract $method '$args' --accountId $who --rpc $RPC_URL" >>"$LOG"
  while :; do
    if ! out=$(near call "$contract" "$method" "$args" \
        --accountId "$who" --networkId testnet --gas "$GAS" "$@" 2>&1); then rc=1; else rc=0; fi
    # T5-Härtung 07.11.: Testnet-RPC drosselt bei Bursts mit -429 (TooManyRequests).
    # Retry mit Backoff — 429 trifft typisch das Polling/Access-Key-HOLEN vor Broadcast;
    # methods mit Seiteneffekten werden zusätzlich über View-Checks im Runner verifiziert.
    if [[ $rc -ne 0 && "$out" == *TooManyRequests* && $attempt -lt 4 ]]; then
      echo "  .. 429 vom RPC, Retry $attempt/3 in $((attempt * 15))s (method=$method)" >>"$LOG"
      sleep $((attempt * 15)); attempt=$((attempt + 1)); continue
    fi
    break
  done
  # Fallback 07.11.: persistenter 429 auf broadcast-Route -> lokal signieren + send_tx
  # über scripts/near_send.cjs (getestet gegen dRPC; Secrets bleiben in der Keychain).
  if [[ $rc -ne 0 && "$out" == *TooManyRequests* ]]; then
    echo "  .. 429 persistent, Fallback near_send.cjs (lokal signiert, send_tx via \$FALLBACK_RPC)" >>"$LOG"
    local dep=0 a prev_flag=""
    for a in "$@"; do
      if [[ "$prev_flag" == "--depositYocto" ]]; then dep="$a"; fi
      prev_flag="$a"
    done
    out=$(RPC_URL="${FALLBACK_RPC:-https://near-testnet.drpc.org}" \
      node "$SCRIPT_DIR/near_send.cjs" "$who" "$contract" "$method" "$args" \
      "$dep" "$GAS" 2>&1) && rc=0 || rc=$?
    # near_send exit 3 = Tx gelandet mit Contract-Failure -> CALL-FAIL-Pfad unten
  fi
  echo "$out" >>"$LOG"
  LAST_CALL_FILE="${LAST_CALL_FILE:-/tmp/foreman_last_call_out}"
  printf '%s' "$out" >"$LAST_CALL_FILE"
  if [[ $rc -ne 0 ]] || grep -qE '"Failure"|Failed|Error:' <<<"$out"; then
    echo "CALL-FAIL method=$method signer=$who args=$args" >&2
    tail -8 <<<"$out" >&2
    return 1
  fi
  # near-cli 4 druckt "Transaction Id <base58>" — primärer Parser, JSON nur Fallback.
  txid=$(grep -oE 'Transaction Id [1-9A-HJ-NP-Za-km-z]{40,}' <<<"$out" | awk '{print $3}' | head -1)
  if [[ -z "$txid" ]]; then
    txid=$(python3 - "$out" <<'PY'
import json, re, sys
s = sys.argv[1]
m = re.search(r'\{.*\}', s, re.S)
if m:
    try:
        d = json.loads(m.group(0))
        print(d.get("transaction_outcome", {}).get("id", ""))
    except Exception:
        pass
PY
)
  fi
  echo "$txid"
}

# near_view <contract> <method> <json-args> — View-Call, schreibt JSON nach stdout.
near_view() {
  local contract="$1" method="$2" args="$3"
  local out
  echo "+ near view $contract $method '$args' --rpc $RPC_URL" >>"$LOG"
  out=$(near view "$contract" "$method" "$args" --networkId testnet 2>&1) || { echo "$out" >>"$LOG"; return 1; }
  echo "$out" >>"$LOG"
  # near-cli druckt "View call: ..." als Kopfzeile — für Parser entfernen, nur Ergebnis lassen
  sed '/^View call: /d' <<<"$out"
}

# near_state_amount <account> — Kontostand in yocto (amount-Feld, ohne locked_amount).
near_state_amount() {
  near state "$1" --networkId testnet 2>&1 | python3 -c "
import re, sys
for line in sys.stdin:
    if 'locked' in line:
        continue
    m = re.search(r'''amount[\"']?\s*:\s*[\"']([0-9]+)''', line)
    if m:
        print(m.group(1)); break
else:
    print('')"
}

# call_result <text> — JobId aus dem Contract-Log foreman:job_opened|id=N (primär), sonst Result-Feld.
call_result() {
  local txt="$1" id
  id=$(grep -oE 'foreman:job_opened\|id=[0-9]+' <<<"$txt" | grep -oE '[0-9]+$' | head -1)
  if [[ -z "$id" ]]; then
    id=$(grep -oE 'Result: *"?[0-9]+' <<<"$txt" | grep -oE '[0-9]+$' | head -1)
  fi
  echo "$id"
}
