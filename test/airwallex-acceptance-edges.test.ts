// Card payments in (src/airwallex/acceptance.ts), the paths the other files leave: a PaymentIntent read back without
// an order id or a card reads them as none; the documented decline card leaves the intent waiting for a payment method,
// and an undocumented card is never sent; an invoice that is not open is never charged; a customer paying an open
// invoice is booked from what Airwallex reports, at the time it is read; and a webhook body without an id, an amount or a
// status is no PaymentIntent, while an amount written as text is read. Sandbox test cards only; no network.
import { describe, expect, it } from "vitest";
import { AcceptanceRest, collectInvoiceByCard, FakeAcceptance, intentFromEvent } from "../src/airwallex/acceptance.js";
import { openDb } from "../src/db/open.js";

const ON = { AIRWALLEX_PAYMENT_ACCEPTANCE: "on" };
const DECLINE_CARD = "5307837360544518";

describe("the REST client", () => {
  it("an intent read back without an order id or a card reads them as none", async () => {
    const fetchImpl = (async (input: RequestInfo | URL) => (String(input).endsWith("/authentication/login") ? Response.json({ token: "t" }) : Response.json({ id: "int_1", status: "SUCCEEDED", amount: 12.5, currency: "EUR" }))) as typeof fetch;
    const pa = new AcceptanceRest({ clientId: "stand-in-client", apiKey: "stand-in-key", fetchImpl, minGapMs: 0 });
    expect(await pa.getPaymentIntent("int_1")).toEqual({ id: "int_1", status: "SUCCEEDED", amountCents: 1250, currency: "EUR", merchantOrderId: null, last4: null });
  });
});

describe("the stand-in", () => {
  it("the documented decline card leaves the intent waiting; an undocumented card is never sent", async () => {
    const pa = new FakeAcceptance();
    const pi = await pa.createPaymentIntent({ requestId: "r1", amountCents: 8051, currency: "EUR", merchantOrderId: "NW-1" });
    expect(await pa.confirmWithTestCard(pi.id, { requestId: "r2", number: DECLINE_CARD })).toMatchObject({ status: "REQUIRES_PAYMENT_METHOD", last4: "4518" });
    await expect(pa.confirmWithTestCard(pi.id, { requestId: "r3", number: "4111111111111111" })).rejects.toThrow("only a documented Airwallex sandbox test card may be used; nothing was sent");
    expect(pa.calls).toEqual(["create", "confirm"]);
  });
});

describe("collecting an invoice by card", () => {
  const world = () => {
    const db = openDb(":memory:");
    db.prepare("INSERT INTO receivables (invoice_no, customer, currency, amount_cents, paid_cents, due_date, status, issued_at) VALUES ('NW-1', 'Ridgeline Outfitters', 'EUR', 50000, 20000, '2026-11-30', 'PARTIAL', '2026-11-01'), ('NW-2', 'Ridgeline Outfitters', 'EUR', 100, 100, '2026-11-30', 'PAID', '2026-11-01')").run();
    return db;
  };

  it("an invoice that is not open, or not there, is never charged", async () => {
    const db = world();
    const pa = new FakeAcceptance();
    await expect(collectInvoiceByCard(db, pa, "NW-2", ON)).rejects.toThrow("NW-2 is not an open Northwind invoice; nothing was sent");
    await expect(collectInvoiceByCard(db, pa, "NW-404", ON)).rejects.toThrow("NW-404 is not an open Northwind invoice; nothing was sent");
    await expect(collectInvoiceByCard(db, pa, "NW-1", {})).rejects.toThrow(/payment acceptance is off/);
    expect(pa.calls).toEqual([]);
  });

  it("an open invoice is charged its open amount and booked from what Airwallex reports, now", async () => {
    const db = world();
    const pa = new FakeAcceptance();
    const before = Date.now();
    const out = await collectInvoiceByCard(db, pa, "NW-1", ON);
    expect(out).toMatchObject({ booked: true, status: "SUCCEEDED", invoice_no: "NW-1" });
    expect(pa.calls).toEqual(["create", "confirm", "get"]);
    const created = JSON.parse((db.prepare("SELECT payload_json FROM audit_log WHERE event = 'payment_acceptance.created'").get() as { payload_json: string }).payload_json) as { amount: string };
    expect(created.amount).toBe("300.00");
    const ts = (db.prepare("SELECT ts FROM audit_log WHERE event = 'payment_acceptance.succeeded'").get() as { ts: string }).ts;
    expect(Date.parse(ts)).toBeGreaterThanOrEqual(before);
  });
});

describe("a payment_intent webhook body", () => {
  it("needs an id, a positive amount, a currency and a status; an amount as text is read", () => {
    expect(intentFromEvent({ amount: 5, currency: "EUR", status: "succeeded" })).toBeNull();
    expect(intentFromEvent({ id: "int_1", amount: "zero", currency: "EUR", status: "succeeded" })).toBeNull();
    expect(intentFromEvent({ id: "int_1", amount: true, currency: "EUR", status: "succeeded" })).toBeNull();
    expect(intentFromEvent({ id: "int_1", amount: "12.50", currency: "EUR", status: "succeeded", merchant_order_id: "NW-1" }))
      .toEqual({ id: "int_1", status: "SUCCEEDED", amountCents: 1250, currency: "EUR", merchantOrderId: "NW-1", last4: null });
  });
});
