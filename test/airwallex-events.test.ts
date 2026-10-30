// Airwallex webhooks for every object Purser uses (awards item 5): each signed event is recorded once and checked
// against the ledger. Card transactions are booked (as before); cards, transfers and conversions are compared; a
// settled deposit into a known Global Account goes to the receivables agent. What the ledger cannot explain (a payout
// or conversion Purser did not make, a card live at Airwallex that Purser froze) stands as an alarm in /health.
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { openDb } from "../src/db/open.js";
import { handleAirwallexHook } from "../src/policy/cardHooks.js";
import { airwallexEventsView, ALL_EVENTS, setKnownGlobalAccounts } from "../src/policy/airwallexEvents.js";
import { setupCards } from "../src/policy/cards.js";
import { openReceivable } from "../src/agents/receivables.js";
import { health } from "../src/ops/health.js";
import { FakeIssuing } from "../src/redteam/issuing.js";
import { CARD_EVENTS } from "../src/airwallex/webhooks.js";

const SECRET = ["whsec", "test", "y".repeat(24)].join("_");
const t0 = new Date("2026-11-03T10:00:00Z");
const ts = String(t0.getTime());
const sign = (body: string, key = SECRET) => createHmac("sha256", key).update(ts + body).digest("hex");
let n = 0;
const send = (db: ReturnType<typeof openDb>, name: string, object: Record<string, unknown>, id = `evt-${++n}`) => {
  const body = JSON.stringify({ id, name, account_id: "acct", created_at: t0.toISOString(), version: "2025-11-11", data: { object } });
  return handleAirwallexHook(db, { id, ts, signature: sign(body), body }, SECRET, t0);
};

async function world() {
  const db = openDb(":memory:");
  const awx = new FakeIssuing();
  await setupCards(db, awx, t0);
  // One payout and one conversion Purser made itself (as its executors record them).
  db.prepare("INSERT INTO invoices (invoice_no, vendor, amount, currency, due_date, iban_sha256, bic, doc_sha256, status) VALUES ('BTX-1', 'Bergtex', '1850.00', 'EUR', '2026-11-20', 'h', 'BIC', 'd', 'PAID')").run();
  db.prepare("INSERT INTO transfers (transfer_id, request_id, invoice_no, amount, currency, method, fee_estimate, status, approval_sha256, updated_at) VALUES ('tr-ours', 'rq-1', 'BTX-1', '1850.00', 'EUR', 'SWIFT', '13.41', 'PAID', 'a', ?)").run(t0.toISOString());
  db.prepare("INSERT INTO fx_quotes (quote_id, pair, buy_amount, client_rate, valid_from, valid_to) VALUES ('q-1', 'USDEUR', '370.00', '0.884', ?, ?)").run(t0.toISOString(), t0.toISOString());
  db.prepare("INSERT INTO fx_conversions (conversion_id, quote_id, request_id, buy_amount, status, approval_sha256) VALUES ('cv-ours', 'q-1', 'rq-c', '370.00', 'SETTLED', 'a')").run();
  return { db, awx };
}
const recorded = (db: ReturnType<typeof openDb>) => db.prepare("SELECT name, object, object_id, status, agrees FROM airwallex_events ORDER BY rowid").all();

