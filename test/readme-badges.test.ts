import { existsSync, readFileSync } from "node:fs";
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

  // The buttons above the badges, restored 13 Nov, evening (owner): Try it on /try, the proof, the walkthrough (film
  // v10, 4:58, on YouTube; the old film's button and its 3:58 are gone).
  it("puts three buttons above the badges: Try on /try, the proof, the walkthrough", () => {
    const buttons = readme.split("\n").find((l) => l.includes("Watch_the_walkthrough")) ?? "";
    expect([...buttons.matchAll(/<a href="([^"]+)">/g)].map((m) => m[1])).toEqual(["https://kit11.max-31b.workers.dev/try", "https://kit11.max-31b.workers.dev/proof", "https://youtu.be/mp9fmOYfBWc"]);
    expect([...buttons.matchAll(/alt="([^"]+)"/g)].map((m) => m[1])).toEqual(["Try it: a test company of your own, 2 minutes", "See the proof: every id", "Watch the walkthrough, 4:58 (AI voice and music: ElevenLabs)"]);
    expect(buttons).toContain("style=for-the-badge");
    expect(readme.indexOf(buttons)).toBeLessThan(readme.indexOf(badgeLine));
    expect(readme).not.toContain("kCUsFHrxE-o");
  });

  // Since 13 Nov (the enterprise README): the live demo's line under the badges, with the walkthrough and /proof, then
  // the three proofs, each with its record, and "test money only".
  it("puts the live demo's line under the badges, then three proofs with their records, and says test money only", () => {
    const lines = readme.split("\n");
    const at = lines.indexOf(badgeLine);
    expect(lines[at + 2]).toBe("**Live demo: [kit11.max-31b.workers.dev/try](https://kit11.max-31b.workers.dev/try)**: a test company of your own on test money, in 2 minutes · [the walkthrough, 4:58](https://youtu.be/mp9fmOYfBWc) (AI voice and music: ElevenLabs) · [every id on /proof](https://kit11.max-31b.workers.dev/proof)");
    const proofs = lines.slice(at + 3).filter((l) => l.startsWith("- **")).slice(0, 3);
    expect(proofs.map((l) => /^- \*\*([^.:]+)/.exec(l)![1])).toEqual(["Face ID or a passkey signs the exact terms", "Limits are enforced in 3 layers", "The audit chain is anchored on chain"]);
    for (const l of proofs) expect({ l: l.slice(0, 40), record: /\[record\]\(docs\/runs\/[^)]+\)/.test(l) }).toEqual({ l: l.slice(0, 40), record: true });
    for (const r of proofs.flatMap((l) => [...l.matchAll(/\(docs\/runs\/([^)]+)\)/g)].map((m) => m[1]!))) expect({ r, there: existsSync(new URL(`../docs/runs/${r}`, import.meta.url)) }).toEqual({ r, there: true });
    expect(proofs[1]).toContain("(https://kit11.max-31b.workers.dev/api/metal/mandates)");
    expect(proofs[1]).toContain("or the recorded 12 Nov snapshot when the chain does not answer");
    expect(readme).toContain("Test money only: Metal testnet, Airwallex sandbox, Visa via Airwallex Airi (sandbox), Claude.");
  });
});
