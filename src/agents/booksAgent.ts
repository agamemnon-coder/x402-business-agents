// The books agent in the runner (12 Nov), behind KIT11_BOOKS_AGENT=on (off by default): "Ask the books". The CFO asks a
// question in words; the agent (Claude Sonnet, MODELS.act) searches the stored ledger through read-only tools and
// answers with figures that code checks against the lines it cites (src/agents/booksCore.ts). Hard caps per question:
// USD 0.25 and two minutes. An answer code refuses three times, or no answer at all, gives code's own labelled answer
// (it understands only a question naming one party). One decision row (books.answered) says who answered, with the
// figures, their sources, the model, the request ids and the cost. Nothing here posts, pays or proposes.

import type Anthropic from "@anthropic-ai/sdk";
import type { z } from "zod";
import { audit } from "../audit/log.js";
import { claudeClient, MODELS } from "../claude/reader.js";
import { booksAgentOn } from "../config/ledgerAgents.js";
import type { DB } from "../db/open.js";
import { accountType, LEDGER_ACCOUNTS } from "../ledger/accounts.js";
import { redactSecrets } from "../lib/redact.js";
import {
  answerBooksTool, BOOKS_EFFORT, BOOKS_MAX_ANSWERS, BOOKS_MAX_TOKENS, BOOKS_MAX_TURNS, BOOKS_RUN_CAP_MICROS, BOOKS_SYSTEM, BOOKS_TIMEOUT_MS, BOOKS_UNFINISHED, booksInputs, booksTools, fallbackAnswer, newBooksState,
  type BookLine, type BooksAnswer, type BooksCase,
} from "./booksCore.js";
import { runAgent, type AgentRun, type AgentTool } from "./loop.js";

export { booksAgentOn } from "../config/ledgerAgents.js";

/** The case: the question, today, the chart and every posted line (a small company's ledger fits). */
export function booksCaseFor(db: DB, question: string, today: string): BooksCase {
  const lines = db.prepare(`SELECT e.entry_id, l.line_no, e.posting_date, e.description, l.account, l.debit_cents, l.credit_cents, l.currency, l.party, l.doc_ref, l.memo
    FROM ledger_lines l JOIN ledger_entries e ON e.entry_id = l.entry_id WHERE e.posting_date <= ? ORDER BY e.entry_id, l.line_no`).all(today) as BookLine[];
  const chart = Object.entries(LEDGER_ACCOUNTS).map(([account, name]) => ({ account, name, type: accountType(account) }));
  return { question, today, chart, lines };
}

export interface BooksReply {
  source: "claude" | "fallback";
  answer: BooksAnswer;
  run: AgentRun | null;
  note?: string;
}

export interface BooksDeps {
  client?: Anthropic | null;
  model?: string;
  today?: string;
  env?: Record<string, string | undefined>;
  retryDelayMs?: number;
}

/** Answers one question. Off (the default flag), returns null and writes nothing. */
export async function askBooks(db: DB, question: string, deps: BooksDeps = {}): Promise<BooksReply | null> {
  if (!booksAgentOn(deps.env ?? process.env)) return null;
  const q = redactSecrets(question).replace(/\s+/g, " ").trim().slice(0, 1000);
  if (!q) throw new Error("ask a question");
  const today = deps.today ?? new Date().toISOString().slice(0, 10);
  const c = booksCaseFor(db, q, today);
  const state = newBooksState();
  const tools = booksTools.map((t): AgentTool<z.ZodType> => ({
    name: t.name, description: t.description, input: booksInputs[t.name],
    run: async (input) => answerBooksTool(c, state, { name: t.name, input }),
  }));
  const task = `books.ask.${today}`;
  const run = await runAgent(db, {
    agent: "books", task, model: deps.model ?? MODELS.act, system: BOOKS_SYSTEM, tools,
    prompt: `Today is ${today}; the ledger holds ${c.lines.length} posted lines. The CFO asks:\n<question>\n${q}\n</question>`,
    maxTurns: BOOKS_MAX_TURNS, effort: BOOKS_EFFORT, maxTokens: BOOKS_MAX_TOKENS, runCapMicros: BOOKS_RUN_CAP_MICROS, timeoutMs: BOOKS_TIMEOUT_MS,
    unfinished: () => (state.answer || state.attempts >= BOOKS_MAX_ANSWERS ? null : BOOKS_UNFINISHED), ...(deps.retryDelayMs === undefined ? {} : { retryDelayMs: deps.retryDelayMs }),
  }, deps.client === undefined ? claudeClient() : deps.client);
  const answer = state.answer ?? fallbackAnswer(c);
  const source = state.answer ? "claude" : "fallback";
  const note = state.answer ? undefined : state.attempts > 0 ? `code refused the agent's ${state.attempts} answer(s)` : `the agent did not answer (${run.status}${run.note ? `: ${run.note}` : ""})`;
  const last = db.prepare("SELECT payload_json FROM audit_log WHERE event = 'agent.run' AND subject = ? ORDER BY seq DESC LIMIT 1").get(task) as { payload_json: string } | undefined;
  audit(db, source === "claude" ? "books" : "system", "books.answered", task, {
    question: q, source, model: source === "claude" ? run.model : null, cannot_answer: answer.cannot_answer, text: answer.text,
    figures: answer.figures.map((f) => ({ label: f.label.slice(0, 120), amount: f.amount, currency: f.currency, source: f.source, measure: f.measure })),
    // The lines behind each search the answer cites, so a reader can recompute every figure.
    sources: [...new Set(answer.figures.map((f) => f.source))].map((s) => ({ source: s, lines: state.searches.get(s)?.refs ?? [s] })),
    run: { status: run.status, turns: run.turns, cost_usd_micros: run.costMicros, note: run.note ?? null, attempts: state.attempts,
      request_ids: last ? ((JSON.parse(last.payload_json) as { request_ids?: (string | null)[] }).request_ids ?? []) : [] },
    ...(note ? { note } : {}),
  });
  return { source, answer, run, ...(note ? { note } : {}) };
}
