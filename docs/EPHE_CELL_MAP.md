# EPHE_CELL_MAP — ephemora-cell in ephe: Lage, öffentliche API, Adapter-Spezifikation
> Recherche: judge-backsolver, 2026-11-06, read-only. Quellen: lokaler ephe-Checkout (BUSL-1.1, Licensor Bemler Labs, privater Origin `ephe-dev`; **kein BUSL-Code zitiert** — nur Logik-Beschreibung) und das Apache-2.0-Package `ephemora_cell` (lokaler Stand `~/ephemora-cell`, Origin `github.com/MichaelS1011/ephemora-cell`, Version mit egg-info = pip-installiert). Zitate aus Apache-Quellen sind werkzeugfrei übernehmbar.

## 1) Wo lebt ephemora-cell im ephe-Code
**Nichts ist vendored.** `ephemora-cell` ist ein eigenständiges Apache-2.0-Python-Package; ephe nutzt es als externe Abhängigkeit:

| ephe-Integration (BUSL, nur Logik beschrieben) | Rolle |
|---|---|
| `core/cpython_cell.py` (~L201) | Lazy-Import `from ephemora_cell import WASIConfig, run_isolated` im synchronen Cell-Runner: schreibt `cell_boot.py` + `program.py` in ein Session-Verzeichnis, baut `WASIConfig(max_memory_mb, max_fuel, timeout_seconds, allow_dirs=("<stdlib>::/", "<work>::/work"), allow_env=…, io_budget_bytes, io_cpu_seconds, disk_quota_bytes)` und ruft `run_isolated(python_wasm, config, args=["/work/cell_boot.py"])` |
| `core/cell_boot.py` + Guest-Verzeichnis (`python.wasm` + Stdlib-Root aus Manifest) | ephe-eigener CPython-in-WASM-Guest + Boot-Report (`result.json`: stdout/stderr-Bytes, Log-Ranges) — **ephe-spezifisch, BUSL, nicht als Vorlage kopieren** |
| `core/ephemeral_cell.py`, `core/cell_policy.py`, `core/cpython_guest.py`, `core/tools/sandbox_tools.py`, `core/mcp_catalog.py`, `ephe_cli.py` | Policy-/CLI-Drumherum um dieselben zwei Importe |

Wichtigste Erkenntnis für uns: **Der signed Receipt entsteht NICHT in ephe.** grep über ephe-core findet keinerlei `ExecutionReport`-/`sign`-Nutzung — ephe nutzt nur Sandbox + Boot-Report. Die Signatur-Fähigkeit liegt vollständig im Apache-Package (`ExecutionReport.sign/verify`). Die Lead-Bestätigung „ephemora-cell ist in ephe bereits implementiert" = die Sandbox-Integration ist bewiesen; der Quittungs-Pfad ist unsere eigene Adapter-Arbeit auf dem Apache-Package.

## 2) Die öffentliche API (Apache-2.0, Signaturen wortgenau)
Package-Root `~/ephemora-cell/ephemora_cell/`; Top-Level-Exporte laut `__init__.py`: `run_wasm, WASISandbox, WASIConfig, ExecutionResult, ExecutionStatus, ExecutionReport, run_isolated, EnginePool, config_fingerprint, get_profile, ComponentSandbox, is_component_binary, wasm_inspector, measure_overhead`.

**a) Ausführung (process_executor.py:136):**
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
→ dict mit allen `ExecutionResult`-Feldern + `baseline_ms`. Failures kommen als `status`, nicht als Exceptions.

**b) Limits (wasi_runtime.py):** `WASIConfig` (L136) u. a. `max_memory_mb, max_fuel, timeout_seconds, allow_dirs, allow_env, sandbox_base_dir, max_threads, memory64, max_gc_heap_mb, disk_quota_bytes, io_budget_bytes, io_cpu_seconds`; `ExecutionResult` (L216) `status: ExecutionStatus, exit_code, stdout, stderr, elapsed_ms, fuel_consumed, sandbox_dir, effective_preopens, io_bytes_written, io_budget_exceeded`.

