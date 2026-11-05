"""kepta_hook — KEPTA-Graph-Snapshot-Hash + Reputation-Gleitzeit-Replikation.

1) snapshot_hash(db_path): sha256 über die SQLite-Datei des KEPTA-Graphen eines Schwarms.
   Der Hash wird im Contract als rep_snapshot_hash mitgeführt (RULES.md §Reputation).
   Wenn das pip-Paket `kepta` importierbar ist, wird der Standard-DB-Pfad daraus
   aufgelöst; sonst ist der Datei-Hash der Vertrag (API-light, demo-tauglich).

2) OfflineReputation: Replikation der Contract-Formel für Offline-Vorschau des Foreman:
       rep_new = (rep_old * 9 + score) // 10      (u32, Ganzzahl-Division wie Rust)
       Start 50, score geklemmt auf [0, 100] (accept: score.min(100); refund_expired: 0).
   Parity-Pflicht: jede Änderung an Contract update_rep() ⇒ diese Klasse mitziehen
   (Test test_contract_parity vergleicht Tabellenwerte).

Baseline: kepta — /Users/sanji/kepta, MIT, PyPI `kepta`, npm `kepta-mcp` (Q-005).
"""
from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

REPO_ROOT = Path(__file__).resolve().parents[2]
SQLITE_MAGIC = b"SQLite format 3\x00"
REP_START = 50      # CONTRACT_START, RULES.md: Start 50
REP_MIN, REP_MAX = 0, 100


class SnapshotError(ValueError):
    """KEPTA-Snapshot nicht lesbar / keine SQLite-Datei."""


# ---------------------------------------------------------------- KEPTA-Anbindung
def default_kepta_db_path() -> Optional[Path]:
    """Beste Auflösung des KEPTA-DB-Pfads: pip-Paket `kepta`, sonst foreman-Fallback.

    kepta (PyPI) wird nur zur Pfad-Auflösung berührt — keine Schreibzugriffe.
    """
    try:  # optionaler Pfad über das pip-Paket (API-light: nur Pfad, kein Store-Aufbau)
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
    """sha256 über die SQLite-Datei (Bytes-Identität ⇒ Hash-Identität).

    Wirft SnapshotError, wenn die Datei fehlt, leer ist oder keinen SQLite-Magic-Header hat
    (falsche Datei = falsches Attribut im Bid — besser laut scheitern als still schweigen).
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


# ---------------------------------------------------------------- Offline-Reputation
@dataclass
class OfflineReputation:
    """Gleitzeit-Replikation von Contract::update_rep für Offline-Vorschau.

    Nutzt ausschließlich Integer-Arithmetik wie Rust u32: (old*9 + score) / 10 ganzzahlig.
    Kein Netzwerk, kein Contract-Call — reine Vorschau; on-chain bleibt die Autorität.
    """
    start: int = REP_START
    _rep: dict[str, int] = field(default_factory=dict)

    def get(self, agent: str) -> int:
        """Analog Contract::get_rep — unbekannter Agent startet bei 50."""
        return self._rep.get(agent, self.start)

    def update(self, agent: str, score: int) -> int:
        """Analog Contract::update_rep — score auf [0,100] geklemmt (accept .min(100))."""
        agent = agent.strip()
        if not agent:
            raise ValueError("EMPTY_AGENT")
        score = int(score)
        if score > REP_MAX:
            score = REP_MAX
        if score < REP_MIN:
            score = REP_MIN
        old = self.get(agent)
        new = (old * 9 + score) // 10  # Ganzzahl-Division wie Rust u32
        self._rep[agent] = new
        return new

    def apply_refund_expired(self, agent: str) -> int:
        """refund_expired setzt_winner-Score auf 0 (RULES.md)."""
        return self.update(agent, 0)

    def snapshot(self) -> dict[str, int]:
        return dict(self._rep)


def bid_rep_snapshot(
    offline: OfflineReputation, agent: str, db_path: Optional[Path | str] = None
) -> tuple[int, Optional[str]]:
    """Bequemlichkeit für den Adapter: (rep, snapshot_hash) für einen Bid eines Agenten.

    Ohne DB (oder wenn nicht lesbar) ist der Hash None — der Contract verlangt den
    Hash nicht zwingend (rep_snapshot ist die Zahl), er wird nur mitgeführt.
    """
    h: Optional[str] = None
    path = Path(db_path) if db_path else default_kepta_db_path()
    if path is not None:
        try:
            h = snapshot_hash(path)
        except SnapshotError:
            h = None
    return offline.get(agent), h
