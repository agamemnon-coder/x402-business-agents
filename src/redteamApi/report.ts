// The red team v2's report: docs/evidence/redteam-api.md and .json, from the attack results (./attacks.ts).
import { GROUPS, type AttackResult } from "./attacks.js";

export interface RedteamReport {
  format: "purser.redteam-api/v1";
  checked: string;
  how: string;
  totals: { attacks: number; pass: number; fail: number; error: number };
  by_group: Record<string, { attacks: number; pass: number; fail: number; error: number }>;
  results: AttackResult[];
}

const count = (rs: AttackResult[]) => ({ attacks: rs.length, pass: rs.filter((r) => r.verdict === "PASS").length, fail: rs.filter((r) => r.verdict === "FAIL").length, error: rs.filter((r) => r.verdict === "ERROR").length });

export function reportOf(results: AttackResult[], checked: string): RedteamReport {
  const by_group: RedteamReport["by_group"] = {};
  for (const g of [...GROUPS, ...new Set(results.map((r) => r.group))]) {
    const rs = results.filter((r) => r.group === g);
    if (rs.length) by_group[g] = count(rs);
  }
  return {
    format: "purser.redteam-api/v1", checked,
    how: "npm run redteam:api: every attack is HTTP to servers on this computer: the judge (npm run judge, src/cli/judge.ts) and an edge stand-in with the hosted deployment's limits (src/redteamApi/net.ts). No request reaches the live site, Airwallex, Alta or Anthropic.",
    totals: count(results), by_group, results,
  };
}

const cell = (s: string) => s.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\n/g, " ");

export function reportMarkdown(r: RedteamReport): string {
  const t = r.totals;
  const lines = [
    "# Red team v2: the public /try API, on this computer",
    "",
    `Run on ${r.checked} with \`npm run redteam:api\` (src/cli/redteamApi.ts). ${t.attacks} attacks: **${t.pass} PASS, ${t.fail} FAIL, ${t.error} ERROR**.`,
    "",
    "Every attack is one or more HTTP requests to a server on this computer, never to the live site:",
    "",
    "- **judge**: `npm run judge` (src/cli/judge.ts), the site and /try exactly as a judge without internet runs them. Code reads the invoice (no Claude call), the simulated bank pays, test money only. Its per-address limits are lifted on purpose (one person on their own computer), so the limits are attacked on the edge stand-in.",
    "- **edge**: the same Purser Cloud handler and engine with the hosted deployment's defaults (CloudEnv's rate limits, the start limits of cloud/src/try/switches.ts, `own_upload` on), behind a stand-in for Cloudflare's edge that sets `cf-connecting-ip` to the TCP peer's address and drops what the client sent. Attacks from \"another address\" connect from another loopback address (127.0.x.y).",
    "- **edge (in process)**: the same handler, called in this process with `cf-connecting-ip` set as the edge would set it, for IPv6 addresses (loopback has only ::1).",
    "",
    "Passkeys are software authenticators (src/redteam/authenticator.ts) that can sign anything wrong on purpose. An attack whose harness failed is ERROR, never PASS. A FAIL is a finding and is listed below with its repro.",
    "",
    "## Totals by group",
    "",
    "| Group | Attacks | PASS | FAIL | ERROR |",
    "|---|---|---|---|---|",
    ...Object.entries(r.by_group).map(([g, c]) => `| ${g} | ${c.attacks} | ${c.pass} | ${c.fail} | ${c.error} |`),
    `| **all** | **${t.attacks}** | **${t.pass}** | **${t.fail}** | **${t.error}** |`,
    "",
    "## Findings (every FAIL and ERROR, with its repro)",
    "",
  ];
  const bad = r.results.filter((x) => x.verdict !== "PASS");
  if (!bad.length) lines.push("None: every attack was stopped as expected.", "");
  for (const x of bad) {
    lines.push(`### ${x.verdict}: ${x.title} (\`${x.id}\`, ${x.target})`, "", `- Expected: ${x.expected}`, `- Actual: ${x.actual}`, `- Repro: ${x.repro}`, "");
  }
  lines.push("## Every attack", "");
  for (const g of Object.keys(r.by_group)) {
    lines.push(`### ${g}`, "", "| Attack | Target | Expected | Actual | Verdict |", "|---|---|---|---|---|");
    for (const x of r.results.filter((y) => y.group === g)) lines.push(`| ${cell(x.title)} (\`${x.id}\`) | ${x.target} | ${cell(x.expected)} | ${cell(x.actual)} | ${x.verdict} |`);
    lines.push("");
  }
  lines.push("The JSON beside this file (`redteam-api.json`) holds the same results with each attack's repro.", "");
  return lines.join("\n");
}
