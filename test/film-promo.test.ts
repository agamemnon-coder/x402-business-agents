// The promo film (src/film/promo.ts): every figure is found in its record, the counts are read from the reports, the
// timing fits 60–75 s, the narration is 90–150 words and fits its slots, and nothing it shows names someone it must
// not or uses a fraction.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { FILM_URL } from "../src/config/brand.js";
import { LABELS, LINES, ROOT, SCENES, SFX, TOTAL, WALKTHROUGH_URL, checkPromo, promoData, promoSrt } from "../src/film/promo.js";
import { V1 } from "../src/film/promoV1.js";
import { effect } from "../src/film/sfx.js";
import { hostileWords } from "../src/redesign/partners.js";

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

  it("is 60–75 s, its scenes fill it, and the narration is 90–150 words", () => {
    expect(TOTAL).toBeGreaterThanOrEqual(60);
    expect(TOTAL).toBeLessThanOrEqual(75);
    expect(SCENES[0]!.from).toBe(0);
    expect(SCENES.at(-1)!.to).toBe(TOTAL);
    const n = LINES.map((l) => l.words).join(" ").split(/\s+/).length;
    expect(n).toBeGreaterThanOrEqual(90);
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

  it("has a sound for every hit, inside the film, and ends on the walkthrough link from brand.ts", () => {
    expect(SFX.length).toBeGreaterThan(30);
    for (const x of SFX) expect(x.at).toBeLessThan(TOTAL);
    expect(WALKTHROUGH_URL).toBe(FILM_URL.replace("https://", ""));
  });

  it("synthesises its effects in code: every kind is finite and audible", () => {
    for (const kind of ["whoosh", "impact", "stamp", "tick", "swipe", "boom", "riser", "subdrop"] as const) {
      const [l] = effect(kind);
      const peak = l.reduce((m, x) => Math.max(m, Math.abs(x)), 0);
      expect(Number.isFinite(peak)).toBe(true);
      expect(peak).toBeGreaterThan(0.05);
    }
  });

  it("words the hostile-model split as the site does (src/redesign/partners.ts hostileWords), from the record", () => {
    const d = promoData();
    const site = hostileWords({ calls: Number(d.hostile.calls.text), tool: Number(d.hostile.tool.text), enforce: Number(d.hostile.enforce.text), refused: Number(d.hostile.refused.text), stood: 0, unsafe: Number(d.hostile.unsafe.text), cases: 0 });
    expect(site).toContain(`${d.hostile.tool.text} refused and ${d.hostile.enforce.text} made stricter: ${d.hostile.refused.text} stopped or tightened by code`);
    const html = readFileSync(resolve(ROOT, "src/film/promo.html"), "utf8");
    expect(html).toContain("stopped or tightened by code");
    expect(html).toContain("made stricter");
    expect(html).not.toContain("refused by code");
  });

  it("writes one subtitle per line, in order", () => {
    const srt = promoSrt();
    expect(srt.split("\n").filter((l) => /^\d{2}:\d{2}:\d{2},\d{3} \S+ \d{2}:/.test(l)).length).toBe(LINES.length);
    expect(srt.startsWith("1\n00:00:02,600 --> ")).toBe(true);
    expect(srt).toContain("Purser. Try it yourself.");
  });

  describe("v1.1 (Max preferred v1): v1's cut with the record fixes", () => {
    it("passes the same check: every figure in its record, 60–75 s, the spoken counts", () => {
      expect(checkPromo(V1)).toEqual([]);
      expect(V1.total).toBe(72);
    });

    it("has no sound effects and keeps v1's music placement", () => {
      expect(V1.sfx).toEqual([]);
      expect(V1.music).toEqual({ at: 1.0, from: 0 });
    });

    it("says the hostile-model split in the site's words, shows the walkthrough, and credits no effects", () => {
      const html = readFileSync(resolve(ROOT, V1.html), "utf8");
      expect(html).toContain("stopped or tightened by code");
      expect(html).toContain("made stricter");
      expect(html).not.toContain("refused by code");
      expect(html).toContain("Full walkthrough: ${B.walkthrough}");
      expect(html).toContain("L.creditsV1");
      expect(LABELS.creditsV1).not.toMatch(/effects/);
      for (const s of ["45.00", "30.00", "240.00", "4074d684", "aaaf56a1", "LIMIT_EXCEEDED", "IN_APPROVAL", "380", ">53<"]) expect(html.replace(/<style>[\s\S]*?<\/style>/, "")).not.toContain(s);
    });

    it("writes one subtitle per v1.1 line", () => {
      expect(promoSrt(V1).split("\n").filter((l) => /^\d{2}:\d{2}:\d{2},\d{3} \S+ \d{2}:/.test(l)).length).toBe(V1.lines.length);
    });
  });
});
