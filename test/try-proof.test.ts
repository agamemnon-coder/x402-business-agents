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


describe("the band's worst-case line", () => {
  it("is the worst-case test's own headline and line, linked to its record", async () => {
    const { tryPage } = await import("../cloud/src/tryPage.js");
    const { WORST_CASE_HEADLINE, WORST_CASE_LINE, WORST_CASE_DOC } = await import("../src/evals/worstCase.js");
    const html = tryPage("n", { origin: "https://x.test", rpId: "x.test" });
    expect(html).toContain(`const BAND_LINE=${JSON.stringify({ head: WORST_CASE_HEADLINE, line: WORST_CASE_LINE, href: `${REPO_BLOB}${WORST_CASE_DOC}` }).replace(/</g, "\\u003c")};`);
    expect(existsSync(WORST_CASE_DOC)).toBe(true);
  });
});
