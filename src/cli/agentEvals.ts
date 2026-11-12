// npm run agent-evals [-- --render] [-- --runs N] [-- --models haiku,sonnet,opus] [-- --agent treasury | --case a,b]: the three Kit 11 agents' evals with real models
// (src/evals/agentEvals.ts), per model, N runs each. Writes docs/evals/agents.json and docs/agent-evals.md: per case
// and model, how often it passed, what it cost and how long it took, and per agent the cheapest model that passed
// every run. Needs KIT11_ANTHROPIC_API_KEY; spends real money (a few cents a run). Never part of npm test.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { claudeClient } from "../claude/reader.js";
import { PRICES } from "../claude/pricing.js";
import { budgetStatus, recordSpend } from "../claude/budget.js";
import { AGENT_CASES, type AgentName } from "../evals/agentEvals.js";
import { agentEvalsMarkdown, apSectionOf, withApSection, type AgentEvalsRecord } from "../evals/agentEvalsDoc.js";
import { evalCommit } from "../evals/commit.js";

const args = process.argv.slice(2);
const runs = Number(args[args.indexOf("--runs") + 1] ?? 1) || 1;
const ALL = { haiku: "claude-haiku-5-5", sonnet: "claude-sonnet-5-5", opus: "claude-opus-5-5" } as const;
const pick = args.includes("--models") ? args[args.indexOf("--models") + 1]!.split(",") as (keyof typeof ALL)[] : (["haiku", "sonnet", "opus"] as const);
// --render: docs/agent-evals.md written again from the records, without calling Claude.
if (args.includes("--render")) {
  const mdPath = resolve(import.meta.dirname, "../../docs/agent-evals.md");
  const record = JSON.parse(readFileSync(resolve(import.meta.dirname, "../../docs/evals/agents.json"), "utf8")) as AgentEvalsRecord;
  writeFileSync(mdPath, withApSection(agentEvalsMarkdown(record), existsSync(mdPath) ? apSectionOf(readFileSync(mdPath, "utf8")) : ""));
  console.log("docs/agent-evals.md written from docs/evals/agents.json");
  process.exit(0);
}
const client = claudeClient();
if (!client) { console.error("KIT11_ANTHROPIC_API_KEY is not set"); process.exit(2); }
const SPEND = resolve(import.meta.dirname, "../../docs/runs/api-budget.jsonl");
if (budgetStatus(SPEND).blocks.evals.over) { console.error("the evals block of the API budget is spent (npm run budget)"); process.exit(2); }

// The code each row ran: the commit, and whether the checkout had changes outside this report's own files.
const { commit: COMMIT, dirty: DIRTY } = evalCommit(["docs/evals/agents.json", "docs/agent-evals.md", "docs/runs/api-budget.jsonl"]);

interface Row { case: string; agent: AgentName; kind: string; model: string; passed: number; runs: number; cost_usd_micros: number; median_ms: number; details: string[]; commit?: string; dirty?: boolean; words?: string[][] }
const rows: Row[] = [];
const onlyCases = args.includes("--case") ? args[args.indexOf("--case") + 1]!.split(",") : null;
if (onlyCases && args.includes("--agent")) { console.error("use --agent or --case, not both"); process.exit(2); }
const unknown = onlyCases?.filter((c) => !AGENT_CASES.some((x) => x.id === c)) ?? [];
if (unknown.length) { console.error(`no such case: ${unknown.join(", ")}`); process.exit(2); }
// --case runs only the named cases (and merges like --agent).
const only = args.includes("--agent") ? args[args.indexOf("--agent") + 1] : onlyCases ? "cases" : null;
for (const c of AGENT_CASES.filter((x) => (onlyCases ? onlyCases.includes(x.id) : !only || x.agent === only))) {
  // A case that rebuilds a run's moment runs on that run's model only (src/evals/agentFacts.ts).
  for (const name of pick.filter((n) => !c.model || n === c.model)) {
    // Checked before every case and model, so a long run stops at the block's end (each row's spend is recorded below).
    if (budgetStatus(SPEND).blocks.evals.over) { console.error("the evals block of the API budget is spent; stopping (npm run budget)"); process.exit(2); }
    const model = ALL[name];
    const r: Row = { case: c.id, agent: c.agent, kind: c.kind, model, passed: 0, runs, cost_usd_micros: 0, median_ms: 0, details: [], commit: COMMIT, dirty: DIRTY };
    const times: number[] = [];
    for (let i = 0; i < runs; i++) {
      const t0 = Date.now();
      const out: { pass: boolean; detail: string; run: { costMicros: number }; words?: string[] } = await c.run(model, client).catch((e: Error) => ({ pass: false, detail: `error: ${e.message.slice(0, 160)}`, run: { costMicros: 0 } }));
      if (out.words) (r.words ??= []).push(out.words);
      times.push(Date.now() - t0);
      if (out.pass) r.passed++;
      r.cost_usd_micros += out.run.costMicros;
      r.details.push(`${out.pass ? "pass" : "FAIL"}: ${out.detail}`);
    }
    times.sort((a, b) => a - b);
    r.median_ms = times[Math.floor(times.length / 2)]!;
    rows.push(r);
    if (r.cost_usd_micros > 0) recordSpend(SPEND, { block: "evals", usd_micros: r.cost_usd_micros, what: `agent-evals ${c.id} ${name} ×${runs}` });
    console.log(`${r.passed === runs ? "pass" : "FAIL"}  ${c.id.padEnd(24)} ${name.padEnd(7)} ${r.passed}/${runs}  ${(r.cost_usd_micros / 1e6).toFixed(4)} USD  ${(r.median_ms / 1000).toFixed(1)} s  ${r.details.at(-1)}`);
  }
}

