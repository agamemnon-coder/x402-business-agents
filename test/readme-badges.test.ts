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
// Review, 21 Nov: the first screen keeps CI, OpenSSF, the partners' sandbox and testnet badges and test money first;
// the rest (the tests, coverage, Claude with its scope, CodeQL, the licence and the quality badges) under the one-line
// value, in one row.
const topLine = lines.find((l) => l.includes("actions/workflows/ci.yml/badge.svg")) ?? "";
const qualityLine = lines.find((l) => l.startsWith("[![Tests: from docs/assets/test-summary.json]")) ?? "";
const names = (l: string) => [...l.matchAll(/\[!\[([^\]]+)\]/g)].map((m) => m[1]);

describe("README badges", () => {
  it("is one compact row under the title: CI, OpenSSF, the partners as they ran, test money only", () => {
    expect(lines.indexOf("# Purser · AI agents spend. You sign off.")).toBe(4);
    expect(lines.indexOf(topLine)).toBe(6);
    const claude = longRun()!;
    expect(claude.byClaude).toBe(stripFigures().decisions);
    expect(names(topLine)).toEqual(["CI", "OpenSSF Best Practices", "Airwallex: sandbox", "Alta (formerly Metal): testnet", "Visa via Airi: sandbox", "T:0: sandbox ledger", "Test money only"]);
    // Review, 21 Nov: the Claude badge says its scope (the long run of 20 Nov, not the main run's 24) and links its record.
    const day = `${Number(claude.recordedAt.slice(8, 10))} Nov`;
    expect(names(qualityLine).slice(0, 3)).toEqual(["Tests: from docs/assets/test-summary.json", "Coverage: from docs/badges/coverage.json", `Claude: ${claude.byClaude} decisions, ${day} long run`]);
    expect(qualityLine).toContain(`(https://img.shields.io/badge/Claude-${claude.byClaude}_decisions%2C_${day.replace(" ", "_")}_long_run-d97757?style=flat-square&labelColor=1f2937)](${claude.log})`);
    expect(readme).not.toMatch(/Claude: 24 decisions|Claude-24_decisions/);
    // Sandbox or testnet for a partner: at least one live run of that partner in the run records (the tiles on /proof count them).
    const live = Object.fromEntries(partnerTiles().map((t) => [t.name, t.runs]));
    for (const n of ["Airwallex", "Alta", "Visa via Airi", "T:0"]) expect({ n, runs: (live[n] ?? 0) > 0 }).toEqual({ n, runs: true });
    // The tests and coverage (and Dafny below): static badges whose text is the committed record's, word for word (24 Nov:
    // shields.io could no longer fetch raw.githubusercontent.com, so badges read from the repository at view time showed
    // as broken images). The test count is the last full run's (test-summary.json); coverage names its own, separate run.
    const enc = (t: string) => encodeURIComponent(t.replace(/-/g, "--").replace(/_/g, "__"));
    const summary = JSON.parse(readFileSync(new URL("../docs/assets/test-summary.json", import.meta.url), "utf8")) as { passed: number };
    const covBadge = JSON.parse(readFileSync(new URL("../docs/badges/coverage.json", import.meta.url), "utf8")) as { label: string; message: string };
    const dafnyBadge = JSON.parse(readFileSync(new URL("../docs/badges/dafny.json", import.meta.url), "utf8")) as { label: string; message: string };
    expect(qualityLine).toContain(`(https://img.shields.io/badge/${enc("tests, last full run")}-${enc(`${summary.passed} passing`)}-059669?style=flat-square&labelColor=1f2937)](docs/assets/test-summary.json)`);
    expect(qualityLine).toContain(`(https://img.shields.io/badge/${enc(covBadge.label)}-${enc(covBadge.message)}-0284c7?style=flat-square&labelColor=1f2937)](docs/evidence/coverage.md)`);
    expect(readme).toContain(`(https://img.shields.io/badge/${enc(dafnyBadge.label)}-${enc(dafnyBadge.message)}-059669?style=flat-square&labelColor=1f2937)`);
    // No badge asks shields.io to fetch a file from the repository at view time.
    expect(readme).not.toMatch(/img\.shields\.io\/(endpoint|badge\/dynamic)/);
    expect(existsSync(new URL("../docs/badges/coverage.json", import.meta.url))).toBe(true);
    const cov = JSON.parse(readFileSync(new URL("../docs/evidence/coverage.json", import.meta.url), "utf8")) as { run: { commit: string; result: { passed: number; failed: number; skipped: number } } };
    const r = cov.run.result;
    expect(readme).toContain(`The coverage badge is from a separate, earlier coverage run on commit \`${cov.run.commit}\` (${r.passed.toLocaleString("en-GB")} passed, ${r.failed} failed`);
    expect(readme).toContain(`, ${r.skipped} skipped: [coverage.md](docs/evidence/coverage.md))`);
    for (const l of [topLine, qualityLine]) for (const u of l.matchAll(/img\.shields\.io\/[^)]+/g)) expect(u[0]).toContain("style=flat-square");
    // The one-line value right under it, then the rest of the badges, then the demo.
    expect(lines.slice(7, 12)).toEqual(["", lines[8]!, "", qualityLine, ""]);
    expect(lines[8]!.startsWith("**AI agents pay your suppliers.")).toBe(true);
  });

  // 21 Nov, later (Max): "make sure the rest of the badges is there too, underneath"; and the Claude badge without its date.
  it("keeps the rest in one row under the one-line value, each badge saying what its record says", () => {
    expect(qualityLine).not.toBe("");
    expect(lines.indexOf(qualityLine)).toBe(10);
    const n = Math.max(...readdirSync(new URL("../docs/evals/", import.meta.url)).map((f) => /^adversarial-v(\d+)\.json$/.exec(f)?.[1]).filter(Boolean).map(Number));
    const ev = JSON.parse(readFileSync(new URL(`../docs/evals/adversarial-v${n}.json`, import.meta.url), "utf8")) as { held_out: boolean; totals: Record<"purser_script" | "no_rules", { wrong_payments: number }> };
    const after = JSON.parse(readFileSync(new URL(`../docs/evals/adversarial-v${n}-after.json`, import.meta.url), "utf8")) as { held_out: boolean; totals: Record<"purser_script", { wrong_payments: number }> };
    expect([ev.held_out, after.held_out]).toEqual([true, false]);
    // 22 Nov (the owner: "14 → 0"): the blind run → the same cases after the fixes, each from its record.
    const evalName = `Held-out eval v${n}, offline: ${ev.totals.purser_script.wrong_payments} → ${after.totals.purser_script.wrong_payments} wrong payments`;
    expect(names(qualityLine).slice(3)).toEqual(["CodeQL", "License: MIT", "REUSE 3.3: compliant", "Releases: Sigstore-signed", "TLA+ model: 1,102,845 states, 0 errors", "Dafny: verified", evalName, "MCP server: read, propose only"]);
    expect(qualityLine).toContain(`-${ev.totals.purser_script.wrong_payments}_%E2%86%92_${after.totals.purser_script.wrong_payments}_wrong_payments-`);
    expect(qualityLine).toContain(`](docs/evals/adversarial-v${n}.md)`);
    expect(readme).not.toMatch(/worst-case AI[^\n]*0 wrong payments|worst--case_AI/);
    expect(topLine).toContain("[![OpenSSF Best Practices](https://www.bestpractices.dev/projects/16923/badge)](https://www.bestpractices.dev/projects/16923)");
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
    {
      const enc = (t: string) => encodeURIComponent(t.replace(/-/g, "--").replace(/_/g, "__"));
      const d = JSON.parse(readFileSync(new URL("../docs/badges/dafny.json", import.meta.url), "utf8")) as { label: string; message: string };
      expect(qualityLine).toContain(`[![Dafny: verified](https://img.shields.io/badge/${enc(d.label)}-${enc(d.message)}-059669?style=flat-square&labelColor=1f2937)](docs/evidence/formal-proofs.md)`);
    }
    // The proof strip heads "The proof", under the centred top.
    const stripAt = lines.findIndex((l) => l.startsWith('<a href="https://kit11.max-31b.workers.dev/proof"><picture>'));
    expect(stripAt).toBe(lines.indexOf("## The proof") + 2);
    expect(lines[stripAt]!.startsWith('<a href="https://kit11.max-31b.workers.dev/proof"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/assets/readme/proof-strip-dark.svg"><img src="docs/assets/readme/proof-strip-light.svg" alt="')).toBe(true);
    expect(readme).toMatch(/\*\*\d+ tests passing\*\*/);
  });

  // 20 Nov (owner): the demo, /try and /proof on the first screen. 21 Nov 2026 (Max, above): a small demo, then the three
  // steps with it (the video is the first step); "Verify a payment (3 commands)" lower, as its own section.
  it("puts the small demo under the pitch, then the three steps: the video, /try, /proof", () => {
    expect(lines[12]).toBe(readmeDemoLine());
    const [pictures, links] = readmeStepLines();
    expect(lines.slice(13, 17)).toEqual(["", pictures, "", links]);
    expect([...links.matchAll(/\]\(([^)]+)\)/g)].map((m) => m[1])).toEqual(["https://youtu.be/gEUm8RlhZac", "https://kit11.max-31b.workers.dev/try", "https://kit11.max-31b.workers.dev/proof"]);
    expect([...pictures.matchAll(/<a href="([^"]+)"/g)].map((m) => m[1])).toEqual(["https://youtu.be/gEUm8RlhZac", "https://kit11.max-31b.workers.dev/try", "https://kit11.max-31b.workers.dev/proof"]);
    expect(pictures).toContain('<img src="docs/assets/readme/demo-thumb.jpg" alt="1 · Watch the demo: Purser on YouTube (3:15)" width="32%">');
    expect(lines[18]).toBe("| Sponsor track | What ran live (test money) | Record |");
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
