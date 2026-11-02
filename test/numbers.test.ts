// How a typed number is read (src/lib/numbers.ts), the one reader for every place a person types an amount or a count:
// the Try page, Ask Purser, the policy in plain words and invoices. Red team, 2 November: "2.500 SKUs" became 3 stock
// checks on Try, and "0.0400 EUR" or "€2.5" were read 100 or 10 times too large. Dutch and English notation are both
// read; where the field decides, the field decides; what stays ambiguous is refused with a reason, never rounded.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { fromCents, readAmount } from "../src/lib/money.js";
import { moneyIn, readNumber, type NumberReading } from "../src/lib/numbers.js";

const value = (r: NumberReading) => (r.ok ? r.value : `refused: ${r.why}`);

describe("reading Dutch and English notation", () => {
  it("reads every notation Max listed, as money in cents", () => {
    const cases: [string, number][] = [
      ["2.500", 250_000], ["2,50", 250], ["1.850,00", 185_000], ["€2.500", 250_000],
      ["2,500", 250_000], ["2.50", 250], ["1,850.00", 185_000],
      ["€ 2.500", 250_000], ["2.500 EUR", 250_000], ["EUR 1.850,00", 185_000], ["$2.50", 250], ["1.234.567,89", 123_456_789], ["1,234,567.89", 123_456_789],
      ["2.5", 250], ["2,5", 250], ["0.04", 4], ["0,04", 4], ["0.0400", 4], ["49,99", 4_999], ["1.050,00", 105_000], ["400.00", 40_000], ["250", 25_000],
    ];
    for (const [written, cents] of cases) expect({ written, read: value(readNumber(written, "money")) }).toEqual({ written, read: cents });
  });

  it("reads a count as a whole number: a dot or comma before three digits groups thousands", () => {
    const cases: [string, number][] = [["2.500", 2_500], ["2,500", 2_500], ["1.850,00", 1_850], ["1,850.00", 1_850], ["25", 25], ["1.000.000", 1_000_000], ["3", 3]];
    for (const [written, n] of cases) expect({ written, read: value(readNumber(written, "count")) }).toEqual({ written, read: n });
  });
});

describe("what stays ambiguous or would need rounding is refused, with the reason", () => {
  it("refuses a count that is not whole", () => {
    for (const written of ["2,5", "2.50", "1.5", "0,5"]) {
      const r = readNumber(written, "count");
      expect({ written, ok: r.ok }).toEqual({ written, ok: false });
      if (!r.ok) expect(r.why).toMatch(/whole number/);
    }
  });

  it("refuses money with more decimals than cents rather than rounding it", () => {
    for (const written of ["0.045", "1,0005", "1.850,005", "2.5555"]) {
      const r = readNumber(written, "money");
      expect({ written, ok: r.ok }).toEqual({ written, ok: false });
      if (!r.ok) expect(r.why).toMatch(/round/);
    }
  });

  it("refuses dots and commas that are not thousands groups", () => {
    for (const written of ["1.85.0", "12,34,56", "1.850.00", "1,2.5", "1.000,000,00"]) expect({ written, ok: readNumber(written, "money").ok }).toEqual({ written, ok: false });
  });

  // "2.500" with no currency, in a message that writes "0.04" with a decimal point: 2.50 and 2,500.00 are both plausible.
  it("refuses a bare 2.500 as money when the same message uses that mark as a decimal point", () => {
    const r = readNumber("2.500", "money", { decimalMarksElsewhere: new Set(["."]) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.why).toMatch(/2\.50 or 2,500\.00/);
    // The other mark does not make it ambiguous; a currency sign does not leave it ambiguous (money has two decimals at most).
    expect(value(readNumber("2.500", "money", { decimalMarksElsewhere: new Set([","]) }))).toBe(250_000);
    expect(value(readNumber("€2.500", "money", { decimalMarksElsewhere: new Set(["."]) }))).toBe(250_000);
    // A count is a whole number, so the 2.5 reading is impossible: "2.500 checks" is 2,500 whatever else is written.
    expect(value(readNumber("2.500", "count", { decimalMarksElsewhere: new Set(["."]) }))).toBe(2_500);
  });

  it("reads each number of a message in its context", () => {
    const found = moneyIn("Stock checks at 0.04 each, budget 2.500, or €1.050 at most");
    expect(found.map((m) => [m.raw, m.currency, value(m.reading)])).toEqual([
      ["0.04", null, 4],
      ["2.500", null, expect.stringMatching(/^refused: .*2\.50 or 2,500\.00/)],
      ["1.050", "EUR", 105_000],
    ]);
  });
});

// ── Round trips: any amount or count, written in any of the notations people use, reads back exactly ──

/** Cents written in one notation; null when that notation cannot show them. */
function writeMoney(c: number, style: number, sign: number): string | null {
  const whole = Math.floor(c / 100);
  const dec = String(c % 100).padStart(2, "0");
  const group = (sep: string) => String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, sep);
  let s: string | null;
  switch (style % 9) {
    case 0: s = `${group(".")},${dec}`; break; // 1.850,00 (Dutch)
    case 1: s = `${group(",")}.${dec}`; break; // 1,850.00 (English)
    case 2: s = `${whole},${dec}`; break; // 1850,00
    case 3: s = `${whole}.${dec}`; break; // 1850.00
    case 4: s = c % 100 === 0 ? group(".") : null; break; // 2.500
    case 5: s = c % 100 === 0 ? group(",") : null; break; // 2,500
    case 6: s = c % 100 === 0 ? String(whole) : null; break; // 2500
    case 7: s = c % 10 === 0 ? `${whole},${dec[0]}` : null; break; // 2,5
    default: s = c % 10 === 0 ? `${whole}.${dec[0]}` : null; // 2.5
  }
  if (s === null) return null;
  return ["", "€", "€ ", "$"][sign % 4] + s + (sign % 4 === 0 ? ["", " EUR", " USD", ""][Math.floor(sign / 4) % 4] : "");
}

