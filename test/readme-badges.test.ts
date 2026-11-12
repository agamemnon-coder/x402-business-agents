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

  it("states the same test count as the README's test line", () => {
    const line = readme.match(/\*\*(\d+) tests in \d+ files, all passing\*\*/);
    const badge = badgeLine.match(/badge\/tests-(\d+)%20passing/);
    expect(line).not.toBeNull();
    expect(badge).not.toBeNull();
    expect(badge![1]).toBe(line![1]);
  });

  // Since 12 Nov (one Try everywhere) the live demo badge opens the hands-on demo, not /try/sign.
  it("links the live demo to the hands-on demo and says test money only", () => {
    expect(badgeLine).toContain("(https://purser-try.max-31b.workers.dev/try)");
    expect(badgeLine).toContain("Metal%20testnet%20%C2%B7%20Airwallex%20sandbox");
  });
});
