"""foreman_core — version marker for the off-chain side of Foreman.

The engine itself lives in the sibling packages under core/: bidding, receipts, reputation,
market, acceptance and intents. Custody of funds is never here — the NEAR contract in
contracts/foreman holds the escrow and decides what a delivery is worth. The pre-hackathon
baseline libraries this code builds on are declared in the README and in vendor/NOTICE.
"""
__version__ = "0.1.0"
