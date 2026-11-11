#!/usr/bin/env bash
# phase3: shared library for the live bidding round (post_job/bid_loop/counter_offer/e2e_demo).
# NO secrets here — accounts from .env (repository rule), signing via ~/.near-credentials/testnet.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# State lives inside the checkout: the Ephe agent sandbox denies /tmp writes.
STATE_DIR="${FOREMAN_STATE_DIR:-$REPO_ROOT/.state}"
mkdir -p "$STATE_DIR"
export PATH="$HOME/.cargo/bin:$PATH"

if [[ -f "$REPO_ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$REPO_ROOT/.env"
  set +a
fi

# Accounts (.env assignment wins, defaults per deployed setup T1)
CONTRACT="${CONTRACT_ACCOUNT:-escrow.foreman-team.testnet}"
OWNER="${OWNER_ACCOUNT:-foreman-team.testnet}"
FOREMAN="${FOREMAN_ACCOUNT:-boss.foreman-team.testnet}"
AGENTS_DEFAULT="agent1.foreman-team.testnet,agent2.foreman-team.testnet,agent3.foreman-team.testnet,agent4.foreman-team.testnet,agent5.foreman-team.testnet"
AGENTS="${SWARM_ACCOUNTS:-$AGENTS_DEFAULT}"

# Demo job (CANONICAL — gen_bids.py must see identical values, otherwise wrong prices)
export DEMO_SPEC="${DEMO_SPEC:-research-report: NEAR testnet RPC latency, finality and gas costs across 3 regions; deliver CSV + summary + sources}"
export DEMO_CRITERIA_JSON="${DEMO_CRITERIA_JSON:-[\"#1 summary <=300 words\",\"#2 CSV data table\",\"#3 cited sources\"]}"
export DEMO_BUDGET_YOCTO="${DEMO_BUDGET_YOCTO:-900000000000000000000000}" # 0.9 NEAR (RULES: Budget <= 3 USD)
DEADLINE_SECONDS="${DEADLINE_SECONDS:-600}"                                # lead directive: now + 10 min
GAS="${GAS:-100000000000000}"                                              # 100 TGas

LOG="${LOG:-$STATE_DIR/e2e_manual.log}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Finding 07.11.: the default testnet RPC was temporarily DEPRECATED-429 (TooManyRequests on bid bursts);
# healthy again at 11:15 (6/6 gas_price OK). near-cli 4 (config.js) reads the endpoint from
# NEAR_TESTNET_RPC; --networkId stays testnet (keychain path ~/.near-credentials/testnet unchanged).
# Fallback for READS only: https://near-testnet.drpc.org (block/view/gas OK; broadcast_* disabled,
# send_tx available for pre-signed txs). Override via RPC_URL=<url>.
RPC_URL="${RPC_URL:-https://rpc.testnet.near.org}"
# Reads may fall back (the primary RPC throttles the bid burst).
FALLBACK_RPC="${FALLBACK_RPC:-https://near-testnet.drpc.org}"
export NEAR_TESTNET_RPC="$RPC_URL"

# near_call <signer> <contract> <method> <json-args> [extra near-flags...]
# Logs command + output to $LOG, checks for failure, returns the tx id on stdout.
near_call() {
  local who="$1" contract="$2" method="$3" args="$4"
  shift 4
  local out rc txid attempt=1
  echo "+ near call $contract $method '$args' --accountId $who --rpc $RPC_URL" >>"$LOG"
  while :; do
    if ! out=$(near call "$contract" "$method" "$args" \
        --accountId "$who" --networkId testnet --gas "$GAS" "$@" 2>&1); then rc=1; else rc=0; fi
    # T5 hardening 07.11.: the testnet RPC throttles bursts with -429 (TooManyRequests).
    # Retry with backoff — 429 typically hits polling/access-key FETCHING before broadcast;
    # methods with side effects are additionally verified via view checks in the runner.
    if [[ $rc -ne 0 && "$out" == *TooManyRequests* && $attempt -lt 4 ]]; then
      echo "  .. 429 from RPC, retry $attempt/3 in $((attempt * 15))s (method=$method)" >>"$LOG"
      sleep $((attempt * 15)); attempt=$((attempt + 1)); continue
    fi
    break
  done
  # Fallback 07.11.: persistent 429 on the broadcast route -> sign locally + send_tx
  # via scripts/near_send.cjs (tested against dRPC; secrets stay in the keychain).
  if [[ $rc -ne 0 && "$out" == *TooManyRequests* ]]; then
    echo "  .. 429 persistent, fallback near_send.cjs (signed locally, send_tx via \$FALLBACK_RPC)" >>"$LOG"
    local dep=0 a prev_flag=""
    for a in "$@"; do
      if [[ "$prev_flag" == "--depositYocto" ]]; then dep="$a"; fi
      prev_flag="$a"
    done
    out=$(RPC_URL="${FALLBACK_RPC:-https://near-testnet.drpc.org}" \
      node "$SCRIPT_DIR/near_send.cjs" "$who" "$contract" "$method" "$args" \
      "$dep" "$GAS" 2>&1) && rc=0 || rc=$?
    # near_send exit 3 = tx landed with a contract failure -> CALL-FAIL path below
  fi
  echo "$out" >>"$LOG"
  LAST_CALL_FILE="${LAST_CALL_FILE:-$STATE_DIR/last_call_out}"
  printf '%s' "$out" >"$LAST_CALL_FILE"
  if [[ $rc -ne 0 ]] || grep -qE '"Failure"|Failed|Error:' <<<"$out"; then
    echo "CALL-FAIL method=$method signer=$who args=$args" >&2
    tail -8 <<<"$out" >&2
    return 1
  fi
  # near-cli 4 prints "Transaction Id <base58>" — primary parser, JSON only as fallback.
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

# near_view <contract> <method> <json-args> — view call, writes JSON to stdout.
# Reads get the same 429 discipline as writes: the public testnet endpoint throttles a burst,
# and a demo that dies on a balance read is not a failed demo, it is a failed instrument.
near_view() {
  local contract="$1" method="$2" args="$3"
  local out attempt=1
  echo "+ near view $contract $method '$args' --rpc $RPC_URL" >>"$LOG"
  while :; do
    if out=$(near view "$contract" "$method" "$args" --networkId testnet 2>&1); then
      break
    fi
    if grep -qE "429|TooManyRequests|unused for some time" <<<"$out" && (( attempt < 4 )); then
      echo "  .. view 429, retry $attempt/3 in $((attempt * 5))s (method=$method)" >>"$LOG"
      sleep $((attempt * 5)); attempt=$((attempt + 1)); continue
    fi
    if grep -qE "429|TooManyRequests" <<<"$out" && [[ -n "${FALLBACK_RPC:-}" ]]; then
      # Reads are allowed on the fallback; the primary only throttles this demo's burst.
      echo "  .. view 429 persistent, reading via fallback $FALLBACK_RPC (method=$method)" >>"$LOG"
      if out=$(NEAR_TESTNET_RPC="$FALLBACK_RPC" near view "$contract" "$method" "$args" --networkId testnet 2>&1); then
        break
      fi
    fi
    echo "$out" >>"$LOG"; return 1
  done
  echo "$out" >>"$LOG"
  # near-cli prints "View call: ..." as a header — strip it for parsers, keep only the result
  sed '/^View call: /d' <<<"$out"
}

# near_state_amount <account> — balance in yocto (amount field, without locked_amount).
# Same 429 discipline: a throttled read must not end a run that has already paid out.
near_state_amount() {
  local out attempt=1
  while :; do
    if out=$(near state "$1" --networkId testnet 2>&1) && grep -q "amount:" <<<"$out"; then
      break
    fi
    if grep -qE "429|TooManyRequests|unused for some time" <<<"$out" && (( attempt < 4 )); then
      echo "  .. state 429, retry $attempt/3 in $((attempt * 5))s" >>"$LOG"
      sleep $((attempt * 5)); attempt=$((attempt + 1)); continue
    fi
    if grep -qE "429|TooManyRequests" <<<"$out" && [[ -n "${FALLBACK_RPC:-}" ]]; then
      echo "  .. state 429 persistent, reading via fallback $FALLBACK_RPC" >>"$LOG"
      if out=$(NEAR_TESTNET_RPC="$FALLBACK_RPC" near state "$1" --networkId testnet 2>&1) && grep -q "amount:" <<<"$out"; then
        break
      fi
    fi
    printf '%s\n' "$out" >>"$LOG"; break
  done
  printf '%s\n' "$out" | python3 -c "
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

# call_result <text> — JobId from the contract log foreman:job_opened|id=N (primary), else the Result field.
call_result() {
  local txt="$1" id
  id=$(grep -oE 'foreman:job_opened\|id=[0-9]+' <<<"$txt" | grep -oE '[0-9]+$' | head -1)
  if [[ -z "$id" ]]; then
    id=$(grep -oE 'Result: *"?[0-9]+' <<<"$txt" | grep -oE '[0-9]+$' | head -1)
  fi
  echo "$id"
}
