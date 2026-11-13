import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The badge row under the README's first lines: at most five badges, no logos of others, and the tests badge says the
// same count as the README's own test line (which in turn is the real `npx vitest run` count).
const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
const badgeLine = readme.split("\n").find((l) => l.includes("actions/workflows/ci.yml/badge.svg")) ?? "";

describe("README badges", () => {
  it("has at most five badges, on one line", () => {
    const badges = badgeLine.match(/!\[[^\]]*\]\(/g) ?? [];
    expect(badges.length).toBeGreaterThan(1);
    expect(badges.length).toBeLessThanOrEqual(5);
  });

  it("uses no logos", () => {
    expect(badgeLine).not.toMatch(/[?&]logo=/);
  });

  // Since 13 Nov (second review): three badges, CI, license and the live demo. No tests badge: the count is the README's
  // line, written from docs/assets/test-summary.json by npm run test-count (test/test-count.test.ts).
  it("is three badges: CI, license and the live demo; the count is in the README's test line, not a badge", () => {
    expect([...badgeLine.matchAll(/\[!\[([^\]]+)\]/g)].map((m) => m[1])).toEqual(["CI", "License: MIT", "Live demo: hands-on"]);
    expect(badgeLine).not.toMatch(/badge\/tests-/);
    expect(readme).toMatch(/\*\*\d+ tests passing\*\*/);
  });

  // Since 12 Nov (one Try everywhere) the live demo badge opens the hands-on demo, not /try/sign.
  it("links the live demo to the hands-on demo and says test money only", () => {
    // Jury pass, 13 Nov: one Try URL everywhere (kit11 /try).
    expect(badgeLine).toContain("(https://kit11.max-31b.workers.dev/try)");
    expect(badgeLine).not.toContain("purser-try");
    // The rails and "test money only" moved from a badge to plain text under the badges (13 Nov).
    expect(readme).toContain("Metal testnet · Airwallex sandbox · Visa via Airwallex Airi (sandbox) · Claude: test money only.");
  });
});
