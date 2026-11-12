// The vault's folder layout: the same names on every system, safe whatever a supplier writes on its invoice.
import { describe, expect, it } from "vitest";
import { correctionName, invoicePath, monthReportPath, paymentPath, quarterOf, safeSegment, suppliersPath, vatPath, yearIndexPath, yearReportPath } from "../src/vault/layout.js";

describe("safe names", () => {
  it("keeps ordinary names as they are", () => {
    expect(safeSegment("Bergtex Textil GmbH")).toBe("Bergtex Textil GmbH");
    expect(safeSegment("Zeeland Verpakkingen B.V.")).toBe("Zeeland Verpakkingen B.V");
  });

  it("removes path tricks, reserved characters and control characters", () => {
    expect(safeSegment("../../etc/passwd")).toBe("etc passwd");
    expect(safeSegment('A<b>c:d"e/f\\g|h?i*j')).toBe("A b c d e f g h i j");
    expect(safeSegment("Evil\u0000\u001f Corp\n")).toBe("Evil Corp");
    expect(safeSegment(" .hidden. ")).toBe("hidden");
    expect(safeSegment("CON")).toBe("_CON");
  });

  it("never returns an empty or overlong segment", () => {
    expect(safeSegment("////")).toBe("_");
    expect(safeSegment("x".repeat(300))).toHaveLength(120);
  });
});

describe("paths", () => {
  it("files an invoice under its quarter, supplier, date, number and amount", () => {
    expect(quarterOf("2026-11-02")).toBe("2026-Q4");
    expect(invoicePath("Northwind Outdoor", { vendor: "Bergtex Textil GmbH", invoice_no: "BTX-2026-21", date: "2026-11-02", currency: "EUR", total: "1850.00", blocked: false }))
      .toBe("Northwind Outdoor/2026/2026-Q4/Inkoopfacturen/Bergtex Textil GmbH/2026-11-02 BTX-2026-21 EUR 1850.00.pdf");
    expect(invoicePath("Northwind Outdoor", { vendor: "Evil/../Corp", invoice_no: "1/2", date: "2026-01-05", currency: "EUR", total: "9.99", blocked: true }))
      .toBe("Northwind Outdoor/2026/2026-Q1/Inkoopfacturen/_Geblokkeerd/Evil Corp/2026-01-05 1 2 EUR 9.99.pdf");
  });

  it("names payments, reports, the suppliers list and the index", () => {
    expect(paymentPath("N", { vendor: "Bergtex Textil GmbH", invoice_no: "BTX-2026-21", date: "2026-11-08" })).toBe("N/2026/2026-Q4/Betalingen/2026-11-08 Bergtex Textil GmbH BTX-2026-21.pdf");
    expect(monthReportPath("N", "2026-11")).toBe("N/2026/2026-Q4/Rapporten/2026-11 Maandrapport.pdf");
    expect(vatPath("N", "2026Q4")).toBe("N/2026/2026-Q4/Rapporten/2026-Q4 Btw-overzicht.pdf");
    expect(yearReportPath("N", 2026)).toBe("N/2026/2026 Jaarrapport.pdf");
    expect(suppliersPath("N", "2026-11-08")).toBe("N/2026/Leveranciers 2026-11-08.pdf");
    expect(yearIndexPath("N", 2026)).toBe("N/2026/index.json");
  });

  it("names a corrected document next to the original, never over it", () => {
    expect(correctionName("N/2026/2026 Jaarrapport.pdf", 1)).toBe("N/2026/2026 Jaarrapport (correctie).pdf");
    expect(correctionName("N/2026/2026 Jaarrapport.pdf", 2)).toBe("N/2026/2026 Jaarrapport (correctie 2).pdf");
  });
});
