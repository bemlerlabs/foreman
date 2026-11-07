# Anfrage an NEAR Intents Team (t.me/near_intents) — vor Nutzung von API-Geld einreichen
# (Beweiskultur: Fund-Verhalten der Demo-Umgebung bestätigen lassen, wie in 03_NEAR_FEASIBILITY.md vermerkt)

--- Copy-Paste-Text (Englisch, hackathon-Kontext, kurz) ---

Hi NEAR Intents team 👋 Building "Foreman" for NEAR HACKATHON (repo will be public by 13.11).
Two quick questions before we wire real (tiny) money into our demo:

1. We use the Agent API with a partner key (naa_…) from partners.demo.agentsonintents.com.
   Is this demo deployment meant to be used with real mainnet funds for hackathon demos,
   or should we go straight to the production api.agentsonintents.com instead?

2. Owner policy signing (NEP-366 gasless): any gotchas for a demo flow where one human
   owner signs budget/destination limits once, and the agent operates grants (ngt_…) within
   them? Our caps: NEAR/USDC only, ≤ 3 USD total, dry:true first for every quote.

Would love a 👍/👎 on using the demo endpoint with cent amounts — we'd rather ask than surprise anyone. Danke! #NEARHackathon


--- Update 06.11. — zwei Zusatztitel zum Posten (Q3+Q4) ---

3. agent_create comes back as intent.standard=nep366. Our browser wallet (Meteor) exposes signMessage/signAndSendTransaction
   but no signDelegateActions. Which wallet/version in your stack implements wallet.signDelegateActions for NEP-366
   owner intents today (agent-connect widget? a specific Meteor build?)?

4. We plan to use a passkey (webauthn) NEAR owner on production (owner_types shows near+passkey there): for a fresh
   human owner, is the flow generate-intent → startAuthentication directly, or must the passkey credential be
   registered with the API first (which endpoint)? Safari + Touch ID is our demo path.

Bonus: any hackathon dev-funding (a few NEAR on mainnet) for the live-swap part of our demo? Happy to credit in the
demo post. #NEARHackathon

--- Ende Update ---

--- Ende ---
Status: ⬜ vom USER in t.me/near_intents zu senden (oder Lead übergibt Text)
