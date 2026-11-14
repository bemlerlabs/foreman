# Changelog

Notable changes to Foreman, in reverse chronological order. Dates are commit dates on `main`.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the version numbers
follow [Semantic Versioning](https://semver.org/) with one honest caveat: this is a hackathon-scale
project, so `0.x` means the on-chain surface is stable enough to demo but no compatibility promise
is made yet.

## [Unreleased] — 2026-11-14

### Added
- GIFs and stills cut from the dual-host demo film, placed next to the text they prove
  (`docs/assets/`).
- `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, `CITATION.cff`, a document index and a
  `Makefile` so the gates are one command instead of a paragraph.
- Architecture document with a scalable diagram (`docs/ARCHITECTURE.md`, `docs/assets/foreman-architecture.svg`).
- Dual-host demo: the same MCP plugin live in two different agent CLIs, narration timed to the
  on-screen events (`docs/assets/dual-tui-demo.mp4`).

### Changed
- `.gitignore` rewritten: it carried a malformed pattern that matched nothing (`*.json!package.json`)
  and a duplicated WASM negation; it now also covers the caches this repo actually produces.
- Evidence log gained a key distinguishing artifacts a reader can verify (repo path, tx hash,
  command) from captures that were ephemeral, and dropped internal role names in favour of
  maintainer/operator.
- Vendored third-party NOTICE now states the wheel's SHA-256 and its provenance read from the
  package metadata.

### Removed
- Eight internal preparation documents (submission checklist, outreach drafts, working plans). They
  described how the entry was pitched rather than what the software does, and every claim that cited
  them now cites the vendored package or an on-chain transaction.

## [0.2.0] — 2026-11-12 — submission freeze

### Added
- Job 50 as the measured demo take: live board output, signed receipt, sidecar, recipe, deliverable
  and acceptance report committed together (`artifacts/`).
- Machine-checkable acceptance gate (`scripts/verify_acceptance.py`, `core/acceptance/`): three
  criteria checked mechanically, judgement-requiring criteria reported `MANUAL` instead of passed.
- Proof of open, permissionless bid entry: a guest account outside the swarm bids on chain
  (job 51) and a contract test pins the behaviour.
- Cooperative mutual cancel plus delivered-timeout refund, closing the stuck-escrow hole.
- Portable MCP server (`plugin-pack/mcp/foreman_mcp.py`, stdlib-only) so any MCP-speaking agent can
  call the board, status, phase and wait tools.
- Narrated demo films and an English-only product surface.

### Changed
- Cost framing rewritten to like-for-like numbers; the earlier multiplier comparison is gone because
  it compared unlike things.
- Live board moved to port 8899; flow state moved out of `/tmp` into the checkout.

## [0.1.0] — 2026-11-10 — the gate

### Added
- T5 gate passed twice in a row on an empty terminal: post → five swarm bids → one third-party
  market offer → exactly one reasoned counter-offer → award → sandboxed execution → ES256 receipt →
  submit → accept → 90/10 payout → reputation, with determinism diff of zero lines
  (`docs/T5_GATE_2026-11-10.md`).
- Receipt adapter over the Apache-2.0 `ephemora_cell` sandbox (`core/receipts/`), vendored wheel in
  `vendor/` so the receipt path runs without a package index.
- Read-only board (`web/board/`) with on-chain-first data and a sidecar fallback, plus
  `scripts/board_cli.py` for terminals.
- Deterministic seeded bid generator (`core/bidding/`), Agent Market client with a contract-matching
  mock (`core/market/`), reputation snapshot parity (`core/reputation/`).
- Intents Agent API treasury loop behind the `AGENT_EXECUTE` gate, `dry:true` first, passkey owner
  policy signing through a loopback popup (`core/intents/`).

## [0.0.x] — 2026-11-05 → 2026-11-07 — contract core

### Added
- Escrow contract on `near-sdk-rs` with the eleven methods, per-job bid window (`opened_at`),
  `MAX_BIDS = 20`, one-counter rule, fail-closed `accept`, 90/10 payout and reputation arithmetic;
  deployed to `escrow.foreman-team.testnet` with the code hash verified against the ABI build.
- 55 contract tests covering every `require!` rejection; `cargo clippy -D warnings` clean;
  NEP-330 ABI via `NearSchema` derives.
- Testnet deploy and account setup scripts, RPC-429 hardening with a locally-signed `send_tx`
  fallback.

Versions are cut in this file and in git history; annotated tags (`v0.1.0`, `v0.2.0`, …) are created
when a release is published, so no tag link is asserted here before the tag exists. To compare
against a stage, use its commits: `git log --oneline` shows the phase boundaries, and the phase
number in each commit subject matches the sections above.
