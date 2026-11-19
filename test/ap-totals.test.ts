// Payables: an invoice's printed lines against its total (src/ap/lineTotals.ts, checked in src/ap/checkerCore.ts). Red
// team, 19 Nov: an invoice whose one line item says EUR 1,850.00 and whose total says EUR 8,150.00 was read by its total
// and sent to the CFO with nothing flagged. When the lines an invoice prints (with its VAT, shipping and discount lines)
// do not add up to its total within EUR 0.01, a person looks first (totals_mismatch, review). When the lines cannot be
// read reliably, nothing is said: no false holds.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { codeFindings, enforce, statusOf, type InvoiceCase, type SupplierOnFile } from "../src/ap/checkerCore.js";
import { lineTotals } from "../src/ap/lineTotals.js";
import { parseApFallback, type ApReading } from "../src/ap/reading.js";

const BERGTEX: SupplierOnFile = {
  id: "ben_bergtex", name: "Bergtex Textil GmbH", last4: "3000", bic: "COBADEFFXXX", currency: "EUR",
  bank: { country: "DE", currency: "EUR", accountName: "Bergtex Textil GmbH", iban: "DE89370400440532013000", swiftCode: "COBADEFFXXX" },
};

/** A case from an invoice's text, read by the parser: Bergtex on file, an agent that may pay EUR 10,000.00 alone. */
function caseOf(text: string, reading: Partial<ApReading> = {}): InvoiceCase {
  return {
    invoice: { id: null, reading: { ...parseApFallback(text), ...reading }, text, receivedAt: null, accountSha256: null },
    company: { name: "Northwind Outdoor (test)" },
    policy: { aloneLimit: { currency: "EUR", amount: "10000.00" }, cashFloors: { EUR: "25000.00" }, payees: { allowed: ["Bergtex Textil GmbH"], blocked: [] }, currencies: ["EUR"] },
    suppliers: [BERGTEX], history: [], alreadyInLedger: null, supplierRequest: null, clearedTwins: [], expected: null, today: "2026-11-08",
  };
}
const mismatch = (text: string, reading: Partial<ApReading> = {}) => codeFindings(caseOf(text, reading)).find((f) => f.code === "totals_mismatch");

/** An invoice in the runner's (and /try's) format: a header, its lines, a totals block, the bank details. */
function invoice(lines: string[], totals: string[]): string {
  return [
    "Bergtex Textil GmbH", "Textilweg 4, 72760 Reutlingen, Germany", "", "INVOICE BTX-2026-77", "Date: 2 November 2026", "Due date: 16 November 2026", "",
    "Bill to: Northwind Outdoor (test world)", "", `${"Description".padEnd(46)}Amount`, ...lines, "", ...totals, "",
    "Pay by SWIFT to:", "Account name: Bergtex Textil GmbH", "IBAN: DE89 3704 0044 0532 0130 00", "BIC: COBADEFFXXX", "Payment reference: BTX-2026-77",
  ].join("\n");
}
const row = (left: string, right: string) => `${left.padEnd(46)}${right}`;

/** The red team's invoice: one line of EUR 1,850.00, a total of EUR 8,150.00. */
const RED_TEAM = invoice([row("Down jackets, production lot November 2026", "EUR 1,850.00")], [row("Total due", "EUR 8,150.00")]);

describe("red team, 19 Nov: a line item that is not the total", () => {
  it("one line of EUR 1,850.00 under a total of EUR 8,150.00 is held for a person, with both amounts in plain words", () => {
    const c = caseOf(RED_TEAM);
    expect(c.invoice.reading.total).toBe("8150.00");
    const f = codeFindings(c);
    expect(f.find((x) => x.code === "totals_mismatch")).toEqual({
      code: "totals_mismatch", level: "review",
      detail: "the lines add up to EUR 1,850.00, the total says EUR 8,150.00; a person checks which amount is owed",
    });
    expect(statusOf(f)).toBe("needs_review");
    // Whatever the agent says, it is held: never paid alone, never only sent to the CFO.
    expect(enforce(c, { action: "ask_cfo", reason: "Within policy.", findings: [] }, f).outcome).toBe("hold");
    expect(enforce(c, { action: "pay", reason: "Within policy.", findings: [] }, f).outcome).toBe("hold");
  });

  it("the same invoice whose line says EUR 8,150.00 says nothing", () => {
    expect(mismatch(invoice([row("Down jackets, production lot November 2026", "EUR 8,150.00")], [row("Total due", "EUR 8,150.00")]))).toBeUndefined();
  });
});

