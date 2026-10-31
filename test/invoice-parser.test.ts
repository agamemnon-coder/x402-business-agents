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

  // Breaks if a total written another way ("1.850,00", "1 850.00", "€1850") is read as anything but 1850.00, or a
  // malformed total is read at all: the parser must give up then, so code checks the model's reading alone.
  it("reads the total in every common notation, or not at all", () => {
    const line = "Total due                                     EUR 1,850.00";
    for (const total of ["EUR 1.850,00", "EUR 1 850.00", "€1850", "EUR 1.850", "1.850,00 €"]) {
      expect({ total, read: parseInvoiceFallback(normal.replace(line, `Total due ${total}`)).amount }).toEqual({ total, read: "1850.00" });
    }
    for (const total of ["EUR 1,850.005", "EUR 1.85.0", "EUR 12,34,56"]) {
      expect(() => parseInvoiceFallback(normal.replace(line, `Total due ${total}`))).toThrow(/total/);
    }
  });
});
