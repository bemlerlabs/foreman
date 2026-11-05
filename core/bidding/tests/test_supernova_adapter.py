"""Tests core/bidding/supernova_adapter — Bid-Range, Cap-Gates, Eta, Determinismus.

Runner: /Users/sanji/supernova/.venv/bin/python -m pytest core/bidding (pytest aus Supernova-venv,
reine Test-Laufzeit-Nutzung, keine Änderung an Supernova).
"""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from core.bidding.supernova_adapter import (  # noqa: E402
    BASE_PACKAGE_PRICE_YOCTO,
    ETA_PER_PACKAGE_SECS,
    PACKAGES_MAX,
    PACKAGES_MIN,
    YOCTO_PER_NEAR,
    BidCapExceeded,
    JobRequest,
    MockSupernovaEngine,
    RealSupernovaEngine,
    decompose_spec,
    make_bid,
    make_engine,
    price_yocto_for,
    usd_value,
)

NEAR_CENT = YOCTO_PER_NEAR // 100


def _job(budget_yocto=50 * NEAR_CENT, deadline=3600):
    return JobRequest(
        spec="Recherche NEAR TVL. Vergleiche 3 Chains. Erstelle Tabelle. Fasse Risiken zusammen. "
        "Prüfe Staking-Yields. Liefere Quellen mit Datum.",
        budget_yocto=budget_yocto,
        deadline_secs=deadline,
        job_id="job-42",
        acceptance_criteria=["Tabelle mit 3 Chains", "Quellen mit Datum"],
    )


# ---------------------------------------------------------------- Dekomposition
def test_decompose_within_bounds():
    pkgs = decompose_spec(_job().spec)
    assert PACKAGES_MIN <= len(pkgs) <= PACKAGES_MAX


def test_decompose_deterministic():
    assert decompose_spec("a. b. c. d.") == decompose_spec("a. b. c. d.")


def test_decompose_empty_raises():
    with pytest.raises(ValueError):
        decompose_spec("   ")


# ---------------------------------------------------------------- Bid-Range
def test_bid_range_and_eta():
    job = _job()
    for i in range(10):
        bid, deliv = make_bid(job, f"agent{i}.mimi.testnet", engine=MockSupernovaEngine())
        n = len(deliv.packages)
        lo = int(BASE_PACKAGE_PRICE_YOCTO * n * 0.90)
        hi = int(BASE_PACKAGE_PRICE_YOCTO * n * 1.10) + 1
        assert lo <= bid.price_in_yocto <= hi, "Preis außerhalb Basis×Pakete×±10%-Jitter"
        assert bid.eta_secs == n * ETA_PER_PACKAGE_SECS
        assert 0 <= bid.rep_snapshot <= 100
        assert bid.price_in_yocto <= job.budget_yocto
        assert bid.bidder == f"agent{i}.mimi.testnet"
        assert len(deliv.artifact_hash) == 64


def test_jitter_varies_per_agent():
    job = _job()
    prices = {make_bid(job, f"agent{i}", engine=MockSupernovaEngine())[0].price_in_yocto for i in range(5)}
    assert len(prices) > 1, "Jitter je Agent erwartet"


def test_deterministic_replay_for_demo():
    """T5-Gate: zweiter identischer Lauf ⇒ identische Preise + Artefakt-Hash."""
    job = _job()
    b1, d1 = make_bid(job, "agent3.testnet", engine=MockSupernovaEngine())
    b2, d2 = make_bid(job, "agent3.testnet", engine=MockSupernovaEngine())
    assert b1.price_in_yocto == b2.price_in_yocto
    assert d1.artifact_hash == d2.artifact_hash


# ---------------------------------------------------------------- Cap-Gates
def test_cap_violation_raises(monkeypatch):
    monkeypatch.setenv("DEMO_MAX_USD", "0.0000001")  # Cap unter jedem Bid
    job = _job()
    with pytest.raises(BidCapExceeded):
        make_bid(job, "agent1.testnet", engine=MockSupernovaEngine())


def test_over_budget_raises():
    job = _job(budget_yocto=1)  # 1 yocto Budget ⇒ jeder Bid darüber
    with pytest.raises(BidCapExceeded):
        make_bid(job, "agent1.testnet", engine=MockSupernovaEngine())


def test_default_cap_allows_demo_bids():
    """Demo-Bereich: 2–6 Pakete × 0.5 NEAR-Cent × 1.1 ⇒ < 3 $ bei Demo-NEAR-Preis."""
    job = _job()
    bid, _ = make_bid(job, "agent1.testnet", engine=MockSupernovaEngine())
    assert usd_value(bid.price_in_yocto) < 3.0


# ---------------------------------------------------------------- Engine-Wahl
def test_real_engine_unavailable_without_key(monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("NEAR_AI_API_KEY", raising=False)
    assert RealSupernovaEngine.available() is False


def test_make_engine_falls_back_to_mock(monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("NEAR_AI_API_KEY", raising=False)
    assert make_engine("auto").name == "supernova-mock"


def test_make_engine_forced_mock():
    assert make_engine("mock").name == "supernova-mock"
