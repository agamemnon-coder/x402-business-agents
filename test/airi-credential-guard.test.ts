import { describe, expect, it } from "vitest";
import { openDb } from "../src/db/open.js";
import { credentialUseRefusal } from "../src/airi/credentialGuard.js";

function world() {
  const db = openDb(":memory:");
  const now = "2026-11-13T06:00:00.000Z";
  const add = (id: string, mandate: string, cents: number, status: string) =>
    db.prepare("INSERT INTO airi_purchases (action_id, agent, route, order_sha256, terms_json, cents, day, status, mandate_id, created_at, updated_at) VALUES (?, 'sourcing', 'alone', 'x', ?, ?, '2026-11-13', ?, ?, ?, ?)")
      .run(id, JSON.stringify({ amount: (cents / 100).toFixed(2), currency: "EUR" }), cents, status, mandate, now, now);
  add("A", "mdt_a", 1200, "SETTLED");
  add("B", "mdt_b", 4500, "WAITING_FOR_TAP");
  return db;
}

describe("Purser's credential check: one credential, one order, its amount, once", () => {
  it("lets the purchase's own credential pay its own amount once", () => {
    expect(credentialUseRefusal(world(), { mandateId: "mdt_b", actionId: "B", amount: "45.00", currency: "EUR" })).toBeNull();
  });
  it("refuses another amount (vic-3 F1), a second use (vic-3 F2), another purchase and an unknown mandate", () => {
    const db = world();
    expect(credentialUseRefusal(db, { mandateId: "mdt_a", amount: "40.00", currency: "EUR" })?.code).toBe("PURSER_CREDENTIAL_AMOUNT_MISMATCH");
    expect(credentialUseRefusal(db, { mandateId: "mdt_a", amount: "12.00", currency: "EUR" })?.code).toBe("PURSER_CREDENTIAL_ALREADY_USED");
    expect(credentialUseRefusal(db, { mandateId: "mdt_a", actionId: "B", amount: "45.00", currency: "EUR" })?.code).toBe("PURSER_CREDENTIAL_OTHER_PURCHASE");
    expect(credentialUseRefusal(db, { mandateId: "mdt_x", amount: "1.00", currency: "EUR" })?.code).toBe("PURSER_CREDENTIAL_UNKNOWN_MANDATE");
  });
});
