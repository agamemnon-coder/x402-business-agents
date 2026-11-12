// The README's "What ran live" table (12 Nov): one row per live run, newest first, built from the same rows as /runs and
// docs/runs/README.md (src/redesign/runs.ts, liveRuns()), so every date, label and link is the record's. Written
// between <!-- runs --> and <!-- /runs --> by `npm run readme-runs`; test/readme-runs.test.ts holds the README to it.

import { liveRuns, mdCell, type RunRow } from "../redesign/runs.js";

const REPO_BLOB = "https://github.com/agamemnon-coder/x402-business-agents/blob/main/";
const local = (href: string) => href.replace(REPO_BLOB, "").replace(/^\.\.\/\.\.\//, "");

export function runsTable(rows: RunRow[] = liveRuns()): string {
  const line = (r: RunRow) => `| ${r.date} | ${mdCell(r.title)} | ${mdCell(r.rails)} | ${mdCell(r.money)} | ${r.files.map((f) => `[${mdCell(f.label)}](${local(f.href)})`).join(" · ")} |`;
  return ["| Date | Run | Where | Money | Record |", "|---|---|---|---|---|", ...rows.map(line)].join("\n");
}

export const RUNS_START = "<!-- runs -->", RUNS_END = "<!-- /runs -->";
export function withRunsTable(readme: string, table = runsTable()): string {
  const a = readme.indexOf(RUNS_START), b = readme.indexOf(RUNS_END);
  if (a < 0 || b < a) throw new Error("README has no runs block");
  return `${readme.slice(0, a + RUNS_START.length)}\n${table}\n${readme.slice(b)}`;
}
