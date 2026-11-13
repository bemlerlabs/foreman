#!/usr/bin/env python3
"""Foreman MCP server — load Foreman as a plugin in any MCP-capable coding agent.

This is the portable, host-agnostic seam. It speaks the Model Context Protocol
(JSON-RPC 2.0 over stdio) using only the Python standard library — no third-party
dependency, no network install. Any coding agent that can register an MCP server
(Claude Desktop, Cursor, Cline, Continue, Windsurf, Zed, ...) can drive the whole
Foreman escrow workflow through these tools. Agents without MCP support use the
same CLI directly: `python3 scripts/foreman_flow.py <phase>`.

Run it from a foreman checkout (the repo root is resolved from this file's location):

    python3 plugin-pack/mcp/foreman_mcp.py

Tools exposed (each one echoes REAL CLI / contract output — nothing is synthesised):

    foreman_board   read-only bid board for a job id (no keys needed)
    foreman_status  current job card
    foreman_phase   run one workflow phase (post/bids/middle/acceptdemo/finish/...)
    foreman_wait    collect a detached (--bg) phase

The workflow dogma is unchanged: hire -> board -> exactly ONE reasoned counter-offer
-> accept only against a fail-closed verified receipt. Write phases (post, finish)
need the operator's testnet keys/env; the host's own tool-approval gate still applies.
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
FLOW = REPO / "scripts" / "foreman_flow.py"
BOARD = REPO / "scripts" / "board_cli.py"

SERVER_INFO = {"name": "foreman", "version": "0.2.0"}
SUPPORTED_PROTOCOLS = ("2024-11-05", "2025-03-26", "2025-06-18")
DEFAULT_PROTOCOL = "2024-11-05"

PHASES = ("post", "bids", "middle", "acceptdemo", "finish", "dashboard", "recipe", "all")
WAIT_PHASES = ("post", "bids", "middle", "acceptdemo", "finish", "recipe", "dashboard")

TOOLS = [
    {
        "name": "foreman_board",
        "description": (
            "Read-only bid board for a NEAR escrow job: bids (price in NEAR-cent, ETA, "
            "reputation), the single counter-offer with its reason, receipt hashes and the "
            "payout transaction. Reads escrow.foreman-team.testnet live; no keys required."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "job_id": {"type": "integer", "description": "On-chain job id, e.g. 50."}
            },
            "required": ["job_id"],
        },
    },
    {
        "name": "foreman_status",
        "description": "Current job card (the job id from the last post) via the foreman CLI.",
        "inputSchema": {"type": "object", "properties": {}},
    },
    {
        "name": "foreman_phase",
        "description": (
            "Run one Foreman workflow phase. Order: post (open job + 120s bid window) -> "
            "bids (5 agents bid; run with background=true, then foreman_wait) -> middle "
            "(exactly ONE reasoned counter-offer, 10% under the best bid) -> acceptdemo "
            "(fail-closed: accept without a receipt must panic NOT_DELIVERED) -> finish "
            "(signed receipt, accept, 90/10 payout; background=true then foreman_wait) -> "
            "recipe. Write phases need the operator's testnet keys/env."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "phase": {"type": "string", "enum": list(PHASES)},
                "background": {
                    "type": "boolean",
                    "description": "Run detached (tool-timeout safe); collect with foreman_wait.",
                    "default": False,
                },
            },
            "required": ["phase"],
        },
    },
    {
        "name": "foreman_wait",
        "description": "Block until a detached (--bg) phase reports, then return its real output.",
        "inputSchema": {
            "type": "object",
            "properties": {"phase": {"type": "string", "enum": list(WAIT_PHASES)}},
            "required": ["phase"],
        },
    },
]


def _run(argv: list[str]) -> tuple[str, bool]:
    """Run a CLI command, return (text, is_error). Never uses a shell; argv only."""
    proc = subprocess.run(argv, cwd=str(REPO), capture_output=True, text=True)
    out = (proc.stdout or "").rstrip()
    err = (proc.stderr or "").rstrip()
    text = out if out else err
    if out and err:
        text = out + "\n" + err
    return (text or "(no output)", proc.returncode != 0)


def call_tool(name: str, args: dict) -> tuple[str, bool]:
    if name == "foreman_board":
        job_id = args.get("job_id")
        if not isinstance(job_id, int) or isinstance(job_id, bool) or job_id < 0:
            return ("job_id must be a non-negative integer", True)
        return _run([sys.executable, str(BOARD), "--job", str(job_id), "--json"])
    if name == "foreman_status":
        return _run([sys.executable, str(FLOW), "status"])
    if name == "foreman_phase":
        phase = args.get("phase")
        if phase not in PHASES:
            return (f"phase must be one of {', '.join(PHASES)}", True)
        argv = [sys.executable, str(FLOW), phase]
        if args.get("background"):
            argv.append("--bg")
        return _run(argv)
    if name == "foreman_wait":
        phase = args.get("phase")
        if phase not in WAIT_PHASES:
            return (f"phase must be one of {', '.join(WAIT_PHASES)}", True)
        return _run([sys.executable, str(FLOW), "wait", phase])
    return (f"unknown tool {name!r}", True)


def result(req_id, payload: dict) -> dict:
    return {"jsonrpc": "2.0", "id": req_id, "result": payload}


def error(req_id, code: int, message: str) -> dict:
    return {"jsonrpc": "2.0", "id": req_id, "error": {"code": code, "message": message}}


def handle(msg: dict):
    """Return a response dict, or None for notifications / unknown notifications."""
    method = msg.get("method")
    req_id = msg.get("id")
    params = msg.get("params") or {}

    if method == "initialize":
        client_proto = params.get("protocolVersion")
        proto = client_proto if client_proto in SUPPORTED_PROTOCOLS else DEFAULT_PROTOCOL
        return result(req_id, {
            "protocolVersion": proto,
            "capabilities": {"tools": {}},
            "serverInfo": SERVER_INFO,
        })
    if method == "ping":
        return result(req_id, {})
    if method == "tools/list":
        return result(req_id, {"tools": TOOLS})
    if method == "tools/call":
        name = params.get("name")
        args = params.get("arguments") or {}
        text, is_error = call_tool(name, args)
        return result(req_id, {"content": [{"type": "text", "text": text}], "isError": is_error})

    # Notifications (no id) get no response. Unknown requests get a method error.
    if req_id is None:
        return None
    return error(req_id, -32601, f"method not found: {method}")


def main() -> int:
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            sys.stdout.write(json.dumps(error(None, -32700, "parse error")) + "\n")
            sys.stdout.flush()
            continue
        resp = handle(msg)
        if resp is not None:
            sys.stdout.write(json.dumps(resp) + "\n")
            sys.stdout.flush()
    return 0


if __name__ == "__main__":
    sys.exit(main())