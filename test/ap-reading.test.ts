// Payables, part 2: reading a supplier invoice without a model (English, Dutch and German labels), and the check a
// model's reading must pass before it is used: its invoice number, total and IBAN must be in the document itself.
import { describe, expect, it } from "vitest";
import { ibanValid, parseApFallback, readingCheck, type ApReading } from "../src/ap/reading.js";
import { DE, EN, NL } from "./fakes/apInvoices.js";


describe("reading an invoice without a model", () => {
  it("reads an English invoice", () => {
    expect(parseApFallback(EN)).toEqual({
      vendor: "Bergtex Textil GmbH", vat_id: "DE123456789", invoice_no: "BTX-2026-21", issue_date: "2026-11-02", due_date: "2026-11-16",
      currency: "EUR", subtotal: "1554.62", tax: "295.38", total: "1850.00", iban: "DE89370400440532013000", bic: "COBADEFFXXX",
      account_number: "", routing_type: "", routing_value: "", bank_country: "DE",
      reference: "BTX-2026-21", gl_account: "",
    } satisfies ApReading);
  });

  it("reads a Dutch invoice", () => {
    expect(parseApFallback(NL)).toMatchObject({
      vendor: "Zeeland Verpakkingen B.V.", vat_id: "NL123456789B01", invoice_no: "ZV-4471", issue_date: "2026-11-03", due_date: "2026-11-17",
      currency: "EUR", subtotal: "400.00", tax: "84.00", total: "484.00", iban: "NL91ABNA0417164300", bic: "ABNANL2A", reference: "ZV-4471",
    });
  });

  it("reads a German invoice", () => {
    expect(parseApFallback(DE)).toMatchObject({
      vendor: "Lagerhaus Nord GmbH", vat_id: "DE987654321", invoice_no: "LN-2026-0815", issue_date: "2026-11-04", due_date: "2026-11-18",
      currency: "EUR", subtotal: "1000.00", tax: "190.00", total: "1190.00", iban: "DE02120300000000202051", bic: "BYLADEM1001",
    });
  });

  it("leaves a field empty when the document does not have it, and never throws", () => {
    const r = parseApFallback("Some Shop Ltd\nThank you for your order.");
    expect(r).toMatchObject({ vendor: "Some Shop Ltd", invoice_no: "", total: "", iban: "", due_date: "" });
    expect(parseApFallback("")).toMatchObject({ vendor: "", total: "" });
  });

  it("reads US dollars and pounds", () => {
    expect(parseApFallback("Acme Inc.\nInvoice #A-77\nTotal due $2,400.50")).toMatchObject({ invoice_no: "A-77", currency: "USD", total: "2400.50" });
    expect(parseApFallback("Bristol Supplies Ltd\nInvoice no: BS-9\nAmount due £99.00")).toMatchObject({ invoice_no: "BS-9", currency: "GBP", total: "99.00" });
  });
});

describe("IBAN checksum", () => {
  it("accepts valid IBANs and refuses a mistyped one", () => {
    expect(ibanValid("DE89370400440532013000")).toBe(true);
    expect(ibanValid("NL91ABNA0417164300")).toBe(true);
    expect(ibanValid("DE89370400440532013001")).toBe(false);
    expect(ibanValid("")).toBe(false);
  });
});

describe("the check a model's reading must pass", () => {
  const good = parseApFallback(EN);
  it("passes a reading whose number, total and IBAN are in the document", () => {
    expect(readingCheck(good, EN)).toBeNull();
  });
  it("refuses a total that is not in the document", () => {
    expect(readingCheck({ ...good, total: "18500.00" }, EN)).toMatch(/total/);
  });
  it("refuses an IBAN that is not in the document (a model that followed a planted instruction)", () => {
    expect(readingCheck({ ...good, iban: "GB29NWBK60161331926819" }, EN)).toMatch(/IBAN/);
  });
  it("refuses an invoice number that is not in the document", () => {
    expect(readingCheck({ ...good, invoice_no: "BTX-9999" }, EN)).toMatch(/invoice number/);
  });
  it("refuses a malformed total", () => {
    expect(readingCheck({ ...good, total: "1,850.00" }, EN)).toMatch(/total/);
  });
});
