#!/usr/bin/env python3
"""Foreman recipe — the reusable artefact the user keeps after a settled job.

Writes recipe.json + recipe.md from REAL on-chain state (board_cli JSON + sidecar). The two
files are the deliverable: plain, host-agnostic, and importable into whatever the user's agent
reads, which is why nothing here talks to one host's private API.

Usage: python3 scripts/make_recipe.py <job_id>
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
OUT_DIR = REPO / "artifacts" / "recipes"


def board(job: int) -> dict:
    import subprocess
    out = subprocess.run([sys.executable, str(REPO / "scripts/board_cli.py"), "--job", str(job), "--json"],
                         capture_output=True, text=True, cwd=str(REPO))
    if out.returncode != 0:
        raise SystemExit(f"board_cli failed: {out.stderr[-300:]}")
    return json.loads(out.stdout)


def build(job: int) -> dict:
    d = board(job)
    bids = d["bids"]
    best = min(bids, key=lambda b: float(b["price_near_cent"])) if bids else None
    co = d["counter_offer"]
    rec = d["receipt"]
    res = d["result"]
    recipe = {
        "kind": "foreman.recipe/v1",
        "job_id": job,
        "contract": d["contract"],
        "spec": d["job"].get("spec"),
        "acceptance_criteria": d["job"].get("acceptance_criteria") or [
            f"#{i+1} {c}" for i, c in enumerate(d["job"].get("acceptance_criteria") or [])
        ],
        "budget_near_cent": d["job"].get("budget_near_cent"),
        "state": d["job"].get("state"),
        "bids": [
            {
                "bidder": b["bidder"],
                "price_near_cent": b["price_near_cent"],
                "eta_secs": b["eta_secs"],
                "reputation": b["rep_snapshot"],
                "winner": b["is_winner"],
            }
            for b in bids
        ],
        "best_bid": {
            "bidder": best["bidder"],
            "price_near_cent": best["price_near_cent"],
        } if best else None,
        "counter_offer": {
            "price_near_cent": co["price_near_cent"],
            "bidder": co["bidder"],
            "reason": co.get("reason") or "see docs/EVIDENCE_LOG.md (reason stored on-chain)",
        } if co else None,
        "receipt": {
            "receipt_hash": rec.get("receipt_hash"),
            "artifact_hash": rec.get("artifact_hash"),
            "payout_tx": rec.get("payout_tx"),
            "explorer": rec.get("explorer"),
        },
        "result": {
            "winner": res.get("winner"),
            "payout_near_cent": res.get("payout_near_cent"),
            "rep_before": res.get("rep_before"),
            "rep_now": res.get("rep_now"),
            "foreman_fee_percent": res.get("foreman_fee_percent"),
        },
        "board_url": d["board_url"],
    }
    return recipe


def write(recipe: dict) -> tuple[Path, Path]:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    j = OUT_DIR / f"recipe_job{recipe['job_id']}.json"
    j.write_text(json.dumps(recipe, indent=2), encoding="utf-8")
    bids = "\n".join(
        f"| {b['bidder']} | {b['price_near_cent']} ¢ | {b['eta_secs']} s | {b['reputation']} | {'yes' if b['winner'] else ''} |"
        for b in recipe["bids"]
    )
    co = recipe["counter_offer"] or {}
    rec = recipe["receipt"]
    res = recipe["result"]
    md = f"""# Foreman recipe — job #{recipe['job_id']}

**Spec.** {recipe['spec']}
**Budget.** {recipe['budget_near_cent']} NEAR-cent · **Contract.** `{recipe['contract']}` · **State.** {recipe['state']}

## Acceptance criteria
""" + "\n".join(f"- {c}" for c in recipe["acceptance_criteria"]) + f"""

## Bid wall
| Bidder | Price | ETA | Reputation | Winner |
|---|---|---|---|---|
{bids}

## The single counter-offer
- **Price:** {co.get('price_near_cent')} NEAR-cent ({co.get('bidder')})
- **Reason:** {co.get('reason')}

## Delivery proof
- **receipt_hash:** `{rec.get('receipt_hash')}`
- **artifact_hash:** `{rec.get('artifact_hash')}`
- **payout tx:** `{rec.get('payout_tx')}`

## Result
- **Winner:** {res.get('winner')}
- **Payout:** {res.get('payout_near_cent')} NEAR-cent (foreman fee {res.get('foreman_fee_percent')}%)
- **Reputation:** {res.get('rep_before')} → {res.get('rep_now')}
- **Live board:** {recipe['board_url']}
"""
    m = OUT_DIR / f"recipe_job{recipe['job_id']}.md"
    m.write_text(md, encoding="utf-8")
    return j, m


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    job = int(sys.argv[1])
    recipe = build(job)
    j, m = write(recipe)
    print(f"RECIPE_OK job={job} json={j} md={m}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
