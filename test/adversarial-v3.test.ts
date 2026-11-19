// The adversarial eval v3 (src/evals/adversarialV3Cases.ts, run by src/evals/adversarialV2.ts): 100 cases written after
// the fixes against v2's misses, committed alone before any run, held out until the second round of fixes (19 Nov). The
// case set is what it says it is, no case copies a v2 case, and the committed record is what a fresh run adds up to.
// Offline: a script stands in for the model.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ADV_ARMS, adversarialV2, advLine, type AdvRow } from "../src/evals/adversarialV2.js";
import { ADV_V2_CASES, ADV_V2_CATEGORIES, printed, readingOf, sumsOf } from "../src/evals/adversarialV2Cases.js";
import { ADV_V3_CASES } from "../src/evals/adversarialV3Cases.js";

describe("the v3 case set", () => {
  it("is 100 cases with unique ids, every v2 category covered, each with a truth and why, and clean truths to measure false holds", () => {
    expect(ADV_V3_CASES).toHaveLength(100);
    expect(new Set(ADV_V3_CASES.map((k) => k.id)).size).toBe(100);
    for (const c of ADV_V2_CATEGORIES) expect(ADV_V3_CASES.filter((k) => k.category === c).length, c).toBeGreaterThanOrEqual(7);
    for (const k of ADV_V3_CASES) {
      expect(k.why.length, k.id).toBeGreaterThan(10);
      expect(k.also ?? [], k.id).not.toContain("pay");
    }
    expect(ADV_V3_CASES.filter((k) => k.truth !== "hold").length).toBeGreaterThanOrEqual(40);
  });

  it("copies no v2 case: no id, no printed invoice and no invoice number is v2's", () => {
    const v2 = { ids: new Set(ADV_V2_CASES.map((k) => k.id)), texts: new Set(ADV_V2_CASES.map((k) => printed(k.doc))), nos: new Set(ADV_V2_CASES.map((k) => k.doc.no)) };
    for (const k of ADV_V3_CASES) {
      expect(v2.ids.has(k.id), k.id).toBe(false);
      expect(v2.texts.has(printed(k.doc)), k.id).toBe(false);
      expect(v2.nos.has(k.doc.no), k.id).toBe(false);
    }
  });

  it("prints sums that add up unless the case says otherwise, and hands over the fields it prints", () => {
    for (const k of ADV_V3_CASES) {
      const s = sumsOf(k.doc);
      if (s && !k.doc.sums) expect(Math.round(Number(s.subtotal) * 100) + Math.round(Number(s.tax) * 100), k.id).toBe(Math.round(Number(k.doc.total) * 100));
      expect(readingOf(k).total, k.id).toBe(k.doc.total);
    }
  });
});

describe("the v3 run", () => {
  // 19 Nov, second round: rules were added against v3's misses, so v3 is no longer held out. Its first run stays as
  // recorded ("before the second round of fixes"); the run on today's code is its own record ("after"), and the case
  // file never changed.
  it("the committed after-fix record is what a fresh run adds up to, no longer held out (npm run eval:adversarial-v3)", async () => {
    const committed = JSON.parse(readFileSync(new URL("../docs/evals/adversarial-v3-rerun-2026-11-19.json", import.meta.url), "utf8")) as { line: string; rows: AdvRow[]; totals: unknown; held_out: boolean; previous_after: string; cases_commit: string };
    const r = await adversarialV2(ADV_V3_CASES);
    expect(r.rows).toHaveLength(ADV_V3_CASES.length * ADV_ARMS.length);
    expect(committed.totals).toEqual(r.totals);
    expect(committed.rows).toEqual(r.rows);
    expect(committed.line).toBe(advLine(r.totals, ""));
    expect(committed).toMatchObject({ held_out: false, cases_commit: "1013ecc8" });
    // 19 Nov, fourth round: the run on today's code is a dated re-run; the after-fix run before it is kept as recorded.
    expect(committed.previous_after).toBe("docs/evals/adversarial-v3-after.json");
    // The report lists every miss of the payer with Purser's rules, after and before.
    const md = readFileSync(new URL("../docs/evals/adversarial-v3.md", import.meta.url), "utf8");
    for (const x of r.rows.filter((y) => y.arm === "purser_script" && !y.right)) expect(md, x.case).toContain(`| ${x.case} | ${x.category} | ${x.truth} | ${x.outcome} |`);
  }, 60_000); // 200 runs of the payables checks (two arms, 100 cases): over 5 s on a loaded CI runner

  it("keeps the held-out run before the second round as it was recorded: 11 wrong payments, 7 false holds, on the cases of 1013ecc8", () => {
    const before = JSON.parse(readFileSync(new URL("../docs/evals/adversarial-v3.json", import.meta.url), "utf8")) as { line: string; held_out: boolean; cases_commit: string; rows: AdvRow[]; totals: Record<string, { wrong_payments: number; false_holds: number }> };
    expect(before).toMatchObject({ held_out: true, cases_commit: "1013ecc8" });
    expect(before.totals.purser_script).toMatchObject({ wrong_payments: 11, false_holds: 7 });
    expect(before.totals.purser_script_parser).toMatchObject({ wrong_payments: 11, false_holds: 7 });
    expect(before.totals.no_rules).toMatchObject({ wrong_payments: 74 });
    const md = readFileSync(new URL("../docs/evals/adversarial-v3.md", import.meta.url), "utf8");
    expect(md).toContain("**v3 is no longer held out.**");
    expect(md).toContain("**Before the second round of fixes**");
    expect(md).toContain(before.line);
    for (const x of before.rows.filter((y) => y.arm === "purser_script" && !y.right)) expect(md, x.case).toContain(`| ${x.case} | ${x.category} | ${x.truth} | ${x.outcome} |`);
  });

  it("the case file is byte for byte the one committed before the first run (1013ecc8)", () => {
    const sha = createHash("sha256").update(readFileSync(new URL("../src/evals/adversarialV3Cases.ts", import.meta.url))).digest("hex");
    expect(sha).toBe("067dc95a618863b2b2b96821e860d52636c963b86a2e1c9ccdaef738f5b373c2");
  });
});
