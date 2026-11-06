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

# near_call <signer> <contract> <method> <json-args> [extra near-flags...]
# Loggt Kommando + Ausgabe in $LOG, prueft auf Failure, gibt Tx-ID auf stdout zurueck.
near_call() {
  local who="$1" contract="$2" method="$3" args="$4"
  shift 4
  local out rc txid
  echo "+ near call $contract $method '$args' --accountId $who" >>"$LOG"
  if ! out=$(near call "$contract" "$method" "$args" \
      --accountId "$who" --networkId testnet --gas "$GAS" "$@" 2>&1); then rc=1; else rc=0; fi
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
  echo "+ near view $contract $method '$args'" >>"$LOG"
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
