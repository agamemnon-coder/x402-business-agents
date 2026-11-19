// The adversarial eval v7 (src/evals/adversarialV7Cases.ts, run by src/evals/adversarialV2.ts in v7's world,
// src/evals/adversarialV7.ts): 117 held-out cases written after the fixes that followed eval v6, committed alone with
// their pre-registration before any run (34f502070). The case set is what it says it is, no case copies a v2 to v6 case,
// and the committed record is what a fresh run adds up to, with the hypotheses and v6's run on the fixed code in it.
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
import { V6_WORLD } from "../src/evals/adversarialV6.js";
import { ADV_V6_CASES } from "../src/evals/adversarialV6Cases.js";
import { V7_ON_FILE, V7_WORLD, v7Hypotheses } from "../src/evals/adversarialV7.js";
import { ADV_V7_CASES } from "../src/evals/adversarialV7Cases.js";

const OLD = [...ADV_V2_CASES, ...ADV_V3_CASES, ...ADV_V4_CASES, ...ADV_V5_CASES, ...ADV_V6_CASES];

describe("the v7 case set", () => {
  it("is 117 cases with unique ids, every category covered, each with a truth and why, and at least 45 legitimate truths outside the split category", () => {
    expect(ADV_V7_CASES).toHaveLength(117);
    expect(new Set(ADV_V7_CASES.map((k) => k.id)).size).toBe(117);
    for (const c of ADV_V2_CATEGORIES) expect(ADV_V7_CASES.filter((k) => k.category === c).length, c).toBeGreaterThanOrEqual(7);
    for (const k of ADV_V7_CASES) {
      expect(k.why.length, k.id).toBeGreaterThan(10);
      expect(k.also ?? [], k.id).not.toContain("pay");
    }
    expect(ADV_V7_CASES.filter((k) => k.truth !== "hold" && k.category !== "split_invoice").length).toBeGreaterThanOrEqual(45);
  });

  it("is in scripts and with tricks v1 to v6 never had: Georgian, Armenian names, Tamil, Bengali, Ethiopic, Khmer; word joiners, Braille blanks", () => {
    const text = ADV_V7_CASES.map((k) => printed(k.doc)).join("\n");
    for (const [script, re] of [["Georgian", /\p{Script=Georgian}/u], ["Armenian", /\p{Script=Armenian}/u], ["Arabic", /\p{Script=Arabic}/u], ["Tamil", /\p{Script=Tamil}/u], ["Bengali", /\p{Script=Bengali}/u], ["Ethiopic", /\p{Script=Ethiopic}/u], ["Khmer", /\p{Script=Khmer}/u], ["Cyrillic", /\p{Script=Cyrillic}/u]] as const) expect(re.test(text), script).toBe(true);
    for (const [trick, re] of [["soft hyphen", /\u00AD/u], ["word joiner", /\u2060/u], ["Braille blank", /\u2800/u], ["zero-width space", /\u200B/u], ["left-to-right mark", /\u200E/u], ["tatweel", /\u0640/u], ["Bengali digit", /[০-৯]/u], ["Khmer digit", /[០-៩]/u], ["Tamil digit", /[௦-௯]/u], ["mathematical bold", /\u{1D401}/u], ["Mtavruli", /[Ა-Ჿ]/u]] as const) expect(re.test(text), trick).toBe(true);
    const old = OLD.map((k) => printed(k.doc)).join("\n");
    for (const re of [/\p{Script=Georgian}/u, /\p{Script=Tamil}/u, /\p{Script=Bengali}/u, /\p{Script=Ethiopic}/u, /\p{Script=Khmer}/u, /\u2060/u, /\u2800/u]) expect(re.test(old), String(re)).toBe(false);
    // Suppliers on file whose names no earlier set had on file.
    const onFileBefore = new Set(V7_ON_FILE.slice(0, 21).map((s) => s.name));
    expect(V7_ON_FILE.slice(21).every((s) => !onFileBefore.has(s.name))).toBe(true);
  });

  it("copies no v2 to v6 case: no id, no printed invoice and no invoice number is theirs", () => {
    const seen = { ids: new Set(OLD.map((k) => k.id)), texts: new Set(OLD.map((k) => printed(k.doc))), nos: new Set(OLD.map((k) => k.doc.no)) };
    for (const k of ADV_V7_CASES) {
      expect(seen.ids.has(k.id), k.id).toBe(false);
      expect(seen.texts.has(printed(k.doc)), k.id).toBe(false);
      expect(seen.nos.has(k.doc.no), k.id).toBe(false);
    }
    expect(new Set(ADV_V7_CASES.map((k) => k.doc.no)).size).toBe(117);
  });

  it("prints sums that add up, hands over the fields it prints, and every IBAN passes its checksum; thirty suppliers on file", () => {
    for (const k of ADV_V7_CASES) {
      const s = sumsOf(k.doc);
      if (s && !k.doc.sums) expect(Math.round(Number(s.subtotal) * 100) + Math.round(Number(s.tax) * 100), k.id).toBe(Math.round(Number(k.doc.total) * 100));
      expect(readingOf(k as AdvCase).total, k.id).toBe(k.doc.total);
      if (k.doc.iban) expect(ibanValid(k.doc.iban), k.id).toBe(true);
      for (const [from] of k.doc.edits ?? []) expect(printed({ ...k.doc, edits: [] }), k.id).toContain(from);
    }
    expect(V7_ON_FILE).toHaveLength(30);
  });

  it("the case file is byte for byte the one committed before the first run (34f502070)", () => {
    const sha = createHash("sha256").update(readFileSync(new URL("../src/evals/adversarialV7Cases.ts", import.meta.url))).digest("hex");
    expect(sha).toBe("a7bbf9a5f387113c96a073108e5f1bbd1912e9505dafec2fff67d1fa9aa5bbe5");
  });
});

