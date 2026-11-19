// Reserving a payment (src/policy/holds.ts reserveSpend, holdBeyondCap): an amount that is not a positive whole number of
// cents, a ref held for another payment (or for the let-through or a record pull), a card purchase while the CFO's stop
// or a pause is on, a Metal payment over a mandate's cap for an agent that is not ours, and a second let-through hold
// under the same ref: each refused with its reason, and nothing held.
import { beforeEach, describe, expect, it } from "vitest";
import { openDb, type DB } from "../src/db/open.js";
import { setupCards } from "../src/policy/cards.js";
import { heldCents, holdBeyondCap, LET_THROUGH_HOLD, RECORD_PULL_HOLD, reserveSpend } from "../src/policy/holds.js";
import { FakeIssuing } from "../src/redteam/issuing.js";

const now = new Date("2026-11-03T10:00:00Z");
let db: DB;
const set = (key: string, value: string) => db.prepare("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value, now.toISOString());
const holds = () => db.prepare("SELECT ref, agent, cents, status, reason FROM holds ORDER BY ref").all();

beforeEach(async () => {
  db = openDb(":memory:");
  const awx = new FakeIssuing();
  awx.clock = () => now.getTime();
  await setupCards(db, awx, now);
});

describe("reserving a payment", () => {
  it("refuses an amount that is not a positive whole number of cents", () => {
    for (const cents of [0, -5, 1.5, Number.NaN]) expect(reserveSpend(db, { agent: "sourcing", rail: "card", cents, ref: "r", payee: "merchants", now })).toBe(`invalid_amount: ${cents}`);
    expect(holdBeyondCap(db, { agent: "sourcing", cents: 0, ref: "x", payee: "supplier", now })).toBe("invalid_amount: 0");
    expect(holds()).toEqual([]);
  });

  it("the same ref again is the same payment; for another amount or agent it is a conflict", () => {
    expect(reserveSpend(db, { agent: "sourcing", rail: "card", cents: 1999, ref: "card:1", payee: "merchants", now })).toBeNull();
    expect(reserveSpend(db, { agent: "sourcing", rail: "card", cents: 1999, ref: "card:1", payee: "merchants", now })).toBeNull();
    expect(reserveSpend(db, { agent: "sourcing", rail: "card", cents: 2000, ref: "card:1", payee: "merchants", now })).toBe("hold_conflict: card:1 is held for another payment");
    expect(reserveSpend(db, { agent: "support", rail: "card", cents: 1999, ref: "card:1", payee: "merchants", now })).toBe("hold_conflict: card:1 is held for another payment");
    expect(heldCents(db, "sourcing", "card")).toBe(1999);
  });

  it("a ref held for the let-through or a record pull never stands for a normal payment", () => {
    for (const [ref, reason] of [["lt:1", LET_THROUGH_HOLD], ["rp:1", RECORD_PULL_HOLD]] as const) {
      db.prepare("INSERT INTO holds (ref, agent, rail, cents, status, reason, created_at, updated_at) VALUES (?, 'sourcing', 'metal', 4, 'HELD', ?, ?, ?)").run(ref, reason, now.toISOString(), now.toISOString());
    }
    expect(reserveSpend(db, { agent: "sourcing", rail: "metal", cents: 4, ref: "lt:1", payee: "supplier", now })).toBe("hold_conflict: lt:1 is the let-through's hold");
    expect(reserveSpend(db, { agent: "sourcing", rail: "metal", cents: 4, ref: "rp:1", payee: "supplier", now })).toBe("hold_conflict: rp:1 is a record pull's hold");
    expect(holdBeyondCap(db, { agent: "sourcing", cents: 4, ref: "lt:1", payee: "supplier", now })).toBe("hold_conflict: lt:1 is already held");
  });

  it("a card purchase is refused while the CFO's stop or the agent's pause is on", () => {
    set("freeze", "on");
    expect(reserveSpend(db, { agent: "sourcing", rail: "card", cents: 100, ref: "c:1", payee: "merchants", now })).toMatch(/^frozen_by_cfo: the CFO stopped every agent payment \(emergency stop\); the sourcing agent buys nothing/);
    set("freeze", "off");
    set("pause.sourcing", "on");
    expect(reserveSpend(db, { agent: "sourcing", rail: "card", cents: 100, ref: "c:1", payee: "merchants", now })).toBe("paused_by_cfo: the sourcing agent is paused by the CFO; it buys nothing until the CFO resumes it with Face ID");
    expect(holds()).toEqual([]);
  });

  it("a released hold reserved again is a new attempt under the same ref", () => {
    expect(reserveSpend(db, { agent: "sourcing", rail: "card", cents: 500, ref: "c:2", payee: "merchants", now })).toBeNull();
    db.prepare("UPDATE holds SET status = 'RELEASED', reason = 'declined' WHERE ref = 'c:2'").run();
    expect(reserveSpend(db, { agent: "sourcing", rail: "card", cents: 700, ref: "c:2", payee: "merchants", now })).toBeNull();
    expect(holds()).toEqual([{ ref: "c:2", agent: "sourcing", cents: 700, status: "HELD", reason: null }]);
  });
});
