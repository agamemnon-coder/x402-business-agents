// The tamper matrix (src/proof/tamperMatrix.ts, npm run tamper-matrix): the mutator on small fixtures, then the real
// committed receipt and bundle through the real verifiers, and the report's loud finding when a change is accepted.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  applyChange, contentKey, findSigned, later, matrixMarkdown, moveCents, oneCharacter, otherCurrency, tamperArtifact, termChanges, totalsOf, type ArtifactResult,
} from "../src/proof/tamperMatrix.js";
import { canonicalTerms } from "../src/try/receipt.js";

const json = (f: string) => JSON.parse(readFileSync(new URL(`../${f}`, import.meta.url), "utf8")) as Record<string, unknown>;

describe("the smallest changes", () => {
  it("moves money by one cent, either way, in the same form", () => {
    expect(moveCents("240.00", 1)).toBe("240.01");
    expect(moveCents("240.00", -1)).toBe("239.99");
    expect(moveCents("9.99", 1)).toBe("10.00");
    expect(moveCents("0.00", -1)).toBe("-0.01");
    expect(moveCents("-0.01", 1)).toBe("0.00");
    expect(() => moveCents("1.5", 1)).toThrow();
  });
  it("changes one character: the last digit (an IBAN's, an id's), else the last letter (a name's)", () => {
    expect(oneCharacter("IBAN NL91…4300")).toEqual({ after: "IBAN NL91…4301", change: "one digit" });
    expect(oneCharacter("2059")).toEqual({ after: "2050", change: "one digit" });
    expect(oneCharacter("Stockline Data GmbH")).toEqual({ after: "Stockline Data GmbI", change: "one letter" });
    expect(oneCharacter("abz")).toEqual({ after: "aba", change: "one letter" });
    expect(oneCharacter("·")).toEqual({ after: "·x", change: "one character added" });
  });
  it("makes a time a second later and a date a day later, in the same form; switches the currency", () => {
    expect(later("2026-11-07T12:31:13Z")).toEqual({ after: "2026-11-07T12:31:14Z", change: "+1 second" });
    expect(later("2026-11-15T04:40:36.000Z")).toEqual({ after: "2026-11-15T04:40:37.000Z", change: "+1 second" });
    expect(later("2026-12-31")).toEqual({ after: "2027-01-01", change: "+1 day" });
    expect(later("SLL-2026-11")).toBeNull();
    expect(otherCurrency("EUR")).toBe("USD");
    expect(otherCurrency("USD")).toBe("EUR");
    expect(otherCurrency("GBP")).toBe("EUR");
  });
});

describe("termChanges: every signed field, at any depth", () => {
  const terms = {
    amount: "240.00", currency: "EUR", beneficiary_name: "Stockline Data GmbH", iban_last4: "2051", expires_at: "2026-11-07T12:31:13Z",
    conversion: { quote_id: "d7e941bc-da97-3e15-b07e-566136737840", client_rate: "1.117256" }, clearing: null, test_money: true,
    evidence: [{ type: "invoice", sha256: "004ee3b2" }],
  };
  const cs = termChanges(terms);
  const of = (p: string) => cs.filter((c) => c.path.join(".") === p).map((c) => `${c.change}: ${c.after}`);
  it("changes each value by its kind", () => {
    expect(of("amount")).toEqual(['+0.01: "240.01"', '−0.01: "239.99"', 'field removed: (absent)']);
    expect(of("currency")).toEqual(['currency EUR → USD: "USD"', "field removed: (absent)"]);
    expect(of("iban_last4")[0]).toBe('one digit: "2052"');
    expect(of("beneficiary_name")[0]).toBe('one letter: "Stockline Data GmbI"');
    expect(of("expires_at")[0]).toBe('+1 second: "2026-11-07T12:31:14Z"');
    expect(of("conversion.quote_id")).toEqual(['one digit: "d7e941bc-da97-3e15-b07e-566136737841"']);
    expect(of("conversion.client_rate")).toEqual(['last digit: "1.117257"']);
    expect(of("clearing")[0]).toBe('null → a value: "1"');
    expect(of("test_money")[0]).toBe("true → false: false");
    expect(of("evidence.0.sha256")).toEqual(['one digit: "004ee3b3"']);
    expect(of("tampered")).toEqual(['field added: "1"']);
  });
  it("leaves the original untouched; with the hash recomputed, rewrites terms_sha256 and the canonical text to the changed terms", () => {
    const art = { terms: structuredClone(terms), terms_sha256: "a".repeat(64), canonical: "x" };
    const amount = cs.find((c) => c.path.join(".") === "amount" && c.change === "+0.01")!;
    const kept = applyChange(art, amount, "hash kept");
    expect((kept.terms as typeof terms).amount).toBe("240.01");
    expect(kept.terms_sha256).toBe("a".repeat(64));
    const forged = applyChange(art, amount, "hash recomputed");
    const canonical = canonicalTerms(forged.terms);
    expect(forged.canonical).toBe(canonical);
    expect(forged.terms_sha256).toBe(createHash("sha256").update(canonical).digest("hex"));
    expect(art.terms.amount).toBe("240.00");
    expect(art.terms_sha256).toBe("a".repeat(64));
  });
});

