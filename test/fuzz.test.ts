// The fuzzing set (npm run fuzz, src/fuzz/properties.ts), at low run counts in the suite: every property holds except the
// open findings the report lists (docs/evidence/fuzzing.md, "Findings"), and the committed report is the full run of the
// code that made it: the same properties, 10,000 runs or more where asked, every failure with its counterexample and its
// replay, and no forgery in the field-by-field sweep of the committed bundles and receipts.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PROPERTIES } from "../src/fuzz/properties.js";
import { fuzzContext, runProperty, type FuzzReport } from "../src/fuzz/run.js";

/** Open findings (docs/evidence/fuzzing.md): none. A closed one may never fail again. */
const OPEN_FINDINGS = new Set<string>([]);

describe("fuzzing (low run counts here; npm run fuzz runs the full set)", () => {
  const ctx = fuzzContext();

  it("finds the committed receipts and bundles to fuzz", () => {
    expect(ctx.bundles.length).toBeGreaterThanOrEqual(2);
    expect(ctx.receipts.length).toBeGreaterThanOrEqual(1);
  });

  for (const p of PROPERTIES) {
    it.skipIf(OPEN_FINDINGS.has(p.id))(`${p.id} holds`, { timeout: 120_000 }, async () => {
      const r = await runProperty(p, ctx, { runs: p.id.endsWith("-pdf") ? 20 : 300, timeLimitMs: 60_000 });
      expect({ id: r.id, status: r.status, error: r.error ?? null, counterexample: r.counterexample ?? null }).toEqual({ id: p.id, status: "PASS", error: null, counterexample: null });
    });
  }

  it("the committed report is a full run of these properties, and shows every failure with its replay", () => {
    const report = JSON.parse(readFileSync(new URL("../docs/evidence/fuzzing.json", import.meta.url), "utf8")) as FuzzReport;
    const md = readFileSync(new URL("../docs/evidence/fuzzing.md", import.meta.url), "utf8");
    expect(report.format).toBe("purser.fuzzing/v1");
    expect(report.results.map((r) => r.id)).toEqual(PROPERTIES.map((p) => p.id));
    for (const r of report.results) {
      const p = PROPERTIES.find((x) => x.id === r.id)!;
      expect(r.runs_asked, r.id).toBe(p.runs);
      // A property that held ran its full count, or ran until its time limit.
      if (r.status === "PASS") expect(r.runs_done + r.skipped >= r.runs_asked || r.interrupted, r.id).toBe(true);
      if (r.status === "FAIL") {
        expect(OPEN_FINDINGS.has(r.id), `${r.id} failed in the committed report but is not an open finding`).toBe(true);
        expect(md).toContain(`### \`${r.id}\` failed`);
        expect(md).toContain(`npm run fuzz -- --only ${r.id} --seed ${r.seed} --path ${r.path}`);
        expect(r.counterexample?.length).toBeGreaterThan(0);
      }
    }
    expect(report.totals.runs).toBe(report.results.reduce((s, r) => s + r.runs_done, 0));
    expect(report.results.filter((r) => r.runs_asked >= 10_000 && r.status === "PASS").every((r) => r.runs_done >= 10_000 || r.interrupted)).toBe(true);
    expect(md).toContain(`**${report.totals.properties} properties, ${report.totals.runs.toLocaleString("en-US")} runs, ${report.totals.passed} held, ${report.totals.failed} failed**`);
    // The sweep of every field of every committed artifact: no change to what a signature covers still verifies.
    expect(report.sweep.tried).toBeGreaterThan(500);
    expect(report.sweep.still_valid.filter((x) => x.covered === "signature")).toEqual([]);
  });
});
