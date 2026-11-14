#!/usr/bin/env python3
"""scripts/board_cli.py — board status of the bid board as JSON (phase6, ephe plugin ingredient).

Read-only against escrow.foreman-team.testnet (JSON-RPC call_function, fastnear → near.org),
plus the optional sidecar file web/board/sidecar/job<N>.json (payout_tx, counter_reason).
Prices in NEAR-Cent (contract yocto ÷ 10^21, team convention). Python 3.9 compatible, stdlib only.

  python3 scripts/board_cli.py --job 6 [--json] [--pretty] [--board-url URL]
Exit: 0 OK · 2 contract/job not readable.
"""
import argparse
import base64
import json
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
CONTRACT = "escrow.foreman-team.testnet"
RPCS = ["https://test.rpc.fastnear.com", "https://rpc.testnet.near.org"]
EXPLORER = "https://testnet.nearblocks.io/transactions/"
CENT = 10 ** 21


def cents(yocto):
    return f"{int(yocto) / CENT:.2f}"


def view(method, args):
    payload = {"jsonrpc": "2.0", "id": "cli", "method": "query", "params": {
        "request_type": "call_function", "account_id": CONTRACT, "method_name": method,
        "finality": "optimistic", "args_base64": base64.b64encode(json.dumps(args).encode()).decode()}}
    body = json.dumps(payload)
    for rpc in RPCS:
        proc = subprocess.run(["curl", "-s", "-m", "12", "-X", "POST", rpc,
                               "-H", "Content-Type: application/json", "-d", body],
                              capture_output=True, text=True)
        try:
            out = json.loads(proc.stdout)
            res = out["result"]["result"]
            raw = bytes(res) if isinstance(res, list) else base64.b64decode(res)
            return json.loads(raw.decode())
        except Exception:
            continue
    raise RuntimeError("no RPC reachable")


def sort_bids(bids):
    return sorted(bids or [], key=lambda b: (int(b["price"]), -int(b.get("rep_snapshot", 0)), int(b.get("placed_at", 0))))


def main(argv=None):
    ap = argparse.ArgumentParser(description="foreman board --json")
    ap.add_argument("--job", type=int, required=True)
    ap.add_argument("--json", action="store_true", dest="as_json")
    ap.add_argument("--pretty", action="store_true")
    ap.add_argument("--board-url", default="http://127.0.0.1:8899/?job={job}")
    args = ap.parse_args(argv)

    try:
        job = view("get_job", {"job_id": args.job})
    except Exception as exc:
        print(f"board_cli: ERROR: {exc}", file=sys.stderr)
        return 2
    sidecar = {}
    sc = REPO_ROOT / "web/board/sidecar" / f"job{args.job}.json"
    if sc.is_file():
        try:
            sidecar = json.loads(sc.read_text(encoding="utf-8"))
        except Exception:
            sidecar = {}
    acceptance = {}
    ac = REPO_ROOT / "artifacts" / f"acceptance_job{args.job}.json"
    if ac.is_file():
        try:
            acceptance = json.loads(ac.read_text(encoding="utf-8"))
        except Exception:
            acceptance = {}

    winner = job.get("winner")
    rep_now = None
    if winner:
        try:
            rep_now = view("get_rep", {"agent": winner})
        except Exception:
            rep_now = None
    co = job.get("counter_offer")
    bids = sort_bids(job.get("bids"))
    win_bid = next((b for b in bids if b["bidder"] == winner), None) if winner else None

    out = {
        "job": {"id": job["id"], "spec": job["spec"], "budget_near_cent": cents(job["budget"]),
                "state": job["state"], "created_by": job["created_by"],
                "acceptance_criteria": job.get("acceptance_criteria", []),
                "deadline_nanos": job.get("deadline_nanos")},
        "bids": [{"rank": i + 1, "bidder": b["bidder"], "price_near_cent": cents(b["price"]),
                  "eta_secs": b["eta_secs"], "rep_snapshot": b["rep_snapshot"],
                  "is_winner": winner == b["bidder"]} for i, b in enumerate(bids)],
        "counter_offer": (None if not co else {
            "bidder": co["bidder"], "price_near_cent": cents(co["price"]), "eta_secs": co["eta_secs"],
            "reason": co.get("reason") or sidecar.get("counter_reason")
                      or "Reasoning off-chain (foreman log); enforced on-chain: exactly one counter"}),
        "receipt": {"receipt_hash": job.get("receipt_hash"), "artifact_hash": job.get("artifact_hash"),
                    "payout_tx": sidecar.get("payout_tx"),
                    "explorer": (EXPLORER + sidecar["payout_tx"]) if sidecar.get("payout_tx") else None},
        "acceptance": (acceptance or None),
        "market_offer": sidecar.get("market_offer"),
        "result": {"winner": winner,
                   "payout_near_cent": cents(int(job["budget"]) - int(job["budget"]) * 10 // 100),
                   "rep_before": win_bid["rep_snapshot"] if win_bid else None,
                   "rep_now": rep_now, "foreman_fee_percent": 10},
        "board_url": args.board_url.format(job=args.job),
        "contract": CONTRACT,
    }
    if args.as_json or args.pretty:
        print(json.dumps(out, indent=2 if args.pretty else None, ensure_ascii=True))
    else:
        print(f"Job {out['job']['id']} [{out['job']['state']}] · budget {out['job']['budget_near_cent']} NEAR-cent")
        for b in out["bids"]:
            print(f"  {b['rank']}. {b['bidder']:34} {b['price_near_cent']:>7} ¢  eta {b['eta_secs']}s  rep {b['rep_snapshot']}" + ("  <- winner" if b["is_winner"] else ""))
        if out["counter_offer"]:
            print(f"Counter-offer: {out['counter_offer']['price_near_cent']} NEAR-cent ({out['counter_offer']['bidder']})")
        if out["market_offer"]:
            m = out["market_offer"]
            print(f"Market offer (third-party, off-chain): {m.get('provider')} "
                  f"${m.get('price_usd')}/{m.get('unit')} · live={m.get('live')}")
        print(f"Receipt: {out['receipt']['receipt_hash'] or '—'}")
        if out["acceptance"]:
            a = out["acceptance"]
            print(f"Acceptance gate: {a.get('machine_passed')}/{a.get('machine_total')} machine-checked "
                  f"({'PASS' if a.get('pass') else 'FAIL'})")
        print(f"Board:   {out['board_url']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
