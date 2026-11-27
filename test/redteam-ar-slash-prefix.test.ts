// Red team, round 2 on v1.5.3 (finding C): a payment reference that names two receivable invoices, one of whose numbers
// is a "/"-prefix of the other ("NW/7, NW/7/2"), settled the longer one with no review: the shorter number was dropped as
// part of the longer even though the reference named it as a word of its own. Now a number is dropped only when every
// word that names it also names a longer number on file; otherwise the payment goes to a person. Test money only.
import { describe, expect, it } from "vitest";
import { openDb } from "../src/db/open.js";
import { arInvoice, issueInvoice, matchPayment } from "../src/receivables/ar.js";

const now = new Date("2026-11-27T10:00:00Z");

async function pay(nos: string[], reference: string) {
  const db = openDb(":memory:");
  for (const no of nos) await issueInvoice(db, { invoice_no: no, customer: `Customer ${no}`, currency: "EUR", net_cents: 100_000, vat_code: "S21", issue_date: "2026-11-20", due_date: "2026-12-04" }, null, now);
  const r = matchPayment(db, { payment_id: "d1", currency: "EUR", amount_cents: 121_000, reference, payer: "Customer A", received_at: now.toISOString() }, now);
  return { r, status: (no: string) => arInvoice(db, no)!.status };
}

describe("a reference naming an invoice and a longer one it prefixes (red team round 2, finding C)", () => {
  for (const [nos, ref] of [
    [["NW/7", "NW/7/2"], "NW/7 and NW/7/2"],
    [["NW/7", "NW/7/2"], "NW/7, NW/7/2"],
    [["NW-7", "NW-7/2"], "NW-7 NW-7/2"],
    [["NW/7", "NW/7/2"], "NW/7/2 NW/7"],
  ] as const) {
    it(`${JSON.stringify(ref)} goes to review, and neither invoice is settled`, async () => {
      const { r, status } = await pay([...nos], ref);
      expect(r.outcome).toBe("REVIEW");
      expect(r.invoice_no).toBeNull();
      expect(r.rule).toBe("reference");
      for (const no of nos) expect(status(no)).toBe("OPEN");
    });
  }

  it("the longer number alone, written whole or in the SWIFT form, still pays it", async () => {
    for (const ref of ["NW/7/2", "/INV/NW/7/2", "invoice NW/7/2 thanks"]) {
      const { r, status } = await pay(["NW/7", "NW/7/2"], ref);
      expect(r.outcome, ref).toBe("MATCHED");
      expect(r.invoice_no, ref).toBe("NW/7/2");
      expect(status("NW/7"), ref).toBe("OPEN");
    }
  });

  it("the shorter number alone pays it", async () => {
    const { r } = await pay(["NW/7", "NW/7/2"], "NW/7");
    expect(r.outcome).toBe("MATCHED");
    expect(r.invoice_no).toBe("NW/7");
  });
});
