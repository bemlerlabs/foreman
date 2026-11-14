# RULES.md — Foreman economic rules (binding before any code commit)
Version 0.2 · 2026-11-12 · English edition. Economic amendments only via owner PR.

## Roles
- **Owner (human):** posts task + budget, sees everything, approves acceptance. The only signing instance outside the contract.
- **Foreman (general-contractor agent, ephe host):** decomposes the task, collects offers, negotiates exactly ONE reasoned counter-offer, awards, checks, accepts.
- **Swarms (bidders, agent1..5.<org>.testnet):** Supernova swarms with their own sub-account + function-call key.
- **Third-party agents:** independent agents from the NEAR Agent Market (market.near.ai).
- **Escrow contract:** the only authority over money, bids, receipts, reputation.
- **Intents treasury:** ONE account via the Intents Agent API; destination whitelist = only the contract's contract/payout addresses.

## Job
Fields: `id, spec (text), acceptance_criteria[], budget (yocto), deadline (timestamp), created_by, state`.
States: `Open → Bidding → Awarded → Delivered → Accepted | Refunded | Expired`.

## Bidding
1. Bid = `{job_id, bidder, price≤budget, eta_secs, rep_snapshot}` — signed by the swarm's sub-account key (the contract checks `env::predecessor_account_id`).
2. Bid window: 120 s from post_job (demo constant, testable).
3. No bid changes after the window closes; a new round only via a new job (no orderbook, no complexity).
4. The Foreman may place exactly ONE reasoned counter-offer (`counter_offer` with mandatory `reason` — requirement of the official 07 prompt; the reason must reference the acceptance_criteria).

## Award
Score = `price` ascending · equal price: better reputation · then earliest bid. `award(winner)` by the Foreman, validated by the contract against the score matrix.

## Work & receipt
1. The winner executes untrusted worker code exclusively in the Ephemora cell (caps: fuel/mem/egress, pinned).
2. Before `submit_work`, a signed execution report (receipt: fuel_used, mem_peak, egress_log_hash, artifact_hash, cell_signature) MUST be anchored via `attach_receipt`. No receipt, no submit_work.
3. `submit_work` delivers `artifact_hash` + a result reference.

## Acceptance & money
1. `accept(job)` only by Owner/Foreman → `release_payout`: escrow balance to the winner (90 %) and the Foreman fee to the Foreman account (10 %). The split distributes the full budget; v1 keeps no reserve (aligned with the implemented 90/10 per owner decision, phase 1.1).
2. No deliverable by the deadline → `refund` to the Owner (permissionless after deadline + 60 s; the payout goes ONLY to the Owner).
3. Cooperative exit (S3, supersedes the earlier "deadline-refund only" wording): `request_cancel` by Owner or Winner (Awarded/Delivered) + `confirm_cancel` by the **other** party → full budget refund to Owner, no reputation change. Still no neutral arbiter in v1: a unilateral ghost remains the honest limit. (Honesty > features.)
4. Mainnet money flows only as a demo through the Intents treasury (policy-whitelisted, cent amounts, every quote `dry:true` first).

## Reputation
`rep[bidder]` = moving average of delivery scores (0–100), starting at 50. Updated exclusively through `accept` (score from the Foreman's acceptance) or `refund_expired` (score 0 for the winner). Reputation is on-chain; the swarm's KEPTA snapshot hash is carried along (`rep_snapshot_hash`).

## Security (non-negotiable)
- Swarm FC keys: allowance-limited, contract methods only; **policy logic lives in the contract, never in the key.**
- No full-access key in the repo, in logs, or in the product. Secrets only in .env.
- Owner account ≠ treasury ≠ contract ≠ swarm accounts (separate identities, documented in the README).
- Every quote/transaction: log in docs/EVIDENCE_LOG.md (date, type, ID, artifact link). No artifact = not done.

## Demo constants (T5-gate ready)
5 swarms, 1 third-party offer (Market), 120 s bid window, 1 counter-offer, budgets ≤ $3 equivalent, amounts in NEAR/USDC cents.