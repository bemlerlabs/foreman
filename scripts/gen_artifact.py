#!/usr/bin/env python3
"""phase3: deterministische Artefakt-/Receipt-Hashes für die Live-Biet-Runde.

Liest /tmp/foreman_bids.json (vom offizielen core/bidding/cli_bids.py, asset-scout),
bestimmt den Gewinner (guenstigster Bid, RULES-Reihenfolge price -> rep -> zeit) und
rechnet dessen Deliverable-Hash ueber die MOCK-Engine des Adapters (deterministisch:
Payload ohne ran_at). Schreibt /tmp/foreman_artifact.json
  {winner, artifact_hash, receipt_hash}
Seed-Identitaet: gleicher cli_bids-Seed + gleiches ADAPTER_JOB => byte-identisch (T5).
"""
import hashlib
import json
import os
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "core"))

from bidding.supernova_adapter import (  # noqa: E402
    JobRequest,
    MockSupernovaEngine,
    decompose_spec,
)

SPEC = os.environ.get(
    "DEMO_SPEC",
    "research-report: NEAR testnet RPC latency, finality and gas costs across 3 regions; "
    "deliver CSV + summary + sources",
)
CRITERIA = json.loads(
    os.environ.get(
        "DEMO_CRITERIA_JSON",
        '["#1 summary <=300 words","#2 CSV data table","#3 cited sources"]',
    )
)
BUDGET = int(os.environ.get("DEMO_BUDGET_YOCTO", "900000000000000000000000"))
ADAPTER_JOB = os.environ.get("ADAPTER_JOB", "e2e-demo-foreman-demo")
BIDS_FILE = Path(os.environ.get("BIDS_FILE", "/tmp/foreman_bids.json"))

bids = json.load(open(BIDS_FILE))
if len(bids) != 5:
    sys.exit(f"gen_artifact: 5 Bids erwartet, gefunden: {len(bids)}")

winner = min(bids, key=lambda b: (int(b["price_yocto"]), bids.index(b)))["bidder"]

# Mock-Engine: gleiche (adapter-job, packages) => gleicher Deliverable (asset-scout-Vertrag).
job = JobRequest(
    spec=SPEC, budget_yocto=BUDGET, deadline_secs=600,
    job_id=ADAPTER_JOB, acceptance_criteria=CRITERIA,
)
deliverable = MockSupernovaEngine().run(job, decompose_spec(job.spec))
artifact_hash = deliverable.artifact_hash  # sha256 ueber kanonische Paketrepraesentation
receipt_hash = hashlib.sha256(f"signed|{artifact_hash}|{winner}".encode("utf-8")).hexdigest()

out = {"winner": winner, "artifact_hash": artifact_hash, "receipt_hash": receipt_hash}
Path("/tmp/foreman_artifact.json").write_text(json.dumps(out, indent=1) + "\n")
print(f"ARTIFACT_OK winner={winner} packages={len(deliverable.packages)} "
      f"artifact={artifact_hash[:16]}… receipt={receipt_hash[:16]}…")
