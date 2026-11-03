"""Minimal AIsa REST client: quote first, cap every call, track spend."""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field

BASE_URL = "https://api.aisa.one/apis/v1"
COST_HEADER = "x-aisa-customer-cost-micros-usd"


class AisaError(RuntimeError):
    pass


class BudgetExceeded(AisaError):
    pass


@dataclass
class Call:
    """One planned request. `path` is relative to BASE_URL."""

    name: str
    method: str
    path: str
    query: dict = field(default_factory=dict)
    body: dict | None = None


@dataclass
class AisaClient:
    api_key: str
    budget_usd: float
    max_price_per_call_usd: float = 0.05
    timeout: int = 90
    spent_usd: float = 0.0

    @classmethod
    def from_env(cls, budget_usd: float, **kw) -> "AisaClient":
        key = os.environ.get("AISA_API_KEY")
        if not key:
            raise AisaError("AISA_API_KEY is not set. See README for how to get a key.")
        return cls(api_key=key, budget_usd=budget_usd, **kw)

    def _request(self, call: Call, quote: bool, max_price: float | None = None) -> tuple[dict, float]:
        url = BASE_URL + call.path
        if call.query:
            url += "?" + urllib.parse.urlencode(call.query)
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
            "X-AISA-Max-Price-USD": f"{max_price or self.max_price_per_call_usd:.6f}",
        }
        if quote:
            headers["X-AISA-Cost-Mode"] = "quote"
        data = json.dumps(call.body).encode() if call.body is not None else None
        req = urllib.request.Request(url, method=call.method, headers=headers, data=data)
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                payload = json.loads(resp.read().decode("utf-8", "replace"))
                cost = int(resp.headers.get(COST_HEADER) or 0) / 1e6
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", "replace")[:300]
            raise AisaError(f"{call.name}: HTTP {e.code} {detail}") from e
        except urllib.error.URLError as e:
            raise AisaError(f"{call.name}: {e.reason}") from e
        return payload, cost

    def quote(self, calls: list[Call]) -> list[float]:
        """Free price estimates in USD, one per call, in order."""
        return [self._request(c, quote=True)[0].get("estimated_cost_micros_usd", 0) / 1e6 for c in calls]

    def run(self, call: Call) -> dict:
        remaining = self.budget_usd - self.spent_usd
        if remaining <= 0:
            raise BudgetExceeded(f"budget ${self.budget_usd:.2f} used up before {call.name}")
        # the gateway refuses a call priced above this cap, so the run can never overshoot
        payload, cost = self._request(call, quote=False, max_price=min(self.max_price_per_call_usd, remaining))
        self.spent_usd += cost
        return payload
