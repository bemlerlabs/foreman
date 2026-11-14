#!/usr/bin/env python3
"""scripts/verify_acceptance.py — machine-checkable acceptance gate (S1).

Checks a deliverable against the job's acceptance_criteria. Criteria that are
machine-checkable (summary word limit, CSV data table, cited sources) are verified;
the rest are reported as `manual` and never auto-pass. Emits a sha256-hashed report.

  python3 scripts/verify_acceptance.py --deliverable d.json [--job 50] [--out report.json]

Criteria source: --job (read on-chain) > --criteria (JSON) > deliverable.acceptance_criteria.
Exit: 0 all machine checks pass · 1 a machine check failed · 2 input/RPC error.
"""
import argparse
import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO))
sys.path.insert(0, str(REPO / "scripts"))

from core.acceptance.verify import verify_acceptance  # noqa: E402

DEFAULT_CRITERIA = ["#1 summary <=300 words", "#2 CSV data table", "#3 cited sources"]


def main(argv=None):
    ap = argparse.ArgumentParser(description="foreman acceptance gate")
    ap.add_argument("--deliverable", required=True, help="path to deliverable JSON")
    ap.add_argument("--job", type=int, help="read acceptance_criteria on-chain for this job")
    ap.add_argument("--criteria", help="JSON array of criteria (overrides deliverable)")
    ap.add_argument("--out", help="write the hashed report here")
    args = ap.parse_args(argv)

    try:
        deliverable = json.loads(Path(args.deliverable).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        print(f"verify_acceptance: ERROR reading deliverable: {exc}", file=sys.stderr)
        return 2

    if args.job is not None:
        import board_cli
        try:
            job = board_cli.view("get_job", {"job_id": args.job})
            criteria = job.get("acceptance_criteria") or DEFAULT_CRITERIA
        except Exception as exc:
            print(f"verify_acceptance: ERROR reading job {args.job}: {exc}", file=sys.stderr)
            return 2
    elif args.criteria:
        criteria = json.loads(args.criteria)
    else:
        criteria = deliverable.get("acceptance_criteria") or DEFAULT_CRITERIA

    report = verify_acceptance(criteria, deliverable)
    report["job_id"] = args.job

    print(f"Acceptance gate — job {args.job if args.job is not None else '(local)'}")
    for r in report["results"]:
        print(f"  [{'PASS' if r['pass'] else 'FAIL'}] {r['criterion']}: {r['evidence']}")
    for m in report["manual"]:
        print(f"  [MANUAL] {m}")
    print(f"  machine: {report['machine_passed']}/{report['machine_total']} · overall: "
          f"{'PASS' if report['pass'] else 'FAIL'}")
    print(f"  report_hash: {report['report_hash']}")

    out = Path(args.out) if args.out else (
        REPO / "artifacts" / (f"acceptance_job{args.job}.json" if args.job is not None
                              else "acceptance_report.json"))
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(f"  report: {out}")
    return 0 if report["pass"] else 1


if __name__ == "__main__":
    sys.exit(main())