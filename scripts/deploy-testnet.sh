#!/usr/bin/env bash
# phase1: deploys foreman.wasm to testnet via cargo-near 0.22 (build + deploy + init in one step).
#
# Usage:  ./scripts/deploy-testnet.sh
# Prereq: near login (keychain credentials of the contract account), cargo-near installed,
#         .env with CONTRACT_ACCOUNT / OWNER_ACCOUNT / TREASURY_ACCOUNT / FOREMAN_ACCOUNT (see .env.example).
# Init:   new(owner, treasury, foreman)  — contract API: see contracts/foreman/src/lib.rs.
# Note:   secrets stay in .env (NEVER commit). Signing uses the user's local keychain keys.
set -euo pipefail
cd "$(dirname "$0")/.."

export PATH="$HOME/.cargo/bin:$PATH" # rustup shims MUST precede Homebrew in PATH (EVIDENCE_LOG T0)

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

for var in CONTRACT_ACCOUNT OWNER_ACCOUNT TREASURY_ACCOUNT FOREMAN_ACCOUNT; do
  if [[ -z "${!var:-}" ]]; then
    echo "ERROR: \$$var missing in .env (template: .env.example)" >&2
    exit 1
  fi
done

# Testnet discipline: only *.testnet named accounts or 64-hex implicit accounts.
for var in CONTRACT_ACCOUNT OWNER_ACCOUNT TREASURY_ACCOUNT FOREMAN_ACCOUNT; do
  val="${!var}"
  if [[ ! "$val" == *.testnet && ! "$val" =~ ^[0-9a-f]{64}$ ]]; then
    echo "ERROR: \$$var='$val' is not a testnet account (*.testnet or 64-hex implicit)" >&2
    exit 1
  fi
done

command -v cargo >/dev/null 2>&1 || { echo "ERROR: cargo not found (install rustup)" >&2; exit 1; }
cargo near --version >/dev/null 2>&1 || {
  echo "ERROR: cargo-near missing -> cargo install cargo-near" >&2
  exit 1
}

INIT_ARGS=$(printf '{"owner":"%s","treasury":"%s","foreman":"%s"}' \
  "$OWNER_ACCOUNT" "$TREASURY_ACCOUNT" "$FOREMAN_ACCOUNT")

cd contracts/foreman
# cargo-near 0.22 transaction-builder chain: deploy(build) -> init new() -> prepaid-gas -> network -> sign -> send.
# Formats: gas as "N TGas", deposit with token unit ("0NEAR") — the cargo-near parser requires units (T1 deploy verified).
# phase1.2: full ABI (NEP-330) — --no-abi removed, Job/Bid/JobState carry NearSchema derives.
cargo near deploy build-non-reproducible-wasm "$CONTRACT_ACCOUNT" \
  with-init-call new json-args "$INIT_ARGS" \
  prepaid-gas "100 TGas" \
  attached-deposit "0NEAR" \
  network-config testnet \
  sign-with-keychain send

echo "OK: foreman deployed -> $CONTRACT_ACCOUNT (testnet, init new(owner,treasury,foreman))."
echo "-> Record the tx id + account in docs/EVIDENCE_LOG.md line T1 (artifact duty, RULES.md)."
