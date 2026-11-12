// /claude, measured, not asserted (jury panel, 12 Nov): four figures on top, each linking its record (the 40 simulated
// worlds, the 10 blind holdouts, the one model that failed an attack, each model on each agent); the injection screen as
// code holds it; the failure story in three lines; each agent on each model as the sweep of 6 November measured it, with
// the Treasury choice said as measured; and the agent interface over MCP, one session read from its record. Every figure
// is read here from its record; a record that is missing or changed leaves its line out. The hostile-model line shows
// only when its report (docs/zero-trust/report.json) exists when the page is built.

import { existsSync, readFileSync } from "node:fs";
import { REPO_BLOB } from "./metalStory.js";
import { esc } from "./ui.js";

export const VARIATION_SUMMARY = "docs/runs/variation/2026-11-02/summary.md";
export const VARIATION_FIX_SUMMARY = "docs/runs/variation-after-fix-final/2026-11-02/summary.md";
export const VARIATION_RECORD = "docs/runs/2026-11-02-night-batch.md";
export const HOLDOUTS_RECORD = "docs/runs/holdouts/2026-11-03-blind/results.md";
export const SWEEP_RECORD = "docs/evals/agents.json";
export const AGENT_EVALS = "docs/agent-evals.md";
export const MCP_TRANSCRIPT = "docs/runs/2026-11-12-mcp-transcript.json";
export const ZERO_TRUST_REPORT = "docs/zero-trust/report.json";
/** The injection screen as code holds it (src/policy/injection.ts; the agents' tools in src/agents/*Agent.ts). */
export const INJECTION_LINE = "A line aimed at the AI is flagged for the CFO and moves nothing: the agents' tools have no payee or approval field; payees come from the allowlist.";

const read = (file: string): string | null => { try { return readFileSync(new URL(`../../${file}`, import.meta.url), "utf8"); } catch { return null; } };

export interface Variation { runs: number; worlds: number; unsafe: number; decisions: number; claudePct: number; usd: string }
/** A variation summary's headline: runs, worlds, unsafe actions, decisions, Claude's share. */
export function variationOf(md: string | null): Variation | null {
  const m = /\*\*(\d+) simulated-rail runs \((\d+) worlds\), (\d+) unsafe actions?, \d+ double payments, \d+ payments without origin; (\d+) decisions: Claude (\d+)%, fallback \d+%; ([\d.]+) USD\.\*\*/.exec(md ?? "");
  return m ? { runs: Number(m[1]), worlds: Number(m[2]), unsafe: Number(m[3]), decisions: Number(m[4]), claudePct: Number(m[5]), usd: m[6]! } : null;
}

export interface Holdouts { run: number; safe: number; partial: string | null }
export function holdoutsOf(md: string | null): Holdouts | null {
  const m = /\*\*(\d+) scenarios run, (\d+) safe: no money moved outside the rules[^*]*\*\*\s+(H\d+) passes on the\s+code's rule only/.exec(md ?? "");
  return m ? { run: Number(m[1]), safe: Number(m[2]), partial: m[3]! } : null;
}

interface SweepRow { case: string; agent: string; kind: string; model: string; passed: number; runs: number; cost_usd_micros: number; median_ms: number; details: string[] }
export interface Sweep { ranAt: string; rows: SweepRow[] }
export function sweepOf(json: string | null): Sweep | null {
  try {
    const j = JSON.parse(json ?? "") as { ran_at?: unknown; rows?: unknown };
    return typeof j.ran_at === "string" && Array.isArray(j.rows) && j.rows.length ? { ranAt: j.ran_at, rows: j.rows as SweepRow[] } : null;
  } catch { return null; }
}

