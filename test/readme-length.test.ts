// Jury panel, 15 Nov: "the README is 6,255 words". About 2,500 since: the first screen as #374 made it, the quick start,
// verify-it-yourself and what is live and what is simulated stay; the long sections are docs/ files, one line each.
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { README_DOCS, movedBody, readmeFull } from "./readmeFull.js";

const README = readFileSync(new URL("../README.md", import.meta.url), "utf8");
const words = (s: string) => s.split(/\s+/).filter(Boolean).length;

describe("the README, short (15 Nov)", () => {
  // 2,646 as built after #383 (Clarity 2) on main; the pin of 2,620 had been set before its last lines went in.
  it("is about 2,500 words (2,646 as this test counts them), down from 6,255", () => {
    expect(words(README)).toBeLessThanOrEqual(2660);
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
