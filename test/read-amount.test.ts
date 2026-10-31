// A written amount, in the notations suppliers use, read into Purser's one form ("1850.00"). Anything that cannot be
// read whole is refused (null): a part of an amount must never pass as the amount (EUR 1.850,00 was once read as 1.85).
import { describe, expect, it } from "vitest";
import { readAmount } from "../src/lib/money.js";

describe("readAmount", () => {
  it("reads every common way of writing 1,850 euros as 1850.00", () => {
    for (const written of ["1.850,00", "1,850.00", "€1850", "1 850,00", "EUR 1.850", "1850", "1850.00", "1850,00", "EUR 1,850.00", "1.850,00 €", "€ 1 850.00", "1 850,00", "1 850,00", "1,850"]) {
      expect({ written, read: readAmount(written) }).toEqual({ written, read: "1850.00" });
    }
  });

  it("reads small amounts and cents", () => {
    expect(readAmount("0,04")).toBe("0.04");
    expect(readAmount("19.99")).toBe("19.99");
    expect(readAmount("EUR 240")).toBe("240.00");
    expect(readAmount("1.234.567,89")).toBe("1234567.89");
  });

  // Breaks if a malformed or ambiguous amount is read as some number instead of being refused.
  it("refuses what it cannot read whole", () => {
    for (const written of ["1,850.005", "1.85.0", "12,34,56", "1.8500", "abc", "", "1,8", "-5.00", "1850.0", "1 85", "1.850.00"]) {
      expect({ written, read: readAmount(written) }).toEqual({ written, read: null });
    }
  });
});