describe("round trips (property)", () => {
  const cents = fc.oneof(fc.integer({ min: 0, max: 999_999_999 }), fc.integer({ min: 0, max: 1_000 }), fc.integer({ min: 1, max: 99_999 }).map((w) => w * 100));

  it("money: written in any notation, with or without a currency, it reads back as exactly its cents", () => {
    fc.assert(fc.property(cents, fc.nat(), fc.nat(), (c, style, sign) => {
      const w = writeMoney(c, style, sign);
      fc.pre(w !== null);
      expect({ w, read: value(readNumber(w, "money")) }).toEqual({ w, read: c });
    }), { numRuns: 2_000 });
  });

  it("money: the same, as the only number in a sentence", () => {
    fc.assert(fc.property(cents, fc.nat(), fc.nat(), (c, style, sign) => {
      const w = writeMoney(c, style, sign);
      fc.pre(w !== null);
      expect(moneyIn(`Pay our supplier ${w} today.`).map((m) => value(m.reading))).toEqual([c]);
    }), { numRuns: 1_000 });
  });

  it("count: any whole number, grouped with dots, commas or not at all, reads back as itself", () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 99_999_999 }), fc.constantFrom("", ".", ","), (n, sep) => {
      const w = sep ? String(n).replace(/\B(?=(\d{3})+(?!\d))/g, sep) : String(n);
      expect({ w, read: value(readNumber(w, "count")) }).toEqual({ w, read: n });
    }), { numRuns: 1_000 });
  });

  // Breaks if anything is ever rounded: a reading is exact, or it is refused.
  it("never rounds: whatever is typed, a money reading equals the digits written, or is refused", () => {
    fc.assert(fc.property(fc.stringMatching(/^[0-9][0-9.,]{0,12}$/), (s) => {
      const r = readNumber(s, "money");
      if (!r.ok) return;
      expect(Number.isSafeInteger(r.value) && r.value >= 0).toBe(true);
      // Every digit typed is accounted for: the significant digits of the reading are the digits written, in order.
      const digits = s.replace(/[.,]/g, "").replace(/^0+/, "").replace(/0+$/, "");
      const read = String(r.value).replace(/^0+/, "").replace(/0+$/, "");
      expect({ s, read }).toEqual({ s, read: digits });
    }), { numRuns: 2_000 });
  });

  it("never yields a fraction for a count", () => {
    fc.assert(fc.property(fc.stringMatching(/^[0-9][0-9.,]{0,12}$/), (s) => {
      const r = readNumber(s, "count");
      if (r.ok) expect(Number.isSafeInteger(r.value) && r.value >= 0).toBe(true);
    }), { numRuns: 1_000 });
  });

  // Review of try-numbers: the property above checks the digits, not where the decimal point went. Here: whatever is
  // typed, an accepted money reading is exactly the digits read whole (thousands) or with the part after the last mark
  // as decimals, and only a mark with exactly three digits after it may be read as thousands.
  it("never rounds or shifts: a money reading is digits × 100, or digits × 100 / 10^(digits after the last mark)", () => {
    fc.assert(fc.property(fc.stringMatching(/^[0-9][0-9.,]{0,14}$/), (s) => {
      const r = readNumber(s, "money");
      if (!r.ok) return;
      const digits = BigInt(s.replace(/[.,]/g, "")) * 100n;
      const last = Math.max(s.lastIndexOf("."), s.lastIndexOf(","));
      const tail = last < 0 ? 0 : s.length - last - 1;
      const asDecimal = BigInt(r.value) * 10n ** BigInt(tail) === digits;
      const asThousands = BigInt(r.value) === digits;
      expect({ s, value: r.value, ok: tail === 3 ? asDecimal || asThousands : asDecimal }).toEqual({ s, value: r.value, ok: true });
    }), { numRuns: 3_000 });
  });

  it("magnitude: a whole part in any grouping with 1 to 4 decimals (zeros past cents) reads as exactly its cents", () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 9_999_999 }), fc.integer({ min: 0, max: 99 }), fc.constantFrom(1, 2, 3, 4), fc.constantFrom("nl", "en"), fc.boolean(), (whole, cents, places, style, group) => {
      fc.pre(places !== 1 || cents % 10 === 0);
      fc.pre(places !== 3 || whole === 0 || whole > 999); // "2.500" alone is thousands by rule 5 (the round trips cover it)
      const [g, d] = style === "nl" ? [".", ","] : [",", "."];
      const w = group ? String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, g) : String(whole);
      const two = String(cents).padStart(2, "0");
      const dec = places === 1 ? two[0]! : two.padEnd(places, "0");
      const s = `${w}${d}${dec}`;
      expect({ s, read: value(readNumber(s, "money")) }).toEqual({ s, read: whole * 100 + cents });
    }), { numRuns: 2_000 });
  });
});

