"""kepta_hook — KEPTA graph snapshot hash + moving-average reputation replication.

1) snapshot_hash(db_path): sha256 over the SQLite file of a swarm's KEPTA graph.
   The hash is carried in the contract as rep_snapshot_hash (RULES.md §Reputation).
   When the pip package `kepta` is importable, the default DB path is resolved
   from it; otherwise the file hash is the contract (API-light, demo-ready).

2) OfflineReputation: replication of the contract formula for the Foreman's offline preview:
       rep_new = (rep_old * 9 + score) // 10      (u32, integer division like Rust)
       start 50, score clamped to [0, 100] (accept: score.min(100); refund_expired: 0).
   Parity duty: every change to contract update_rep() ⇒ update this class too
   (test test_contract_parity compares tabulated values).

Baseline: kepta — MIT, PyPI `kepta`, npm `kepta-mcp` (Q-005).
"""
from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

REPO_ROOT = Path(__file__).resolve().parents[2]
SQLITE_MAGIC = b"SQLite format 3\x00"
REP_START = 50      # CONTRACT_START, RULES.md: start 50
REP_MIN, REP_MAX = 0, 100


class SnapshotError(ValueError):
    """KEPTA snapshot unreadable / not a SQLite file."""


# ---------------------------------------------------------------- KEPTA binding
def default_kepta_db_path() -> Optional[Path]:
    """Best resolution of the KEPTA DB path: pip package `kepta`, else foreman fallback.

    kepta (PyPI) is touched only for path resolution — no write access.
    """
    try:  # optional path via the pip package (API-light: path only, no store setup)
        import kepta  # type: ignore  # noqa: F401

        for attr in ("DEFAULT_DB_PATH", "default_db_path"):
            val = getattr(kepta, attr, None)
            if isinstance(val, str) and val:
                p = Path(val).expanduser()
                if p.is_file():
                    return p
    except Exception:
        pass
    fallback = REPO_ROOT / "data" / "kepta" / "kepta.db"
    return fallback if fallback.is_file() else None


def snapshot_hash(db_path: Path | str) -> str:
    """sha256 over the SQLite file (byte identity ⇒ hash identity).

    Raises SnapshotError when the file is missing, empty, or lacks the SQLite magic header
    (wrong file = wrong attribute in the bid — better to fail loudly than stay silent).
    """
    p = Path(str(db_path)).expanduser()
    if not p.is_file():
        raise SnapshotError(f"KEPTA_DB_MISSING: {p}")
    data = p.read_bytes()
    if not data:
        raise SnapshotError(f"KEPTA_DB_EMPTY: {p}")
    if not data.startswith(SQLITE_MAGIC):
        raise SnapshotError(f"KEPTA_DB_NOT_SQLITE: {p}")
    return hashlib.sha256(data).hexdigest()


# ---------------------------------------------------------------- offline reputation
@dataclass
class OfflineReputation:
    """Moving-average replication of Contract::update_rep for offline preview.

    Uses integer arithmetic only, like Rust u32: (old*9 + score) / 10 integer division.
    No network, no contract call — pure preview; on-chain stays the authority.
    """
    start: int = REP_START
    _rep: dict[str, int] = field(default_factory=dict)

    def get(self, agent: str) -> int:
        """Mirrors Contract::get_rep — an unknown agent starts at 50."""
        return self._rep.get(agent, self.start)

    def update(self, agent: str, score: int) -> int:
        """Mirrors Contract::update_rep — score clamped to [0,100] (accept .min(100))."""
        agent = agent.strip()
        if not agent:
            raise ValueError("EMPTY_AGENT")
        score = int(score)
        if score > REP_MAX:
            score = REP_MAX
        if score < REP_MIN:
            score = REP_MIN
        old = self.get(agent)
        new = (old * 9 + score) // 10  # integer division like Rust u32
        self._rep[agent] = new
        return new

    def apply_refund_expired(self, agent: str) -> int:
        """refund_expired sets the winner score to 0 (RULES.md)."""
        return self.update(agent, 0)

    def snapshot(self) -> dict[str, int]:
        return dict(self._rep)


def bid_rep_snapshot(
    offline: OfflineReputation, agent: str, db_path: Optional[Path | str] = None
) -> tuple[int, Optional[str]]:
    """Convenience for the adapter: (rep, snapshot_hash) for an agent's bid.

    Without a DB (or when unreadable) the hash is None — the contract does not
    require the hash (rep_snapshot is the number), it is only carried along.
    """
    h: Optional[str] = None
    path = Path(db_path) if db_path else default_kepta_db_path()
    if path is not None:
        try:
            h = snapshot_hash(path)
        except SnapshotError:
            h = None
    return offline.get(agent), h
