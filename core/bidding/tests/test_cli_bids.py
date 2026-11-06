"""Tests core/bidding/cli_bids — T5-Wiederholbarkeits-Gate + Ausgabeformat für bid_loop.sh.

Runner: /Users/sanji/supernova/.venv/bin/python -m pytest core/bidding
"""
import json
import subprocess
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]
CLI = REPO_ROOT / "core" / "bidding" / "cli_bids.py"
sys.path.insert(0, str(REPO_ROOT))

from core.bidding.cli_bids import DEFAULT_SPEC, GenError, generate_bids, stair_factors  # noqa: E402
from core.bidding.supernova_adapter import _env, usd_value  # noqa: E402


def _run_cli(seed: str, out: Path, extra=None):
    cmd = [sys.executable, str(CLI), "--seed", seed, "--out", str(out)] + (extra or [])
    r = subprocess.run(cmd, capture_output=True, text=True, cwd=str(REPO_ROOT))
    assert r.returncode == 0, f"CLI rc={r.returncode} ERR={r.stderr[-600:]}"
    return r


# ---------------------------------------------------------------- T5-Gate
def test_same_seed_byte_identical(tmp_path):
    a, b = tmp_path / "a.json", tmp_path / "b.json"
    assert _run_cli("foreman-demo", a).returncode == 0
    assert _run_cli("foreman-demo", b).returncode == 0
    assert a.read_bytes() == b.read_bytes(), "T5-Gate: gleicher Seed muss byte-identische Datei schreiben"


def test_different_seed_different_prices(tmp_path):
    a, b = tmp_path / "a.json", tmp_path / "b.json"
    _run_cli("seed-alpha", a)
    _run_cli("seed-beta", b)
    pa = [int(x["price_yocto"]) for x in json.loads(a.read_text())]
    pb = [int(x["price_yocto"]) for x in json.loads(b.read_text())]
    assert pa != pb, "unterschiedliche Seeds müssen verschiedene Preise erzeugen"


def test_seed_required():
    r = subprocess.run([sys.executable, str(CLI), "--out", "/tmp/nope.json"],
                       capture_output=True, text=True, cwd=str(REPO_ROOT))
    assert r.returncode != 0 and "--seed" in (r.stderr + r.stdout)


# ---------------------------------------------------------------- Format für bid_loop.sh
def test_output_format_matches_bid_loop_contract(tmp_path):
    out = tmp_path / "bids.json"
    assert _run_cli("foreman-demo", out).returncode == 0
    bids = json.loads(out.read_text(encoding="utf-8"))
    assert isinstance(bids, list) and len(bids) == 5
    agents = [a.strip() for a in (_env("SWARM_ACCOUNTS") or "").split(",") if a.strip()]
    for i, b in enumerate(bids):
        assert set(b.keys()) == {"bidder", "price_yocto", "eta_secs"}
        assert b["bidder"] == agents[i], "Agenten exakt und in Reihenfolge .env SWARM_ACCOUNTS"
        assert isinstance(b["price_yocto"], str) and int(b["price_yocto"]) > 0
        assert isinstance(b["eta_secs"], int) and b["eta_secs"] == 40  # 5 Pakete × 8 s


def test_prices_staffelt_nicht_identisch(tmp_path):
    out = tmp_path / "bids.json"
    _run_cli("foreman-demo", out)
    prices = [int(b["price_yocto"]) for b in json.loads(out.read_text())]
    assert len(set(prices)) == 5, "Preise gestaffelt, nie identisch"
    assert min(prices) * 1.05 < max(prices), "Spürbare Staffelung erwartet"


def test_caps_hold(tmp_path):
    out = tmp_path / "bids.json"
    _run_cli("foreman-demo", out)
    cap = float(_env("DEMO_MAX_USD", "3") or 3)
    for b in json.loads(out.read_text()):
        assert usd_value(int(b["price_yocto"])) <= cap, "DEMO_MAX_USD-Hard-Cap"
        assert int(b["price_yocto"]) <= int(cap / 2.5 * 10**24 * 1.2), "price ≤ Standard-Budget"


# ---------------------------------------------------------------- Unit-Ebene
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
    out = tmp_path / "runs" / "single.json"  # Verzeichnis existiert noch nicht
    assert _run_cli("foreman-demo", out).returncode == 0
    assert out.is_file() and len(list(out.parent.glob("*.json"))) == 1
