// Hardening plan item 2: property-based tests for amounts and rounding. Money is integer cents in code and a
// two-decimal string in terms; these properties hold for every amount fast-check can think of, not only the few
// examples in test/money.test.ts. Each property names the production change that would make it fail.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { cents as awxCents } from "../src/airwallex/adapter.js";
import { amountProblem, money as phoneMoney, normalizeAmount } from "../src/approve/client.js";
import { baseUnitsToCents, centsToBaseUnits, fromCents, toCents } from "../src/lib/money.js";

const RUNS = { numRuns: 400 };
const MAX = Number.MAX_SAFE_INTEGER;
const CENT = 10n ** 16n;

/** Any cent amount, with extra weight on the edges (0, 1, 99, 100, the largest safe integer). */
const anyCents = fc.oneof(
  fc.integer({ min: 0, max: MAX }),
  fc.integer({ min: 0, max: 1_000_000 }),
  fc.constantFrom(0, 1, 99, 100, 101, 9_999, MAX, MAX - 1),
);

/** A well-formed two-decimal amount string: no leading zeros, exactly two decimals. */
const decimalString = fc
  .tuple(fc.oneof(fc.constant("0"), fc.stringMatching(/^[1-9]\d{0,17}$/)), fc.stringMatching(/^\d{2}$/))
  .map(([w, f]) => `${w}.${f}`);

/** Strings that look like amounts but are not two-decimal amounts: separators, signs, exponents, spaces, other digit counts. */
const amountish = fc
  .array(fc.constantFrom("0", "1", "2", "5", "9", ".", ",", "-", "+", "e", " ", " ", "_", "€", "$", "x", "٣", "１"), { minLength: 0, maxLength: 14 })
  .map((cs) => cs.join(""));

/** The exact cents of a well-formed two-decimal string, by BigInt arithmetic (no float anywhere). */
const exactCents = (s: string) => {
  const [w, f] = s.split(".");
  return BigInt(w!) * 100n + BigInt(f!);
};

describe("money.ts: toCents / fromCents", () => {
  // Breaks if fromCents drops the zero padding ("12.5" for 1250 cents) or toCents misplaces the decimals.
  it("round-trips every cent amount through the decimal string", () => {
    fc.assert(fc.property(anyCents, (c) => toCents(fromCents(c)) === c), RUNS);
  });

  // Breaks if toCents goes through a float (Math.round(parseFloat(s) * 100)): large amounts drift by a cent.
  it("reads every well-formed amount exactly, with no float drift, or refuses it as too large", () => {
    fc.assert(fc.property(decimalString, (s) => {
      const exact = exactCents(s);
      if (exact > BigInt(MAX)) {
        expect(() => toCents(s)).toThrow(/too large/);
        return;
      }
      expect(BigInt(toCents(s))).toBe(exact);
      expect(fromCents(toCents(s))).toBe(s);
    }), RUNS);
  });

  // Breaks if toCents is loosened to read "1,850.00", "1.5", "01.00", " 1.00", "1e3" or "-1.00" by guessing:
  // anything it accepts must be exactly the canonical string of the cents it returns, so nothing is misread.
  it("refuses malformed input rather than misreading it", () => {
    fc.assert(fc.property(fc.oneof(amountish, fc.string(), fc.string({ unit: "binary" }), decimalString.map((s) => s.replace(".", ","))), (s) => {
      let c: number;
      try {
        c = toCents(s);
      } catch {
        return true;
      }
      return Number.isSafeInteger(c) && c >= 0 && fromCents(c) === s;
    }), RUNS);
  });

  // Breaks if fromCents accepts a fraction of a cent (rounding it) or a negative amount.
  it("fromCents refuses anything that is not a non-negative safe integer", () => {
    const bad = fc.oneof(
      fc.double({ noNaN: false }).filter((d) => !(Number.isSafeInteger(d) && d >= 0)),
      fc.integer({ min: -MAX, max: -1 }),
      fc.constantFrom(NaN, Infinity, -Infinity, 0.5, 1.005, MAX + 1, 2 ** 60),
    );
    fc.assert(fc.property(bad, (d) => {
      expect(() => fromCents(d)).toThrow();
      expect(() => centsToBaseUnits(d)).toThrow();
    }), RUNS);
  });

  // Breaks if fromCents loses the order of amounts (e.g. a missing pad makes "10.5" sort or compare oddly).
  it("keeps amounts in order: a larger cent amount is a larger decimal", () => {
    fc.assert(fc.property(anyCents, anyCents, (a, b) => {
      const [x, y] = [exactCents(fromCents(a)), exactCents(fromCents(b))];
      return Math.sign(a - b) === (x > y ? 1 : x < y ? -1 : 0);
    }), RUNS);
  });
});

describe("money.ts: *USDZ base units (18 decimals: one cent is 10^16 base units)", () => {
  // Breaks if the cent-to-base-unit factor changes on one side only, or goes through a float.
  it("round-trips every cent amount through base units, exactly", () => {
    fc.assert(fc.property(anyCents, (c) => {
      const units = centsToBaseUnits(c);
      expect(units).toBe(BigInt(c) * CENT);
      expect(baseUnitsToCents(units)).toBe(c);
    }), RUNS);
  });

  // Breaks if baseUnitsToCents truncates (units / 10^16) instead of refusing a sub-cent amount: that would round a
  // payment down below what is owed.
  it("never rounds base units down: it returns the exact cents or refuses", () => {
    const units = fc.oneof(
      fc.bigInt({ min: 0n, max: 2n ** 120n }),
      fc.tuple(fc.bigInt({ min: 0n, max: BigInt(MAX) }), fc.bigInt({ min: 0n, max: CENT - 1n })).map(([c, r]) => c * CENT + r),
      fc.bigInt({ min: -(2n ** 80n), max: -1n }),
    );
    fc.assert(fc.property(units, (u) => {
      let c: number;
      try {
        c = baseUnitsToCents(u);
      } catch {
        return u < 0n || u % CENT !== 0n || u / CENT > BigInt(MAX);
      }
      return BigInt(c) * CENT === u;
    }), RUNS);
  });
});

