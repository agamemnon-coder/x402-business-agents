// 17 Nov (owner: every judge-facing README "strak, high-tech, enterprise"): one header for all of them, the Purser mark
// linked to the README, the title, one sentence, then "At a glance", a table of two to four facts each with its record.
// 26 Nov 2026 (Max: "lets do also more with the MD's"): the family moves to the README's centred header (CENTRED below).
// The figures docs/README.md states are read here from their records, so they cannot go stale.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { liveRunCount } from "../src/redesign/runs.js";
import { stripFigures } from "../scripts/readme-proof-strip.js";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const exists = (p: string) => existsSync(new URL(`../${p}`, import.meta.url));

export const HEADED = ["docs/README.md", "docs/runs/README.md", "docs/proof/README.md", "docs/evidence/README.md", "docs/security/README.md", "docs/audit/README.md",
  "docs/submission/README.md", "docs/business/README.md", "docs/video/README.md", "examples/metal-dispute-desk/README.md", "docs/assets/brand/README.md"];

/** The family's header since 26 Nov 2026 (Max: "lets do also more with the MD's"), the README's own: centred, the mark at
 * 64 px, the title, one bold sentence, a row of badges (each true: test/docs-look.test.ts), a row of jump links; then,
 * under it, At a glance as before. A README not listed here keeps the 17 Nov header (the mark at 36 px, left-aligned). */
export const CENTRED = ["docs/README.md", "docs/proof/README.md"];

/** Checks a README's header, and gives the line its mark is on and the line At a glance starts on. */
function header(f: string, lines: string[]): { mark: number; glance: number } {
  if (!CENTRED.includes(f)) {
    expect(lines[1]).toBe("");
    expect(lines[2]).toMatch(/^# \S/);
    expect(lines[3]).toBe("");
    expect(lines[4]).toMatch(/^[A-Z][^\n]+[.]$/);
    expect(lines[5]).toBe("");
    return { mark: 0, glance: 6 };
  }
  expect(lines.slice(0, 2)).toEqual(['<div align="center">', ""]);
  expect(lines[3]).toBe("");
  expect(lines[4]).toMatch(/^# \S/);
  expect(lines[5]).toBe("");
  expect(lines[6]).toMatch(/^\*\*[A-Z][^*\n]+[.]\*\*$/);
  expect(lines[7]).toBe("");
  expect(lines[8]).toMatch(/^\[!\[[^\]]+\]\(https:\/\/[^)]+\)\]\([^)]+\)/);
  expect(lines[9]).toBe("");
  // The jump row: three links or more on one line, separated by " · ".
  expect(lines[10]).toMatch(/^\[[^\]!][^\]]*\]\([^)\s]+\)(?: · \[[^\]]+\]\([^)\s]+\)){2,}$/);
  expect(lines.slice(11, 14)).toEqual(["", "</div>", ""]);
  return { mark: 2, glance: 14 };
}

describe("the judge-facing READMEs' shared header", () => {
  it("the centred READMEs are judge-facing READMEs", () => {
    for (const f of CENTRED) expect(HEADED).toContain(f);
  });

  for (const f of HEADED) it(`${f}: the mark, one title, one sentence, then At a glance with records that exist`, () => {
    const lines = read(f).split("\n");
    const at = header(f, lines);
    const size = CENTRED.includes(f) ? 64 : 36;
    const mark = new RegExp(`^<a href="([^"]+)"><picture><source media="\\(prefers-color-scheme: dark\\)" srcset="([^"]+)-dark\\.svg"><img src="([^"]+)" alt="Purser" width="${size}" height="${size}"></picture></a>$`).exec(lines[at.mark]!);
    expect(mark).not.toBeNull();
    expect(join(dirname(f), mark![1]!)).toBe("README.md");
    expect(join(dirname(f), mark![3]!)).toBe("docs/assets/brand/purser-mark.svg");
    expect(`${mark![2]!}.svg`).toBe(mark![3]!); // the dark theme's mark beside it: docs/assets/brand/purser-mark-dark.svg
    expect(lines.filter((l) => /^# /.test(l))).toHaveLength(1);
    expect(lines.slice(at.glance, at.glance + 2)).toEqual(["| At a glance | Record |", "|---|---|"]);
    const rows = lines.slice(at.glance + 2, lines.indexOf("", at.glance + 2));
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows.length).toBeLessThanOrEqual(4);
    for (const r of rows) {
      expect(r.split(" | ")).toHaveLength(2);
      for (const h of [...r.matchAll(/\]\(([^)#]+)(?:#[^)]*)?\)/g)].map((m) => m[1]!).filter((x) => !/^https?:/.test(x)))
        expect({ f, h, there: exists(join(dirname(f), h)) }).toEqual({ f, h, there: true });
    }
  });

  it("docs/README.md's figures are its records'", () => {
    const glance = read("docs/README.md").split("\n").filter((l) => l.startsWith("| **")).join("\n");
    const s = stripFigures();
    expect(glance).toContain(`**${s.tests.passed.toLocaleString("en-US")} tests passing**, ${s.tests.failed} failed`);
    // Which run (audit, 20 Nov): the full suite's, on the summary's commit; coverage is a separate run.
    const summary = JSON.parse(read("docs/assets/test-summary.json")) as { commit: string };
    expect(glance).toContain(`in the last full run of the suite, on commit \`${summary.commit}\` (coverage is a separate run: [evidence/coverage.md](evidence/coverage.md))`);
    expect(glance).toContain(`**${liveRunCount()} live runs**, the last on `);
    expect(glance).toContain(`**${s.verification.passed} checks passed**, ${s.verification.couldNotRun} could not run here, ${s.verification.failed} failed`);
    expect(glance).toContain(`(${s.verification.file.replace("docs/", "").replace(".json", ".md")})`);
    // Jury pass, 20 Nov: "Where the numbers come from" names the same reports as the table (it named 15 Nov's and 30 Oct's).
    const where = read("docs/README.md").split("**Where the numbers come from.**")[1]!.split("\n\n")[0]!;
    expect(where).toContain(`(${s.verification.file.replace("docs/", "").replace(".json", ".md")})`);
    expect(glance).toContain("(redteam/rerun-2026-11-20.md)");
    expect(where).toContain("(redteam/rerun-2026-11-20.md)");
    expect(glance).toContain(`**${s.redteam.stopped} of ${s.redteam.attempts}** red-team attacks stopped, ${s.redteam.caughtAfter} caught afterwards`);
    expect(read("docs/runs/README.md")).toContain(`**${liveRunCount()} live runs**`);
    const last = /\*\*Last live run:\*\* ([^.]+)\./.exec(read("docs/runs/README.md"))![1]!;
    expect(glance).toContain(`the last on ${last} |`);
  });
});
