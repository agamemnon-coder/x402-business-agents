// The Treasury agent's payment schedule in the runner (12 Nov), behind KIT11_SCHEDULE_AGENT=on (off by default). The
// case comes from the ledger (open payables, cash) and the CFO's signed policy (reserve floors, four eyes); the agent
// (Claude Sonnet, MODELS.act) runs through the shared loop under a hard cap of USD 0.40 and three minutes. The accepted
// schedule, or code's own labelled one, is stored as one decision row (treasury.schedule_proposed) with the model, the
// request ids and the cost. It pays nothing: each payment still goes through Purser's payment proposal and the CFO's
// Face ID. Pure rules: src/agents/scheduleCore.ts.

import type Anthropic from "@anthropic-ai/sdk";
import type { z } from "zod";
import { audit } from "../audit/log.js";
import { claudeClient, MODELS } from "../claude/reader.js";
import { scheduleAgentOn } from "../config/ledgerAgents.js";
import type { DB } from "../db/open.js";
import { ageing, cashByCurrency } from "../ledger/reports.js";
import { fromCents, toCents } from "../lib/money.js";
import { policyValue } from "../policy/rules.js";
import { runAgent, type AgentRun, type AgentTool } from "./loop.js";
import {
  addDays, answerScheduleTool, fallbackSchedule, SCHEDULE_EFFORT, SCHEDULE_HORIZON_DAYS, SCHEDULE_MAX_TOKENS, SCHEDULE_MAX_TURNS, SCHEDULE_RUN_CAP_MICROS, SCHEDULE_SYSTEM, SCHEDULE_TIMEOUT_MS,
  SCHEDULE_UNFINISHED, scheduleInputs, schedulePrompt, scheduleTools, type Schedule, type ScheduleCase, type ScheduleState,
} from "./scheduleCore.js";

export { scheduleAgentOn } from "../config/ledgerAgents.js";

const money = (s: string): number | null => (/^\d+\.\d{2}$/.test(s.trim()) ? toCents(s.trim()) : null);

export function scheduleCaseFor(db: DB, today: string): ScheduleCase {
  const items = ageing(db, "payables", today).items;
  const note = (ref: string) => (db.prepare("SELECT e.description FROM ledger_entries e JOIN ledger_lines l ON l.entry_id = e.entry_id WHERE l.account = '2100' AND l.doc_ref = ? AND l.credit_cents > 0 ORDER BY e.entry_id LIMIT 1").get(ref) as { description: string } | undefined)?.description ?? "";
  const cash: Record<string, number> = {};
  for (const r of cashByCurrency(db)) cash[r.currency] = (cash[r.currency] ?? 0) + r.balance_cents;
  const floors: Record<string, number> = {};
  for (const [cur, key] of [["EUR", "eur_floor"], ["USD", "usd_floor"]] as const) { const v = money(policyValue(db, key)); if (v !== null) floors[cur] = v; }
  return {
    today, horizon: addDays(today, SCHEDULE_HORIZON_DAYS), cash, floors, fourEyesEurCents: money(policyValue(db, "approval.four_eyes_eur")),
    payables: items.filter((i) => i.open_cents > 0 && i.doc_ref).map((i) => ({ doc_ref: i.doc_ref, party: i.party, currency: i.currency, due_date: i.due_date, open_cents: i.open_cents, note: note(i.doc_ref) })),
  };
}

export interface ScheduleProposal { source: "claude" | "fallback"; schedule: Schedule; summary: string; run: AgentRun | null; note?: string }

export interface ScheduleDeps { client?: Anthropic | null; model?: string; today?: string; env?: Record<string, string | undefined>; retryDelayMs?: number }

/** Proposes the next 14 days' payment schedule. Off (the default flag), returns null and writes nothing. */
export async function proposeSchedule(db: DB, deps: ScheduleDeps = {}): Promise<ScheduleProposal | null> {
  if (!scheduleAgentOn(deps.env ?? process.env)) return null;
  const today = deps.today ?? new Date().toISOString().slice(0, 10);
  const c = scheduleCaseFor(db, today);
  const state: ScheduleState = { schedule: null, summary: "", tries: 0 };
  const task = `treasury.schedule.${today}`;
  let run: AgentRun | null = null;
  if (c.payables.length > 0) {
    const tools = scheduleTools.map((t): AgentTool<z.ZodType> => ({ name: t.name, description: t.description, input: scheduleInputs[t.name], run: async (input) => answerScheduleTool(c, state, { name: t.name, input }) }));
    run = await runAgent(db, {
      agent: "treasury", task, model: deps.model ?? MODELS.act, system: SCHEDULE_SYSTEM, prompt: schedulePrompt(c), tools,
      maxTurns: SCHEDULE_MAX_TURNS, effort: SCHEDULE_EFFORT, maxTokens: SCHEDULE_MAX_TOKENS, runCapMicros: SCHEDULE_RUN_CAP_MICROS, timeoutMs: SCHEDULE_TIMEOUT_MS,
      unfinished: () => (state.schedule || state.tries >= 3 ? null : SCHEDULE_UNFINISHED), ...(deps.retryDelayMs === undefined ? {} : { retryDelayMs: deps.retryDelayMs }),
    }, deps.client === undefined ? claudeClient() : deps.client);
  }
  const schedule = state.schedule ?? fallbackSchedule(c);
  const source = state.schedule ? "claude" : "fallback";
  const note = state.schedule ? undefined : c.payables.length === 0 ? "no open invoices" : state.tries ? `code refused the agent's ${state.tries} schedule(s)` : `the agent gave no schedule (${run?.status ?? "not run"}${run?.note ? `: ${run.note}` : ""})`;
  const summary = state.schedule ? state.summary : `Code's schedule: ${schedule.payments.length} payment(s) on their due dates, ${schedule.deferred.length} deferred.`;
  const last = run ? db.prepare("SELECT payload_json FROM audit_log WHERE event = 'agent.run' AND subject = ? ORDER BY seq DESC LIMIT 1").get(task) as { payload_json: string } | undefined : undefined;
  audit(db, source === "claude" ? "treasury" : "system", "treasury.schedule_proposed", task, {
    today, horizon: c.horizon, source, model: source === "claude" ? run?.model ?? null : null, summary,
    payments: schedule.payments.map((p) => ({ doc_ref: p.doc_ref, party: p.party, amount: `${fromCents(p.amount_cents)} ${p.currency}`, pay_on: p.pay_on, four_eyes: p.four_eyes, reason: p.reason })),
    deferred: schedule.deferred.map((d) => ({ doc_ref: d.doc_ref, reason: d.reason })),
    limits: { floors: Object.fromEntries(Object.entries(c.floors).map(([k, v]) => [k, fromCents(v)])), four_eyes_eur: c.fourEyesEurCents === null ? null : fromCents(c.fourEyesEurCents) },
    run: { status: run?.status ?? "not_run", turns: run?.turns ?? 0, cost_usd_micros: run?.costMicros ?? 0, tries: state.tries, note: run?.note ?? null,
      request_ids: last ? ((JSON.parse(last.payload_json) as { request_ids?: (string | null)[] }).request_ids ?? []) : [] },
    ...(note ? { note } : {}),
  });
  return { source, schedule, summary, run, ...(note ? { note } : {}) };
}
