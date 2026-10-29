import { describe, expect, it } from "vitest";
import { baseUnitsToCents, centsToBaseUnits, fromCents, toCents } from "../src/lib/money.js";

describe("money", () => {
  it("round-trips two-decimal strings", () => {
    for (const s of ["0.00", "0.01", "0.05", "12.85", "1850.00", "20000.00"]) expect(fromCents(toCents(s))).toBe(s);
  });
  it("refuses floats and loose formats", () => {
    for (const s of ["1", "1.5", "1.234", "-1.00", "01.00", " 1.00", "1e3"]) expect(() => toCents(s)).toThrow();
  });
  it("converts cents to *USDZ base units and back", () => {
    expect(centsToBaseUnits(5)).toBe(50_000_000_000_000_000n);
    expect(baseUnitsToCents(2_000_000_000_000_000_000n)).toBe(200);
    expect(() => baseUnitsToCents(1n)).toThrow(/sub-cent/);
  });
});
