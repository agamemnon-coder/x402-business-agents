// Max (2 November): the licence payment reserves the SWIFT fee from what Airwallex really charged plus a buffer, never
// less than the ceiling, so it never comes up short; tested with a fee higher than expected. Measured in the sandbox:
// EUR 13.41 to 13.48. Breaks if a higher measured fee does not raise the next reservation, or the reserve can drop under
// the ceiling the CFO's terms carry.
import { describe, expect, it } from "vitest";
import { openDb } from "../src/db/open.js";
import { SWIFT_FEE_MAX_EUR_CENTS } from "../src/config/policy.js";
import { feeReserveCents, feeReserveOverCap, planInvoice, SWIFT_FEE_RESERVE_CAP_CENTS } from "../src/policy/treasury.js";
import { measuredSwiftFeesCents } from "../src/agents/euroBill.js";

const state = { eurAvailableCents: 124_000, eurFloorCents: 0, eurObligationsCents: 0, usdAvailableCents: 1_000_000, usdFloorCents: 0 };

describe("the SWIFT fee reserve", () => {
  it("is the ceiling when nothing was measured, or every measured fee plus 25% fits under it", () => {
    expect(feeReserveCents([])).toBe(SWIFT_FEE_MAX_EUR_CENTS);
    expect(feeReserveCents([1341, 1347, 1348])).toBe(SWIFT_FEE_MAX_EUR_CENTS);
  });
  it("rises above the ceiling after a higher fee than expected: the highest measured plus 25%, rounded up", () => {
    expect(feeReserveCents([1347, 2130])).toBe(2663);
  });
  it("is what the plan reserves on top of the invoice", () => {
    expect(planInvoice(24_000, state, 2663)).toMatchObject({ kind: "pay_from_eur", needEurCents: 26_663 });
    expect(planInvoice(24_000, state)).toMatchObject({ needEurCents: 24_000 + SWIFT_FEE_MAX_EUR_CENTS });
  });
  it("reads the fees Airwallex really charged from the ledger (EUR only)", () => {
    const db = openDb(":memory:");
    db.pragma("foreign_keys = OFF");
    const t = db.prepare("INSERT INTO transfers (transfer_id, request_id, invoice_no, amount, currency, method, fee_estimate, fee_actual, status, approval_sha256, updated_at) VALUES (?, ?, ?, '240.00', 'EUR', 'SWIFT', '20.00', ?, ?, 'h', 'x')");
    t.run("t1", "r1", "X1", "EUR 13.47", "PAID");
    t.run("t2", "r2", "X2", "EUR 25.00", "PAID");
    t.run("t3", "r3", "X3", "USD 99.00", "PAID");
    t.run("t4", "r4", "X4", null, "PAID");
    t.run("t5", "r5", "X5", "EUR 13.5", "PAID");
    t.run("t6", "r6", "X6", "EUR 40.00", "FAILED");
    // review: only fees of PAID transfers count, and a malformed row is skipped instead of stopping every proposal
    expect(measuredSwiftFeesCents(db).sort((a, b) => a - b)).toEqual([1347, 2500]);
    expect(feeReserveCents(measuredSwiftFeesCents(db))).toBe(3125);
  });
  it("stops at three times the ceiling: above that, one recorded fee cannot raise every later reserve (review)", () => {
    expect(SWIFT_FEE_RESERVE_CAP_CENTS).toBe(3 * SWIFT_FEE_MAX_EUR_CENTS);
    expect(feeReserveCents([4800])).toBe(SWIFT_FEE_RESERVE_CAP_CENTS);
    expect(feeReserveCents([999_900])).toBe(SWIFT_FEE_RESERVE_CAP_CENTS);
    // and the plan then goes to a person instead (euroBill escalates): the reserve would not cover such a fee
    expect(feeReserveOverCap([4800])).toBe(false);
    expect(feeReserveOverCap([4801])).toBe(true);
  });
});

describe("the fee alarm (review: it must not weaken when the reserve rises)", () => {
  it("flags any EUR fee above the 20.00 policy ceiling, whatever reserve the terms carried, and any non-EUR fee", async () => {
    const { feeWithinCeiling } = await import("../src/executors/invoicePayment.js");
    expect(feeWithinCeiling({ currency: "EUR", cents: 1347 }, "20.00")).toBe(true);
    expect(feeWithinCeiling({ currency: "EUR", cents: 2600 }, "31.25")).toBe(false);
    expect(feeWithinCeiling({ currency: "EUR", cents: 2100 }, "26.63")).toBe(false);
    expect(feeWithinCeiling({ currency: "EUR", cents: 1900 }, "15.00")).toBe(false);
    expect(feeWithinCeiling({ currency: "USD", cents: 100 }, "20.00")).toBe(false);
  });
});
