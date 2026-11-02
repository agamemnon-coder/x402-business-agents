// System health (QA and enterprise, 2 November): how the agents run, from the ledger alone. Per run (each agent.run
// row: one wake or task) and per agent: decisions, latency p50/p95, Claude cost, the fallback share and the tool calls
// a check refused; and the service levels Purser holds itself to:
//   - 99% of decisions in under 10 s (the agent.run latency of each run that ended in a decision);
//   - 0 double payments (one live payout per invoice, one transfer and one conversion per request_id, one paid
//     purchase per x402 nonce);
//   - 0 money movements without an origin (D24, src/provenance/check.ts);
//   - fallbacks under 10% of decisions (src/dashboard/agentStats.ts);
// and the verify results that need no outside service: the audit hash chain, the stored finality certificates.
// Each run links to its agent trace (src/dashboard/trace.ts) as JSON. Read-only; it holds no key and moves nothing.
// The page is served by the local dashboard server only (loopback), at /system-health, with no script at all.

import { createHash } from "node:crypto";
import { verifyAuditChain } from "../audit/log.js";
import type { DB } from "../db/open.js";
import { finalityChecks } from "../metal/finality.js";
import { originsCheck } from "../provenance/check.js";
import { invoiceKey } from "../agents/euroBill.js";
import { agentStats } from "./agentStats.js";
import { agentTraces } from "./trace.js";

/** A decision slower than this misses the latency objective. */
export const DECISION_SLO_MS = 10_000;
/** The share of decisions that must be under DECISION_SLO_MS. */
export const DECISION_SLO_SHARE = 0.99;
/** Fallbacks to code must stay under this share of decisions. */
export const FALLBACK_SLO_SHARE = 0.1;

export interface RunHealth {
  run_seq: number;
  run_id: string | null;
  agent: string;
  task: string;
  ts: string;
  status: string;
  /** Who decided: Claude, code's fallback, idle (the CFO's switch), or null when the run left no decision row. */
  decided_by: "claude" | "fallback" | "idle" | null;
  decision_seq: number | null;
  latency_ms: number | null;
  cost_usd_micros: number;
  refused_tool_calls: number;
  /** The run's agent trace (the timeline the dashboard shows), as JSON on the same server. */
  trace: string;
}

export interface AgentHealth {
  agent: string;
  runs: number;
  decisions: number;
  latency_p50_ms: number | null;
  latency_p95_ms: number | null;
  cost_usd_micros: number;
  fallback_pct: number;
  refused_tool_calls: number;
}

export interface Slo {
  id: "decision_latency" | "double_payments" | "missing_origin" | "fallbacks" | "audit_chain" | "finality" | "payee_confirmed";
  objective: string;
  /** True met, false missed, null no data to judge it by. */
  met: boolean | null;
  actual: string;
  detail: string;
}

export interface SystemHealth {
  at: string;
  totals: { runs: number; decisions: number; fallback_pct: number; refused_tool_calls: number; cost_usd_micros: number; latency_p50_ms: number | null; latency_p95_ms: number | null };
  agents: AgentHealth[];
  runs: RunHealth[];
  slos: Slo[];
}

/** The nearest-rank percentile (p in 0..100) of the values; null when there are none. */
export function percentile(values: readonly number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))]!;
}

const pct = (part: number, whole: number) => (whole ? Math.round((part / whole) * 1000) / 10 : 0);
const has = (db: DB, table: string) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);

