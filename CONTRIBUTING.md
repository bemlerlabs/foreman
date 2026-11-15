# Contributing to Foreman

Foreman is an on-chain general contractor: an agent posts a task, a swarm bids, one counter-offer
is placed, the best bid is awarded, the delivery runs in a capped WASM sandbox, and payment leaves
escrow only after acceptance. Every change to this repo has to keep that sentence true, and keep it
*verifiable* — the project's value is that a stranger can check each claim without trusting us.

Reading order before you touch anything:

1. [`RULES.md`](RULES.md) — scope and invariants. Changes here go through a PR on their own, never
   bundled with code.
2. [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — where each responsibility lives and what may not
   reach across the boundary.
3. [`docs/EVIDENCE_LOG.md`](docs/EVIDENCE_LOG.md) — the claim/proof convention. New claims follow it.

## Development setup

No account, no key and no network is required for the main test paths; installing the toolchain is
the one step that reaches a package index.

```bash
make bootstrap       # venv + the vendored sandbox wheel (the four tooling packages come from PyPI)
make test            # 71 Python tests
make contract-test   # 55 Rust contract tests (needs rustup + wasm32-unknown-unknown)
make typecheck       # tsc --noEmit over core/intents (needs `npm ci` once, Node >= 22)
make check           # python + contract + lint + hygiene (links, table shape, leaks, media budget)
```

`make help` lists all targets. Toolchain in use during development: cargo-near 0.22.0,
near-cli 4.0.13, Node 22 for `core/intents`.

## Layout

| Path | Responsibility |
|---|---|
| `contracts/foreman/` | The only trust root. Escrow, bids, counter-offer, award, receipt anchor, accept, payout, reputation. |
| `core/receipts/` | Thin adapter over the Apache-2.0 `ephemora_cell` sandbox: run, attest, verify. Fail-closed. |
| `core/bidding/` | Deterministic seeded bid generation and the swarm-bid loop. |
| `core/market/` | NEAR Agent Market client (discovery + offer), with a mock that mirrors the real contract exactly. |
| `core/acceptance/` | Machine-checkable acceptance gate. Criteria that need judgement are reported `MANUAL`, never auto-passed. |
| `core/reputation/` | Reputation snapshot parity with the contract formula. |
| `core/intents/` | Treasury loop through the NEAR Intents Agent API. `dry:true` first, execute behind the `AGENT_EXECUTE` gate. |
| `web/board/` | Zero-dependency read-only board (vanilla JS) + `sidecar/` job files. |
| `scripts/` | Operator-facing entry points: `board_cli.py`, `e2e_demo.sh`, `judge_demo.sh`, the deploy helpers and the locally-signed `send_tx` helper. |
| `plugin-pack/` | The portable MCP stdio server and the host plugin registration files. |
| `vendor/` | Third-party artifacts with their own licence and provenance — see `vendor/NOTICE`. |
| `artifacts/` | Receipts, recipes, the prebuilt worker WASM: evidence, kept in the repo on purpose. |
| `docs/` | Architecture, deployment, market notes and the evidence log, plus `docs/assets/` with the films and stills they cite. |
| `ops/` | One script: it provisions the throwaway `foreman-team.testnet` accounts the demo runs on, which is why `docs/DEPLOYMENT.md` can reproduce the fleet instead of describing it. |
| `.github/` | CI, the proof-replay job, Dependabot and the issue/PR templates. |

## What makes a change acceptable

- **It preserves a fail-closed path.** `attach_receipt` checks identity before state; `accept`
  rejects a delivery with no receipt (`NOT_DELIVERED`); `verify` raises instead of warning. If your
  change makes a rejection softer, say why in the PR and add the test that pins the new behaviour.
- **It is checked by something.** A Rust test for contract behaviour, a pytest for the Python layer,
  a committed artifact for an evidence claim. "Verified manually once" is not enough for the money
  paths.
- **It does not invent a number.** Prices, savings, latency and test counts are measured and quoted
  with the command that produced them. If a number goes stale, delete it rather than round it.
- **It stays on testnet.** Mainnet deployment is out of scope for this project; the deploy scripts
  guard against it. Proposals that change that boundary need a written decision first.

## Reporting and secrets

- Never commit key material. `.env`, `keys/`, `credentials/`, `.state/` and `.ephe/` are gitignored;
  keep it that way and keep secret *values* out of logs, screenshots and PR descriptions too —
  print a length or a prefix instead.
- Found a vulnerability? Use the flow in [`SECURITY.md`](SECURITY.md) rather than a public issue.

## Pull requests

- One commit per logical change; the message says what and why, in English.
- `make check` green before asking for review; paste the tail of the run into the PR.
- If you changed what a demo shows or a README claims, update the claim *in the same PR* — the
  README, the films and `docs/EVIDENCE_LOG.md` are one document set.
- Screenshots or a short clip for board changes; the board is judged by eye.

Nothing here is a gatekeeping list for its own sake: a reviewer at a hackathon has about ten minutes,
so the repo has to prove itself without a human standing next to it.
