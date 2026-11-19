// The link between the Dafny proofs (formal/dafny, docs/evidence/formal-proofs.md) and the TypeScript that runs.
// Dafny proves properties of its own functions; this test runs those very functions (translated to JavaScript by
// `npm run formal:dafny`, which checks the translation against the proofs) side by side with the production
// TypeScript, on many generated inputs, and requires the same answer every time:
//   - canonicalTerms / termsHash (src/lib/terms.ts) and the phone's canonicalize (src/approve/client.ts): the same
//     canonical text, the same UTF-8 bytes, the same SHA-256, the same refusals;
//   - toCents / fromCents (src/lib/money.ts): the same cents, the same strings, the same refusals;
//   - aloneDecision (src/policy/withinLimit.ts, approveWithinLimit's check) and capRefusal's cap (src/policy/rules.ts).
// A difference is a failing test: either the code or the model is wrong, and the proofs say nothing until it is fixed.
import { createHash } from "node:crypto";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { canonicalize } from "../src/approve/client.js";
import { openDb } from "../src/db/open.js";
import { fromCents, toCents } from "../src/lib/money.js";
import { canonicalTerms, termsHash, TERMS_SCHEMA, type Terms } from "../src/lib/terms.js";
import { capRefusal } from "../src/policy/rules.js";
import { aloneDecision, plainCents } from "../src/policy/withinLimit.js";
import { BigNumber, Reference, type DJson } from "./support/dafnyReference.js";

const ref = new Reference();
const R = ref.fn;
const MAX = Number.MAX_SAFE_INTEGER;

/** How many generated inputs each property runs; the totals are printed at the end. */
const RUNS = { terms: 1500, json: 1500, fieldChange: 200, amounts: 6000, cents: 6000, alone: 6000, floatVsInteger: 20000, cap: 1500 };
/** The compiled reference is plain Dafny-generated JavaScript on big integers: slower than the code it checks. */
const SLOW = 180_000;
const counted: Record<string, number> = {};
const count = (what: string) => { counted[what] = (counted[what] ?? 0) + 1; };

const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const attempt = <T>(f: () => T): T | null => { try { return f(); } catch { return null; } };

// ── Strings that try to fool a canonical form ──

/**
 * Code units chosen to break canonicalisation if it were wrong: quotes and backslashes, every control character class,
 * whitespace look-alikes, zero-width and bidi characters, NFC vs NFD, homoglyphs, lone and paired surrogates.
 */
const TRICKY = [
  '"', "\\", "/", "\b", "\f", "\n", "\r", "\t", "\u0000", "\u0001", "\u001f", "\u007f", " ", " ", " ", " ",
  "　", " ", " ", "​", "‌", "‍", "‎", "‮", "⁠", "﻿", "é", "é",
  "A", "А", "Α", "Ａ", "а", "a", "0", "٠", "０", "1", ".", ",", "-", "−",
  "\ud800", "\udbff", "\udc00", "\udfff", "😀", "\ud83d", "\ude00", "￿", "�", "€", "£", ":", "{", "}",
  "[", "]", "null", "true",
];
const unit = fc.oneof(
  fc.constantFrom(...TRICKY),
  fc.integer({ min: 0, max: 0xffff }).map((c) => String.fromCharCode(c)),
  fc.string({ unit: "grapheme", maxLength: 1 }),
);
const tricky = fc.array(unit, { maxLength: 12 }).map((a) => a.join(""));

/** Plain JSON without numbers (what terms are), objects with tricky keys, nested a few levels. */
const { json } = fc.letrec<{ json: unknown }>((tie) => ({
  json: fc.oneof(
    { depthSize: "small", withCrossShrink: true },
    fc.constant(null),
    fc.boolean(),
    tricky,
    fc.array(tie("json"), { maxLength: 4 }),
    fc.dictionary(tricky, tie("json"), { maxKeys: 5 }),
  ),
}));

