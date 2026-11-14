"""Tests core/bidding/cli_bids — the repeated-run gate + output format for bid_loop.sh.

The gate this file exists for is documented in docs/T5_GATE_2026-11-10.md: the same seed, twice,
byte-identical. Runner: python -m pytest core/bidding
"""
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]
CLI = REPO_ROOT / "core" / "bidding" / "cli_bids.py"
sys.path.insert(0, str(REPO_ROOT))

from core.bidding.cli_bids import (  # noqa: E402
    GenError,
    generate_bids,
    load_swarm_accounts,
    stair_factors,
)
from core.bidding.supernova_adapter import (  # noqa: E402
    DEFAULT_SWARM_ACCOUNTS,
    _env,
    usd_value,
)


def _run_cli(seed: str, out: Path, extra=None):
    cmd = [sys.executable, str(CLI), "--seed", seed, "--out", str(out)] + (extra or [])
    r = subprocess.run(cmd, capture_output=True, text=True, cwd=str(REPO_ROOT))
    assert r.returncode == 0, f"CLI rc={r.returncode} ERR={r.stderr[-600:]}"
    return r


# ---------------------------------------------------------------- T5 gate
def test_same_seed_byte_identical(tmp_path):
    a, b = tmp_path / "a.json", tmp_path / "b.json"
    assert _run_cli("foreman-demo", a).returncode == 0
    assert _run_cli("foreman-demo", b).returncode == 0
    assert a.read_bytes() == b.read_bytes(), "T5 gate: the same seed must write a byte-identical file"


def test_different_seed_different_prices(tmp_path):
    a, b = tmp_path / "a.json", tmp_path / "b.json"
    _run_cli("seed-alpha", a)
    _run_cli("seed-beta", b)
    pa = [int(x["price_yocto"]) for x in json.loads(a.read_text())]
    pb = [int(x["price_yocto"]) for x in json.loads(b.read_text())]
    assert pa != pb, "different seeds must produce different prices"


def test_seed_required():
    r = subprocess.run([sys.executable, str(CLI), "--out", "/tmp/nope.json"],
                       capture_output=True, text=True, cwd=str(REPO_ROOT))
    assert r.returncode != 0 and "--seed" in (r.stderr + r.stdout)


# ---------------------------------------------------------------- format for bid_loop.sh
def test_output_format_matches_bid_loop_contract(tmp_path):
    out = tmp_path / "bids.json"
    assert _run_cli("foreman-demo", out).returncode == 0
    bids = json.loads(out.read_text(encoding="utf-8"))
    assert isinstance(bids, list) and len(bids) == 5
    agents = load_swarm_accounts()
    for i, b in enumerate(bids):
        assert set(b.keys()) == {"bidder", "price_yocto", "eta_secs"}
        assert b["bidder"] == agents[i], "agents exactly and in the order the CLI resolves them"
        assert isinstance(b["price_yocto"], str) and int(b["price_yocto"]) > 0
        assert isinstance(b["eta_secs"], int) and b["eta_secs"] == 40  # 5 packages × 8 s


def test_prices_are_staggered_not_identical(tmp_path):
    out = tmp_path / "bids.json"
    _run_cli("foreman-demo", out)
    prices = [int(b["price_yocto"]) for b in json.loads(out.read_text())]
    assert len(set(prices)) == 5, "prices staggered, never identical"
    assert min(prices) * 1.05 < max(prices), "noticeable staggering expected"


def test_caps_hold(tmp_path):
    out = tmp_path / "bids.json"
    _run_cli("foreman-demo", out)
    cap = float(_env("DEMO_MAX_USD", "3") or 3)
    for b in json.loads(out.read_text()):
        assert usd_value(int(b["price_yocto"])) <= cap, "DEMO_MAX_USD hard cap"
        assert int(b["price_yocto"]) <= int(cap / 2.5 * 10**24 * 1.2), "price ≤ default budget"


# ---------------------------------------------------------------- swarm resolution
def test_no_env_still_bids_the_published_swarm(monkeypatch):
    """A fresh clone has no `.env`, and CI has no `.env`: the suite must run on the swarm the
    demo jobs were actually settled with, not fail on configuration nobody can see.

    Checked as absent and as explicitly empty, because in this operator's checkout `.env` supplies
    the same five accounts either way — the empty value is what forces the fallback branch itself.
    """
    for how in ("absent", "empty"):
        if how == "absent":
            monkeypatch.delenv("SWARM_ACCOUNTS", raising=False)
        else:
            monkeypatch.setenv("SWARM_ACCOUNTS", "")
        accounts = load_swarm_accounts()
        assert accounts == DEFAULT_SWARM_ACCOUNTS.split(","), f"{how}: expected the published swarm"
        assert len(set(accounts)) == 5, f"{how}: five distinct bidders"


def test_a_configured_swarm_is_still_checked(tmp_path):
    """The fallback must not soften the contract: an explicit swarm that is wrong is exit 2,
    so an operator who configures a fleet can never quietly bid as a different one."""
    out = tmp_path / "bids.json"
    for bad, why in [("only-one.testnet", "must contain 5"),
                     (",".join(["same.testnet"] * 5), "duplicates")]:
        r = subprocess.run([sys.executable, str(CLI), "--seed", "foreman-demo", "--out", str(out)],
                           capture_output=True, text=True, cwd=str(REPO_ROOT),
                           env={**os.environ, "SWARM_ACCOUNTS": bad})
        assert r.returncode == 2, f"{bad!r} should be refused, got rc={r.returncode}"
        assert why in r.stderr, f"{bad!r}: expected {why!r} in {r.stderr[-200:]}"
        assert not out.exists(), "a refused run writes nothing"


# ---------------------------------------------------------------- unit level
def test_stair_factors_unique_and_seeded():
    agents = [f"agent{i}.foreman-team.testnet" for i in range(1, 6)]
    f1 = stair_factors("s1", agents)
    f2 = stair_factors("s1", agents)
    f3 = stair_factors("s2", agents)
    assert f1 == f2
    assert len({round(v, 12) for v in f1.values()}) == 5
    assert [f1[a] for a in agents] != [f3[a] for a in agents]


def test_generate_bids_empty_seed_raises():
    with pytest.raises(GenError):
        generate_bids("   ")


def test_one_file_per_run(tmp_path):
    out = tmp_path / "runs" / "single.json"  # directory does not exist yet
    assert _run_cli("foreman-demo", out).returncode == 0
    assert out.is_file() and len(list(out.parent.glob("*.json"))) == 1
