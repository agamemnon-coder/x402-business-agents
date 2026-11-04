// Hardening plan item 2: the approval hash (src/lib/terms.ts). A person approves the SHA-256 of the exact terms in
// RFC 8785 canonical form; these properties hold for any number-free terms fast-check generates: key order never
// changes the hash, any change of any value does, the canonical form parses back, and the phone (src/approve/client.ts,
// which hashes the terms itself before Face ID) agrees with the runner byte for byte.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { canonicalize as phoneCanonical, rejectionHash as phoneRejection, sha256Hex as phoneSha256 } from "../src/approve/client.js";
import { canonicalTerms, prefixMatches, rejectionSha256, TERMS_SCHEMA, termsHash, type Terms } from "../src/lib/terms.js";

const RUNS = { numRuns: 300 };

type J = string | boolean | null | J[] | { [k: string]: J };
/** Terms are plain JSON, so they are J; the interface just has no index signature. */
const asJ = (t: Terms): J => t as unknown as J;

/** Any key, unicode and lone surrogates included. */
const key = fc.oneof(fc.string({ maxLength: 8 }), fc.string({ unit: "binary", maxLength: 6 }), fc.constantFrom("", "a", "A", "é", "\u{1F600}", "\ud800", "__proto__", "constructor", "10", "2"));
const leaf: fc.Arbitrary<J> = fc.oneof(fc.string({ maxLength: 12 }), fc.string({ unit: "binary", maxLength: 8 }), fc.boolean(), fc.constant(null), fc.constantFrom("1850.00", "0.03", "", " ", '"\\'));

/** Builds an object with own properties in the given order (defineProperty, so "__proto__" stays an ordinary key). */
function objectOf(entries: [string, J][]): { [k: string]: J } {
  const o: { [k: string]: J } = {};
  for (const [k, v] of entries) Object.defineProperty(o, k, { value: v, enumerable: true, writable: true, configurable: true });
  return o;
}

/** Number-free JSON, nested a few levels. */
const { json } = fc.letrec<{ json: J }>((tie) => ({
  json: fc.oneof({ depthSize: "small", withCrossShrink: true },
    leaf,
    fc.array(tie("json"), { maxLength: 4 }),
    fc.uniqueArray(fc.tuple(key, tie("json")), { maxLength: 5, selector: ([k]) => k }).map(objectOf),
  ),
}));

const iso = fc.date({ min: new Date("2000-01-01T00:00:00Z"), max: new Date("2099-12-31T23:59:59Z"), noInvalidDate: true })
  .chain((d) => fc.boolean().map((ms) => (ms ? d.toISOString() : d.toISOString().replace(/\.\d{3}Z$/, "Z"))));

const RESERVED = new Set(["schema", "kind", "proposal_id", "expires_at"]);
/** Terms: the four fixed fields and any number-free body. */
const terms: fc.Arbitrary<Terms> = fc.record({
  kind: fc.constantFrom("mandate_replace", "invoice_payment", "policy_change", "agent_onboard", "refund_batch"),
  proposal_id: fc.oneof(fc.integer({ min: 1, max: 99999 }).map((n) => `P-${String(n).padStart(4, "0")}`), fc.stringMatching(/^C-[0-9a-f]{16}$/)),
  expires_at: iso,
  body: fc.uniqueArray(fc.tuple(key, json), { maxLength: 6, selector: ([k]) => k }),
}).map(({ kind, proposal_id, expires_at, body }) =>
  objectOf([["schema", TERMS_SCHEMA], ["kind", kind], ["proposal_id", proposal_id], ["expires_at", expires_at], ...body.filter(([k]) => !RESERVED.has(k))]) as Terms);

/** The same value with every object's keys in another order (a seeded shuffle at every level). */
function reorder(v: J, seed: number): J {
  if (Array.isArray(v)) return v.map((x, i) => reorder(x, seed + i + 1));
  if (v === null || typeof v !== "object") return v;
  const entries = Object.entries(v);
  let s = seed >>> 0 || 1;
  for (let i = entries.length - 1; i > 0; i--) {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    const j = s % (i + 1);
    [entries[i], entries[j]] = [entries[j]!, entries[i]!];
  }
  return objectOf(entries.map(([k, x], i) => [k, reorder(x, seed * 31 + i)]));
}

