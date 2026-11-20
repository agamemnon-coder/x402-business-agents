// What Purser refuses to send to any ERP (src/erp/model.ts validate*): each rule on a supplier, an invoice, a payment
// and a journal entry names what is wrong, a sound object passes, and amounts that are not whole cents stop the checks
// that would add them up. The old content hash differs from today's only for an invoice.
import { describe, expect, it } from "vitest";
import { amount, contentHash, contentHashBefore, validate, validateInvoice, validateJournal, validatePayment, validateVendor } from "../src/erp/model.js";
import { sampleInvoice, sampleJournal, samplePayment, sampleVendor } from "./fakes/erp.js";

describe("a supplier", () => {
  it("passes when sound", () => expect(validateVendor(sampleVendor())).toEqual([]));
  it("names each problem: no id, no name, a hidden character, the currency, the IBAN hash, the IBAN and the BIC", () => {
    expect(validateVendor({ ...sampleVendor(), id: "", name: "  ", vatId: "DE1‮23", currency: "eur", ibanSha256: "xyz", iban: "DE89 3704", bic: "COBA" })).toEqual([
      "vendor: no id",
      "vendor: no name",
      "vendor : the VAT number holds control or direction characters",
      "vendor : currency \"eur\" is not a three-letter code",
      "vendor : the IBAN hash is not SHA-256 hex",
      "vendor : the IBAN is malformed",
      "vendor : the BIC is malformed",
    ]);
  });
});

describe("an invoice", () => {
  it("passes when sound", () => expect(validateInvoice(sampleInvoice())).toEqual([]));
  it("names missing ids, bad dates, currency, document hash, no lines and totals that do not add up", () => {
    const inv = sampleInvoice();
    expect(validateInvoice({ ...inv, number: " ", issueDate: "2026-02-30", currency: "EURO", documentSha256: "nope", lines: [], totals: { netCents: 1, vatCents: 1, grossCents: 5 } })).toEqual([
      "invoice INV-1: id, vendor and number are required",
      "invoice INV-1: issue and due date must be YYYY-MM-DD",
      "invoice INV-1: currency \"EURO\" is not a three-letter code",
      "invoice INV-1: the document hash is not SHA-256 hex",
      "invoice INV-1: no lines",
      "invoice INV-1: the net of the lines (0) is not the net total (1)",
      "invoice INV-1: the VAT of the lines (0) is not the VAT total (1)",
      "invoice INV-1: net plus VAT is not the gross total",
    ]);
  });
  it("names a line without an account, an unknown VAT code and a hidden character in a description", () => {
    const inv = sampleInvoice();
    const lines = [{ ...inv.lines[0]!, glAccount: "", description: "Jackets​" }, { ...inv.lines[1]!, vatCode: "NL6" as never }];
    expect(validateInvoice({ ...inv, lines })).toEqual([
      "invoice INV-1: the description of line 1 holds control or direction characters",
      "invoice INV-1: line 1 has no GL account",
      "invoice INV-1: line 2 has an unknown VAT code \"NL6\"",
    ]);
  });
  it("stops at amounts that are not whole cents, before adding them up", () => {
    expect(validateInvoice({ ...sampleInvoice(), totals: { netCents: 120_000.5, vatCents: 22_800, grossCents: 142_800 } })).toEqual(["invoice INV-1: every amount must be whole cents"]);
  });
});

describe("a payment", () => {
  it("passes when sound", () => expect(validatePayment(samplePayment())).toEqual([]));
  it("names each problem", () => {
    expect(validatePayment({ ...samplePayment(), invoiceId: "", date: "20-11-2026", amountCents: 1.5, currency: "", bankAccount: "" })).toEqual([
      "payment PAY-1: id, invoice and vendor are required",
      "payment PAY-1: the date must be YYYY-MM-DD",
      "payment PAY-1: the amount must be whole cents",
      "payment PAY-1: currency \"\" is not a three-letter code",
      "payment PAY-1: no bank account",
    ]);
    expect(validatePayment({ ...samplePayment(), amountCents: 0 })).toEqual(["payment PAY-1: the amount must be more than zero"]);
  });
});

describe("a journal entry", () => {
  it("passes when sound", () => expect(validateJournal(sampleJournal())).toEqual([]));
  it("names each problem: no id, the date, the currency, one line only", () => {
    const j = sampleJournal();
    expect(validateJournal({ ...j, id: "", date: "2026-13-01", currency: "usd", lines: [j.lines[0]!] })).toEqual([
      "journal entry: no id",
      "journal entry : the date must be YYYY-MM-DD",
      "journal entry : currency \"usd\" is not a three-letter code",
      "journal entry : needs at least two lines",
      "journal entry  does not balance: debits 1342, credits 0",
    ]);
  });
  it("a line both debit and credit, or without an account; amounts not in whole cents stop the checks", () => {
    const j = sampleJournal();
    expect(validateJournal({ ...j, lines: [{ ...j.lines[0]!, glAccount: "", creditCents: 5 }, j.lines[1]!] })).toEqual([
      "journal entry JE-1: line 1 has no GL account",
      "journal entry JE-1: line 1 must be either a debit or a credit, above zero",
      "journal entry JE-1 does not balance: debits 1342, credits 1347",
    ]);
    expect(validateJournal({ ...j, lines: [{ ...j.lines[0]!, debitCents: 0.1 }, j.lines[1]!] })).toEqual(["journal entry JE-1: every amount must be whole cents"]);
  });
});

describe("validate, amounts and hashes", () => {
  it("validates by kind", () => {
    expect(validate("vendor", { ...sampleVendor(), id: "" })).toContain("vendor: no id");
    expect(validate("invoice", { ...sampleInvoice(), lines: [] })).toContain("invoice INV-1: no lines");
    expect(validate("payment", { ...samplePayment(), bankAccount: "" })).toEqual(["payment PAY-1: no bank account"]);
    expect(validate("journal", sampleJournal())).toEqual([]);
  });
  it("writes whole cents as two decimals and refuses anything else", () => {
    expect(amount(142_800)).toBe(1428);
    expect(amount(1)).toBe(0.01);
    expect(() => amount(0.5)).toThrow(/not whole cents/);
  });
  it("the old hash is today's for everything but an invoice, which also held whether a PDF went along", () => {
    expect(contentHashBefore("payment", samplePayment(), null)).toBe(contentHash("payment", samplePayment()));
    const inv = sampleInvoice();
    const withPdf = contentHashBefore("invoice", inv, { fileName: "a.pdf" });
    expect(withPdf).not.toBe(contentHash("invoice", inv));
    expect(withPdf).not.toBe(contentHashBefore("invoice", inv, null));
    expect(contentHash("vendor", sampleVendor())).toBe(contentHash("vendor", { ...sampleVendor(), iban: "XX00OTHER0000000" }));
  });
});
