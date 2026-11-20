// The README's animated SVGs (15 Nov, readme-wow): the stat strip, the terminal, the system map (drawn by
// scripts/readme-wow-svg.ts) and the animated architecture diagram. GitHub shows them in an <img>, where no script runs
// and nothing outside loads: no <script>, no external link, under 80 KB (the system map under 120 KB), CSS animation that
// prefers-reduced-motion stops. The terminal's output is the verifier's own, run again here; the figures are the records'.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { APPROVAL_OUT, RECEIPT, TAMPERED_OUT, WOW_FILES, statFigures, wowSvgs } from "../scripts/readme-wow-svg.js";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const ARCH = ["docs/assets/readme/architecture-dark.svg", "docs/assets/readme/architecture-light.svg"];

describe("the README's animated SVGs", () => {
  it("are what the script draws, and each is shown in the README, dark and light", () => {
    const drawn = wowSvgs();
    expect(Object.keys(drawn).sort()).toEqual([...WOW_FILES].sort());
    for (const f of WOW_FILES) expect({ f, same: read(f) === drawn[f] }).toEqual({ f, same: true });
    const readme = read("README.md");
    for (const f of [...WOW_FILES, ...ARCH]) expect({ f, shown: readme.includes(`"${f}"`) }).toEqual({ f, shown: true });
  });

  it("have no script, no external link, an animation that reduced motion stops, and stay small", () => {
    for (const f of [...WOW_FILES, ...ARCH]) {
      const svg = read(f);
      expect({ f, script: /<script|on[a-z]+=|<foreignObject|javascript:/i.test(svg) }).toEqual({ f, script: false });
      // A URL may be in the text (the verifier prints the site's origin); none in an attribute, a url() or an @import.
      expect({ f, external: /(?:xlink:)?href="(?!#)|src="|url\((?!#)|@import|="https?:\/\/(?!www\.w3\.org\/2000\/svg")/.test(svg) }).toEqual({ f, external: false });
      expect({ f, kb: Buffer.byteLength(svg) < (f.includes("system-map") ? 120 : 80) * 1024 }).toEqual({ f, kb: true });
      expect(svg).toMatch(/@keyframes/);
      expect(svg).toMatch(/@media \(prefers-reduced-motion:\s?reduce\)/);
    }
  });

  it("show the verifier's real output: VALID for the receipt, NOT VALID one cent higher", () => {
    const run = (file: string, cwd?: string) => spawnSync(process.execPath, [join(process.cwd(), "node_modules/tsx/dist/cli.mjs"), join(process.cwd(), "src/cli/verifyReceipt.ts"), file], { cwd, encoding: "utf8" });
    const ok = run(RECEIPT);
    expect(ok.status).toBe(0);
    expect(ok.stdout.trimEnd()).toBe(APPROVAL_OUT);
    const dir = mkdtempSync(join(tmpdir(), "wow-"));
    const receipt = read(RECEIPT);
    expect(receipt).toContain('"amount": "240.00"');
    writeFileSync(join(dir, "tampered.json"), receipt.replace('"amount": "240.00"', '"amount": "240.01"'));
    const bad = run("tampered.json", dir);
    expect(bad.status).toBe(1);
    expect(bad.stdout.trimEnd()).toBe(TAMPERED_OUT);
    for (const t of ["dark", "light"]) {
      const svg = read(`docs/assets/readme/terminal-verify-${t}.svg`);
      for (const s of ["VALID:", "NOT VALID:", "FAIL", "the terms were changed", "npm run -s verify-approval", "npm run -s verify-receipt -- tampered.json", "240.01"]) expect(svg).toContain(s);
    }
  }, 60_000);

  it("count the records' figures: 8,845 tests, 24 Claude decisions, 86 Alta payments, 0 wrong payments", () => {
    const f = statFigures();
    expect(f.tests).toBe((JSON.parse(read("docs/assets/test-summary.json")) as { passed: number }).passed);
    expect(f).toEqual({ tests: 8845, decisions: 24, alta: 86, wrong: 0 });
    expect(read("docs/evals/worst-case-summary.json")).toContain('"wrong_payments": 0');
    for (const t of ["dark", "light"]) expect(read(`docs/assets/readme/stats-${t}.svg`)).toContain("8,845 tests passing in the last full run; 24 Claude decisions and 86 Alta payments");
  });

  it("animate the architecture: travelling flow lines, five pulsing steps, the Refused block flashing; text static", () => {
    for (const f of ARCH) {
      const svg = read(f);
      expect(svg.match(/class="flow/g)?.length).toBeGreaterThanOrEqual(8);
      for (const n of [1, 2, 3, 4, 5]) expect(svg).toContain(`class="halo h${n}"`);
      expect(svg).toContain('<g class="flash">');
      expect(svg).not.toMatch(/<text[^>]*class="(?:flow|halo|flash)/);
    }
  });
});