const digits = (n: number) => fc.array(fc.constantFrom(..."0123456789"), { minLength: n, maxLength: n }).map((a) => a.join(""));
const iso = fc.oneof(
  fc.tuple(digits(4), digits(2), digits(2), digits(2), digits(2), digits(2)).map(([y, mo, d, h, mi, s]) => `${y}-${mo}-${d}T${h}:${mi}:${s}Z`),
  fc.tuple(digits(4), digits(2), digits(2), digits(2), digits(2), digits(2), digits(3)).map(([y, mo, d, h, mi, s, ms]) => `${y}-${mo}-${d}T${h}:${mi}:${s}.${ms}Z`),
);
/** Right and wrong expiries: the regression of 19 November is the one-element array. */
const expiresAt = fc.oneof(
  { weight: 30, arbitrary: iso },
  { weight: 1, arbitrary: iso.map((s) => s.replace("Z", "+00:00")) },
  { weight: 1, arbitrary: iso.map((s) => s.replace("T", " ")) },
  { weight: 1, arbitrary: iso.map((s) => `${s}\n`) },
  { weight: 1, arbitrary: iso.map((s) => [s]) },
  { weight: 1, arbitrary: iso.map((s) => [[s]]) },
  { weight: 1, arbitrary: fc.oneof(fc.constant(null), fc.boolean(), tricky) },
);
const anyCentsString = fc.oneof(fc.integer({ min: 0, max: 10_000_000 }), fc.integer({ min: 0, max: MAX })).map(fromCents);

/** A terms object like the invoice payments the CFO signs, with tricky values, extra members and wrong variants. */
const termsArb = fc
  .record({
    schema: fc.oneof({ weight: 8, arbitrary: fc.constant(TERMS_SCHEMA) }, { weight: 1, arbitrary: fc.constantFrom("kit11.approval-terms/v2", "", TERMS_SCHEMA + " ") }),
    kind: fc.constantFrom("invoice_payment", "supplier_payment", "policy_change"),
    proposal_id: fc.integer({ min: 1, max: 99999 }).map((n) => `P-${n}`),
    expires_at: expiresAt,
    invoice_no: tricky,
    vendor: fc.oneof(fc.constantFrom("Bergtex Textil GmbH", "Bergtex Textil GmbH ", "Bergtex Textil GmbH", "Bеrgtex Textil GmbH"), tricky),
    iban_last4: fc.oneof(digits(4), tricky),
    bic: tricky,
    amount: fc.oneof(anyCentsString, tricky),
    currency: fc.constantFrom("EUR", "USD", "eur", "EUR ", "ＥUR"),
    due_date: fc.oneof(iso.map((s) => s.slice(0, 10)), tricky),
    balances_before: fc.record({ eur_available: anyCentsString, usd_available: anyCentsString }),
    evidence: fc.array(fc.record({ type: fc.constant("invoice"), ref: tricky, sha256: fc.stringMatching(/^[0-9a-f]{64}$/) }), { maxLength: 2 }),
    conversion: fc.constant(null),
    test_money: fc.boolean(),
    extra: json,
  }, { requiredKeys: ["schema", "kind", "proposal_id", "expires_at"] })
  // Sometimes a number somewhere: canonicalTerms must refuse it, and it is outside the model.
  .chain((t) => fc.oneof({ weight: 12, arbitrary: fc.constant(t as Record<string, unknown>) }, { weight: 1, arbitrary: fc.double().map((n) => ({ ...t, fee: n }) as Record<string, unknown>) }));

/** canonicalTerms against the model, on one value; returns whether the terms were accepted. */
function compareTerms(t: unknown): boolean {
  const ts = attempt(() => canonicalTerms(t as Terms));
  const model = ref.json(t);
  if (model === null) {
    // Outside the model (a number somewhere): canonicalTerms must refuse.
    expect(ts).toBeNull();
    count("terms: refused (a number in the terms)");
    return false;
  }
  const bytes = R.TermsBytes(model);
  const text = R.CanonicalTerms(model);
  expect(bytes.is_Some).toBe(text.is_Some);
  if (!bytes.is_Some) {
    expect(ts).toBeNull();
    count("terms: refused by both (schema or expires_at)");
    return false;
  }
  expect(ts).not.toBeNull();
  // The same text, the same bytes, the same hash.
  expect(ts).toBe(ref.text(text.dtor_value));
  const refBytes = ref.bytes(bytes.dtor_value);
  expect(Buffer.from(ts!, "utf8").equals(refBytes)).toBe(true);
  expect(termsHash(t as Terms)).toBe(sha256(refBytes));
  // The phone canonicalises and hashes the same terms itself: the same text and UTF-8 bytes.
  expect(canonicalize(t)).toBe(ts);
  expect(Buffer.from(new TextEncoder().encode(canonicalize(t))).equals(refBytes)).toBe(true);
  count("terms: accepted, identical canonical bytes and hash");
  return true;
}

