// The adversarial eval v9 (src/evals/adversarialV9Cases.ts, run by src/evals/adversarialV2.ts in v9's world,
// src/evals/adversarialV9.ts): 140 held-out cases written after the fixes that followed eval v8 and the rule that sends
// text Purser cannot read to the CFO, committed alone with their pre-registration before any run (V9_CASES_COMMIT). The
// case set is what it says it is, no case copies a v2 to v8 case, and the record is what a fresh run adds up to.
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
import { ADV_V7_CASES } from "../src/evals/adversarialV7Cases.js";
import { V8_WORLD } from "../src/evals/adversarialV8.js";
import { ADV_V8_CASES } from "../src/evals/adversarialV8Cases.js";
import { unreadCost, V9_CASES_COMMIT, V9_ON_FILE, V9_WORLD, v9Hypotheses } from "../src/evals/adversarialV9.js";
import { ADV_V9_CASES } from "../src/evals/adversarialV9Cases.js";

const OLD = [...ADV_V2_CASES, ...ADV_V3_CASES, ...ADV_V4_CASES, ...ADV_V5_CASES, ...ADV_V6_CASES, ...ADV_V7_CASES, ...ADV_V8_CASES];

describe("the v9 case set", () => {
  it("is 140 cases with unique ids, every category covered, each with a truth and why, and at least 50 legitimate truths outside the split category", () => {
    expect(ADV_V9_CASES).toHaveLength(140);
    expect(new Set(ADV_V9_CASES.map((k) => k.id)).size).toBe(140);
    for (const c of ADV_V2_CATEGORIES) expect(ADV_V9_CASES.filter((k) => k.category === c).length, c).toBeGreaterThanOrEqual(7);
    for (const k of ADV_V9_CASES) {
      expect(k.why.length, k.id).toBeGreaterThan(10);
      expect(k.also ?? [], k.id).not.toContain("pay");
    }
    expect(ADV_V9_CASES.filter((k) => k.truth !== "hold" && k.category !== "split_invoice").length).toBeGreaterThanOrEqual(50);
  });

  it("is in scripts and letters no earlier set had on file: Thaana, Gurmukhi, Odia, Kazakh қ, Pashto ټ, Maltese ħ", () => {
    const text = ADV_V9_CASES.map((k) => printed(k.doc)).join("\n");
    const old = OLD.map((k) => printed(k.doc)).join("\n");
    for (const re of [/\p{Script=Thaana}/u, /\p{Script=Gurmukhi}/u, /\p{Script=Oriya}/u, /қ/u, /ټ/u, /ħ/u, /ৰ/u, /嘅/u]) {
      expect(re.test(text), String(re)).toBe(true);
      expect(re.test(old), String(re)).toBe(false);
    }
    const onFileBefore = new Set(V9_ON_FILE.slice(0, 42).map((s) => s.name));
    expect(V9_ON_FILE.slice(42).every((s) => !onFileBefore.has(s.name))).toBe(true);
  });

  it("copies no v2 to v8 case: no id, no printed invoice and no invoice number is theirs", () => {
    const seen = { ids: new Set(OLD.map((k) => k.id)), texts: new Set(OLD.map((k) => printed(k.doc))), nos: new Set(OLD.map((k) => k.doc.no)) };
    for (const k of ADV_V9_CASES) {
      expect(seen.ids.has(k.id), k.id).toBe(false);
      expect(seen.texts.has(printed(k.doc)), k.id).toBe(false);
      expect(seen.nos.has(k.doc.no), k.id).toBe(false);
    }
    expect(new Set(ADV_V9_CASES.map((k) => k.doc.no)).size).toBe(140);
  });

  it("prints sums that add up, hands over the fields it prints, and every IBAN passes its checksum; fifty-four suppliers on file", () => {
    for (const k of ADV_V9_CASES) {
      const s = sumsOf(k.doc);
      if (s && !k.doc.sums) expect(Math.round(Number(s.subtotal) * 100) + Math.round(Number(s.tax) * 100), k.id).toBe(Math.round(Number(k.doc.total) * 100));
      expect(readingOf(k as AdvCase).total, k.id).toBe(k.doc.total);
      if (k.doc.iban) expect(ibanValid(k.doc.iban), k.id).toBe(true);
      for (const [from] of k.doc.edits ?? []) expect(printed({ ...k.doc, edits: [] }), k.id).toContain(from);
    }
    expect(V9_ON_FILE).toHaveLength(54);
  });

  it("the case file is byte for byte the one committed before the first run", () => {
    const sha = createHash("sha256").update(readFileSync(new URL("../src/evals/adversarialV9Cases.ts", import.meta.url))).digest("hex");
    expect(sha).toBe("3c32076686eefa4f6ea2f18eeccf0b4be443efd3dd6d4c258ccf3e77638ea67b");
    expect(V9_CASES_COMMIT).toMatch(/^[0-9a-f]{9}$/);
  });
});

