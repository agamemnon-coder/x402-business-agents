import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The badge row under the README's first lines: at most five badges, no logos of others, and the tests badge says the
// same count as the README's own test line (which in turn is the real `npx vitest run` count).
const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
const badgeLine = readme.split("\n").find((l) => l.includes("actions/workflows/ci.yml/badge.svg")) ?? "";
const pkgNode = (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { engines: { node: string } }).engines.node;

describe("README badges", () => {
  // One row since 13 Nov (owner, after the live README); three since the enterprise README (13 Nov).
  it("has at most three badges, on one line", () => {
    const badges = badgeLine.match(/!\[[^\]]*\]\(/g) ?? [];
    expect(badges.length).toBeGreaterThan(1);
    expect(badges.length).toBeLessThanOrEqual(3);
  });

  it("uses no logos", () => {
    expect(badgeLine).not.toMatch(/[?&]logo=/);
  });

  // Since 13 Nov (the enterprise README, owner): three badges only: CI (GitHub's own), the licence, and the live demo.
  // The MCP Registry entry, the partners and the tests moved into the text (the Enterprise section, the rails line).
  it("is CI, the licence and the live demo, nothing else", () => {
    expect([...badgeLine.matchAll(/\[!\[([^\]]+)\]/g)].map((m) => m[1])).toEqual(["CI", "License: MIT", "Live demo: /try"]);
    expect(badgeLine).toContain("(https://kit11.max-31b.workers.dev/try)");
    expect(badgeLine).toContain("(LICENSE)");
    expect(badgeLine).not.toMatch(/[?&]logo=/);
    // The registry entry is still named, in the Enterprise section, under the name server.json publishes.
    const registered = (JSON.parse(readFileSync(new URL("../server.json", import.meta.url), "utf8")) as { name: string }).name;
    expect(registered).toBe("io.github.agamemnon-coder/purser");
    expect(readme).toContain(`(https://registry.modelcontextprotocol.io/v0/servers?search=${registered})`);
    expect(readme).toMatch(/\*\*\d+ tests passing\*\*/);
    expect(pkgNode.length).toBeGreaterThan(0);
  });

  // Since 13 Nov (the enterprise README): no buttons; the live demo's line under the badges, with the film and /proof,
  // then the three proofs, each with its record, and "test money only".
  it("puts the live demo's line under the badges, then three proofs with their records, and says test money only", () => {
    const lines = readme.split("\n");
    const at = lines.indexOf(badgeLine);
    expect(lines[at + 2]).toBe("**Live demo: [kit11.max-31b.workers.dev/try](https://kit11.max-31b.workers.dev/try)**: a test company of your own on test money, in 2 minutes · [the walkthrough, 4:58](https://youtu.be/mp9fmOYfBWc) (AI voice and music: ElevenLabs) · [every id on /proof](https://kit11.max-31b.workers.dev/proof)");
    expect(readme).not.toContain("for-the-badge");
    const proofs = lines.slice(at + 3).filter((l) => l.startsWith("- **")).slice(0, 3);
    expect(proofs.map((l) => /^- \*\*([^.:]+)/.exec(l)![1])).toEqual(["Face ID or a passkey signs the exact terms", "Limits are enforced in 3 layers", "The audit chain is anchored on chain"]);
    for (const l of proofs) expect({ l: l.slice(0, 40), record: /\[record\]\(docs\/runs\/[^)]+\)/.test(l) }).toEqual({ l: l.slice(0, 40), record: true });
    for (const r of proofs.flatMap((l) => [...l.matchAll(/\(docs\/runs\/([^)]+)\)/g)].map((m) => m[1]!))) expect({ r, there: existsSync(new URL(`../docs/runs/${r}`, import.meta.url)) }).toEqual({ r, there: true });
    expect(proofs[1]).toContain("(https://kit11.max-31b.workers.dev/api/metal/mandates)");
    expect(proofs[1]).toContain("or the recorded 12 Nov snapshot when the chain does not answer");
    expect(readme).toContain("Test money only: Metal testnet, Airwallex sandbox, Visa via Airwallex Airi (sandbox), Claude.");
  });
});
