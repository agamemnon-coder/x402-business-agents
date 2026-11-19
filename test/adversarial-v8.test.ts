// The adversarial eval v8 (src/evals/adversarialV8Cases.ts, run by src/evals/adversarialV2.ts in v8's world,
// src/evals/adversarialV8.ts): 140 held-out cases written after the fixes that followed eval v7, committed alone with
// their pre-registration before any run (7fabd5262). The case set is what it says it is, no case copies a v2 to v7 case,
// and the committed record is what a fresh run adds up to, with the hypotheses and v7's run on the fixed code in it.
// Offline: a script stands in for the model.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ibanValid } from "../src/ap/reading.js";
import { ADV_ARMS, adversarialV2, advLine, type AdvRow } from "../src/evals/adversarialV2.js";
import { ADV_V2_CASES, ADV_V2_CATEGORIES, printed, readingOf, sumsOf, type AdvCase } from "../src/evals/adversarialV2Cases.js";
import { ADV_V3_CASES } from "../src/evals/adversarialV3Cases.js";
import { ADV_V4_CASES } from "../src/evals/adversarialV4Cases.js";
import { ADV_V5_CASES } from "../src/evals/adversarialV5Cases.js";
import { ADV_V6_CASES } from "../src/evals/adversarialV6Cases.js";
import { V7_WORLD } from "../src/evals/adversarialV7.js";
import { ADV_V7_CASES } from "../src/evals/adversarialV7Cases.js";
import { V8_ON_FILE, V8_WORLD, v8Hypotheses } from "../src/evals/adversarialV8.js";
import { ADV_V8_CASES } from "../src/evals/adversarialV8Cases.js";

const OLD = [...ADV_V2_CASES, ...ADV_V3_CASES, ...ADV_V4_CASES, ...ADV_V5_CASES, ...ADV_V6_CASES, ...ADV_V7_CASES];

describe("the v8 case set", () => {
  it("is 140 cases with unique ids, every category covered, each with a truth and why, and at least 50 legitimate truths outside the split category", () => {
    expect(ADV_V8_CASES).toHaveLength(140);
    expect(new Set(ADV_V8_CASES.map((k) => k.id)).size).toBe(140);
    for (const c of ADV_V2_CATEGORIES) expect(ADV_V8_CASES.filter((k) => k.category === c).length, c).toBeGreaterThanOrEqual(7);
    for (const k of ADV_V8_CASES) {
      expect(k.why.length, k.id).toBeGreaterThan(10);
      expect(k.also ?? [], k.id).not.toContain("pay");
    }
    expect(ADV_V8_CASES.filter((k) => k.truth !== "hold" && k.category !== "split_invoice").length).toBeGreaterThanOrEqual(50);
  });

  it("is in scripts and with tricks v5 to v7 never had: Sinhala, Lao, Burmese, Gujarati, Malayalam, Telugu, Kannada, Tibetan, Syriac, Cherokee, syllabics", () => {
    const text = ADV_V8_CASES.map((k) => printed(k.doc)).join("\n");
    const scripts = [["Sinhala", /\p{Script=Sinhala}/u], ["Lao", /\p{Script=Lao}/u], ["Myanmar", /\p{Script=Myanmar}/u], ["Gujarati", /\p{Script=Gujarati}/u], ["Malayalam", /\p{Script=Malayalam}/u],
      ["Telugu", /\p{Script=Telugu}/u], ["Kannada", /\p{Script=Kannada}/u], ["Tibetan", /\p{Script=Tibetan}/u], ["Syriac", /\p{Script=Syriac}/u], ["Cherokee", /\p{Script=Cherokee}/u],
      ["Canadian syllabics", /\p{Script=Canadian_Aboriginal}/u], ["Mongolian digits", /[᠐-᠙]/u], ["Myanmar digits", /[၀-၉]/u], ["Malayalam digits", /[൦-൯]/u], ["Sinhala digits", /[෦-෯]/u],
      ["dotless i", /ı/u], ["Icelandic thorn", /Þ/u], ["Lithuanian caron", /Ž/u], ["Latvian macron", /ī/u], ["Hebrew points", /[ַָֿ]/u]] as const;
    for (const [what, re] of scripts) expect(re.test(text), what).toBe(true);
    const old = OLD.map((k) => printed(k.doc)).join("\n");
    for (const re of [/\p{Script=Sinhala}/u, /\p{Script=Lao}/u, /\p{Script=Myanmar}/u, /\p{Script=Gujarati}/u, /\p{Script=Malayalam}/u, /\p{Script=Telugu}/u, /\p{Script=Kannada}/u, /\p{Script=Tibetan}/u, /\p{Script=Syriac}/u, /\p{Script=Cherokee}/u, /\p{Script=Canadian_Aboriginal}/u]) expect(re.test(old), String(re)).toBe(false);
    // Suppliers on file whose names no earlier set had on file.
    const onFileBefore = new Set(V8_ON_FILE.slice(0, 30).map((s) => s.name));
    expect(V8_ON_FILE.slice(30).every((s) => !onFileBefore.has(s.name))).toBe(true);
  });

  it("copies no v2 to v7 case: no id, no printed invoice and no invoice number is theirs", () => {
    const seen = { ids: new Set(OLD.map((k) => k.id)), texts: new Set(OLD.map((k) => printed(k.doc))), nos: new Set(OLD.map((k) => k.doc.no)) };
    for (const k of ADV_V8_CASES) {
      expect(seen.ids.has(k.id), k.id).toBe(false);
      expect(seen.texts.has(printed(k.doc)), k.id).toBe(false);
      expect(seen.nos.has(k.doc.no), k.id).toBe(false);
    }
    expect(new Set(ADV_V8_CASES.map((k) => k.doc.no)).size).toBe(140);
  });

  it("prints sums that add up, hands over the fields it prints, and every IBAN passes its checksum; forty-two suppliers on file", () => {
    for (const k of ADV_V8_CASES) {
      const s = sumsOf(k.doc);
      if (s && !k.doc.sums) expect(Math.round(Number(s.subtotal) * 100) + Math.round(Number(s.tax) * 100), k.id).toBe(Math.round(Number(k.doc.total) * 100));
      expect(readingOf(k as AdvCase).total, k.id).toBe(k.doc.total);
      if (k.doc.iban) expect(ibanValid(k.doc.iban), k.id).toBe(true);
      for (const [from] of k.doc.edits ?? []) expect(printed({ ...k.doc, edits: [] }), k.id).toContain(from);
    }
    expect(V8_ON_FILE).toHaveLength(42);
  });

  it("the case file is byte for byte the one committed before the first run (7fabd5262)", () => {
    const sha = createHash("sha256").update(readFileSync(new URL("../src/evals/adversarialV8Cases.ts", import.meta.url))).digest("hex");
    expect(sha).toBe("e4e47397989ead0dcbee7eb0fb6683e710453faf68f6918f96e8adec9e59f86e");
  });
});

