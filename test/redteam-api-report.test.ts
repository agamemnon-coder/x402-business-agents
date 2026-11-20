// The red team v2's report (src/redteamApi/report.ts): totals counted from the results, groups in the attack list's
// order with any other group after them, every FAIL and ERROR listed with its repro, and table cells that cannot break
// the Markdown table.
import { describe, expect, it } from "vitest";
import type { AttackResult } from "../src/redteamApi/attacks.js";
import { reportMarkdown, reportOf } from "../src/redteamApi/report.js";

const r = (id: string, group: string, verdict: AttackResult["verdict"], o: Partial<AttackResult> = {}): AttackResult => ({
  id, group, title: `title ${id}`, target: "judge", expected: "refused", actual: verdict === "PASS" ? "refused" : "accepted", verdict, repro: `curl ${id}`, ...o,
});

describe("the red team v2 report", () => {
  it("counts each verdict, by group in the attack list's order, then groups the list does not have", () => {
    const rep = reportOf([r("a", "headers", "PASS"), r("b", "cross-company", "FAIL"), r("c", "cross-company", "PASS"), r("d", "new group", "ERROR")], "2026-11-20");
    expect(rep.format).toBe("purser.redteam-api/v1");
    expect(rep.totals).toEqual({ attacks: 4, pass: 2, fail: 1, error: 1 });
    expect(Object.keys(rep.by_group)).toEqual(["cross-company", "headers", "new group"]);
    expect(rep.by_group["cross-company"]).toEqual({ attacks: 2, pass: 1, fail: 1, error: 0 });
    expect(rep.how).toMatch(/No request reaches the live site/);
  });

  it("lists every FAIL and ERROR with its repro, and escapes table cells", () => {
    const md = reportMarkdown(reportOf([
      r("b", "cross-company", "FAIL", { title: "a | pipe", actual: "line one\nline two", expected: "back\\slash" }),
      r("d", "new group", "ERROR", { target: "edge" }),
      r("a", "headers", "PASS"),
    ], "2026-11-20"));
    expect(md).toContain("Run on 2026-11-20 with `npm run redteam:api`");
    expect(md).toContain("3 attacks: **1 PASS, 1 FAIL, 1 ERROR**");
    expect(md).toContain("| cross-company | 1 | 0 | 1 | 0 |");
    expect(md).toContain("| **all** | **3** | **1** | **1** | **1** |");
    expect(md).toContain("### FAIL: a | pipe (`b`, judge)\n\n- Expected: back\\slash\n- Actual: line one\nline two\n- Repro: curl b");
    expect(md).toContain("### ERROR: title d (`d`, edge)");
    expect(md).toContain("| a \\| pipe (`b`) | judge | back\\\\slash | line one line two | FAIL |");
    expect(md).not.toContain("None: every attack was stopped as expected.");
    expect(md.indexOf("### cross-company")).toBeLessThan(md.indexOf("### headers"));
  });

  it("says so when every attack was stopped", () => {
    const md = reportMarkdown(reportOf([r("a", "headers", "PASS")], "2026-11-20"));
    expect(md).toContain("None: every attack was stopped as expected.");
    expect(md).toContain("| title a (`a`) | judge | refused | refused | PASS |");
  });
});