describe("Airwallex webhooks for every object Purser uses", () => {
  it("subscribes to card transactions, cards, transfers, conversions and deposits", () => {
    for (const e of CARD_EVENTS) expect(ALL_EVENTS).toContain(e);
    for (const e of ["issuing.card.active", "issuing.card.inactive", "payout.transfer.paid", "payout.transfer.failed", "conversion.settled", "deposit.settled"]) expect(ALL_EVENTS).toContain(e);
    expect(new Set(ALL_EVENTS).size).toBe(ALL_EVENTS.length);
  });

  it("confirms a payout and a conversion Purser made, and flags ones it did not make", async () => {
    const { db } = await world();
    expect(send(db, "payout.transfer.paid", { id: "tr-ours", status: "PAID", transfer_amount: 1850, transfer_currency: "EUR" })).toMatch(/matches the ledger/);
    expect(send(db, "payout.transfer.sent", { id: "tr-other", status: "SENT", transfer_amount: 9000, transfer_currency: "EUR" })).toMatch(/a payout Purser did not make/);
    expect(send(db, "conversion.settled", { conversion_id: "cv-ours", status: "SETTLED", buy_amount: 370, buy_currency: "EUR" })).toMatch(/matches the ledger/);
    expect(send(db, "conversion.settled", { conversion_id: "cv-other", status: "SETTLED" })).toMatch(/a conversion Purser did not make/);
    expect(recorded(db)).toEqual([
      { name: "payout.transfer.paid", object: "transfer", object_id: "tr-ours", status: "PAID", agrees: 1 },
      { name: "payout.transfer.sent", object: "transfer", object_id: "tr-other", status: "SENT", agrees: 0 },
      { name: "conversion.settled", object: "conversion", object_id: "cv-ours", status: "SETTLED", agrees: 1 },
      { name: "conversion.settled", object: "conversion", object_id: "cv-other", status: "SETTLED", agrees: 0 },
    ]);
    expect(health(db, t0).alerts.map((a) => a.code)).toContain("airwallex_disagrees");
  });

  it("flags a payout Airwallex failed that the ledger has as paid, and accepts an earlier status arriving late", async () => {
    const { db } = await world();
    expect(send(db, "payout.transfer.processing", { id: "tr-ours", status: "PROCESSING" })).toMatch(/matches the ledger/);
    expect(send(db, "payout.transfer.failed", { id: "tr-ours", status: "FAILED" })).toMatch(/differs from the ledger \(PAID\)/);
  });

  it("flags a card that is live at Airwallex while Purser has it frozen, and not the other way round", async () => {
    const { db, awx } = await world();
    const card = awx.cards[0]!.cardId;
    expect(send(db, "issuing.card.active", { card_id: card, card_status: "ACTIVE" })).toMatch(/matches the policy/);
    db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('freeze', 'on', ?)").run(t0.toISOString());
    expect(send(db, "issuing.card.inactive", { card_id: card, card_status: "INACTIVE" })).toMatch(/matches the policy/);
    expect(send(db, "issuing.card.active", { card_id: card, card_status: "ACTIVE" })).toMatch(/live at Airwallex while the policy has it frozen/);
    expect(send(db, "issuing.card.active", { card_id: "card-of-no-agent", card_status: "ACTIVE" })).toMatch(/not one of Purser's cards/);
    expect(recorded(db).map((r) => (r as { agrees: number }).agrees)).toEqual([1, 1, 0, 0]);
  });

  it("hands a settled deposit into a known Global Account to the receivables agent, once", async () => {
    const { db } = await world();
    openReceivable(db, { invoice_no: "NW-R-101", customer: "Alpenweg Sport AG", currency: "EUR", amount_cents: 124_000, due_date: "2026-11-29" }, t0);
    const dep = { id: "dep-1", status: "SETTLED", amount: 1240, currency: "EUR", global_account_id: "ga-eur", reference: "Invoice NW-R-101", payer: { name: "Alpenweg Sport AG" } };
    // Before the receivables agent has named its Global Accounts, a deposit is only recorded.
    expect(send(db, "deposit.settled", dep)).toMatch(/recorded; not matched/);
    setKnownGlobalAccounts(db, ["ga-eur", "ga-gbp"], t0);
    expect(send(db, "deposit.settled", dep, "evt-dep")).toMatch(/MATCHED/);
    // Airwallex's retry of the same event is recorded once; another event for the same deposit books nothing twice.
    expect(send(db, "deposit.settled", dep, "evt-dep")).toMatch(/already recorded/);
    expect(send(db, "deposit.settled", dep)).toMatch(/MATCHED/);
    expect(send(db, "deposit.pending", { ...dep, status: "PENDING" })).toMatch(/recorded; not matched/);
    expect(send(db, "deposit.settled", { ...dep, id: "dep-2", global_account_id: "ga-someone-else" })).toMatch(/recorded; not matched/);
    expect(db.prepare("SELECT deposit_id, outcome FROM receipts").all()).toEqual([{ deposit_id: "dep-1", outcome: "MATCHED" }]);
    expect(db.prepare("SELECT status FROM receivables").get()).toEqual({ status: "PAID" });
  });

  it("records an event once, even when Airwallex sends it again, and records events it does not act on", async () => {
    const { db } = await world();
    send(db, "payout.transfer.paid", { id: "tr-ours", status: "PAID" }, "evt-same");
    expect(send(db, "payout.transfer.paid", { id: "tr-ours", status: "PAID" }, "evt-same")).toMatch(/already recorded/);
    expect(send(db, "account.active", { id: "acct" })).toMatch(/not an object Purser acts on/);
    expect(recorded(db).map((r) => (r as { object: string }).object)).toEqual(["transfer", "other"]);
  });

  it("never records an event whose signature does not hold", async () => {
    const { db } = await world();
    const body = JSON.stringify({ id: "evt-forged", name: "payout.transfer.paid", data: { object: { id: "tr-x", status: "PAID" } } });
    expect(handleAirwallexHook(db, { id: "evt-forged", ts, signature: sign(body, "not-the-secret"), body }, SECRET, t0)).toMatch(/bad signature/);
    expect(recorded(db)).toEqual([]);
  });

  it("summarises the events per object for the dashboard, disagreements first", async () => {
    const { db, awx } = await world();
    send(db, "payout.transfer.paid", { id: "tr-ours", status: "PAID" });
    send(db, "payout.transfer.sent", { id: "tr-other", status: "SENT" });
    send(db, "issuing.card.active", { card_id: awx.cards[0]!.cardId, card_status: "ACTIVE" });
    const v = airwallexEventsView(db);
    expect(v.total).toBe(3);
    expect(v.disagree).toBe(1);
    expect(v.by_object).toEqual(expect.arrayContaining([
      expect.objectContaining({ object: "transfer", n: 2, disagree: 1 }),
      expect.objectContaining({ object: "card", n: 1, disagree: 0 }),
    ]));
    expect(v.recent[0]).toMatchObject({ object_id: "tr-other", agrees: false });
  });
});

describe("the Airwallex rail on the dashboard", () => {
  it("says how many webhooks arrived and whether the ledger explained them all", async () => {
    const { railsView } = await import("../src/dashboard/rails.js");
    const { db } = await world();
    expect(railsView(db).airwallex.find((i) => /webhook/.test(i.what))).toBeUndefined();
    send(db, "payout.transfer.paid", { id: "tr-ours", status: "PAID" });
    send(db, "conversion.settled", { conversion_id: "cv-other", status: "SETTLED" });
    expect(railsView(db).airwallex.find((i) => /webhook/.test(i.what))).toMatchObject({ detail: expect.stringMatching(/^2 events on 2 kinds of object, .*; 1 the ledger could not explain, raised as an alarm$/) });
  });
});
