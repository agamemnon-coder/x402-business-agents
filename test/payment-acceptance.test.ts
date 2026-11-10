// Money in by card through Airwallex payment acceptance (docs/airwallex-approvals.md, "Money in by card"): a customer
// pays a Northwind invoice by card; Purser books it only once Airwallex reports the PaymentIntent SUCCEEDED, matched to
// the open receivable by its merchant_order_id, once per PaymentIntent, in the hash-chained audit log, as test money.
// Breaks if a payment is booked before SUCCEEDED, twice, without the flag, with a card that is not a documented test
// card, or if the client could reach anything but the sandbox.
import { describe, expect, it } from "vitest";
import {
  AcceptanceRest, acceptanceOn, bookCardPayment, collectInvoiceByCard, FakeAcceptance, SANDBOX_TEST_CARD_SUCCESS,
} from "../src/airwallex/acceptance.js";
import { openReceivable } from "../src/agents/receivables.js";
import { verifyAuditChain } from "../src/audit/log.js";
import { openDb } from "../src/db/open.js";
import { checkEvent, recordEvent } from "../src/policy/airwallexEvents.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ON = { AIRWALLEX_PAYMENT_ACCEPTANCE: "on" } as NodeJS.ProcessEnv;
const at = new Date("2026-11-10T09:00:00Z");
function world() {
  const db = openDb(":memory:");
  openReceivable(db, { invoice_no: "NW-R-201", customer: "Fjord & Fell Outfitters", currency: "EUR", amount_cents: 2_490, due_date: "2026-12-10" }, at);
  return db;
}
const audit = (db: ReturnType<typeof openDb>, event: string) => db.prepare("SELECT subject, payload_json FROM audit_log WHERE event = ?").all(event) as { subject: string; payload_json: string }[];

