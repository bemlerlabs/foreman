# EPHE_CELL_MAP — ephemora-cell in ephe: location, public API, adapter specification
> Research: judge-backsolver, 2026-11-06, read-only. Sources: local ephe checkout (BUSL-1.1, licensor Bemler Labs, private origin `ephe-dev`; **no BUSL code quoted** — logic description only) and the Apache-2.0 package `ephemora_cell` (local state `~/ephemora-cell`, origin `github.com/MichaelS1011/ephemora-cell`, version with egg-info = pip-installed). Quotes from Apache sources are freely adoptable.

## 1) Where ephemora-cell lives in the ephe code
**Nothing is vendored.** `ephemora-cell` is a standalone Apache-2.0 Python package; ephe uses it as an external dependency:

| ephe integration (BUSL, logic described only) | Role |
|---|---|
| `core/cpython_cell.py` (~L201) | Lazy import `from ephemora_cell import WASIConfig, run_isolated` in the synchronous cell runner: writes `cell_boot.py` + `program.py` into a session directory, builds `WASIConfig(max_memory_mb, max_fuel, timeout_seconds, allow_dirs=("<stdlib>::/", "<work>::/work"), allow_env=…, io_budget_bytes, io_cpu_seconds, disk_quota_bytes)` and calls `run_isolated(python_wasm, config, args=["/work/cell_boot.py"])` |
| `core/cell_boot.py` + guest directory (`python.wasm` + stdlib root from manifest) | ephe's own CPython-in-WASM guest + boot report (`result.json`: stdout/stderr bytes, log ranges) — **ephe-specific, BUSL, do not copy as a template** |
| `core/ephemeral_cell.py`, `core/cell_policy.py`, `core/cpython_guest.py`, `core/tools/sandbox_tools.py`, `core/mcp_catalog.py`, `ephe_cli.py` | Policy/CLI surroundings around the same two imports |

Most important finding for us: **the signed receipt is NOT created in ephe.** grep across ephe-core finds no `ExecutionReport`/`sign` usage — ephe uses only the sandbox + boot report. The signing capability lies entirely in the Apache package (`ExecutionReport.sign/verify`). The Lead confirmation "ephemora-cell is already implemented in ephe" = the sandbox integration is proven; the receipt path is our own adapter work on the Apache package.

## 2) The public API (Apache-2.0, signatures word-exact)
Package root `~/ephemora-cell/ephemora_cell/`; top-level exports per `__init__.py`: `run_wasm, WASISandbox, WASIConfig, ExecutionResult, ExecutionStatus, ExecutionReport, run_isolated, EnginePool, config_fingerprint, get_profile, ComponentSandbox, is_component_binary, wasm_inspector, measure_overhead`.

**a) Execution (process_executor.py:136):**
```python
def run_isolated(
    wasm_path: str,
    config: WASIConfig,
    args: list[str] | None = None,
    stdin_data: str | None = None,
    max_wasm_bytes: int = DEFAULT_MAX_WASM_BYTES,
    abi: str = "auto",
) -> dict:
```
→ dict with all `ExecutionResult` fields + `baseline_ms`. Failures come as `status`, not as exceptions.

**b) Limits (wasi_runtime.py):** `WASIConfig` (L136) among others `max_memory_mb, max_fuel, timeout_seconds, allow_dirs, allow_env, sandbox_base_dir, max_threads, memory64, max_gc_heap_mb, disk_quota_bytes, io_budget_bytes, io_cpu_seconds`; `ExecutionResult` (L216) `status: ExecutionStatus, exit_code, stdout, stderr, elapsed_ms, fuel_consumed, sandbox_dir, effective_preopens, io_bytes_written, io_budget_exceeded`.

**c) Create execution report (execution_report.py:46):** dataclass
```python
class ExecutionReport:
    status: str
    exit_code: int
    elapsed_ms: float
    fuel_consumed: int | None = None
    fuel_budget: int | None = None
    memory_mb: float = 0.0
    stdout_bytes: int = 0
    stderr_bytes: int = 0
    warnings: list[str] = field(default_factory=list)
    sandbox_dir: str = ""
    module_path: str = ""
    security_baseline: dict[str, Any] = field(default_factory=_default_security_baseline)
```
Methods: `to_dict()`, `to_json(indent=2)`, `to_jcs()` (RFC 8785 canonical, determinism guarantee in the docstring). **No `from_result` constructor** → the report is assembled by the caller from the `run_isolated` dict (see adapter).

**d) Receipt/signature (execution_report.py:151):**
```python
def sign(self, signer: Callable[[bytes], bytes], *, alg: str = "ES256") -> dict:
```
SEP-2787 style: signature input = RFC-8785 canonicalization of all fields except `signature` (incl. `alg`); return = report payload + `alg` + `signature` (hex). Matching module functions: `jcs_canonicalize(value)` (L356), `canonical_bytes(record)` (L366).

**e) Verify (execution_report.py:187):**
```python
@staticmethod
def verify(signed_record: dict, verifier: Callable[[bytes, bytes], bool]) -> bool:
```
Fail-closed: missing/non-hex signature, broken payload or exception in the verifier ⇒ `False`.

**f) Egress (egress_sidecar.py):** `EgressPolicy, EgressRequest, EgressAuditEntry, EgressResult, validate_request(policy, request) -> EgressAuditEntry, mediate(policy, raw) -> EgressResult, run_sidecar_cycle(...)` — audit entries are the raw data for our `egress_log_hash`.

