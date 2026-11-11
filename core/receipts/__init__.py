"""core.receipts — Ephemora receipt adapter (Apache ephemora_cell, thin layer).

Baseline: github.com/MichaelS1011/ephemora-cell (Apache-2.0, pip-installed from a local checkout).
No ephe import (BUSL hygiene, docs/EPHE_CELL_MAP.md §5). Integrity chain:
run_and_attest -> receipt.json -> receipt_hash (sha256/JCS) -> attach_receipt -> CI verify.
"""
