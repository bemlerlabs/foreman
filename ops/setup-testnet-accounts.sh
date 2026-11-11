#!/usr/bin/env bash
# Reproducible testnet setup for the Foreman fleet (Q-012-friendly, throwaway accounts).
# Usage: bash ops/setup-testnet-accounts.sh  (requires near-cli 4 + rustup path)
set -euo pipefail
export PATH="$HOME/.cargo/bin:$PATH"
PARENT="${PARENT:-foreman-team.testnet}"

create_if_missing() {
  local acct="$1"; shift
  if near state "$acct" --networkId testnet >/dev/null 2>&1; then
    echo "exists: $acct"; return 0
  fi
  near create-account "$@" | tail -1
}

# If the parent is missing: fund it via throwaway faucet accounts (testnet faucet gives 10 N per account)
if ! near state "$PARENT" --networkId testnet >/dev/null 2>&1; then
  near create-account "$PARENT" --useFaucet --networkId testnet | tail -1
  for i in 1 2; do
    W="foremanfaucet${i}.testnet"
    near create-account "$W" --useFaucet --networkId testnet | tail -1
    near send-near "$W" "$PARENT" 9 --networkId testnet | tail -1
  done
fi

for name in escrow treasury boss agent1 agent2 agent3 agent4 agent5; do
  create_if_missing "${name}.${PARENT}" --new-account-id "${name}.${PARENT}" --useAccount "$PARENT" --initialBalance 1.5
done
echo "Done. Credentials: ~/.near-credentials/testnet/*.json"