describe("lines that add up say nothing", () => {
  it("the fixtures the runner files (one line, a line under its description, net lines with VAT, German amounts)", () => {
    for (const f of ["fixtures/bergtex-invoice-BTX-2026-11.txt", "fixtures/bergtex-invoice-BTX-2027-ANNUAL.txt", "fixtures/stockline-licence-SLL-2026-11B.txt",
      "fixtures/hard/bergtex-invoice-messy.txt", "fixtures/hard/bergtex-rechnung-de.txt"]) {
      expect(mismatch(readFileSync(f, "utf8")), f).toBeUndefined();
    }
  });

  it("net lines, a subtotal, two VAT rates, shipping and a discount", () => {
    const text = invoice(
      [row("Rain shells, 40 pcs", "EUR 1,000.00"), row("Repair kits, 10 pcs", "EUR 500.00")],
      [row("Subtotal", "EUR 1,500.00"), row("Shipping", "EUR 25.00"), row("Discount", "-EUR 50.00"), row("VAT 19%", "EUR 270.75"), row("VAT 7%", "EUR 0.00"), row("Total due", "EUR 1,745.75")],
    );
    expect(lineTotals(text, "1745.75")).toMatchObject({ lines: 150000 });
    expect(mismatch(text)).toBeUndefined();
  });

  it("gross lines with the VAT they include printed under the total", () => {
    const text = invoice([row("Rain shells, 40 pcs", "EUR 1,190.00")], [row("Total due", "EUR 1,190.00"), row("incl. VAT 19%", "EUR 190.00")]);
    expect(mismatch(text)).toBeUndefined();
  });

  it("a discount line among the items, and a quantity times a price", () => {
    const text = invoice([row("Rain shells, 2 x EUR 925.00", "EUR 1,850.00"), row("Loyalty discount", "-EUR 100.00")], [row("Total due", "EUR 1,750.00")]);
    expect(mismatch(text)).toBeUndefined();
  });

  it("rounding: lines a cent off the total say nothing", () => {
    const text = invoice([row("Part one", "EUR 33.33"), row("Part two", "EUR 33.33"), row("Part three", "EUR 33.33")], [row("Total due", "EUR 100.00")]);
    expect(mismatch(text)).toBeUndefined();
  });

  it("Dutch amounts and labels", () => {
    const text = ["Zeeland Verpakkingen B.V.", "Factuur", "Factuurnummer: ZV-4471", "Factuurdatum: 03-11-2026", "", "Omdozen 50x40x30, 180 stuks   € 300,00", "Verzendkosten   € 100,00", "",
      "Subtotaal € 400,00", "BTW 21% € 84,00", "Totaal te betalen € 484,00", "IBAN: NL91 ABNA 0417 1643 00"].join("\n");
    expect(mismatch(text)).toBeUndefined();
  });
});

describe("lines that do not add up are held", () => {
  it("two cents off is held", () => {
    const text = invoice([row("Part one", "EUR 33.33"), row("Part two", "EUR 33.33"), row("Part three", "EUR 33.32")], [row("Total due", "EUR 100.00")]);
    expect(mismatch(text)).toMatchObject({ level: "review", detail: "the lines add up to EUR 99.98, the total says EUR 100.00; a person checks which amount is owed" });
  });

  it("net lines whose VAT block adds up on its own but not to the lines: the lines with VAT are named", () => {
    const text = invoice(
      [row("Rain shells, 40 pcs", "EUR 1,000.00"), row("Repair kits, 10 pcs", "EUR 500.00")],
      [row("Subtotal", "EUR 2,500.00"), row("VAT 21%", "EUR 525.00"), row("Total due", "EUR 3,025.00")],
    );
    expect(mismatch(text)).toMatchObject({
      level: "review",
      detail: "the lines add up to EUR 1,500.00 (EUR 2,025.00 with the VAT, shipping and discount lines printed), the total says EUR 3,025.00; a person checks which amount is owed",
    });
  });

  it("Dutch amounts that do not add up", () => {
    const text = ["Zeeland Verpakkingen B.V.", "Factuur", "Factuurnummer: ZV-4472", "Factuurdatum: 03-11-2026", "", "Omdozen 50x40x30, 180 stuks   € 300,00", "",
      "Totaal te betalen € 3.000,00", "IBAN: NL91 ABNA 0417 1643 00"].join("\n");
    expect(mismatch(text)?.detail).toBe("the lines add up to EUR 300.00, the total says EUR 3,000.00; a person checks which amount is owed");
  });
});