/** Every double payment the ledger shows, in words; an empty list is the objective. */
export function doublePayments(db: DB): string[] {
  const out: string[] = [];
  // One live payout per invoice, also when the invoice number is written another way (the duplicate check's key).
  if (has(db, "transfers")) {
    const byKey = new Map<string, string[]>();
    for (const r of db.prepare("SELECT invoice_no FROM transfers WHERE status NOT IN ('CANCELLED', 'FAILED') ORDER BY invoice_no").all() as { invoice_no: string }[]) {
      const k = invoiceKey(r.invoice_no);
      byKey.set(k, [...(byKey.get(k) ?? []), r.invoice_no]);
    }
    for (const [, nos] of byKey) if (nos.length > 1) out.push(`invoice ${nos[0]}: ${nos.length} live payouts`);
  }
  // One transfer and one conversion per request_id, as the audit chain recorded them (created or adopted).
  for (const [events, what] of [[["transfer.created", "transfer.adopted"], "transfer"], [["fx.converted", "fx.adopted"], "conversion"]] as const) {
    const rows = db.prepare(`SELECT json_extract(payload_json, '$.request_id') AS req, COUNT(DISTINCT subject) AS n FROM audit_log WHERE event IN (${events.map(() => "?").join(", ")}) GROUP BY req HAVING n > 1`).all(...events) as { req: string | null; n: number }[];
    for (const r of rows) if (r.req) out.push(`request_id ${r.req}: ${r.n} ${what}s`);
  }
  // One paid purchase per x402 nonce (the payment's own idempotency key).
  if (has(db, "upstream_purchases")) {
    for (const r of db.prepare("SELECT nonce, COUNT(*) AS n FROM upstream_purchases WHERE outcome = 'PAID' AND nonce IS NOT NULL GROUP BY nonce HAVING n > 1").all() as { nonce: string; n: number }[]) {
      out.push(`nonce ${r.nonce}: paid ${r.n} times`);
    }
  }
  // A payout row with no transfer id (closed as refused at create, or never answered) that Airwallex holds after all:
  // a transfer recorded under its request_id, or the reconciliation finding one there. With another live payout for
  // the same invoice, the invoice is paid twice (review of 2 November).
  if (has(db, "transfers")) {
    const live = db.prepare("SELECT request_id, invoice_no FROM transfers WHERE status NOT IN ('CANCELLED', 'FAILED')").all() as { request_id: string; invoice_no: string }[];
    const recorded = db.prepare("SELECT 1 FROM audit_log WHERE event IN ('transfer.created', 'transfer.adopted') AND json_extract(payload_json, '$.request_id') = ? LIMIT 1");
    const foundOutside = db.prepare("SELECT 1 FROM audit_log WHERE event = 'reconcile.difference' AND subject = ? LIMIT 1");
    for (const r of db.prepare("SELECT request_id, invoice_no, status FROM transfers WHERE transfer_id IS NULL").all() as { request_id: string; invoice_no: string; status: string }[]) {
      const cancelled = r.status === "CANCELLED";
      if (cancelled && recorded.get(r.request_id)) { out.push(`request_id ${r.request_id}: closed as refused, yet a transfer was recorded under it`); continue; }
      if (!foundOutside.get(r.request_id)) continue;
      const other = live.find((x) => x.request_id !== r.request_id && invoiceKey(x.invoice_no) === invoiceKey(r.invoice_no));
      if (other) out.push(`invoice ${r.invoice_no}: Airwallex holds a transfer under request_id ${r.request_id} (${cancelled ? "closed as refused" : "never answered"} in the ledger) and the invoice has another payout, ${other.request_id}`);
    }
  }
  return out;
}

/** How many payments the ledger holds at all: with none, "0 double payments" is no data, not met. */
function payments(db: DB): number {
  const count = (table: string, where = "") => (has(db, table) ? (db.prepare(`SELECT COUNT(*) AS n FROM ${table} ${where}`).get() as { n: number }).n : 0);
  return count("transfers") + count("fx_conversions") + count("upstream_purchases", "WHERE outcome = 'PAID'") + count("sales") + count("refunds", "WHERE outcome = 'PAID'") + count("sweeps", "WHERE outcome = 'PAID'");
}

