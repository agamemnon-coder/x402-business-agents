// /try's "Proof in numbers" (15 Nov): every figure is read from a record and links to it; the generated file is current.
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PROOF_FIGURES } from "../cloud/src/try/proof.gen.js";
import { tryProofFigures, tryProofFile } from "../src/redesign/tryProof.js";
import { loadRecord, payments, split } from "../src/redesign/run.js";
import { liveRunCount } from "../src/redesign/runs.js";
import { REPO_BLOB } from "../src/redesign/metalStory.js";

describe("the proof band's figures", () => {
  it("are up to date with their records (npm run cloud:proof)", () => {
    expect(readFileSync("cloud/src/try/proof.gen.ts", "utf8")).toBe(tryProofFile());
    expect(PROOF_FIGURES).toEqual(tryProofFigures());
  });

  it("are the records' own figures, each linked to a file in the repository", () => {
    const { record } = loadRecord();
    const by = Object.fromEntries(PROOF_FIGURES.map((f) => [f.key, f]));
    expect(by.runs!.n).toBe(liveRunCount());
    expect(by.claude!.n).toBe(split(record).byClaude);
    expect(by.alta!.n).toBe(payments(record).onChain);
    expect(by.overLimit!.n).toBe(0);
    for (const f of PROOF_FIGURES) {
      expect(f.href.startsWith(REPO_BLOB)).toBe(true);
      expect(existsSync(f.href.slice(REPO_BLOB.length)), f.href).toBe(true);
    }
  });
});

describe("the band's scorecard line", () => {
  it("is built from the scorecard's own record and links to docs/scorecard.md", async () => {
    const { SCORECARD_SHORT, SCORECARD_HREF, scorecardShort } = await import("../cloud/src/try/scorecard.js");
    const { SCORECARD } = await import("../src/evals/scorecardSummary.js");
    expect(SCORECARD_SHORT).toBe("With Purser: none of the must-hold invoices reached the CFO; Claude alone sent eleven a run (50 cases, two runs, real Claude)");
    expect(SCORECARD_HREF).toBe(`${REPO_BLOB}docs/scorecard.md`);
    expect(existsSync("docs/scorecard.md")).toBe(true);
    // A run that disagrees, or Purser sending one to the CFO: no short line, never a made-up one.
    const runs = Object.values(SCORECARD.by_run);
    const other = structuredClone(SCORECARD);
    other.by_run[Object.keys(other.by_run)[0]!]!.purser.to_cfo_not_held = 1;
    expect(scorecardShort(other)).toBeNull();
    expect(runs.every((r) => r.purser.to_cfo_not_held === 0)).toBe(true);
  });
});
