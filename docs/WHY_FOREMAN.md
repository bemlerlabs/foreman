# Why Foreman — the delta, honestly

One page for judges and skeptics. What already exists, what Foreman adds, and what it
deliberately does not claim.

## What already exists (we are not a new category)

The NEAR Agent Market already lets agents hire agents: proposals/bids, escrow,
autonomous execution. Anyone claiming "agents hiring agents" as novel is wrong.
Foreman does not replace that market — it **uses it as a quote source** and adds the
layer the market lacks: **verifiable execution and acceptance-gated settlement.**

## The concrete delta

1. **Proof of execution, on chain, before submission.** The worker runs in a
   fuel/memory/egress-capped WASM sandbox and leaves an ES256-signed receipt; the receipt
   hash is anchored on chain *before* `submit_work`. Accept without a receipt and the
   contract panics (`NOT_DELIVERED`, `RECEIPT_BEFORE_SUBMIT`) — fail-closed, even for the boss.
2. **Machine-checkable acceptance (S1).** Criteria are verified against the deliverable
   (summary word limit, CSV table, cited sources), not asserted. Human-judgement criteria
   are reported `MANUAL`, never auto-passed. Hashed acceptance report beside the receipt.
3. **Autonomous negotiation, bounded.** Exactly **one** reasoned counter-offer; the reason
   is stored on chain (`get_counter_reason`). A second attempt is a contract error, not a feature.
4. **Acceptance-gated reputation + living escrow.** Reputation moves only on acceptance;
   `refund_expired` returns orphaned escrow permissionlessly; `request_cancel`/`confirm_cancel`
   give a cooperative exit (S3). No money sits forever when both parties want out.
5. **Open entry (S2).** `place_bid` is permissionless — proven by a contract test and a live
   guest bid from outside the seeded swarm. The third-party market offer competes as a
   labelled off-chain row, never passed off as an on-chain bid.
6. **Portable.** A plugin (MCP, dependency-free) plus a universal CLI: any coding agent that
   loads MCP or runs a shell can drive the same escrow flow. Not locked to one host.

## Honest limits (we state them, not hide them)

- **No neutral arbitration in v1.** A unilateral ghost (one party refuses everything) still
  needs an arbiter; that is v2. Cooperative exit + timeout refund cover the rest.
- **The swarm is partly team-controlled** (disclosed). Entry is open, but the seeded bidders
  are ours; only the market offer is third-party.
- **The receipt proves execution + checkable criteria, not semantic quality.** Whether the
  work is *good* remains human judgement at acceptance.
- **Cost numbers are not like-for-like.** Testnet cent-job vs a mainnet USD per_call quote
  differ in task, rail and network; we publish raw numbers with scope, no multiplier.

## Why this can win

Escrow holds money; it cannot tell you the work was done. Foreman makes execution
*verifiable* and settlement *acceptance-gated*, with every claim mapped to a reproducible
on-chain artifact (docs/EVIDENCE_LOG.md). That is a trust layer the existing market does not
provide — demonstrated end to end on testnet, not slideware.