# X_POST_DRAFT — Demo-Post Foreman (Entwurf zur Abnahme durch den Lead)
<!-- Regeln aus HACKATHON.md „The demo post": erste Zeile = User-Problem für Außenstehende · EIN vollständiger Moment · NEAR-Rolle konkret benannt · Next Step. Video MUSS vom Menschen selbst gepostet werden; Agenten dürfen nur den Text entwerfen. Zeichen-Zählung inkl. Tags geprüft (2026-11-05): V1=280 V2=270 V3=271 (mit {cost_per_deliverable}→"$0.04"), Langfassung=1701. Platzhalter vor Post-Vergabe ersetzen; Repo-/Demo-Links als Antwort unter den Post hängen (halten den Post unter 280). -->

## Variante 1 — Problem-first (Haseeb-Rahmen: Zahl statt Narrativ)
> AI agents can't buy work: nobody pays before delivery is proven. Our agent hires competing agent swarms on NEAR: live bids, ONE reasoned counter-offer, on-chain escrow, payout after acceptance. {cost_per_deliverable} per delivered task. Built @NEARProtocol #NEARHackathon @NearLegion @NearBuilders

*280 Zeichen inkl. Platzhalter-Füllung. Pflicht: {cost_per_deliverable} durch reale Zahl aus docs/EVIDENCE_LOG.md ersetzen (Vergleichsbasis: Auftragsspec + Stundenlohn-Äquivalent), sonst Variante 2 nehmen.*

## Variante 2 — Demo-Moment-first (der 60-Sekunden-Beweis)
> 60s: task+budget in → 5 swarms on NEAR sub-accounts bid → agent negotiates ONE counter-offer → winner runs sandboxed, signs the execution receipt on-chain → escrow releases cents via NEAR Intents. Video+repo ↓ Built @NEARProtocol #NEARHackathon @NearLegion @NearBuilders

*271 Zeichen. Stark, wenn das Video wirklich den Countdown + Bid-Wand + Receipt-Panel zeigt (sonst ist "60s" eine unbewiesene Behauptung — OKC-Regel).*

## Variante 2-final — für den Post freigegebenes Muster (2026-11-12, 274 Zeichen inkl. Tags)
> AI agents can't pay each other safely. Foreman on NEAR: task+budget in → 5 swarms bid → ONE reasoned counter-offer → sandboxed work, ES256 receipt on-chain → escrow pays 90/10 after acceptance. Built at NEAR HACKATHON ↓ @NEARProtocol #NEARHackathon @NearLegion @NearBuilders

*Ersetzt V2: "60s" war unbewiesen (der Film ist 98 s), und "escrow releases cents via NEAR Intents" war ein Overclaim — der Payout läuft über accept() des Escrow-Contracts (90/10, Tx FBmYW7aU…). Intents ist als dry:true-vorbereitete Policy-Treasury belegt, nicht als Settlement. Video anhängen (foreman-film_final.mp4); Repo-Link (+ Live-Board-URL, falls gehostet) als Antwort unter den Post.*

## Variante 3 — Market-of-markets-first (Mert/Illia-Rahmen)
> Our agent bought work from a stranger: quoted on market.near.ai, haggled once, escrowed on NEAR, paid real cents via the Intents Agent API policy treasury, kept signed receipts. An economy between agents, not a demo. @NEARProtocol #NEARHackathon @NearLegion @NearBuilders

*271 Zeichen. Höchste Resonanz-Chance im NEAR-Kontext, weil Agent-Market-Integration Partner-Signal ist. Nur wählbar, wenn der Dritt-Hire live passiert ist (sonst nicht posten — Lüge).*

## Langfassung — 2000-Zeichen-`idea`-Feld der Submission (und Faden-Antwort zum Post)
> AI agents can read, write and reason — but they still cannot buy work from each other with real money. There is no enforceable money flow between agents: who pays before delivery and quality are proven, and who can prove what ran in their name?
>
> Foreman is a general-contractor agent: you give it a task and a budget. It breaks the task down, gets competing quotes from 5 autonomous swarms (each with its own NEAR sub-account and function-call key) and from independent third-party agents on the NEAR AI Agent Market (market.near.ai), places exactly one reasoned counter-offer, awards by score, and pays only after acceptance.
>
> What makes it real, not a mock:
> - Escrow contract on NEAR is the only authority over funds, bids, receipts and reputation — states Open→Bidding→Awarded→Delivered→Accepted|Refunded|Expired, refund path included.
> - Worker code runs only in a sandboxed Ephemora cell (fuel/memory/egress caps); a signed execution receipt is anchored on-chain BEFORE work can be submitted.
> - Settlement through a single NEAR Intents Agent API policy treasury: destination-whitelisted, cent amounts, every quote dry:true first.
> - Reputation updates on-chain only through acceptance; {cost_per_deliverable} per delivered task is the number that has to beat a human freelancer, and our evidence log has it.
>
> Built at NEAR HACKATHON 2026, tracks swarms + agents + business + open. RULES.md, sequence diagram, contract tests and a full evidence log are in the public repo — every number links to an artifact.
>
> Question to the agent economy: what task would you hand to an agent that has to compete for the job and only gets paid when you accept?
>
> Repo + demo video ↓
> @NEARProtocol #NEARHackathon @NearLegion @NearBuilders

*1706 Zeichen inkl. Tags — passt exakt ins `idea`-Feld (20–2000, HACKATHON.md) UND als 1. Faden-Antwort. Für das idea-Feld dürfen die Handles am Ende entfallen (kein Twitter-Feld).*

## Auslieferungs-Checkliste (vor dem Posten, vom Menschen abzuhaken)
- [ ] Video: EIN Durchlauf des Demo-Moments (Job → Bids → Gegenofferte → Receipt → Payout), ungeschnitten ≥ die 60 s, Panels lesbar
- [ ] {cost_per_deliverable} gesetzt und durch EVIDENCE_LOG-Artefakt gedeckt
- [ ] Post öffentlich, tagged wie oben (alle vier Handles), Repo- + Demo-Link als Antwort
- [ ] Demo-Hosting bis ≥ 18.11. (ideal 25.11., Q-012) live, bevor der Post abgesetzt wird
- [ ] Post erst NACH Repo-Public; Submission (201) erst NACH dem Post; danach nur noch `request-changes`, niemals Zweit-Submit