**c) Execution-Report erzeugen (execution_report.py:46):** Dataclass
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
Methoden: `to_dict()`, `to_json(indent=2)`, `to_jcs()` (RFC 8785 kanonisch, Determinismus-Garantie im Docstring). **Kein `from_result`-Konstruktor** → Report wird vom Aufrufer aus dem `run_isolated`-dict zusammengesetzt (siehe Adapter).

**d) Receipt/Signatur (execution_report.py:151):**
```python
def sign(self, signer: Callable[[bytes], bytes], *, alg: str = "ES256") -> dict:
```
SEP-2787-Stil: Signatur-Eingabe = RFC-8785-Kanonisierung aller Felder außer `signature` (inkl. `alg`); Rückgabe = Report-Payload + `alg` + `signature` (hex). Passende Modul-Funktionen: `jcs_canonicalize(value)` (L356), `canonical_bytes(record)` (L366).

**e) Verify (execution_report.py:187):**
```python
@staticmethod
def verify(signed_record: dict, verifier: Callable[[bytes, bytes], bool]) -> bool:
```
Fail-closed: fehlende/nicht-hex-Signatur, kaputtes Payload oder Exception im Verifier ⇒ `False`.

**f) Egress (egress_sidecar.py):** `EgressPolicy, EgressRequest, EgressAuditEntry, EgressResult, validate_request(policy, request) -> EgressAuditEntry, mediate(policy, raw) -> EgressResult, run_sidecar_cycle(...)` — Audit-Entries sind die Rohdaten für unseren `egress_log_hash`.

**g) CLI:** `python -m ephemora_cell run <module.wasm> [--profile …] [--memory-mb N] [--fuel N] [--timeout S] [--allow-dirs …] [--allow-env K=V …] [--stdin FILE] [--memory64] [--isolated] [--abi auto|preview1|component] [--json] [args…]`, außerdem `inspect`, `benchmark`, `build` (builder.py: `detect_recipe`/`build` kompilieren Quellen per Recipe nach WASM).
**h) MCP:** existiert (`ephemora_cell_mcp/`), aber nur stdio-Transport und derzeitiges Tool-Set = `echo` — **für T4 unbrauchbar, ignoriere MCP.**

## 3) Benötigte Inputs
| Input | Quelle |
|---|---|
| `wasm_path` (+ args/stdin) | Worker-Artefakt; kompilieren via `builder.detect_recipe`+`build` oder Fremd-Toolchain. **Kein Python-Interpreter im Guest enthalten** — ephe bringt seinen CPython-WASM-Guest selbst mit (BUSL-Bereich); unser Worker-Code muss als .wasm vorliegen |
| `WASIConfig` | Foreman-Adapter setzt RULES.md-Caps: `max_fuel`, `max_memory_mb`, `timeout_seconds`, `disk_quota_bytes`, `io_budget_bytes/io_cpu_seconds`; `allow_dirs` nur `::/work` |
| `signer: bytes→bytes` | **Caller-seitig** — z. B. Ed25519 (`cryptography`), Key liegt beim Schwarm (adapter-eigener Cell-Key, public key im Contract registriert). Package verwaltet keine Keys |
| Report-Felder | aus `run_isolated`-dict (`fuel_consumed`, `elapsed_ms`, `exit_code`, `status`…), `memory_mb` aus config/Ergebnis-Sicht, `module_path`, `security_baseline` (Default ok) |
| Egress | `EgressPolicy` (Allowlist) + Audit-Entries → unser Hash |