describe("canonical terms: TypeScript = verified Dafny reference", () => {
  it("canonicalTerms, termsHash and the phone's canonicalize agree with the model on generated terms", () => {
    fc.assert(fc.property(termsArb, (t) => { compareTerms(t); }), { numRuns: RUNS.terms });
  }, SLOW);

  it("the model's JCS equals jcs and the phone's canonicalize on any plain JSON value without numbers", () => {
    fc.assert(fc.property(json, (v) => {
      const model = ref.json(v) as DJson;
      const text = ref.text(R.CanonicalText(model));
      expect(canonicalize(v)).toBe(text);
      expect(Buffer.from(text, "utf8").equals(ref.bytes(R.CanonicalBytes(model)))).toBe(true);
      // The verified decoder (Jcs.ParseValue, proven a left inverse of the serialisation) reads the TypeScript's text
      // back to the model's canonical form of the input.
      const decoded = R.Decode(ref.units(canonicalize(v)));
      expect(decoded.is_Some && decoded.dtor_value.equals(R.Normalize(model))).toBe(true);
      // Wrapped as terms, canonicalTerms (metal-pay's jcs) gives the same text inside.
      const t = { schema: TERMS_SCHEMA, kind: "x", proposal_id: "P-1", expires_at: "2026-11-19T10:00:00Z", v };
      expect(compareTerms(t)).toBe(true);
      count("json: identical JCS text and bytes, decoded back by the verified decoder");
    }), { numRuns: RUNS.json });
  }, SLOW);

  it("member order does not matter (a JavaScript object is a map), and both sort keys by UTF-16 code units", () => {
    const keys = ["b", "a", "B", "é", "é", "\ud800", "😀", "Ａ", "aa", "", "_", "~"];
    const forward = Object.fromEntries(keys.map((k, i) => [k, String(i)]));
    const backward = Object.fromEntries([...keys].reverse().map((k) => [k, String(keys.indexOf(k))]));
    const wrap = (v: unknown) => ({ schema: TERMS_SCHEMA, kind: "x", proposal_id: "P-1", expires_at: "2026-11-19T10:00:00Z", v });
    expect(compareTerms(wrap(forward))).toBe(true);
    expect(compareTerms(wrap(backward))).toBe(true);
    expect(canonicalTerms(wrap(forward) as Terms)).toBe(canonicalTerms(wrap(backward) as Terms));
  });

  it("regression (19 Nov): an expiry that only coerces to an ISO string is refused, as the model refuses it", () => {
    const base = { schema: TERMS_SCHEMA, kind: "invoice_payment", proposal_id: "P-7", amount: "1850.00" };
    for (const expires_at of [["2026-11-19T10:00:00Z"], [["2026-11-19T10:00:00Z"]], { toString: () => "2026-11-19T10:00:00Z" }]) {
      expect(() => canonicalTerms({ ...base, expires_at } as unknown as Terms)).toThrow(/expires_at must be UTC ISO-8601/);
    }
    expect(compareTerms({ ...base, expires_at: ["2026-11-19T10:00:00Z"] })).toBe(false);
    expect(compareTerms({ ...base, expires_at: "2026-11-19T10:00:00Z" })).toBe(true);
  });

  it("changing any one field of signed terms changes the hash (proven as FieldChangeChangesBytes; sampled here)", () => {
    fc.assert(fc.property(termsArb, fc.string({ unit: "binary", maxLength: 3 }), (t, extra) => {
      if (!compareTerms(t)) return;
      for (const k of Object.keys(t)) {
        const v = t[k];
        const changed = { ...t, [k]: typeof v === "string" ? v + (extra || " ") : v === null ? "" : null };
        if (ref.json(changed) === null || attempt(() => canonicalTerms(changed as Terms)) === null) continue;
        expect(termsHash(changed as Terms)).not.toBe(termsHash(t as Terms));
        count("terms: one field changed, hash changed");
      }
    }), { numRuns: RUNS.fieldChange });
  }, SLOW);
});

// ── Amounts ──

/** Strings around amounts: separators, signs, exponents, spaces, non-ASCII digits, one or three decimals. */
const amountish = fc.array(fc.constantFrom(..."0123456789", ".", ",", "-", "+", "e", " ", " ", "_", "€", "x", "٣", "１", "\n"), { maxLength: 14 }).map((a) => a.join(""));
const amountStrings = fc.oneof(
  anyCentsString,
  amountish,
  fc.tuple(fc.stringMatching(/^\d{1,18}$/), fc.stringMatching(/^\d{0,3}$/)).map(([w, f]) => `${w}.${f}`),
  // Around 2^53 cents, the largest a JavaScript number holds exactly.
  fc.tuple(fc.integer({ min: 90071992547380, max: 90071992547420 }), fc.integer({ min: 0, max: 99 })).map(([w, f]) => `${w}.${String(f).padStart(2, "0")}`),
);