describe("lines that cannot be read reliably say nothing (no false holds)", () => {
  it("no lines with amounts: only a total, or descriptions without amounts", () => {
    expect(mismatch(readFileSync("fixtures/bergtex-invoice-BTX-2026-12.txt", "utf8"))).toBeUndefined();
    expect(mismatch(invoice(["Rain shells, lot 2026-W46", "Repair of 12 zips"], [row("Total due", "EUR 8,150.00")]))).toBeUndefined();
  });

  it("a line whose amount is not written with two decimals", () => {
    expect(mismatch(invoice([row("Rain shells", "EUR 1,850.00"), row("Freight", "EUR 300")], [row("Total due", "EUR 2,150.00")]))).toBeUndefined();
    expect(mismatch(invoice([row("Rain shells", "EUR 1,850.00"), row("Freight", "300,- €")], [row("Total due", "EUR 2,150.00")]))).toBeUndefined();
  });

  it("an invoice that prints only some of its lines (continued, carried forward, a specification attached)", () => {
    expect(mismatch(invoice([row("Rain shells", "EUR 1,850.00"), "Further items: see the attached specification"], [row("Total due", "EUR 8,150.00")]))).toBeUndefined();
    expect(mismatch(invoice([row("Carried forward from page 1", "EUR 6,300.00"), row("Rain shells", "EUR 1,850.00")], [row("Total due", "EUR 8,150.00")]))).toBeUndefined();
    expect(mismatch(invoice([row("Rain shells", "EUR 1,850.00"), "continued on page 2"], [row("Total due", "EUR 8,150.00")]))).toBeUndefined();
  });

  it("a quantity times a price with one amount: the price of one or of all, not known", () => {
    expect(mismatch(invoice([row("Rain shells 40 x", "EUR 46.25")], [row("Total due", "EUR 1,850.00")]))).toBeUndefined();
  });

  it("a deposit or an amount already paid: what is due is not the lines", () => {
    expect(mismatch(invoice([row("Rain shells", "EUR 8,150.00"), row("Deposit received", "EUR 6,300.00")], [row("Total due", "EUR 1,850.00")]))).toBeUndefined();
  });

  it("a total the reading does not have, or more than one total (already held as ambiguous)", () => {
    expect(mismatch(RED_TEAM, { total: "" })).toBeUndefined();
    const two = invoice([row("Rain shells", "EUR 1,850.00")], [row("Total", "EUR 1,850.00"), row("Total due", "EUR 8,150.00")]);
    expect(codeFindings(caseOf(two)).map((f) => f.code)).toContain("ambiguous_total");
    expect(mismatch(two)).toBeUndefined();
  });
});

describe("the runner files the red team's invoice as the shared checks say", () => {
  it("a PDF with one line of EUR 1,850.00 and a total of EUR 8,150.00 waits for a person, with the finding", async () => {
    const { mkdtempSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { seedTreasury } = await import("../src/agents/euroBill.js");
    const { ingestDocument } = await import("../src/ap/inbox.js");
    const { apInvoice } = await import("../src/ap/store.js");
    const { openDb } = await import("../src/db/open.js");
    const { FakeAirwallex } = await import("./fakes/airwallex.js");
    const { pdfOf } = await import("./fakes/pdf.js");
    const dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "ap-totals-"));
    try {
      const db = openDb(":memory:");
      const awx = new FakeAirwallex();
      await seedTreasury(db, awx, awx);
      const reader = { ask: async (_a: unknown, fallback: () => unknown) => ({ value: fallback(), source: "fallback", model: null, note: "no key" }) } as never;
      const out = await ingestDocument(db, { dir, reader, now: () => new Date("2026-11-04T10:00:00Z") }, { bytes: await pdfOf(RED_TEAM), filename: "x.pdf", source: "upload" });
      if (out.kind !== "invoice") throw new Error(out.kind);
      const inv = apInvoice(db, out.invoice.id)!;
      expect(inv.status).toBe("needs_review");
      expect(inv.findings.find((f) => f.code === "totals_mismatch")).toMatchObject({ level: "review", detail: expect.stringContaining("the lines add up to EUR 1,850.00, the total says EUR 8,150.00") });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
