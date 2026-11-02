// Max (2 November): the licence payment reserves the SWIFT fee from what Airwallex really charged plus a buffer, never
// less than the ceiling, so it never comes up short; tested with a fee higher than expected. Measured in the sandbox:
// EUR 13.41 to 13.48. Breaks if a higher measured fee does not raise the next reservation, or the reserve can drop under
// the ceiling the CFO's terms carry.
import { describe, expect, it } from "vitest";
import { openDb } from "../src/db/open.js";
import { SWIFT_FEE_MAX_EUR_CENTS } from "../src/config/policy.js";
import { feeReserveCents, planInvoice } from "../src/policy/treasury.js";
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
    const t = db.prepare("INSERT INTO transfers (transfer_id, request_id, invoice_no, amount, currency, method, fee_estimate, fee_actual, status, approval_sha256, updated_at) VALUES (?, ?, ?, '240.00', 'EUR', 'SWIFT', '20.00', ?, 'PAID', 'h', 'x')");
    t.run("t1", "r1", "X1", "EUR 13.47");
    t.run("t2", "r2", "X2", "EUR 25.00");
    t.run("t3", "r3", "X3", "USD 99.00");
    t.run("t4", "r4", "X4", null);
    expect(measuredSwiftFeesCents(db).sort((a, b) => a - b)).toEqual([1347, 2500]);
    expect(feeReserveCents(measuredSwiftFeesCents(db))).toBe(3125);
  });
});