export function systemHealth(db: DB, now = new Date()): SystemHealth {
  type Row = { seq: number; ts: string; actor: string; event: string; subject: string | null; payload_json: string; row_hash: string };
  const rows = db.prepare("SELECT seq, ts, actor, event, subject, payload_json, row_hash FROM audit_log ORDER BY seq").all() as Row[];
  const traces = agentTraces(db, rows);
  const bySeq = new Map(rows.map((r) => [r.seq, r]));
  const source = (seq: number | null): RunHealth["decided_by"] => {
    if (seq === null) return null;
    const s = (JSON.parse(bySeq.get(seq)?.payload_json ?? "{}") as { source?: unknown }).source;
    return s === "claude" || s === "fallback" || s === "idle" ? s : null;
  };

  const runs: RunHealth[] = traces.map((t) => {
    const run = JSON.parse(bySeq.get(t.run_seq)!.payload_json) as { run_id?: unknown };
    return {
      run_seq: t.run_seq, run_id: typeof run.run_id === "string" ? run.run_id : null, agent: t.agent, task: t.task, ts: bySeq.get(t.run_seq)!.ts,
      status: t.status, decided_by: source(t.decision_seq), decision_seq: t.decision_seq, latency_ms: t.latency_ms, cost_usd_micros: t.cost_usd_micros,
      refused_tool_calls: t.steps.filter((s) => s.kind === "tool" && s.blocked).length, trace: `api/trace/${t.run_seq}`,
    };
  });

  // Decisions and the fallback share as the dashboard counts them (agentStats); latency and refusals from the runs.
  const stats = new Map(agentStats(db, now).map((s) => [s.agent, s]));
  const names = [...new Set([...stats.keys(), ...runs.map((r) => r.agent)])].sort();
  const latencies = (rs: RunHealth[]) => rs.map((r) => r.latency_ms).filter((x): x is number => x !== null);
  const agents: AgentHealth[] = names.map((agent) => {
    const mine = runs.filter((r) => r.agent === agent);
    const s = stats.get(agent);
    return {
      agent, runs: mine.length, decisions: s?.decisions ?? 0, latency_p50_ms: percentile(latencies(mine), 50), latency_p95_ms: percentile(latencies(mine), 95),
      cost_usd_micros: mine.reduce((a, r) => a + r.cost_usd_micros, 0), fallback_pct: s?.fallback_pct ?? 0,
      refused_tool_calls: mine.reduce((a, r) => a + r.refused_tool_calls, 0),
    };
  });
  const decisions = agents.reduce((a, x) => a + x.decisions, 0);
  const fallbacks = [...stats.values()].reduce((a, s) => a + s.fallback, 0);
  const totals = {
    runs: runs.length, decisions, fallback_pct: pct(fallbacks, decisions), refused_tool_calls: runs.reduce((a, r) => a + r.refused_tool_calls, 0),
    cost_usd_micros: runs.reduce((a, r) => a + r.cost_usd_micros, 0), latency_p50_ms: percentile(latencies(runs), 50), latency_p95_ms: percentile(latencies(runs), 95),
  };

  const slos: Slo[] = [];
  // 1. Decision latency: each run that ended in a decision, by its recorded latency.
  const timed = runs.filter((r) => r.decision_seq !== null && r.latency_ms !== null);
  const fast = timed.filter((r) => r.latency_ms! < DECISION_SLO_MS).length;
  const slow = timed.filter((r) => r.latency_ms! >= DECISION_SLO_MS).map((r) => `${r.agent} run ${r.run_seq} (${(r.latency_ms! / 1000).toFixed(1)} s)`);
  slos.push({
    id: "decision_latency", objective: "99% of decisions under 10 s", met: timed.length ? fast / timed.length >= DECISION_SLO_SHARE : null,
    actual: timed.length ? `${pct(fast, timed.length).toFixed(1)}% under 10 s (${fast} of ${timed.length})` : "no decisions yet",
    detail: slow.length ? `slower: ${slow.slice(0, 10).join(", ")}${slow.length > 10 ? ` and ${slow.length - 10} more` : ""}` : "",
  });
  // 2. Double payments.
  const doubles = doublePayments(db);
  const paid = payments(db);
  slos.push({
    id: "double_payments", objective: "0 double payments", met: doubles.length ? false : paid ? true : null,
    actual: doubles.length || paid ? String(doubles.length) : "no payments yet", detail: doubles.join("; "),
  });
  // 3. Origins (D24): a ledger from before origins has none to check.
  const o = originsCheck(db);
  slos.push({
    id: "missing_origin", objective: "0 money movements without an origin", met: o.recorded ? o.missing.length === 0 : null,
    actual: o.recorded ? `${o.missing.length} of ${o.movements}` : "no money movement with an origin yet",
    detail: o.missing.slice(0, 10).map((m) => `seq ${m.seq} ${m.event}${m.subject ? ` ${m.subject}` : ""}`).join(", "),
  });
  // 4. Fallbacks.
  slos.push({
    id: "fallbacks", objective: "fallbacks under 10% of decisions", met: decisions ? fallbacks / decisions < FALLBACK_SLO_SHARE : null,
    actual: decisions ? `${pct(fallbacks, decisions).toFixed(1)}% (${fallbacks} of ${decisions})` : "no decisions yet",
    detail: agents.filter((a) => a.fallback_pct > 0).map((a) => `${a.agent} ${a.fallback_pct}%`).join(", "),
  });
  // 4b. Every adopted payout's payee confirmed by Airwallex: one adopted on request_id, amount and currency alone
  // (Airwallex's answer did not state the payee) is an alarm until a person checks it (src/executors/invoicePayment.ts).
  const adoptedN = rows.filter((r) => r.event === "transfer.adopted").length;
  const unconfirmed = rows.filter((r) => r.event === "transfer.payee_unconfirmed");
  slos.push({
    id: "payee_confirmed", objective: "every adopted payout's payee confirmed by Airwallex", met: unconfirmed.length ? false : adoptedN ? true : null,
    actual: adoptedN ? `${unconfirmed.length} of ${adoptedN} not confirmed` : "no adopted payouts", detail: unconfirmed.map((r) => `transfer ${r.subject ?? "?"}`).join(", "),
  });
  // 5. Verify, offline: the audit chain and the stored finality certificates (npm run verify runs these and more).
  const chain = verifyAuditChain(db);
  slos.push({ id: "audit_chain", objective: "the audit hash chain is intact", met: chain.ok, actual: chain.ok ? `${chain.rows} rows` : `broken at seq ${chain.seq}`, detail: chain.ok ? "" : chain.reason });
  const fin = finalityChecks(db);
  const finFail = fin.filter((c) => c.level === "fail");
  const finOk = fin.some((c) => c.level === "ok");
  slos.push({
    id: "finality", objective: "0 failing finality certificates", met: finFail.length ? false : finOk ? true : null,
    actual: finFail.length ? "failing" : finOk ? "all pass" : "none looked up yet", detail: (finFail[0] ?? fin[0])?.detail ?? "",
  });

  return { at: now.toISOString(), totals, agents, runs: runs.slice().reverse(), slos };
}

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const ms = (v: number | null) => (v === null ? "–" : v < 1000 ? `${v} ms` : `${(v / 1000).toFixed(1)} s`);
const usd = (micros: number) => `$${(micros / 1e6).toFixed(4)}`;
const mark = (met: boolean | null) => (met === true ? '<span class="ok">met</span>' : met === false ? '<span class="bad">missed</span>' : '<span class="na">no data</span>');

