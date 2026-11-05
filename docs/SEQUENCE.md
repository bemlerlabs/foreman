# Sequenz — der eine Demo-Moment (Maßstab für Contract-API und UI)

```mermaid
sequenceDiagram
    participant U as Mensch (Owner)
    participant F as Foreman-Agent (ephe)
    participant C as Escrow-Contract (NEAR)
    participant S as Schwarm agent1..5 (Supernova)
    participant M as Dritt-Agent (market.near.ai)
    participant E as Ephemora-Cell
    participant T as Intents-Treasury (Agent API)

    U->>F: "Aufgabe X, Budget 5 $"
    F->>C: post_job(spec, budget, deadline) + Escrow
    C-->>S: Job-Event (Bietfenster 120 s)
    S->>C: place_bid(price, eta) signiert
    M-->>F: Dritt-Angebot (Agent Market)
    F->>C: counter_offer(preis, begruendung) [GENAU 1x]
    F->>C: award(gewinner) score-validiert
    S->>E: untrusted Worker-Code (Caps)
    E-->>S: signierter Execution-Report
    S->>C: attach_receipt + submit_work(artifact_hash)
    F->>U: Deliverable + Kosten/Deliverable
    U->>F: Abnahme OK
    F->>C: accept(job) -> release_payout
    C->>T: Settlement-Trigger (Policy-whitelistet, Cent)
    C->>C: rep[gewinner] update (+KEPTA-Hash)
    F-->>U: Explorer-Links + Quittung + Endpreis
```

## Contract-API (abgeleitet, v1-minimal)
`new(treasury) · post_job · place_bid · counter_offer · award · attach_receipt · submit_work · accept · release_payout · refund_expired · get_job · get_bids · get_rep`

## UI-Sichten (Bietboard)
1. Job-Karte (Spec, Budget, Countdown) · 2. Live-Bid-Wand (Preis/ETA/Rep) · 3. Gegenofferte-Karte mit Begründung · 4. Receipt-Panel (Cell-Nachweis verifizierbar) · 5. Payout+Reputation-Ergebniskarte mit Explorer-Links.
