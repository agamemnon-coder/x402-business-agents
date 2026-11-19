// The adversarial eval v5 (src/evals/adversarialV5Cases.ts, run by src/evals/adversarialV2.ts in v5's world,
// src/evals/adversarialV5.ts): 100 held-out cases written after the third round of fixes (against v4's misses),
// committed alone with their pre-registration before any run (9e8d59c1). The case set is what it says it is, no case
// copies a v2, v3 or v4 case, and the committed record is what a fresh run adds up to. Offline: a script stands in for
// the model.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ADV_ARMS, adversarialV2, advLine, type AdvRow } from "../src/evals/adversarialV2.js";
import { ADV_V2_CASES, ADV_V2_CATEGORIES, printed, readingOf, sumsOf, type AdvCase } from "../src/evals/adversarialV2Cases.js";
import { ADV_V3_CASES } from "../src/evals/adversarialV3Cases.js";
import { ADV_V4_CASES } from "../src/evals/adversarialV4Cases.js";
import { V5_ON_FILE, V5_WORLD } from "../src/evals/adversarialV5.js";
import { ADV_V5_CASES } from "../src/evals/adversarialV5Cases.js";
import { ibanValid } from "../src/ap/reading.js";

describe("the v5 case set", () => {
  it("is 100 cases with unique ids, every category covered, each with a truth and why, and at least 40 clean truths to measure false holds", () => {
    expect(ADV_V5_CASES).toHaveLength(100);
    expect(new Set(ADV_V5_CASES.map((k) => k.id)).size).toBe(100);
    for (const c of ADV_V2_CATEGORIES) expect(ADV_V5_CASES.filter((k) => k.category === c).length, c).toBeGreaterThanOrEqual(7);
    for (const k of ADV_V5_CASES) {
      expect(k.why.length, k.id).toBeGreaterThan(10);
      expect(k.also ?? [], k.id).not.toContain("pay");
    }
    expect(ADV_V5_CASES.filter((k) => k.truth !== "hold").length).toBeGreaterThanOrEqual(40);
  });

  it("is multilingual: Dutch, German, French and Spanish words, and Greek, Cyrillic, Chinese, Japanese and Arabic script", () => {
    const text = ADV_V5_CASES.map((k) => printed(k.doc)).join("\n");
    for (const [lang, word] of [["nl", /\bfactuur\b/], ["de", /\bBankverbindung\b/], ["fr", /\bcompte\b/], ["es", /\bcuenta\b/]] as const) expect(word.test(text), lang).toBe(true);
    for (const [script, re] of [["Greek", /\p{Script=Greek}/u], ["Cyrillic", /\p{Script=Cyrillic}/u], ["Han", /\p{Script=Han}/u], ["Japanese kana", /\p{Script=Katakana}/u], ["Arabic", /\p{Script=Arabic}/u]] as const) expect(re.test(text), script).toBe(true);
  });

  it("copies no v2, v3 or v4 case: no id, no printed invoice and no invoice number is theirs", () => {
    const old = [...ADV_V2_CASES, ...ADV_V3_CASES, ...ADV_V4_CASES];
    const seen = { ids: new Set(old.map((k) => k.id)), texts: new Set(old.map((k) => printed(k.doc))), nos: new Set(old.map((k) => k.doc.no)) };
    for (const k of ADV_V5_CASES) {
      expect(seen.ids.has(k.id), k.id).toBe(false);
      expect(seen.texts.has(printed(k.doc)), k.id).toBe(false);
      expect(seen.nos.has(k.doc.no), k.id).toBe(false);
    }
    expect(new Set(ADV_V5_CASES.map((k) => k.doc.no)).size).toBe(100);
  });

  it("prints sums that add up (unless a case prints its own), hands over the fields it prints, and every IBAN passes its checksum; thirteen suppliers on file", () => {
    for (const k of ADV_V5_CASES) {
      const s = sumsOf(k.doc);
      if (s && !k.doc.sums) expect(Math.round(Number(s.subtotal) * 100) + Math.round(Number(s.tax) * 100), k.id).toBe(Math.round(Number(k.doc.total) * 100));
      expect(readingOf(k as AdvCase).total, k.id).toBe(k.doc.total);
      if (k.doc.iban) expect(ibanValid(k.doc.iban), k.id).toBe(true);
      for (const [from] of k.doc.edits ?? []) expect(printed({ ...k.doc, edits: [] }), k.id).toContain(from);
    }
    expect(V5_ON_FILE).toHaveLength(13);
  });

  it("the case file is byte for byte the one committed before the first run (9e8d59c1)", () => {
    const sha = createHash("sha256").update(readFileSync(new URL("../src/evals/adversarialV5Cases.ts", import.meta.url))).digest("hex");
    expect(sha).toBe("46b0c0a7ee0d93ba49fa7b87d2bb21871463569d3d7bb18eb57cfac9a1be9b83");
  });
});

describe("the v5 run", () => {
  it("the committed record is what a fresh run adds up to, held out, on the cases of their own commit (npm run eval:adversarial-v5)", async () => {
    const committed = JSON.parse(readFileSync(new URL("../docs/evals/adversarial-v5.json", import.meta.url), "utf8")) as { line: string; rows: AdvRow[]; totals: unknown; held_out: boolean; cases_commit: string };
    const r = await adversarialV2(ADV_V5_CASES, V5_WORLD);
    expect(r.rows).toHaveLength(ADV_V5_CASES.length * ADV_ARMS.length);
    expect(committed.totals).toEqual(r.totals);
    expect(committed.rows).toEqual(r.rows);
    expect(committed.line).toBe(advLine(r.totals));
    expect(committed).toMatchObject({ held_out: true, cases_commit: "9e8d59c1" });
    // The report lists every miss of the payer with Purser's rules, and of the one with Purser's parser.
    const md = readFileSync(new URL("../docs/evals/adversarial-v5.md", import.meta.url), "utf8");
    for (const x of r.rows.filter((y) => y.arm !== "no_rules" && !y.right)) expect(md, x.case).toContain(`| ${x.case} | ${x.category} | ${x.truth} | ${x.outcome} |`);
  }, 60_000); // 200+ runs of the payables checks: over 5 s on a loaded CI runner
});
