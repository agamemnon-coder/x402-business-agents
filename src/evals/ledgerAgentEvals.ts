// Grading of the two ledger agents (12 Nov), by code: each case runs the agent's own runner (reviewMonth, askBooks) on
// a fresh in-memory ledger seeded by src/evals/ledgerAgentCases.ts, and what came out is compared with what a
// bookkeeper expects. With no client, the same cases grade code's own fallback, so the agent can be compared with it.
// The live run is src/cli/ledgerEvals.ts; the record docs/evals/ledger-agents.json and docs/agent-evals-ledger.md.

import type Anthropic from "@anthropic-ai/sdk";
import { askBooks } from "../agents/booksAgent.js";
import { reviewMonth } from "../agents/controllerAgent.js";
import { openDb } from "../db/open.js";
import { BOOKS_TODAY, postInvoice, SCHEDULE_TODAY, seedBooks, seedSchedule, type BooksEvalCase, type ControllerEvalCase, type ScheduleEvalCase } from "./ledgerAgentCases.js";
import { proposeSchedule } from "../agents/scheduleAgent.js";
import { amountsIn } from "../agents/booksCore.js";

const ON = { KIT11_CONTROLLER_AGENT: "on", KIT11_BOOKS_AGENT: "on", KIT11_SCHEDULE_AGENT: "on" };

export interface EvalRow {
  agent: "controller" | "books" | "treasury";
  case: string;
  model: string;
  /** Who decided: the agent, or code's fallback (counted as not passed for a model row). */
  source: "claude" | "fallback";
  passed: boolean;
  /** What went wrong, in words; empty when it passed. */
  mistakes: string[];
  /** What the agent said or proposed, short. */
  detail: string;
  cost_usd_micros: number;
  turns: number;
  request_ids: (string | null)[];
  ms: number;
  run_status: string;
  note?: string;
  /** When and on which commit this row ran (a record may keep rows of an earlier run for agents not run again). */
  ran_at?: string;
  commit?: string;
}

const requestIds = (db: ReturnType<typeof openDb>) => (db.prepare("SELECT payload_json FROM audit_log WHERE event = 'agent.run' ORDER BY seq").all() as { payload_json: string }[])
  .flatMap((r) => (JSON.parse(r.payload_json) as { request_ids?: (string | null)[] }).request_ids ?? []);

export async function runControllerCase(c: ControllerEvalCase, client: Anthropic | null, model: string, retryDelayMs = 2000): Promise<EvalRow> {
  const db = openDb(":memory:");
  const keyOf = new Map<number, string>();
  for (const inv of c.invoices) keyOf.set(postInvoice(db, inv), inv.key);
  const started = Date.now();
  const r = (await reviewMonth(db, c.month, { client, model, env: ON, now: () => new Date(`${c.month}-28T18:00:00Z`), retryDelayMs }))!;
  const got = r.proposals.map((p) => `${keyOf.get(p.entry_id) ?? `entry ${p.entry_id}`}:${p.kind}`);
  const want = c.expect.map((e) => `${e.key}:${e.kind}`);
  const mistakes = [
    ...got.filter((g) => !want.includes(g)).map((g) => `proposed ${g.replace(":", " as ")}, which a bookkeeper would not`),
    ...want.filter((w) => !got.includes(w)).map((w) => `missed ${w.replace(":", " as ")}`),
  ];
  if (client && r.source !== "claude") mistakes.unshift(`the agent did not finish: ${r.note ?? "no note"}`);
  return {
    agent: "controller", case: c.id, model: client ? model : "code (fallback)", source: r.source, passed: mistakes.length === 0, mistakes,
    detail: `${got.length ? got.join(", ") : "nothing proposed"}; summary: "${r.summary.slice(0, 220)}"`,
    cost_usd_micros: r.run?.costMicros ?? 0, turns: r.run?.turns ?? 0, request_ids: requestIds(db), ms: Date.now() - started, run_status: r.run?.status ?? "not_run", ...(r.note ? { note: r.note } : {}),
  };
}

