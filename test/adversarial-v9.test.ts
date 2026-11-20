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
  it("the committed record is what a fresh run adds up to, held out, on the cases of their own commit, with its hypotheses and the cost of unread text (npm run eval:adversarial-v9)", async () => {
    const committed = JSON.parse(readFileSync(new URL("../docs/evals/adversarial-v9.json", import.meta.url), "utf8")) as { line: string; rows: AdvRow[]; totals: unknown; held_out: boolean; cases_commit: string; hypotheses: unknown; sent_to_cfo_unread_where_pay: unknown };
    const r = await adversarialV2(ADV_V9_CASES, V9_WORLD);
    expect(r.rows).toHaveLength(ADV_V9_CASES.length * ADV_ARMS.length);
    expect(committed.totals).toEqual(r.totals);
    expect(committed.rows).toEqual(r.rows);
    expect(committed.line).toBe(advLine(r.totals));
    expect(committed).toMatchObject({ held_out: true, cases_commit: V9_CASES_COMMIT });
    expect(committed.hypotheses).toEqual(v9Hypotheses(ADV_V9_CASES, r.rows));
    expect(committed.sent_to_cfo_unread_where_pay).toEqual({ purser_script: unreadCost(r.rows, "purser_script"), purser_script_parser: unreadCost(r.rows, "purser_script_parser") });
    const md = readFileSync(new URL("../docs/evals/adversarial-v9.md", import.meta.url), "utf8");
    for (const x of r.rows.filter((y) => y.arm !== "no_rules" && !y.right)) expect(md, x.case).toContain(`| ${x.case} | ${x.category} | ${x.truth} | ${x.outcome} |`);
    expect(md).toContain("## The pre-registered hypotheses");
    expect(md).toContain("## The cost of sending unread text to the CFO");
  }, 240_000); // 420 runs of the payables checks

  it("reports v8 on the same code, labelled not held out, equal to a fresh run", async () => {
    const committed = JSON.parse(readFileSync(new URL("../docs/evals/adversarial-v9.json", import.meta.url), "utf8")) as { v8_on_this_code: { held_out: boolean; line: string; rows: AdvRow[]; totals: unknown; cases_commit: string } };
    const r = await adversarialV2(ADV_V8_CASES, V8_WORLD);
    expect(committed.v8_on_this_code).toMatchObject({ held_out: false, cases_commit: "7fabd5262", line: advLine(r.totals, "") });
    expect(committed.v8_on_this_code.totals).toEqual(r.totals);
    expect(committed.v8_on_this_code.rows).toEqual(r.rows);
    const md = readFileSync(new URL("../docs/evals/adversarial-v9.md", import.meta.url), "utf8");
    expect(md).toContain("## v8 on this code (not held out any more)");
    expect(md).toContain(advLine(r.totals, ""));
  }, 240_000);
});
