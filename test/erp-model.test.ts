// The ERP connectors' canonical model (src/erp/model.ts): integer cents, balanced journal entries, invoices whose
// lines add up, and a content hash that changes when what an ERP would see changes, and only then.
import { describe, expect, it } from "vitest";
import { amount, contentHash, validateInvoice, validateJournal, validatePayment, validateVendor, type JournalEntry, type PurchaseInvoice, type Vendor } from "../src/erp/model.js";
import { sampleInvoice, sampleJournal, samplePayment, sampleVendor } from "./fakes/erp.js";

describe("the canonical ERP model", () => {
  it("accepts a well-formed vendor, invoice, payment and journal entry", () => {
    expect(validateVendor(sampleVendor())).toEqual([]);
    expect(validateInvoice(sampleInvoice())).toEqual([]);
    expect(validatePayment(samplePayment())).toEqual([]);
    expect(validateJournal(sampleJournal())).toEqual([]);
  });

  it("refuses amounts that are not whole cents", () => {
    const inv = sampleInvoice();
    inv.lines[0]!.netCents = 100.5;
    expect(validateInvoice(inv).join()).toMatch(/whole cents/);
  });

  it("refuses an invoice whose lines do not add up to its totals", () => {
    const inv = sampleInvoice();
    inv.totals.grossCents += 1;
    expect(validateInvoice(inv).join()).toMatch(/net plus VAT/);
    const inv2 = sampleInvoice();
    inv2.lines[0]!.vatCents += 1;
    expect(validateInvoice(inv2).join()).toMatch(/VAT of the lines/);
  });

  it("refuses an unbalanced journal entry, and a line that is both debit and credit", () => {
    const j: JournalEntry = sampleJournal();
    j.lines[0]!.debitCents += 1;
    expect(validateJournal(j).join()).toMatch(/does not balance/);
    const k = sampleJournal();
    k.lines[0]!.creditCents = 5;
    expect(validateJournal(k).join()).toMatch(/either a debit or a credit/);
  });

  it("refuses a vendor without a name, and a malformed currency or IBAN hash", () => {
    const v: Vendor = { ...sampleVendor(), name: " ", currency: "euro", ibanSha256: "xyz" };
    const errs = validateVendor(v).join();
    expect(errs).toMatch(/name/);
    expect(errs).toMatch(/currency/);
    expect(errs).toMatch(/IBAN hash/);
  });

  it("refuses a payment of zero and a date that is not YYYY-MM-DD", () => {
    expect(validatePayment({ ...samplePayment(), amountCents: 0 }).join()).toMatch(/more than zero/);
    expect(validatePayment({ ...samplePayment(), date: "8 Nov 2026" }).join()).toMatch(/date/);
  });

  it("writes cents as a two-decimal number for an ERP's JSON, exactly", () => {
    expect(amount(123456)).toBe(1234.56);
    expect(amount(-5)).toBe(-0.05);
    expect(amount(10)).toBe(0.1);
    expect(() => amount(1.5)).toThrow(/whole cents/);
  });

  it("hashes what an ERP would see: the PDF by its hash, never the full IBAN or the bytes", () => {
    const inv: PurchaseInvoice = sampleInvoice();
    const h = contentHash("invoice", inv);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    // The same content in another key order is the same hash.
    expect(contentHash("invoice", JSON.parse(JSON.stringify(inv)) as PurchaseInvoice)).toBe(h);
    // A changed amount is a different hash; the PDF bytes themselves do not count, its hash does.
    const changed = sampleInvoice();
    changed.lines[0]!.netCents += 100;
    changed.lines[0]!.vatCents += 21;
    changed.totals = { netCents: changed.totals.netCents + 100, vatCents: changed.totals.vatCents + 21, grossCents: changed.totals.grossCents + 121 };
    expect(contentHash("invoice", changed)).not.toBe(h);
    const otherBytes = { ...sampleInvoice(), pdf: { fileName: "BT-2026-0042.pdf", bytes: new Uint8Array([9, 9]) } };
    expect(contentHash("invoice", otherBytes)).toBe(h);
    const v = sampleVendor();
    expect(contentHash("vendor", { ...v, iban: "NL91ABNA0417164300" })).toBe(contentHash("vendor", { ...v, iban: "DE89370400440532013000" }));
  });
});
