// The README's animated flow (15 Nov, Max): two SVGs under the banner, light and dark, drawn by
// scripts/readme-flow-svg.ts. CSS animation only (GitHub shows an SVG in an <img>, where scripts never run), under
// 60 KB each, the amount from the Airwallex two-locks run's record, and said to be an illustration.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FLOW_FILES, flowAmounts, flowSvg } from "../scripts/readme-flow-svg.js";
import { readmeFull } from "./readmeFull.js";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

describe("the README's animated flow", () => {
  it("is what the script draws, for both themes, small and without script", () => {
    for (const t of ["light", "dark"] as const) {
      const svg = read(FLOW_FILES[t]);
      expect(svg).toBe(flowSvg(t));
      expect(Buffer.byteLength(svg)).toBeLessThan(60 * 1024);
      expect(svg).not.toMatch(/<script|on[a-z]+=|<foreignObject|href="http/i);
      expect(svg).toMatch(/@keyframes/);
      expect(svg).toContain("An illustration of the flow · test money");
    }
  });

  it("pays the two-locks run's amount and refuses it one cent higher", () => {
    const a = flowAmounts();
    expect(a).toEqual({ paid: "EUR 240.00", changed: "EUR 240.01" });
    expect(read("docs/runs/2026-11-12-airwallex-two-locks-paid.md")).toContain("240.00");
    for (const t of ["light", "dark"] as const) for (const x of [a.paid, a.changed, "Airwallex card controls", "Alta mandate", "CFO passkey", "SHA-256 of the exact terms", "signature no longer matches"]) expect(read(FLOW_FILES[t])).toContain(x);
  });

  // 21 Nov 2026, Max: "tags and logo on top, a small demo, the 3 steps; the second architecture animation can go; far fewer headings": the README opens with the logo, the tags, the small demo (scripts/readme-demo-svg.ts) and the three steps;
  // the banner and this flow moved to the gallery (docs/gallery.md), still one line.
  it("sits under the banner in the gallery, dark and light", () => {
    expect(read("README.md")).not.toContain("docs/assets/hero/flow-light.svg");
    expect(readmeFull()).toContain('<br><picture><source media="(prefers-color-scheme: dark)" srcset="docs/assets/hero/flow-dark.svg"><img src="docs/assets/hero/flow-light.svg"');
  });
});
