// The claims of the hands-on demo (C6): one sentence for what Purser Cloud does with money, everywhere it is said; the
// hands-on link "coming" until the orchestrator flips it; and in the hands-on docs, the words that would overclaim
// ("real money", "Airwallex", "Metal", "streamed", "three agents") only next to what ran.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { HANDS_ON_LIVE, HOLDS_SANDBOX_KEY, MONEY_SENTENCE } from "../cloud/src/try/claims.js";

/** A file's text with comment markers and line breaks folded into single spaces. */
const flat = (path: string) => readFileSync(path, "utf8").replace(/^\s*(\/\/|#|\*)\s?/gm, " ").replace(/\s+/g, " ");
const SITES = ["docs/cloud.md", "docs/runbook.md", "src/cloudsync/client.ts", "docs/archive/superpowers/specs/2026-11-08-backend-design.md"];

describe("what Purser Cloud does with money", () => {
  it("is said in one sentence everywhere, from one constant", () => {
    for (const f of SITES) expect(flat(f), f).toContain(MONEY_SENTENCE);
    expect(MONEY_SENTENCE.includes("Airwallex sandbox key")).toBe(HOLDS_SANDBOX_KEY);
  });

  it("is never the old sentence again", () => {
    for (const f of [...SITES, "README.md", "llms.txt", "docs/go-live.md", "docs/after-the-kit.md", "docs/decisions.md", "docs/claims.md"]) {
      expect(flat(f), f).not.toMatch(/never moves money|holds no payment keys|cannot move money|only stores and shows/i);
    }
  });
});

describe("the hands-on link", () => {
  // The README's first lines are pinned by their own tests: its line is added when the link goes live (after G5).
  it("says coming, and names no address, until it is switched live; then links /try", () => {
    for (const f of ["llms.txt"]) {
      const line = readFileSync(f, "utf8").split("\n").find((l) => l.includes("Hands-on on Purser's real engine"));
      expect(line, f).toBeDefined();
      if (!HANDS_ON_LIVE) {
        expect(line, f).toMatch(/coming/);
        expect(line, f).not.toMatch(/purser-try|https?:/);
      } else {
        expect(line, f).toContain("https://kit11.max-31b.workers.dev/try");
        expect(line, f).not.toMatch(/coming/);
      }
    }
  });
});

describe("the hands-on docs", () => {
  const section = () => {
    const t = readFileSync("docs/cloud.md", "utf8");
    const from = t.indexOf("## The hands-on deployment");
    return t.slice(from, t.indexOf("\n## ", from + 5));
  };
  const sentences = () => section().replace(/\s+/g, " ").split(/(?<=[.:])\s+(?=[A-Z*`-])/);

  it("names real money only to say there is none", () => {
    for (const s of sentences().filter((x) => /real money/i.test(x))) expect(s).toMatch(/\bno real money\b|real money;|What is not there/);
  });

  it("names Airwallex and Metal only as not there, or as a leg built only if its gate passes", () => {
    for (const s of sentences().filter((x) => /Airwallex|Metal/.test(x))) expect(s, s).toMatch(/not there|only if|sandbox key/);
  });

  it("never says streamed or three agents", () => {
    expect(section()).not.toMatch(/streamed|three agents/i);
  });

  it("says what is not there, and what a public launch still needs", () => {
    expect(section()).toMatch(/What is not there/);
    expect(section()).toMatch(/bot check/);
    // 12 Nov (jury check): the empty template dated the next day is gone; no measured limits are claimed.
    expect(section()).not.toMatch(/2026-11-13-engine-in-cloud|Measured limits/);
  });
});
