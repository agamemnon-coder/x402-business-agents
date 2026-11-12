// The VIC success rate (master-list line 280): runs, succeeded, failed and why, from the run records themselves; live
// and stand-in apart; failed attempts counted as runs.
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { fromAttempts, fromChecks, readVicRuns, vicSuccessRate } from "../src/airi/successRate.js";

describe("the VIC success rate", () => {
  it("counts the committed records: vic-1's four attempts (one passed) and vic-2", () => {
    const s = vicSuccessRate(readVicRuns(resolve(import.meta.dirname, "..")));
    const vic1 = s.list.filter((r) => r.run === "vic-1");
    expect(vic1.map((r) => r.outcome)).toEqual(["stopped", "failed", "failed", "succeeded"]);
    expect(s.list.find((r) => r.run === "vic-2")).toMatchObject({ outcome: "succeeded", mode: "live" });
    expect(s.runs).toBe(s.succeeded + s.failed);
    expect(s.reasons.every((r) => r.reason.length > 0)).toBe(true);
    expect(s.reasons.find((r) => r.attempt === "vic-1b")!.reason).toMatch(/not enabled for native API access/);
    expect(s.live.runs).toBe(s.runs - s.stand_in.runs);
  });

  it("a run with a check not ok has failed, with that check as its reason; stand-in runs are counted apart", () => {
    const runs = [
      ...fromChecks({ run: "vic-3", mode: "stand-in", started_at: "2026-11-12T10:00:00Z", checks: { a: { ok: true }, b: { ok: false, detail: "hash read back once" } } }, "x"),
      ...fromAttempts({ run: "vic-9", mode: "live", attempts: [{ world: "w", at: "2026-11-12T11:00:00Z", outcome: "passed", cause: null }] }, "y"),
    ];
    const s = vicSuccessRate(runs);
    expect(s).toMatchObject({ runs: 2, succeeded: 1, failed: 1, rate_pct: 50, live: { runs: 1, succeeded: 1 }, stand_in: { runs: 1, succeeded: 0 } });
    expect(s.reasons).toEqual([{ run: "vic-3", attempt: "vic-3", outcome: "failed", reason: "b: hash read back once" }]);
    expect(vicSuccessRate([]).rate_pct).toBeNull();
  });
});
