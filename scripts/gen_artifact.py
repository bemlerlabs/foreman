#!/usr/bin/env python3
"""phase3: deterministic artifact/receipt hashes for the live bidding round.

Reads .state/bids.json (from the official core/bidding/cli_bids.py),
picks the winner (cheapest bid, RULES order price -> rep -> time) and computes
its deliverable hash through the adapter's MOCK engine (deterministic: payload
without ran_at). Writes .state/artifact.json
  {winner, artifact_hash, receipt_hash}
Seed identity: same cli_bids seed + same ADAPTER_JOB => byte-identical (T5).
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
STATE_DIR = Path(os.environ.get("FOREMAN_STATE_DIR", str(REPO_ROOT / ".state")))
STATE_DIR.mkdir(parents=True, exist_ok=True)
BIDS_FILE = Path(os.environ.get("BIDS_FILE", str(STATE_DIR / "bids.json")))

bids = json.load(open(BIDS_FILE))
if len(bids) != 5:
    sys.exit(f"gen_artifact: expected 5 bids, found: {len(bids)}")

winner = min(bids, key=lambda b: (int(b["price_yocto"]), bids.index(b)))["bidder"]

# Mock engine: same (adapter job, packages) => same deliverable.
job = JobRequest(
    spec=SPEC, budget_yocto=BUDGET, deadline_secs=600,
    job_id=ADAPTER_JOB, acceptance_criteria=CRITERIA,
)
deliverable = MockSupernovaEngine().run(job, decompose_spec(job.spec))
artifact_hash = deliverable.artifact_hash  # sha256 over the canonical package representation

# ---- Receipt: real when the tools are named ---------------------------------------------
# The mock below is a hash formula, and that is enough to drive the chain. A T5 gate that claims
# "sandbox execution -> signed report" needs the real thing: a WASM worker under a fuel budget, an
# ES256 signature, verified fail-closed. So EMPHORA_WASM names the built worker, EPHEMORA_PY an
# interpreter with wasmtime and EPHEMORA_CELL_PATH the ephemora_cell package. When one is missing
# the mock stays and the line says receipt_source=mock - nothing is swapped in silently.
wasm = os.environ.get("EMPHORA_WASM", "")
interp = os.environ.get("EPHEMORA_PY", "")
cell_path = os.environ.get("EPHEMORA_CELL_PATH", "")
receipt_hash = None
receipt_source = "mock"
real_receipt = None
if wasm and interp and Path(wasm).is_file() and Path(interp).is_file():
    import subprocess

    # The worker is a statistics worker (latency-stats): it receives a series of values. The
    # honest series for this job is the five bid prices in NEAR-cent, so the execution computes
    # over real data from this run rather than over invented numbers.
    series = sorted(int(round(int(b["price_yocto"]) / 10**22)) for b in bids)
    payload = json.dumps({"values": series, "spec": SPEC})
    receipt_out = STATE_DIR / "receipt.json"
    receipt_out.unlink(missing_ok=True)
    env = dict(os.environ)
    env["PYTHONPATH"] = cell_path or env.get("PYTHONPATH", "")
    proc = subprocess.run(
        [interp, "core/receipts/ephemora_adapter.py", "--wasm", wasm,
         "--input", payload, "--out", str(receipt_out)],
        capture_output=True, text=True, env=env, cwd=str(REPO_ROOT),
    )
    if proc.returncode == 0 and receipt_out.is_file():
        real_receipt = json.loads(receipt_out.read_text(encoding="utf-8"))
        # Verify is a duty, not a nicety: an unverified report is not a proof.
        verify = subprocess.run(
            [interp, "-c",
             "import json,sys;sys.path.insert(0,'core/receipts');"
             "from ephemora_adapter import verify_receipt;"
             "r=json.load(open(sys.argv[1]));"
             "sys.exit(0 if verify_receipt(r) else 1)", str(receipt_out)],
            capture_output=True, text=True, env=env, cwd=str(REPO_ROOT),
        )
        if verify.returncode == 0:
            # Hash in the SAME environment as the verifier (ephemora_cell importable) so the
            # anchor is the JCS canonical form. In-process hashing here would silently fall back
            # to json.dumps, which formats floats differently (128.0 vs 128) and yields a hash an
            # independent JCS replay cannot reproduce.
            hashed = subprocess.run(
                [interp, "-c",
                 "import json,sys;sys.path.insert(0,'core/receipts');"
                 "from ephemora_adapter import receipt_hash;"
                 "print(receipt_hash(json.load(open(sys.argv[1]))))", str(receipt_out)],
                capture_output=True, text=True, env=env, cwd=str(REPO_ROOT),
            )
            if hashed.returncode == 0 and hashed.stdout.strip():
                receipt_hash = hashed.stdout.strip()
                artifact_hash = real_receipt.get("artifact_hash") or artifact_hash
                receipt_source = "wasm+es256"
            else:
                print("RECEIPT_WARN: receipt hash failed - the mock stays")
        else:
            print("RECEIPT_WARN: real report built but verification failed - the mock stays")
    else:
        print(f"RECEIPT_WARN: adapter call failed rc={proc.returncode} "
              f"{(proc.stderr or '').strip()[:160]} - the mock stays")

if receipt_hash is None:
    receipt_hash = hashlib.sha256(f"signed|{artifact_hash}|{winner}".encode("utf-8")).hexdigest()

out = {"winner": winner, "artifact_hash": artifact_hash, "receipt_hash": receipt_hash,
       "receipt_source": receipt_source, "packages": len(deliverable.packages)}
(STATE_DIR / "artifact.json").write_text(json.dumps(out, indent=1) + "\n")
print(f"ARTIFACT_OK winner={winner} packages={len(deliverable.packages)} "
      f"artifact={artifact_hash[:16]}… receipt={receipt_hash[:16]}… "
      f"receipt_source={receipt_source}")
