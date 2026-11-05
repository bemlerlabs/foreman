#!/usr/bin/env bash
# phase1: Deployt foreman.wasm auf Testnet via cargo-near 0.22 (build + deploy + init in einem Schritt).
#
# Nutzung:  ./scripts/deploy-testnet.sh
# Voraus:   near login (Keychain-Credentials des Contract-Accounts), cargo-near installiert,
#           .env mit CONTRACT_ACCOUNT / OWNER_ACCOUNT / TREASURY_ACCOUNT / FOREMAN_ACCOUNT (siehe .env.example).
# Init:     new(owner, treasury, foreman)  — Vertrags-API siehe contracts/foreman/src/lib.rs.
# Achtung:  Secrets bleiben in .env (NIE committen). Signiert wird mit lokalen Keychain-Keys des Users.
set -euo pipefail
cd "$(dirname "$0")/.."

export PATH="$HOME/.cargo/bin:$PATH" # rustup-Shims MÜSSEN vor Homebrew im PATH stehen (EVIDENCE_LOG T0)

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

for var in CONTRACT_ACCOUNT OWNER_ACCOUNT TREASURY_ACCOUNT FOREMAN_ACCOUNT; do
  if [[ -z "${!var:-}" ]]; then
    echo "ERROR: \$$var fehlt in .env (Vorlage: .env.example)" >&2
    exit 1
  fi
done

# Testnet-Disziplin: nur *.testnet-Named-Accounts oder 64- hex Implicit-Accounts.
for var in CONTRACT_ACCOUNT OWNER_ACCOUNT TREASURY_ACCOUNT FOREMAN_ACCOUNT; do
  val="${!var}"
  if [[ ! "$val" == *.testnet && ! "$val" =~ ^[0-9a-f]{64}$ ]]; then
    echo "ERROR: \$$var='$val' ist kein Testnet-Account (*.testnet oder 64-hex implicit)" >&2
    exit 1
  fi
done

command -v cargo >/dev/null 2>&1 || { echo "ERROR: cargo nicht gefunden (rustup installieren)" >&2; exit 1; }
cargo near --version >/dev/null 2>&1 || {
  echo "ERROR: cargo-near fehlt -> cargo install cargo-near" >&2
  exit 1
}

INIT_ARGS=$(printf '{"owner":"%s","treasury":"%s","foreman":"%s"}' \
  "$OWNER_ACCOUNT" "$TREASURY_ACCOUNT" "$FOREMAN_ACCOUNT")

cd contracts/foreman
# cargo-near 0.22 Transaction-Builder-Kette: deploy(build) -> init new() -> prepaid-gas -> network -> sign -> send.
# Formate: Gas als "N TGas", Deposit mit Token-Unit ("0NEAR") — cargo-near-Parser verlangt Units (T1-Deploy verifiziert).
cargo near deploy build-non-reproducible-wasm --no-abi "$CONTRACT_ACCOUNT" \
  with-init-call new json-args "$INIT_ARGS" \
  prepaid-gas "100 TGas" \
  attached-deposit "0NEAR" \
  network-config testnet \
  sign-with-keychain send

echo "OK: foreman deployt -> $CONTRACT_ACCOUNT (testnet, init new(owner,treasury,foreman))."
echo "-> Tx-ID + Account in docs/EVIDENCE_LOG.md Zeile T1 eintragen (Artefakt-Pflicht, RULES.md)."
