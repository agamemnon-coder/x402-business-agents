// Mutation testing, 20 November (docs/evidence/mutation-testing.md, group terms): the gaps the surviving mutants of
// src/lib/terms.ts showed. Breaks if canonicalTerms accepts an expiry that is not exactly UTC ISO-8601 with Z (text before
// or after it, a fraction other than three digits), stops naming where a number sits in the terms, refuses a null value,
// or if the rejection hash or the typed prefix check change what they accept.
import { describe, expect, it } from "vitest";
import { canonicalTerms, PREFIX_LENGTH, prefixMatches, rejectionSha256, sha256Hex, termsHash, TERMS_SCHEMA, type Terms } from "../src/lib/terms.js";

const base = { schema: TERMS_SCHEMA, kind: "invoice_payment", proposal_id: "P-0001", expires_at: "2026-11-20T11:00:00Z" } as Terms;
const terms = (extra: Record<string, unknown>) => ({ ...base, ...extra }) as unknown as Terms;
const thrown = (f: () => unknown): string | null => { try { f(); return null; } catch (e) { return (e as Error).message; } };

describe("canonicalTerms: the expiry", () => {
  it("accepts UTC ISO-8601 with Z, with or without three digits of milliseconds", () => {
    expect(thrown(() => canonicalTerms(terms({ expires_at: "2026-11-20T11:00:00Z" })))).toBeNull();
    expect(thrown(() => canonicalTerms(terms({ expires_at: "2026-11-20T11:00:00.123Z" })))).toBeNull();
  });

  it("refuses anything before or after the timestamp, other fractions, an offset, and a value that is not a string", () => {
    for (const bad of ["x2026-11-20T11:00:00Z", "2026-11-20T11:00:00Zx", " 2026-11-20T11:00:00Z", "2026-11-20T11:00:00.12Z", "2026-11-20T11:00:00.1234Z",
      "2026-11-20T11:00:00+00:00", "2026-11-20 11:00:00Z", "2026-11-20T11:00Z", "26-11-20T11:00:00Z"]) {
      expect(thrown(() => canonicalTerms(terms({ expires_at: bad })))).toBe(`expires_at must be UTC ISO-8601 with Z: ${bad}`);
    }
    expect(thrown(() => canonicalTerms(terms({ expires_at: ["2026-11-20T11:00:00Z"] })))).toBe("expires_at must be UTC ISO-8601 with Z: 2026-11-20T11:00:00Z");
  });

  it("refuses another schema by name", () => {
    expect(thrown(() => canonicalTerms(terms({ schema: "kit11.approval-terms/v2" })))).toBe("unknown terms schema: kit11.approval-terms/v2");
  });
});

describe("canonicalTerms: no numbers, and where one sits", () => {
  it("names the path of a number at the top, in an object and in an array", () => {
    expect(thrown(() => canonicalTerms(terms({ amount: 12.5 })))).toBe("terms must not contain numbers (at terms.amount); use a decimal string");
    expect(thrown(() => canonicalTerms(terms({ fx: { rate: 1.08 } })))).toBe("terms must not contain numbers (at terms.fx.rate); use a decimal string");
    expect(thrown(() => canonicalTerms(terms({ lines: ["1.00", { n: 2 }] })))).toBe("terms must not contain numbers (at terms.lines[1].n); use a decimal string");
    expect(thrown(() => canonicalTerms(terms({ lines: ["1.00", 2] })))).toBe("terms must not contain numbers (at terms.lines[1]); use a decimal string");
  });

  it("accepts null, booleans, strings, nested objects and arrays, and hashes them canonically (key order does not matter)", () => {
    const a = terms({ note: null, ok: true, lines: [{ a: "1", b: null }], nested: { z: "z", a: "a" } });
    expect(thrown(() => canonicalTerms(a))).toBeNull();
    const b = terms({ nested: { a: "a", z: "z" }, lines: [{ b: null, a: "1" }], ok: true, note: null });
    expect(canonicalTerms(a)).toBe(canonicalTerms(b));
    expect(termsHash(a)).toBe(sha256Hex(canonicalTerms(a)));
    expect(canonicalTerms(a)).toContain('"note":null');
  });
});

describe("sha256Hex and termsHash", () => {
  it("hash the UTF-8 text", () => {
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256Hex("é")).toBe("4a99557e4033c3539de2eb65472017cad5f9557f7a0625a09f1c3f6e2ba69c4c");
  });
});

describe("rejectionSha256", () => {
  const h = "a".repeat(64);
  it("is the SHA-256 of the fixed rejection text and the terms hash", () => {
    expect(rejectionSha256(h)).toBe(sha256Hex(`kit11 reject v1 ${h}`));
    expect(rejectionSha256(h)).not.toBe(h);
  });
  it("takes only 64 lowercase hex characters", () => {
    for (const bad of [`x${h}`, `${h}x`, h.slice(1), "A".repeat(64), `${h.slice(0, 63)}g`, ""]) {
      expect(thrown(() => rejectionSha256(bad))).toBe("a terms hash is 64 lowercase hex characters");
    }
  });
});

describe("prefixMatches: the eight characters the approver types", () => {
  const full = "0123abcd".padEnd(64, "e");
  it("matches the first eight, trimmed and in either case", () => {
    expect(PREFIX_LENGTH).toBe(8);
    expect(prefixMatches(full, "0123abcd")).toBe(true);
    expect(prefixMatches(full, "  0123ABCD \n")).toBe(true);
  });
  it("refuses fewer or more characters, other characters, and another hash's prefix", () => {
    expect(prefixMatches(full, "0123abc")).toBe(false);
    expect(prefixMatches(full, "0123abcde")).toBe(false);
    expect(prefixMatches(full, "")).toBe(false);
    expect(prefixMatches(full, "0123abcz")).toBe(false);
    expect(prefixMatches(full, "1123abcd")).toBe(false);
    expect(prefixMatches(`x${full}`, "x0123abc")).toBe(false); // the typed text must be hex, even when the hash starts with it
  });
});
