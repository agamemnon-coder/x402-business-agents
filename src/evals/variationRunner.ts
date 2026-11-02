// D26: the variation batch. Runs simulated-rail worlds by seed (each one or more times), writes one result file per
// run under docs/runs/variation/<date>/, records each world's Claude cost in the evals block of the API budget, and
// stops before a world once that block has reached its cap. Resumable: a run whose result is on file under the
// variation root (any date) is skipped, so a batch started again does no work twice and spends nothing twice. A run
// is matched by its world's hash, not its label: if the generator changes, the same seed is a new world and runs again.
// Spend is recorded from the world's own ledger (its agent.run rows) in a finally, before the result is written, so a
// world that stops half-way is still counted; a world stops waking agents once the block's cap is reached mid-world.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { budgetStatus, recordSpend } from "../claude/budget.js";
import type { DB } from "../db/open.js";
import { sha256Hex } from "../lib/terms.js";
import { costOf, type AgentDecision, type SimResult } from "./simWorld.js";
import { generateWorld, type SimWorldSpec } from "./worlds.js";
import { timingStats } from "./treasuryTiming.js";

export const labelOf = (seed: number, rep: number) => (rep === 1 ? `sim-${seed}` : `sim-${seed}-r${rep}`);

/** The hash a run is matched by on resume: the world exactly as the generator makes it from the seed now. */
export const worldSha = (seed: number) => sha256Hex(JSON.stringify(generateWorld(seed)));
const doneKey = (sha: string, label: string) => `${label}@${sha.slice(0, 12)}`;

/** The runs on file under the variation root, any date, as label@world-hash: a file counts only when it reads as a result. */
export function doneRuns(root: string): Set<string> {
  const done = new Set<string>();
  if (!existsSync(root)) return done;
  for (const day of readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory())) for (const k of doneIn(join(root, day.name))) done.add(k);
  return done;
}

/** The runs on file in one batch's directory only, as label@world-hash (a re-run, `--rerun`, resumes from these alone). */
export function doneIn(dir: string): Set<string> {
  const done = new Set<string>();
  if (!existsSync(dir)) return done;
  for (const f of readdirSync(dir).filter((x) => /^sim-\d+(-r\d+)?\.json$/.test(x))) {
    try {
      const r = JSON.parse(readFileSync(join(dir, f), "utf8")) as Partial<SimResult>;
      if (r.label === f.replace(/\.json$/, "") && r.safety && r.world_sha256) done.add(doneKey(r.world_sha256, r.label));
    } catch { /* unreadable: not done, it runs again */ }
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
  /**
   * A re-run of worlds already on file, on new code (`--rerun`): only the runs in outDir count as done, so every seed
   * runs once more into outDir and an interrupted re-run still resumes without running a world twice.
   */
  rerun?: boolean;
  /** Runs one world; it hands the runner the world's ledger (so spend is counted even if it stops) and gets the budget left. */
  run(spec: SimWorldSpec, w: { ledger(db: DB): void; budgetLeftMicros: number }): Promise<SimResult>;
  log?(line: string): void;
}

/** The spend of the world in flight, for a signal handler (the CLI records it on Ctrl-C before exiting). */
let inFlight: (() => void) | null = null;
export function recordInFlight(): void { inFlight?.(); }

export async function runBatch(o: BatchOptions): Promise<{ ran: SimResult[]; skipped: string[]; stopped: string | null }> {
  const done = o.rerun ? doneIn(o.outDir) : doneRuns(o.root);
  const ran: SimResult[] = [];
  const skipped: string[] = [];
  let stopped: string | null = null;
  outer: for (const seed of o.seeds) {
    for (let rep = 1; rep <= o.repeat; rep++) {
      const label = labelOf(seed, rep);
      const sha = worldSha(seed);
      if (done.has(doneKey(sha, label))) { skipped.push(label); continue; }
      const b = budgetStatus(o.spendFile).blocks.evals;
      if (b.over || b.spentUsd >= b.capUsd) {
        stopped = `the evals block has reached its cap: ${b.spentUsd.toFixed(2)} of ${b.capUsd} USD spent; nothing more runs`;
        break outer;
      }
      let ledger: DB | null = null;
      let result: SimResult | null = null;
      let recorded = false;
      const record = () => {
        if (recorded) return;
        recorded = true;
        const cost = ledger ? costOf(ledger) : (result?.cost_usd_micros ?? 0);
        if (cost > 0) recordSpend(o.spendFile, { block: "evals", usd_micros: cost, what: `variation ${label}${result ? "" : " (stopped before its end)"}` });
      };
      inFlight = record;
      try {
        result = await o.run(generateWorld(seed), { ledger: (db) => { ledger = db; }, budgetLeftMicros: Math.max(0, Math.round((b.capUsd - b.spentUsd) * 1e6)) });
      } finally {
        record();
        inFlight = null;
      }
      const r: SimResult = { ...result, label, world_sha256: sha };
      mkdirSync(o.outDir, { recursive: true });
      writeFileSync(join(o.outDir, `${label}.json`), `${JSON.stringify(r, null, 2)}\n`);
      ran.push(r);
      o.log?.(`${label}: ${r.decisions.length} decisions (${Math.round((1 - r.fallback_share) * 100)}% Claude), ${r.safety.unsafe} unsafe, ${(r.cost_usd_micros / 1e6).toFixed(4)} USD`);
      if (r.stopped_early) { stopped = `${label}: ${r.stopped_early}; nothing more runs`; break outer; }
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
    "## Treasury's timing (Max, 2 November)",
    "",
    "Seconds from the first `customers.turned_away` event (or, without one, the third buy-policy refusal) to the first `mandate_replace` proposal, as the dry-run harness measures it. Simulated worlds measure the agents' own work only (queries are instant, agents with news wake at once); live worlds add the query interval and the runner's poll, so the two are never pooled.",
    "",
    "| Worlds | Runs | Customers turned away | Options came (n) | Median s | p90 s | Max s | Options before turned away | No options |",
    "|---|---|---|---|---|---|---|---|---|",
    ...(["simulated", "live"] as const).map((kind) => {
      const of = rs.filter((r) => (r.rails ?? "simulated") === kind);
      const t = of.map((r) => r.treasury_timing).filter((x) => x?.applies);
      const before = t.filter((x) => x!.options_before).length;
      const s = timingStats(t.filter((x) => !x!.options_before).map((x) => x!.seconds));
      const v = (x: number | null) => (x === null ? "–" : String(x));
      return `| ${kind} | ${of.length} | ${t.length} | ${s.n} | ${v(s.median)} | ${v(s.p90)} | ${v(s.max)} | ${before} | ${s.none ? t.filter((x) => x!.seconds === null && !x!.options_before).map((x) => x!.words).join("; ") : "0"} |`;
    }),
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
    "| Run | World | Sourcing | Treasury | Support | Treasury timing | Safe | Cost (USD) |",
    "|---|---|---|---|---|---|---|---|",
    ...rs.map((r) => `| ${r.label} | ${cell(world(r.world))} | ${cell(choiceOf(r, "sourcing"))} | ${cell(choiceOf(r, "treasury"))} | ${cell(choiceOf(r, "support"))} | ${cell(r.treasury_timing?.words ?? "not recorded")} | ${r.safety.unsafe + r.safety.double_payments + r.safety.missing_origin === 0 ? "✅" : `❌ ${cell(r.safety.findings.map((f) => f.detail).join("; "))}`} | ${(r.cost_usd_micros / 1e6).toFixed(4)} |`),
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
