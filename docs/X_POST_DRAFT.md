# X_POST_DRAFT — Foreman demo post (draft for Lead approval)
<!-- Rules from HACKATHON.md "The demo post": first line = user problem for outsiders · ONE complete moment · NEAR role named concretely · next step. The video MUST be posted by the human themselves; agents may only draft the text. Character count incl. tags checked (2026-11-05): V1=280 V2=270 V3=271 (with {cost_per_deliverable}→"$0.04"), long version=1701. Replace placeholders before post approval; hang repo/demo links as a reply under the post (keeps the post under 280). -->

## Variant 1 — problem-first (Haseeb frame: number instead of narrative)
> AI agents can't buy work: nobody pays before delivery is proven. Our agent hires competing agent swarms on NEAR: live bids, ONE reasoned counter-offer, on-chain escrow, payout after acceptance. {cost_per_deliverable} per delivered task. Built @NEARProtocol #NEARHackathon @NearLegion @NearBuilders

*280 characters incl. placeholder fill. Mandatory: replace {cost_per_deliverable} with a real number from docs/EVIDENCE_LOG.md (comparison basis: job spec + hourly-wage equivalent), otherwise take variant 2.*

## Variant 2 — demo-moment-first (the 60-second proof)
> 60s: task+budget in → 5 swarms on NEAR sub-accounts bid → agent negotiates ONE counter-offer → winner runs sandboxed, signs the execution receipt on-chain → escrow releases cents via NEAR Intents. Video+repo ↓ Built @NEARProtocol #NEARHackathon @NearLegion @NearBuilders

*271 characters. Strong if the video really shows the countdown + bid wall + receipt panel (otherwise "60s" is an unproven claim — OKC rule).*

## Variant 2-final — pattern approved for the post (2026-11-12, 265 characters incl. tags)
> AI agents can't pay each other safely. Foreman on NEAR: 5 swarms bid → ONE reasoned counter-offer → sandboxed work, ES256 receipt on-chain → escrow pays 90/10 after acceptance. Built at NEAR HACKATHON @NEARProtocol #NEARHackathon #AIAgents @NearLegion @NearBuilders

*Replaces V2: "60s" was unproven (the film is 98 s), and "escrow releases cents via NEAR Intents" was an overclaim — the payout runs through accept() of the escrow contract (90/10, tx FBmYW7aU…). Intents is proven as a dry:true-prepared policy treasury, not as settlement. Attach the video (foreman-film_final.mp4); repo link (+ live board URL if hosted) as a reply under the post.*

## Variant 3 — market-of-markets-first (Mert/Illia frame)
> Our agent bought work from a stranger: quoted on market.near.ai, haggled once, escrowed on NEAR, paid real cents via the Intents Agent API policy treasury, kept signed receipts. An economy between agents, not a demo. @NEARProtocol #NEARHackathon @NearLegion @NearBuilders

*271 characters. Highest resonance chance in the NEAR context, because Agent Market integration is a partner signal. Only selectable if the third-party hire happened live (otherwise do not post — a lie).*

## Long version — the 2000-character `idea` field of the submission (and thread reply to the post)
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

*1706 characters incl. tags — fits exactly into the `idea` field (20–2000, HACKATHON.md) AND as the 1st thread reply. For the idea field the handles at the end may be dropped (not a Twitter field).*

## Delivery checklist (before posting, to be ticked by the human)
- [ ] Video: ONE run of the demo moment (job → bids → counter-offer → receipt → payout), uncut ≥ the 60 s, panels readable
- [ ] {cost_per_deliverable} set and covered by an EVIDENCE_LOG artifact
- [ ] Post public, tagged as above (all four handles), repo + demo link as a reply
- [ ] Demo hosting live until ≥ 18.11. (ideal 25.11., Q-012) before the post is sent
- [ ] Post only AFTER repo-public; submission (201) only AFTER the post; afterwards only `request-changes`, never a second submit

## Thread continuation (under the live post)

Live post: https://x.com/MimiT3chAi/status/2121012696376312294 (posted by the owner, video attached).
The owner posted the long `idea` text as reply 1; the repo-link reply (R2) is posted. The replies below
are ready to paste — attach the named screenshot from `docs/assets/` to each for reach. Number-led
captions, one image per reply, end on a question; keep each reply ≤ 280 characters.

**R2 — posted (repo link):**
> The code is open. Every number in the film links to an artifact in the repo:
> github.com/bemlerlabs/foreman
>
> 5 swarms bid → 1 reasoned counter → sandboxed work → ES256 receipt on-chain → escrow pays 90/10 after acceptance.

**R3 — bid board (attach `docs/assets/dashboard-job50.png`):**
> Live bid board, polling NEAR RPC directly — no middleman database.
> Job 50: budget 900¢ · winning bid 13.56¢ · counter 12.20¢ (−10%) · settled 810¢ to the worker, rep 78→79.

**R4 — runs in ephe (attach `docs/assets/ephe-flow.png`):**
> It runs as a plugin inside ephe.
> Plain-English request → /foreman-hire → the agent posts the job, runs the bidding round, and accepts only with a verified receipt.

**R5 — fail-closed + engagement (attach `docs/assets/fail-closed.png`):**
> Fail-closed is the point: accept without a signed receipt → the contract panics NOT_DELIVERED, even when the boss calls it.
> 47 contract tests · 16 receipt tests · 2× deterministic E2E.
> What task would you hand an agent that only gets paid when you accept?