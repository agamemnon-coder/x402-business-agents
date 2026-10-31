// The deterministic invoice parser (src/agents/invoice.ts) reads only the layout it knows. Where it reads a line, the
// model's reading must agree with it (src/claude/tools.ts), so a misread line would overrule a correct model.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseInvoiceFallback } from "../src/agents/invoice.js";

const normal = readFileSync(new URL("../fixtures/bergtex-invoice-BTX-2026-11.txt", import.meta.url), "utf8");

describe("the invoice parser", () => {
  it("reads the known layout, with or without thousands separators", () => {
    expect(parseInvoiceFallback(normal)).toMatchObject({ amount: "1850.00", iban: "DE89370400440532013000" });
    expect(parseInvoiceFallback(normal.replace("Total due                                     EUR 1,850.00", "Total due EUR 18500.00")).amount).toBe("18500.00");
  });

  // Breaks if a total written the German way ("1.850,00") is read as 1.85: the parser must give up instead, so the
  // model's reading is checked by code alone, and no EUR 1.85 payment is proposed.
  it("refuses a total it cannot read whole, rather than read part of it", () => {
    for (const total of ["EUR 1.850,00", "EUR 1 850.00", "EUR 1,850.005", "EUR 1,85"]) {
      expect(() => parseInvoiceFallback(normal.replace("Total due                                     EUR 1,850.00", `Total due ${total}`))).toThrow(/no total/);
    }
  });
});
