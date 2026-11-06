"""Tests core/receipts/ephemora_adapter — Ephemora-Receipt-Kette (phase5).

Runner: /Users/sanji/near-hackathon/.venv-receipts/bin/python -m pytest core/receipts
(Apache-Paket ephemora_cell + wasmtime + cryptography nötig; sonst Skip.)
"""
import hashlib
import json
import subprocess
import sys
from pathlib import Path

import pytest

ec = pytest.importorskip("ephemora_cell", reason="Apache-Paket ephemora_cell + wasmtime erforderlich")

REPO_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO_ROOT))

from core.receipts import ephemora_adapter as ad  # noqa: E402
from core.receipts.ephemora_adapter import (  # noqa: E402
    Caps, ReceiptVerifyError, egress_log_hash, load_or_create_cell_key,
    receipt_hash, run_and_attest, verify_or_raise, verify_receipt,
)

FIXTURES = Path("/Users/sanji/ephemora-cell/tests/fixtures")
GO_WORKER_SRC = REPO_ROOT / "core/receipts/worker/latency_stats.go"


@pytest.fixture(scope="session")
def worker_wasm(tmp_path_factory) -> Path:
    """Demo-Worker: Go-Quelle via package-eigenem builder; Fallback: Apache-Fixture."""
    out = tmp_path_factory.mktemp("wasm") / "latency_stats.wasm"
    if GO_WORKER_SRC.is_file():
        try:
            from ephemora_cell import builder
            recipe = builder.detect_recipe(GO_WORKER_SRC, out)
            res = builder.build(recipe)
            if getattr(res, "ok", False) and out.is_file():
                return out
        except Exception:
            pass
    fx = FIXTURES / "wat_run.wasm"
    if fx.is_file():
        return fx
    pytest.skip("kein Worker-WASM (Go-Build fehlgeschlagen, Fixture fehlt)")


@pytest.fixture(scope="session")
def cell_key():
    return load_or_create_cell_key()


def _inputs():
    return {"latencies_ms": [12.4, 301.2, 88.0, 55.1, 42.7]}


# ---------------------------------------------------------------- Roundtrip
def test_sign_verify_roundtrip(worker_wasm):
    receipt = run_and_attest(str(worker_wasm), _inputs())
    assert receipt["alg"] == "ES256"
    assert len(receipt["cell_signature"]) >= 64 and all(c in "0123456789abcdef" for c in receipt["cell_signature"])
    assert verify_receipt(receipt) is True


def test_receipt_fields_complete(worker_wasm):
    r = run_and_attest(str(worker_wasm), _inputs())
    for k in ("record", "egress_log_hash", "artifact_hash", "wasm_sha256", "public_key_pem"):
        assert k in r and r[k]
    assert r["record"]["status"] == "SUCCESS"
    assert r["record"]["exit_code"] == 0
    assert len(r["artifact_hash"]) == 64


def test_run_and_attest_failclosed_on_tamper(worker_wasm):
    r = run_and_attest(str(worker_wasm), _inputs())
    r["record"]["exit_code"] = 99
    assert verify_receipt(r) is False
    with pytest.raises(ReceiptVerifyError):
        verify_or_raise(r)


def test_tampered_hash_field_fails(worker_wasm):
    r = run_and_attest(str(worker_wasm), _inputs())
    r["record"]["fuel_consumed"] = 999_999_999
    assert verify_receipt(r) is False


# ---------------------------------------------------------------- Fail-closed-Ränder
def test_missing_signature_failclosed(worker_wasm):
    r = run_and_attest(str(worker_wasm), _inputs())
    del r["cell_signature"]
    assert verify_receipt(r) is False


def test_nonhex_signature_failclosed(worker_wasm):
    r = run_and_attest(str(worker_wasm), _inputs())
    r["cell_signature"] = "zz-not-hex"
    assert verify_receipt(r) is False


def test_wrong_pubkey_failclosed(worker_wasm):
    r = run_and_attest(str(worker_wasm), _inputs())
    other = load_or_create_cell_key()  # gleicher Key ok — falsch heißt: anderer PEM-Text erzwingen
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import ec
    foreign = ec.generate_private_key(ec.SECP256R1()).public_key().public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo).decode()
    assert foreign != r["public_key_pem"]
    assert verify_receipt(r, foreign) is False


# ---------------------------------------------------------------- CI-Replay
def test_offchain_replay_roundtrip(tmp_path, worker_wasm):
    """CI-Beweismuster: receipt.json schreiben -> neu laden -> verify + identischer receipt_hash."""
    r = run_and_attest(str(worker_wasm), _inputs())
    p = tmp_path / "receipt.json"
    p.write_text(json.dumps(r, sort_keys=True), encoding="utf-8")
    r2 = json.loads(p.read_text(encoding="utf-8"))
    assert verify_receipt(r2) is True
    assert receipt_hash(r) == receipt_hash(r2)


def test_receipt_hash_is_stable_string(worker_wasm):
    r = run_and_attest(str(worker_wasm), _inputs())
    h1, h2 = receipt_hash(r), receipt_hash(json.loads(json.dumps(r)))
    assert h1 == h2 and len(h1) == 64


# ---------------------------------------------------------------- Egress
def test_egress_log_hash_semantics():
    empty = egress_log_hash([])
    assert empty == hashlib.sha256(b"[]").hexdigest()
    with_entry = egress_log_hash([{"host": "api.example.com", "allowed": True}])
    assert with_entry != empty and len(with_entry) == 64
    # Determinismus über Dict-Reihenfolge
    a = egress_log_hash([{"b": 1, "a": 2}])
    b = egress_log_hash([{"a": 2, "b": 1}])
    assert a == b


# ---------------------------------------------------------------- Caps
def test_caps_config():
    cfg = Caps().to_config()
    assert cfg.max_fuel == 50_000_000 and cfg.max_memory_mb == 128 and cfg.timeout_seconds == 20


# ---------------------------------------------------------------- CLI
def test_cli_writes_receipt_and_exits_zero(tmp_path, worker_wasm):
    out = tmp_path / "receipt.json"
    proc = subprocess.run(
        [sys.executable, str(REPO_ROOT / "core/receipts/ephemora_adapter.py"),
         "--wasm", str(worker_wasm), "--input", json.dumps(_inputs()), "--out", str(out)],
        capture_output=True, text=True, cwd=str(REPO_ROOT))
    assert proc.returncode == 0, proc.stderr
    assert out.is_file()
    r = json.loads(out.read_text(encoding="utf-8"))
    assert verify_receipt(r) is True
    assert "artifact_hash" in proc.stdout


def test_cli_missing_wasm_exitcode(tmp_path):
    proc = subprocess.run(
        [sys.executable, str(REPO_ROOT / "core/receipts/ephemora_adapter.py"),
         "--wasm", "/nonexistent/x.wasm", "--input", "{}", "--out", str(tmp_path / "r.json")],
        capture_output=True, text=True)
    assert proc.returncode == 2


def test_keys_dir_gitignored():
    gi = (REPO_ROOT / ".gitignore").read_text(encoding="utf-8").splitlines()
    assert "keys/" in gi