export interface ModelLine { agent: string; model: string; passed: number; runs: number; costPerPass: number; medianS: number }
const FAMILY = (m: string) => /haiku/.test(m) ? "Haiku" : /sonnet/.test(m) ? "Sonnet" : /opus/.test(m) ? "Opus" : m;
/** Each agent on each model: passes, cost per passing run (USD), the median of the cases' median times. */
export function modelLines(s: Sweep): ModelLine[] {
  const keys = [...new Set(s.rows.map((r) => `${r.agent}|${r.model}`))];
  return keys.map((k) => {
    const [agent, model] = k.split("|") as [string, string];
    const rows = s.rows.filter((r) => r.agent === agent && r.model === model);
    const passed = rows.reduce((n, r) => n + r.passed, 0), runs = rows.reduce((n, r) => n + r.runs, 0), cost = rows.reduce((n, r) => n + r.cost_usd_micros, 0);
    const ms = rows.map((r) => r.median_ms).sort((x, y) => x - y);
    return { agent, model, passed, runs, costPerPass: passed ? cost / passed / 1e6 : 0, medianS: (ms[Math.floor(ms.length / 2)] ?? 0) / 1000 };
  }).sort((x, y) => ["sourcing", "treasury", "support"].indexOf(x.agent) - ["sourcing", "treasury", "support"].indexOf(y.agent) || ["Haiku", "Sonnet", "Opus"].indexOf(FAMILY(x.model)) - ["Haiku", "Sonnet", "Opus"].indexOf(FAMILY(y.model)));
}

/** Treasury's rebalance cases: how often each model's first plan passed code's checks (the rest came back with the reason). */
export function firstTry(s: Sweep, model: string): { first: number; of: number } {
  let first = 0, of = 0;
  for (const r of s.rows.filter((x) => x.agent === "treasury" && x.model === model && /^treasury-(rebalance|tight|injected|headroom)$/.test(x.case))) {
    for (const d of r.details) { const t = /(\d+) tr(?:y|ies)/.exec(d); if (t) { of++; if (t[1] === "1") first++; } }
  }
  return { first, of };
}

export interface McpSession { server: string; tools: string[]; steps: { call: string; arguments?: Record<string, unknown>; is_error: boolean; answer: string }[]; approvalAfter: number; standIns: string[] }
export function mcpOf(json: string | null): McpSession | null {
  try {
    const j = JSON.parse(json ?? "") as { server?: { name?: unknown }; tools?: { name: string }[]; steps?: McpSession["steps"]; approval_between?: { after_step?: unknown }; stand_ins?: unknown; network?: unknown };
    if (typeof j.server?.name !== "string" || !Array.isArray(j.tools) || !Array.isArray(j.steps) || !j.steps.length || j.network !== "none" || !Array.isArray(j.stand_ins)) return null;
    return { server: j.server.name, tools: j.tools.map((t) => t.name), steps: j.steps, approvalAfter: typeof j.approval_between?.after_step === "number" ? j.approval_between.after_step : -1, standIns: j.stand_ins as string[] };
  } catch { return null; }
}

export interface ClaudeEvidence { variation: Variation | null; fix: Variation | null; holdouts: Holdouts | null; sweep: Sweep | null; mcp: McpSession | null; zeroTrust: boolean }
export const claudeEvidence = (): ClaudeEvidence => ({
  variation: variationOf(read(VARIATION_SUMMARY)), fix: variationOf(read(VARIATION_FIX_SUMMARY)), holdouts: holdoutsOf(read(HOLDOUTS_RECORD)),
  sweep: sweepOf(read(SWEEP_RECORD)), mcp: mcpOf(read(MCP_TRANSCRIPT)), zeroTrust: existsSync(new URL(`../../${ZERO_TRUST_REPORT}`, import.meta.url)),
});

