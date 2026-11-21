// The README's mark is the site header's (owner, 13 Nov): the same feather paths as src/ui/nav.ts's MARK, white, 16 of
// 30 units, centred on a dark rounded square (#0b1220, radius 9 of 30), as header.top .brand .mark draws it.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readmeFull } from "./readmeFull.js";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const paths = (svg: string) => [...svg.matchAll(/<path d="([^"]+)"/g)].map((m) => m[1]);

describe("Purser's mark in the README and docs/assets", () => {
  const nav = read("src/ui/nav.ts"), mark = read("docs/assets/brand/purser-mark.svg");
  const header = /const MARK = '([^']+)'/.exec(nav)![1]!;
  const css = /header\.top \.brand \.mark \{([^}]+)\}/.exec(nav)![1]!;
  const icon = /header\.top \.brand \.mark svg \{ width: (\d+)px; height: (\d+)px; \}/.exec(nav)!;

  it("draws the header's feather, white on the header's dark square, in the header's proportions", () => {
    expect(paths(mark)).toEqual(paths(header));
    const size = Number(/width: (\d+)px/.exec(css)![1]), radius = Number(/border-radius: (\d+)px/.exec(css)![1]);
    expect(mark).toContain(`viewBox="0 0 ${size} ${size}"`);
    expect(mark).toContain(`<rect width="${size}" height="${size}" rx="${radius}" fill="#0b1220"/>`);
    expect(css).toContain("background: var(--text, #0b1220)");
    const inner = Number(icon[1]), off = (size - inner) / 2;
    expect(mark).toContain(`transform="translate(${off} ${off}) scale(${(inner / 24).toFixed(7)})"`);
    expect(mark).toContain('stroke="#ffffff"');
    expect(mark).not.toMatch(/#2dd4bf/i);
  });

  // Since the README upgrade (13 Nov, evening, owner) the README opens with a banner drawn from
  // scripts/readme-banner.html, whose tile carries this feather; the link-preview card carries it too.
  // 21 Nov 2026, Max: "tags and logo on top, a small demo, the 3 steps; the second architecture animation can go; far fewer headings": the README opens with this mark (docs/assets/brand/purser-mark*.svg, 64 px, linked to the site); the banner
  // moved to the gallery (docs/gallery.md).
  it("opens the README, and is the feather in the banner (in the gallery) and in the link-preview card: the same as the site header", () => {
    expect(read("README.md").split("\n").slice(0, 3)).toEqual(['<div align="center">', "", '<a href="https://kit11.max-31b.workers.dev/"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/assets/brand/purser-mark-dark.svg"><img src="docs/assets/brand/purser-mark.svg" alt="Purser" width="64" height="64"></picture></a>']);
    expect(readmeFull()).toContain('srcset="docs/assets/readme/banner-dark.png"><img src="docs/assets/readme/banner-light.png"');
    for (const d of paths(header)) expect(read("scripts/readme-banner.html")).toContain(d);
    for (const d of paths(header)) expect(read("docs/assets/social-preview.svg")).toContain(d);
  });

});
