# Foreman — one command per thing a reviewer or an operator actually does.
# Run `make help` (or just `make`) for the list. No target here needs a key, an account or
# network access except `demo-live` and `deploy-testnet`, which say so.

PY := .venv-receipts/bin/python
VENV := .venv-receipts
BOARD_PORT ?= 8899
JOB ?= 50

.DEFAULT_GOAL := help
.PHONY: help bootstrap test contract-test lint hygiene links receipt gate board cli-board \
        demo demo-offline demo-live check build-worker deploy-testnet clean

help: ## show this list
	@grep -hE '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) \
	  | awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'
	@echo ""
	@echo "  everyday:      make bootstrap && make check && make board"
	@echo "  the ten-minute judge path: make demo-offline"

bootstrap: ## create the sandbox venv from the vendored wheel (no package index needed)
	python3.12 -m venv $(VENV)
	$(VENV)/bin/pip install --quiet wasmtime cryptography pytest ruff \
	  vendor/ephemora_cell-2.2.0-py3-none-any.whl
	@echo "venv ready — the vendored wheel's SHA-256 is in vendor/NOTICE"

test: ## the Python suites (69 tests: receipts, bidding, market, reputation, acceptance)
	$(PY) -m pytest core

contract-test: ## the on-chain suite (55 tests: every require! rejection, windows, payout, refunds)
	cargo test --manifest-path contracts/foreman/Cargo.toml

lint: ## ruff over our Python (syntax errors + undefined names; see pyproject.toml for why)
	$(PY) -m ruff check core scripts plugin-pack

hygiene: ## dead links, table shape, leak patterns and media budget across tracked files
	$(PY) scripts/check_hygiene.py

links: ## dead-link check only
	$(PY) scripts/check_hygiene.py --links

receipt: ## independently verify the signed receipt of job $(JOB) (fail-closed)
	$(PY) -c "import json,sys; sys.path.insert(0,'.'); \
from core.receipts.ephemora_adapter import verify_receipt, receipt_hash; \
r=json.load(open('artifacts/receipt_demo_job$(JOB).json')); \
print('verify_receipt:', verify_receipt(r)); print('receipt_hash :', receipt_hash(r))"

gate: ## machine-check the deliverable against its acceptance criteria
	$(PY) scripts/verify_acceptance.py --deliverable artifacts/deliverable_demo.json

cli-board: ## read job $(JOB) straight from the contract, no browser
	$(PY) scripts/board_cli.py --job $(JOB)

board: ## serve the read-only board on http://127.0.0.1:$(BOARD_PORT)
	python3 -m http.server $(BOARD_PORT) -d web/board

demo-offline: ## the whole proof chain from committed artifacts only, no network
	bash scripts/judge_demo.sh --offline

demo-live: ## the same demo reading the live board (needs testnet RPC)
	bash scripts/judge_demo.sh

build-worker: ## rebuild the sandbox worker WASM (needs Go; running the demo does not)
	bash scripts/build_receipt_worker.sh

deploy-testnet: ## build + deploy the contract to testnet (needs near login + a funded account)
	@echo "testnet only; the script refuses mainnet. Requires credentials — see docs/DEPLOYMENT.md"
	bash scripts/deploy-testnet.sh

check: test contract-test lint hygiene ## every gate that runs without credentials

clean: ## remove local test and lint droppings (artifacts/ and the wasm build are never touched)
	rm -rf .pytest_cache .ruff_cache .benchmarks
	find core scripts plugin-pack -name __pycache__ -type d -prune -exec rm -rf {} +
	@echo "caches cleared; contracts/foreman/target left alone (cargo clean does that)"
