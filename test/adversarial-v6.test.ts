// The adversarial eval v6 (src/evals/adversarialV6Cases.ts, run by src/evals/adversarialV2.ts in v6's world,
// src/evals/adversarialV6.ts): 108 held-out cases written after the fixes that followed eval v5, committed alone with
// their pre-registration before any run (a7d9dfa06). The case set is what it says it is, no case copies a v2 to v5 case,
// and the committed record is what a fresh run adds up to, with the hypotheses and v5's run on the fixed code in it.
// Offline: a script stands in for the model.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ADV_ARMS, adversarialV2, advLine, type AdvRow } from "../src/evals/adversarialV2.js";
import { ADV_V2_CASES, ADV_V2_CATEGORIES, printed, readingOf, sumsOf, type AdvCase } from "../src/evals/adversarialV2Cases.js";
import { ADV_V3_CASES } from "../src/evals/adversarialV3Cases.js";
import { ADV_V4_CASES } from "../src/evals/adversarialV4Cases.js";
import { V5_WORLD } from "../src/evals/adversarialV5.js";
import { ADV_V5_CASES } from "../src/evals/adversarialV5Cases.js";
import { V6_ON_FILE, V6_WORLD, v6Hypotheses } from "../src/evals/adversarialV6.js";
import { ADV_V6_CASES } from "../src/evals/adversarialV6Cases.js";
import { ibanValid } from "../src/ap/reading.js";

describe("the v6 case set", () => {
  it("is 108 cases with unique ids, every category covered, each with a truth and why, and at least 40 legitimate truths outside the split category", () => {
    expect(ADV_V6_CASES).toHaveLength(108);
    expect(new Set(ADV_V6_CASES.map((k) => k.id)).size).toBe(108);
    for (const c of ADV_V2_CATEGORIES) expect(ADV_V6_CASES.filter((k) => k.category === c).length, c).toBeGreaterThanOrEqual(7);
    for (const k of ADV_V6_CASES) {
      expect(k.why.length, k.id).toBeGreaterThan(10);
      expect(k.also ?? [], k.id).not.toContain("pay");
    }
    expect(ADV_V6_CASES.filter((k) => k.truth !== "hold" && k.category !== "split_invoice").length).toBeGreaterThanOrEqual(40);
  });

  it("is in scripts and with tricks v1 to v5 never had: Hebrew, Thai, Devanagari, Hangul names; direction overrides and zero-width joiners", () => {
    const text = ADV_V6_CASES.map((k) => printed(k.doc)).join("\n");
    for (const [script, re] of [["Hebrew", /\p{Script=Hebrew}/u], ["Thai", /\p{Script=Thai}/u], ["Devanagari", /\p{Script=Devanagari}/u], ["Hangul", /\p{Script=Hangul}/u], ["Han", /\p{Script=Han}/u], ["Katakana", /\p{Script=Katakana}/u], ["Armenian", /\p{Script=Armenian}/u], ["Cherokee", /\p{Script=Cherokee}/u]] as const) expect(re.test(text), script).toBe(true);
    for (const [trick, re] of [["right-to-left override", /‮/u], ["zero-width joiner", /‍/u], ["full-width digit", /[０-９]/u], ["Arabic-Indic digit", /[٠-٩]/u], ["Turkish ş", /ş/u]] as const) expect(re.test(text), trick).toBe(true);
    const old = [...ADV_V2_CASES, ...ADV_V3_CASES, ...ADV_V4_CASES, ...ADV_V5_CASES].map((k) => printed(k.doc)).join("\n");
    for (const re of [/\p{Script=Hebrew}/u, /\p{Script=Thai}/u, /\p{Script=Devanagari}/u, /\p{Script=Hangul}/u]) expect(re.test(old), String(re)).toBe(false);
  });

  it("copies no v2 to v5 case: no id, no printed invoice and no invoice number is theirs", () => {
    const old = [...ADV_V2_CASES, ...ADV_V3_CASES, ...ADV_V4_CASES, ...ADV_V5_CASES];
    const seen = { ids: new Set(old.map((k) => k.id)), texts: new Set(old.map((k) => printed(k.doc))), nos: new Set(old.map((k) => k.doc.no)) };
    for (const k of ADV_V6_CASES) {
      expect(seen.ids.has(k.id), k.id).toBe(false);
      expect(seen.texts.has(printed(k.doc)), k.id).toBe(false);
      expect(seen.nos.has(k.doc.no), k.id).toBe(false);
    }
    expect(new Set(ADV_V6_CASES.map((k) => k.doc.no)).size).toBe(108);
  });

  it("prints sums that add up, hands over the fields it prints, and every IBAN passes its checksum; twenty-one suppliers on file", () => {
    for (const k of ADV_V6_CASES) {
      const s = sumsOf(k.doc);
      if (s && !k.doc.sums) expect(Math.round(Number(s.subtotal) * 100) + Math.round(Number(s.tax) * 100), k.id).toBe(Math.round(Number(k.doc.total) * 100));
      expect(readingOf(k as AdvCase).total, k.id).toBe(k.doc.total);
      if (k.doc.iban) expect(ibanValid(k.doc.iban), k.id).toBe(true);
      for (const [from] of k.doc.edits ?? []) expect(printed({ ...k.doc, edits: [] }), k.id).toContain(from);
    }
    expect(V6_ON_FILE).toHaveLength(21);
  });

  it("the case file is byte for byte the one committed before the first run (a7d9dfa06)", () => {
    const sha = createHash("sha256").update(readFileSync(new URL("../src/evals/adversarialV6Cases.ts", import.meta.url))).digest("hex");
    expect(sha).toBe("98323703474225f128590a8b7e3987c65b4b3c448ab93d482562ea264aff56fb");
  });
});

