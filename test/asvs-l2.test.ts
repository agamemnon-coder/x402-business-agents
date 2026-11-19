// docs/security/asvs-l2.md, the OWASP ASVS 4.0.3 Level 2 self-assessment: it lists every Level 2 requirement once
// (259, per chapter as the official CSV counts them), each with a verdict and its evidence, its summary adds up from
// its rows, and every failure is in the fix plan. It checks the page's own consistency, not the verdicts themselves.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const md = readFileSync(new URL("../docs/security/asvs-l2.md", import.meta.url), "utf8");
/** Level 2 requirements per chapter in ASVS 4.0.3's official CSV (rows with a Level 2 mark). */
const OFFICIAL: Record<string, number> = { V1: 38, V2: 53, V3: 18, V4: 9, V5: 30, V6: 13, V7: 12, V8: 15, V9: 7, V10: 5, V11: 8, V12: 15, V13: 13, V14: 23 };
const rows = [...md.matchAll(/^\| (V\d+)\.(\d+)\.(\d+) \| ([^|]+) \| (\*\*Fail\*\*|Pass|N\/A) \| (.+) \|$/gm)].map((m) => ({ id: `${m[1]}.${m[2]}.${m[3]}`, chapter: m[1]!, verdict: m[5]!.replace(/\*/g, ""), evidence: m[6]! }));

describe("the ASVS 4.0.3 Level 2 self-assessment", () => {
  it("says it is a self-assessment, not a certification", () => {
    expect(md).toContain("**A self-assessment, not a certification and not an audit.**");
    expect(md).not.toMatch(/\b(certified|compliant with ASVS|ASVS compliant)\b/i);
  });

  it("lists each of the 259 Level 2 requirements once, per chapter as the standard counts them", () => {
    expect(rows).toHaveLength(259);
    expect(new Set(rows.map((r) => r.id)).size).toBe(259);
    const per: Record<string, number> = {};
    for (const r of rows) per[r.chapter] = (per[r.chapter] ?? 0) + 1;
    expect(per).toEqual(OFFICIAL);
  });

  it("gives every verdict a reason or evidence", () => {
    for (const r of rows) expect(r.evidence.length, r.id).toBeGreaterThan(15);
  });

  it("has a summary that adds up from the rows", () => {
    for (const ch of Object.keys(OFFICIAL)) {
      const mine = rows.filter((r) => r.chapter === ch);
      const n = (v: string) => mine.filter((r) => r.verdict === v).length;
      expect(md, ch).toMatch(new RegExp(`^\\| ${ch} [^|]+ \\| ${n("Pass")} \\| ${n("Fail")} \\| ${n("N/A")} \\| ${mine.length} \\|$`, "m"));
    }
    const n = (v: string) => rows.filter((r) => r.verdict === v).length;
    expect(md).toContain(`| **Total** | **${n("Pass")}** | **${n("Fail")}** | **${n("N/A")}** | **259** |`);
  });

  it("puts every failure in the fix plan", () => {
    const plan = md.slice(md.indexOf("## The failures and the plan"), md.indexOf("## V1 "));
    for (const r of rows.filter((x) => x.verdict === "Fail")) expect(["(", ",", " "].some((b) => [",", ")"].some((a) => plan.includes(`${b}${r.id}${a}`))), r.id).toBe(true);
  });
});
