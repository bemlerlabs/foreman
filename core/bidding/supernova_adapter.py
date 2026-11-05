"""supernova_adapter — überführt eine Job-Anfrage in einen Supernova-Lauf und daraus
einen Bid (price_in_yocto, eta_secs) + Deliverable-Artefakt.

Vertrag (identisch für real & Mock):
    make_bid(job, agent_id) -> (Bid, Deliverable)

Engine-Wahl:
    RealSupernovaEngine  — nutzt liquid_swarm (LangGraph Dekompose→Worker→Synthese),
                           brauchbar wenn das Paket importierbar ist UND ein Provider-Key
                           gesetzt ist (OPENAI_API_KEY / NEAR_AI_API_KEY via OpenAI-kompat-Env,
                           später NEAR AI Cloud cloud-api.near.ai/v1).
    MockSupernovaEngine  — deterministischer Demo-Fallback mit identischem Vertrag
                           (hash-gesteuert, gleiche Eingabe ⇒ gleicher Bid).

Bid-Kalkulation (Demo-Disziplin, RULES.md):
    price = BASE(0.5 NEAR-Cent/Paket) × Arbeitspakete × Jitter(±10 %, je Agent deterministisch)
    eta   = Pakete × 8 s
    Hard-Cap: price ≤ DEMO_MAX_USD (aus .env) — Verletzung wirft BidCapExceeded.
    price ≤ budget wird wie im Contract erzwungen (OVER_BUDGET-Wurf).

Baseline: supernova — /Users/sanji/supernova, PyPI supernova-swarm, Apache-2.0 (Q-005).
"""
from __future__ import annotations

import hashlib
import os
import random
import re
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional, Protocol

# ---------------------------------------------------------------- Konstanten
YOCTO_PER_NEAR = 10**24
NEAR_CENT_YOCTO = YOCTO_PER_NEAR // 100            # 1 NEAR-Cent
BASE_PACKAGE_PRICE_YOCTO = NEAR_CENT_YOCTO // 2    # 0.5 NEAR-Cent je Arbeitspaket (Demo-Basis)
ETA_PER_PACKAGE_SECS = 8                           # eta = Pakete × 8 s
JITTER_LOW, JITTER_HIGH = 0.90, 1.10               # ±10 % Agent-Jitter
DEFAULT_NEAR_USD = 2.50                            # Demo-Preis, NEAR_USD_PRICE überschreibt
DEFAULT_DEMO_MAX_USD = 3.0                         # RULES.md: Budgets ≤ 3 $ Gegenwert
PACKAGES_MIN, PACKAGES_MAX = 2, 6

REPO_ROOT = Path(__file__).resolve().parents[2]


class BidCapExceeded(RuntimeError):
    """Preis würde über DEMO_MAX_USD (oder budget) gehen — Bid wird nicht abgegeben."""


class EngineError(RuntimeError):
    """Engine-Lauf fehlgeschlagen (real oder Mock)."""


# ---------------------------------------------------------------- .env (leichtgewichtig, kein Dependency)
_env_loaded = False


def _load_env() -> None:
    """Liest repo-.env in os.environ (bestehende Werte haben Vorrang). Kein Dependency."""
    global _env_loaded
    if _env_loaded:
        return
    env_file = REPO_ROOT / ".env"
    if env_file.is_file():
        for line in env_file.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, val = line.partition("=")
            key, val = key.strip(), val.split("#")[0].strip()
            if key and key not in os.environ:
                os.environ[key] = val
    _env_loaded = True


def _env(name: str, default: Optional[str] = None) -> Optional[str]:
    _load_env()
    return os.environ.get(name, default)


# ---------------------------------------------------------------- Datenverträge
@dataclass
class JobRequest:
    """Job-Anfrage des Foreman (Felder analog RULES.md §Job)."""
    spec: str
    budget_yocto: int
    deadline_secs: int
    job_id: str = "job-0"
    acceptance_criteria: list[str] = field(default_factory=list)


@dataclass
class Deliverable:
    """Artefakt eines Supernova-Laufs — Referenz für submit_work (artifact_hash)."""
    job_id: str
    engine: str                      # "supernova" | "supernova-mock"
    packages: list[str]
    summary: str
    artifact_hash: str               # sha256 über kanonische JSON-Repräsentation
    ran_at: int                      # ns

    def to_dict(self) -> dict:
        return {
            "job_id": self.job_id,
            "engine": self.engine,
            "packages": self.packages,
            "summary": self.summary,
            "ran_at": self.ran_at,
        }


