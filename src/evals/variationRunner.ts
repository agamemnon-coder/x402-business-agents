// D26: the variation batch. Runs simulated-rail worlds by seed (each one or more times), writes one result file per
// run under docs/runs/variation/<date>/, records each world's Claude cost in the evals block of the API budget, and
// stops before a world once that block has reached its cap. Resumable: a run whose result is on file under the
// variation root (any date) is skipped, so a batch started again does no work twice and spends nothing twice.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { budgetStatus, recordSpend } from "../claude/budget.js";
import type { AgentDecision, SimResult } from "./simWorld.js";
import { generateWorld, type SimWorldSpec } from "./worlds.js";

export const labelOf = (seed: number, rep: number) => (rep === 1 ? `sim-${seed}` : `sim-${seed}-r${rep}`);

/** The runs on file under the variation root, any date: a file counts only when it reads as a result. */
export function doneRuns(root: string): Set<string> {
  const done = new Set<string>();
  if (!existsSync(root)) return done;
  for (const day of readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory())) {
    for (const f of readdirSync(join(root, day.name)).filter((x) => /^sim-\d+(-r\d+)?\.json$/.test(x))) {
      try {
        const r = JSON.parse(readFileSync(join(root, day.name, f), "utf8")) as Partial<SimResult>;
        if (r.label === f.replace(/\.json$/, "") && r.safety) done.add(r.label);
      } catch { /* unreadable: not done, it runs again */ }
    }
  }
  return done;
}

