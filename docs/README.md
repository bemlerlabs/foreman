# Documentation index

There is no single "docs" pile here — each file answers a different question, and the wrong one is
easy to read as marketing. Pick by what you are trying to do.

## By audience

| You want to… | Read, in this order |
|---|---|
| **Judge or evaluate it** | `../README.md` → `WHY_FOREMAN.md` → `EVIDENCE_LOG.md` → watch `assets/dual-tui-demo.mp4` |
| **Understand how it works** | `ARCHITECTURE.md` → `SEQUENCE.md` → `../RULES.md` → the code |
| **Change it** | `../CONTRIBUTING.md` → `../RULES.md` → `ARCHITECTURE.md` §5 (boundaries) → `DESIGN.md` if it touches the board |
| **Run or redeploy it** | `DEPLOYMENT.md` → `../Makefile` (`make help`) |
| **Attack it** | `../SECURITY.md` → `ARCHITECTURE.md` §4 and §5 |

## What each file is

| File | It is | It is not |
|---|---|---|
| `../RULES.md` | The binding economic rules: states, payout split, windows, fee. Amended only via owner PR. | A proposal or a summary of the code |
| `../README.md` | The front page: what Foreman is, the demo media, quickstart, limitations. | The specification |
| `WHY_FOREMAN.md` | The novelty argument for skeptics: prior art, the delta, what we do not claim. | A benchmark report |
| `ARCHITECTURE.md` | Components, trust boundaries, money flow, receipt chain, failure posture, known limits. | A tutorial |
| `SEQUENCE.md` | One demo moment as a mermaid sequence diagram, used to check the contract API and the UI against the same story. | The full state machine (that is `RULES.md`) |
| `EVIDENCE_LOG.md` | Every claim in the repo with the artifact that proves it: repo path, transaction hash, command. Reader key at the top. | Prose about design choices |
| `DESIGN.md` | The bid board's design system: type scale, colour, spacing, states — hand-written CSS, no framework. | The product design of the contract |
| `DEPLOYMENT.md` | Operator runbook: accounts, environment, deploy, verification, and what to do when a job is stuck. | Anything that runs on mainnet |
| `MARKET_NOTES.md` | Exploration log of the NEAR Agent Market API — what returned what, on which date, read-only. | A stable integration contract |
| `T5_GATE_2026-11-10.md` | Decision-day record for the phase-5 gate: what was decided and on what authority. | A live checklist |
| `../CHANGELOG.md` | Notable changes by version, dates are commit dates on `main`. | The full git history |
| `assets/` | The media the README embeds: stills, GIFs cut from the demos, four demo films (MP4), and `foreman-architecture.svg`. | Source footage (that lives outside the repo) |

## Two rules these docs follow

1. **A number without an artifact is a bug report.** If you find a claim here that `EVIDENCE_LOG.md`
   cannot back with a path, a transaction, or a command, that is a defect — open an issue.
2. **Docs describe what is committed.** Testnet-only, not audited, and one receipt per job are stated
   as limits, not as roadmap items. If something changes, the limit line changes in the same PR.
