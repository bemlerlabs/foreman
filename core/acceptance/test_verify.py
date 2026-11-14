"""Tests for the machine-checkable acceptance gate (S1).

Run from the repo root:  python3 -m pytest core/acceptance -q
"""
import json

from core.acceptance.verify import (
    acceptance_report_hash,
    build_research_deliverable,
    verify_acceptance,
)

CRITERIA = ["#1 summary <=300 words", "#2 CSV data table", "#3 cited sources"]


def _good():
    return build_research_deliverable([12.4, 301.2, 88.0, 55.1, 42.7])


def test_good_deliverable_passes_all_three():
    rep = verify_acceptance(CRITERIA, _good())
    assert rep["machine_total"] == 3
    assert rep["machine_passed"] == 3
    assert rep["pass"] is True
    assert rep["manual"] == []


def test_summary_over_limit_fails():
    d = _good()
    d["summary"] = "word " * 301
    rep = verify_acceptance(CRITERIA, d)
    by = {r["criterion"]: r for r in rep["results"]}
    assert by["summary <= 300 words"]["pass"] is False
    assert rep["pass"] is False


def test_missing_csv_fails():
    d = _good()
    d["csv"] = ""
    d["packages"] = []
    rep = verify_acceptance(CRITERIA, d)
    by = {r["criterion"]: r for r in rep["results"]}
    assert by["CSV data table"]["pass"] is False
    assert rep["pass"] is False


def test_ragged_csv_fails():
    d = _good()
    d["csv"] = "a,b\n1,2,3\n"
    rep = verify_acceptance(CRITERIA, d)
    by = {r["criterion"]: r for r in rep["results"]}
    assert by["CSV data table"]["pass"] is False


def test_no_sources_fails():
    d = _good()
    d["sources"] = []
    d["summary"] = "no links here"
    rep = verify_acceptance(CRITERIA, d)
    by = {r["criterion"]: r for r in rep["results"]}
    assert by["cited sources"]["pass"] is False
    assert rep["pass"] is False


def test_unknown_criterion_is_manual_not_auto_pass():
    rep = verify_acceptance(CRITERIA + ["#4 tone is professional"], _good())
    assert rep["machine_total"] == 3
    assert rep["manual"] == ["#4 tone is professional"]
    # manual criteria do not auto-pass; overall pass reflects machine checks only
    assert rep["pass"] is True


def test_word_limit_parsed_from_criterion():
    d = _good()
    d["summary"] = "word " * 50
    rep = verify_acceptance(["summary <= 10 words"], d)
    assert rep["results"][0]["pass"] is False
    rep2 = verify_acceptance(["summary <= 100 words"], d)
    assert rep2["results"][0]["pass"] is True


def test_report_hash_stable_and_sensitive():
    d = _good()
    r1 = verify_acceptance(CRITERIA, d)
    r2 = verify_acceptance(CRITERIA, d)
    assert r1["report_hash"] == r2["report_hash"]
    assert acceptance_report_hash(r1) == r1["report_hash"]
    d["summary"] = d["summary"] + " extra"
    r3 = verify_acceptance(CRITERIA, d)
    assert r3["report_hash"] != r1["report_hash"]


def test_built_deliverable_summary_within_limit_and_csv_real():
    d = _good()
    assert len(d["summary"].split()) <= 300
    assert d["csv"].startswith("region,")
    assert "https://" in json.dumps(d["sources"])