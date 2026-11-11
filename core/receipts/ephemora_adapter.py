#!/usr/bin/env python3
"""core/receipts/ephemora_adapter.py — Ephemora receipt adapter (T4, phase5).

Thin layer over the Apache-2.0 package `ephemora_cell` (baseline github.com/MichaelS1011/
ephemora-cell). NO ephe import — ephe served only as the reference path
(docs/EPHE_CELL_MAP.md §1/§5, BUSL hygiene). Signatures verbatim per EPHE_CELL_MAP §2:

  run_isolated(wasm_path, config, args, stdin_data, …) -> dict   [process_executor.py:136]
  ExecutionReport(...).sign(signer, alg="ES256") -> dict           [execution_report.py:151]
  ExecutionReport.verify(signed_record, verifier) -> bool          [execution_report.py:187]

Data flow (docs/EPHE_CELL_MAP.md §6): worker WASM -> run_isolated -> ExecutionReport
(signed with our own ES256 cell key, .env RECEIPT_KEY_PATH) -> receipt.json with
egress_log_hash + artifact_hash. verify is fail-closed; the adapter raises on False.

CLI:  python3 core/receipts/ephemora_adapter.py --wasm worker.wasm --input task.json --out receipt.json
      Exit code != 0 on verify failure (CI evidence chain: sha256(record) -> attach_receipt).
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Optional

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_KEY_PATH = "keys/cell_key.pem"
DEFAULT_PUB_PATH = "keys/cell_key_pub.pem"

# ----------------------------------------------------------------- .env
_env_loaded = False


def _load_env() -> None:
    global _env_loaded
    if _env_loaded:
        return
    env_file = REPO_ROOT / ".env"
    if env_file.is_file():
        for line in env_file.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, val = line.partition("=")
            key, val = key.strip(), val.split("#")[0].strip()
            if key and key not in os.environ:
                os.environ[key] = val
    _env_loaded = True


def _env(name: str, default: Optional[str] = None) -> Optional[str]:
    _load_env()
    return os.environ.get(name, default) or default


# --------------------------------------------------- package import (Apache)
try:
    from ephemora_cell import WASIConfig, run_isolated  # type: ignore
    from ephemora_cell.execution_report import ExecutionReport  # type: ignore
    _EPHEMORA_IMPORT_ERROR: Optional[Exception] = None
except Exception as exc:  # pragma: no cover - environment without the package
    WASIConfig = None  # type: ignore
    run_isolated = None  # type: ignore
    ExecutionReport = None  # type: ignore
    _EPHEMORA_IMPORT_ERROR = exc


class AdapterError(RuntimeError):
    pass


class ReceiptVerifyError(AdapterError):
    """Fail-closed: ExecutionReport.verify returned False or broke."""


# ------------------------------------------------------- cell key (ES256)
def _crypto():
    try:
        from cryptography.hazmat.primitives import hashes, serialization
        from cryptography.hazmat.primitives.asymmetric import ec
    except ImportError as exc:  # pragma: no cover
        raise AdapterError("cryptography missing: pip install cryptography") from exc
    return hashes, serialization, ec


def cell_key_paths() -> tuple:
    priv = Path(_env("RECEIPT_KEY_PATH", DEFAULT_KEY_PATH))
    if not priv.is_absolute():
        priv = REPO_ROOT / priv
    pub = priv.with_name(priv.stem + "_pub.pem")
    return priv, pub


def load_or_create_cell_key() -> Any:
    """Creates the ES256 cell key locally (SECP256R1); the private PEM NEVER lands in the repo (keys/ ignored)."""
    hashes, serialization, ec = _crypto()
    priv_path, pub_path = cell_key_paths()
    if priv_path.is_file():
        return serialization.load_pem_private_key(priv_path.read_bytes(), password=None)
    priv_path.parent.mkdir(parents=True, exist_ok=True)
    key = ec.generate_private_key(ec.SECP256R1())
    os.chmod(priv_path.parent, 0o700)
    priv_path.write_bytes(key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption()))
    os.chmod(priv_path, 0o600)
    pub_path.write_bytes(key.public_key().public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo))
    return key


def cell_public_pem() -> str:
    _, serialization, _ = _crypto()
    _, pub_path = cell_key_paths()
    if pub_path.is_file():
        return pub_path.read_text(encoding="utf-8")
    key = load_or_create_cell_key()
    return key.public_key().public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo).decode("utf-8")


# ------------------------------------------------------- RULES.md caps
@dataclass
class Caps:
    max_memory_mb: int = 128
    max_fuel: int = 50_000_000
    timeout_seconds: int = 20
    disk_quota_bytes: int = 8 * 1024 * 1024
    io_budget_bytes: int = 4 * 1024 * 1024
    io_cpu_seconds: float = 10.0

    def to_config(self, work_dir: Optional[str] = None) -> Any:
        allow = (f"{work_dir}::/work",) if work_dir else ()
        return WASIConfig(max_memory_mb=self.max_memory_mb, max_fuel=self.max_fuel,
                          timeout_seconds=self.timeout_seconds, allow_dirs=allow,
                          disk_quota_bytes=self.disk_quota_bytes,
                          io_budget_bytes=self.io_budget_bytes,
                          io_cpu_seconds=self.io_cpu_seconds)


# ------------------------------------------------------- core: run + attest
def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def egress_log_hash(entries: list) -> str:
    """Adapter-owned hash over egress audit entries (EPHE_CELL_MAP §2f/§6).

    Entries are hashed via their canonical JSON representation, sorted; an empty
    list = clean egress => sha256("[]") — deliberately a real hash, not None.
    """
    return sha256_hex(json.dumps(entries, sort_keys=True, separators=(",", ":"),
                                 ensure_ascii=True).encode("utf-8"))


def run_and_attest(wasm_path: str, inputs: Any, caps: Optional[Caps] = None,
                   egress_entries: Optional[list] = None,
                   artifact_bytes: Optional[bytes] = None) -> dict:
    """Runs the worker isolated and returns the signed receipt (EPHE_CELL_MAP §6).

    Thin layer: a) run_isolated->ExecutionReport, b) egress_log_hash/artifact_hash,
    c) ES256 signature with the local cell key, d) fail-closed verify before returning.
    """
    if run_isolated is None:
        raise AdapterError(f"ephemora_cell not importable: {_EPHEMORA_IMPORT_ERROR}")
    caps = caps or Caps()
    res = run_isolated(str(wasm_path), caps.to_config(), stdin_data=json.dumps(inputs))
    status = getattr(res.get("status"), "name", str(res.get("status", "ERROR")))

    artifact = artifact_bytes if artifact_bytes is not None else str(res.get("stdout", "")).encode("utf-8")
    report = ExecutionReport(
        status=status.split(".")[-1],
        exit_code=int(res.get("exit_code", -1)),
        elapsed_ms=float(res.get("elapsed_ms", 0.0)),
        fuel_consumed=res.get("fuel_consumed"),
        fuel_budget=caps.max_fuel,
        memory_mb=float(caps.max_memory_mb),
        stdout_bytes=len(str(res.get("stdout", "")).encode("utf-8")),
        stderr_bytes=len(str(res.get("stderr", "")).encode("utf-8")),
        warnings=list(res.get("warnings", []) or []),
        sandbox_dir=str(res.get("sandbox_dir", "")),
        module_path=str(wasm_path),
    )
    key = load_or_create_cell_key()
    signed = report.sign(lambda b: key.sign(b, _ecdsa_sig()), alg="ES256")

    receipt = {
        "alg": signed.get("alg", "ES256"),
        "cell_signature": signed.get("signature"),
        "record": report.to_dict(),
        "egress_log_hash": egress_log_hash(egress_entries or []),
        "artifact_hash": sha256_hex(artifact),
        "wasm_sha256": sha256_hex(Path(wasm_path).read_bytes()),
        "public_key_pem": cell_public_pem(),
        "stdout": res.get("stdout", ""),
        "stderr": res.get("stderr", ""),
    }
    if not verify_receipt(receipt):
        raise ReceiptVerifyError("RECEIPT_VERIFY_FAILED — signature does not verify (fail-closed)")
    return receipt


def _ecdsa_sig():
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.asymmetric import ec
    return ec.ECDSA(hashes.SHA256())


def receipt_hash(receipt: dict) -> str:
    """sha256 over the fully signed record (JCS canonical form) — the field for
    attach_receipt(receipt_hash); identically reproducible from receipt.json (CI replay)."""
    try:
        from ephemora_cell.execution_report import canonical_bytes  # type: ignore
        payload = {k: v for k, v in receipt["record"].items()}
        payload["alg"] = receipt.get("alg", "ES256")
        payload["signature"] = receipt.get("cell_signature")
        return sha256_hex(canonical_bytes(payload))
    except Exception:
        return sha256_hex(json.dumps(
            {**receipt["record"], "alg": receipt.get("alg"), "signature": receipt.get("cell_signature")},
            sort_keys=True, separators=(",", ":")).encode("utf-8"))


# ------------------------------------------------------- verify (fail-closed)
def verify_receipt(receipt: dict, public_key_pem: Optional[str] = None) -> bool:
    """ExecutionReport.verify with our own verifier; any deviation => False (never raises outward)."""
    try:
        hashes, serialization, _ = _crypto()
        pub_pem = (public_key_pem or receipt.get("public_key_pem") or "").encode("utf-8")
        pub = serialization.load_pem_public_key(pub_pem)
        from cryptography.exceptions import InvalidSignature

        def verifier(challenge: bytes, signature: bytes) -> bool:
            try:
                pub.verify(signature, challenge, _ecdsa_sig())
                return True
            except (InvalidSignature, ValueError):
                return False

        record = dict(receipt.get("record", {}))
        record["alg"] = receipt.get("alg", "ES256")
        record["signature"] = receipt.get("cell_signature")
        return bool(ExecutionReport.verify(record, verifier))
    except Exception:
        return False


def verify_or_raise(receipt: dict, public_key_pem: Optional[str] = None) -> None:
    if not verify_receipt(receipt, public_key_pem):
        raise ReceiptVerifyError("RECEIPT_VERIFY_FAILED — receipt invalid (fail-closed)")


# ------------------------------------------------------------------- CLI
def main(argv: Optional[list] = None) -> int:
    ap = argparse.ArgumentParser(description="Ephemora receipt adapter (foreman)")
    ap.add_argument("--wasm", required=True, help="path to the worker .wasm")
    ap.add_argument("--input", required=True, help="JSON file or raw JSON (worker stdin)")
    ap.add_argument("--out", required=True, help="destination path for receipt.json")
    ap.add_argument("--pubkey", default=None, help="optional: write the public key here")
    args = ap.parse_args(argv)

    if not Path(args.wasm).is_file():
        print(f"ephemora_adapter: ERROR: WASM not found: {args.wasm}", file=sys.stderr)
        return 2
    p = Path(args.input)
    inputs = json.loads(p.read_text(encoding="utf-8") if p.is_file() else args.input)

    try:
        receipt = run_and_attest(args.wasm, inputs)
    except AdapterError as exc:
        print(f"ephemora_adapter: ERROR: {exc}", file=sys.stderr)
        return 1
    except Exception as exc:  # noqa: BLE001 — CLI edge
        print(f"ephemora_adapter: ERROR: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 1

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(receipt, indent=2, ensure_ascii=True) + "\n", encoding="utf-8")
    if args.pubkey:
        Path(args.pubkey).write_text(receipt["public_key_pem"], encoding="utf-8")

    record_hash = receipt_hash(receipt)
    print(f"receipt written: {out}")
    print(f"artifact_hash:   {receipt['artifact_hash']}")
    print(f"egress_log_hash: {receipt['egress_log_hash']}")
    print(f"record_sha256 (attach_receipt): {record_hash}")
    print(f"public_key: {receipt['public_key_pem'].splitlines()[0]} … ({len(receipt['public_key_pem'])} B PEM)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