describe("Airwallex amounts (adapter cents): JSON numbers and strings to cents", () => {
  // Breaks if cents() uses Math.floor(v * 100) or Math.round on a float: 0.29 * 100 is 28.999999999999996.
  it("reads every amount Airwallex writes as a number or a string to the same cents, or refuses it", () => {
    fc.assert(fc.property(anyCents, (c) => {
      expect(awxCents(fromCents(c))).toBe(c);
      // JSON numbers: exact up to a billion; beyond that a float may not hold the cents, and then it must refuse.
      const asNumber = Number(fromCents(c));
      let read: number | null;
      try {
        read = awxCents(asNumber);
      } catch {
        read = null;
      }
      if (c <= 100_000_000_000) expect(read).toBe(c);
      else expect(read === null || read === c).toBe(true);
    }), RUNS);
  });

  // Breaks if cents() drops digits after the second decimal (truncating 12.345 to 12.34) instead of refusing.
  it("refuses an amount finer than a cent rather than rounding it", () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 10_000_000 }), fc.stringMatching(/^\d{0,3}[1-9]$/), (c, tail) => {
      expect(() => awxCents(`${fromCents(c)}${tail}`)).toThrow();
    }), RUNS);
  });

  // Breaks if cents() accepts a minus sign, a thousands separator or an exponent by reading part of the string.
  it("anything it accepts from a string has the same value as written", () => {
    fc.assert(fc.property(fc.oneof(amountish, fc.string()), (s) => {
      let c: number;
      try {
        c = awxCents(s);
      } catch {
        return true;
      }
      const m = /^(\d+)(?:\.(\d+))?$/.exec(s.trim());
      if (!m) return false;
      const frac = (m[2] ?? "").padEnd(2, "0");
      return BigInt(c) === BigInt(m[1]!) * 100n + BigInt(frac.slice(0, 2)) && /^0*$/.test(frac.slice(2));
    }), RUNS);
  });
});

describe("the phone's amount input (approve/client normalizeAmount, amountProblem, money)", () => {
  const accepted = (input: string) => amountProblem("money", normalizeAmount(input)) === null;

  // Breaks if amountProblem accepts something other than 1-9 digits, a point and two decimals.
  it("accepts only a two-decimal amount after normalising, and guesses nothing but a decimal comma", () => {
    fc.assert(fc.property(fc.oneof(amountish, fc.string(), decimalString, decimalString.map((s) => ` ${s.replace(".", ",")} `)), (input) => {
      if (!accepted(input)) return true;
      const out = normalizeAmount(input);
      // The value read is the value typed: either exactly, or with the one decimal comma read as a point.
      return /^\d{1,9}\.\d{2}$/.test(out) && (input.trim() === out || input.trim() === out.replace(".", ","));
    }), RUNS);
  });

  // Breaks if normalizeAmount treats a comma before three digits as a decimal mark that amountProblem lets through
  // (e.g. a looser regex /^\d+\.\d{2,3}$/), or strips thousands commas: "1,850" must never become 1.85 or 1850.00.
  it("never reads a thousands separator as a decimal mark", () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 999_999 }), fc.stringMatching(/^\d{3}$/), fc.boolean(), (w, g, dec) => {
      const typed = `${w},${g}${dec ? ".00" : ""}`;
      expect(accepted(typed)).toBe(false);
    }), RUNS);
  });

  // Breaks if the decimal comma is no longer read, or reads as anything but the same cents.
  it("reads a decimal comma as the same amount as a decimal point", () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 99_999_999_999 }), (c) => {
      const s = fromCents(c);
      expect(normalizeAmount(s.replace(".", ","))).toBe(s);
      expect(toCents(normalizeAmount(s.replace(".", ",")))).toBe(c);
      expect(accepted(s.replace(".", ","))).toBe(true);
    }), RUNS);
  });

  // Breaks if amountProblem starts refusing choices, or lets an empty value stand for a required amount.
  it("never refuses a choice, allows an empty optional limit, and never an empty required amount", () => {
    fc.assert(fc.property(fc.string(), (v) => {
      expect(amountProblem("choice", v)).toBeNull();
      expect(amountProblem("optional_money", "")).toBeNull();
      expect(amountProblem("money", "")).not.toBeNull();
    }), { numRuns: 100 });
  });

  // Breaks if money() formats through a float (Number(s).toLocaleString()): long amounts would drift or lose decimals.
  it("money() only groups thousands: removing the commas gives back the exact digits", () => {
    const dec = fc.tuple(fc.boolean(), fc.stringMatching(/^\d{1,30}$/), fc.option(fc.stringMatching(/^\d{1,8}$/), { nil: undefined }))
      .map(([neg, w, f]) => `${neg ? "-" : ""}${w}${f === undefined ? "" : `.${f}`}`);
    fc.assert(fc.property(dec, (s) => {
      const shown = phoneMoney(s);
      expect(shown.replace(/,/g, "").replace("−", "-")).toBe(s);
      const whole = shown.replace("−", "").split(".")[0]!;
      expect(whole).toMatch(/^\d{1,3}(,\d{3})*$/);
    }), RUNS);
  });
});
