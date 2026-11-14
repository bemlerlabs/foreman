"""Machine-checkable acceptance gate (S1).

Turns decorative acceptance criteria into a real, reproducible check: the gate reads
the job's acceptance_criteria and verifies the deliverable against every criterion that
is machine-checkable (summary word limit, CSV data table, cited sources). Criteria that
need human judgement are reported as `manual` and never auto-pass.

This is a verification layer SEPARATE from the sandbox ES256 receipt: the receipt proves
the sandbox ran; this gate proves the deliverable meets the checkable criteria. The gate
emits a sha256-hashed acceptance report that can be stored beside the receipt and shown
on the board / in the recipe.
"""
from __future__ import annotations

import csv
import hashlib
import io
import json
import re

DEFAULT_WORD_LIMIT = 300


def _words(text: str) -> int:
    return len((text or "").split())


def _check_summary(deliverable: dict, limit: int) -> dict:
    n = _words(deliverable.get("summary", ""))
    return {
        "criterion": f"summary <= {limit} words",
        "pass": 0 < n <= limit,
        "evidence": f"{n} words (limit {limit})",
    }


def _check_csv(deliverable: dict) -> dict:
    csv_text = deliverable.get("csv") or ""
    if not csv_text:
        for pkg in deliverable.get("packages", []):
            if "," in pkg and "\n" in pkg:
                csv_text = pkg
                break
    try:
        rows = [r for r in csv.reader(io.StringIO(csv_text)) if r]
    except csv.Error:
        rows = []
    ok = (
        len(rows) >= 2
        and len(rows[0]) >= 2
        and all(len(r) == len(rows[0]) for r in rows[1:])
    )
    return {
        "criterion": "CSV data table",
        "pass": ok,
        "evidence": f"{max(len(rows) - 1, 0)} data rows, {len(rows[0]) if rows else 0} columns",
    }


def _check_sources(deliverable: dict) -> dict:
    srcs = deliverable.get("sources") or []
    if isinstance(srcs, str):
        srcs = [srcs]
    urls = [s for s in srcs if re.search(r"https?://", s)]
    if not urls:
        urls = re.findall(r"https?://\S+", deliverable.get("summary", ""))
    return {
        "criterion": "cited sources",
        "pass": len(urls) >= 1,
        "evidence": f"{len(urls)} cited source(s)",
    }


def verify_acceptance(criteria: list, deliverable: dict) -> dict:
    results, manual = [], []
    for raw in criteria:
        low = str(raw).lower()
        if "summary" in low and "word" in low:
            m = re.search(r"<=\s*(\d+)", low)
            limit = int(m.group(1)) if m else DEFAULT_WORD_LIMIT
            results.append(_check_summary(deliverable, limit))
        elif "csv" in low:
            results.append(_check_csv(deliverable))
        elif "source" in low or "cited" in low:
            results.append(_check_sources(deliverable))
        else:
            manual.append(str(raw))
    passed = sum(1 for r in results if r["pass"])
    report = {
        "results": results,
        "machine_total": len(results),
        "machine_passed": passed,
        "manual": manual,
        "pass": len(results) > 0 and passed == len(results),
    }
    report["report_hash"] = acceptance_report_hash(report)
    return report


def acceptance_report_hash(report: dict) -> str:
    payload = {k: v for k, v in report.items() if k != "report_hash"}
    canon = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canon.encode()).hexdigest()


def build_research_deliverable(latencies_ms, regions=None, sources=None) -> dict:
    """Assemble a criteria-compliant deliverable from REAL measurements.

    summary <= 300 words, a parseable CSV data table, and cited sources. Used to prove
    the gate passes on genuine content (and fails on tampered content).
    """
    latencies = list(latencies_ms)
    if regions is None:
        regions = [f"region-{i + 1}" for i in range(len(latencies))]
    if sources is None:
        sources = [
            "https://test.rpc.fastnear.com",
            "https://rpc.testnet.near.org",
            "https://docs.near.org/",
        ]
    rows = ["region,latency_ms"] + [
        f"{r},{v}" for r, v in zip(regions, latencies)
    ]
    lo, hi = min(latencies), max(latencies)
    mean = sum(latencies) / len(latencies)
    summary = (
        f"Measured NEAR testnet RPC round-trip latency across {len(latencies)} probes: "
        f"min {lo:.1f} ms, max {hi:.1f} ms, mean {mean:.1f} ms. "
        f"The accompanying CSV data table lists one row per region with its latency in "
        f"milliseconds; the spread ({hi - lo:.1f} ms) shows why a single-region estimate "
        f"is unreliable for finality-sensitive work. Sources are the public testnet RPC "
        f"endpoints and the NEAR documentation, cited below. Full per-region figures are "
        f"in the CSV; this summary stays within the 300-word acceptance limit."
    )
    return {
        "summary": summary,
        "csv": "\n".join(rows) + "\n",
        "sources": list(sources),
        "packages": ["latency-stats"],
    }