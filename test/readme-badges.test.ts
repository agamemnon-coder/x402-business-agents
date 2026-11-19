import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The badge rows under the README's title: build and quality, security and supply chain, product and partners.
const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
const badgeLine = readme.split("\n").find((l) => l.includes("actions/workflows/ci.yml/badge.svg")) ?? "";

describe("README badges", () => {
  // 17 Nov (owner: "one calm, branded set"): only the live GitHub badges stay, CI and CodeQL; the static shields (the
  // partners' status, the tests, MIT, the MCP server) went into the proof strip under them, one picture drawn from the
  // records by scripts/readme-proof-strip.ts (test/readme-proof-strip.test.ts).
  it("is three labelled rows, build and quality, security and supply chain, product and partners, then the proof strip", () => {
    // 17 Nov, later (owner: "keep all the badges, tidy and grouped"): three rows under one style (flat-square, one
    // label colour); then the strip. 19 Nov 2026 (owner, OpenSSF gold): each row named by a bold label: build and
    // quality (CI, CodeQL, tests, coverage, licence), security and supply chain (OpenSSF Best Practices, OpenSSF
    // Scorecard, REUSE, Sigstore-signed releases, the TLA+ model, the Dafny proofs), and the product and its partners as they ran. No SLSA
    // level badge: the release provenance comes from actions/attest, not the SLSA generator (docs/security/openssf-gold.md).
    const lines = readme.split("\n");
    const at = lines.indexOf(badgeLine);
    const names = (l: string) => [...l.matchAll(/\[!\[([^\]]+)\]/g)].map((m) => m[1]);
    expect(badgeLine.startsWith("**Build & quality**<br>[![CI]")).toBe(true);
    expect(names(badgeLine)).toEqual(["CI", "CodeQL", "Tests: from docs/assets/test-summary.json", "Coverage: from docs/badges/coverage.json", "License: MIT"]);
    expect(lines[at + 1]!.startsWith("**Security & supply chain**<br>[![OpenSSF Best Practices]")).toBe(true);
    expect(names(lines[at + 1]!)).toEqual(["OpenSSF Best Practices", "OpenSSF Scorecard", "REUSE 3.3: compliant", "Releases: Sigstore-signed", "TLA+ model: 1,102,845 states, 0 errors", "Dafny: verified"]);
    expect(lines[at + 2]!.startsWith("**Product & partners**<br>[![Airwallex: sandbox]")).toBe(true);
    expect(names(lines[at + 2]!)).toEqual(["Airwallex: sandbox", "Alta (formerly Metal): testnet", "Visa VIC via Airi: sandbox", "T:0: sandbox ledger", "Claude: 24 decisions", "worst-case AI, offline eval: 0 wrong payments", "MCP server: read, propose only", "Test money only"]);
    expect(badgeLine.endsWith("<br>") && lines[at + 1]!.endsWith("<br>")).toBe(true);
    expect(lines[at + 1]).toContain("[![OpenSSF Best Practices](https://www.bestpractices.dev/projects/16923/badge)](https://www.bestpractices.dev/projects/16923)&nbsp;[![OpenSSF Scorecard](https://api.securityscorecards.dev/projects/github.com/agamemnon-coder/x402-business-agents/badge)](https://scorecard.dev/viewer/?uri=github.com/agamemnon-coder/x402-business-agents)");
    expect(badgeLine).toContain("actions/workflows/github-code-scanning/codeql/badge.svg");
    expect(readme).not.toMatch(/\[!\[SLSA/);
    for (const l of lines.slice(at, at + 3)) for (const u of l.matchAll(/img\.shields\.io\/[^)]+/g)) expect(u[0]).toContain("style=flat-square");
    // Every badge of the two new rows points to its evidence, and says what that evidence says.
    // Coverage: a shields endpoint badge read from the committed JSON (src/proof/badges.ts, test/badges.test.ts).
    expect(badgeLine).toContain("(https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2Fagamemnon-coder%2Fx402-business-agents%2Fmain%2Fdocs%2Fbadges%2Fcoverage.json&style=flat-square&labelColor=1f2937)](docs/evidence/coverage.md)");
    expect(existsSync(new URL("../docs/badges/coverage.json", import.meta.url))).toBe(true);
    // REUSE: reuse lint runs in CI (job reuse) over REUSE.toml.
    expect(lines[at + 1]).toContain("(REUSE.toml)");
    expect(readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8")).toMatch(/\n {2}reuse:\n[\s\S]*?uses: fsfe\/reuse-action@[0-9a-f]{40}/);
    // Sigstore-signed releases: the release workflow attests every file it publishes (actions/attest, id-token).
    const release = readFileSync(new URL("../.github/workflows/release.yml", import.meta.url), "utf8");
    expect(release).toMatch(/uses: actions\/attest@[0-9a-f]{40}/);
    expect(release).toContain("id-token: write");
    expect(lines[at + 1]).toContain("(docs/security/README.md#verify-a-release)");
    // The TLA+ model: the figure is the committed model check's.
    const formal = readFileSync(new URL("../docs/evidence/formal-model.md", import.meta.url), "utf8");
    expect(formal).toContain("**1,102,845 distinct states**");
    expect(formal).toContain("**No error.**");
    expect(lines[at + 1]).toContain("(docs/evidence/formal-model.md)");
    // The Dafny proofs: the badge JSON and docs/evidence/formal-proofs.md come with the formal-proof branch, merged
    // together with this one (19 Nov 2026, coordinator).
    expect(lines[at + 1]).toContain("[![Dafny: verified](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/agamemnon-coder/x402-business-agents/main/docs/badges/dafny.json&style=flat-square)](docs/evidence/formal-proofs.md)");
    // 17 Nov, owner: the badges at the very top: the three rows right under the title; the proof strip stays at the
    // foot of the centred top, after the For judges table.
    expect(lines[at - 2]).toBe("# Purser · AI agents spend. You sign off.");
    expect(lines[at - 1]).toBe("");
    const stripAt = lines.findIndex((l) => l.startsWith('<a href="https://kit11.max-31b.workers.dev/proof"><picture>'));
    expect(stripAt).toBeGreaterThan(lines.findIndex((l) => l.startsWith("| **For judges:**")));
    const strip = lines[stripAt] ?? "";
    expect(strip.startsWith('<a href="https://kit11.max-31b.workers.dev/proof"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/assets/readme/proof-strip-dark.svg"><img src="docs/assets/readme/proof-strip-light.svg" alt="')).toBe(true);
    expect(readme).toMatch(/\*\*\d+ tests passing\*\*/);
  });

  // The buttons above the badges, restored 13 Nov, evening (owner). 15 Nov (clarity): one line of three links under the
  // idea replaces them: Try on /try, the film (the walkthrough on YouTube), and the README's own offline check. The
  // trailer stays in "Watch it", /proof in the live demo's line.
  // 17 Nov, owner: the badges at the very top, so the three links now come under them.
  // 18 Nov: the demo in the submission (3:15) replaces the film as the middle link; the film stays under "Watch it".
  // 19 Nov 2026 (README tightened for the judges): the same three links as the judges' numbered path, the demo first,
  // its thumbnail right under it.
  it("puts three links under the badges, numbered: the demo, Try on /try, verify it yourself", () => {
    const links = readme.split("\n").find((l) => l.startsWith("**1. [Watch the demo (3:15)]")) ?? "";
    expect([...links.matchAll(/\]\(([^)]+)\)/g)].map((m) => m[1])).toEqual(["https://youtu.be/gEUm8RlhZac", "https://kit11.max-31b.workers.dev/try", "#verify-it-yourself-in-3-commands"]);
    expect([...links.matchAll(/\[([^\]]+)\]/g)].map((m) => m[1])).toEqual(["Watch the demo (3:15)", "Try it (2 min, test money)", "Verify a payment (3 commands)"]);
    expect(links).toBe("**1. [Watch the demo (3:15)](https://youtu.be/gEUm8RlhZac) · 2. [Try it (2 min, test money)](https://kit11.max-31b.workers.dev/try) · 3. [Verify a payment (3 commands)](#verify-it-yourself-in-3-commands)**");
    const lines = readme.split("\n");
    expect(lines[lines.indexOf(links) + 2]).toBe('<a href="https://youtu.be/gEUm8RlhZac"><img src="docs/assets/readme/demo-thumb.jpg" alt="Purser: the demo on YouTube (3:15)" width="100%"></a>');
    expect(readme).toContain("\n## Verify it yourself in 3 commands\n");
    expect(readme.indexOf(links)).toBeGreaterThan(readme.indexOf(badgeLine));
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
    // 19 Nov 2026: the demo in the submission (3:15) in place of the film here too; the film stays under "Watch it".
    expect(lines[at]).toBe("**Live demo: [kit11.max-31b.workers.dev/try](https://kit11.max-31b.workers.dev/try)**: a test company of your own on test money, in 2 minutes · [the demo (3:15)](https://youtu.be/gEUm8RlhZac) · [every id on /proof](https://kit11.max-31b.workers.dev/proof)");
    // 14 Nov (Max): "In 30 seconds" (three bullets) now comes first; the three proofs follow it.
    // 14 Nov: "Airwallex at the centre" sits between; the three proofs open "How it works in 3 steps".
    // 19 Nov 2026 (README tightened for the judges): one "How it works" (the 3 steps, the three proofs, the sequence
    // diagram), the passkey named, as the 3 steps above it name it (Face ID on iPhone).
    expect(lines).not.toContain("## How it works in 3 steps");
    const proofs = lines.slice(lines.indexOf("## How it works")).filter((l) => l.startsWith("- **")).slice(0, 3);
    expect(proofs.map((l) => /^- \*\*([^.:]+)/.exec(l)![1])).toEqual(["A passkey signs the exact terms", "Limits are enforced in 3 layers", "The audit chain is anchored on chain"]);
    for (const l of proofs) expect({ l: l.slice(0, 40), record: /\[record\]\(docs\/runs\/[^)]+\)/.test(l) }).toEqual({ l: l.slice(0, 40), record: true });
    for (const r of proofs.flatMap((l) => [...l.matchAll(/\(docs\/runs\/([^)]+)\)/g)].map((m) => m[1]!))) expect({ r, there: existsSync(new URL(`../docs/runs/${r}`, import.meta.url)) }).toEqual({ r, there: true });
    expect(proofs[1]).toContain("(https://kit11.max-31b.workers.dev/api/metal/mandates)");
    expect(proofs[1]).toContain("or the recorded 12 Nov snapshot when the chain does not answer");
    expect(readme).toContain("**Run live on test money** (Alta testnet, Airwallex sandbox, Visa via Airwallex Airi (sandbox), Claude): ");
  });
});
