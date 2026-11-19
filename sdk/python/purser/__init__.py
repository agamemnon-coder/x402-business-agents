"""Purser's Python client: read the books, propose an invoice's payment, read a proposal's status.

Standard library only (urllib). Its operations are those of openapi/purser.yaml; test/sdk-python.test.ts checks each
one against the document.

What it cannot do, on purpose: approve. Approving a payment is a signed-in person's passkey over the exact terms, in
Purser Cloud; the API refuses every key there, and this client has no method for it.
"""

from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Dict, Iterator, List, Optional

__all__ = ["Purser", "PurserError", "OPERATIONS"]
__version__ = "0.1.0"

#: The operations this client calls, by OpenAPI operationId: (method, path).
OPERATIONS: Dict[str, tuple] = {
    "getMe": ("GET", "/v1/me"),
    "listInvoices": ("GET", "/v1/invoices"),
    "getInvoice": ("GET", "/v1/invoices/{id}"),
    "listPayableInvoices": ("GET", "/v1/engine/invoices"),
    "proposePayment": ("POST", "/v1/engine/invoices/{id}/pay"),
    "getProposal": ("GET", "/v1/engine/proposals/{id}"),
}

_LOCAL = {"localhost", "127.0.0.1", "::1"}
_ID = re.compile(r"^[A-Za-z0-9_.:-]{1,120}$")


class PurserError(Exception):
    """An answer that was not 2xx: the API's sentence for a person and its stable code for a program."""

    def __init__(self, status: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.code = code


class Purser:
    """A client for one company's Purser Cloud.

    base_url: your Purser Cloud (https; http only for localhost).
    api_key: an API key (pck_...) from the environment, never from code. read to read; read and propose to file payments.
    """

    def __init__(self, base_url: str, api_key: str, timeout: float = 30.0) -> None:
        url = urllib.parse.urlsplit(base_url)
        if not (url.scheme == "https" or (url.scheme == "http" and url.hostname in _LOCAL)) or not url.netloc:
            raise ValueError("base_url must be https (http only for localhost)")
        if not api_key:
            raise ValueError("api_key is empty: read it from the environment (PURSER_API_KEY)")
        self._base = f"{url.scheme}://{url.netloc}"
        self._key = api_key
        self._timeout = timeout

    def __repr__(self) -> str:  # never the key
        return f"Purser({self._base!r})"

    @classmethod
    def from_env(cls, env: Optional[Dict[str, str]] = None) -> "Purser":
        """A client from PURSER_URL and PURSER_API_KEY."""
        e = os.environ if env is None else env
        return cls(e.get("PURSER_URL", ""), e.get("PURSER_API_KEY", ""))

    def _call(self, op: str, id: Optional[str] = None, query: Optional[Dict[str, Any]] = None) -> Any:
        method, path = OPERATIONS[op]
        if "{id}" in path:
            if not id or not _ID.match(id):
                raise ValueError(f"{op} needs an id like AP-0004 or P-0009")
            path = path.replace("{id}", urllib.parse.quote(id, safe=""))
        q = {k: str(v) for k, v in (query or {}).items() if v is not None}
        url = self._base + path + (f"?{urllib.parse.urlencode(q)}" if q else "")
        req = urllib.request.Request(url, method=method, headers={"authorization": f"Bearer {self._key}", "accept": "application/json", "user-agent": f"purser-python/{__version__}"})
        try:
            with urllib.request.urlopen(req, timeout=self._timeout) as res:
                text = res.read().decode("utf-8")
        except urllib.error.HTTPError as e:
            raw = e.read().decode("utf-8", "replace")
            try:
                body = json.loads(raw)
            except ValueError:
                body = {}
            raise PurserError(e.code, body.get("code", "error"), body.get("error", f"HTTP {e.code}")) from None
        try:
            return json.loads(text)
        except ValueError:
            raise PurserError(200, "not_json", "the answer was not JSON") from None

    def me(self) -> Dict[str, Any]:
        """Who is calling: the company and this key's scopes."""
        return self._call("getMe")

    def list_invoices(self, status: Optional[str] = None, due_from: Optional[str] = None, due_to: Optional[str] = None,
                      limit: Optional[int] = None, cursor: Optional[str] = None) -> Dict[str, Any]:
        """One page of supplier invoices: {"items": [...], "next_cursor": str | None}."""
        return self._call("listInvoices", query={"status": status, "due_from": due_from, "due_to": due_to, "limit": limit, "cursor": cursor})

    def invoices(self, **query: Any) -> Iterator[Dict[str, Any]]:
        """Every invoice that matches, page by page."""
        cursor = None
        while True:
            page = self.list_invoices(cursor=cursor, **query)
            yield from page["items"]
            cursor = page.get("next_cursor")
            if not cursor:
                return

    def get_invoice(self, invoice_id: str) -> Dict[str, Any]:
        return self._call("getInvoice", invoice_id)

    def list_payable_invoices(self) -> List[Dict[str, Any]]:
        """The engine's invoices: whether each can be proposed (payable) and its proposal, if one was filed."""
        return self._call("listPayableInvoices")["items"]

    def propose_payment(self, invoice_id: str) -> Dict[str, Any]:
        """File an invoice's payment for the CFO's approval (a key with the propose scope).

        Nothing is paid until the CFO signs these exact terms with their passkey in Purser Cloud. A PurserError with
        status 409 says why Purser would not file it.
        """
        return self._call("proposePayment", invoice_id)

    def get_proposal(self, proposal_id: str) -> Dict[str, Any]:
        """Where a proposal stands: PENDING_APPROVAL until the CFO's passkey, then APPROVED and EXECUTED, or REJECTED or EXPIRED."""
        return self._call("getProposal", proposal_id)["proposal"]
