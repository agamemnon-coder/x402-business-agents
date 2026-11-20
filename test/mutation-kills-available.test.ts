// Mutation testing, 20 November (docs/evidence/mutation-testing.md, group available): the gaps the mutants of
// src/policy/available.ts showed. Its importers check the euro payouts under way and the dashboard's totals, but no test
// that imports it read what each agent's mandate paid, had pending and held, a buyer's charges with no sale behind them,
// the list of payments that explains a difference with the chain, or a card's month. Breaks if an agent's paid, pending
// or held money is counted under another agent or another state, if a settlement whose sale is recorded counts twice, if
// a ledger from before clearing (no scheme column) or before the settlements is read wrongly, if a card counts another
// month, another agent or a declined charge, or if a payout or a payment's own hold is left out of the euros under way.
import { describe, expect, it } from "vitest";
import { audit } from "../src/audit/log.js";
import { openDb, type DB } from "../src/db/open.js";
import { cardAvailability, eurInFlightCents, mandateAvailability, mandatePayments } from "../src/policy/available.js";
import { holdPayout } from "../src/policy/payoutLock.js";

const NOW = new Date("2026-11-20T10:00:00Z");
const NONCE = `0x${"ab".repeat(32)}`;

function ledger(): DB {
  const db = openDb(":memory:");
  db.pragma("foreign_keys = OFF");
  return db;
}
const bind = (db: DB, agent: string, budget: string) => audit(db, "system", "mandate.bound", agent, { cap: "50.00", budget }, NOW);
const hold = (db: DB, ref: string, agent: string, cents: number, status = "HELD", rail = "metal") =>
  db.prepare("INSERT INTO holds (ref, agent, rail, cents, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(ref, agent, rail, cents, status, `2026-11-20T09:0${ref.length % 10}:00Z`, NOW.toISOString());
const sale = (db: DB, id: number, cents: number, status = "DELIVERED", scheme = "exact", settlement: string | null = null, tx: string | null = null) =>
  db.prepare("INSERT INTO sales (sale_id, route, price_cents, payer, settlement_id, tx_hash, request_url, request_params_json, status, created_at, scheme) VALUES (?, '/r', ?, '0xp', ?, ?, '/r', '{}', ?, ?, ?)")
    .run(id, cents, settlement, tx, status, NOW.toISOString(), scheme);
const settlement = (db: DB, key: string, nonce: string, cents: number, status: string, detail: string | null = null, tx: string | null = null) =>
  db.prepare("INSERT INTO sale_settlements (key, payer, nonce, price_cents, status, tx_hash, detail, started_at, updated_at) VALUES (?, '0xp', ?, ?, ?, ?, ?, ?, ?)")
    .run(key, nonce, cents, status, tx, detail, "2026-11-20T09:00:00Z", NOW.toISOString());

describe("what each agent's mandate paid, has pending and holds", () => {
  it("sourcing: PAID purchases only, and its Metal holds", () => {
    const db = ledger();
    bind(db, "sourcing", "100.00");
    const p = db.prepare("INSERT INTO upstream_purchases (id, price_cents, nonce, tx_hash, outcome, created_at) VALUES (?, ?, ?, ?, ?, 'x')");
    p.run(1, 300, NONCE.toUpperCase(), "0xAA", "PAID");
    p.run(2, 200, null, null, "IN_DOUBT");
    p.run(3, 900, null, null, "REFUSED");
    hold(db, "h-1", "sourcing", 150);
    hold(db, "h-22", "sourcing", 50, "RELEASED");
    hold(db, "h-333", "support", 70);
    hold(db, "h-4444", "sourcing", 60, "HELD", "card");
    expect(mandateAvailability(db, "sourcing")).toEqual({ budgetCents: 10_000, paidCents: 300, pendingCents: 0, heldCents: 150, availableCents: 10_000 - 300 - 150 });
    expect(mandatePayments(db, "sourcing")).toEqual([
      { what: "purchase 1", cents: 300, tx: "0xaa", nonce: NONCE, state: "paid" },
      { what: "purchase 2", cents: 200, tx: null, nonce: null, state: "in_doubt" },
      { what: "the hold h-1", cents: 150, tx: null, nonce: null, state: "held", since: "2026-11-20T09:03:00Z" },
    ]);
  });

  it("support: PAID refunds paid, PENDING and HELD pending", () => {
    const db = ledger();
    bind(db, "support", "20.00");
    const r = db.prepare("INSERT INTO refunds (refund_id, sale_id, payment_id, amount_cents, to_address, outcome, tx_hash) VALUES (?, ?, ?, ?, '0xb', ?, ?)");
    r.run(1, 11, "refund-1", 100, "PAID", "0xT1");
    r.run(2, 12, "refund-2", 40, "PENDING", null);
    r.run(3, 13, "refund-3", 20, "HELD", null);
    r.run(4, 14, "refund-4", 999, "REFUSED", null);
    r.run(5, 15, "refund-5", 999, "PROPOSED", null);
    expect(mandateAvailability(db, "support")).toEqual({ budgetCents: 2_000, paidCents: 100, pendingCents: 60, heldCents: 0, availableCents: 1_840 });
    expect(mandatePayments(db, "support")).toEqual([
      { what: "refund-1 (refund of sale 11)", cents: 100, tx: "0xt1", nonce: null, state: "paid" },
      { what: "refund-2 (refund of sale 12)", cents: 40, tx: null, nonce: null, state: "pending" },
      { what: "refund-3 (refund of sale 13)", cents: 20, tx: null, nonce: null, state: "pending" },
    ]);
  });

  it("treasury: PAID sweeps paid, PENDING and HELD pending, in the order they were made", () => {
    const db = ledger();
    const s = db.prepare("INSERT INTO sweeps (payment_id, amount_cents, tx_hash, outcome, created_at) VALUES (?, ?, ?, ?, ?)");
    s.run("sweep-b", 500, "", "PAID", "2026-11-02T00:00:00Z");
    s.run("sweep-a", 70, null, "PENDING", "2026-11-01T00:00:00Z");
    s.run("sweep-c", 30, null, "HELD", "2026-11-03T00:00:00Z");
    s.run("sweep-d", 999, null, "PLANNED", "2026-11-04T00:00:00Z");
    // No mandate bound: no budget, so nothing to make available.
    expect(mandateAvailability(db, "treasury")).toEqual({ budgetCents: null, paidCents: 500, pendingCents: 100, heldCents: 0, availableCents: null });
    expect(mandatePayments(db, "treasury")).toEqual([
      { what: "sweep-a", cents: 70, tx: null, nonce: null, state: "pending" },
      { what: "sweep-b", cents: 500, tx: null, nonce: null, state: "paid" },
      { what: "sweep-c", cents: 30, tx: null, nonce: null, state: "pending" },
    ]);
  });

  it("an agent with no mandate route counts nothing, and a budget of zero leaves nothing", () => {
    const db = ledger();
    bind(db, "other", "0.00");
    expect(mandateAvailability(db, "other")).toEqual({ budgetCents: 0, paidCents: 0, pendingCents: 0, heldCents: 0, availableCents: 0 });
    expect(mandatePayments(db, "other")).toEqual([]);
  });
});

describe("the buyer's mandate (customer)", () => {
  it("counts delivered sales on the mandate route, charges with no sale, and settlements under way; a recorded sale once", () => {
    const db = ledger();
    bind(db, "customer", "10.00");
    sale(db, 1, 100, "DELIVERED", "exact", `0xpayer:${NONCE}`, "0xTX1");
    sale(db, 2, 200, "DELIVERED", "bajillion"); // paid from the clearing deposit, not under the mandate
    sale(db, 3, 400, "ABORTED_NO_CHARGE");
    sale(db, 4, 50, "DELIVERED", "exact", "not-a-nonce");
    const other = `0x${"cd".repeat(32)}`;
    settlement(db, "0xpayer1234567890:a", other, 30, "CHARGED", "found by the reconciliation", "0xTX2");
    settlement(db, "0xpayer:b", `0x${"ef".repeat(32)}`, 20, "SETTLING");
    settlement(db, "0xpayer:c", NONCE, 100, "CHARGED"); // its sale (1) is recorded: counted once, as the sale
    settlement(db, "0xpayer:d", `0x${"12".repeat(32)}`, 10, "FAILED", "expired");
    settlement(db, "0xpayer:e", `0x${"34".repeat(32)}`, 99, "DONE");
    expect(mandateAvailability(db, "customer")).toEqual({ budgetCents: 1_000, paidCents: 100 + 50 + 30, pendingCents: 20, heldCents: 0, availableCents: 1_000 - 180 - 20 });
    expect(mandatePayments(db, "customer")).toEqual([
      { what: "sale 1", cents: 100, tx: "0xtx1", nonce: NONCE, state: "paid" },
      { what: "sale 4", cents: 50, tx: null, nonce: null, state: "paid" },
      { what: "a payment by 0xpayer123… charged with no delivery recorded", cents: 30, tx: "0xtx2", nonce: other, state: "paid", detail: "found by the reconciliation" },
      { what: "a sale being settled (paid by 0xpayer…)", cents: 20, tx: null, nonce: `0x${"ef".repeat(32)}`, state: "pending", detail: undefined, since: "2026-11-20T09:00:00Z" },
      { what: "a sale being settled (paid by 0xpayer…)", cents: 10, tx: null, nonce: `0x${"12".repeat(32)}`, state: "failed", detail: "expired", since: "2026-11-20T09:00:00Z" },
    ]);
  });

  it("reads a ledger from before clearing (no scheme column) and before the settlements: every delivered sale was the mandate's", () => {
    const db = ledger();
    db.exec("ALTER TABLE sales DROP COLUMN scheme; DROP TABLE sale_settlements");
    db.prepare("INSERT INTO sales (sale_id, route, price_cents, payer, request_url, request_params_json, status, created_at) VALUES (1, '/r', 120, '0xp', '/r', '{}', 'DELIVERED', 'x')").run();
    db.prepare("INSERT INTO sales (sale_id, route, price_cents, payer, request_url, request_params_json, status, created_at) VALUES (2, '/r', 80, '0xp', '/r', '{}', 'SETTLE_FAILED', 'x')").run();
    expect(mandateAvailability(db, "customer")).toMatchObject({ paidCents: 120, pendingCents: 0 });
    expect(mandatePayments(db, "customer")).toEqual([{ what: "sale 1", cents: 120, tx: null, nonce: null, state: "paid" }]);
  });

  it("lists no holds on a ledger from before the holds", () => {
    const db = ledger();
    db.exec("DROP TABLE holds");
    expect(mandatePayments(db, "sourcing")).toEqual([]);
  });
});

describe("a card's month", () => {
  it("counts this agent's approved charges in this calendar month (UTC) and its card holds", () => {
    const db = ledger();
    const t = db.prepare("INSERT INTO card_transactions (transaction_id, card_id, agent, merchant, amount_cents, currency, status, approved, source, occurred_at, recorded_at) VALUES (?, 'c', ?, 'm', ?, 'EUR', 's', ?, 'poll', ?, 'x')");
    t.run("t1", "sourcing", 1_000, 1, "2026-11-01T00:00:00Z");
    t.run("t2", "sourcing", 2_000, 1, "2026-11-30T23:59:59Z");
    t.run("t3", "sourcing", 4_000, 0, "2026-11-10T00:00:00Z"); // declined
    t.run("t4", "sourcing", 8_000, 1, "2026-10-31T23:59:59Z"); // last month
    t.run("t5", "support", 16_000, 1, "2026-11-10T00:00:00Z"); // another agent
    hold(db, "card-1", "sourcing", 300, "HELD", "card");
    hold(db, "metal-1", "sourcing", 600, "HELD", "metal");
    const c = cardAvailability(db, "sourcing", NOW);
    expect(c.spentCents).toBe(3_000);
    expect(c.heldCents).toBe(300);
    expect(c.availableCents).toBe(c.monthlyCents - 3_300);
  });
});

describe("euros under way", () => {
  it("counts SUBMITTING euro payouts with their fee, payments' euro holds and fees owed, leaving out the one being judged", () => {
    const db = ledger();
    const t = db.prepare("INSERT INTO transfers (request_id, invoice_no, amount, currency, method, fee_estimate, status, approval_sha256, updated_at) VALUES (?, ?, ?, ?, 'SWIFT', '20.00', ?, 'h', 'x')");
    t.run("rq-a", "A", "100.00", "EUR", "SUBMITTING");
    t.run("rq-b", "B", "200.00", "EUR", "SUBMITTING");
    t.run("rq-c", "C", "400.00", "USD", "SUBMITTING");
    t.run("rq-d", "D", "800.00", "EUR", "SENT");
    holdPayout(db, "P-0001", "rq-x", "EUR", 1_000);
    holdPayout(db, "P-0002", "rq-y", "EUR", 50);
    db.prepare("INSERT INTO platform_fees (request_id, proposal_id, payout_request_id, amount, currency, destination, status, approval_sha256, updated_at) VALUES ('f', 'P-0003', 'rq-a', '1.00', 'EUR', 'acct', 'DUE', 'h', 'x')").run();
    expect(eurInFlightCents(db)).toBe(12_000 + 22_000 + 1_000 + 50 + 100);
    expect(eurInFlightCents(db, "rq-b")).toBe(12_000 + 1_000 + 50 + 100);
    expect(eurInFlightCents(db, undefined, "P-0001")).toBe(12_000 + 22_000 + 50 + 100);
    expect(eurInFlightCents(db, undefined, "P-0003")).toBe(12_000 + 22_000 + 1_000 + 50);
  });

  it("is zero on a ledger with no payouts table", () => {
    const db = ledger();
    db.exec("DROP TABLE transfers");
    expect(eurInFlightCents(db)).toBe(0);
  });
});
