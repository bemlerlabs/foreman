"""Tests core/reputation/kepta_hook — Snapshot-Hash + Rep-Formel-Parity mit Contract.

Runner: /Users/sanji/supernova/.venv/bin/python -m pytest core/reputation
"""
import hashlib
import sqlite3
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from core.reputation.kepta_hook import (  # noqa: E402
    REP_START,
    OfflineReputation,
    SnapshotError,
    bid_rep_snapshot,
    snapshot_hash,
)


def _sqlite_db(tmp_path: Path, name: str = "kepta.db") -> Path:
    p = tmp_path / name
    con = sqlite3.connect(p)
    con.execute("CREATE TABLE node (id TEXT PRIMARY KEY, body TEXT)")
    con.executemany("INSERT INTO node VALUES (?,?)", [("n1", "client bills quarterly"), ("n2", "NEAR testnet")])
    con.commit()
    con.close()
    return p


# ---------------------------------------------------------------- Snapshot-Hash
def test_snapshot_hash_matches_file_sha256(tmp_path):
    p = _sqlite_db(tmp_path)
    expected = hashlib.sha256(p.read_bytes()).hexdigest()
    assert snapshot_hash(p) == expected
    assert len(expected) == 64


def test_snapshot_hash_changes_on_write(tmp_path):
    p = _sqlite_db(tmp_path)
    h1 = snapshot_hash(p)
    con = sqlite3.connect(p)
    con.execute("INSERT INTO node VALUES ('n3','new memory')")
    con.commit()
    con.close()
    assert snapshot_hash(p) != h1


def test_snapshot_hash_missing_db_raises(tmp_path):
    with pytest.raises(SnapshotError):
        snapshot_hash(tmp_path / "nope.db")


def test_snapshot_hash_non_sqlite_raises(tmp_path):
    p = tmp_path / "fake.db"
    p.write_text("not a sqlite file", encoding="utf-8")
    with pytest.raises(SnapshotError):
        snapshot_hash(p)


def test_bid_rep_snapshot_without_db_is_none_hash(tmp_path):
    rep = OfflineReputation()
    rep.update("agent1", 100)  # 50 → 55
    value, h = bid_rep_snapshot(rep, "agent1", db_path=tmp_path / "missing.db")
    assert value == 55
    assert h is None


def test_bid_rep_snapshot_with_db(tmp_path):
    p = _sqlite_db(tmp_path)
    rep = OfflineReputation()
    value, h = bid_rep_snapshot(rep, "agent9", db_path=p)
    assert value == REP_START
    assert h == hashlib.sha256(p.read_bytes()).hexdigest()


# ---------------------------------------------------------------- Contract-Parität
def _contract_step(old: int, score: int) -> int:
    """Referenz: contracts/foreman/src/lib.rs update_rep — (old*9 + score.min(100)) / 10, u32."""
    return (old * 9 + min(int(score), 100)) // 10


def test_rep_starts_at_50():
    rep = OfflineReputation()
    assert rep.get("unknown.agent.testnet") == 50


def test_rep_formula_matches_contract_reference():
    """Parity gegen die Contract-Formel über eine feste Wertefolge (Determinismus beider Seiten)."""
    rep = OfflineReputation()
    ref = REP_START
    for score in (100, 95, 60, 0, 100, 33, 100, 100):
        assert rep.update("swarm.a.testnet", score) == _contract_step(ref, score)
        ref = _contract_step(ref, score)
    assert rep.get("swarm.a.testnet") == ref


def test_rep_known_values():
    """Von Hand gegen Contract gerechnete Ankerwerte."""
    rep = OfflineReputation()
    assert rep.update("a", 100) == 55           # (50*9+100)//10 = 55
    assert rep.update("a", 0) == 49             # (55*9+0)//10 = 49
    assert rep.apply_refund_expired("a") == 44  # (49*9+0)//10 = 44
    assert rep.update("b", 250) == 55           # Klemmung auf 100 wie Contract (.min(100))


def test_rep_clamps_negative():
    rep = OfflineReputation()
    assert rep.update("c", -20) == 45           # (50*9+0)//10, score ≥ 0


def test_rep_is_per_agent():
    rep = OfflineReputation()
    rep.update("a", 100)
    assert rep.get("a") == 55
    assert rep.get("b") == 50
