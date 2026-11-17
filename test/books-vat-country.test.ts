// Round 3 review (17 Nov): VAT a supplier abroad charged at 21% or 9% (Belgium, Spain, Czechia, Latvia, Lithuania
// charge 21%) matched the Dutch rate and was booked as Dutch input VAT (1510, box 5b), and sent to the ERP as NL21.
// The supplier's VAT id decides first: only a Dutch id, or none read, can be Dutch input VAT.
import { describe, expect, it } from "vitest";
import { accrualEntries, accrualVatCode, vatIdCountry } from "../src/ap/books.js";
import { apVat } from "../src/erp/source.js";
import type { ApInvoiceRow } from "../src/ap/store.js";

const row = (vatId: string, total = "1210.00", tax = "210.00", subtotal = "1000.00") => ({
  id: "AP-2", vendor: "Brouwerij Gent NV", invoice_no: "BE-77", issue_date: "2026-11-10", received_at: "2026-11-10T09:00:00Z", currency: "EUR",
  gl_account: "6100", doc_sha256: "x", coding: null, total, tax, subtotal, reading: { vat_id: vatId },
}) as unknown as ApInvoiceRow;
const accounts = (inv: ApInvoiceRow) => accrualEntries(inv).map((e) => `${e.account} ${e.debit || "-"}/${e.credit || "-"}`);

describe("VAT charged by a supplier abroad is never Dutch input VAT", () => {
  it("reads the country of a VAT id", () => {
    expect(vatIdCountry("BE0123456789")).toBe("BE");
    expect(vatIdCountry("nl 8123.45.678.B01".replace(/\./g, ""))).toBe("NL");
    expect(vatIdCountry("EL123456789")).toBe("GR");
    expect(vatIdCountry("")).toBeNull();
    expect(vatIdCountry("not a vat id")).toBeNull();
  });

  it("books a Belgian 21% to foreign VAT (1515), uncoded, and sends it to the ERP as no Dutch VAT", () => {
    const inv = row("BE0123456789");
    expect(accounts(inv)).toEqual(["6100 1000.00/-", "1515 210.00/-", "2100 -/1210.00"]);
    expect(accrualVatCode(100000, 21000, "BE0123456789")).toBeNull();
    expect(apVat(inv).code).toBe("NONE");
  });

  it("keeps a Dutch supplier's 21%, and one with no VAT id read, as Dutch input VAT", () => {
    for (const id of ["NL812345678B01", ""]) {
      const inv = row(id);
      expect(accounts(inv), id).toEqual(["6100 1000.00/-", "1510 210.00/-", "2100 -/1210.00"]);
      expect(accrualVatCode(100000, 21000, id), id).toBe("P21");
      expect(apVat(inv).code, id).toBe("NL21");
    }
  });

  it("still codes a German 19% as foreign (PF_DE19)", () => {
    expect(accrualVatCode(100000, 19000, "DE123456789")).toBe("PF_DE19");
    expect(accounts(row("DE123456789", "1190.00", "190.00", "1000.00"))).toEqual(["6100 1000.00/-", "1515 190.00/-", "2100 -/1190.00"]);
  });
});

describe("the Coder's coding of a supplier abroad", () => {
  it("never books a P21 line of a Belgian supplier as Dutch input VAT", () => {
    const inv = { ...row("BE0123456789"), coding: { total_cents: 121000, lines: [{ description: "beer", account: "6100", cost_centre: "OPS", vat_code: "P21", net_cents: 100000, vat_cents: 21000 }] } } as unknown as ApInvoiceRow;
    const es = accrualEntries(inv);
    expect(es.map((e) => `${e.account} ${e.debit || "-"}/${e.credit || "-"}`)).toEqual(["6100 1000.00/-", "1515 210.00/-", "2100 -/1210.00"]);
    expect(es.find((e) => e.account === "6100")?.vat_code).toBeUndefined();
  });
});
