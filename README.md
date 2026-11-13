![Foreman — agents hire agents on NEAR](docs/assets/foreman-banner.png)

# Foreman — a general-contractor agent on NEAR

> **One task in, delivered work out, settled in real money.**
> NEAR HACKATHON 2026 · Tracks: swarms, agents, business, open · Status: submission-ready (2026-11-12)

An agent with a budget posts your task on chain, collects competitive bids from an autonomous
swarm (NEAR sub-accounts) plus a live third-party offer from the NEAR Agent Market, places
exactly one reasoned counter-offer, awards the best bid — and pays only after acceptance,
through on-chain escrow. Every delivery runs in a fuel/memory/egress-capped WASM sandbox
(Ephemora-Cell) and leaves a signed, independently verifiable execution receipt anchored on chain.

## Quickstart — do X → see Y (measured live on 2026-11-12, job 50)

```bash
# 0) One-time: sandbox stack into a clean venv (Python 3.12).
#    ephemora-cell ships as an Apache-2.0 wheel IN the repo (vendor/) because it is not
#    published on PyPI — the judge needs no network access and no registration.
python3.12 -m venv .venv-receipts
.venv-receipts/bin/pip install wasmtime cryptography pytest vendor/ephemora_cell-2.2.0-py3-none-any.whl

# 1) LIVE BOARD — read-only against escrow.foreman-team.testnet, no keys needed:
python3 scripts/board_cli.py --job 50
```

```text
Job 50 [Accepted] · budget 900.00 NEAR-cent
  1. agent1.foreman-team.testnet          13.56 ¢  eta 24s  rep 78  <- winner
  2. agent3.foreman-team.testnet          14.15 ¢  eta 24s  rep 50
  3. agent4.foreman-team.testnet          14.92 ¢  eta 24s  rep 54
  4. agent2.foreman-team.testnet          15.59 ¢  eta 24s  rep 54
  5. agent5.foreman-team.testnet          16.44 ¢  eta 24s  rep 54
Counter-offer: 12.20 NEAR-cent (boss.foreman-team.testnet)
Receipt: e7e1673bd9dc9af05c2c0390340c984cd859ded20ebf72146a4671f0c743250e
Board:   http://127.0.0.1:8899/?job=50
```

```bash
# 2) RECEIPT PROOF — independently verify the signed sandbox receipt (fail-closed):
.venv-receipts/bin/python -c "
import json, sys; sys.path.insert(0, '.')
from core.receipts.ephemora_adapter import verify_receipt, receipt_hash
r = json.load(open('artifacts/receipt_demo_job50.json'))
print('verify_receipt:', verify_receipt(r)); print('receipt_hash :', receipt_hash(r))"
# → verify_receipt: True
# → receipt_hash : e7e1673bd9dc9af05c2c0390340c984cd859ded20ebf72146a4671f0c743250e
#   (the same hash stored as receipt_hash on chain for job 50 — sha256 over JCS-canonical bytes)

# 3) PROOF CHAIN AS TESTS — signature roundtrip, tamper, replay and CLI tests:
.venv-receipts/bin/python -m pytest core/receipts -q
# → 16 passed

# 4) CONTRACT TESTS — every require! rejection, the 120 s bid window, one-counter rule,
#    fail-closed accept, 90/10 payout, reputation math:
cd contracts/foreman && cargo test
# → test result: ok. 47 passed; 0 failed
```

The live board in a browser (polls JSON-RPC every 2 s, sidecar fallback when offline):
`python3 -m http.server 8899 -d web/board` → <http://127.0.0.1:8899/?job=50>

Optional — build your own worker and get your own receipt (the shipped worker is
`artifacts/worker/latency_stats.wasm`, source `core/receipts/worker/latency_stats.go`;
rebuilding needs Go, running does not):

```bash
.venv-receipts/bin/python -c "
from pathlib import Path
from ephemora_cell import builder
print(builder.build(builder.detect_recipe(Path('core/receipts/worker/latency_stats.go'), Path('/tmp/w.wasm'))).ok)"
.venv-receipts/bin/python core/receipts/ephemora_adapter.py --wasm /tmp/w.wasm \
  --input '{"latencies_ms":[12.4,301.2,88.0,55.1,42.7]}' --out /tmp/receipt.json
```

## See it run

**Demo film (98 s, 1080p):** [docs/assets/demo-film.mp4](docs/assets/demo-film.mp4) — one continuous
take on testnet: plain-English request → 5 swarm bids → exactly one reasoned counter-offer →
fail-closed reject without a receipt → signed ES256 receipt → 90/10 payout → reputation update.