type Path = (string | number)[];
/** Every value in the tree, with its path, objects and arrays included (but not the root). */
function paths(v: J, at: Path = []): Path[] {
  const here = at.length ? [at] : [];
  if (Array.isArray(v)) return [...here, ...v.flatMap((x, i) => paths(x, [...at, i]))];
  if (v !== null && typeof v === "object") return [...here, ...Object.entries(v).flatMap(([k, x]) => paths(x, [...at, k]))];
  return here;
}
const clone = (v: J): J => (Array.isArray(v) ? v.map(clone) : v !== null && typeof v === "object" ? objectOf(Object.entries(v).map(([k, x]) => [k, clone(x)])) : v);
function getAt(v: J, p: Path): J {
  return p.reduce<J>((o, k) => (o as Record<string, J>)[k as string]!, v);
}
function setAt(v: J, p: Path, value: J): void {
  const parent = getAt(v, p.slice(0, -1)) as Record<string, J>;
  Object.defineProperty(parent, p[p.length - 1]!, { value, enumerable: true, writable: true, configurable: true });
}
/** A value that is certainly different from `v`, of any type. */
function different(v: J, pick: number, salt: string): J {
  const options: J[] = [
    typeof v === "string" ? `${v}${salt || "x"}` : "x",
    typeof v === "boolean" ? !v : true,
    v === null ? "" : null,
    Array.isArray(v) ? [...v, null] : [],
    v !== null && typeof v === "object" && !Array.isArray(v) ? objectOf([...Object.entries(v), [`${salt}\u0000new`, null]]) : {},
    typeof v === "string" && v.length > 0 ? v.slice(1) : "y",
  ];
  const out = options[pick % options.length]!;
  return JSON.stringify(out) === JSON.stringify(v) ? options[0]! : out;
}

describe("terms hash: canonical form (src/lib/terms.ts)", () => {
  // Breaks if canonicalTerms uses JSON.stringify (insertion order) instead of JCS's sorted keys.
  it("key order never changes the canonical form or the hash", () => {
    fc.assert(fc.property(terms, fc.integer(), (t, seed) => {
      const shuffled = reorder(asJ(t), seed) as Terms;
      expect(canonicalTerms(shuffled)).toBe(canonicalTerms(t));
      expect(termsHash(shuffled)).toBe(termsHash(t));
    }), RUNS);
  });

  // Breaks if the canonical form drops or normalises anything (nulls, empty strings, case, unicode, whitespace), or
  // if termsHash hashes only some fields: then two different sets of terms would share one approval.
  it("any change of any value, anywhere, changes the hash", () => {
    fc.assert(fc.property(terms, fc.nat(), fc.nat(), fc.string({ maxLength: 3 }), (t, which, pick, salt) => {
      const all = paths(asJ(t)).filter((p) => !(p.length === 1 && RESERVED.has(p[0] as string)));
      fc.pre(all.length > 0);
      const p = all[which % all.length]!;
      const changed = clone(asJ(t));
      setAt(changed, p, different(getAt(asJ(t), p), pick, salt));
      expect(termsHash(changed as Terms)).not.toBe(termsHash(t));
    }), RUNS);
  });

  // Breaks if the fixed fields (who, what, until when) stop being part of what is hashed.
  it("changing the kind, the proposal id or the expiry changes the hash", () => {
    fc.assert(fc.property(terms, iso, fc.constantFrom("kind", "proposal_id", "expires_at"), (t, otherExpiry, field) => {
      const changed = clone(asJ(t)) as Terms;
      if (field === "expires_at") fc.pre(otherExpiry !== t.expires_at);
      changed[field] = field === "expires_at" ? otherExpiry : `${t[field]}-2`;
      expect(termsHash(changed)).not.toBe(termsHash(t));
    }), RUNS);
  });

  // Breaks if a key can be renamed (or moved between objects) without changing the hash.
  it("renaming any key changes the hash", () => {
    fc.assert(fc.property(terms, fc.nat(), (t, which) => {
      const keyed = paths(asJ(t)).filter((p) => typeof p[p.length - 1] === "string" && !(p.length === 1 && RESERVED.has(p[0] as string)));
      fc.pre(keyed.length > 0);
      const p = keyed[which % keyed.length]!;
      const changed = clone(asJ(t));
      const parent = getAt(changed, p.slice(0, -1)) as Record<string, J>;
      const k = p[p.length - 1] as string;
      const v = parent[k]!;
      delete parent[k];
      Object.defineProperty(parent, `${k}\u0000renamed`, { value: v, enumerable: true, writable: true, configurable: true });
      expect(termsHash(changed as Terms)).not.toBe(termsHash(t));
    }), RUNS);
  });

  // Breaks if the canonical form is not plain JSON (custom escaping, trailing commas) or not idempotent.
  it("is stable: the canonical form parses back to the same terms and re-canonicalises to itself", () => {
    fc.assert(fc.property(terms, (t) => {
      const c = canonicalTerms(t);
      const back = JSON.parse(c) as Terms;
      expect(back).toEqual(JSON.parse(JSON.stringify(t)));
      expect(canonicalTerms(back)).toBe(c);
      expect(termsHash(back)).toBe(termsHash(t));
      expect(c).not.toMatch(/\n/); // no whitespace between tokens: one line, nothing to reflow
    }), RUNS);
  });

  // Breaks if assertNoNumbers is removed or skips arrays or nested objects: a number could then drift (0.1 + 0.2) and
  // change what a person approved.
  it("refuses a number anywhere in the terms", () => {
    fc.assert(fc.property(terms, fc.nat(), fc.double({ noNaN: true, noDefaultInfinity: true }), (t, which, n) => {
      const all = paths(asJ(t)).filter((p) => !(p.length === 1 && RESERVED.has(p[0] as string)));
      const changed = clone(asJ(t)) as Record<string, unknown>;
      if (all.length === 0) changed.extra = n;
      else setAt(changed as J, all[which % all.length]!, n as unknown as J);
      expect(() => canonicalTerms(changed as Terms)).toThrow(/numbers/);
    }), RUNS);
  });

  // Breaks if expires_at accepts a time zone offset or a date without Z: the same instant would hash two ways.
  it("refuses an expiry that is not UTC with Z", () => {
    fc.assert(fc.property(terms, fc.oneof(fc.string(), iso.map((s) => s.replace("Z", "+00:00")), iso.map((s) => s.slice(0, 10)), iso.map((s) => s.toLowerCase())), (t, bad) => {
      fc.pre(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/.test(bad));
      expect(() => canonicalTerms({ ...t, expires_at: bad })).toThrow(/UTC/);
    }), RUNS);
  });
});

