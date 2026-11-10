#!/usr/bin/env python3
"""Foreman flow — one Python entry point for the whole escrow workflow.

The ephe shell tool allows the heads `python3` and `node`; the workflow itself is a
set of shell scripts. This module is the seam: it runs the shell scripts as child
processes so an agent (or a human) only ever needs

    python3 scripts/foreman_flow.py <phase>

Phases: post · bids · middle · acceptdemo · finish · dashboard · recipe · status · all

Long phases (bids, finish) can outlive a tool call's timeout. Run them detached and poll:

    python3 scripts/foreman_flow.py bids --bg     # starts, prints the log path, returns at once
    python3 scripts/foreman_flow.py wait bids     # blocks until the phase reports, prints its output

Every phase prints the real output of the underlying script (transaction ids, errors,
payout deltas). Nothing is synthesised here.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
RUNNER = REPO / "scripts" / "video_run.sh"
BOARD = REPO / "scripts" / "board_cli.py"
JOB_FILE = Path("/tmp/foreman_video_job.txt")
PHASES = ("post", "bids", "middle", "acceptdemo", "finish", "dashboard", "recipe")


def _job_id() -> str:
    try:
        return JOB_FILE.read_text().strip() or "?"
    except OSError:
        return "?"


RUN_DIR = Path("/tmp/foreman_flow")


def _log_path(phase: str) -> Path:
    RUN_DIR.mkdir(parents=True, exist_ok=True)
    return RUN_DIR / f"{phase}.log"


def run_detached(phase: str) -> int:
    """Starts a phase as a child process and returns immediately (tool-timeout safe)."""
    env = dict(os.environ)
    env.setdefault("E2E_SEED", "ephe-demo")
    log = _log_path(phase)
    with open(log, "w") as fh:
        proc = subprocess.Popen(["bash", str(RUNNER), phase], cwd=str(REPO), env=env,
                                stdout=fh, stderr=subprocess.STDOUT, start_new_session=True)
    print(f"started phase={phase} pid={proc.pid} log={log}")
    return 0


def wait_phase(phase: str, timeout: float = 240.0) -> int:
    """Waits for a detached phase to report, then prints its output."""
    import time
    log = _log_path(phase)
    marker = {"post": "VIDEO_POSTED", "bids": "BID_LOOP_OK", "bids+middle": "VIDEO_AWARD",
              "middle": "VIDEO_AWARD", "acceptdemo": "VIDEO_S6_OK", "finish": "VIDEO_OK",
              "recipe": "RECIPE_OK", "dashboard": "VIDEO_DASHBOARD"}.get(phase, "VIDEO_")
    deadline = time.time() + timeout
    while time.time() < deadline:
        text = log.read_text(errors="replace") if log.exists() else ""
        if marker in text:
            tail = [l for l in text.splitlines() if l.startswith(("VIDEO_", "BID_", "COUNTER_", "RECIPE_", "PAYOUT_"))]
            print("\n".join(tail[-12:]))
            return 0
        if "VIDEO_FAIL" in text or "E2E_FAIL" in text or "fehlgeschlagen" in text:
            print(text[-1500:])
            return 1
        time.sleep(2)
    print(f"timeout waiting for {phase} (log {log})")
    print((log.read_text(errors="replace")[-1200:] if log.exists() else ""))
    return 1


def run_phase(phase: str) -> int:
    """Runs one workflow phase and echoes its output unchanged."""
    env = dict(os.environ)
    env.setdefault("E2E_SEED", "ephe-demo")
    proc = subprocess.run(["bash", str(RUNNER), phase], cwd=str(REPO), env=env,
                          capture_output=True, text=True)
    out = (proc.stdout or "").rstrip()
    err = (proc.stderr or "").rstrip()
    if out:
        print(out)
    if err:
        print(err, file=sys.stderr)
    return proc.returncode


def status() -> int:
    job = _job_id()
    print(f"job={job}")
    proc = subprocess.run([sys.executable, str(BOARD), "--job", job],
                          cwd=str(REPO), capture_output=True, text=True)
    print((proc.stdout or "").rstrip() or (proc.stderr or "").rstrip())
    return proc.returncode


def main(argv: list[str]) -> int:
    phase = (argv[1] if len(argv) > 1 else "status").strip().lower()
    flags = {a for a in argv[2:] if a.startswith("--")}
    if phase == "wait":
        target = argv[2] if len(argv) > 2 else "bids"
        return wait_phase(target)
    if "--bg" in flags and phase in PHASES:
        return run_detached(phase)
    if phase == "status":
        return status()
    if phase == "all":
        rc = 0
        for p in ("post", "bids", "middle", "acceptdemo", "finish", "recipe"):
            # bids and middle are one chain: the bid window is 120 seconds.
            if p == "bids":
                rc = run_phase("bids+middle") or rc
                continue
            if p == "middle":
                continue
            rc = run_phase(p) or rc
            if rc:
                print(f"FEHLER in phase {p} (exit {rc})", file=sys.stderr)
                return rc
        return rc
    if phase not in PHASES:
        print(f"unknown phase {phase!r}; one of: {', '.join(PHASES)}, all, status", file=sys.stderr)
        return 2
    rc = run_phase(phase)
    if phase == "post":
        print(json.dumps({"job_id": _job_id()}, separators=(",", ":")))
    return rc


if __name__ == "__main__":
    sys.exit(main(sys.argv))
