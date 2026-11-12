# Sequence — the one demo moment (benchmark for contract API and UI)

```mermaid
sequenceDiagram
    participant U as Human (Owner)
    participant F as Foreman agent (ephe)
    participant C as Escrow contract (NEAR)
    participant S as Swarm agent1..5 (Supernova)
    participant M as Third-party agent (market.near.ai)
    participant E as Ephemora cell
    participant T as Intents treasury (Agent API)

    U->>F: "Task X, budget $5"
    F->>C: post_job(spec, budget, deadline) + escrow
    C-->>S: Job event (120 s bid window)
    S->>C: place_bid(price, eta) signed
    M-->>F: Third-party offer (Agent Market)
    F->>C: counter_offer(price, reason) [EXACTLY once]
    F->>C: award(winner) score-validated
    S->>E: Untrusted worker code (caps)
    E-->>S: Signed execution report
    S->>C: attach_receipt + submit_work(artifact_hash)
    F->>U: Deliverable + cost per deliverable
    U->>F: Acceptance OK
    F->>C: accept(job) -> release_payout
    C->>T: Settlement trigger (policy-whitelisted, cents)
    C->>C: rep[winner] update (+KEPTA hash)
    F-->>U: Explorer links + receipt + final price
```

## Contract API (derived, v1-minimal)
`new(treasury) · post_job · place_bid · counter_offer · award · attach_receipt · submit_work · accept · release_payout · refund_expired · get_job · get_bids · get_rep`

## UI views (bid board)
1. Job card (spec, budget, countdown) · 2. Live bid wall (price/ETA/rep) · 3. Counter-offer card with reason · 4. Receipt panel (verifiable cell proof) · 5. Payout + reputation result card with explorer links.