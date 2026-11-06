"""core.receipts — Ephemora-Receipt-Adapter (Apache ephemora_cell, Dünnschicht).

Baseline: github.com/MichaelS1011/ephemora-cell (Apache-2.0, lokal ~/ephemora-cell).
Kein ephe-Import (BUSL-Hygiene, docs/EPHE_CELL_MAP.md §5). Integritaetskette:
run_and_attest -> receipt.json -> receipt_hash (sha256/JCS) -> attach_receipt -> CI-Verify.
"""