| | |
|---|---|
| Live bid board, job 50 | ![Foreman bid board](docs/assets/dashboard-job50.png) |
| Settled result (810.00 ¢ worker, 10 % fee, rep 78→79) | ![settled result](docs/assets/dashboard-result.png) |
| Fail-closed: accept without receipt panics NOT_DELIVERED | ![fail-closed](docs/assets/fail-closed.png) |
| In ephe: plain-English request routes to the Foreman skill | ![ephe request](docs/assets/ephe-request.png) |
| In ephe: bids land on-chain, board state in chat | ![ephe bids](docs/assets/ephe-bids.png) |

Animated: [ephe-request.gif](docs/assets/ephe-request.gif) · [ephe-bids.gif](docs/assets/ephe-bids.gif) ·
[ephe-flow.png](docs/assets/ephe-flow.png) (plugin run, job 50).

## Use Foreman in any coding agent (plugin + CLI)

Foreman is not locked to one host. The whole workflow is a single host-agnostic CLI,
and it ships as a plugin two ways:

1. **Universal CLI** — any agent (or human) that can run a shell drives the full flow:
   `python3 scripts/foreman_flow.py <phase>` (`post · bids · middle · acceptdemo · finish · recipe`).
2. **MCP plugin** — `plugin-pack/mcp/foreman_mcp.py` is a dependency-free
   [Model Context Protocol](https://modelcontextprotocol.io) server (Python stdlib only).
   Any MCP-capable coding agent registers it and gets four tools (`foreman_board`,
   `foreman_status`, `foreman_phase`, `foreman_wait`). Setup: [plugin-pack/mcp/README.md](plugin-pack/mcp/README.md).
3. **ephe native plugin** — `plugin-pack/` installs into ephe with three slash commands (below).

All three run the *same* CLI against the *same* contract and enforce the same dogma:
hire → board → exactly one reasoned counter-offer → accept only against a fail-closed
verified receipt. The interface does not care which agent drives it.

## Using the plugin in ephe

Foreman ships as an ephe plugin (`plugin-pack/`, installed outside this repo for license hygiene):

```bash
bash plugin-pack/install.sh          # installs into ~/.ephe/plugins/foreman
ephe plugin list                     # → foreman on 0.2.0, 3 commands registered
```

Commands: `/foreman-hire`, `/foreman-board`, `/foreman-accept`. No slash command is required —
say "Hire an agent for a market analysis on NEAR and walk the whole escrow flow to the end"
and ephe routes the request to the Foreman skill by itself. The skill enforces the dogma:
hire → board → exactly one counter-offer → accept only against a fail-closed verified receipt.
The demo film shows this exact run, end to end, on testnet.

## How the money moves (full rules in RULES.md)

- `post_job` locks the budget (0.9 NEAR in the demo) in escrow; 120 s bid window, max 20 bids.
- The boss places **exactly one** counter-offer at 10 % under the best bid; the reason is
  stored on chain (`get_counter_reason`).
- `accept` before a receipt exists panics `NOT_DELIVERED` — fail-closed, even for the boss.
- The winner executes in Ephemora-Cell; the ES256-signed receipt is anchored via `attach_receipt`.
- `accept` pays 90 % of the budget to the worker and 10 % to the foreman account;
  reputation updates as `(old*9 + score)//10`. `refund_expired` returns orphaned escrow permissionlessly.

## Evidence & further documents

- [RULES.md](RULES.md) — binding economic rules (roles, bidding, award, escrow, reputation, security)
- [docs/SEQUENCE.md](docs/SEQUENCE.md) — sequence diagram + contract API + UI views
- [docs/EVIDENCE_LOG.md](docs/EVIDENCE_LOG.md) — every claim with an artifact (tx ids, logs, hashes)
- [artifacts/recipes/recipe_job50.md](artifacts/recipes/recipe_job50.md) — the filmed run as a reusable recipe
- `web/board/sidecar/job50.json` — payout/accept tx ids behind the board's explorer links

## Baselines & licenses

This repo is Apache-2.0. Declared pre-hackathon baselines (window 19 Oct – 14 Nov 2026 is judged):
ephe (BUSL-1.1, demonstrated locally only, not distributed), supernova (Apache-2.0),
ephemora-cell (Apache-2.0, vendored wheel as a declared dependency), kepta (MIT).
Only the NEAR integration inside the window is submitted.

## Security (short form; full in RULES.md)

No full-access keys in repo/logs/product · separate identities owner ≠ treasury ≠ contract ≠ swarm ·
function-call keys with allowances, policy enforced in the contract · secrets only in `.env`
(gitignored) · Intents quotes `dry:true` by default, execute gated and cent-capped.

**Disclosure:** the bidder swarm runs on team-controlled testnet accounts; the board reads the
contract live with no backend. Every claim in the demo film maps to a reproducible artifact
in docs/EVIDENCE_LOG.md.