@dataclass
class Bid:
    """Bid exakt nach RULES.md §Bieten: {job_id, bidder, price≤budget, eta_secs, rep_snapshot}."""
    job_id: str
    bidder: str
    price_in_yocto: int
    eta_secs: int
    rep_snapshot: int
    placed_at: int                   # ns, analog placed_at im Contract


# ---------------------------------------------------------------- Dekomposition
def decompose_spec(spec: str) -> list[str]:
    """Deterministische Zerlegung der Spec in Arbeitspakete (Proxy für Supernova-Thinker).

    real: Supernova's bootstrap/thinker zerlegt; Mock: Satz-/Komma-Zerlegung mit
    Klammer auf [PACKAGES_MIN, PACKAGES_MAX].
    """
    spec = (spec or "").strip()
    if not spec:
        raise ValueError("EMPTY_SPEC")
    parts = [p.strip(" .;") for p in re.split(r"[.;,\n]+", spec) if p.strip(" .;")]
    if len(parts) < PACKAGES_MIN:
        words = spec.split()
        chunk = max(1, len(words) // PACKAGES_MIN + 1)
        parts = [" ".join(words[i:i + chunk]) for i in range(0, len(words), chunk)] or [spec]
    n = max(PACKAGES_MIN, min(PACKAGES_MAX, len(parts)))
    if len(parts) >= n:
        return parts[:n]
    while len(parts) < n:
        parts.append(f"{parts[-1]} (Teil {len(parts) + 1})")
    return parts


# ---------------------------------------------------------------- Engines
class SwarmEngine(Protocol):
    name: str

    def run(self, job: JobRequest, packages: list[str]) -> Deliverable: ...


def _artifact_hash(payload: dict) -> str:
    import json
    canon = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(canon.encode("utf-8")).hexdigest()


class MockSupernovaEngine:
    """Deterministischer Demo-Fallback: hash-gesteuerte Paketergebnisse, identischer Vertrag.

    Gleiche (job, packages) ⇒ gleicher Deliverable ⇒ gleicher Bid — Demo-Reproduzierbarkeit
    (T5: Voll-Demo 2× in Folge).
    """
    name = "supernova-mock"

    def run(self, job: JobRequest, packages: list[str]) -> Deliverable:
        if not packages:
            raise EngineError("EMPTY_PACKAGES")
        synth_lines = []
        for i, pkg in enumerate(packages):
            digest = hashlib.sha256(f"{job.job_id}|{i}|{pkg}".encode("utf-8")).hexdigest()[:12]
            synth_lines.append(f"P{i + 1} {pkg[:60]} [{digest}]")
        summary = " | ".join(synth_lines)
        payload = {
            "job_id": job.job_id,
            "spec_digest": hashlib.sha256(job.spec.encode("utf-8")).hexdigest(),
            "packages": packages,
            "summary": summary,
        }
        return Deliverable(
            job_id=job.job_id,
            engine=self.name,
            packages=list(packages),
            summary=summary,
            artifact_hash=_artifact_hash(payload),
            ran_at=time.time_ns(),
        )


class RealSupernovaEngine:
    """Echter Lauf über liquid_swarm (Dekompose→Worker→Synthese).

    Voraussetzung: Paket importierbar (SUPERNOVA_PATH oder Pip) UND Provider-Key gesetzt.
    Provider via OpenAI-kompat-Env (OPENAI_API_KEY / OPENAI_BASE_URL), später
    NEAR AI Cloud (NEAR_AI_API_KEY + cloud-api.near.ai/v1).
    """
    name = "supernova"

    @staticmethod
    def available() -> bool:
        if not (_env("OPENAI_API_KEY") or _env("NEAR_AI_API_KEY")):
            return False
        try:
            RealSupernovaEngine._ensure_path()
            import liquid_swarm  # noqa: F401
            return True
        except Exception:
            return False

    @staticmethod
    def _ensure_path() -> None:
        import sys
        extra = _env("SUPERNOVA_PATH", "/Users/sanji/supernova")
        if extra and extra not in sys.path and Path(extra).is_dir():
            sys.path.insert(0, extra)

    def run(self, job: JobRequest, packages: list[str]) -> Deliverable:
        import asyncio

        self._ensure_path()
        try:
            from liquid_swarm.graph import build_swarm_graph  # type: ignore
            from liquid_swarm.models import TaskInput  # type: ignore
        except Exception as exc:  # Import-/Dep-Fehler → klare Kante, Aufrufer kann auf Mock fallen
            raise EngineError(f"SUPERNOVA_IMPORT_FAILED: {exc}") from exc

        if not packages:
            raise EngineError("EMPTY_PACKAGES")
        tasks = [
            TaskInput(task_id=f"{job.job_id}_p{i}", query=p)
            for i, p in enumerate(packages)
        ]
        state_input = {"tasks": tasks, "current_task": None, "results": []}
        try:
            graph = build_swarm_graph(None)  # ohne Checkpointer: straight through
            final = asyncio.run(graph.ainvoke(state_input))
        except Exception as exc:
            raise EngineError(f"SUPERNOVA_RUN_FAILED: {exc}") from exc

        results = final.get("final_results") or final.get("results") or []
        summaries = []
        for r in results:
            out = getattr(r, "output", None) or (r.get("output") if isinstance(r, dict) else None) or str(r)
            summaries.append(str(out)[:200])
        summary = " | ".join(summaries) or "no-results"
        payload = {
            "job_id": job.job_id,
            "spec_digest": hashlib.sha256(job.spec.encode("utf-8")).hexdigest(),
            "packages": packages,
            "summary": summary,
            "n_results": len(results),
        }
        return Deliverable(
            job_id=job.job_id,
            engine=self.name,
            packages=list(packages),
            summary=summary,
            artifact_hash=_artifact_hash(payload),
            ran_at=time.time_ns(),
        )


def make_engine(prefer: str = "auto") -> SwarmEngine:
    """auto: real wenn verfügbar, sonst Mock. 'real'/'mock' erzwingt."""
    if prefer == "mock":
        return MockSupernovaEngine()
    if prefer == "real":
        return RealSupernovaEngine()
    return RealSupernovaEngine() if RealSupernovaEngine.available() else MockSupernovaEngine()


# ---------------------------------------------------------------- Preis & Bid
def _agent_jitter(agent_id: str, job_id: str) -> float:
    """Deterministischer ±10 %-Jitter je (Agent, Job) — Reproduzierbarkeit schlägt Zufall."""
    rng = random.Random(f"{agent_id}:{job_id}")
    return rng.uniform(JITTER_LOW, JITTER_HIGH)


def price_yocto_for(n_packages: int, agent_id: str, job_id: str) -> int:
    base = BASE_PACKAGE_PRICE_YOCTO * max(1, n_packages)
    return int(base * _agent_jitter(agent_id, job_id))


def usd_value(price_yocto: int) -> float:
    near = price_yocto / YOCTO_PER_NEAR
    return near * float(_env("NEAR_USD_PRICE", str(DEFAULT_NEAR_USD)) or DEFAULT_NEAR_USD)


def make_bid(
    job: JobRequest,
    agent_id: str,
    rep_snapshot: int = 50,
    engine: Optional[SwarmEngine] = None,
    prefer: str = "auto",
) -> tuple[Bid, Deliverable]:
    """Job → Supernova-Lauf → (Bid, Deliverable). Harte Gates: DEMO_MAX_USD und budget."""
    if not agent_id or not agent_id.strip():
        raise ValueError("EMPTY_AGENT")
    if job.budget_yocto <= 0:
        raise ValueError("EMPTY_BUDGET")

    engine = engine or make_engine(prefer)
    packages = decompose_spec(job.spec)
    deliverable = engine.run(job, packages)

    price = price_yocto_for(len(deliverable.packages), agent_id, job.job_id)
    eta = len(deliverable.packages) * ETA_PER_PACKAGE_SECS

    cap_usd = float(_env("DEMO_MAX_USD", str(DEFAULT_DEMO_MAX_USD)) or DEFAULT_DEMO_MAX_USD)
    if usd_value(price) > cap_usd:
        raise BidCapExceeded(f"bid {usd_value(price):.4f}$ > DEMO_MAX_USD {cap_usd}$")
    if price > job.budget_yocto:
        raise BidCapExceeded(f"bid {price} yocto > budget {job.budget_yocto} yocto")

    bid = Bid(
        job_id=job.job_id,
        bidder=agent_id.strip(),
        price_in_yocto=price,
        eta_secs=eta,
        rep_snapshot=max(0, min(100, int(rep_snapshot))),
        placed_at=time.time_ns(),
    )
    return bid, deliverable
