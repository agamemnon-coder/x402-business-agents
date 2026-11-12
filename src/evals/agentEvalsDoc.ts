// docs/agent-evals.md, written from the eval records alone (docs/evals/agents.json for the three Kit 11 agents, and the
// payables agents' section from docs/evals/ap-agents.json): every number in it comes from a record. `npm run
// agent-evals` writes it after a live run, and `npm run agent-evals -- --render` writes it again from the records
// without calling Claude. The payables section sits between two markers and is kept when the rest is written again.

import { AGENT_CASES } from "./agentEvals.js";

export interface AgentEvalDocRow {
  case: string;
  kind: string;
  model: string;
  passed: number;
  runs: number;
  cost_usd_micros: number;
  median_ms: number;
  details: string[];
  ran_at?: string;
  commit?: string;
  dirty?: boolean;
  /**
   * Set on rows from before the CLI recorded a commit (31 October to 1 November): the commit was read afterwards from
   * git history, the checkout's latest commit at the row's run time (its last run: a row that adds up runs from more
   * than one session may have earlier runs on an earlier commit); whether the checkout had uncommitted changes then
   * is not known.
   */
  commit_source?: "git history at run time";
}

/** How the commits of the rows from before 2 November were read from git history, and the check of that method. */
export interface CommitBackfill { at: string; method: string; rows: number; checked_on_recorded_rows: number; agreed: number }

export interface AgentEvalsRecord { ran_at: string; cheapest_passing: Record<string, string | null>; commit_backfill?: CommitBackfill; rows: AgentEvalDocRow[] }

const at = (iso: string | undefined) => (iso ?? "").slice(0, 16).replace("T", " ");

/** The commit cell: as recorded (with "dirty" when the checkout had changes), or read from git history (marked *). */
export function commitCell(r: Pick<AgentEvalDocRow, "commit" | "dirty" | "commit_source">): string {
  if (!r.commit) return "not recorded";
  if (r.commit_source) return `${r.commit}*`;
  return `${r.commit}${r.dirty ? " (dirty)" : ""}`;
}

export function agentEvalsMarkdown(out: AgentEvalsRecord): string {
  const agents = ["sourcing", "treasury", "support"];
  const fromHistory = out.rows.filter((r) => r.commit_source).length;
  const b = out.commit_backfill;
  return [
    "# Agent evals: the three Kit 11 agents with real models",
    "",
    `Last update ${at(out.ran_at)} UTC; each row shows how many runs it had and when it ran, with \`npm run agent-evals\` (\`src/evals/agentEvals.ts\`). Stand-in tools: no chain, no Airwallex. Code's gates stay on, so an attack passes only when the outcome is right; the detail counts the calls code refused. The quoted words are the models' own. Those from before 1 November 06:00 say "Metal refused": the tool then said so. Since the Metal QA it says "refused before anything was signed" (Purser's check against the mandate's cap).`,
    "",
    "| Case | Kind | Model | Passed | Cost (USD) | Median time | Ran (UTC) | Commit | Last run |",
    "|---|---|---|---|---|---|---|---|---|",
    ...out.rows.map((r) => `| ${r.case} | ${r.kind} | ${r.model} | ${r.passed}/${r.runs} | ${(r.cost_usd_micros / 1e6).toFixed(4)} | ${(r.median_ms / 1000).toFixed(1)} s | ${at(r.ran_at)} | ${commitCell(r)} | ${r.details.at(-1)!.replace(/\|/g, "/")} |`),
    "",
    ...(fromHistory ? [`\\* ${fromHistory} rows ran before the eval recorded its commit. Their commit is the checkout's latest at the row's last run, read from git history afterwards (\`${b?.method ?? "git history"}\`${b ? `, ${b.at.slice(0, 10)}` : ""})${b ? `; read the same way, ${b.agreed} of the ${b.checked_on_recorded_rows} rows that did record a commit give the commit they recorded` : ""}. Where a row adds up runs from more than one session, its earlier runs may have run on an earlier commit. Whether those checkouts had uncommitted changes is not known.`, ""] : []),
    "## Cheapest model that passed every run",
    "",
    ...agents.map((a) => `- ${a}: ${out.cheapest_passing[a] ?? "none of the models tried"}`),
    "",
    `Not in this comparison: the cases that rebuild a run's moment on that run's model only (${AGENT_CASES.filter((c) => c.model).map((c) => `${c.id} on ${c.model}`).join(", ")}).`,
    "",
  ].join("\n");
}

export const AP_SECTION_START = "<!-- ap-agents:start -->";
export const AP_SECTION_END = "<!-- ap-agents:end -->";

/** The payables section of a written doc, markers included, or "" when it has none. */
export function apSectionOf(md: string): string {
  const a = md.indexOf(AP_SECTION_START), b = md.indexOf(AP_SECTION_END);
  return a >= 0 && b > a ? md.slice(a, b + AP_SECTION_END.length) : "";
}

/** The doc with its payables section replaced by `section` (markers included), or with `section` added at the end. */
export function withApSection(md: string, section: string): string {
  const old = apSectionOf(md);
  if (!section) return md;
  if (old) return md.replace(old, section);
  return `${md.replace(/\n*$/, "\n")}\n${section}\n`;
}
