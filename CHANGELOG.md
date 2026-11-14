# Changelog

Notable changes to Foreman, in reverse chronological order. Dates are commit dates on `main`.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the version numbers
follow [Semantic Versioning](https://semver.org/) with one honest caveat: this is a hackathon-scale
project, so `0.x` means the on-chain surface is stable enough to demo but no compatibility promise
is made yet.

## [Unreleased] — 2026-11-14

### Added
- A CI job for the TypeScript side. `core/intents/` ships twelve `.ts` files and a `typecheck`
  script, and no gate read them — the python suites, the contract suite and the hygiene gate all
  passed with the Intents client uncompilable. `npm ci && npm run typecheck` is now the fourth job,
  and `make typecheck` is the local equivalent.
- GIFs and stills cut from the dual-host demo film, placed next to the text they prove
  (`docs/assets/`).
- The README front page rebuilt around them: a quickstart that shows real measured output, the
  four films with durations, a GIF table, a stills table, the host matrix and the questions a
  reviewer asks.
- CI gained a `proofs` job that replays the two offline claims on every push — the recorded job-50
  receipt must still verify and still hash to the value anchored on chain, and the acceptance gate
  must still pass from committed artifacts alone. Both run with no network and no keys.
- The hygiene gate checks markdown table shape: every row must carry its header's cell count. A row
  whose claim contains a stray `|` raises nothing anywhere else — it simply stops lining up with its
  header, and the surplus text lands in the last column — and four rows of `docs/EVIDENCE_LOG.md`
  were in exactly that state.
- `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, `CITATION.cff`, a document index and a
  `Makefile` so the gates are one command instead of a paragraph.
- Architecture document with a scalable diagram (`docs/ARCHITECTURE.md`, `docs/assets/foreman-architecture.svg`).
- Dual-host demo: the same MCP plugin live in two different agent CLIs, narration timed to the
  on-screen events (`docs/assets/dual-tui-demo.mp4`).

### Changed
- The install story stopped being one host's install story. `plugin-pack/install.sh` copied a plugin
  pack into `~/.ephe/plugins/` — a name that promised a universal installer and delivered a
  host-specific one. It now prints the `mcpServers` block for this checkout, and `--probe` starts
  the server and lists the four tools it answers with, offline; for every MCP host that block *is*
  the installation. The host-native pack keeps its own script, named for what it is
  (`plugin-pack/install-ephe.sh`). The README section is "Installing the plugin", and the per-host
  pack is described as the optional wrapper it always was.
- Prose that cited a preparation checklist no reader has stopped here: `S1`–`S4` in
  `docs/WHY_FOREMAN.md`, `docs/MARKET_NOTES.md` and `RULES.md`, the baseline-tag id `Q-003` in
  `docs/EVIDENCE_LOG.md` and the gate record, the `C2`/`C3` and `phase 6`/`phase 7` stage names in
  `docs/T5_GATE_2026-11-10.md`, `asset-scout` in two evidence rows, and the `phase4.3`/`phase4.4`
  headings in `docs/DESIGN.md`. The `T5_GATE` line "9.4 % below the cheapest bid" corrected to
  **10 %** — 12.30 against 13.66 is the `RULES.md` margin, and the evidence row for that same run
  already recorded it as `−10 %`. Roles reworded host-neutral (`docs/SEQUENCE.md`, `RULES.md`).
  No rule, claim or number was dropped: where an id carried the meaning, the meaning is written out.
- `CONTRIBUTING.md` set up the venv with a hand-written `pip install` that named three packages
  where `make bootstrap` installs four, so a contributor who followed it exactly had no `ruff` and
  `make check` failed on the lint step. It now names `make bootstrap`, and adds the typecheck line.
- `.gitignore` rewritten: it carried a malformed pattern that matched nothing (`*.json!package.json`)
  and a duplicated WASM negation; it now also covers the caches this repo actually produces.
- Four `docs/EVIDENCE_LOG.md` rows no longer carry a stray `|` or a surplus column, so their claims
  line up with the header they belong to. No text was lost: the surplus was folded into the column
  it describes, one row that named an internal role where an artifact belongs now names the evidence
  and states that it lives outside the repository, and the quoted hash formula of a closed finding
  is spelled out in words with the two commits that contain it verbatim.
- Evidence log gained a key distinguishing artifacts a reader can verify (repo path, tx hash,
  command) from captures that were ephemeral, and dropped internal role names in favour of
  maintainer/operator.
- Comments in shipped code no longer cite ids from a preparation checklist that never entered this
  repository — `Q-005`/`Q-012`, `S1`–`S8`, and a `phaseN:` prefix on 17 script and module headers
  plus several lines of the contract. A reader cannot resolve any of them, and an unresolvable
  reference reads as something the author forgot to remove rather than something the author forgot
  to explain. Each site now states the fact itself: which baseline library and license, which shot
  a phase exists to capture, which method is the cooperative exit. The marker strings a phase run is
  waited on (`VIDEO_S6_OK`, consumed by `scripts/foreman_flow.py`) are unchanged, so no recorded log
  or live wait loop breaks.
- Vendored third-party NOTICE now states the wheel's SHA-256 and its provenance read from the
  package metadata.
- The CI workflow pins moved to `actions/checkout@v7` and `actions/setup-python@v7`, the majors the
  runners were already warning about on every job. Two automated pull requests proposed the same
  change; applied here it is one commit on the branch everything else already builds from, and each
  job's deprecation note is gone rather than merely reviewed.
- The NEP-366 delegate helper carries its cast on the object the serializer reads. `near-api-js`
  7.5.x types `encodeSignedDelegate` as taking a `SignedDelegate`, and the fix the compiler suggests
  — construct one — is a crash on the version this repository installs, because 7.4.0 declares that
  class in its type surface and does not export it at runtime. What both versions' Borsh serializer
  walks is the two plain fields, so the helper keeps them plain and casts them. Measured on the
  installed artifact: the signed delegate encodes byte-identically with and without the 7.5.x class
  wrapper, so this is a type-level change and the on-chain bytes do not move.

### Removed
- Eight internal preparation documents (submission checklist, outreach drafts, working plans). They
  described how the entry was pitched rather than what the software does, and every claim that cited
  them now cites the vendored package or an on-chain transaction.
- `ops/key-grant/` — a one-click page that granted a key to a **mainnet** account. Nothing in the
  demo, the tests or the docs used it, and a public repository for a testnet-only project has no
  business publishing the account, the key and the grant mechanism together. The files were moved
  outside the repo, not deleted; they remain in git history, so revoking that key is the owner's
  action (see [SECURITY.md](SECURITY.md)).

### Fixed
- Three text claims that did not survive contact with the evidence that produced them. The host
  matrix named the second filmed model `Qwen3.6-Flash`; the terminal capture of that run shows
  `qwen3.8-flash-next`, and the endpoint the film pointed Claude Code at is a DGX Spark, so the row
  now says Qwen 3.8 Flash and gives the slug. The pre-commit hook still announced "python suites
  (69 tests)" after the suite had grown to 71 — the only place left that carried the old count. And
  the quickstart block that promises "do X, see Y" omitted one line the command actually prints (the
  labelled third-party market offer), so a reader comparing their terminal to the page saw a
  difference where there was none.
- Cost framing in the 0.2.0 entry claimed the numbers had been rewritten *to* be like-for-like. They
  had been rewritten to say the opposite: a testnet cent-job and a mainnet USD `per_call` quote are
  different tasks on different rails, and the published rule is raw numbers plus scope, never a
  multiplier. The entry now matches `docs/MARKET_NOTES.md`, `docs/EVIDENCE_LOG.md` and
  `docs/WHY_FOREMAN.md`, which all already said so.
- The bid generator now defaults to the published team swarm when `SWARM_ACCOUNTS` is absent or
  empty, which is what every fresh clone and every CI runner has. It used to require that the
  variable be set at all, so six tests passed only on a machine that already held the operator's
  gitignored `.env` — and the README claim that the whole suite runs from a clean clone was not
  true until now. Two tests pin both halves: the fallback bids the five accounts the demo jobs were
  settled with, and a swarm that is configured to anything other than five distinct accounts is
  still refused with exit 2 and writes no file.
- The hygiene gate no longer reports a documented runtime product as a missing file. The Intents
  README names `.state/passkey.json` and `.state/operations.json`, which the run creates and
  `.gitignore` keeps out of the repository; in a clone that has never run the demo the files are
  legitimately absent and the gate failed the build. A path is exempted only when `git`
  itself says it is ignored, so a deleted file that the repo is supposed to ship stays a finding.
- `scripts/judge_demo.sh` wrote its acceptance report to `/tmp/judge_acceptance.json`, the one
  place in the demo path that still used a fixed shared path while everything else keeps its run
  state inside the checkout. It now writes `.state/judge_acceptance.json`.
- Two install claims were wider than what was measured. The quickstart said `make bootstrap` needs
  no package index, when only the sandbox wheel is vendored and the four tooling packages come from
  PyPI; the 0.1.0 entry said the same about the whole receipt path. Both now name the wheel, and
  the README lists the four packages it does fetch.

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
- Cost framing rewritten: the testnet cent-job and the mainnet USD `per_call` quote are stated as
  *not* like-for-like, each with its own scope. The earlier multiplier comparison is gone because it
  compared unlike things.
- Live board moved to port 8899; flow state moved out of `/tmp` into the checkout.

## [0.1.0] — 2026-11-10 — the gate

### Added
- T5 gate passed twice in a row on an empty terminal: post → five swarm bids → one third-party
  market offer → exactly one reasoned counter-offer → award → sandboxed execution → ES256 receipt →
  submit → accept → 90/10 payout → reputation, with determinism diff of zero lines
  (`docs/T5_GATE_2026-11-10.md`).
- Receipt adapter over the Apache-2.0 `ephemora_cell` sandbox (`core/receipts/`), vendored wheel in
  `vendor/` so the sandbox package itself is never fetched from an index.
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
