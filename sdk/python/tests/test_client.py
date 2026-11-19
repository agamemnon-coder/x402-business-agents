"""The Python client against a local mock of Purser Cloud (standard library only; no network beyond 127.0.0.1).

Run: python3 sdk/python/tests/test_client.py
"""

import json
import os
import sys
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from purser import OPERATIONS, Purser, PurserError  # noqa: E402

KEY = "pck_test_not-a-real-key"
PROPOSAL = {"id": "P-0001", "kind": "invoice_payment", "status": "PENDING_APPROVAL", "terms_sha256": "a" * 64, "facts": [["Amount", "EUR 1309.00"]], "warnings": []}


class Mock(BaseHTTPRequestHandler):
    seen = []

    def log_message(self, *_):
        pass

    def _send(self, status, body):
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _route(self, method):
        Mock.seen.append((method, self.path, self.headers.get("authorization")))
        if self.headers.get("authorization") != f"Bearer {KEY}":
            return self._send(401, {"error": "sign in, or send an API key as Authorization: Bearer", "code": "unauthorized"})
        p = self.path
        if method == "GET" and p == "/v1/me":
            return self._send(200, {"tenant": {"id": "t1", "name": "Northwind"}, "kind": "key", "scopes": ["read", "propose"], "role": None})
        if method == "GET" and (p == "/v1/invoices" or p.startswith("/v1/invoices?")):
            if "cursor=AP-0001" in p:
                return self._send(200, {"items": [{"id": "AP-0002", "version": 1}], "next_cursor": None})
            return self._send(200, {"items": [{"id": "AP-0001", "version": 1, "vendor": "Bergtex", "total": "1309.00", "currency": "EUR"}], "next_cursor": "AP-0001"})
        if method == "GET" and p == "/v1/invoices/AP-0001":
            return self._send(200, {"id": "AP-0001", "version": 1, "earlier_versions": []})
        if method == "GET" and p == "/v1/engine/invoices":
            return self._send(200, {"items": [{"id": "AP-0001", "status": "ready", "payable": True, "vendor": "Bergtex", "currency": "EUR", "total": "1309.00", "proposal": None}]})
        if method == "POST" and p == "/v1/engine/invoices/AP-0001/pay":
            return self._send(200, {"proposal": PROPOSAL})
        if method == "POST" and p == "/v1/engine/invoices/AP-0009/pay":
            return self._send(409, {"error": "AP-0009 is held for a person", "code": "conflict"})
        if method == "GET" and p == "/v1/engine/proposals/P-0001":
            return self._send(200, {"proposal": PROPOSAL})
        return self._send(404, {"error": "no such route", "code": "not_found"})

    def do_GET(self):
        self._route("GET")

    def do_POST(self):
        self._route("POST")


class ClientTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = HTTPServer(("127.0.0.1", 0), Mock)
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.base = f"http://127.0.0.1:{cls.server.server_port}"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()

    def setUp(self):
        Mock.seen = []
        self.p = Purser(self.base, KEY)

    def test_quickstart(self):
        self.assertEqual(self.p.me()["scopes"], ["read", "propose"])
        page = self.p.list_invoices(status="ready", limit=1)
        self.assertEqual(page["items"][0]["id"], "AP-0001")
        self.assertEqual([i["id"] for i in self.p.invoices()], ["AP-0001", "AP-0002"])
        self.assertEqual(self.p.get_invoice("AP-0001")["id"], "AP-0001")
        self.assertTrue(self.p.list_payable_invoices()[0]["payable"])
        out = self.p.propose_payment("AP-0001")
        self.assertEqual(out["proposal"]["status"], "PENDING_APPROVAL")
        self.assertEqual(self.p.get_proposal("P-0001")["status"], "PENDING_APPROVAL")
        self.assertIn(("POST", "/v1/engine/invoices/AP-0001/pay", f"Bearer {KEY}"), Mock.seen)
        self.assertIn(("GET", "/v1/invoices?status=ready&limit=1", f"Bearer {KEY}"), Mock.seen)

    def test_errors_carry_status_and_code(self):
        with self.assertRaises(PurserError) as e:
            self.p.propose_payment("AP-0009")
        self.assertEqual((e.exception.status, e.exception.code), (409, "conflict"))
        with self.assertRaises(PurserError) as e:
            Purser(self.base, "pck_wrong").me()
        self.assertEqual(e.exception.status, 401)

    def test_never_approves(self):
        self.assertFalse([n for n in dir(Purser) if "approv" in n.lower()])
        self.assertFalse([op for op, (_, path) in OPERATIONS.items() if "approve" in path or "approve" in op.lower()])

    def test_refuses_bad_input_and_hides_the_key(self):
        with self.assertRaises(ValueError):
            Purser("http://purser.example.com", KEY)
        with self.assertRaises(ValueError):
            Purser("https://purser.example.com", "")
        with self.assertRaises(ValueError):
            self.p.get_proposal("../keys")
        self.assertNotIn(KEY, repr(self.p))
        self.assertEqual(Purser.from_env({"PURSER_URL": self.base, "PURSER_API_KEY": KEY}).me()["kind"], "key")


if __name__ == "__main__":
    unittest.main()