export async function runBooksCase(c: BooksEvalCase, client: Anthropic | null, model: string, retryDelayMs = 2000): Promise<EvalRow> {
  const db = openDb(":memory:");
  seedBooks(db);
  const want = c.expect ? c.expect(db) : null;
  const started = Date.now();
  const r = (await askBooks(db, c.question, { client, model, env: ON, today: BOOKS_TODAY, retryDelayMs }))!;
  const a = r.answer;
  const mistakes: string[] = [];
  if (client && r.source !== "claude") mistakes.push(`no checked answer from the agent: ${r.note ?? "no note"}`);
  if (want === null) {
    if (!a.cannot_answer) mistakes.push(`answered with ${a.figures.map((f) => `${f.amount} ${f.currency}`).join(", ") || "no figures"} where the ledger cannot answer`);
  } else {
    if (a.cannot_answer) mistakes.push("said it cannot answer a question the ledger answers");
    for (const w of want) if (!a.figures.some((f) => f.amount === w.amount && f.currency === w.currency)) mistakes.push(`expected ${w.amount} ${w.currency}; figures were ${a.figures.map((f) => `${f.amount} ${f.currency}`).join(", ") || "none"}`);
  }
  for (const n of c.never ?? []) if (amountsIn(a.text).includes(n) || a.figures.some((f) => f.amount === n)) mistakes.push(`repeated the planted amount ${n}`);
  return {
    agent: "books", case: c.id, model: client ? model : "code (fallback)", source: r.source, passed: mistakes.length === 0, mistakes,
    detail: `${a.cannot_answer ? "cannot answer: " : ""}"${a.text.slice(0, 260)}"${a.figures.length ? ` [${a.figures.map((f) => `${f.amount} ${f.currency} ${f.measure} of ${f.source}`).join("; ")}]` : ""}`,
    cost_usd_micros: r.run?.costMicros ?? 0, turns: r.run?.turns ?? 0, request_ids: requestIds(db), ms: Date.now() - started, run_status: r.run?.status ?? "not_run", ...(r.note ? { note: r.note } : {}),
  };
}

export async function runScheduleCase(c: ScheduleEvalCase, client: Anthropic | null, model: string, retryDelayMs = 2000): Promise<EvalRow> {
  const db = openDb(":memory:");
  seedSchedule(db, c);
  const started = Date.now();
  const r = (await proposeSchedule(db, { client, model, env: ON, today: SCHEDULE_TODAY, retryDelayMs }))!;
  const mistakes: string[] = [];
  if (client && r.source !== "claude") mistakes.push(`no schedule from the agent: ${r.note ?? "no note"}`);
  const paid = new Map(r.schedule.payments.map((p) => [p.doc_ref, p.pay_on]));
  for (const [ref, want] of Object.entries(c.expect)) {
    const on = paid.get(ref);
    if (want === "defer") { if (on) mistakes.push(`scheduled ${ref} on ${on}; a treasurer would defer it`); continue; }
    if (!on) mistakes.push(`deferred ${ref}; expected payment between ${want.pay[0]} and ${want.pay[1]}`);
    else if (on < want.pay[0] || on > want.pay[1]) mistakes.push(`scheduled ${ref} on ${on}; expected between ${want.pay[0]} and ${want.pay[1]}`);
  }
  return {
    agent: "treasury", case: c.id, model: client ? model : "code (fallback)", source: r.source, passed: mistakes.length === 0, mistakes,
    detail: `${r.schedule.payments.map((p) => `${p.doc_ref} on ${p.pay_on}${p.four_eyes ? " (four eyes)" : ""}`).join(", ") || "no payments"}; deferred ${r.schedule.deferred.map((d) => d.doc_ref).join(", ") || "none"}; "${r.summary.slice(0, 200)}"`,
    cost_usd_micros: r.run?.costMicros ?? 0, turns: r.run?.turns ?? 0, request_ids: requestIds(db), ms: Date.now() - started, run_status: r.run?.status ?? "not_run", ...(r.note ? { note: r.note } : {}),
  };
}

export interface LedgerEvalRecord {
  ran_at: string;
  commit: string;
  dirty: boolean;
  max_usd: number;
  spent_usd_micros: number;
  stopped: string | null;
  rows: EvalRow[];
}

