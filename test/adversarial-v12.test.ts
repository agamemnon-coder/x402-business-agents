// The adversarial eval v12 (src/evals/adversarialV12Cases.ts, run by src/evals/adversarialV2.ts in v12's world,
// src/evals/adversarialV12.ts): 158 held-out cases written after the fixes that followed eval v11, committed alone with
// their pre-registration before any run (V12_CASES_COMMIT). The case set is what it says it is, no case copies a v2 to
// v11 case, and the record is what a fresh run adds up to.
// Offline: a script stands in for the model.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ibanValid } from "../src/ap/reading.js";
import { roundHypotheses } from "../src/evals/adversarialRound.js";
import { ADV_ARMS, adversarialV2, advLine, type AdvRow } from "../src/evals/adversarialV2.js";
import { ADV_V2_CASES, ADV_V2_CATEGORIES, printed, readingOf, sumsOf, type AdvCase } from "../src/evals/adversarialV2Cases.js";
import { ADV_V3_CASES } from "../src/evals/adversarialV3Cases.js";
import { ADV_V4_CASES } from "../src/evals/adversarialV4Cases.js";
import { ADV_V5_CASES } from "../src/evals/adversarialV5Cases.js";
import { ADV_V6_CASES } from "../src/evals/adversarialV6Cases.js";
import { ADV_V7_CASES } from "../src/evals/adversarialV7Cases.js";
import { ADV_V8_CASES } from "../src/evals/adversarialV8Cases.js";
import { ADV_V9_CASES } from "../src/evals/adversarialV9Cases.js";
import { ADV_V10_CASES } from "../src/evals/adversarialV10Cases.js";
import { V12_CASES_COMMIT, V12_HYPOTHESES, V12_ON_FILE, V12_WORLD } from "../src/evals/adversarialV12.js";
import { ADV_V11_CASES } from "../src/evals/adversarialV11Cases.js";
import { ADV_V12_CASES } from "../src/evals/adversarialV12Cases.js";

const OLD = [...ADV_V2_CASES, ...ADV_V3_CASES, ...ADV_V4_CASES, ...ADV_V5_CASES, ...ADV_V6_CASES, ...ADV_V7_CASES, ...ADV_V8_CASES, ...ADV_V9_CASES, ...ADV_V10_CASES, ...ADV_V11_CASES];

describe("the v12 case set", () => {
  it("is 158 cases with unique ids, every category covered, each with a truth and why, and at least 50 legitimate truths outside the split category", () => {
    expect(ADV_V12_CASES).toHaveLength(158);
    expect(new Set(ADV_V12_CASES.map((k) => k.id)).size).toBe(158);
    for (const c of ADV_V2_CATEGORIES) expect(ADV_V12_CASES.filter((k) => k.category === c).length, c).toBeGreaterThanOrEqual(7);
    for (const k of ADV_V12_CASES) {
      expect(k.why.length, k.id).toBeGreaterThan(10);
      expect(k.also ?? [], k.id).not.toContain("pay");
    }
    expect(ADV_V12_CASES.filter((k) => k.truth !== "hold" && k.category !== "split_invoice").length).toBeGreaterThanOrEqual(50);
  });

  it("copies no v2 to v11 case: no id, no printed invoice and no invoice number is theirs; thirteen new suppliers on file", () => {
    const seen = { ids: new Set(OLD.map((k) => k.id)), texts: new Set(OLD.map((k) => printed(k.doc))), nos: new Set(OLD.map((k) => k.doc.no)) };
    for (const k of ADV_V12_CASES) {
      expect(seen.ids.has(k.id), k.id).toBe(false);
      expect(seen.texts.has(printed(k.doc)), k.id).toBe(false);
      expect(seen.nos.has(k.doc.no), k.id).toBe(false);
    }
    expect(new Set(ADV_V12_CASES.map((k) => k.doc.no)).size).toBe(158);
    expect(V12_ON_FILE).toHaveLength(93);
    const before = new Set(V12_ON_FILE.slice(0, 80).map((s) => s.name));
    expect(V12_ON_FILE.slice(80).every((s) => !before.has(s.name))).toBe(true);
  });

  it("prints sums that add up, hands over the fields it prints, and every IBAN passes its checksum", () => {
    for (const k of ADV_V12_CASES) {
      const s = sumsOf(k.doc);
      if (s && !k.doc.sums) expect(Math.round(Number(s.subtotal) * 100) + Math.round(Number(s.tax) * 100), k.id).toBe(Math.round(Number(k.doc.total) * 100));
      expect(readingOf(k as AdvCase).total, k.id).toBe(k.doc.total);
      if (k.doc.iban) expect(ibanValid(k.doc.iban), k.id).toBe(true);
      for (const [from] of k.doc.edits ?? []) expect(printed({ ...k.doc, edits: [] }), k.id).toContain(from);
    }
    for (const s of V12_ON_FILE.slice(80)) expect(ibanValid(s.bank!.iban!), s.id).toBe(true);
  });

  it("every hypothesis names cases of the set", () => {
    const ids = new Set(ADV_V12_CASES.map((k) => k.id));
    for (const h of V12_HYPOTHESES) {
      expect(h.ids.length, h.id).toBeGreaterThan(0);
      for (const id of h.ids) expect(ids.has(id), `${h.id} ${id}`).toBe(true);
    }
  });

  it("the case file is byte for byte the one committed before the first run", () => {
    const sha = createHash("sha256").update(readFileSync(new URL("../src/evals/adversarialV12Cases.ts", import.meta.url))).digest("hex");
    expect(sha).toBe("3b77f330b572ad3dfb40f8085abd77fd873cf302fcd14ec5b61fbfa6fae60a2a");
    expect(V12_CASES_COMMIT).toMatch(/^[0-9a-f]{9}$/);
  });
});

