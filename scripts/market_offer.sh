#!/usr/bin/env bash
# phase5: the demo's third-party offer - a real agent quoted by the NEAR Agent Market.
#
# Why this exists: the T5 gate text asks for "5 bids + 1 third-party offer". Two market routes are
# public, so the offer is fetched live, without an aat_ token and without hiring anyone:
#   GET /v1/agents?limit=25&sort=rating            -> identity, delivered_jobs, SLA, success_rate
#   GET /v1/agents/{agent_id}/pricing-plans        -> price, model (per_call), listing_status
# That is what this script does: it asks the market, picks the listing that fits the job
# (research), and writes its price into the run with a timestamp.
#
# Honesty rule: when the market cannot be reached, the script falls back to the five listings
# captured on 2026-11-06 and says so with live=0 - it never invents a live read.
#
# Call:   ./scripts/market_offer.sh            (log via $LOG, set by e2e_demo.sh)
# Output: MARKET_OFFER_OK provider=... price_usd=... plan=... live=1|0 fetched_at=...
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
LOG="${LOG:-/tmp/foreman_market_offer.log}"
MARKET_BASE="${MARKET_BASE_URL:-https://market.near.ai}"
TASK_TEXT="${DEMO_SPEC:-research-report: NEAR testnet RPC latency, finality and gas costs across 3 regions; deliver CSV + summary + sources}"

LOG="$LOG" python3 - "$MARKET_BASE" "$TASK_TEXT" <<'PY' | tee -a "$LOG"
"""Pick the third-party offer the market itself publishes for this kind of job."""
import json
import os
import re
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone

base, task = sys.argv[1], sys.argv[2]
log_path = os.environ.get("LOG", "/dev/null")
now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

# The five listings captured on 06.11.2026 (docs/MARKET_NOTES.md), with the prices that run read.
# They are the honest fallback: a dated observation, labelled live=0, never dressed as a fresh read.
FALLBACK = [
    {"handle": "web-research", "price": 0.50, "delivered": 20},
    {"handle": "codecitationdrift", "price": 0.01, "delivered": 0},
    {"handle": "shoplet", "price": 0.10, "delivered": 47},
    {"handle": "ai-gen-text-detector", "price": 0.25, "delivered": 20},
    {"handle": "wallet-activity-lookup", "price": 0.50, "delivered": 20},
]

# The platform's own vocabulary names every listing, so it must not decide the pick: a job about
# NEAR is not best served by the listing that says NEAR the loudest.
PLATFORM_WORDS = {"near", "testnet", "mainnet", "usdc", "usdt", "agent", "agents", "across", "call", "deliver"}
WORDS = set(re.findall(r"[a-z]{4,}", task.lower())) - PLATFORM_WORDS


def words_of(text: str) -> set[str]:
    return set(re.findall(r"[a-z]{4,}", text.lower()))


def get_json(path: str):
    with urllib.request.urlopen(f"{base}{path}", timeout=25) as response:
        return json.load(response)


def score(agent) -> int:
    """A named match counts for more than a description that happens to share a word.

    A job about a research report belongs to the listing that calls itself research; a listing
    whose bio mentions distribution should not win the slot by volume of prose.
    """
    named = words_of(
        " ".join(str(agent.get(key) or "") for key in ("handle", "name", "tags", "category"))
    ) - PLATFORM_WORDS
    described = words_of(" ".join(str(agent.get(key) or "") for key in ("description", "bio_markdown")))
    return 3 * len(WORDS & named) + len(WORDS & described)


def live_price(agent_id: str):
    plans = get_json(f"/v1/agents/{agent_id}/pricing-plans")
    if not isinstance(plans, list):
        return None
    live = [p for p in plans if isinstance(p, dict) and p.get("listing_status") == "live"]
    priced = []
    for plan in live:
        raw = plan.get("price_amount")
        try:
            priced.append((float(raw), plan))
        except (TypeError, ValueError):
            continue
    if not priced:
        return None
    if live:
        priced.sort(key=lambda row: (not row[1].get("is_default"), row[0]))
    return priced[0]


try:
    agents = get_json("/v1/agents?limit=25&sort=rating").get("agents") or []
    ranked = sorted(agents, key=lambda a: (-score(a), -(a.get("rating") or 0)))
    if score(ranked[0]) == 0:
        # Nothing names the task; the top rated listing is still a real third-party offer.
        ranked.sort(key=lambda a: -(a.get("rating") or 0))
    choice = None
    for agent in ranked[:4]:
        found = live_price(agent["agent_id"])
        if found:
            choice = (agent, found[0], found[1])
            break
    if choice is None:
        raise ValueError("no live priced plan in the answer")
    agent, price, plan = choice
    handle = agent.get("handle") or agent.get("name") or "unknown"
    print(
        f"MARKET_OFFER_OK provider={handle} price_usd={price:.2f} "
        f"plan={plan.get('model', 'per_call')} listings={len(agents)} live=1 "
        f"fetched_at={now} delivered={agent.get('delivered_jobs')} "
        f"success_rate={agent.get('success_rate')} sla_seconds={agent.get('sla_seconds')}"
    )
    print(
        f"MARKET_OFFER_NOTE the market quotes {handle} at {price:.2f} USD per call; "
        f"the swarm sits below that price, which is why the counter-offer has room."
    )
except (urllib.error.URLError, ValueError, KeyError, OSError, TimeoutError) as exc:
    best = max(FALLBACK, key=lambda row: len(WORDS & words_of(row["handle"])))
    print(
        f"MARKET_OFFER_OK provider={best['handle']} price_usd={best['price']:.2f} "
        f"plan=per_call listings={len(FALLBACK)} live=0 fetched_at={now} "
        f"reason={type(exc).__name__}"
    )
    print(
        f"MARKET_OFFER_NOTE market unreachable ({type(exc).__name__}) - the dated listings from "
        f"2026-11-06 stand in as the offer, named as such."
    )
PY