const STYLE = `:root { color-scheme: light dark; --bg: #f7f8fa; --panel: #fff; --text: #0b1220; --muted: #5b6474; --line: #e3e6eb; --ok: #157f3b; --bad: #b42318; --na: #6b7280; }
@media (prefers-color-scheme: dark) { :root { --bg: #0d1117; --panel: #161b22; --text: #e6edf3; --muted: #9aa4b2; --line: #2a313c; --ok: #4ac26b; --bad: #ff7b72; --na: #9aa4b2; } }
* { box-sizing: border-box; }
body { margin: 0; padding: 24px 16px; background: var(--bg); color: var(--text); font: 15px/1.5 Inter, system-ui, sans-serif; }
main { max-width: 1100px; margin: 0 auto; }
h1 { font-size: 22px; margin: 0 0 4px; } h2 { font-size: 16px; margin: 28px 0 8px; }
p.sub { color: var(--muted); margin: 0 0 16px; }
.wrap { overflow-x: auto; background: var(--panel); border: 1px solid var(--line); border-radius: 12px; }
table { border-collapse: collapse; width: 100%; font-size: 13.5px; }
th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--line); vertical-align: top; }
th { color: var(--muted); font-weight: 600; white-space: nowrap; }
td.n { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
tr:last-child td { border-bottom: 0; }
.ok { color: var(--ok); font-weight: 650; } .bad { color: var(--bad); font-weight: 650; } .na { color: var(--na); }
a { color: inherit; }
small { color: var(--muted); }`;

