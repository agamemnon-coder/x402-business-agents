// /try/sign's recorded agents (Max, 7 Nov): real outputs of the live agents, recorded once by
// scripts/record-try-agents.ts with the same functions the Worker calls (claudeReadInvoice, adviseTry) and kept in
// docs/demo/try-agents-recorded.json. When a live call is unavailable (no key, the switch, the budget, a limit, a
// timeout, an error), the page shows the recorded output instead, labelled "recorded: the live agent was unavailable"
// with the reason, and code checks it exactly as a live one: the reading against the document's own lines, the reason's
// amounts against code's numbers (a recorded reason that names another quote's amounts is refused), the advice's
// bounds against today. Nothing here is made up: without the file there is no recording, and the page falls back to
// code's reading and a fixed sentence, labelled. Pure: the Worker gets the file's content built into its bundle.

import { InvoiceSchema, type Invoice } from "../claude/invoiceReading.js";
import type { TimingFacts } from "../agents/timingCore.js";

export const RECORDED_FORMAT = "kit11.try-agents-recorded/v1";
/** Where the recording lives in the repository. */
export const RECORDED_PATH = "docs/demo/try-agents-recorded.json";

/** One real reading by the invoice reader: the model, the API's request id, the day and how long it took. */
export interface RecordedReading { model: string; request_id: string; date: string; ms: number; reading: Invoice }
/** One real call of the Treasury agent, with the tools it asked for. */
export interface RecordedAdviceCall { model: string; request_id: string; ms: number; tools: { name: string; input: Record<string, unknown> }[] }
/** The Treasury agent's real advice: its decision, its reason, its calls, and the facts code gave it then. */
export interface RecordedAdvice {
  model: string; date: string; ms: number;
  timing: "pay_now" | "wait_until"; advised_date: string | null; reason: string;
  calls: RecordedAdviceCall[]; facts: TimingFacts;
}
export interface RecordedAgents {
  format: typeof RECORDED_FORMAT;
  recorded_at: string;
  /** T-0002's invoice, read by Sonnet. */
  invoice: RecordedReading | null;
  advice: RecordedAdvice | null;
  tricks: { pre_approved?: RecordedReading; lookalike?: RecordedReading };
}

const REQUEST_ID = /^[A-Za-z0-9_-]{8,128}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown, re?: RegExp): v is string => typeof v === "string" && v.length <= 600 && (!re || re.test(v));
const ms = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0 && v < 600_000;
/** A Claude model's answer only: a stand-in's or a made-up one has no Claude model name and request id. */
const claude = (v: unknown) => str(v, /^claude-[a-z0-9-]+$/);

function readingOf(v: unknown): RecordedReading | null {
  if (!isObj(v) || !claude(v.model) || !str(v.request_id, REQUEST_ID) || !str(v.date, DAY) || !ms(v.ms)) return null;
  const r = InvoiceSchema.safeParse(v.reading);
  return r.success ? { model: v.model as string, request_id: v.request_id, date: v.date, ms: v.ms, reading: r.data } : null;
}

function factsOf(v: unknown): TimingFacts | null {
  if (!isObj(v)) return null;
  const keys = ["proposalId", "invoiceNo", "vendor", "amount", "dueDate", "today", "eurAvailable", "eurFloor", "eurObligations", "usdAvailable", "usdFloor", "feeMax"] as const;
  if (!keys.every((k) => str(v[k]))) return null;
  const q = v.quote, a = v.after;
  if (!(q === null || (isObj(q) && ["sell", "buy", "rate", "validTo"].every((k) => str(q[k]))))) return null;
  if (!isObj(a) || !str(a.eurFree) || !str(a.usdAvailable)) return null;
  return v as unknown as TimingFacts;
}

function adviceOf(v: unknown): RecordedAdvice | null {
  if (!isObj(v) || !claude(v.model) || !str(v.date, DAY) || !ms(v.ms) || !str(v.reason)) return null;
  if (!(v.timing === "pay_now" || v.timing === "wait_until") || !(v.advised_date === null || str(v.advised_date, DAY))) return null;
  if (!Array.isArray(v.calls) || v.calls.length === 0 || v.calls.length > 5) return null;
  const calls: RecordedAdviceCall[] = [];
  for (const c of v.calls as unknown[]) {
    if (!isObj(c) || !claude(c.model) || !str(c.request_id, REQUEST_ID) || !ms(c.ms) || !Array.isArray(c.tools)) return null;
    const tools = (c.tools as unknown[]).filter((t): t is { name: string; input: Record<string, unknown> } => isObj(t) && str(t.name) && isObj(t.input));
    calls.push({ model: c.model as string, request_id: c.request_id, ms: c.ms, tools });
  }
  const facts = factsOf(v.facts);
  if (!facts) return null;
  return { model: v.model as string, date: v.date, ms: v.ms, timing: v.timing, advised_date: v.advised_date as string | null, reason: v.reason, calls, facts };
}

/** The recording, checked field by field; null when it is missing or not in this shape (then nothing recorded is shown). */
export function readRecorded(v: unknown): RecordedAgents | null {
  if (!isObj(v) || v.format !== RECORDED_FORMAT || !str(v.recorded_at)) return null;
  const tricks = isObj(v.tricks) ? v.tricks : {};
  const pre = readingOf(tricks.pre_approved), look = readingOf(tricks.lookalike);
  return {
    format: RECORDED_FORMAT, recorded_at: v.recorded_at, invoice: readingOf(v.invoice), advice: adviceOf(v.advice),
    tricks: { ...(pre ? { pre_approved: pre } : {}), ...(look ? { lookalike: look } : {}) },
  };
}