## 4) Externer Aufrufer ohne ephe-internen Kontext — ja, bewiesen
- Das Package deklariert sich selbst als framework-agnostisches „WASM execution primitive"; mitgeliefertes Muster: `integration/ephemora_cell_agent_executor.py` (`EphemoraCellExecutor(max_fuel, timeout, max_memory_mb).execute(wasm_path)` — genau unsere Aufrufform).
- ephe selbst nutzt exakt den öffentlichen Import-Pfad (`WASIConfig` + `run_isolated`) und sonst nichts → unsere Abhängigkeit ist identisch, **kein ephe-Runtime-Kontext nötig**. `pip install` des Apache-Packages genügt; ephe muss für T4 weder laufen noch verlinkt noch im öffentlichen Repo erwähnt werden (BUSL-Hygiene).

## 5) Risikoliste BUSL vs. Apache (Repo/Video/Demo-Post)
| Zeigbar | Nicht zeigbar |
|---|---|
| Jede API dieses Dokuments (Apache-2.0), inkl. Signatur-Zitate und CLI-Flags | ephe-Quellcode, Datei-Inhalte, `cell_boot.py`/Guest-Build, interne Pfade des privaten `ephe-dev`-Origins, Screenshots mit ephe-UI/Branding |
| Logik-Beschreibung: „ein Agent-Host integriert das Apache-Package via `run_isolated`" (ohne BUSL-Code) | Behauptung, der Receipt käme „aus ephe" — er kommt aus dem Apache-Package (Korrektheit = Judge-Vertrauen, Haseeb-Test) |
| Unser Adapter + Contract + Sign/Verify-Run mit eigenem Cell-Key | ephe-Repo-URL oder private Origin-URLs im öffentlichen Repo/X-Post |
| Apache-Lizenztext/Badge `ephemora-cell` | BUSL-1.1-Text von ephe als Lizenz des Projekts verkaufen |
Video: Terminalszenen nur mit unseren Scripts; `pip show ephemora-cell` als Nachweis der Apache-Abhängigkeit ist ideal.

## 6) Adapter-Spezifikation T4 — `core/receipts/ephemora_receipt.py` (foreman-seitig)
Real existierende Package-Funktionen in Klammern. Datenfluss ephe-Host-Arbeitsschritt → `attach_receipt(job_id, receipt)`:

```python
def execute_and_attest(worker_wasm: str, task_ctx: dict, cell_key: Ed25519PrivateKey) -> dict:
    cfg = WASIConfig(max_fuel=…, max_memory_mb=…, timeout_seconds=…,
                     allow_dirs=(f"{work}::/work",), disk_quota_bytes=…,
                     io_budget_bytes=…, io_cpu_seconds=…)                      # RULES.md-Caps
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
        "egress_log_hash": sha256_of_egress_audit(policy_entries),              # ADAPTER-EIGEN (siehe Lücken)
        "artifact_hash":   sha256(artifact_bytes),                              # ADAPTER-EIGEN
        "cell_signature":  signed["signature"],
        "alg": signed["alg"], "record": report.to_dict(),                        # Voll-Payload für Verifizierbarkeit
    }

def verify_receipt(receipt: dict, cell_pubkey) -> bool:                          # vor submit_work + im CI-Beweis
    return ExecutionReport.verify({**receipt["record"], "alg": receipt["alg"],
                                   "signature": receipt["cell_signature"]},
                                  lambda c, s: cell_pubkey.verify(s, c))         # fail-closed
```
**Dünnschicht-Gap (bewusst, klein):** (1) kein `ExecutionReport.from_result` → Zusammenführung `run_isolated`-dict→Report ist Adapter-Code (~20 Zeilen, unit-testbar); (2) `egress_log_hash` und `artifact_hash` erzeugt das Package nicht → Adapter-Hashes über `EgressAuditEntry`-Zeilen bzw. Artefakt-Bytes; (3) Cell-Key-Erzeugung/-Registrierung (public key beim Contract hinterlegen) ist foreman-seitig; (4) On-Chain kann JCS+Ed25519 nicht nativ verifizieren → Contract speichert `record`+`sha256(record)`, Verifikation läuft off-chain via `ExecutionReport.verify` (Foreman vor `submit_work` + EVIDENCE-Log-Replay). Das ist RULES.md-konform („Ohne Receipt kein submit_work") und ehrlich dokumentierbar.
