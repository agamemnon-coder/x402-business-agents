import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stripFigures } from "../scripts/readme-proof-strip.js";
import { readmeDemoLine, readmeStepLines } from "../scripts/readme-demo-svg.js";
import { partnerTiles } from "../src/redesign/proofRuns.js";
import { longRun } from "../src/redesign/run.js";

// The README's badges. History: 14 Nov, two rows (the project, the partners); 17 Nov (owner: "one calm, branded set"),
// only CI and CodeQL with a proof strip; 17 Nov, later (owner: "keep all the badges, tidy and grouped"), three labelled
// rows under one style (flat-square, one label colour); 19 Nov 2026 (owner, OpenSSF gold), coverage, REUSE, signed
// releases, the TLA+ model and the Dafny proofs added.
// 21 Nov 2026, Max: "tags and logo on top, a small demo, the 3 steps; the second architecture animation can go; far
// fewer headings". One compact row of the key badges right under the title (CI, the tests, coverage, the partners as
// they ran, Claude, test money only); the rest, one "Quality & security" row under the quick start. Every figure on a
// badge is checked here against its record: "Claude: 24 decisions" (the main run of 3 Nov) became the 20 Nov long run's
// count, as the proof strip and /proof's Claude tile say it; "worst-case AI: 0 wrong payments" (the 50-case test of
// 15 Nov) became the newest held-out eval's figures.
const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
const lines = readme.split("\n");
const topLine = lines.find((l) => l.includes("actions/workflows/ci.yml/badge.svg")) ?? "";
const qualityLine = lines.find((l) => l.startsWith("**Quality & security**<br>")) ?? "";
const names = (l: string) => [...l.matchAll(/\[!\[([^\]]+)\]/g)].map((m) => m[1]);
const dayOf = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

