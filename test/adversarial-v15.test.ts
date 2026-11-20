// The adversarial eval v15 (src/evals/adversarialV15Cases.ts, run by src/evals/adversarialV2.ts in v15's world,
// src/evals/adversarialV15.ts): 131 held-out cases written after the fixes that followed eval v14, committed alone with
// their pre-registration before any run (V15_CASES_COMMIT). The case set is what it says it is, no case copies a v2 to
// v14 case, and the record is what a fresh run adds up to.
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
import { V15_CASES_COMMIT, V15_HYPOTHESES, V15_ON_FILE, V15_WORLD } from "../src/evals/adversarialV15.js";
import { ADV_V11_CASES } from "../src/evals/adversarialV11Cases.js";
import { ADV_V12_CASES } from "../src/evals/adversarialV12Cases.js";
import { ADV_V13_CASES } from "../src/evals/adversarialV13Cases.js";
import { ADV_V14_CASES } from "../src/evals/adversarialV14Cases.js";
import { ADV_V15_CASES } from "../src/evals/adversarialV15Cases.js";

const OLD = [...ADV_V2_CASES, ...ADV_V3_CASES, ...ADV_V4_CASES, ...ADV_V5_CASES, ...ADV_V6_CASES, ...ADV_V7_CASES, ...ADV_V8_CASES, ...ADV_V9_CASES, ...ADV_V10_CASES, ...ADV_V11_CASES, ...ADV_V12_CASES, ...ADV_V13_CASES, ...ADV_V14_CASES];

describe("the v15 case set", () => {
  it("is 131 cases with unique ids, every category covered, each with a truth and why, and at least 45 legitimate truths outside the split category", () => {
    expect(ADV_V15_CASES).toHaveLength(131);
    expect(new Set(ADV_V15_CASES.map((k) => k.id)).size).toBe(131);
    for (const c of ADV_V2_CATEGORIES) expect(ADV_V15_CASES.filter((k) => k.category === c).length, c).toBeGreaterThanOrEqual(7);
    for (const k of ADV_V15_CASES) {
      expect(k.why.length, k.id).toBeGreaterThan(5); // some whys are short ("As usual.")
      expect(k.also ?? [], k.id).not.toContain("pay");
    }
    expect(ADV_V15_CASES.filter((k) => k.truth !== "hold" && k.category !== "split_invoice").length).toBeGreaterThanOrEqual(45);
  });

  it("copies no v2 to v14 case: no id, no printed invoice and no invoice number is theirs; fifteen new suppliers on file", () => {
    const seen = { ids: new Set(OLD.map((k) => k.id)), texts: new Set(OLD.map((k) => printed(k.doc))), nos: new Set(OLD.map((k) => k.doc.no)) };
    for (const k of ADV_V15_CASES) {
      expect(seen.ids.has(k.id), k.id).toBe(false);
      expect(seen.texts.has(printed(k.doc)), k.id).toBe(false);
      expect(seen.nos.has(k.doc.no), k.id).toBe(false);
    }
    expect(new Set(ADV_V15_CASES.map((k) => k.doc.no)).size).toBe(131);
    expect(V15_ON_FILE).toHaveLength(136);
    const before = new Set(V15_ON_FILE.slice(0, 121).map((s) => s.name));
    expect(V15_ON_FILE.slice(121).every((s) => !before.has(s.name))).toBe(true);
  });

  it("prints sums that add up, hands over the fields it prints, and every IBAN passes its checksum", () => {
    for (const k of ADV_V15_CASES) {
      const s = sumsOf(k.doc);
      if (s && !k.doc.sums) expect(Math.round(Number(s.subtotal) * 100) + Math.round(Number(s.tax) * 100), k.id).toBe(Math.round(Number(k.doc.total) * 100));
      expect(readingOf(k as AdvCase).total, k.id).toBe(k.doc.total);
      if (k.doc.iban) expect(ibanValid(k.doc.iban), k.id).toBe(true);
      for (const [from] of k.doc.edits ?? []) expect(printed({ ...k.doc, edits: [] }), k.id).toContain(from);
    }
    for (const s of V15_ON_FILE.slice(121)) expect(ibanValid(s.bank!.iban!), s.id).toBe(true);
  });

  it("every hypothesis names cases of the set", () => {
    const ids = new Set(ADV_V15_CASES.map((k) => k.id));
    for (const h of V15_HYPOTHESES) {
      expect(h.ids.length, h.id).toBeGreaterThan(0);
      for (const id of h.ids) expect(ids.has(id), `${h.id} ${id}`).toBe(true);
    }
  });

  it("the case file is byte for byte the one committed before the first run", () => {
    const sha = createHash("sha256").update(readFileSync(new URL("../src/evals/adversarialV15Cases.ts", import.meta.url))).digest("hex");
    expect(sha).toBe("f8b62cb366ba6f07b4fd4f65e4171f9edcc40d00144d7aa95297ba0cfa962fc9");
    expect(V15_CASES_COMMIT).toMatch(/^[0-9a-f]{9}$/);
  });
});



describe("the v15 run", () => {
  it("the committed held-out record is what a fresh run adds up to (npm run eval:adversarial-v15)", async () => {
    const committed = JSON.parse(readFileSync(new URL("../docs/evals/adversarial-v15.json", import.meta.url), "utf8")) as { line: string; rows: AdvRow[]; totals: unknown; held_out: boolean; cases_commit: string; hypotheses: unknown };
    const r = await adversarialV2(ADV_V15_CASES, V15_WORLD);
    expect(committed.rows).toHaveLength(ADV_V15_CASES.length * ADV_ARMS.length);
    expect(committed.totals).toEqual(r.totals);
    expect(committed.rows).toEqual(r.rows);
    expect(committed.line).toBe(advLine(r.totals));
    expect(committed).toMatchObject({ held_out: true, cases_commit: V15_CASES_COMMIT });
    expect(committed.hypotheses).toEqual(roundHypotheses(V15_HYPOTHESES, r.rows));
  }, 240_000);
});