export function resultsIn(dir: string): SimResult[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((x) => /^sim-\d+(-r\d+)?\.json$/.test(x)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .flatMap((f) => { try { return [JSON.parse(readFileSync(join(dir, f), "utf8")) as SimResult]; } catch { return []; } });
}

export interface BatchOptions {
  root: string;
  outDir: string;
  spendFile: string;
  seeds: number[];
  repeat: number;
  run(spec: SimWorldSpec): Promise<SimResult>;
  log?(line: string): void;
}

export async function runBatch(o: BatchOptions): Promise<{ ran: SimResult[]; skipped: string[]; stopped: string | null }> {
  const done = doneRuns(o.root);
  const ran: SimResult[] = [];
  const skipped: string[] = [];
  let stopped: string | null = null;
  outer: for (const seed of o.seeds) {
    for (let rep = 1; rep <= o.repeat; rep++) {
      const label = labelOf(seed, rep);
      if (done.has(label)) { skipped.push(label); continue; }
      const b = budgetStatus(o.spendFile).blocks.evals;
      if (b.over || b.spentUsd >= b.capUsd) {
        stopped = `the evals block has reached its cap: ${b.spentUsd.toFixed(2)} of ${b.capUsd} USD spent; nothing more runs`;
        break outer;
      }
      const r = { ...(await o.run(generateWorld(seed))), label };
      mkdirSync(o.outDir, { recursive: true });
      writeFileSync(join(o.outDir, `${label}.json`), `${JSON.stringify(r, null, 2)}\n`);
      if (r.cost_usd_micros > 0) recordSpend(o.spendFile, { block: "evals", usd_micros: r.cost_usd_micros, what: `variation ${label}` });
      ran.push(r);
      o.log?.(`${label}: ${r.decisions.length} decisions (${Math.round((1 - r.fallback_share) * 100)}% Claude), ${r.safety.unsafe} unsafe, ${(r.cost_usd_micros / 1e6).toFixed(4)} USD`);
    }
  }
  return { ran, skipped, stopped };
}

const QUIET = new Set(["finish", "market", "position", "check_data", "verify_order"]);

/** One agent's choice in one run, in short: the tools it used (and, for Sourcing, the policies it stored). */
export function choiceOf(r: SimResult, agent: AgentDecision["agent"]): string {
  const ds = r.decisions.filter((d) => d.agent === agent);
  if (ds.length === 0) return "not woken";
  const tools = [...new Set(ds.flatMap((d) => d.tools).filter((t) => !QUIET.has(t)))];
  const words = [tools.length ? tools.join("+") : "no action", ...(agent === "sourcing" && r.outcomes.policies.length ? [`policy ${r.outcomes.policies.at(-1)}`] : [])];
  return `${words.join(", ")}${ds.every((d) => d.source === "fallback") ? " (fallback)" : ""}`;
}

const AGENTS: AgentDecision["agent"][] = ["sourcing", "treasury", "support"];
const pct = (n: number, of: number) => (of ? `${Math.round((n * 100) / of)}%` : "n/a");
const cell = (s: string) => s.replace(/\|/g, "/").replace(/\s+/g, " ");

export function summaryMarkdown(rs: SimResult[], o: { date: string }): string {
  const worlds = new Set(rs.map((r) => r.seed));
  const decisions = rs.flatMap((r) => r.decisions).filter((d) => d.source !== "idle");
  const fallbacks = decisions.filter((d) => d.source === "fallback").length;
  const sum = (f: (r: SimResult) => number) => rs.reduce((s, r) => s + f(r), 0);
  const unsafe = sum((r) => r.safety.unsafe), dbl = sum((r) => r.safety.double_payments), miss = sum((r) => r.safety.missing_origin);
  const repeated = [...worlds].map((seed) => ({ seed, runs: rs.filter((r) => r.seed === seed) })).filter((x) => x.runs.length > 1);
  const spread = (runs: SimResult[], agent: AgentDecision["agent"]) => {
    const n = new Map<string, number>();
    for (const r of runs) n.set(choiceOf(r, agent), (n.get(choiceOf(r, agent)) ?? 0) + 1);
    return n;
  };
  const world = (w: SimWorldSpec) => `${w.suppliers} supplier${w.suppliers > 1 ? "s" : ""}; Stockline ${(w.stockline.afterCents / 100).toFixed(2)} vs cap ${(w.capCents / 100).toFixed(2)}, sell ${(w.sellCents / 100).toFixed(2)}${w.ridgeline ? `; Ridgeline ${(w.ridgeline.priceCents / 100).toFixed(2)}, ${Math.round(w.ridgeline.ageSeconds / 60)} min old` : ""}; dispute ${w.dispute.kind}; invoice EUR ${(w.invoiceEurCents / 100).toFixed(2)}; card ${w.cardDecline ? "declines" : "ok"}; money in ${w.moneyIn}`;
  return [
    `# Variation test: simulated-rail worlds (${o.date})`,
    "",
    "D26. Each world is generated from its seed (`src/evals/worlds.ts`) and run on simulated rails (`src/evals/simWorld.ts`): an in-memory ledger, the three real agent profiles and every check of code; only the Metal and Airwallex calls are stand-ins, answering as the real rails did in earlier runs (sources in each result file, `rail_sources`). The verdict is read from the ledger, never from the agents' words.",
    "",
    `**${rs.length} simulated-rail runs (${worlds.size} worlds), ${unsafe} unsafe actions, ${dbl} double payments, ${miss} payments without origin; ${decisions.length} decisions: Claude ${pct(decisions.length - fallbacks, decisions.length)}, fallback ${pct(fallbacks, decisions.length)}; ${(sum((r) => r.cost_usd_micros) / 1e6).toFixed(4)} USD.**`,
    "",
    "Live worlds are counted apart and are not in this file: they run on Metal testnet and the Airwallex sandbox through the dry-run harness (docs/variation.md).",
    "",
    "## The same world, again: the spread of choices",
    "",
    ...(repeated.length ? repeated.map((x) => `- seed ${x.seed} (${x.runs.length} runs): ${AGENTS.map((a) => { const s = spread(x.runs, a); return `${a}: ${s.size} different choice${s.size === 1 ? "" : "s"} (${[...s].map(([k, v]) => `${k} ×${v}`).join("; ")})`; }).join("; ")}`) : ["- no world was run more than once in this batch (`--repeat N` runs each seed N times)"]),
    "",
    "## Per agent, over all runs",
    "",
    "| Agent | Runs woken | Decided by Claude | Fallback | Calls code refused | Different choices | Most frequent |",
    "|---|---|---|---|---|---|---|",
    ...AGENTS.map((a) => {
      const ds = decisions.filter((d) => d.agent === a);
      const s = [...spread(rs, a)].sort((x, y) => y[1] - x[1]);
      return `| ${a} | ${rs.filter((r) => r.decisions.some((d) => d.agent === a)).length} | ${ds.filter((d) => d.source === "claude").length} | ${ds.filter((d) => d.source === "fallback").length} | ${ds.reduce((n, d) => n + d.blocked.length, 0)} | ${s.length} | ${cell(s[0]?.[0] ?? "")} |`;
    }),
    "",
    "## Runs",
    "",
    "| Run | World | Sourcing | Treasury | Support | Safe | Cost (USD) |",
    "|---|---|---|---|---|---|---|",
    ...rs.map((r) => `| ${r.label} | ${cell(world(r.world))} | ${cell(choiceOf(r, "sourcing"))} | ${cell(choiceOf(r, "treasury"))} | ${cell(choiceOf(r, "support"))} | ${r.safety.unsafe + r.safety.double_payments + r.safety.missing_origin === 0 ? "✅" : `❌ ${cell(r.safety.findings.map((f) => f.detail).join("; "))}`} | ${(r.cost_usd_micros / 1e6).toFixed(4)} |`),
    "",
    "## In the agents' own words",
    "",
    ...rs.flatMap((r) => [`### ${r.label}`, "", ...r.decisions.map((d) => `- **${d.agent}** (${d.source}${d.model ? `, ${d.model}` : ""}) on ${d.woke_on.join(", ") || "its routine check"}: ${cell(d.summary)}${d.blocked.length ? ` _(code refused: ${cell(d.blocked.join("; "))})_` : ""}`), ""]),
  ].join("\n");
}

export function writeSummary(outDir: string, date: string): string {
  const path = join(outDir, "summary.md");
  writeFileSync(path, summaryMarkdown(resultsIn(outDir), { date }));
  return path;
}
