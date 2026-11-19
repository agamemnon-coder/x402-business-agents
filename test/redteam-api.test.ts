// The red team v2 on the public /try API (npm run redteam:api, src/redteamApi/): every attack runs here over HTTP to the
// judge's offline server and the edge stand-in, on this computer. Each must be stopped (PASS), except the findings the
// report lists as open (docs/evidence/redteam-api.md): those may stay FAIL until fixed, and nothing else may fail. The
// committed report is checked against the attack catalogue, so it cannot drift from the code that made it.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { redteamApi } from "../src/cli/redteamApi.js";
import { GROUPS, type AttackResult } from "../src/redteamApi/attacks.js";
import type { RedteamReport } from "../src/redteamApi/report.js";

/** Open findings (docs/evidence/redteam-api.md, "Findings"): the judge's own 404 page and files lack nosniff (judge only). */
const OPEN_FINDINGS = new Set(["headers-pages", "headers-files"]);

describe("red team v2 on the /try API (local)", () => {
  let results: AttackResult[] = [];

  it("runs every group's attacks; none is an ERROR, and none FAILs but the open findings", { timeout: 600_000 }, async () => {
    results = await redteamApi();
    expect(results.length).toBeGreaterThanOrEqual(120);
    for (const g of GROUPS) expect(results.filter((r) => r.group === g).length, g).toBeGreaterThan(0);
    expect(results.filter((r) => r.verdict === "ERROR").map((r) => `${r.id}: ${r.actual}`)).toEqual([]);
    expect(results.filter((r) => r.verdict === "FAIL" && !OPEN_FINDINGS.has(r.id)).map((r) => `${r.id}: ${r.actual}`)).toEqual([]);
    // The attacks that move money are all stopped: not one of them is among the open findings.
    for (const g of ["cross-company", "signature replay", "another world's passkey", "terms tampering", "double pay"]) {
      expect(results.filter((r) => r.group === g && r.verdict !== "PASS").map((r) => r.id), g).toEqual([]);
    }
  });

  it("the committed report has the same attacks and verdicts, and lists every FAIL with its repro", () => {
    const report = JSON.parse(readFileSync(new URL("../docs/evidence/redteam-api.json", import.meta.url), "utf8")) as RedteamReport;
    const md = readFileSync(new URL("../docs/evidence/redteam-api.md", import.meta.url), "utf8");
    expect(report.format).toBe("purser.redteam-api/v1");
    expect(report.results.map((r) => r.id).sort()).toEqual(results.map((r) => r.id).sort());
    const verdict = new Map(results.map((r) => [r.id, r.verdict]));
    for (const r of report.results) expect(`${r.id} ${r.verdict}`).toBe(`${r.id} ${verdict.get(r.id)}`);
    const t = report.totals;
    expect(t.pass + t.fail + t.error).toBe(t.attacks);
    expect(md).toContain(`${t.attacks} attacks: **${t.pass} PASS, ${t.fail} FAIL, ${t.error} ERROR**`);
    for (const r of report.results.filter((x) => x.verdict !== "PASS")) {
      expect(md).toContain(`(\`${r.id}\``);
      expect(md).toContain(`- Repro: ${r.repro}`);
    }
  });
});
