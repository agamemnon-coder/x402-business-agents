// The transactions register: every rail appears, refused attempts never count as money moved, totals per currency,
// each reconciliation state constructed on purpose, the approval check, and the CSV export matching the list.
import { beforeEach, describe, expect, it } from "vitest";
import { openDb, type DB } from "../src/db/open.js";
import { postEntry } from "../src/ledger/core.js";
import { syncLedger } from "../src/ledger/feed.js";
import { filterRows, registerCsv, transactionRegister, type TxRow } from "../src/money/register.js";
import { moneyWorld as world } from "./fakes/moneyWorld.js";

const NOW = new Date("2026-11-09T10:00:00Z");
let db: DB;

const by = (rows: TxRow[], id: string) => rows.find((r) => r.id === id)!;

beforeEach(() => {
  db = openDb(":memory:");
  world(db);
});

describe("the transactions register", () => {
  it("lists every rail, refused and failed attempts included", () => {
    const { rows } = transactionRegister(db);
    expect(new Set(rows.map((r) => r.rail))).toEqual(new Set(["airwallex_transfer", "airwallex_fx", "airwallex_card", "airwallex_airi", "airwallex_receipt", "metal", "metal_clearing"]));
    expect(by(rows, "transfer:req-2")).toMatchObject({ moved: false, status_words: "failed: beneficiary rejected" });
    expect(by(rows, "card:ctx_2")).toMatchObject({ moved: false, status_words: "declined by Airwallex: merchant category not allowed" });
    expect(by(rows, "upstream:2")).toMatchObject({ moved: false, status_words: "refused: mandate_cap_exceeded" });
    expect(by(rows, "sale:2")).toMatchObject({ moved: false, status_words: "aborted, not charged" });
    expect(by(rows, "fx:conv_1:sell")).toMatchObject({ direction: "internal", amount: "100.00", currency: "EUR", eur_equivalent: "100.00" });
    expect(by(rows, "fx:conv_1:buy")).toMatchObject({ direction: "internal", amount: "110.00", currency: "USD", eur_equivalent: "100.00" });
    // The payee's account appears masked only.
    expect(by(rows, "transfer:req-1").counterparty_account).toBe("…3000");
    expect(JSON.stringify(rows)).not.toMatch(/DE\d{20}/);
    // Newest first.
    expect(rows.map((r) => r.at)).toEqual([...rows.map((r) => r.at)].sort().reverse());
  });

  it("never counts an attempt that did not move money, and totals per currency", () => {
    const { totals } = transactionRegister(db);
    const eur = totals.find((t) => t.currency === "EUR")!;
    // Out: two paid transfers (100 + 100) and one card charge (49); the failed transfer and the decline never count.
    expect(eur).toMatchObject({ in: "500.00", out: "261.00", internal_out: "100.00", fees: "12.50", moved: 6, not_moved: 2 });
    expect(totals.find((t) => t.currency === "USD")).toMatchObject({ internal_in: "110.02", internal_out: "0.00" });
    // Alta: 0.05 in, 0.03 paid out and 0.05 refunded; the refused purchase and the aborted sale count nowhere.
    expect(totals.find((t) => t.currency === "USDZ")).toMatchObject({ in: "0.05", out: "0.08", internal_in: "0.03", internal_out: "0.05", not_moved: 2 });
  });

  it("flags money that moved without the CFO's approval", () => {
    const r = transactionRegister(db);
    expect(by(r.rows, "transfer:req-1").approval).toMatchObject({ required: true, proposal_id: "P-1", decision: "APPROVED", method: "passkey" });
    expect(by(r.rows, "transfer:req-3").flags).toContain("no_approval");
    expect(r.check.without_approval).toEqual(["transfer:req-3"]);
    // A card charge needs no approval of its own: the card's limits carry it.
    expect(by(r.rows, "card:ctx_1").approval.required).toBe(false);
  });

  it("is unbooked until the ledger is synced, then matched to the cent", () => {
    const before = transactionRegister(db);
    expect(by(before.rows, "transfer:req-1").reconciliation).toBe("missing_booking");
    expect(before.check.without_booking.length).toBe(before.check.moved);
    syncLedger(db, NOW);
    const after = transactionRegister(db);
    // Every rail is matched once the feed has run, Airi purchases included (booked like a card charge).
    for (const r of after.rows.filter((x) => x.moved)) expect([r.id, r.reconciliation]).toEqual([r.id, "matched"]);
    expect(by(after.rows, "transfer:req-1").booking.booked).toBe("-112.50");
    expect(after.check).toMatchObject({ unreconciled: 0, without_booking: [], bookings_without_movement: [] });
    for (const r of after.rows.filter((x) => !x.moved)) expect(r.reconciliation).toBe("not_applicable");
  });

  it("says when a movement has no proof from its rail", () => {
    db.prepare("UPDATE transfers SET transfer_id = NULL WHERE request_id = 'req-1'").run();
    syncLedger(db, NOW);
    const row = by(transactionRegister(db).rows, "transfer:req-1");
    expect(row).toMatchObject({ reconciliation: "missing_rail_record" });
    expect(row.flags).toContain("no_proof");
  });

  it("says when the booking differs from the movement", () => {
    syncLedger(db, NOW);
    // The rail record changes after it was booked (an amount corrected at Airwallex), and the ledger has not caught up.
    db.prepare("UPDATE card_transactions SET amount_cents = 5900 WHERE transaction_id = 'ctx_1'").run();
    const r = transactionRegister(db);
    // The card's identity includes its amount, so the old posting no longer belongs to it: unbooked, and the old one is orphaned.
    expect(by(r.rows, "card:ctx_1").reconciliation).toBe("missing_booking");
    expect(r.check.bookings_without_movement.length).toBe(1);
    db.prepare("UPDATE card_transactions SET amount_cents = 4900 WHERE transaction_id = 'ctx_1'").run();
    db.prepare("UPDATE transfers SET amount = '90.00' WHERE request_id = 'req-1'").run();
    const t = by(transactionRegister(db).rows, "transfer:req-1");
    expect(t.reconciliation).toBe("amount_mismatch");
    expect(t.booking.booked).toBe("-112.50");
  });

  it("says when something is booked although nothing moved", () => {
    syncLedger(db, NOW);
    db.prepare("UPDATE transfers SET status = 'FAILED' WHERE request_id = 'req-1'").run();
    const r = transactionRegister(db);
    expect(by(r.rows, "transfer:req-1")).toMatchObject({ moved: false, reconciliation: "amount_mismatch", flags: ["booked_not_moved"] });
    expect(r.check.amount_mismatch).toContain("transfer:req-1");
  });

  it("ignores postings that are not the feed's, and filters", () => {
    postEntry(db, { date: "2026-11-01", description: "manual", created_by: "accountant", lines: [{ account: "1200", debit: 100, currency: "EUR" }, { account: "4000", credit: 100, currency: "EUR" }] }, NOW);
    const r = transactionRegister(db);
    expect(r.check.bookings_without_movement).toEqual([]);
    expect(filterRows(r.rows, { rail: "metal", moved: false }).map((x) => x.id).sort()).toEqual(["sale:2", "upstream:2"]);
    expect(filterRows(r.rows, { currency: "USD" }).map((x) => x.id).sort()).toEqual(["credit:ev1", "fx:conv_1:buy"]);
    expect(filterRows(r.rows, { from: "2026-11-06", to: "2026-11-06" }).map((x) => x.id).sort()).toEqual(["card:ctx_1", "card:ctx_2"]);
    expect(filterRows(r.rows, { q: "bergtex" }).length).toBe(3);
  });

  it("exports the same rows as CSV, one line each, formulas defused", () => {
    db.prepare("UPDATE card_transactions SET merchant = '=HYPERLINK(1)' WHERE transaction_id = 'ctx_2'").run();
    const { rows } = transactionRegister(db);
    const csv = registerCsv(rows).trimEnd().split("\r\n");
    expect(csv).toHaveLength(rows.length + 1);
    expect(csv[0]).toMatch(/^id,at,direction,rail,/);
    expect(csv.slice(1).map((l) => l.split(",")[0])).toEqual(rows.map((r) => r.id));
    expect(csv.find((l) => l.startsWith("card:ctx_2"))).toContain("'=HYPERLINK(1)");
  });
});