describe("amounts: toCents and fromCents = verified Dafny reference", () => {
  it("toCents accepts and refuses the same strings as Money.ToCents, with the same cents", () => {
    fc.assert(fc.property(amountStrings, (s) => {
      const ts = attempt(() => toCents(s));
      const m = R.ToCents(ref.units(s));
      expect(ts === null).toBe(!m.is_Some);
      if (ts !== null) {
        expect(String(ts)).toBe(m.dtor_value.toFixed());
        count("amounts: toCents accepted, same cents");
      } else count("amounts: toCents refused by both");
    }), { numRuns: RUNS.amounts });
  }, SLOW);

  it("fromCents gives the same string as Money.FromCents, and refuses the same numbers", () => {
    const cents = fc.oneof(fc.integer({ min: 0, max: MAX }), fc.integer({ min: 0, max: 1_000_000 }), fc.integer({ min: -1000, max: -1 }),
      fc.integer({ min: MAX - 100_000, max: MAX }), fc.constantFrom(0, 1, 99, 100, 2 ** 46, 2 ** 47, MAX));
    fc.assert(fc.property(cents, (c) => {
      const ts = attempt(() => fromCents(c));
      const m = R.FromCents(new BigNumber(c));
      expect(ts === null).toBe(!m.is_Some);
      if (ts !== null) {
        expect(ts).toBe(ref.text(m.dtor_value));
        count("cents: fromCents same string");
      } else count("cents: fromCents refused by both");
    }), { numRuns: RUNS.cents });
  }, SLOW);

  it("every cent amount at the top of the safe range and across the float-precision steps, exhaustively", () => {
    // Math.floor(cents / 100) in fromCents divides in floating point; exactness there is the runtime argument in
    // docs/evidence/formal-proofs.md. These are the amounts where it would first go wrong: the top of the range, and
    // where the spacing of doubles grows (2^46, 2^47 cents).
    const ranges: [number, number][] = [[MAX - 3000, MAX], [2 ** 46 - 1500, 2 ** 46 + 1500], [2 ** 47 - 1500, 2 ** 47 + 1500], [0, 1500]];
    for (const [lo, hi] of ranges) {
      for (let c = lo; c <= hi; c++) {
        const s = fromCents(c);
        expect(s).toBe(ref.text(R.FromCents(new BigNumber(c)).dtor_value));
        expect(toCents(s)).toBe(c);
        count("cents: exhaustive boundary, round trip identical");
      }
    }
    expect(() => toCents("90071992547409.92")).toThrow(/too large/);
    expect(R.ToCents(ref.units("90071992547409.92")).is_None).toBe(true);
  }, SLOW);
});

// ── Limits ──

const plainish = fc.oneof(
  anyCentsString.filter((s) => s.length <= 12),
  fc.tuple(fc.stringMatching(/^\d{1,9}$/), fc.stringMatching(/^\d{2}$/)).map(([w, f]) => `${w}.${f}`),
  fc.tuple(fc.stringMatching(/^\d{0,11}$/), fc.stringMatching(/^\d{0,3}$/)).map(([w, f]) => `${w}.${f}`),
  fc.constantFrom("0.00", "000.00", "0.01", "999999999.99", "1000000000.00", "1500.00", "1500.01", "1499.99"),
  amountish,
);
const limitArb = fc.record({
  currency: fc.constantFrom("EUR", "USD", "eur"),
  amount: fc.oneof({ weight: 5, arbitrary: fc.integer({ min: 0, max: 200_000 }).map(fromCents) }, { weight: 1, arbitrary: plainish }),
});
const currencyArb = fc.oneof(fc.constantFrom("EUR", "USD", "eur", "EUR ", "ＥUR", ""), fc.constantFrom(null, 5, ["EUR"], { c: "EUR" }));
const amountArb = fc.oneof({ weight: 6, arbitrary: plainish }, { weight: 1, arbitrary: fc.constantFrom(null, 1500, ["1500.00"], true) });
/** An amount a few cents either side of the limit, written as fromCents writes it or with leading zeros. */
const nearLimit = (limit: { amount: string }) => {
  const top = plainCents(limit.amount);
  if (top === null) return amountArb;
  return fc.tuple(fc.integer({ min: -500, max: 500 }), fc.boolean()).map(([d, zeros]) => {
    const s = fromCents(Math.max(0, top + d));
    return zeros && s.length < 12 ? `0${s}` : s;
  });
};

const toStrOption = (v: unknown) => (typeof v === "string" ? ref.some(ref.units(v)) : ref.none<ReturnType<Reference["units"]>>());
const decisionName = (d: { is_NoLimit: boolean; is_NotWithin: boolean; is_Within: boolean }) => (d.is_NoLimit ? "no_limit" : d.is_NotWithin ? "not_within" : "within");