// ── Invoices: the shared reader may only be stricter than the reader it replaced ──

/** readAmount as it was before the shared reader (build/next c69e821, src/lib/money.ts), kept here as the reference. */
function oldReadAmount(written: string): string | null {
  const s = written.trim().replace(/^(?:EUR|USD|USDZ|€|\$)\s*/i, "").replace(/\s*(?:EUR|USD|€)$/i, "");
  let whole: string, cents = "00";
  let m: RegExpExecArray | null;
  if ((m = /^(\d+)$/.exec(s))) whole = m[1]!;
  else if ((m = /^(\d+)[.,](\d{2})$/.exec(s))) [whole, cents] = [m[1]!, m[2]!];
  else if ((m = /^(\d{1,3})([., \u00a0\u202f])(\d{3}(?:\2\d{3})*)(?:([.,])(\d{2}))?$/.exec(s)) && m[4] !== m[2]) {
    whole = m[1]! + m[3]!.split(m[2]!).join("");
    if (m[5]) cents = m[5];
  } else return null;
  const total = Number(whole) * 100 + Number(cents);
  return Number.isSafeInteger(total) ? fromCents(total) : null;
}

describe("invoices (readAmount) against the reader it replaced (property)", () => {
  const invoiceText = fc.oneof(
    fc.stringMatching(/^(EUR |USD |€ ?|\$)?[0-9][0-9., \u00a0\u202f]{0,14}( EUR| €| USD)?$/),
    fc.tuple(fc.integer({ min: 0, max: 999_999_999 }), fc.nat(), fc.nat()).map(([c, style, sign]) => writeMoney(c, style, sign) ?? fromCents(c)),
    fc.string({ maxLength: 20 }),
  );
  // Breaks if the shared reader accepts an invoice total the old reader refused, or reads one it accepted as another value.
  it("never accepts what the old reader refused, and never changes a value it accepted", () => {
    fc.assert(fc.property(invoiceText, (s) => {
      const now = readAmount(s);
      if (now !== null) expect({ s, now }).toEqual({ s, now: oldReadAmount(s) });
    }), { numRuns: 5_000 });
  });

  it("still reads every total the old reader read in the notations suppliers use", () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 999_999_999 }), fc.nat(), fc.nat(), (c, style, sign) => {
      const w = writeMoney(c, style % 7, sign % 4);
      fc.pre(w !== null && oldReadAmount(w) !== null && !/^[^0-9]*0[.,]\d{3}/.test(w));
      expect({ w, read: readAmount(w) }).toEqual({ w, read: oldReadAmount(w) });
    }), { numRuns: 2_000 });
  });
});

