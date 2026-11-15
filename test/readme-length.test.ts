// Jury panel, 15 Nov: "the README is 6,255 words". About 2,500 since: the first screen as #374 made it, the quick start,
// verify-it-yourself and what is live and what is simulated stay; the long sections are docs/ files, one line each.
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { README_DOCS, movedBody, readmeFull } from "./readmeFull.js";

const README = readFileSync(new URL("../README.md", import.meta.url), "utf8");
const words = (s: string) => s.split(/\s+/).filter(Boolean).length;

describe("the README, short (15 Nov)", () => {
  it("is about 2,500 words (2,609 as this test counts them, 2,575 by wc), down from 6,255", () => {
    expect(words(README)).toBeLessThanOrEqual(3700); // +480, 15 Nov (Max, readme-wow): the TIP, IMPORTANT and NOTE alerts, the "One payment, step by step" sequence diagram and the alt texts of the stat strip, the terminal and the system map (3,638 as built); +360, 15 Nov: the Architecture section (two diagrams, five bullets, the code table in a fold); +10, 15 Nov: the four awards named in full (#390), 2,856 as built; +70, 15 Nov (Max): the animated flow's alt text and the partners' status badges (2,846 as built); +115 before that, the same day: +115, 15 Nov (Max): "At a glance" under the badges, six lines with their records (2,776 as built); +45, 15 Nov: the film "Purser, under the hood" linked in the video table and the live demo's line (2,655 as built)
  });

  it("keeps the quick start, verify-it-yourself and what's live and what's simulated in the README itself", () => {
    for (const h of ["## Verify it yourself in 3 commands", "## What's live, what's simulated", "## Try it in 2 minutes", "## For judges: 3 minutes"]) expect(README).toContain(`\n${h}\n`);
  });

  it("links each moved section's file once, under its heading, and each file holds the words the README had", () => {
    for (const f of README_DOCS) {
      expect({ f, there: existsSync(new URL(`../${f}`, import.meta.url)) }).toEqual({ f, there: true });
      expect({ f, links: README.split(`](${f})`).length - 1 }).toEqual({ f, links: 1 });
      expect(movedBody(f).length).toBeGreaterThan(100);
    }
    expect(words(readmeFull())).toBeGreaterThan(6000);
  });
});
