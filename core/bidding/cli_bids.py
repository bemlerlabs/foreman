#!/usr/bin/env python3
"""cli_bids — bid generator for bid_loop.sh (near-feasibility, task-3).

Call:
    python3 core/bidding/cli_bids.py --seed foreman-demo --out .state/bids.json

Writes exactly one JSON file:
    [{"bidder": "agent1.foreman-team.testnet", "price_yocto": "...", "eta_secs": 40}, ... x5]

Guarantees (T5 repeatability gate):
  * SAME seed ⇒ BYTE-IDENTICAL file (no timestamps/RNG state in the output).
  * Agents exactly from .env SWARM_ACCOUNTS (5 entries, comma-separated).
  * Prices realistically staggered: a deterministic seed ranking yields 5 distinct
    multi-stairs (base 0.5 NEAR-Cent/package, ±fine jitter), never identical.
  * Caps: price ≤ DEMO_MAX_USD (default $3) and price ≤ budget — violation ⇒ exit 2.
  * Real pipeline: each agent runs a MockSupernovaEngine pass (decompose→worker→synthesis)
    through the SupernovaAdapter; deliverable artifact hashes are validated (not serialized).

Determinism source: the seed feeds job_id → decomposition + ranking + jitter depend
only on (seed, spec, agents). Engine: mock (the real one ships with a provider key).
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from core.bidding.supernova_adapter import (  # noqa: E402
    BASE_PACKAGE_PRICE_YOCTO,
    ETA_PER_PACKAGE_SECS,
    YOCTO_PER_NEAR,
    BidCapExceeded,
    JobRequest,
    MockSupernovaEngine,
    decompose_spec,
    make_bid,
    usd_value,
)

DEFAULT_SPEC = (
    "Research NEAR TVL and DEX volume. "
    "Compare NEAR Aurora and Rhea pools. "
    "Build a comparison table. "
    "Summarize the risks. "
    "Deliver sources with dates."
)  # exactly 5 sentences (no commas) ⇒ 5 packages ⇒ eta 40 s (RULES: packages × 8 s)

STAIR_SPREAD = 0.05   # 5 % stair spacing → 5 agents guaranteed distinct
FINE_JITTER = 0.015   # ±1.5 % realism jitter (smaller than half the stair spacing)


class GenError(RuntimeError):
    pass


def load_swarm_accounts() -> list:
    """The 5 swarm accounts exactly from .env SWARM_ACCOUNTS (order preserved)."""
    from core.bidding.supernova_adapter import _env  # adapter env loader reads .env

    raw = _env("SWARM_ACCOUNTS", "")
    agents = [a.strip() for a in raw.split(",") if a.strip()]
    if len(agents) != 5:
        raise GenError(f"SWARM_ACCOUNTS must contain 5 accounts, found: {len(agents)} — {raw!r}")
    if len(set(agents)) != 5:
        raise GenError("SWARM_ACCOUNTS contains duplicates")
    return agents


def _seed_score(seed: str, agent: str) -> float:
    return int(hashlib.sha256(f"{seed}|{agent}".encode("utf-8")).hexdigest()[:12], 16) / float(0xFFFFFFFFFFFF)


def stair_factors(seed: str, agents: list) -> dict:
    """Deterministic seed ranking → 5 staggered multipliers (0.90..1.10 + fine jitter).

    Rank from sha256(seed|agent): same order per seed, different across seeds
    ⇒ realistically staggered and guaranteed distinct (stair spacing 5 % > 2×jitter).
    """
    ranked = sorted(agents, key=lambda a: (_seed_score(seed, a), a))
    factors = {}
    base = 1.0 - (len(ranked) - 1) * STAIR_SPREAD / 2.0  # centered on 1.0
    for rank, agent in enumerate(ranked):
        jitter = (_seed_score(seed, f"jitter:{agent}") * 2 - 1) * FINE_JITTER
        factors[agent] = base + rank * STAIR_SPREAD + jitter
    return factors


def generate_bids(seed: str, spec: str = DEFAULT_SPEC, budget_yocto: int = None):
    """→ (bids list for JSON, deliverables). Deterministic in (seed, spec, agents)."""
    if not seed or not seed.strip():
        raise GenError("EMPTY_SEED")
    seed = seed.strip()
    agents = load_swarm_accounts()
    packages = decompose_spec(spec)
    n = len(packages)

    from core.bidding.supernova_adapter import _env, DEFAULT_NEAR_USD, DEFAULT_DEMO_MAX_USD
    if budget_yocto is None:
        # Budget derived from DEMO_MAX_USD, +20 % buffer: the cap stays the effective gate.
        cap_usd = float(_env("DEMO_MAX_USD", str(DEFAULT_DEMO_MAX_USD)) or DEFAULT_DEMO_MAX_USD)
        near_usd = float(_env("NEAR_USD_PRICE", str(DEFAULT_NEAR_USD)) or DEFAULT_NEAR_USD)
        budget_yocto = int(cap_usd / near_usd * YOCTO_PER_NEAR * 1.2)

    job = JobRequest(spec=spec, budget_yocto=budget_yocto, deadline_secs=3600,
                     job_id=f"seed:{seed}", acceptance_criteria=["Demo bid set"])
    factors = stair_factors(seed, agents)

    engine = MockSupernovaEngine()
    bids = []
    deliverables = []
    for agent in agents:
        # real pipeline step per agent (mock): the deliverable is produced + validated,
        # but NOT serialized — byte identity of the file needs timestamp-free output.
        bid, deliverable = make_bid(job, agent, rep_snapshot=50, engine=engine)
        if len(deliverable.artifact_hash) != 64:
            raise GenError(f"BAD_ARTIFACT_HASH for {agent}")
        price = int(BASE_PACKAGE_PRICE_YOCTO * n * factors[agent])
        if price <= 0:
            raise GenError(f"NONPOSITIVE_PRICE for {agent}")
        if price > job.budget_yocto:
            raise BidCapExceeded(f"bid {price} yocto > budget {job.budget_yocto}")
        if usd_value(price) > float(_env("DEMO_MAX_USD", "3") or 3):
            raise BidCapExceeded(f"bid {usd_value(price):.4f}$ > DEMO_MAX_USD")
        bids.append({"bidder": agent, "price_yocto": str(price), "eta_secs": n * ETA_PER_PACKAGE_SECS})
        deliverables.append(deliverable)

    prices = [int(b["price_yocto"]) for b in bids]
    if len(set(prices)) != len(prices):
        raise GenError("prices not staggered: duplicate found")
    return bids, deliverables


def main(argv: list = None) -> int:
    parser = argparse.ArgumentParser(description="Foreman demo bid generator (deterministic per seed)")
    parser.add_argument("--seed", required=True, help="required: determinism seed (same seed => same file)")
    parser.add_argument("--out", required=True, help="path of the JSON file (one file per run)")
    parser.add_argument("--spec", default=DEFAULT_SPEC, help="job spec (default: demo research)")
    parser.add_argument("--budget-yocto", type=int, default=None, help="job budget in yocto (default: derived from DEMO_MAX_USD)")
    args = parser.parse_args(argv)

    try:
        bids, _ = generate_bids(args.seed, args.spec, args.budget_yocto)
    except (GenError, BidCapExceeded, ValueError) as exc:
        sys.stderr.write(f"cli_bids: ERROR: {exc}\n")
        return 2

    out_path = Path(args.out)
    if out_path.parent and not out_path.parent.exists():
        out_path.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(bids, indent=2, ensure_ascii=True) + "\n"
    out_path.write_text(payload, encoding="utf-8")
    print(f"cli_bids: {len(bids)} Bids → {out_path} (seed={args.seed})")
    for b in bids:
        p = int(b["price_yocto"])
        print(f"  {b['bidder']}: {p / 10**21:.2f} NEAR-Cent ({usd_value(p):.4f}$) eta={b['eta_secs']}s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
