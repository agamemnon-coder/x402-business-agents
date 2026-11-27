// The cloud's own check on the money loop snapshot (cloud/src/moneyLoop.ts), in depth behind the runner's minimisation
// (src/treasury/cloudSnapshot.ts): a field the runner fills from its own templates takes only those templates' shape,
// and the one field a payer writes (a payment's reference to review) refuses an IBAN-shaped or e-mail-shaped word.
// Breaks if the schema again accepts a name, a bank account or an address in a field the runner never writes one to
// (red team, 27 Nov: every free-text field was only bounded in length). Made-up people; test money.
import { describe, expect, it } from "vitest";
import { MoneyLoopSnapshot } from "../cloud/src/moneyLoop.js";
import { DEMO_MONEY_LOOP } from "../cloud/src/guest/moneyLoop.gen.js";

const base = () => ({
  generated_at: "2026-11-20T00:00:00Z", as_of: "2026-11-20", money: "test money (Airwallex sandbox)", cash: [],
  forecast: { opening_source: "the ledger's cash per currency", weeks: [], currencies: [], excluded: [{ ref: "NW-2026-140", currency: "EUR", cents: 100, why: "receivable due 2026-12-30, after week 13" }] },
  fx: { threshold_eur_cents: null, exposures: [], proposals: [] },
  receivables: { invoices: [], aged: [], payments: [], dunning: [],
    review: [{ payment_id: "dep_1", currency: "EUR", amount_cents: 100, reference: "Order 7781 November", reason: "no invoice named and no open invoice is open for exactly this amount", created_at: "2026-11-20T00:00:00Z" }] },
});
type Snap = ReturnType<typeof base>;
const ok = (f: (s: Snap) => void) => { const s = base(); f(s); return MoneyLoopSnapshot.safeParse(s).success; };

describe("the money loop snapshot's schema", () => {
  it("accepts what the runner writes, and the demo company's", () => {
    expect(ok(() => undefined)).toBe(true);
    expect(MoneyLoopSnapshot.safeParse(DEMO_MONEY_LOOP).success).toBe(true);
    for (const reason of ["the reference names NW-1077, which is not an invoice on file", "the reference names 2 invoices", "NW-1001 is already paid",
      "NW-1001 is invoiced in GBP, the payment is in EUR", "no invoice named and 2 open invoices are open for exactly this amount", "NW-1001 overpaid by EUR 50.00: a refund or a credit is the CFO's decision"]) {
      expect(ok((s) => { s.receivables.review[0]!.reason = reason; }), reason).toBe(true);
    }
    for (const why of ["payable due 2026-12-30, after week 13", "receivable 120 days overdue: doubtful, not counted"]) expect(ok((s) => { s.forecast.excluded[0]!.why = why; }), why).toBe(true);
    expect(ok((s) => { s.receivables.review[0]!.reference = "[name] [account] [e-mail] order 12"; })).toBe(true);
  });

  it("refuses a person's name, an account or an address in the fields the runner fills from templates (the red team's inputs)", () => {
    expect(ok((s) => { s.money = "Payer: John Q. Customer"; })).toBe(false);
    expect(ok((s) => { s.forecast.opening_source = "Jane Doe, IBAN DE89370400440532013000"; })).toBe(false);
    expect(ok((s) => { s.forecast.opening_source = "Jane Doe"; })).toBe(false);
    expect(ok((s) => { s.forecast.excluded[0]!.why = "waiting on Acme Ltd / Mr. Smith"; })).toBe(false);
    expect(ok((s) => { s.forecast.excluded[0]!.ref = "Jane Doe"; })).toBe(false);
    expect(ok((s) => { s.receivables.review[0]!.reason = "payer name mismatch: Bob Jones vs invoice"; })).toBe(false);
  });

  it("refuses an IBAN-shaped or e-mail-shaped word in a payment's reference", () => {
    expect(ok((s) => { s.receivables.review[0]!.reference = "from Maria Garcia IBAN GB29NWBK60161331926819"; })).toBe(false);
    expect(ok((s) => { s.receivables.review[0]!.reference = "from GB29 NWBK 6016 1331 9268 19"; })).toBe(false);
    expect(ok((s) => { s.receivables.review[0]!.reference = "order 12 maria.garcia@example.com"; })).toBe(false);
  });
});
