// npm run agent-evals [-- --runs N] [-- --models haiku,sonnet,opus] [-- --agent treasury]: the three Kit 11 agents' evals with real models
// (src/evals/agentEvals.ts), per model, N runs each. Writes docs/evals/agents.json and docs/agent-evals.md: per case
// and model, how often it passed, what it cost and how long it took, and per agent the cheapest model that passed
// every run. Needs KIT11_ANTHROPIC_API_KEY; spends real money (a few cents a run). Never part of npm test.

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { claudeClient } from "../claude/reader.js";
import { PRICES } from "../claude/pricing.js";
import { AGENT_CASES, type AgentName } from "../evals/agentEvals.js";

const args = process.argv.slice(2);
const runs = Number(args[args.indexOf("--runs") + 1] ?? 1) || 1;
const ALL = { haiku: "claude-haiku-5-5", sonnet: "claude-sonnet-5-5", opus: "claude-opus-5-5" } as const;
const pick = args.includes("--models") ? args[args.indexOf("--models") + 1]!.split(",") as (keyof typeof ALL)[] : (["haiku", "sonnet", "opus"] as const);
const client = claudeClient();
if (!client) { console.error("KIT11_ANTHROPIC_API_KEY is not set"); process.exit(2); }

interface Row { case: string; agent: AgentName; kind: string; model: string; passed: number; runs: number; cost_usd_micros: number; median_ms: number; details: string[] }
const rows: Row[] = [];
const only = args.includes("--agent") ? args[args.indexOf("--agent") + 1] : null;
for (const c of AGENT_CASES.filter((x) => !only || x.agent === only)) {
  for (const name of pick) {
    const model = ALL[name];
    const r: Row = { case: c.id, agent: c.agent, kind: c.kind, model, passed: 0, runs, cost_usd_micros: 0, median_ms: 0, details: [] };
    const times: number[] = [];
    for (let i = 0; i < runs; i++) {
      const t0 = Date.now();
      const out = await c.run(model, client).catch((e: Error) => ({ pass: false, detail: `error: ${e.message.slice(0, 160)}`, run: { costMicros: 0 } }));
      times.push(Date.now() - t0);
      if (out.pass) r.passed++;
      r.cost_usd_micros += out.run.costMicros;
      r.details.push(`${out.pass ? "pass" : "FAIL"}: ${out.detail}`);
    }
    times.sort((a, b) => a - b);
    r.median_ms = times[Math.floor(times.length / 2)]!;
    rows.push(r);
    console.log(`${r.passed === runs ? "pass" : "FAIL"}  ${c.id.padEnd(24)} ${name.padEnd(7)} ${r.passed}/${runs}  ${(r.cost_usd_micros / 1e6).toFixed(4)} USD  ${(r.median_ms / 1000).toFixed(1)} s  ${r.details.at(-1)}`);
  }
}

const agents: AgentName[] = ["sourcing", "treasury", "support"];
const cheapest = Object.fromEntries(agents.map((a) => {
  const ok = pick.map((n) => ALL[n]).filter((m) => rows.filter((r) => r.agent === a && r.model === m).every((r) => r.passed === r.runs));
  ok.sort((x, y) => (PRICES[x]!.standard.output - PRICES[y]!.standard.output));
  return [a, ok[0] ?? null];
}));
const out = { ran_at: new Date().toISOString(), runs, models: pick.map((n) => ALL[n]), cheapest_passing: cheapest, rows };
mkdirSync(resolve(import.meta.dirname, "../../docs/evals"), { recursive: true });
writeFileSync(resolve(import.meta.dirname, "../../docs/evals/agents.json"), JSON.stringify(out, null, 2) + "\n");

const md = [
  "# Agent evals: the three Kit 11 agents with real models",
  "",
  `Run ${out.ran_at.slice(0, 16).replace("T", " ")} UTC, ${runs} run(s) per case and model, with \`npm run agent-evals\` (\`src/evals/agentEvals.ts\`). Stand-in tools: no chain, no Airwallex. Code's gates stay on, so an attack passes only when the outcome is right; the detail counts the calls code refused.`,
  "",
  "| Case | Kind | Model | Passed | Cost (USD) | Median time | Last run |",
  "|---|---|---|---|---|---|---|",
  ...rows.map((r) => `| ${r.case} | ${r.kind} | ${r.model} | ${r.passed}/${r.runs} | ${(r.cost_usd_micros / 1e6).toFixed(4)} | ${(r.median_ms / 1000).toFixed(1)} s | ${r.details.at(-1)!.replace(/\|/g, "/")} |`),
  "",
  "## Cheapest model that passed every run",
  "",
  ...agents.map((a) => `- ${a}: ${cheapest[a] ?? "none of the models tried"}`),
  "",
].join("\n");
writeFileSync(resolve(import.meta.dirname, "../../docs/agent-evals.md"), md);
console.log(`\ncheapest passing: ${agents.map((a) => `${a} ${cheapest[a] ?? "none"}`).join(", ")}`);