/** The System health page: a table per section, no script, everything the ledger says escaped. */
export function systemHealthPage(h: SystemHealth): string {
  const slo = h.slos.map((s) => `<tr><td>${esc(s.objective)}</td><td>${mark(s.met)}</td><td>${esc(s.actual)}</td><td><small>${esc(s.detail)}</small></td></tr>`).join("");
  const agents = h.agents.map((a) => `<tr><td>${esc(a.agent)}</td><td class="n">${a.runs}</td><td class="n">${a.decisions}</td><td class="n">${ms(a.latency_p50_ms)}</td><td class="n">${ms(a.latency_p95_ms)}</td><td class="n">${usd(a.cost_usd_micros)}</td><td class="n">${a.fallback_pct}%</td><td class="n">${a.refused_tool_calls}</td></tr>`).join("");
  const runs = h.runs.slice(0, 200).map((r) => `<tr><td>${esc(r.ts.replace("T", " ").slice(0, 19))}</td><td>${esc(r.agent)}</td><td>${esc(r.task)}</td><td>${esc(r.status)}</td><td>${esc(r.decided_by ?? "–")}</td><td class="n">${ms(r.latency_ms)}</td><td class="n">${usd(r.cost_usd_micros)}</td><td class="n">${r.refused_tool_calls}</td><td><a href="${esc(r.trace)}">trace</a></td></tr>`).join("");
  const t = h.totals;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>System health · Purser</title>
<style>${STYLE}</style></head>
<body><main>
<h1>System health</h1>
<p class="sub">From the ledger at ${esc(h.at)}: ${t.runs} agent runs, ${t.decisions} decisions, latency p50 ${ms(t.latency_p50_ms)} and p95 ${ms(t.latency_p95_ms)}, Claude cost ${usd(t.cost_usd_micros)}, ${t.fallback_pct}% fallbacks, ${t.refused_tool_calls} refused tool calls. Read-only.</p>
<h2>Service levels</h2>
<div class="wrap"><table><thead><tr><th>Objective</th><th>Status</th><th>Now</th><th>Detail</th></tr></thead><tbody>${slo}</tbody></table></div>
<h2>Per agent</h2>
<div class="wrap"><table><thead><tr><th>Agent</th><th>Runs</th><th>Decisions</th><th>p50</th><th>p95</th><th>Cost</th><th>Fallback</th><th>Refused tool calls</th></tr></thead><tbody>${agents || '<tr><td colspan="8"><small>No agent runs in this ledger.</small></td></tr>'}</tbody></table></div>
<h2>Per run (newest first)</h2>
<div class="wrap"><table><thead><tr><th>When (UTC)</th><th>Agent</th><th>Task</th><th>Run</th><th>Decided by</th><th>Latency</th><th>Cost</th><th>Refused</th><th>Trace</th></tr></thead><tbody>${runs || '<tr><td colspan="9"><small>No agent runs in this ledger.</small></td></tr>'}</tbody></table></div>
<p class="sub"><small>Latency is the agent run's own, from its first Claude call to its decision. A double payment is a second live payout for an invoice, a second transfer or conversion under one request_id, or one x402 nonce paid twice. JSON: <a href="api/system-health">api/system-health</a>.</small></p>
</main></body></html>`;
}

/** The page's one inline style, hashed for its CSP (the style is constant). */
const styleHash = `'sha256-${createHash("sha256").update(STYLE, "utf8").digest("base64")}'`;

/** No script at all: a style-only policy, as for /visa and the evidence report. */
export const SYSTEM_HEALTH_CSP = ["default-src 'none'", `style-src ${styleHash}`, "img-src 'none'", "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'"].join("; ");
