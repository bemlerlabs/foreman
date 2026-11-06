"""core.market — Drittanbieter-Agenten über NEAR Agent Market (market.near.ai).

Wrapper für Discovery (Listings) + Offer/Accept-Flow (hire-draft → bid).
Zwei Modi mit IDENTISCHEM Vertrag:
  * real  — HTTP gegen MARKET_BASE_URL (Default https://market.near.ai),
            Auth via .env MARKET_AGENT_TOKEN (`aat_…`), stdlib urllib, kein Dependency.
  * mock  — Fallback ohne Token/Netz; Listings = die 5 real erfassten Marktplatz-Treffer
            vom 06.11.2026 (docs/MARKET_NOTES.md), deterministisch ⇒ e2e-Demo blockiert nie.

Registrierung bewusst NICHT implementiert (USER-Entscheidung, MARKET_NOTES.md §3).
"""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Optional

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_BASE_URL = "https://market.near.ai"

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


class MarketError(RuntimeError):
    pass


class MarketAuthError(MarketError):
    """401/403 — Token fehlt oder abgelaufen."""


# ---------------------------------------------------------------- Mock-Daten
# Die 5 real erfassten Live-Listings (GET /v1/agents, 06.11.2026, docs/MARKET_NOTES.md).
# Preis = pricing-plans price_amount (USD per_call), Asset = payable_with.
MOCK_LISTINGS = [
    {"handle": "web-research", "name": "Web Research", "category": "research",
     "price_usd": "0.50", "asset": "USDC", "delivered_jobs": 47, "success_rate": 70,
     "agent_id": "30ba50df-5509-452f-b936-8211e516979f"},
    {"handle": "codecitationdrift", "name": "Code Citation Drift Checker", "category": "legal_compliance",
     "price_usd": "0.01", "asset": "USDC", "delivered_jobs": 28, "success_rate": 97,
     "agent_id": "20f321bd-97b3-4e5b-9b86-4fa9f6f92c48"},
    {"handle": "shoplet", "name": "Shoplet", "category": "research",
     "price_usd": "0.10", "asset": "USDC", "delivered_jobs": 24, "success_rate": 77,
     "agent_id": "3e1a7cc2-2734-4d37-8507-c4ae722fa8ab"},
    {"handle": "ai-gen-text-detector", "name": "AI Gen Text Detector", "category": "creative",
     "price_usd": "0.25", "asset": "USDC", "delivered_jobs": 22, "success_rate": 92,
     "agent_id": "bf0c21e1-8c2a-4802-9fc8-f0b09b615b2c"},
    {"handle": "wallet-activity-lookup", "name": "NEAR Wallet Activity Lookup", "category": "finance",
     "price_usd": "0.50", "asset": "USDC", "delivered_jobs": 20, "success_rate": 83,
     "agent_id": "f7120c48-9fc5-49aa-b830-5f14a93efb1f"},
]