describe("limits: the pay-alone check and the agent's cap = verified Dafny reference", () => {
  it("aloneDecision decides as Limit.AloneDecision, on generated amounts, currencies and limits", () => {
    const cases = limitArb.chain((limit) => fc.tuple(fc.oneof(amountArb, nearLimit(limit)), fc.oneof({ weight: 3, arbitrary: fc.constant(limit.currency) }, { weight: 2, arbitrary: currencyArb }), fc.constant(limit)));
    fc.assert(fc.property(cases, ([amount, currency, limit]) => {
      const ts = aloneDecision(amount, currency, limit);
      const m = R.AloneDecision(toStrOption(amount), toStrOption(currency), ref.units(limit.amount), ref.units(limit.currency));
      expect(ts).toBe(decisionName(m));
      count(`alone: ${ts}, same decision`);
    }), { numRuns: RUNS.alone });
  }, SLOW);

  it("amounts at and around the limit, cent by cent", () => {
    for (const limit of ["0.01", "1500.00", "999999999.99"]) {
      const top = plainCents(limit)!;
      for (let c = Math.max(0, top - 300); c <= Math.min(top + 300, 99_999_999_999); c++) {
        const amount = fromCents(c);
        const ts = aloneDecision(amount, "EUR", { currency: "EUR", amount: limit });
        const m = R.AloneDecision(toStrOption(amount), toStrOption("EUR"), ref.units(limit), ref.units("EUR"));
        expect(ts).toBe(decisionName(m));
        expect(ts).toBe(c <= top ? "within" : "not_within");
        count("alone: boundary cent, same decision");
      }
    }
  }, SLOW);

  it("the integer check decides exactly as the float formula it replaced, on every plain amount tried", () => {
    // Before 19 November: Math.round(Number(a) * 100). Correct on this domain (docs/evidence/formal-proofs.md), now gone.
    const float = (a: string) => Math.round(Number(a) * 100);
    fc.assert(fc.property(fc.tuple(fc.stringMatching(/^\d{1,9}$/), fc.stringMatching(/^\d{2}$/)).map(([w, f]) => `${w}.${f}`), (a) => {
      expect(plainCents(a)).toBe(float(a));
      count("alone: integer cents = old float cents");
    }), { numRuns: RUNS.floatVsInteger });
  }, SLOW);

  it("capRefusal refuses exactly when Limit.CapRefuses does (cents > cap), and throws where toCents refuses the cap", () => {
    const db = openDb(":memory:");
    const set = db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('cap.sourcing', ?, '2026-11-19T00:00:00Z') ON CONFLICT(key) DO UPDATE SET value = excluded.value");
    const capArb = fc.oneof(fc.constant(""), anyCentsString, fc.constantFrom("1500.00", "0.00", "01.00", "1500.0", "1,500.00"));
    fc.assert(fc.property(fc.integer({ min: 0, max: 10_000_000 }), capArb, (cents, cap) => {
      set.run(cap);
      let ts: boolean | null;
      try {
        const why = capRefusal(db, "sourcing", cents);
        expect(why === null || why.startsWith("policy_cap_exceeded:")).toBe(true);
        ts = why !== null;
      } catch {
        ts = null;
      }
      const m = R.CapRefuses(new BigNumber(cents), ref.units(cap));
      expect(ts === null).toBe(!m.is_Some);
      if (ts !== null) expect(ts).toBe(m.dtor_value);
      count(`cap: ${ts === null ? "refused cap value (throws)" : ts ? "over cap, refused" : "within cap"}, same answer`);
    }), { numRuns: RUNS.cap });
    db.close();
  }, SLOW);
});

describe("the BigInt stand-in for bignumber.js", () => {
  it("truncating division and Euclidean modulo, as the Dafny runtime expects", () => {
    for (const [a, b] of [[7, 2], [-7, 2], [7, -2], [-7, -2], [0, 5], [64, 64], [-1, 64]] as const) {
      expect(new BigNumber(a).dividedToIntegerBy(b).toNumber()).toBe(Math.trunc(a / b) + 0);
      const r = new BigNumber(a).mod(b).toNumber();
      expect(r >= 0 && r < Math.abs(b) && (a - r) % b === 0).toBe(true);
    }
  });

  it("prints how many inputs were compared", () => {
    const total = Object.values(counted).reduce((s, n) => s + n, 0);
    process.stdout.write(`formal-dafny differential: ${total} comparisons, all identical\n${Object.entries(counted).sort().map(([k, n]) => `  ${k}: ${n}`).join("\n")}\n`);
    expect(total).toBeGreaterThan(0);
  });
});