export const EVIDENCE_CSS = `.cev { padding: 16px 18px; display: grid; gap: 6px; }
.cev h2 { font-size: 19px; line-height: 1.25; margin: 0; }
.cev ul { margin: 0; padding: 0; list-style: none; display: grid; gap: 0; }
.cev li { font-size: 15.5px; line-height: 1.45; padding: 6px 0; border-top: 1px solid var(--border); overflow-wrap: anywhere; }
.cev li:first-child { border-top: 0; }
.cev li b { font-variant-numeric: tabular-nums; }
.cev .mnote { margin: 4px 0 0; font-size: 14.5px; color: var(--muted); line-height: 1.45; }
.cev a.pf, .cmx a.pf { display: inline-flex; align-items: center; min-height: 44px; vertical-align: middle; }
table.cmx { width: 100%; border-collapse: collapse; font-size: 14.5px; font-variant-numeric: tabular-nums; table-layout: fixed; }
table.cmx th, table.cmx td { text-align: left; padding: 6px 8px 6px 0; border-top: 1px solid var(--border); overflow-wrap: anywhere; }
pre.cmcp { margin: 4px 0 8px; padding: 10px 12px; background: var(--sunken); border-radius: 10px; font: 600 12.5px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; white-space: pre-wrap; overflow-wrap: anywhere; }
@media (max-width: 700px) { table.cmx { font-size: 12.5px; } }`;

const link = (file: string, label = "record") => `<a class="pf" href="${esc(`${REPO_BLOB}${file}`)}" target="_blank" rel="noopener">${esc(label)} ↗</a>`;
const usd = (n: number) => n >= 0.01 ? n.toFixed(3) : n.toFixed(4);

/** The four figures on top, each with its record, and the injection screen under them. */
export function measuredBlock(e: ClaudeEvidence): string {
  const lines = modelLinesOf(e), haikuSupport = e.sweep?.rows.find((r) => r.agent === "support" && /haiku/.test(r.model) && r.passed === 0);
  const items = [
    e.variation ? `<li data-rec="${esc(VARIATION_RECORD)}"><b>${esc(String(e.variation.decisions))}</b>${esc(` decisions in ${e.variation.worlds} simulated worlds, ${e.variation.claudePct === 100 ? "all" : `${e.variation.claudePct}%`} by Claude; ${e.variation.unsafe} unsafe actions${e.fix && e.fix.unsafe === 0 ? ", fixed" : ""}.`)} ${link(VARIATION_RECORD)}</li>` : "",
    e.holdouts ? `<li data-rec="${esc(HOLDOUTS_RECORD)}"><b>${esc(String(e.holdouts.run))}</b>${esc(` blind holdouts, ${e.holdouts.safe} safe${e.holdouts.partial ? `; ${e.holdouts.partial} only on code's rule` : ""}.`)} ${link(HOLDOUTS_RECORD)}</li>` : "",
    haikuSupport ? `<li data-rec="${esc(AGENT_EVALS)}"><b>${esc(`${haikuSupport.passed} of ${haikuSupport.runs}`)}</b>${esc(": Haiku as Support on one attack; code refused each stray call.")} ${link(AGENT_EVALS)}</li>` : "",
    lines.length ? `<li data-rec="${esc(SWEEP_RECORD)}"><b>${esc(String(lines.length))}</b>${esc(` model and agent pairs: pass rate, cost, time.`)} ${link(SWEEP_RECORD)}</li>` : "",
    ...(e.zeroTrust ? [`<li data-rec="${esc(ZERO_TRUST_REPORT)}">${esc("A hostile model in the agent's seat: see its report.")} ${link(ZERO_TRUST_REPORT)}</li>`] : []),
  ].filter(Boolean);
  return items.length ? `<section class="cev card" aria-labelledby="cev-h"><h2 id="cev-h">${esc("Measured, not asserted")}</h2><ul>${items.join("")}</ul><p class="mnote">${esc(INJECTION_LINE)}</p></section>` : "";
}

const modelLinesOf = (e: ClaudeEvidence) => e.sweep ? modelLines(e.sweep) : [];

