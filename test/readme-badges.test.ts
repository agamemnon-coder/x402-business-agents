import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The badge row under the README's first lines: at most five badges, no logos of others, and the tests badge says the
// same count as the README's own test line (which in turn is the real `npx vitest run` count).
const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
const badgeLine = readme.split("\n").find((l) => l.includes("actions/workflows/ci.yml/badge.svg")) ?? "";
const pkgNode = (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { engines: { node: string } }).engines.node;

describe("README badges", () => {
  // One row since 13 Nov (owner, after the live README); every badge real or read from the repository (13 with T:0 and
  // the MCP Registry listing).
  it("has at most thirteen badges, on one line", () => {
    const badges = badgeLine.match(/!\[[^\]]*\]\(/g) ?? [];
    expect(badges.length).toBeGreaterThan(1);
    expect(badges.length).toBeLessThanOrEqual(13);
  });

  it("uses no logos", () => {
    expect(badgeLine).not.toMatch(/[?&]logo=/);
  });

  // Since 13 Nov (owner, after the live README): CI and CodeQL (GitHub's own), the tests from docs/assets/test-summary.json
  // on main (a dynamic badge, so it cannot drift), MIT, the Node version package.json requires, TypeScript strict as
  // tsconfig.json sets it, the MCP server, and one static shield per partner in the site's own colours, no logos.
  it("is CI, CodeQL, the tests read from test-summary.json, MIT, Node, TypeScript strict, the MCP server and the four partners", () => {
    expect([...badgeLine.matchAll(/\[!\[([^\]]+)\]/g)].map((m) => m[1])).toEqual(["CI", "CodeQL", "Tests: from docs/assets/test-summary.json", "License: MIT", `Node: ${pkgNode}`, "TypeScript: strict", "MCP server: read, propose only", "MCP Registry: io.github.agamemnon-coder/purser", "Airwallex: sandbox", "Metal: testnet", "Visa: VIC via Airi", "Claude: Haiku, Sonnet, Opus", "T:0: sandbox ledger"]); // T:0 since 13 Nov (owner)
    expect(badgeLine).toContain("actions/workflows/github-code-scanning/codeql/badge.svg");
    // The official MCP Registry's entry (active since 13 Nov 2026), under the name server.json publishes.
    const registered = (JSON.parse(readFileSync(new URL("../server.json", import.meta.url), "utf8")) as { name: string }).name;
    expect(registered).toBe("io.github.agamemnon-coder/purser");
    expect(badgeLine).toContain(`(https://registry.modelcontextprotocol.io/v0/servers?search=${registered})`);
    expect(badgeLine).toContain("https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Fagamemnon-coder%2Fx402-business-agents%2Fmain%2Fdocs%2Fassets%2Ftest-summary.json&query=%24.passed");
    expect(badgeLine).toContain(`https://img.shields.io/badge/node-${encodeURIComponent(pkgNode)}-339933`);
    expect((JSON.parse(readFileSync(new URL("../tsconfig.json", import.meta.url), "utf8")) as { compilerOptions: { strict: boolean } }).compilerOptions.strict).toBe(true);
    expect(badgeLine).not.toMatch(/badge\/tests-\d/);
    expect(badgeLine).not.toMatch(/[?&]logo=/);
    expect(readme).toMatch(/\*\*\d+ tests passing\*\*/);
  });

  // The buttons above the badges (13 Nov, judge run): sign in 60 seconds on /try/sign, run the payables inbox on /try
  // (one Try URL everywhere), the film; then the rails and "test money only" as plain text.
  // 13 Nov, evening (owner): the product tour is gone, and its button with it.
  it("puts three buttons above the badges: /try/sign, the payables inbox on /try, the film; and says test money only", () => {
    const buttons = readme.split("\n").find((l) => l.includes("Watch_the_film")) ?? "";
    expect([...buttons.matchAll(/<a href="([^"]+)">/g)].map((m) => m[1])).toEqual(["https://kit11.max-31b.workers.dev/try/sign", "https://kit11.max-31b.workers.dev/try", "https://youtu.be/kCUsFHrxE-o"]);
    expect([...buttons.matchAll(/alt="([^"]+)"/g)].map((m) => m[1])).toEqual(["Sign in 60 seconds", "Run the payables inbox, 2 minutes", "Watch the film, 3:58"]);
    expect(buttons).not.toContain("purser-try");
    expect(readme.indexOf(buttons)).toBeLessThan(readme.indexOf(badgeLine));
    expect(readme).toContain("Metal testnet · Airwallex sandbox · Visa via Airwallex Airi (sandbox) · Claude: test money only.");
  });
});