# ---------------------------------------------------------------- Client
class MarketClient:
    """Entdeckt Marktplatz-Agenten und fährt den Offer/Accept-Flow.

    Modus-Wahl: prefer='auto' ⇒ real bei gesetztem MARKET_AGENT_TOKEN, sonst mock.
    'real'/'mock' erzwingt. Netzfehler im real-Modus werfen MarketError (kein stiller
    Fallback — Demo soll ehrlich scheitern statt falsche Daten zu zeigen, außer 'auto').
    """

    def __init__(self, base_url: Optional[str] = None, token: Optional[str] = None,
                 prefer: str = "auto", timeout: float = 15.0):
        _load_env()
        self.base_url = (base_url or _env("MARKET_BASE_URL", DEFAULT_BASE_URL) or DEFAULT_BASE_URL).rstrip("/")
        self.token = token if token is not None else _env("MARKET_AGENT_TOKEN", "")
        self.timeout = timeout
        if prefer == "auto":
            prefer = "real" if (self.token and self.token.startswith("aat_")) else "mock"
        if prefer not in ("real", "mock"):
            raise ValueError(f"PREFER_INVALID: {prefer}")
        self.mode = prefer

    # ---- HTTP-Kern (nur real-Modus) ----
    def _request(self, method: str, path: str, body: Optional[dict] = None) -> dict:
        import urllib.error
        import urllib.request

        url = f"{self.base_url}{path}"
        data = json.dumps(body).encode("utf-8") if body is not None else None
        req = urllib.request.Request(url, data=data, method=method)
        req.add_header("Accept", "application/json")
        if data:
            req.add_header("Content-Type", "application/json")
        if self.token:
            req.add_header("Authorization", f"Bearer {self.token}")
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            payload = exc.read().decode("utf-8", "replace")[:400]
            if exc.code in (401, 403):
                raise MarketAuthError(f"{method} {path} → {exc.code}: {payload}") from exc
            raise MarketError(f"{method} {path} → {exc.code}: {payload}") from exc
        except OSError as exc:
            raise MarketError(f"{method} {path} → Netzwerk: {exc}") from exc

    # ---- Discovery ----
    def discovery(self, query: str = "", category: Optional[str] = None,
                  limit: int = 5) -> list:
        """Listings als einheitliche Dicts: handle,name,category,price_usd,asset,delivered_jobs,success_rate,agent_id."""
        if self.mode == "mock":
            out = [dict(a) for a in MOCK_LISTINGS]
            if query:
                q = query.lower()
                out = [a for a in out if q in a["name"].lower() or q in a["handle"].lower()
                       or q in (a["category"] or "").lower()]
            if category:
                out = [a for a in out if a["category"] == category]
            return out[:limit]
        path = f"/v1/agents?limit={int(limit)}&sort=rating"
        if query:
            path += f"&q={urllib_quote(query)}"
        if category:
            path += f"&category={urllib_quote(category)}"
        raw = self._request("GET", path)
        return [self._normalize(a) for a in raw.get("agents", [])]

    @staticmethod
    def _normalize(a: dict) -> dict:
        price = a.get("price_usd") or a.get("starting_price_usd")
        plans = a.get("pricing_plans") or []
        if price is None and plans:
            price = plans[0].get("price_amount")
        return {
            "handle": a.get("handle"),
            "name": a.get("name"),
            "category": a.get("category"),
            "price_usd": price,
            "asset": (a.get("payable_with") or ["USDC"])[0],
            "delivered_jobs": a.get("delivered_jobs"),
            "success_rate": a.get("success_rate"),
            "agent_id": a.get("agent_id"),
        }

    # ---- Offer/Accept-Flow ----
    def create_hire_draft(self, agent_id: str, brief: str, acceptance_window_days: int = 3) -> dict:
        """Offer-Seite des Buyers: Hire-Draft beim Ziel-Agenten anlegen (MARKET_NOTES.md §4)."""
        if not brief or not brief.strip():
            raise ValueError("EMPTY_BRIEF")
        if self.mode == "mock":
            return {"draft_id": f"mock-draft-{agent_id[:8]}", "agent_id": agent_id,
                    "brief": brief, "acceptance_window_days": acceptance_window_days,
                    "state": "draft", "mode": "mock"}
        return self._request("POST", f"/v1/agents/{agent_id}/hire-draft",
                             {"brief": brief, "acceptanceWindowDays": acceptance_window_days})

    def place_bid(self, job_id: str, amount_usd: str, proposal: str) -> dict:
        """Worker-Seite (aat_-Token): Bid auf Job. amount ist USD-String ('25.00')."""
        if not job_id or not job_id.strip():
            raise ValueError("EMPTY_JOB")
        if not proposal or not proposal.strip():
            raise ValueError("EMPTY_PROPOSAL")
        _assert_usd_amount(amount_usd)
        if self.mode == "mock":
            return {"job_id": job_id, "amount": amount_usd, "proposal": proposal,
                    "state": "pending", "mode": "mock"}
        return self._request("POST", f"/v1/jobs/{job_id.strip()}/bids",
                             {"amount": amount_usd, "proposal": proposal})

    def accept_delivery(self, assignment_id: str, approve: bool = True, comment: str = "") -> dict:
        """Buyer-Review nach Delivery (Zahl freischalten / ablehnen)."""
        if self.mode == "mock":
            return {"assignment_id": assignment_id, "approve": approve, "state": "reviewed", "mode": "mock"}
        return self._request("POST", f"/v1/assignments/{assignment_id.strip()}/review",
                             {"approve": approve, "comment": comment})


def _assert_usd_amount(amount_usd: str) -> None:
    try:
        v = float(str(amount_usd))
    except (TypeError, ValueError):
        raise ValueError(f"BAD_AMOUNT: {amount_usd!r} (USD-String erwartet, z. B. '25.00')")
    if v <= 0:
        raise ValueError(f"NONPOSITIVE_AMOUNT: {amount_usd}")


def urllib_quote(s: str) -> str:
    from urllib.parse import quote
    return quote(s, safe="")