describe("terms hash: the phone and the runner agree (src/approve/client.ts vs src/lib/terms.ts)", () => {
  // Breaks if either side's canonicaliser changes (key sort, string escaping) without the other: the phone would then
  // refuse every proposal, or worse, show one set of terms and sign the hash of another.
  it("the phone canonicalises and hashes any terms exactly as the runner does", async () => {
    await fc.assert(fc.asyncProperty(terms, async (t) => {
      const c = canonicalTerms(t);
      expect(phoneCanonical(t)).toBe(c);
      expect(phoneCanonical(JSON.parse(c))).toBe(c);
      expect(await phoneSha256(c)).toBe(termsHash(t));
    }), RUNS);
  });

  // Breaks if the rejection derivation differs between phone and runner, or equals the terms hash (a rejection's
  // signature would then pass as an approval).
  it("a rejection hash is the same on both sides and never the approval hash", async () => {
    await fc.assert(fc.asyncProperty(fc.stringMatching(/^[0-9a-f]{64}$/), async (h) => {
      const r = rejectionSha256(h);
      expect(await phoneRejection(h)).toBe(r);
      expect(r).not.toBe(h);
      expect(r).toMatch(/^[0-9a-f]{64}$/);
    }), RUNS);
  });

  // Breaks if rejectionSha256 accepts something other than 64 lowercase hex characters.
  it("rejectionSha256 refuses anything but a terms hash", () => {
    fc.assert(fc.property(fc.string({ maxLength: 70 }), (s) => {
      fc.pre(!/^[0-9a-f]{64}$/.test(s));
      expect(() => rejectionSha256(s)).toThrow();
    }), RUNS);
  });
});

describe("the typed prefix (prefixMatches)", () => {
  // Breaks if prefixMatches accepts fewer than 8 characters, a non-prefix, or non-hex input.
  it("matches exactly when the trimmed, lower-cased input is the hash's first 8 hex characters", () => {
    fc.assert(fc.property(fc.stringMatching(/^[0-9a-f]{64}$/), fc.oneof(fc.string({ maxLength: 12 }), fc.stringMatching(/^\s?[0-9a-fA-F]{6,10}\s?$/)), fc.boolean(), (hash, typed, usePrefix) => {
      const input = usePrefix ? ` ${hash.slice(0, 8).toUpperCase()} ` : typed;
      const want = input.trim().toLowerCase() === hash.slice(0, 8);
      expect(prefixMatches(hash, input)).toBe(want);
    }), RUNS);
  });
});