describe("README badges", () => {
  it("is one compact row under the title: CI, the tests, coverage, the partners as they ran, Claude, test money only", () => {
    expect(lines.indexOf("# Purser · AI agents spend. You sign off.")).toBe(4);
    expect(lines.indexOf(topLine)).toBe(6);
    const claude = longRun()!;
    expect(claude.byClaude).toBe(stripFigures().decisions);
    expect(names(topLine)).toEqual(["CI", "Tests: from docs/assets/test-summary.json", "Coverage: from docs/badges/coverage.json", "Airwallex: sandbox", "Alta (formerly Metal): testnet", "Visa via Airi: sandbox", "T:0: sandbox ledger", `Claude: ${claude.byClaude} decisions, ${dayOf(claude.recordedAt)} run`, "Test money only"]);
    expect(topLine).toContain(`(https://img.shields.io/badge/Claude-${claude.byClaude}_decisions%2C_${dayOf(claude.recordedAt).replace(" ", "_")}_run-d97757?style=flat-square&labelColor=1f2937)](https://kit11.max-31b.workers.dev/claude)`);
    expect(readme).not.toMatch(/Claude: 24 decisions|Claude-24_decisions/);
    // Sandbox or testnet for a partner: at least one live run of that partner in the run records (the tiles on /proof count them).
    const live = Object.fromEntries(partnerTiles().map((t) => [t.name, t.runs]));
    for (const n of ["Airwallex", "Alta", "Visa via Airi", "T:0"]) expect({ n, runs: (live[n] ?? 0) > 0 }).toEqual({ n, runs: true });
    // The tests: a dynamic badge on the last full run (test-summary.json); coverage: a shields endpoint badge read from
    // the committed JSON (src/proof/badges.ts, test/badges.test.ts), naming its own, separate coverage run.
    expect(topLine).toContain("query=%24.passed&label=tests%2C%20last%20full%20run&suffix=%20passing");
    expect(topLine).toContain("(https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2Fagamemnon-coder%2Fx402-business-agents%2Fmain%2Fdocs%2Fbadges%2Fcoverage.json&style=flat-square&labelColor=1f2937)](docs/evidence/coverage.md)");
    expect(existsSync(new URL("../docs/badges/coverage.json", import.meta.url))).toBe(true);
    const cov = JSON.parse(readFileSync(new URL("../docs/evidence/coverage.json", import.meta.url), "utf8")) as { run: { commit: string; result: { passed: number; failed: number; skipped: number } } };
    const r = cov.run.result;
    expect(readme).toContain(`The coverage badge is from a separate, earlier coverage run on commit \`${cov.run.commit}\` (${r.passed.toLocaleString("en-GB")} passed, ${r.failed} failed`);
    expect(readme).toContain(`, ${r.skipped} skipped: [coverage.md](docs/evidence/coverage.md))`);
    for (const l of [topLine, qualityLine]) for (const u of l.matchAll(/img\.shields\.io\/[^)]+/g)) expect(u[0]).toContain("style=flat-square");
    // The pitch right under it, then the demo.
    expect(lines.slice(7, 10)).toEqual(["", lines[8]!, ""]);
    expect(lines[8]!.startsWith("**AI agents pay your suppliers.")).toBe(true);
  });

  it("keeps the rest in one Quality & security row under the quick start, each badge saying what its record says", () => {
    expect(qualityLine).not.toBe("");
    expect(lines.indexOf(qualityLine)).toBeGreaterThan(lines.indexOf("## Verify it yourself in 3 commands"));
    expect(lines.indexOf(qualityLine)).toBeLessThan(lines.indexOf("## Try it in 2 minutes"));
    const n = Math.max(...readdirSync(new URL("../docs/evals/", import.meta.url)).map((f) => /^adversarial-v(\d+)\.json$/.exec(f)?.[1]).filter(Boolean).map(Number));
    const ev = JSON.parse(readFileSync(new URL(`../docs/evals/adversarial-v${n}.json`, import.meta.url), "utf8")) as { held_out: boolean; totals: Record<"purser_script" | "no_rules", { wrong_payments: number }> };
    expect(ev.held_out).toBe(true);
    const evalName = `Held-out eval v${n}, offline: ${ev.totals.purser_script.wrong_payments} vs ${ev.totals.no_rules.wrong_payments} wrong payments`;
    expect(names(qualityLine)).toEqual(["CodeQL", "License: MIT", "OpenSSF Best Practices", "REUSE 3.3: compliant", "Releases: Sigstore-signed", "TLA+ model: 1,102,845 states, 0 errors", "Dafny: verified", evalName, "MCP server: read, propose only"]);
    expect(qualityLine).toContain(`-${ev.totals.purser_script.wrong_payments}_vs_${ev.totals.no_rules.wrong_payments}_wrong_payments-`);
    expect(qualityLine).toContain(`](docs/evals/adversarial-v${n}.md)`);
    expect(readme).not.toMatch(/worst-case AI[^\n]*0 wrong payments|worst--case_AI/);
    expect(qualityLine).toContain("[![OpenSSF Best Practices](https://www.bestpractices.dev/projects/16923/badge)](https://www.bestpractices.dev/projects/16923)");
    expect(qualityLine).toContain("actions/workflows/github-code-scanning/codeql/badge.svg");
    expect(readme).not.toMatch(/\[!\[SLSA/);
    // REUSE: reuse lint runs in CI (job reuse) over REUSE.toml.
    expect(qualityLine).toContain("(REUSE.toml)");
    expect(readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8")).toMatch(/\n {2}reuse:\n[\s\S]*?uses: fsfe\/reuse-action@[0-9a-f]{40}/);
    // Sigstore-signed releases: the release workflow attests every file it publishes (actions/attest, id-token).
    const release = readFileSync(new URL("../.github/workflows/release.yml", import.meta.url), "utf8");
    expect(release).toMatch(/uses: actions\/attest@[0-9a-f]{40}/);
    expect(release).toContain("id-token: write");
    expect(qualityLine).toContain("(docs/security/README.md#verify-a-release)");
    // The TLA+ model: the figure is the committed model check's.
    const formal = readFileSync(new URL("../docs/evidence/formal-model.md", import.meta.url), "utf8");
    expect(formal).toContain("**1,102,845 distinct states**");
    expect(formal).toContain("**No error.**");
    expect(qualityLine).toContain("(docs/evidence/formal-model.md)");
    expect(qualityLine).toContain("[![Dafny: verified](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/agamemnon-coder/x402-business-agents/main/docs/badges/dafny.json&style=flat-square)](docs/evidence/formal-proofs.md)");
    // The proof strip heads "The proof", under the centred top.
    const stripAt = lines.findIndex((l) => l.startsWith('<a href="https://kit11.max-31b.workers.dev/proof"><picture>'));
    expect(stripAt).toBe(lines.indexOf("## The proof") + 2);
    expect(lines[stripAt]!.startsWith('<a href="https://kit11.max-31b.workers.dev/proof"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/assets/readme/proof-strip-dark.svg"><img src="docs/assets/readme/proof-strip-light.svg" alt="')).toBe(true);
    expect(readme).toMatch(/\*\*\d+ tests passing\*\*/);
  });

  // 20 Nov (owner): the demo, /try and /proof on the first screen. 21 Nov 2026 (Max, above): a small demo, then the three
  // steps with it (the video is the first step); "Verify a payment (3 commands)" lower, as its own section.
  it("puts the small demo under the pitch, then the three steps: the video, /try, /proof", () => {
    expect(lines[10]).toBe(readmeDemoLine());
    const [pictures, links] = readmeStepLines();
    expect(lines.slice(11, 15)).toEqual(["", pictures, "", links]);
    expect([...links.matchAll(/\]\(([^)]+)\)/g)].map((m) => m[1])).toEqual(["https://youtu.be/gEUm8RlhZac", "https://kit11.max-31b.workers.dev/try", "https://kit11.max-31b.workers.dev/proof"]);
    expect([...pictures.matchAll(/<a href="([^"]+)"/g)].map((m) => m[1])).toEqual(["https://youtu.be/gEUm8RlhZac", "https://kit11.max-31b.workers.dev/try", "https://kit11.max-31b.workers.dev/proof"]);
    expect(pictures).toContain('<img src="docs/assets/readme/demo-thumb.jpg" alt="1 · Watch the demo: Purser on YouTube (3:15)" width="32%">');
    expect(lines[16]).toBe("| Sponsor track | What ran live (test money) | Record |");
    expect(readme).not.toContain("4. [Verify a payment (3 commands)]");
    expect(readme).toContain("\n## Verify it yourself in 3 commands\n");
    expect(readme.split("youtu.be/n3HLVGROJc4").length - 1).toBe(1); // 20 Nov (owner): one quiet line under the demo
    expect(readme).toContain("(https://kit11.max-31b.workers.dev/proof)");
    expect(readme).not.toContain("kCUsFHrxE-o");
  });

  // Since 13 Nov (the enterprise README): three proofs, each with its record, and "test money only". 21 Nov 2026: the
  // live demo's line went (the three steps on top link /try, the demo and /proof).
  it("opens How it works with three proofs with their records, and says test money only", () => {
    expect(lines.some((l) => l.startsWith("**Live demo: "))).toBe(false);
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