describe("the v8 run", () => {
  it("the committed record is what a fresh run adds up to, held out, on the cases of their own commit, with its hypotheses (npm run eval:adversarial-v8)", async () => {
    const committed = JSON.parse(readFileSync(new URL("../docs/evals/adversarial-v8.json", import.meta.url), "utf8")) as { line: string; rows: AdvRow[]; totals: unknown; held_out: boolean; cases_commit: string; hypotheses: unknown };
    const r = await adversarialV2(ADV_V8_CASES, V8_WORLD);
    expect(r.rows).toHaveLength(ADV_V8_CASES.length * ADV_ARMS.length);
    expect(committed.totals).toEqual(r.totals);
    expect(committed.rows).toEqual(r.rows);
    expect(committed.line).toBe(advLine(r.totals));
    expect(committed).toMatchObject({ held_out: true, cases_commit: "7fabd5262" });
    expect(committed.hypotheses).toEqual(v8Hypotheses(ADV_V8_CASES, r.rows));
    const md = readFileSync(new URL("../docs/evals/adversarial-v8.md", import.meta.url), "utf8");
    for (const x of r.rows.filter((y) => y.arm !== "no_rules" && !y.right)) expect(md, x.case).toContain(`| ${x.case} | ${x.category} | ${x.truth} | ${x.outcome} |`);
    expect(md).toContain("## The pre-registered hypotheses");
  }, 240_000); // 420 runs of the payables checks

  it("reports v7 on the same code, labelled not held out, equal to a fresh run and to v7's own after-fix record", async () => {
    const committed = JSON.parse(readFileSync(new URL("../docs/evals/adversarial-v8.json", import.meta.url), "utf8")) as { v7_after_fixes: { held_out: boolean; line: string; rows: AdvRow[]; totals: unknown; cases_commit: string } };
    const after = JSON.parse(readFileSync(new URL("../docs/evals/adversarial-v7-after.json", import.meta.url), "utf8")) as { held_out: boolean; rows: AdvRow[]; totals: unknown };
    const r = await adversarialV2(ADV_V7_CASES, V7_WORLD);
    expect(committed.v7_after_fixes).toMatchObject({ held_out: false, cases_commit: "34f502070", line: advLine(r.totals, "") });
    expect(committed.v7_after_fixes.totals).toEqual(r.totals);
    expect(committed.v7_after_fixes.rows).toEqual(r.rows);
    expect(after).toMatchObject({ held_out: false });
    expect(after.totals).toEqual(r.totals);
    expect(after.rows).toEqual(r.rows);
    const md = readFileSync(new URL("../docs/evals/adversarial-v8.md", import.meta.url), "utf8");
    expect(md).toContain("## v7 after the fixes (not held out any more)");
    expect(md).toContain(advLine(r.totals, ""));
  }, 240_000);
});
