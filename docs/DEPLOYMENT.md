# Deployment and operator runbook

Everything here is **testnet only**. The deploy script refuses any account that is not
`*.testnet` or a 64-hex implicit address, and there is no mainnet path in this repo by design
(see `RULES.md` §Scope). No command in this document prints a secret value.

## 1. Accounts and their jobs

| Account | Role | Holds |
|---|---|---|
| `escrow.foreman-team.testnet` | the contract | escrow deposits, job state, receipt anchor |
| `boss.foreman-team.testnet` | Foreman agent | the 10 % fee, counter-offer and award calls |
| `owner.foreman-team.testnet` | human owner | accepts deliveries, funds the deposit |
| `treasury.foreman-team.testnet` | treasury | payout destination |
| `agent1..5.foreman-team.testnet` | the swarm | one bid each, reputation accrues here |

Created by `bash ops/setup-testnet-accounts.sh` (near-cli 4): a parent funded through the faucet,
then one sub-account per role with 1.5 NEAR each. Keys land in `~/.near-credentials/testnet/`, which
is outside the repository — keep it that way.

## 2. Environment

```bash
cp .env.example .env      # then fill in the account names; the file is gitignored
```

`.env` carries account names and, if you use the Intents treasury loop, API tokens. Nothing reads a
key *file* from the repo: signing goes through the local keychain (`sign-with-keychain`) and the
receipt cell key lives in `keys/` (gitignored, generated on first use). Check with
`git check-ignore -v .env keys/` before you commit anything.

## 3. Deploy

```bash
make contract-test        # 55 tests, must be green
make bootstrap            # sandbox venv from the vendored wheel
bash scripts/deploy-testnet.sh
```

The script runs `cargo near deploy build-non-reproducible-wasm … with-init-call new
{"owner","treasury","foreman"}` against `network-config testnet`, in one transaction chain
(build → deploy → init → send) with `100 TGas` and `0NEAR` attached — the cargo-near 0.22 parser
requires the units, which is why they are spelled out.

`PATH` note: rustup shims must precede Homebrew, otherwise `cargo near` resolves a stale binary.

## 4. Verify the deployment is the code you read

```bash
near state escrow.foreman-team.testnet --networkId testnet   # prints the account's code hash
python3 scripts/board_cli.py --job 50 --json                 # reads state through the contract
```

`near state` returns the base58 code hash the account is running; compare it with the hash recorded
in `docs/EVIDENCE_LOG.md` row T1 (`i5cAhwtC4ejXXgzaceGmVytX52NM2ohh2Y35NKFR2Rx` for the ABI-embedded
phase-1.2 build). The view methods a stranger can call are `get_job`, `get_bids`, `get_rep`,
`get_counter_reason` and `get_cancel_request`. A deployment whose row is missing is not done: the
record pairs account, code hash and deploy tx so the running binary can be tied back to a commit.

## 5. Running a job round

```bash
bash scripts/e2e_demo.sh          # post → bids → counter → award → receipt → submit → accept
```

Writes `.state/e2e_run<N>.log` (gitignored) and the board sidecar `web/board/sidecar/job<N>.json`.
The flow is the documented one in `docs/SEQUENCE.md`; RPC throttling under a bid burst is handled by
retry plus a locally-signed `send_tx` fallback (`scripts/near_send.cjs`).

## 6. When a job is stuck

| Symptom | Cause | Action |
|---|---|---|
| Bids in, no counter or award | RPC answered `-429` mid-round | `python3 scripts/rescue_job.py <job_id>` — re-drives counter-offer + award through the locally-signed `send_tx` path |
| Bid window closed, never awarded | abandoned job | `refund_expired` after the timeout — `docs/EVIDENCE_LOG.md` records 3 historical refunds |
| Awarded but both parties want out | work stopped | `request_cancel` + `confirm_cancel` (`cancel_mutual`) refunds the owner |
| `NotEnoughBalance` on post | the 0.9 NEAR deposit exceeds the account balance | top up from the faucet; never drain another role account to make a demo pass |

## 7. What deployment does *not* include

No CI job deploys anything, and no automation holds an owner key. Publishing, account funding and
mainnet decisions stay with a human — that is a boundary, not a missing feature.
