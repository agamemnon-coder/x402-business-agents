import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The badge row under the README's first lines: at most five badges, no logos of others, and the tests badge says the
// same count as the README's own test line (which in turn is the real `npx vitest run` count).
const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
const badgeLine = readme.split("\n").find((l) => l.includes("actions/workflows/ci.yml/badge.svg")) ?? "";
const pkgNode = (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { engines: { node: string } }).engines.node;

describe("README badges", () => {
  it("has at most five badges, on one line", () => {
    const badges = badgeLine.match(/!\[[^\]]*\]\(/g) ?? [];
    expect(badges.length).toBeGreaterThan(1);
    expect(badges.length).toBeLessThanOrEqual(5);
  });

  it("uses no logos", () => {
    expect(badgeLine).not.toMatch(/[?&]logo=/);
  });

  // Since 13 Nov (the README upgrade): four real badges, CI, CodeQL, the licence and the Node version package.json
  // requires. No tests badge: the count is the README's line, from docs/assets/test-summary.json (npm run test-count).
  it("is four badges: CI, CodeQL, the licence and the Node version; the count is in the README's test line", () => {
    expect([...badgeLine.matchAll(/\[!\[([^\]]+)\]/g)].map((m) => m[1])).toEqual(["CI", "CodeQL", "License: MIT", `Node: ${pkgNode}`]);
    expect(badgeLine).toContain("actions/workflows/github-code-scanning/codeql/badge.svg");
    expect(badgeLine).toContain(`https://img.shields.io/badge/node-${encodeURIComponent(pkgNode).replace(/%20/g, "%20")}-339933`);
    expect(badgeLine).not.toMatch(/badge\/tests-/);
    expect(readme).toMatch(/\*\*\d+ tests passing\*\*/);
  });

  // The three buttons above the badges (13 Nov): the tour, the hands-on demo (one Try URL everywhere, kit11 /try) and the
  // film; then the rails and "test money only" as plain text.
  it("puts three buttons above the badges: the tour, Try it on the hands-on demo, the film; and says test money only", () => {
    const buttons = readme.split("\n").find((l) => l.includes("Take_the_tour")) ?? "";
    expect([...buttons.matchAll(/<a href="([^"]+)">/g)].map((m) => m[1])).toEqual(["https://kit11.max-31b.workers.dev/tour", "https://kit11.max-31b.workers.dev/try", "https://youtu.be/kCUsFHrxE-o"]);
    expect(buttons).not.toContain("purser-try");
    expect(readme.indexOf(buttons)).toBeLessThan(readme.indexOf(badgeLine));
    expect(readme).toContain("Metal testnet · Airwallex sandbox · Visa via Airwallex Airi (sandbox) · Claude: test money only.");
  });
});