describe("the v6 run", () => {
  it("the committed record is what a fresh run adds up to, held out, on the cases of their own commit, with its hypotheses (npm run eval:adversarial-v6)", async () => {
    const committed = JSON.parse(readFileSync(new URL("../docs/evals/adversarial-v6.json", import.meta.url), "utf8")) as { line: string; rows: AdvRow[]; totals: unknown; held_out: boolean; cases_commit: string; hypotheses: unknown };
    const r = await adversarialV2(ADV_V6_CASES, V6_WORLD);
    expect(r.rows).toHaveLength(ADV_V6_CASES.length * ADV_ARMS.length);
    expect(committed.totals).toEqual(r.totals);
    expect(committed.rows).toEqual(r.rows);
    expect(committed.line).toBe(advLine(r.totals));
    expect(committed).toMatchObject({ held_out: true, cases_commit: "a7d9dfa06" });
    expect(committed.hypotheses).toEqual(v6Hypotheses(ADV_V6_CASES, r.rows));
    const md = readFileSync(new URL("../docs/evals/adversarial-v6.md", import.meta.url), "utf8");
    for (const x of r.rows.filter((y) => y.arm !== "no_rules" && !y.right)) expect(md, x.case).toContain(`| ${x.case} | ${x.category} | ${x.truth} | ${x.outcome} |`);
    expect(md).toContain("## The pre-registered hypotheses");
  }, 90_000); // 300+ runs of the payables checks

  it("reports v5 on the same code, labelled not held out, equal to a fresh run and to v5's own after-fix record", async () => {
    const committed = JSON.parse(readFileSync(new URL("../docs/evals/adversarial-v6.json", import.meta.url), "utf8")) as { v5_after_fixes: { held_out: boolean; line: string; rows: AdvRow[]; totals: unknown; cases_commit: string } };
    const after = JSON.parse(readFileSync(new URL("../docs/evals/adversarial-v5-after.json", import.meta.url), "utf8")) as { held_out: boolean; rows: AdvRow[]; totals: unknown };
    const r = await adversarialV2(ADV_V5_CASES, V5_WORLD);
    expect(committed.v5_after_fixes).toMatchObject({ held_out: false, cases_commit: "9e8d59c1", line: advLine(r.totals, "") });
    expect(committed.v5_after_fixes.totals).toEqual(r.totals);
    expect(committed.v5_after_fixes.rows).toEqual(r.rows);
    expect(after).toMatchObject({ held_out: false });
    expect(after.totals).toEqual(r.totals);
    expect(after.rows).toEqual(r.rows);
    const md = readFileSync(new URL("../docs/evals/adversarial-v6.md", import.meta.url), "utf8");
    expect(md).toContain("## v5 after the fixes (not held out any more)");
    expect(md).toContain(advLine(r.totals, ""));
  }, 90_000);
});