**g) CLI:** `python -m ephemora_cell run <module.wasm> [--profile …] [--memory-mb N] [--fuel N] [--timeout S] [--allow-dirs …] [--allow-env K=V …] [--stdin FILE] [--memory64] [--isolated] [--abi auto|preview1|component] [--json] [args…]`, plus `inspect`, `benchmark`, `build` (builder.py: `detect_recipe`/`build` compile sources to WASM per recipe).
**h) MCP:** exists (`ephemora_cell_mcp/`), but only stdio transport and the current tool set = `echo` — **unusable for T4, ignore MCP.**

## 3) Required inputs
| Input | Source |
|---|---|
| `wasm_path` (+ args/stdin) | Worker artifact; compile via `builder.detect_recipe`+`build` or a foreign toolchain. **No Python interpreter included in the guest** — ephe brings its own CPython WASM guest (BUSL area); our worker code must exist as .wasm |
| `WASIConfig` | The Foreman adapter sets the RULES.md caps: `max_fuel`, `max_memory_mb`, `timeout_seconds`, `disk_quota_bytes`, `io_budget_bytes/io_cpu_seconds`; `allow_dirs` only `::/work` |
| `signer: bytes→bytes` | **Caller-side** — e.g. Ed25519 (`cryptography`), the key lives with the swarm (adapter-owned cell key, public key registered in the contract). The package manages no keys |
| Report fields | from the `run_isolated` dict (`fuel_consumed`, `elapsed_ms`, `exit_code`, `status`…), `memory_mb` from the config/result view, `module_path`, `security_baseline` (default ok) |
| Egress | `EgressPolicy` (allowlist) + audit entries → our hash |

## 4) External caller without ephe-internal context — yes, proven
- The package declares itself a framework-agnostic "WASM execution primitive"; shipped sample: `integration/ephemora_cell_agent_executor.py` (`EphemoraCellExecutor(max_fuel, timeout, max_memory_mb).execute(wasm_path)` — exactly our call form).
- ephe itself uses exactly the public import path (`WASIConfig` + `run_isolated`) and nothing else → our dependency is identical, **no ephe runtime context needed**. `pip install` of the Apache package suffices; for T4 ephe need neither run nor be linked nor be mentioned in the public repo (BUSL hygiene).

## 5) Risk list BUSL vs. Apache (repo/video/demo post)
| Showable | Not showable |
|---|---|
| Any API in this document (Apache-2.0), incl. signature quotes and CLI flags | ephe source code, file contents, `cell_boot.py`/guest build, internal paths of the private `ephe-dev` origin, screenshots with ephe UI/branding |
| Logic description: "an agent host integrates the Apache package via `run_isolated`" (without BUSL code) | Claim that the receipt comes "from ephe" — it comes from the Apache package (correctness = judge trust, Haseeb test) |
| Our adapter + contract + sign/verify run with our own cell key | ephe repo URL or private origin URLs in the public repo/X post |
| Apache license text/badge `ephemora-cell` | Selling ephe's BUSL-1.1 text as the project's license |
Video: terminal scenes only with our scripts; `pip show ephemora-cell` as proof of the Apache dependency is ideal.

## 6) Adapter specification T4 — `core/receipts/ephemora_receipt.py` (foreman-side)
Real existing package functions in parentheses. Data flow ephe-host work step → `attach_receipt(job_id, receipt)`:

```python
def execute_and_attest(worker_wasm: str, task_ctx: dict, cell_key: Ed25519PrivateKey) -> dict:
    cfg = WASIConfig(max_fuel=…, max_memory_mb=…, timeout_seconds=…,
                     allow_dirs=(f"{work}::/work",), disk_quota_bytes=…,
                     io_budget_bytes=…, io_cpu_seconds=…)                      # RULES.md caps
    res = run_isolated(worker_wasm, cfg, args=[…], stdin_data=json.dumps(task_ctx))
    report = ExecutionReport(status=str(res["status"]).split(".")[-1],
                             exit_code=res["exit_code"], elapsed_ms=res["elapsed_ms"],
                             fuel_consumed=res.get("fuel_consumed"),
                             fuel_budget=cfg.max_fuel, memory_mb=…,
                             stdout_bytes=…, stderr_bytes=…,
                             warnings=…, module_path=worker_wasm)
    signed = report.sign(lambda b: cell_key.sign(b), alg="EdDSA")               # → {"alg","signature",…}
    return {
        "fuel_used":       report.fuel_consumed,
        "mem_peak":        report.memory_mb,
        "egress_log_hash": sha256_of_egress_audit(policy_entries),              # ADAPTER-OWNED (see gaps)
        "artifact_hash":   sha256(artifact_bytes),                              # ADAPTER-OWNED
        "cell_signature":  signed["signature"],
        "alg": signed["alg"], "record": report.to_dict(),                        # full payload for verifiability
    }

def verify_receipt(receipt: dict, cell_pubkey) -> bool:                          # before submit_work + in the CI proof
    return ExecutionReport.verify({**receipt["record"], "alg": receipt["alg"],
                                   "signature": receipt["cell_signature"]},
                                  lambda c, s: cell_pubkey.verify(s, c))         # fail-closed
```
**Thin-layer gap (deliberate, small):** (1) no `ExecutionReport.from_result` → merging the `run_isolated` dict→report is adapter code (~20 lines, unit-testable); (2) the package does not produce `egress_log_hash` and `artifact_hash` → adapter hashes over `EgressAuditEntry` rows or artifact bytes; (3) cell-key creation/registration (deposit the public key with the contract) is foreman-side; (4) on-chain cannot natively verify JCS+Ed25519 → the contract stores `record`+`sha256(record)`, verification runs off-chain via `ExecutionReport.verify` (Foreman before `submit_work` + EVIDENCE-log replay). This is RULES.md-compliant ("no submit_work without a receipt") and honestly documentable.