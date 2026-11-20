// Two small checks on the paths the other files leave: a payment link read back with no reference is named as having
// none, beside every other difference from its invoice (src/airwallex/paymentLinks.ts linkDifferences); and Purser's fee
// with nothing set in the CFO policy is none (src/airwallex/binding.ts feeBpsOf).
import { describe, expect, it } from "vitest";
import { feeBpsOf } from "../src/airwallex/binding.js";
import { linkDifferences, toLink } from "../src/airwallex/paymentLinks.js";
import { openDb } from "../src/db/open.js";

describe("a payment link against its invoice", () => {
  it("with no reference, another amount and currency, and reusable: each named", () => {
    const l = toLink({ id: "pl_1", amount: "12.00", currency: "usd", reusable: true });
    expect(l).toMatchObject({ reference: null, url: "", status: "", active: false, invoiceNo: null, paidCount: 0 });
    expect(linkDifferences(l, { invoice_no: "NW-1", customer: "Ridgeline", currency: "EUR", amount_cents: 1000, due_date: "2026-11-30" })).toEqual([
      "amount 12.00 ≠ 10.00", "currency USD ≠ EUR", "reference none ≠ NW-1", "the link is reusable; one invoice is paid once",
    ]);
  });
});

describe("Purser's fee", () => {
  it("with nothing set in the CFO policy is none", () => {
    expect(feeBpsOf(openDb(":memory:"))).toBe(0);
  });
});