describe("the v9 run", () => {
  // 20 Nov, after v9's record: its misses led to fixes in the shared rules (test/i18n-v9-root-causes.test.ts), so v9 is no
  // longer held out. Its first run stays as recorded, never written again (with v8's run of that day in it); the run on
  // the fixed code is recorded apart (docs/evals/adversarial-v9-after.json), labelled not held out.
  it("the committed after-fix record is what a fresh run adds up to, no longer held out, with its hypotheses and the cost of unread text (npm run eval:adversarial-v9)", async () => {
    const committed = JSON.parse(readFileSync(new URL("../docs/evals/adversarial-v9-after.json", import.meta.url), "utf8")) as { line: string; rows: AdvRow[]; totals: unknown; held_out: boolean; cases_commit: string; before: string; hypotheses: unknown; sent_to_cfo_unread_where_pay: unknown };
    const r = await adversarialV2(ADV_V9_CASES, V9_WORLD);
    expect(r.rows).toHaveLength(ADV_V9_CASES.length * ADV_ARMS.length);
    expect(committed.totals).toEqual(r.totals);
    expect(committed.rows).toEqual(r.rows);
    expect(committed.line).toBe(advLine(r.totals, ""));
    expect(committed).toMatchObject({ held_out: false, cases_commit: V9_CASES_COMMIT, before: "docs/evals/adversarial-v9.json" });
    expect(committed.hypotheses).toEqual(v9Hypotheses(ADV_V9_CASES, r.rows));
    expect(committed.sent_to_cfo_unread_where_pay).toEqual({ purser_script: unreadCost(r.rows, "purser_script"), purser_script_parser: unreadCost(r.rows, "purser_script_parser") });
  }, 240_000); // 420 runs of the payables checks

  it("keeps the held-out run before the fixes as it was recorded: 7 wrong payments, 4 false holds, on the cases of 563ea0325, with v8's run of that day", () => {
    const before = JSON.parse(readFileSync(new URL("../docs/evals/adversarial-v9.json", import.meta.url), "utf8")) as { line: string; held_out: boolean; cases_commit: string; commit: string; dirty: boolean; rows: AdvRow[]; totals: Record<string, { wrong_payments: number; false_holds: number; to_cfo_not_held: number; cfo_not_needed: number }>; hypotheses: unknown; sent_to_cfo_unread_where_pay: { purser_script: string[] }; v8_on_this_code: { held_out: boolean; cases_commit: string; rows: AdvRow[]; totals: Record<string, { wrong_payments: number; false_holds: number }> } };
    expect(before).toMatchObject({ held_out: true, cases_commit: "563ea0325", commit: "dc298464c8b5", dirty: false });
    expect(before.rows).toHaveLength(ADV_V9_CASES.length * ADV_ARMS.length);
    expect(before.totals.purser_script).toMatchObject({ wrong_payments: 7, false_holds: 4, to_cfo_not_held: 24, cfo_not_needed: 16 });
    expect(before.totals.purser_script_parser).toMatchObject({ wrong_payments: 7, false_holds: 4 });
    expect(before.totals.no_rules).toMatchObject({ wrong_payments: 87 });
    expect(before.line).toBe(advLine(before.totals as never));
    expect(before.hypotheses).toEqual(v9Hypotheses(ADV_V9_CASES, before.rows));
    expect(before.sent_to_cfo_unread_where_pay.purser_script).toEqual(unreadCost(before.rows, "purser_script"));
    expect(before.v8_on_this_code).toMatchObject({ held_out: false, cases_commit: "7fabd5262" });
    expect(before.v8_on_this_code.totals.purser_script).toMatchObject({ wrong_payments: 0, false_holds: 0 });
    expect(before.v8_on_this_code.rows).toHaveLength(ADV_V8_CASES.length * ADV_ARMS.length);
    const md = readFileSync(new URL("../docs/evals/adversarial-v9.md", import.meta.url), "utf8");
    expect(md).toContain(before.line);
    for (const x of before.rows.filter((y) => y.arm !== "no_rules" && !y.right)) expect(md, x.case).toContain(`| ${x.case} | ${x.category} | ${x.truth} | ${x.outcome} |`);
    expect(md).toContain("## The pre-registered hypotheses");
    expect(md).toContain("## The cost of sending unread text to the CFO");
    expect(md).toContain("## v8 on this code (not held out any more)");
    expect(md).toContain("added after this record; the record below is unchanged");
  });

  it("v8 on today's code is still its after-fix record", async () => {
    const after8 = JSON.parse(readFileSync(new URL("../docs/evals/adversarial-v8-after.json", import.meta.url), "utf8")) as { rows: AdvRow[] };
    const r = await adversarialV2(ADV_V8_CASES, V8_WORLD);
    expect(after8.rows).toEqual(r.rows);
  }, 240_000);
});
