// 4.1 The agent trace: one timeline per agent decision, the way LangSmith or Datadog lay out a request. It is built
// only from the audit chain: the agent's `agent.run` row (model, turns, tokens, cost, latency, and the audit position
// it started from), each `agent.tool` row (input, result, time, the check that stopped it), the rows each call caused
// (a refusal on chain with its tx, a refund with its tx, an Airwallex id), and the decision row code wrote after the
// run. Every step carries its row's hash, so a reader can check it against the exported audit log. Read-only; with
// the agents off there are no agent rows, so there are no traces.

import { AGENT_DISPLAY } from "../config/brand.js";
import type { DB } from "../db/open.js";
import { describe as words } from "./snapshot.js";

export interface TraceStep {
  seq: number;
  ts: string;
  kind: "tool" | "effect" | "run" | "decision";
  event: string;
  text: string;
  tool: string | null;
  input: unknown;
  result: string | null;
  blocked: boolean;
  /** What let this step through or stopped it: a rail, a check in code, or a person. */
  check: string;
  ms: number | null;
  tx: string | null;
  awx_id: string | null;
  hash: string;
}

export interface Trace {
  run_seq: number;
  agent: string;
  agent_name: string;
  task: string;
  model: string;
  status: string;
  turns: number;
  tokens: { input: number; output: number; cache_read: number; cache_write: number } | null;
  cost_usd_micros: number;
  latency_ms: number | null;
  claude_ms: number[];
  said: string;
  note: string | null;
  decision_seq: number | null;
  steps: TraceStep[];
}

interface Row { seq: number; ts: string; actor: string; event: string; subject: string | null; payload_json: string; row_hash: string }
type P = Record<string, unknown>;

/** The decision row code writes after each agent's run. */
const DECISION: Record<string, string> = { sourcing: "price_rise.met", treasury: "price_rise.plan", support: "dispute.settled_by_agent" };

/** What lets a tool call through when nothing stopped it. */
const TOOL_CHECK: Record<string, string> = {
  check_offer: "read only",
  verify_order: "read only: the signed order and its payment, from the chain",
  check_data: "read only: code's own check of the delivered data",
  try_purchase: "the Metal mandate on chain (cap per payment, budget)",
  notify_treasury: "a message to the Treasury agent, only after Metal answered; it moves no money",
  submit_plan: "code's plan checks (the 20.00 total, caps, budgets, margin)",
  refund: "code's evidence gate and the automatic refund limits, then the Metal mandate",
  escalate_to_cfo: "goes to the CFO, who decides with Face ID",
};

const str = (v: unknown) => (v === undefined || v === null ? "" : String(v));
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

function decisionCheck(r: Row, p: P): string {
  if (r.event === "price_rise.plan") {
    return str(p.source) === "claude"
      ? `accepted by code's plan checks after ${str(p.attempts) || "1"} ${str(p.attempts) === "1" ? "try" : "tries"}; the CFO decides with Face ID`
      : "code's fixed plan (the agent's was not used); the CFO decides with Face ID";
  }
  if (r.event === "dispute.settled_by_agent") return "complete: every wrong order refunded, the rest sent to the CFO, who decides with Face ID";
  if (r.event === "price_rise.met") return str(p.source) === "claude" ? "Metal decided on chain; the agent's message goes to the Treasury agent" : "code decided (the agent did not try)";
  return "";
}

export function agentTraces(db: DB, all?: Row[]): Trace[] {
  const rows = all ?? (db.prepare("SELECT seq, ts, actor, event, subject, payload_json, row_hash FROM audit_log ORDER BY seq").all() as Row[]);
  const runs = rows.filter((r) => r.event === "agent.run");
  const traces: Trace[] = [];
  for (const run of runs) {
    const p = JSON.parse(run.payload_json) as P;
    const agent = run.actor;
    const prevRun = runs.filter((r) => r.actor === agent && r.seq < run.seq).at(-1)?.seq ?? 0;
    const nextRun = runs.find((r) => r.actor === agent && r.seq > run.seq)?.seq ?? Infinity;
    // Runs recorded before the trace existed have no from_seq: they start at their first tool call.
    const from = num(p.from_seq) ?? ((rows.find((r) => r.seq > prevRun && r.seq < run.seq && r.actor === agent && r.event === "agent.tool")?.seq ?? run.seq) - 1);
    const mine = rows.filter((r) => r.seq > Math.max(from, prevRun) && r.seq <= run.seq && r.actor === agent && r.event !== "agent.run");
    const decision = rows.find((r) => r.seq > run.seq && r.seq < nextRun && r.actor === agent && r.event === DECISION[agent]) ?? null;

    const steps: TraceStep[] = [];
    for (const r of [...mine, run, ...(decision ? [decision] : [])]) {
      const q = JSON.parse(r.payload_json) as P;
      const base = { seq: r.seq, ts: r.ts, event: r.event, hash: r.row_hash };
      if (r.event === "agent.tool") {
        const blockedBy = str(q.blocked_by);
        steps.push({
          ...base, kind: "tool", tool: str(q.tool), input: q.input ?? null, result: str(q.result) || null,
          text: `${str(q.tool)}: ${str(q.result)}`, blocked: !!blockedBy, check: blockedBy || TOOL_CHECK[str(q.tool)] || "code ran it",
          ms: num(q.ms), tx: null, awx_id: null,
        });
      } else if (r === run) {
        const tk = q.tokens as Trace["tokens"];
        steps.push({
          ...base, kind: "run", tool: null, input: null, result: null, blocked: false, ms: num(q.latency_ms), tx: null, awx_id: null,
          text: `Claude (${str(q.model)}) ${str(q.status)} after ${str(q.turns)} turn(s)${tk ? `, ${tk.input + tk.output + tk.cache_read + tk.cache_write} tokens` : ""}`,
          check: str(q.status) === "done" ? "the agent's own loop" : `fell back to code: ${str(q.note) || str(q.status)}`,
        });
      } else {
        const d = words(r, () => undefined);
        steps.push({
          ...base, kind: r === decision ? "decision" : "effect", tool: null, input: null, result: null, text: d.text,
          blocked: d.tone === "refusal", check: r === decision ? decisionCheck(r, q) : d.tone === "refusal" ? "a rail or a check refused it" : "",
          ms: null, tx: d.tx, awx_id: d.awx_id,
        });
      }
    }
    traces.push({
      run_seq: run.seq, agent, agent_name: (AGENT_DISPLAY as Record<string, { name: string }>)[agent]?.name ?? agent,
      task: str(run.subject), model: str(p.model), status: str(p.status), turns: num(p.turns) ?? 0,
      tokens: (p.tokens as Trace["tokens"]) ?? null, cost_usd_micros: num(p.cost_usd_micros) ?? 0, latency_ms: num(p.latency_ms),
      claude_ms: Array.isArray(p.claude_ms) ? (p.claude_ms as number[]) : [], said: str(p.said), note: str(p.note) || null,
      decision_seq: decision?.seq ?? null, steps,
    });
  }
  return traces;
}
