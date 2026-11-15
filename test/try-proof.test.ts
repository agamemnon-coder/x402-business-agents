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

