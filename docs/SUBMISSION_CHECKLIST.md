# Submission readiness — final handoff, 2026-11-12

State: film final, README EN, payload prepared, X post live. Repo publication (push + public) is the
remaining step — authorized by the owner ("the repo must be public when you're done"). Everything below
is copy-paste ready; the form submit is the owner's click.

## Done (proven)

| Piece | State | Proof |
|---|---|---|
| Film | 98 s, 1920×1080, 30 fps, new VO (voice approved by the owner), all numbers = job 50, no home paths | `foreman-film/renders/foreman-film_final.mp4` (desktop copy identical in content) |
| README | English, do-X→see-Y measured live (16 receipt tests, 47 contract tests, verify True) | Commit `9e83e31` |
| Board payout fix | budget − 10% instead of bid price | Commit `f69ffa2` |
| Payload | `docs/SUBMISSION_2026-11-13.json`: requestId fixed, size "1", tracks [swarms,agents,business,open], projectName Foreman, leadName bemlerlabs, nearAddress bemlerlabs.near, idea 1691 chars without placeholders/handles, Intents honestly worded | Commit `bb1e656` + leadName fill |
| X text | Variant 2-final, 265 characters incl. tags, "Built at NEAR HACKATHON", all four handles | `docs/X_POST_DRAFT.md` |
| X post | LIVE at https://x.com/MimiT3chAi/status/2121012696376312294 (posted by the owner) | — |
| Open in payload | `email` (owner enters), `demoUrl` (= the X post URL), `consent` (owner click) | — |

## Owner steps (in this order, each public/irreversible)

1. **Push** (repo still private, ahead of origin):
   `git push origin main`
2. **Repo public**: `gh repo edit bemlerlabs/foreman --visibility public` (or GitHub Settings).
   Must stay public until 14.11. 23:59 UTC; LICENSE (Apache-2.0) is present.
3. **Optional hosting** (organizer: "hosted demo helps", online until ≥ 18.11.): on request I build
   a Qoder Sites draft of the read-only board; publish only after owner okay.
4. **X post** — DONE from account **@MimiT3chAi (Michael Bemler)**, video attached (`foreman-film_final.mp4`), text exactly (265 characters):
   > AI agents can't pay each other safely. Foreman on NEAR: 5 swarms bid → ONE reasoned counter-offer → sandboxed work, ES256 receipt on-chain → escrow pays 90/10 after acceptance. Built at NEAR HACKATHON @NEARProtocol #NEARHackathon #AIAgents @NearLegion @NearBuilders

   Reply under the post: `Repo: https://github.com/bemlerlabs/foreman` (+ live board URL if hosted).
   The post URL is the `demoUrl` field.
5. **Form** <https://nearhackathon.com/#apply> — fields:
   | Field | Value |
   |---|---|
   | Project name | Foreman |
   | Team lead | bemlerlabs |
   | Email | (owner enters; max. 2 submissions per email) |
   | Team size | 1 (solo) |
   | Tracks | swarms · agents · business · open (AI Swarms, Agent Economy, Business, Open Innovation) |
   | NEAR wallet | bemlerlabs.near |
   | Repository link | https://github.com/bemlerlabs/foreman |
   | Demo post link | https://x.com/MimiT3chAi/status/2121012696376312294 |
   | What did you build? | idea from the payload, 1691 characters — to the clipboard: `python3 -c "import json;print(json.load(open('docs/SUBMISSION_2026-11-13.json'))['idea'])" \| pbcopy` |
   | Website | **leave empty** (spam trap, any value rejects) |
   | Consent | tick the checkbox only after reading it yourself |
6. **Submit, once.** Error rules: 409 → `/request-changes` (never a second submit, never change link/email);
   503 → wait 1 min, same requestId; 403 → STOP (window closed).

## What the film deliberately does not claim

- No real third-party *hire*: a real market **offer** is shown (0.50 USD, read live), no hire transaction.
- Settlement runs through `accept()` of the escrow contract (90/10); Intents is proven as a dry:true-prepared
  policy treasury — payload and X text are worded accordingly (no overclaim).
- Swarm accounts team-controlled; disclosure in the film (end card) and README.

## Rules cross-check (live against nearhackathon.com/HACKATHON.md, 12.11.)

- Video length: no requirement → 98 s ok. Problem-first ✓, one complete moment ✓, NEAR role concrete ✓.
- X post: "built at NEAR HACKATHON" ✓, @NEARProtocol #NEARHackathon ✓, video attached ✓.
- AI screening (Q-017): README machine-readable ✓, evidence log ✓, cold start via vendored wheel ✓.
- Baselines declared ✓; only the NEAR integration in the window 19.10.–14.11. is judged.
- Tracks end card = official names ✓; payload IDs = form IDs ✓.