describe("the v12 run", () => {
  // 20 Nov, after v12's record: its misses led to fixes in the shared rules (test/i18n-v12-root-causes.test.ts), so v12
  // is no longer held out. Its first run stays as recorded; the run on the fixed code is recorded apart.
  it("the committed after-fix record is what a fresh run adds up to, no longer held out (npm run eval:adversarial-v12)", async () => {
    const committed = JSON.parse(readFileSync(new URL("../docs/evals/adversarial-v12-after.json", import.meta.url), "utf8")) as { line: string; rows: AdvRow[]; totals: unknown; held_out: boolean; cases_commit: string; before: string; hypotheses: unknown };
    const r = await adversarialV2(ADV_V12_CASES, V12_WORLD);
    expect(committed.totals).toEqual(r.totals);
    expect(committed.rows).toEqual(r.rows);
    expect(committed.line).toBe(advLine(r.totals, ""));
    expect(committed).toMatchObject({ held_out: false, cases_commit: V12_CASES_COMMIT, before: "docs/evals/adversarial-v12.json" });
    expect(committed.hypotheses).toEqual(roundHypotheses(V12_HYPOTHESES, r.rows));
  }, 240_000);

  it("keeps the held-out run before the fixes as it was recorded: 19 wrong payments vs 100, 1 false hold of 68, on the cases of e69ac3650", () => {
    const before = JSON.parse(readFileSync(new URL("../docs/evals/adversarial-v12.json", import.meta.url), "utf8")) as { line: string; held_out: boolean; cases_commit: string; commit: string; dirty: boolean; rows: AdvRow[]; totals: Record<string, { wrong_payments: number; false_holds: number; clean_truths: number; to_cfo_not_held: number; cfo_not_needed: number }>; hypotheses: unknown };
    expect(before).toMatchObject({ held_out: true, cases_commit: "e69ac3650", commit: "26445531582a", dirty: false });
    expect(before.rows).toHaveLength(ADV_V12_CASES.length * ADV_ARMS.length);
    expect(before.totals.purser_script).toMatchObject({ wrong_payments: 19, false_holds: 1, clean_truths: 68, to_cfo_not_held: 18, cfo_not_needed: 1 });
    expect(before.totals.purser_script_parser).toMatchObject({ wrong_payments: 18, false_holds: 6 });
    expect(before.totals.no_rules).toMatchObject({ wrong_payments: 100 });
    expect(before.line).toBe(advLine(before.totals as never));
    expect(before.hypotheses).toEqual(roundHypotheses(V12_HYPOTHESES, before.rows));
    const md = readFileSync(new URL("../docs/evals/adversarial-v12.md", import.meta.url), "utf8");
    expect(md).toContain(before.line);
    for (const x of before.rows.filter((y) => y.arm !== "no_rules" && !y.right)) expect(md, x.case).toContain(`| ${x.case} | ${x.category} | ${x.truth} | ${x.outcome} |`);
    expect(md).toContain("added after this record; the record below is unchanged");
  });
});
