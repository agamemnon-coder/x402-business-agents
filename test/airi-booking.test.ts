// An Airi purchase that was paid is booked by the ledger feed like a card charge (default expense 6100 against the
// Airwallex account of its currency), once; one released or not yet settled books nothing. The transactions register
// then shows it booked and matched instead of missing_booking.
import { describe, expect, it } from "vitest";
import { journal } from "../src/accounting/gl.js";
import { openDb, type DB } from "../src/db/open.js";
import { syncLedger } from "../src/ledger/feed.js";
import { transactionRegister } from "../src/money/register.js";

const T0 = new Date("2026-11-08T10:00:00Z");
function purchase(db: DB, id: string, status: string, cents = 1200) {
  db.prepare("INSERT INTO airi_purchases (action_id, agent, route, order_sha256, terms_json, cents, day, status, mandate_id, checkout_ref, created_at, updated_at) VALUES (?, 'support', 'alone', 'x', ?, ?, '2026-11-08', ?, 'mdt-1', ?, ?, ?)")
    .run(id, JSON.stringify({ amount: (cents / 100).toFixed(2), currency: "EUR", merchant: { name: "Office Store", url: "https://shop.example", country: "NL" } }), cents, status, `order-${id}`, T0.toISOString(), T0.toISOString());
}
const airiRow = (db: DB, id: string) => transactionRegister(db).rows.find((r) => r.id === `airi:${id}`)!;

describe("Airi purchases in the books", () => {
  it("a settled one is booked once, as an expense against the Airwallex account, and the register matches it", () => {
    const db = openDb(":memory:");
    purchase(db, "a1", "SETTLED");
    const lines = journal(db).filter((l) => l.source === "airi");
    expect(lines).toMatchObject([{ ref: "a1", gl_account: "6100", bank_account: "1200", amount: "-12.00", currency: "EUR", counterparty: "Office Store" }]);
    expect(syncLedger(db, T0).posted).toBeGreaterThanOrEqual(1);
    expect(syncLedger(db, T0).posted).toBe(0);
    expect(airiRow(db, "a1")).toMatchObject({ moved: true, reconciliation: "matched" });
  });

  it("a released or unfinished one books nothing", () => {
    const db = openDb(":memory:");
    purchase(db, "r1", "RELEASED");
    purchase(db, "h1", "HELD");
    expect(journal(db).filter((l) => l.source === "airi")).toEqual([]);
  });
});
