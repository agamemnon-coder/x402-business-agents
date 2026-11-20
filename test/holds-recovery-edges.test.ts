// Holds on agent spend (src/policy/holds.ts), the paths the other files leave: a ledger from before the holds has none;
// a payer that is not one of Purser's agents is held to its mandate's cap alone; the let-through's hold is refused on a
// rewritten audit log; a card decline without a reason is recorded as Airwallex's decline; and on restart a card hold
// whose charge was declined, and a Metal hold whose refund was refused, are released, while nothing at all is recorded
// when there was nothing to recover. Test money only; no network.
import { describe, expect, it } from "vitest";
import { jcs, type Json } from "@metalntwx/metal-pay/mandates";
import { AUDIT_GUARDS } from "../src/audit/intact.js";
import { audit } from "../src/audit/log.js";
import { openDb, type DB } from "../src/db/open.js";
import type { CardTransaction } from "../src/airwallex/issuing.js";
import { chargeUnderHold, heldCents, holdBeyondCap, recoverHolds, reserveSpend } from "../src/policy/holds.js";

const now = new Date("2026-11-20T10:00:00Z");
const holdOf = (db: DB, ref: string) => db.prepare("SELECT status, reason FROM holds WHERE ref = ?").get(ref) as { status: string; reason: string | null } | undefined;

describe("holds", () => {
  it("a ledger from before the holds has none", () => {
    const db = openDb(":memory:");
    db.exec("DROP TABLE holds");
    expect(heldCents(db)).toBe(0);
  });

  it("a payer that is not one of Purser's agents is held to its mandate alone", () => {
    const db = openDb(":memory:");
    expect(reserveSpend(db, { agent: "task:T-1" as never, rail: "metal", cents: 3, ref: "x-1", now, payee: "supplier" })).toBeNull();
    expect(heldCents(db, "task:T-1")).toBe(3);
  });

  it("the let-through's hold is refused on an audit log that no longer verifies", () => {
    const db = openDb(":memory:");
    for (let i = 0; i < 2; i++) audit(db, "system", "x.note", `n${i}`, { i });
    const sqls = AUDIT_GUARDS.map((n) => (db.prepare("SELECT sql FROM sqlite_master WHERE name = ?").get(n) as { sql: string }).sql);
    for (const n of AUDIT_GUARDS) db.exec(`DROP TRIGGER ${n}`);
    db.prepare("UPDATE audit_log SET payload_json = ? WHERE seq = 2").run(jcs({ i: 9 } as Json));
    for (const s of sqls) db.exec(s);
    expect(holdBeyondCap(db, { agent: "sourcing", cents: 4, ref: "lt-1", payee: "supplier", now })).toMatch(/^ledger_tampered: the audit log does not verify at row 2/);
    expect(holdOf(db, "lt-1")).toBeUndefined();
  });

  it("a card decline without a reason is recorded as Airwallex's decline", async () => {
    const db = openDb(":memory:");
    const t = { approved: false, failureReason: null } as CardTransaction;
    await chargeUnderHold(db, "sourcing", 500, now, async () => t);
    expect(db.prepare("SELECT status, reason FROM holds").get()).toEqual({ status: "RELEASED", reason: "declined by Airwallex" });
  });
});

describe("on restart", () => {
  function held(db: DB, ref: string, agent: string, rail: string, cents: number) {
    db.prepare("INSERT INTO holds (ref, agent, rail, cents, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'HELD', ?, ?)").run(ref, agent, rail, cents, now.toISOString(), now.toISOString());
  }

  it("nothing to recover records nothing", () => {
    const db = openDb(":memory:");
    expect(recoverHolds(db, now)).toEqual({ settled: 0, released: 0, open: 0 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE event = 'holds.recovered'").get()).toEqual({ n: 0 });
  });

  it("a card hold whose charge was declined, and a Metal hold whose refund was refused, are released", () => {
    const db = openDb(":memory:");
    db.prepare("INSERT INTO cards (agent, cardholder_id, card_id, last4, nickname, currency, per_tx_cents, monthly_cents, status, synced_at, created_at) VALUES ('support', 'ch_1', 'card_1', '4242', 'support', 'EUR', 10000, 50000, 'ACTIVE', ?, ?)").run(now.toISOString(), now.toISOString());
    db.prepare("INSERT INTO card_transactions (transaction_id, card_id, agent, merchant, mcc, amount_cents, currency, status, approved, source, occurred_at, recorded_at) VALUES ('ctx_1', 'card_1', 'support', 'm', '5734', 900, 'EUR', 'DECLINED', 0, 'poll', ?, ?)").run(now.toISOString(), now.toISOString());
    held(db, "card:support:1", "support", "card", 900);
    db.prepare("INSERT INTO sales (sale_id, route, price_cents, payer, request_url, request_params_json, status, created_at) VALUES (1, '/stock', 5, '0xretailer', 'http://x', '{}', 'DELIVERED', ?)").run(now.toISOString());
    db.prepare("INSERT INTO refunds (refund_id, sale_id, payment_id, amount_cents, to_address, outcome) VALUES (1, 1, 'pay-r1', 5, '0xretailer', 'REFUSED')").run();
    held(db, "pay-r1", "support", "metal", 5);
    held(db, "pay-unknown", "support", "metal", 7);
    expect(recoverHolds(db, now)).toEqual({ settled: 0, released: 2, open: 1 });
    expect(holdOf(db, "card:support:1")).toEqual({ status: "RELEASED", reason: "declined (found on restart)" });
    expect(holdOf(db, "pay-r1")).toEqual({ status: "RELEASED", reason: "refused (found on restart)" });
    expect(holdOf(db, "pay-unknown")).toEqual({ status: "HELD", reason: null });
  });
});