/** Each agent on each model (the sweep of 6 November), with the Treasury choice as measured. */
export function sweepFold(e: ClaudeEvidence, used: Record<string, string>): string {
  const s = e.sweep;
  if (!s) return "";
  const lines = modelLines(s), day = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(s.ranAt));
  const verdict = (l: ModelLine) => used[l.agent] === FAMILY(l.model) ? "in use" : l.passed === l.runs ? "passes" : `misses ${l.runs - l.passed}`;
  const t = (m: string) => lines.find((l) => l.agent === "treasury" && FAMILY(l.model) === m);
  const h = t("Haiku"), o = t("Opus"), hf = firstTry(s, s.rows.find((r) => /haiku/.test(r.model))?.model ?? ""), of = firstTry(s, s.rows.find((r) => /opus/.test(r.model))?.model ?? "");
  const treasury = h && o && h.passed === h.runs ? `Treasury: Haiku passed every Treasury run (${h.passed} of ${h.runs}) at 1/${Math.round(o.costPerPass / h.costPerPass)} of Opus's cost per pass, but its first plan passed code's checks in ${hf.first} of ${hf.of} rebalance runs, Opus's in ${of.first} of ${of.of}. Treasury runs on Opus.` : "";
  return `<details class="fold" data-rec="${esc(SWEEP_RECORD)}"><summary>${esc(`Each agent on each model (${day})`)}</summary><table class="cmx"><thead><tr><th scope="col">Agent</th><th scope="col">Model</th><th scope="col">Passed</th><th scope="col">USD a pass</th><th scope="col">Time</th><th scope="col">Verdict</th></tr></thead><tbody>${lines.map((l) => `<tr><td>${esc(`${l.agent[0]!.toUpperCase()}${l.agent.slice(1)}`)}</td><td>${esc(FAMILY(l.model))}</td><td>${esc(`${l.passed}/${l.runs}`)}</td><td>${esc(usd(l.costPerPass))}</td><td>${esc(`${l.medianS.toFixed(1)} s`)}</td><td>${esc(verdict(l))}</td></tr>`).join("")}</tbody></table><ul class="pl">${treasury ? `<li>${esc(treasury)}</li>` : ""}<li>${esc(`In use in the main run: ${Object.entries(used).map(([a, f]) => `${a[0]!.toUpperCase()}${a.slice(1)} on ${f}`).join(", ")}. Real models, simulated tools, 10 runs a case; time is the median of the cases' medians.`)} ${link(SWEEP_RECORD)} ${link(AGENT_EVALS, "all cases")}</li></ul></details>`;
}

/** The failure story in three lines: what went wrong, what held, what changed. */
export function failureFold(e: ClaudeEvidence): string {
  if (!e.variation || !e.variation.unsafe) return "";
  return `<details class="fold" data-rec="${esc(VARIATION_RECORD)}"><summary>${esc("What went wrong")}</summary><ul class="pl">
<li>${esc(`In ${e.variation.unsafe} of ${e.variation.worlds} simulated worlds, an agent passed an unvetted payee address to another agent.`)}</li>
<li>${esc("No payment was possible: code pays only payees on the allowlist.")}</li>
<li>${esc(`Code now withholds the address${e.fix && e.fix.unsafe === 0 ? `; the ${e.fix.runs} re-runs of those worlds had none` : ""}.`)} ${link(VARIATION_RECORD)}</li></ul></details>`;
}

/** The agent interface over MCP: one session, as its record holds it. */
export function mcpFold(e: ClaudeEvidence): string {
  const m = e.mcp;
  if (!m) return "";
  const lines = m.steps.flatMap((s, i) => [
    `→ ${s.call}${s.arguments ? ` ${JSON.stringify(s.arguments)}` : ""}`, `← ${s.is_error ? "error: " : ""}${s.answer.replace(/\s*\n\s*/g, " ")}`,
    ...(i === m.approvalAfter - 1 ? ["(the CFO approves P-0001; here in code, not Face ID; the card is issued)"] : []),
  ]);
  return `<details class="fold" id="mcp" data-rec="${esc(MCP_TRANSCRIPT)}"><summary>${esc("The agent interface over MCP")}</summary><ul class="pl"><li>${esc(`One outside agent's session with server ${m.server}; its tools: ${m.tools.join(", ")}. None can approve. In-process, no network: an in-memory ledger, a simulated card issuer (not Airwallex, though the answers name it), the CFO's approval given in code (not Face ID), no model.`)} ${link(MCP_TRANSCRIPT)}</li></ul><pre class="cmcp">${esc(lines.join("\n"))}</pre></details>`;
}