describe("findSigned: every receipt and bundle in a JSON file", () => {
  it("finds them at any depth, and the same one twice has one content key", () => {
    const b = json("docs/film/under-the-hood/try-proof.json");
    const rec = json("docs/film/under-the-hood/record.json");
    const inRecord = findSigned(rec);
    expect(inRecord.map((f) => `${f.kind} ${f.at}`)).toEqual(["bundle $.pays[0].answer.proof", "bundle $.pays[1].answer.proof"]);
    expect(contentKey(inRecord[0]!.value)).toBe(contentKey(b));
    expect(contentKey(inRecord[1]!.value)).not.toBe(contentKey(b));
    expect(findSigned({ a: [{ receipt: "something else" }] })).toEqual([]);
  });
});

describe("the real artifacts, through the real verifiers", () => {
  it("the awx-1 approval receipt: the original verifies, every change is refused", async () => {
    const f = "docs/runs/2026-11-07-awx-1/receipt-P-0002.json";
    const r = await tamperArtifact(f, findSigned(json(f))[0]!);
    expect(r.original).toEqual({ ok: true, failed: [] });
    expect(r.accepted).toBe(0);
    expect(r.tried).toBeGreaterThan(100);
    const cent = r.rows.filter((x) => x.field === "terms.amount" && x.change === "+0.01");
    expect(cent.find((x) => x.variant === "hash kept")!.failed).toEqual(["terms hash"]);
    expect(cent.find((x) => x.variant === "hash recomputed")!.failed).toEqual(["challenge"]);
    expect(r.rows.find((x) => x.field === "assertion.signature")!.failed).toEqual(["signature"]);
  });
  it("a /try proof bundle: the original verifies, every change is refused", async () => {
    const f = "docs/proof/try-paid.json";
    const r = await tamperArtifact(f, findSigned(json(f))[0]!);
    expect(r.original.ok).toBe(true);
    expect(r.accepted).toBe(0);
    const name = r.rows.filter((x) => x.field === "terms.beneficiary_name" && x.change === "one letter");
    expect(name).toHaveLength(2);
    for (const x of name) expect(x.failed).toContain("challenge");
  });
});

describe("the report says so loudly when a change is accepted", () => {
  const fake = (accepted: boolean): ArtifactResult => ({
    file: "docs/x.json", at: "$", alsoAt: [], kind: "receipt", proposal: "P-1", terms_sha256: "0".repeat(64), original: { ok: true, failed: [] },
    rows: [{ field: "terms.amount", change: "+0.01", before: '"1.00"', after: '"1.01"', variant: "hash kept", refused: !accepted, failed: accepted ? [] : ["terms hash"] }],
    tried: 1, refused: accepted ? 0 : 1, accepted: accepted ? 1 : 0,
  });
  it("a FINDING section and ACCEPTED in the row; none when all are refused", () => {
    const bad = matrixMarkdown({ artifacts: [fake(true)], totals: totalsOf([fake(true)]), cli: [] });
    expect(bad).toContain("## FINDING");
    expect(bad).toContain("`terms.amount` +0.01 (hash kept) was ACCEPTED");
    expect(bad).toContain("| **Accepted** | **1** |");
    const good = matrixMarkdown({ artifacts: [fake(false)], totals: totalsOf([fake(false)]), cli: [] });
    expect(good).not.toContain("FINDING");
    expect(good).toContain("No changed copy was accepted: 1 of 1 refused");
  });
});

describe("the committed report (docs/evidence/tamper-matrix.json)", () => {
  it("holds every artifact's original as verifying and no accepted change", () => {
    const m = json("docs/evidence/tamper-matrix.json") as { totals: { artifacts: number; originalsValid: number; tried: number; refused: number; accepted: number }; cli: { exit: number; expected: number }[] };
    expect(m.totals.accepted).toBe(0);
    expect(m.totals.refused).toBe(m.totals.tried);
    expect(m.totals.originalsValid).toBe(m.totals.artifacts);
    for (const c of m.cli) expect(c.exit).toBe(c.expected);
  });
});
