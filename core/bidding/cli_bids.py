#!/usr/bin/env python3
"""cli_bids — Bid-Generator für bid_loop.sh (near-feasibility, task-3).

Aufruf:
    python3 core/bidding/cli_bids.py --seed foreman-demo --out /tmp/foreman_bids.json

Schreibt genau eine JSON-Datei:
    [{"bidder": "agent1.foreman-team.testnet", "price_yocto": "...", "eta_secs": 40}, ... x5]

Garantien (T5-Wiederholbarkeits-Gate):
  * GLEICHER seed ⇒ BYTE-IDENTISCHE Datei (keine Timestamps/RNG-Zustände in der Ausgabe).
  * Agenten exakt aus .env SWARM_ACCOUNTS (5 Stück, Komma-getrennt).
  * Preise gestaffelt_realistisch: deterministisches Seed-Ranking ergibt 5 verschiedene
    Multi-Stufen (Basis 0.5 NEAR-Cent/Paket, ±Feinjitter), nie identisch.
  * Caps: price ≤ DEMO_MAX_USD (default 3 $) und price ≤ budget — Verletzung ⇒ Exit 2.
  * Pipeline echt: je Agent läuft ein MockSupernovaEngine-Lauf (Dekompose→Worker→Synthese)
    über den SupernovaAdapter; Deliverable-Artefakt-Hashe werden validiert (nicht serialisiert).

Determinismus-Quelle: Seed geht in job_id ein → Dekomposition + Ranking + Jitter sind
ausschließlich (seed, spec, agents)-abhängig. Engine: Mock (real liefert T3 mit Provider-Key).
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
    "Recherche NEAR TVL und DEX-Volumen. "
    "Vergleiche NEAR Aurora und Rhea-Pools. "
    "Erstelle Vergleichstabelle. "
    "Fasse Risiken zusammen. "
    "Liefere Quellen mit Datum."
)  # exakt 5 Satzteile (keine Kommas) ⇒ 5 Pakete ⇒ eta 40 s (RULES: Pakete × 8 s)

STAIR_SPREAD = 0.05   # 5 % Stufenabstand → 5 Agenten garantiert verschieden
FINE_JITTER = 0.015   # ±1,5 % Realismus-Jitter (kleiner als halber Stufenabstand)


class GenError(RuntimeError):
    pass


def load_swarm_accounts() -> list:
    """5 Swarm-Konten exakt aus .env SWARM_ACCOUNTS (Reihenfolge bleibt)."""
    from core.bidding.supernova_adapter import _env  # Adapter_ENV-Loader nutzt .env

    raw = _env("SWARM_ACCOUNTS", "")
    agents = [a.strip() for a in raw.split(",") if a.strip()]
    if len(agents) != 5:
        raise GenError(f"SWARM_ACCOUNTS muss 5 Konten enthalten, gefunden: {len(agents)} — {raw!r}")
    if len(set(agents)) != 5:
        raise GenError("SWARM_ACCOUNTS enthält Duplikate")
    return agents


def _seed_score(seed: str, agent: str) -> float:
    return int(hashlib.sha256(f"{seed}|{agent}".encode("utf-8")).hexdigest()[:12], 16) / float(0xFFFFFFFFFFFF)


def stair_factors(seed: str, agents: list) -> dict:
    """Deterministisches Seed-Ranking → 5 gestaffelte Multiplikatoren (0.90..1.10 + Feinjitter).

    Rang aus sha256(seed|agent): gleiche Reihenfolge pro Seed, aber pro Seed unterschiedlich
    ⇒ 'gestaffelt_realistisch' und garantiert verschieden (Stufenabstand 5 % > 2×Jitter).
    """
    ranked = sorted(agents, key=lambda a: (_seed_score(seed, a), a))
    factors = {}
    base = 1.0 - (len(ranked) - 1) * STAIR_SPREAD / 2.0  # Zentrierung um 1.0
    for rank, agent in enumerate(ranked):
        jitter = (_seed_score(seed, f"jitter:{agent}") * 2 - 1) * FINE_JITTER
        factors[agent] = base + rank * STAIR_SPREAD + jitter
    return factors


def generate_bids(seed: str, spec: str = DEFAULT_SPEC, budget_yocto: int = None):
    """→ (bids_liste für JSON, deliverables). Deterministisch in (seed, spec, agents)."""
    if not seed or not seed.strip():
        raise GenError("EMPTY_SEED")
    seed = seed.strip()
    agents = load_swarm_accounts()
    packages = decompose_spec(spec)
    n = len(packages)

    from core.bidding.supernova_adapter import _env, DEFAULT_NEAR_USD, DEFAULT_DEMO_MAX_USD
    if budget_yocto is None:
        # Budget aus DEMO_MAX_USD abgeleitet, +20 % Puffer: Cap bleibt das wirksame Gate.
        cap_usd = float(_env("DEMO_MAX_USD", str(DEFAULT_DEMO_MAX_USD)) or DEFAULT_DEMO_MAX_USD)
        near_usd = float(_env("NEAR_USD_PRICE", str(DEFAULT_NEAR_USD)) or DEFAULT_NEAR_USD)
        budget_yocto = int(cap_usd / near_usd * YOCTO_PER_NEAR * 1.2)

    job = JobRequest(spec=spec, budget_yocto=budget_yocto, deadline_secs=3600,
                     job_id=f"seed:{seed}", acceptance_criteria=["Demo-Bid-Set"])
    factors = stair_factors(seed, agents)

    engine = MockSupernovaEngine()
    bids = []
    deliverables = []
    for agent in agents:
        # echter Pipeline-Schritt je Agent (Mock): Deliverable wird erzeugt + validiert,
        # aber NICHT serialisiert — Byte-Identität der Datei braucht Zeitstempel-freie Ausgabe.
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
        raise GenError("preise nicht gestaffelt: Duplikat gefunden")
    return bids, deliverables


def main(argv: list = None) -> int:
    parser = argparse.ArgumentParser(description="Foreman Demo-Bid-Generator (deterministisch pro Seed)")
    parser.add_argument("--seed", required=True, help="Pflicht: Determinismus-Seed (gleicher Seed => gleiche Datei)")
    parser.add_argument("--out", required=True, help="Pfad der JSON-Datei (eine Datei pro Lauf)")
    parser.add_argument("--spec", default=DEFAULT_SPEC, help="Job-Spec (Standard: Demo-Recherche)")
    parser.add_argument("--budget-yocto", type=int, default=None, help="Job-Budget in yocto (Standard: aus DEMO_MAX_USD)")
    args = parser.parse_args(argv)

    try:
        bids, _ = generate_bids(args.seed, args.spec, args.budget_yocto)
    except (GenError, BidCapExceeded, ValueError) as exc:
        sys.stderr.write(f"cli_bids: FEHLER: {exc}\n")
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