describe("money in by card through Airwallex payment acceptance", () => {
  it("is off unless AIRWALLEX_PAYMENT_ACCEPTANCE=on", async () => {
    expect(acceptanceOn({} as NodeJS.ProcessEnv)).toBe(false);
    expect(acceptanceOn(ON)).toBe(true);
    await expect(collectInvoiceByCard(world(), new FakeAcceptance(), "NW-R-201", {} as NodeJS.ProcessEnv)).rejects.toThrow(/off/);
  });

  it("books the invoice paid only after Airwallex reports SUCCEEDED, once, with a valid audit chain", async () => {
    const db = world();
    const pa = new FakeAcceptance();
    const r = await collectInvoiceByCard(db, pa, "NW-R-201", ON, at);
    expect(r).toMatchObject({ status: "SUCCEEDED", booked: true, outcome: "MATCHED", invoice_no: "NW-R-201" });
    expect(pa.calls).toEqual(["create", "confirm", "get"]);
    expect(db.prepare("SELECT status, paid_cents FROM receivables WHERE invoice_no = 'NW-R-201'").get()).toEqual({ status: "PAID", paid_cents: 2_490 });
    // Booking the same PaymentIntent again (a webhook after the poll) changes nothing.
    expect(bookCardPayment(db, await pa.getPaymentIntent(r.payment_intent_id), at)).toMatchObject({ booked: false });
    expect(db.prepare("SELECT COUNT(*) AS n FROM receipts").get()).toEqual({ n: 1 });
    const booked = audit(db, "payment_acceptance.succeeded");
    expect(booked).toHaveLength(1);
    expect(JSON.parse(booked[0]!.payload_json)).toMatchObject({ test_money: true, payment_intent_id: r.payment_intent_id, last4: "0008" });
    expect(verifyAuditChain(db).ok).toBe(true);
  });

  it("books nothing for a payment Airwallex has not reported SUCCEEDED", () => {
    const db = world();
    const out = bookCardPayment(db, { id: "int_1", status: "REQUIRES_PAYMENT_METHOD", amountCents: 2_490, currency: "EUR", merchantOrderId: "NW-R-201", last4: null }, at);
    expect(out).toMatchObject({ booked: false, outcome: null });
    expect(db.prepare("SELECT COUNT(*) AS n FROM receipts").get()).toEqual({ n: 0 });
    expect(audit(db, "payment_acceptance.not_booked")).toHaveLength(1);
  });

  it("escalates a card payment that does not settle its invoice exactly, like any other receipt", () => {
    const db = world();
    expect(bookCardPayment(db, { id: "int_2", status: "SUCCEEDED", amountCents: 2_000, currency: "EUR", merchantOrderId: "NW-R-201", last4: "0008" }, at)).toMatchObject({ booked: true, outcome: "SHORT" });
  });

  it("books from a payment_intent.succeeded webhook only with the flag on", () => {
    const pi = { id: "int_3", status: "SUCCEEDED", amount: 24.9, currency: "EUR", merchant_order_id: "NW-R-201" };
    const off = world();
    expect(checkEvent(off, "payment_intent.succeeded", pi, at, {} as NodeJS.ProcessEnv)).toMatchObject({ object: "payment_intent", agrees: null });
    expect(off.prepare("SELECT COUNT(*) AS n FROM receipts").get()).toEqual({ n: 0 });
    const on = world();
    expect(checkEvent(on, "payment_intent.succeeded", pi, at, ON).outcome).toMatch(/MATCHED/);
    expect(on.prepare("SELECT status FROM receivables WHERE invoice_no = 'NW-R-201'").get()).toEqual({ status: "PAID" });
  });

  it("only ever confirms with a documented sandbox test card, and only against the sandbox", async () => {
    const pa = new FakeAcceptance();
    const intent = await pa.createPaymentIntent({ requestId: "r1", amountCents: 100, currency: "EUR", merchantOrderId: "X" });
    await expect(pa.confirmWithTestCard(intent.id, { requestId: "r2", number: "4111111111111111" })).rejects.toThrow(/test card/);
    expect(SANDBOX_TEST_CARD_SUCCESS).toBe("4035501000000008");
    expect(() => new AcceptanceRest({ clientId: "x", apiKey: "y", baseUrl: "https://api.airwallex.com/api/v1" })).toThrow(/sandbox/);
  });

  it("maps the sandbox REST answers: amounts in major units to cents, the card's last four digits", async () => {
    const seen: { method: string; path: string; body: unknown }[] = [];
    const answers: unknown[] = [
      { token: "t" },
      { id: "int_abc", status: "REQUIRES_PAYMENT_METHOD", amount: 24.9, currency: "EUR", merchant_order_id: "NW-R-201" },
      { id: "int_abc", status: "SUCCEEDED", amount: 24.9, currency: "EUR", merchant_order_id: "NW-R-201", latest_payment_attempt: { payment_method: { card: { last4: "0008" } } } },
    ];
    const fetchImpl = (async (url: URL | string, init?: RequestInit) => {
      seen.push({ method: init?.method ?? "GET", path: new URL(String(url)).pathname, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      return new Response(JSON.stringify(answers.shift()), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    const rest = new AcceptanceRest({ clientId: "x", apiKey: "y", fetchImpl, minGapMs: 0 });
    const made = await rest.createPaymentIntent({ requestId: "r1", amountCents: 2_490, currency: "EUR", merchantOrderId: "NW-R-201" });
    expect(made).toMatchObject({ id: "int_abc", amountCents: 2_490, merchantOrderId: "NW-R-201" });
    const done = await rest.confirmWithTestCard("int_abc", { requestId: "r2", number: SANDBOX_TEST_CARD_SUCCESS });
    expect(done).toMatchObject({ status: "SUCCEEDED", last4: "0008" });
    expect(seen.map((s) => `${s.method} ${s.path}`)).toEqual([
      "POST /api/v1/authentication/login", "POST /api/v1/pa/payment_intents/create", "POST /api/v1/pa/payment_intents/int_abc/confirm",
    ]);
    expect(seen[1]!.body).toMatchObject({ request_id: "r1", amount: 24.9, currency: "EUR", merchant_order_id: "NW-R-201" });
    expect(seen[2]!.body).toMatchObject({ payment_method: { type: "card", card: { number: SANDBOX_TEST_CARD_SUCCESS } }, payment_method_options: { card: { auto_capture: true } } });
  });

  it("records a card-payment webhook, also in a ledger made before payment_intent events existed", () => {
    const file = join(mkdtempSync(join(tmpdir(), "pa-")), "ledger.db");
    const old = openDb(file);
    old.exec(`DROP TABLE airwallex_events; CREATE TABLE airwallex_events (event_id TEXT PRIMARY KEY, name TEXT NOT NULL,
      object TEXT NOT NULL CHECK (object IN ('card_transaction', 'card', 'transfer', 'conversion', 'deposit', 'other')),
      object_id TEXT, status TEXT, amount_cents INTEGER, currency TEXT, agrees INTEGER CHECK (agrees IN (0, 1)), outcome TEXT NOT NULL, received_at TEXT NOT NULL);
      INSERT INTO airwallex_events VALUES ('evt_old', 'deposit.settled', 'deposit', 'd1', 'SETTLED', 100, 'EUR', NULL, 'kept', '2026-11-01T00:00:00Z');`);
    old.close();
    const db = openDb(file);
    const c = checkEvent(db, "payment_intent.succeeded", { id: "int_9", status: "SUCCEEDED", amount: 1, currency: "EUR" }, at, {} as NodeJS.ProcessEnv);
    expect(recordEvent(db, "evt_pi", "payment_intent.succeeded", c, at)).toBe(true);
    expect(db.prepare("SELECT event_id, object FROM airwallex_events ORDER BY event_id").all()).toEqual([{ event_id: "evt_old", object: "deposit" }, { event_id: "evt_pi", object: "payment_intent" }]);
  });
});
