import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The badge row under the README's first lines: the two live GitHub badges, then the proof strip.
const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
const badgeLine = readme.split("\n").find((l) => l.includes("actions/workflows/ci.yml/badge.svg")) ?? "";

describe("README badges", () => {
  // 17 Nov (owner: "one calm, branded set"): only the live GitHub badges stay, CI and CodeQL; the static shields (the
  // partners' status, the tests, MIT, the MCP server) went into the proof strip under them, one picture drawn from the
  // records by scripts/readme-proof-strip.ts (test/readme-proof-strip.test.ts).
  it("is one row of the two live badges, CI and CodeQL, then the proof strip linked to /proof", () => {
    // 17 Nov, later (owner: "keep all the badges, tidy and grouped"): three rows under one style (flat-square, one
    // label colour): build (CI, CodeQL, tests, licence), the partners as they ran live, and the proof; then the strip.
    const lines = readme.split("\n");
    const at = lines.indexOf(badgeLine);
    const names = (l: string) => [...l.matchAll(/\[!\[([^\]]+)\]/g)].map((m) => m[1]);
    expect(names(badgeLine)).toEqual(["CI", "CodeQL", "Tests: from docs/assets/test-summary.json", "License: MIT"]);
    expect(names(lines[at + 1]!)).toEqual(["Airwallex: sandbox", "Alta (formerly Metal): testnet", "Visa VIC via Airi: sandbox", "T:0: sandbox ledger", "Claude: 24 decisions"]);
    expect(names(lines[at + 2]!)).toEqual(["worst-case AI, offline eval: 0 wrong payments", "MCP server: read, propose only", "Test money only"]);
    expect(badgeLine).toContain("actions/workflows/github-code-scanning/codeql/badge.svg");
    for (const l of lines.slice(at, at + 3)) for (const u of l.matchAll(/img\.shields\.io\/[^)]+/g)) expect(u[0]).toContain("style=flat-square");
    const strip = lines[at + 4] ?? "";
    expect(strip.startsWith('<a href="https://kit11.max-31b.workers.dev/proof"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/assets/readme/proof-strip-dark.svg"><img src="docs/assets/readme/proof-strip-light.svg" alt="')).toBe(true);
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
    expect(lines[at]).toBe("**Live demo: [kit11.max-31b.workers.dev/try](https://kit11.max-31b.workers.dev/try)**: a test company of your own on test money, in 2 minutes · [the film](https://youtu.be/PNLuqhRzVfE) · [every id on /proof](https://kit11.max-31b.workers.dev/proof)");
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
