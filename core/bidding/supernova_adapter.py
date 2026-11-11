"""supernova_adapter — turns a job request into a Supernova run and from it
a bid (price_in_yocto, eta_secs) + deliverable artifact.

Contract (identical for real & mock):
    make_bid(job, agent_id) -> (Bid, Deliverable)

Engine selection:
    RealSupernovaEngine  — uses liquid_swarm (LangGraph decompose→worker→synthesis),
                           usable when the package is importable AND a provider key
                           is set (OPENAI_API_KEY / NEAR_AI_API_KEY via OpenAI-compatible
                           env, later NEAR AI Cloud cloud-api.near.ai/v1).
    MockSupernovaEngine  — deterministic demo fallback with the identical contract
                           (hash-driven, same input ⇒ same bid).

Bid calculation (demo discipline, RULES.md):
    price = BASE(0.5 NEAR-cent/package) × work packages × jitter(±10 %, deterministic per agent)
    eta   = packages × 8 s
    Hard cap: price ≤ DEMO_MAX_USD (from .env) — violation raises BidCapExceeded.
    price ≤ budget is enforced as in the contract (OVER_BUDGET raise).

Baseline: supernova — PyPI supernova-swarm, Apache-2.0 (Q-005); local checkout via SUPERNOVA_PATH.
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

# ---------------------------------------------------------------- constants
YOCTO_PER_NEAR = 10**24
NEAR_CENT_YOCTO = YOCTO_PER_NEAR // 100            # 1 NEAR-cent
BASE_PACKAGE_PRICE_YOCTO = NEAR_CENT_YOCTO // 2    # 0.5 NEAR-cent per work package (demo base)
ETA_PER_PACKAGE_SECS = 8                           # eta = packages × 8 s
JITTER_LOW, JITTER_HIGH = 0.90, 1.10               # ±10 % per-agent jitter
DEFAULT_NEAR_USD = 2.50                            # demo price, NEAR_USD_PRICE overrides
DEFAULT_DEMO_MAX_USD = 3.0                         # RULES.md: budgets ≤ $3 equivalent
PACKAGES_MIN, PACKAGES_MAX = 2, 6

REPO_ROOT = Path(__file__).resolve().parents[2]


class BidCapExceeded(RuntimeError):
    """Price would exceed DEMO_MAX_USD (or budget) — bid is not placed."""


class EngineError(RuntimeError):
    """Engine run failed (real or mock)."""


# ---------------------------------------------------------------- .env (lightweight, no dependency)
_env_loaded = False


def _load_env() -> None:
    """Reads repo .env into os.environ (existing values win). No dependency."""
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


# ---------------------------------------------------------------- data contracts
@dataclass
class JobRequest:
    """Foreman job request (fields per RULES.md §Job)."""
    spec: str
    budget_yocto: int
    deadline_secs: int
    job_id: str = "job-0"
    acceptance_criteria: list[str] = field(default_factory=list)


@dataclass
class Deliverable:
    """Artifact of a Supernova run — reference for submit_work (artifact_hash)."""
    job_id: str
    engine: str                      # "supernova" | "supernova-mock"
    packages: list[str]
    summary: str
    artifact_hash: str               # sha256 over the canonical JSON representation
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
    """Bid exactly per RULES.md §Bidding: {job_id, bidder, price≤budget, eta_secs, rep_snapshot}."""
    job_id: str
    bidder: str
    price_in_yocto: int
    eta_secs: int
    rep_snapshot: int
    placed_at: int                   # ns, mirrors placed_at in the contract


# ---------------------------------------------------------------- decomposition
def decompose_spec(spec: str) -> list[str]:
    """Deterministic split of the spec into work packages (proxy for the Supernova thinker).

    real: Supernova's bootstrap/thinker decomposes; mock: sentence/comma split clamped
    to [PACKAGES_MIN, PACKAGES_MAX].
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
        parts.append(f"{parts[-1]} (part {len(parts) + 1})")
    return parts


# ---------------------------------------------------------------- engines
class SwarmEngine(Protocol):
    name: str

    def run(self, job: JobRequest, packages: list[str]) -> Deliverable: ...


def _artifact_hash(payload: dict) -> str:
    import json
    canon = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(canon.encode("utf-8")).hexdigest()


class MockSupernovaEngine:
    """Deterministic demo fallback: hash-driven package results, identical contract.

    Same (job, packages) ⇒ same deliverable ⇒ same bid — demo reproducibility
    (T5: full demo twice in a row).
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
    """Real run via liquid_swarm (decompose→worker→synthesis).

    Prerequisite: package importable (SUPERNOVA_PATH or pip) AND a provider key set.
    Provider via OpenAI-compatible env (OPENAI_API_KEY / OPENAI_BASE_URL), later
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
        extra = _env("SUPERNOVA_PATH")
        if extra and extra not in sys.path and Path(extra).is_dir():
            sys.path.insert(0, extra)

    def run(self, job: JobRequest, packages: list[str]) -> Deliverable:
        import asyncio

        self._ensure_path()
        try:
            from liquid_swarm.graph import build_swarm_graph  # type: ignore
            from liquid_swarm.models import TaskInput  # type: ignore
        except Exception as exc:  # import/dep error → clear edge, caller can fall back to mock
            raise EngineError(f"SUPERNOVA_IMPORT_FAILED: {exc}") from exc

        if not packages:
            raise EngineError("EMPTY_PACKAGES")
        tasks = [
            TaskInput(task_id=f"{job.job_id}_p{i}", query=p)
            for i, p in enumerate(packages)
        ]
        state_input = {"tasks": tasks, "current_task": None, "results": []}
        try:
            graph = build_swarm_graph(None)  # no checkpointer: straight through
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
    """auto: real when available, else mock. 'real'/'mock' forces."""
    if prefer == "mock":
        return MockSupernovaEngine()
    if prefer == "real":
        return RealSupernovaEngine()
    return RealSupernovaEngine() if RealSupernovaEngine.available() else MockSupernovaEngine()


# ---------------------------------------------------------------- price & bid
def _agent_jitter(agent_id: str, job_id: str) -> float:
    """Deterministic ±10 % jitter per (agent, job) — reproducibility beats randomness."""
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
    """Job → Supernova run → (Bid, Deliverable). Hard gates: DEMO_MAX_USD and budget."""
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