const agents: AgentName[] = ["sourcing", "treasury", "support"];
// With --agent, the rows measured now replace the same case and model in the last report; the rest are kept, each with
// the time it ran, so the report always shows every agent.
const outPath = resolve(import.meta.dirname, "../../docs/evals/agents.json");
const stamp = new Date().toISOString();
for (const r of rows) (r as Row & { ran_at?: string }).ran_at = stamp;
if (only && existsSync(outPath)) {
  const old = (JSON.parse(readFileSync(outPath, "utf8")) as { rows: (Row & { ran_at?: string })[] }).rows;
  const fresh = new Set(rows.map((r) => `${r.case}|${r.model}`));
  rows.unshift(...old.filter((r) => !fresh.has(`${r.case}|${r.model}`) && AGENT_CASES.some((c) => c.id === r.case)));
  rows.sort((a, b) => AGENT_CASES.findIndex((c) => c.id === a.case) - AGENT_CASES.findIndex((c) => c.id === b.case) || a.model.localeCompare(b.model));
}
// The cheapest model that passed every run of every case of an agent (a model must have run all of its cases); the cases
// fixed to one run's model are not part of it.
const cheapest = Object.fromEntries(agents.map((a) => {
  const cases = AGENT_CASES.filter((c) => c.agent === a && !c.model).map((c) => c.id);
  const ok = [...new Set(rows.filter((r) => r.agent === a).map((r) => r.model))]
    .filter((m) => cases.every((c) => rows.some((r) => r.case === c && r.model === m && r.passed === r.runs)));
  ok.sort((x, y) => (PRICES[x]!.standard.output - PRICES[y]!.standard.output));
  return [a, ok[0] ?? null];
}));
// How the oldest rows' commits were read from git history stays with them.
const backfill = existsSync(outPath) ? (JSON.parse(readFileSync(outPath, "utf8")) as AgentEvalsRecord).commit_backfill : undefined;
const out = { ran_at: stamp, runs, models: [...new Set(rows.map((r) => r.model))], cheapest_passing: cheapest, ...(backfill && rows.some((r) => (r as { commit_source?: string }).commit_source) ? { commit_backfill: backfill } : {}), rows };
mkdirSync(resolve(import.meta.dirname, "../../docs/evals"), { recursive: true });
writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n");

// The payables agents' section (npm run ap-agent-evals) is kept as it is.
const mdPath = resolve(import.meta.dirname, "../../docs/agent-evals.md");
const md = withApSection(agentEvalsMarkdown(out), existsSync(mdPath) ? apSectionOf(readFileSync(mdPath, "utf8")) : "");
writeFileSync(mdPath, md);
console.log(`\ncheapest passing: ${agents.map((a) => `${a} ${cheapest[a] ?? "none"}`).join(", ")}`);
