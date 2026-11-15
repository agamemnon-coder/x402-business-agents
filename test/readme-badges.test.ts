import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The badge row under the README's first lines: at most five badges, no logos of others, and the tests badge says the
// same count as the README's own test line (which in turn is the real `npx vitest run` count).
const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
const badgeLine = readme.split("\n").find((l) => l.includes("actions/workflows/ci.yml/badge.svg")) ?? "";

describe("README badges", () => {
  // One row since 13 Nov (owner, after the live README); every badge real or read from the repository (13 with T:0 and
  // the MCP Registry listing).
  it("has at most thirteen badges, on one line", () => {
    const badges = badgeLine.match(/!\[[^\]]*\]\(/g) ?? [];
    expect(badges.length).toBeGreaterThan(1);
    expect(badges.length).toBeLessThanOrEqual(5);
  });

  it("uses no logos", () => {
    expect(badgeLine).not.toMatch(/[?&]logo=/);
  });

  // Since 13 Nov (owner, after the live README): CI and CodeQL (GitHub's own), the tests from docs/assets/test-summary.json
  // on main (a dynamic badge, so it cannot drift), MIT, the Node version package.json requires, TypeScript strict as
  // tsconfig.json sets it, the MCP server, and one static shield per partner in the site's own colours, no logos.
  it("is CI, CodeQL, the tests read from test-summary.json, MIT and the MCP server; then a row of the five partners", () => {
    // 14 Nov (Max, the README and repo upgrade): CI, CodeQL, the tests, MIT and the MCP server; the partners on their own row.
    expect([...badgeLine.matchAll(/\[!\[([^\]]+)\]/g)].map((m) => m[1])).toEqual(["CI", "CodeQL", "Tests: from docs/assets/test-summary.json", "License: MIT", "MCP server: read, propose only"]);
    const partnerLine = readme.split("\n").find((l) => l.startsWith("[![Airwallex: sandbox]")) ?? "";
    expect([...partnerLine.matchAll(/\[!\[([^\]]+)\]/g)].map((m) => m[1])).toEqual(["Airwallex: sandbox", "Alta: testnet", "Visa: VIC via Airi", "T:0: sandbox ledger", "Claude: Haiku, Sonnet, Opus"]);
    expect(partnerLine).not.toMatch(/[?&]logo=/);
    expect(badgeLine).toContain("actions/workflows/github-code-scanning/codeql/badge.svg");
    expect(badgeLine).toContain("https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Fagamemnon-coder%2Fx402-business-agents%2Fmain%2Fdocs%2Fassets%2Ftest-summary.json&query=%24.passed");
    expect((JSON.parse(readFileSync(new URL("../tsconfig.json", import.meta.url), "utf8")) as { compilerOptions: { strict: boolean } }).compilerOptions.strict).toBe(true);
    expect(badgeLine).not.toMatch(/badge\/tests-\d/);
    expect(badgeLine).not.toMatch(/[?&]logo=/);
    expect(readme).toMatch(/\*\*\d+ tests passing\*\*/);
  });

  // The buttons above the badges, restored 13 Nov, evening (owner). 15 Nov (clarity): one line of three links under the
  // idea replaces them: Try on /try, the film (the walkthrough on YouTube), and the README's own offline check. The
  // trailer stays in "Watch it", /proof in the live demo's line.
  it("puts three links above the badges: Try on /try, the film, verify it yourself", () => {
    const links = readme.split("\n").find((l) => l.startsWith("**[Try it in 2 minutes]")) ?? "";
    expect([...links.matchAll(/\]\(([^)]+)\)/g)].map((m) => m[1])).toEqual(["https://kit11.max-31b.workers.dev/try", "https://youtu.be/PNLuqhRzVfE", "#verify-it-yourself-in-3-commands"]);
    expect([...links.matchAll(/\[([^\]]+)\]/g)].map((m) => m[1])).toEqual(["Try it in 2 minutes", "Watch the film", "Verify a payment yourself"]);
    expect(readme).toContain("\n## Verify it yourself in 3 commands\n");
    expect(readme.indexOf(links)).toBeLessThan(readme.indexOf(badgeLine));
    expect(readme).toContain("(https://youtu.be/n3HLVGROJc4)");
    expect(readme).toContain("(https://kit11.max-31b.workers.dev/proof)");
    expect(readme).not.toContain("kCUsFHrxE-o");
  });

  // Since 13 Nov (the enterprise README): the live demo's line under the badges, with the walkthrough and /proof, then
  // the three proofs, each with its record, and "test money only".
  it("puts the live demo's line under the badges, then three proofs with their records, and says test money only", () => {
    const lines = readme.split("\n");
    // 15 Nov (Max: "the tags on top of the readme"): the two badge rows moved up under the links line; the live demo's
    // line follows the Kit 11 table's closing sentence.
    const at = lines.findIndex((l) => l.startsWith("**Live demo: "));
    expect(at).toBeGreaterThan(lines.indexOf(badgeLine));
    expect(lines[at]).toBe("**Live demo: [kit11.max-31b.workers.dev/try](https://kit11.max-31b.workers.dev/try)**: a test company of your own on test money, in 2 minutes · [the film](https://youtu.be/PNLuqhRzVfE) · [the walkthrough](https://youtu.be/mp9fmOYfBWc) (AI voice and music: ElevenLabs) · [every id on /proof](https://kit11.max-31b.workers.dev/proof)");
    // 14 Nov (Max): "In 30 seconds" (three bullets) now comes first; the three proofs follow it.
    // 14 Nov: "Airwallex at the centre" sits between; the three proofs open "How it works in 3 steps".
    const proofs = lines.slice(lines.indexOf("## How it works in 3 steps")).filter((l) => l.startsWith("- **")).slice(0, 3);
    expect(proofs.map((l) => /^- \*\*([^.:]+)/.exec(l)![1])).toEqual(["Face ID or a passkey signs the exact terms", "Limits are enforced in 3 layers", "The audit chain is anchored on chain"]);
    for (const l of proofs) expect({ l: l.slice(0, 40), record: /\[record\]\(docs\/runs\/[^)]+\)/.test(l) }).toEqual({ l: l.slice(0, 40), record: true });
    for (const r of proofs.flatMap((l) => [...l.matchAll(/\(docs\/runs\/([^)]+)\)/g)].map((m) => m[1]!))) expect({ r, there: existsSync(new URL(`../docs/runs/${r}`, import.meta.url)) }).toEqual({ r, there: true });
    expect(proofs[1]).toContain("(https://kit11.max-31b.workers.dev/api/metal/mandates)");
    expect(proofs[1]).toContain("or the recorded 12 Nov snapshot when the chain does not answer");
    expect(readme).toContain("Test money only: Alta testnet, Airwallex sandbox, Visa via Airwallex Airi (sandbox), Claude.");
  });
});