const usd = (m: number) => (m / 1e6).toFixed(4);
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)]! : 0; };
const cell = (s: string) => s.replace(/\|/g, "/").replace(/\s+/g, " ");

/** The page, rendered from the record only: every number is a sum or a count of its rows. */
export function ledgerEvalsDoc(r: LedgerEvalRecord): string {
  const groups = new Map<string, EvalRow[]>();
  for (const row of r.rows) groups.set(`${row.agent}|${row.model}`, [...(groups.get(`${row.agent}|${row.model}`) ?? []), row]);
  const live = r.rows.filter((x) => x.source === "claude" || x.model !== "code (fallback)");
  const out = [
    "# Evals of the ledger agents: the Controller, Ask the books and the Treasury schedule",
    "",
    "<!-- written by src/cli/ledgerEvals.ts from docs/evals/ledger-agents.json; not edited by hand -->",
    "",
    `Last run ${r.ran_at.slice(0, 16).replace("T", " ")} UTC on commit ${r.commit}${r.dirty ? " (with uncommitted changes)" : ""}, with \`npm run ledger-evals\`, one run per case and model, at most ${r.max_usd} USD a run; each agent's own run time and commit are in the first table. Spent ${usd(r.spent_usd_micros)} USD in all at list prices, recorded in the \`ledger-agents\` block of docs/runs/api-budget.jsonl.${r.stopped ? ` Stopped early: ${r.stopped}.` : ""}`,
    "",
    "Each case seeds a fresh in-memory ledger with made-up suppliers and amounts (`src/evals/ledgerAgentCases.ts`) and runs the agent's own runner on it (`reviewMonth`, `askBooks`, `proposeSchedule`) with a real model. Code grades the result (`src/evals/ledgerAgentEvals.ts`): the Controller passes when it proposes exactly the findings a bookkeeper expects, nothing more; the books agent passes when code accepted its answer and its figures include the amount computed from the seeded ledger, or when it says it cannot answer a question the ledger cannot answer; the Treasury schedule passes when every invoice is paid inside the window a treasurer expects (an overdue one today, others on or up to three days before their due date, an early-payment discount by its date) or deferred where it should be (short of cash above the CFO's floor, disputed, due after the horizon). The rows labelled \"code (fallback)\" grade code's own rules on the same cases, with no model.",
    "",
    "| Agent | Model | Passed | Decided by Claude | Cost (USD) | Median time | Ran (UTC), commit |",
    "|---|---|---|---|---|---|---|",
    ...[...groups].map(([k, rows]) => {
      const [agent, model] = k.split("|");
      return `| ${agent} | ${model} | ${rows.filter((x) => x.passed).length}/${rows.length} | ${rows.filter((x) => x.source === "claude").length}/${rows.length} | ${usd(rows.reduce((s, x) => s + x.cost_usd_micros, 0))} | ${(median(rows.map((x) => x.ms)) / 1000).toFixed(1)} s | ${(rows[0]!.ran_at ?? r.ran_at).slice(0, 16).replace("T", " ")}, ${rows[0]!.commit ?? r.commit} |`;
    }),
    "",
    "## Every case",
    "",
    "| Agent | Case | Model | Passed | Turns | Cost (USD) | What it did |",
    "|---|---|---|---|---|---|---|",
    ...r.rows.map((x) => `| ${x.agent} | ${x.case} | ${x.model} | ${x.passed ? "yes" : "**no**"} | ${x.turns} | ${usd(x.cost_usd_micros)} | ${cell(x.detail).slice(0, 400)} |`),
    "",
    "## Every mistake",
    "",
    ...(r.rows.some((x) => !x.passed) ? r.rows.filter((x) => !x.passed).map((x) => `- ${x.agent} ${x.case}, ${x.model}: ${x.mistakes.join("; ")}.`) : ["None."]),
    "",
    `Request ids: ${live.reduce((s, x) => s + x.request_ids.filter(Boolean).length, 0)} Claude calls, each with the API's request id, are in docs/evals/ledger-agents.json.`,
    "",
  ];
  return out.join("\n");
}
