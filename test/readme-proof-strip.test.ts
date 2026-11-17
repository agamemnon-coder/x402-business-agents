// The proof strip under the README's title (scripts/readme-proof-strip.ts, 17 Nov): drawn from the records, never typed.
// It is redrawn here and must equal the committed SVGs; each figure is read from its record; the README's alt text says
// what the picture shows; and, as GitHub shows it in an <img>, it carries no script and no external link, animates once,
// and reduced motion stops it.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { latestVerification, proofStripSvg, STRIP_FILES, stripAlt, stripFigures } from "../scripts/readme-proof-strip.js";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

describe("the README's proof strip", () => {
  it("is the committed SVGs, redrawn from the records (light and dark)", () => {
    // Fails if: a record changed and `npm run readme:strip` was not run.
    for (const theme of ["light", "dark"] as const) expect({ theme, same: read(STRIP_FILES[theme]) === proofStripSvg(theme) }).toEqual({ theme, same: true });
  });

  it("reads each figure from its record", () => {
    const t = JSON.parse(read("docs/assets/test-summary.json")) as { passed: number; total: number };
    const v = JSON.parse(read(latestVerification())) as { summary: string };
    const r = JSON.parse(read("docs/redteam/report.json")) as { attempts: number; blocked: number; caught_after: number; not_blocked: number };
    const f = stripFigures();
    expect(f.tests.passed).toBe(t.passed);
    expect(f.tests.total).toBe(t.total);
    expect(v.summary).toBe(`${f.verification.passed} checks passed, ${f.verification.couldNotRun} could not run here, ${f.verification.failed} failed`);
    expect(f.redteam).toMatchObject({ attempts: r.attempts, stopped: r.blocked - r.caught_after, caughtAfter: r.caught_after, through: r.not_blocked });
    const svg = read(STRIP_FILES.light);
    for (const s of [t.passed.toLocaleString("en-US"), `>${f.verification.passed}<`, `${f.redteam.stopped} of ${f.redteam.attempts}`, "Alta (formerly Metal)", "Test money only", "test world"]) expect({ s, shown: svg.includes(s) }).toEqual({ s, shown: true });
  });

  it("is shown under the title with the alt text the generator writes, linked to /proof", () => {
    const readme = read("README.md");
    expect(readme).toContain(`<a href="https://kit11.max-31b.workers.dev/proof"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/assets/readme/proof-strip-dark.svg"><img src="docs/assets/readme/proof-strip-light.svg" alt="${stripAlt()}" width="100%"></picture></a>`);
    // The README's own test line says the same count.
    expect(readme).toContain(`**${stripFigures().tests.passed} tests passing**`);
  });

  it("has a title and description, no script or external link, one short animation that reduced motion stops", () => {
    for (const theme of ["light", "dark"] as const) {
      const svg = read(STRIP_FILES[theme]);
      expect(svg).toContain('<title id="t">Purser: proof from the records</title>');
      expect(svg).toMatch(/<desc id="d">[^<]{200,}<\/desc>/);
      expect(/<script|on[a-z]+=|<foreignObject|javascript:|<image/i.test(svg)).toBe(false);
      expect(/(?:xlink:)?href="(?!#)|src="|url\((?!#)|@import|="https?:\/\/(?!www\.w3\.org\/2000\/svg")/.test(svg)).toBe(false);
      expect(Buffer.byteLength(svg)).toBeLessThan(16 * 1024);
      expect(svg).toMatch(/@media \(prefers-reduced-motion:reduce\)\{[^}]*animation:none/);
      expect(svg).not.toMatch(/infinite/);
      // Played once and done by 2 s: the latest entrance (delay + 0.5 s) and the bars (1.1 s + 0.7 s).
      const delays = [...svg.matchAll(/animation-delay:([\d.]+)s/g)].map((m) => Number(m[1]));
      expect(delays.length).toBeGreaterThanOrEqual(9);
      expect(Math.max(...delays) + 0.5).toBeLessThanOrEqual(2);
      expect(svg).toContain("animation:grow .7s cubic-bezier(.2,.7,.3,1) 1.1s both");
    }
  });
});
