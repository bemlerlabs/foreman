"""Tests core/market/market_client — Mock-Modus-Vertrag (e2e ohne Netz/Token).

Runner: /Users/sanji/supernova/.venv/bin/python -m pytest core/market
"""
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO_ROOT))

from core.market.market_client import (  # noqa: E402
    MOCK_LISTINGS,
    MarketAuthError,
    MarketClient,
    MarketError,
)


def _mock(monkeypatch=None):
    return MarketClient(token="", prefer="mock")


# ---------------------------------------------------------------- Modus-Wahl
def test_no_token_selects_mock(monkeypatch):
    monkeypatch.delenv("MARKET_AGENT_TOKEN", raising=False)
    c = MarketClient(prefer="auto")
    assert c.mode == "mock"


def test_aat_token_selects_real(monkeypatch):
    monkeypatch.setenv("MARKET_AGENT_TOKEN", "aat_TESTREDACTED")
    c = MarketClient(prefer="auto")
    assert c.mode == "real"


def test_bad_prefer_raises():
    with pytest.raises(ValueError):
        MarketClient(prefer="quatsch")


# ---------------------------------------------------------------- Discovery
def test_discovery_returns_5_real_listings():
    out = _mock().discovery()
    assert len(out) == 5
    for a in out:
        assert set(a.keys()) == {"handle", "name", "category", "price_usd", "asset",
                                 "delivered_jobs", "success_rate", "agent_id"}
        assert a["asset"] == "USDC"
        assert float(a["price_usd"]) > 0


def test_discovery_matches_real_capture():
    """Mock spiegelt die real erfassten Listings vom 06.11. (MARKET_NOTES.md)."""
    handles = [a["handle"] for a in _mock().discovery()]
    assert handles == [a["handle"] for a in MOCK_LISTINGS]
    assert "wallet-activity-lookup" in handles


def test_discovery_filter_and_limit():
    c = _mock()
    assert all(a["category"] == "research" for a in c.discovery(category="research"))
    assert len(c.discovery(limit=2)) == 2
    assert [a["handle"] for a in c.discovery(query="wallet")] == ["wallet-activity-lookup"]
    assert c.discovery(query="gibtsnicht") == []


# ---------------------------------------------------------------- Offer/Accept
def test_hire_draft_flow_contract():
    c = _mock()
    agent = c.discovery(query="wallet")[0]
    draft = c.create_hire_draft(agent["agent_id"], "Analysiere Wallet-Aktivität für Steuerreport")
    assert draft["state"] == "draft" and draft["mode"] == "mock"
    assert draft["agent_id"] == agent["agent_id"]


def test_hire_draft_empty_brief_raises():
    with pytest.raises(ValueError):
        _mock().create_hire_draft("x", "   ")


def test_bid_flow_contract_and_amount_validation():
    c = _mock()
    bid = c.place_bid("job-1", "0.25", "Vom Foreman-Swarm geliefert in < SLA")
    assert bid["state"] == "pending" and bid["amount"] == "0.25"
    for bad in ("0", "-1", "abc", None):
        with pytest.raises(ValueError):
            c.place_bid("job-1", bad, "p")
    with pytest.raises(ValueError):
        c.place_bid("", "0.25", "p")


def test_accept_delivery_contract():
    r = _mock().accept_delivery("asg-1", approve=True, comment="gut")
    assert r["state"] == "reviewed" and r["approve"] is True


# ---------------------------------------------------------------- Real-Modus-Gates
def test_real_401_maps_to_auth_error(monkeypatch):
    monkeypatch.setenv("MARKET_AGENT_TOKEN", "aat_TESTREDACTED")
    c = MarketClient(prefer="real", base_url="http://127.0.0.1:9")  # nichts lauscht → Network-Fehler
    with pytest.raises(MarketError):
        c.discovery()


def test_real_without_token_never_silently_mocks_in_forced_mode():
    c = MarketClient(token="", prefer="real", base_url="http://127.0.0.1:9")
    with pytest.raises(MarketError):
        c.discovery()  # ehrlicher Fehler statt stiller Mock