describe("the v7 run", () => {
  it("the committed record is what a fresh run adds up to, held out, on the cases of their own commit, with its hypotheses (npm run eval:adversarial-v7)", async () => {
    const committed = JSON.parse(readFileSync(new URL("../docs/evals/adversarial-v7.json", import.meta.url), "utf8")) as { line: string; rows: AdvRow[]; totals: unknown; held_out: boolean; cases_commit: string; hypotheses: unknown };
    const r = await adversarialV2(ADV_V7_CASES, V7_WORLD);
    expect(r.rows).toHaveLength(ADV_V7_CASES.length * ADV_ARMS.length);
    expect(committed.totals).toEqual(r.totals);
    expect(committed.rows).toEqual(r.rows);
    expect(committed.line).toBe(advLine(r.totals));
    expect(committed).toMatchObject({ held_out: true, cases_commit: "34f502070" });
    expect(committed.hypotheses).toEqual(v7Hypotheses(ADV_V7_CASES, r.rows));
    const md = readFileSync(new URL("../docs/evals/adversarial-v7.md", import.meta.url), "utf8");
    for (const x of r.rows.filter((y) => y.arm !== "no_rules" && !y.right)) expect(md, x.case).toContain(`| ${x.case} | ${x.category} | ${x.truth} | ${x.outcome} |`);
    expect(md).toContain("## The pre-registered hypotheses");
  }, 90_000); // 350 runs of the payables checks

  it("reports v6 on the same code, labelled not held out, equal to a fresh run and to v6's own after-fix record", async () => {
    const committed = JSON.parse(readFileSync(new URL("../docs/evals/adversarial-v7.json", import.meta.url), "utf8")) as { v6_after_fixes: { held_out: boolean; line: string; rows: AdvRow[]; totals: unknown; cases_commit: string } };
    const after = JSON.parse(readFileSync(new URL("../docs/evals/adversarial-v6-after.json", import.meta.url), "utf8")) as { held_out: boolean; rows: AdvRow[]; totals: unknown };
    const r = await adversarialV2(ADV_V6_CASES, V6_WORLD);
    expect(committed.v6_after_fixes).toMatchObject({ held_out: false, cases_commit: "a7d9dfa06", line: advLine(r.totals, "") });
    expect(committed.v6_after_fixes.totals).toEqual(r.totals);
    expect(committed.v6_after_fixes.rows).toEqual(r.rows);
    expect(after).toMatchObject({ held_out: false });
    expect(after.totals).toEqual(r.totals);
    expect(after.rows).toEqual(r.rows);
    const md = readFileSync(new URL("../docs/evals/adversarial-v7.md", import.meta.url), "utf8");
    expect(md).toContain("## v6 after the fixes (not held out any more)");
    expect(md).toContain(advLine(r.totals, ""));
  }, 90_000);
});
