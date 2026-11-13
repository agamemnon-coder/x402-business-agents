// The promo film (src/film/promo.ts): every figure is found in its record, the counts are read from the reports, the
// timing fits 60–75 s, the narration is 120–150 words and fits its slots, and nothing it shows names someone it must
// not or uses a fraction.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { LABELS, LINES, ROOT, SCENES, TOTAL, checkPromo, promoData, promoSrt } from "../src/film/promo.js";

describe("the promo film", () => {
  it("passes its own check", () => {
    expect(checkPromo()).toEqual([]);
  });

  it("reads the zero-trust and hostile-model counts from their reports", () => {
    const zt = JSON.parse(readFileSync(resolve(ROOT, "docs/zero-trust/report.json"), "utf8"));
    const ho = JSON.parse(readFileSync(resolve(ROOT, "docs/evals/ap-hostile.json"), "utf8"));
    const d = promoData();
    expect(d.attacks.run.text).toBe(String(zt.attacks_run));
    expect(d.attacks.moved.text).toBe(String(zt.attacks_where_money_moved));
    expect(d.hostile.calls.text).toBe(String(ho.calls));
    expect(d.hostile.unsafe.text).toBe(String(ho.unsafe));
  });

  it("is 60–75 s, its scenes fill it, and the narration is 120–150 words", () => {
    expect(TOTAL).toBeGreaterThanOrEqual(60);
    expect(TOTAL).toBeLessThanOrEqual(75);
    expect(SCENES[0]!.from).toBe(0);
    expect(SCENES.at(-1)!.to).toBe(TOTAL);
    const n = LINES.map((l) => l.words).join(" ").split(/\s+/).length;
    expect(n).toBeGreaterThanOrEqual(120);
    expect(n).toBeLessThanOrEqual(150);
  });

  it("labels what is simulated and that partners are named in text only", () => {
    expect(LABELS.money).toBe("Test money · sandbox/testnet");
    expect(LABELS.endorse).toContain("No endorsement implied");
  });

  it("types no figure into the scenes: promo.html takes every value from the records", () => {
    // Colours (rgba) and styles carry decimals of their own; the check reads the rest.
    const html = readFileSync(resolve(ROOT, "src/film/promo.html"), "utf8").replace(/<style>[\s\S]*?<\/style>/, "").replace(/rgba?\([^)]*\)|style="[^"]*"/g, "");
    for (const s of ["45.00", "30.00", "240.00", "4074d684", "aaaf56a1", "LIMIT_EXCEEDED", "IN_APPROVAL", "380", ">52<"]) expect(html).not.toContain(s);
    expect(html).not.toMatch(/<img[^>]+(airwallex|metal|visa|claude)/i);
  });

  it("writes one subtitle per line, in order", () => {
    const srt = promoSrt();
    expect(srt.match(/-->/g)!.length).toBe(LINES.length);
    expect(srt.startsWith("1\n00:00:00,500 --> ")).toBe(true);
    expect(srt).toContain("Purser. Try it yourself.");
  });
});
