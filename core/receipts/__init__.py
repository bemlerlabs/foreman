"""core.receipts — Ephemora receipt adapter (Apache ephemora_cell, thin layer).

Baseline: github.com/MichaelS1011/ephemora-cell (Apache-2.0, vendored as a wheel in vendor/).
Only that Apache package is imported — the BUSL-licensed `ephe` package is never used here.
Integrity chain:
run_and_attest -> receipt.json -> receipt_hash (sha256/JCS) -> attach_receipt -> CI verify.
"""
