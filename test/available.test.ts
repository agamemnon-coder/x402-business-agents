import { describe, expect, it } from "vitest";
import { openDb } from "../src/db/open.js";
import { eurInFlightCents } from "../src/policy/available.js";
import { freeEurCents, planInvoice } from "../src/policy/treasury.js";

describe("euro payouts under way count as spoken for", () => {
  it("subtracts payouts written but not yet at Airwallex, except the one being checked", () => {
    const db = openDb(":memory:");
    for (const [no, rq, status] of [["A-1", "rq-a", "SUBMITTING"], ["B-1", "rq-b", "SUBMITTING"], ["C-1", "rq-c", "PAID"]] as const) {
      db.prepare("INSERT INTO invoices (invoice_no, vendor, amount, currency, due_date, iban_sha256, bic, doc_sha256, status) VALUES (?, 'Bergtex', '1000.00', 'EUR', '2026-11-30', 'h', 'b', 'd', 'APPROVED')").run(no);
      db.prepare("INSERT INTO transfers (request_id, invoice_no, amount, currency, method, fee_estimate, status, approval_sha256, updated_at) VALUES (?, ?, '1000.00', 'EUR', 'SWIFT', '20.00', ?, 'h', '2026-11-03T10:00:00Z')").run(rq, no, status);
    }
    expect(eurInFlightCents(db)).toBe(204_000);
    expect(eurInFlightCents(db, "rq-a")).toBe(102_000);
  });

  it("plans a second invoice against what the first one under way leaves free", () => {
    const s = { eurAvailableCents: 300_000, eurFloorCents: 50_000, eurObligationsCents: 0, usdAvailableCents: 0, usdFloorCents: 0 };
    expect(planInvoice(150_000, s).kind).toBe("pay_from_eur");
    const busy = { ...s, eurInFlightCents: 152_000 };
    expect(freeEurCents(busy)).toBe(98_000);
    expect(planInvoice(150_000, busy)).toMatchObject({ kind: "convert_shortfall", buyEurCents: 152_000 - 98_000 });
  });
});
