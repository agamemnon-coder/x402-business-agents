// Face ID to paid (master list 81): the numbers are built from the real run records, and the record's own "x s after
// Face ID" agrees with the times read from its rows. The page's line carries exactly these numbers and no other.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { RUN_TIME_RECORDS, faceIdPayouts, median, runTimes, runTimesLine, secs } from "../src/redesign/runTimes.js";

const md = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");

describe("Face ID to paid, from the records", () => {
  const t = runTimes();

  it("times the Face ID payouts of awx-1 that reached PAID, and only those", () => {
    expect(t.payouts.map((p) => p.proposal)).toEqual(["P-0002", "P-0003"]);
    for (const p of t.payouts) {
      expect(p.record).toBe(RUN_TIME_RECORDS.awx1);
      // The record's own words agree with the times read from its rows.
      expect(p.stated).not.toBeNull();
      expect(Math.round(p.ms / 100) / 10).toBe(p.stated);
      expect(md(p.record)).toContain(p.approvedAt.slice(11, 23));
    }
  });

  it("leaves out the runs signed with a test passkey, each with its reason", () => {
    expect(t.leftOut.map((l) => l.record).sort()).toEqual([RUN_TIME_RECORDS.platform, RUN_TIME_RECORDS.twoLocks].sort());
    for (const l of t.leftOut) expect(l.why).toMatch(/test passkey, not Face ID/);
  });

  it("computes n, median and spread from those payouts", () => {
    const ms = t.payouts.map((p) => p.ms);
    expect(t.n).toBe(ms.length);
    expect(t.medianMs).toBe(median(ms));
    expect(t.minMs).toBe(Math.min(...ms));
    expect(t.maxMs).toBe(Math.max(...ms));
  });

  it("the line shows exactly the computed numbers", () => {
    const line = runTimesLine(t)!;
    expect(line).toBe(`Face ID to paid: median ${secs(t.medianMs!)}, from ${secs(t.minMs!)} to ${secs(t.maxMs!)}, over ${t.n} payouts.`);
    const shown = [...line.matchAll(/\d+(?:\.\d+)?/g)].map((m) => m[0]);
    expect(shown).toEqual([secs(t.medianMs!), secs(t.minMs!), secs(t.maxMs!)].map((s) => s.replace(" s", "")).concat(String(t.n)));
  });

  it("a Face ID approval without a PAID row is no payout; a missing record is left out", () => {
    const fake = "| 10:00:00.000 | c | **Ann approves P-0001 with Face ID** | 1 |\n| 10:00:02.000 | c | approved again | 2 |";
    expect(faceIdPayouts(fake, "docs/runs/2026-01-01-x.md")).toEqual([]);
    const none = runTimes(["docs/runs/none.md"], () => null);
    expect(none.n).toBe(0);
    expect(none.leftOut).toEqual([{ record: "docs/runs/none.md", why: "the record is missing" }]);
    expect(runTimesLine(none)).toBeNull();
  });

  it("median of an even count is the mean of the middle two", () => {
    expect(median([3, 1, 2, 10])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});
