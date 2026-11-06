// /try/sign (A2): the Treasury agent's sentence on the payment it proposes, from a real Claude Haiku call. What goes
// to the model is the test world only, written by code: the invoice (payee, reference, amount), the balance, the
// reserve floor and the limit an agent may pay alone. Nothing a visitor sends (no body, no address, no world id or
// token) is ever part of it. The model only proposes words: the checks, the limits and the approval stay in code and
// the visitor's passkey, and its sentence is not in the signed terms. Limits: a budget of USD 1 a UTC day, a few calls a
// minute for everyone and a few an hour per address, an 8 s timeout; past any of them, or on any error, the fixed
// sentence is shown, labelled.

import type { SentenceSource } from "../../src/try/claude.js";

/** Model spend allowed per UTC day for these sentences, in US dollars. */
export const AGENT_LINE_DAILY_USD = 1;
/** Sentences a minute from everyone together. */
export const AGENT_LINE_ALL_PER_MINUTE = 10;
/** Sentences an hour per address (as many as the test worlds it may open). */
export const AGENT_LINE_PER_HOUR = 6;
/** A call that takes longer is dropped and the fixed sentence shown. */
export const AGENT_LINE_TIMEOUT_MS = 8_000;
/** Kept aside before a call, so calls at once cannot pass the budget by more than this each. */
export const AGENT_LINE_RESERVE_USD = 0.002;

/** Where a proposal's sentence came from, as the page labels it. */
export type Voice =
  | { source: "model"; model: string; request_id: string | null }
  | { source: "fixed"; reason: "budget" | "unavailable"; why: string };

export const AGENT_LINE_SYSTEM = "You are the Treasury agent of a company's test world on a public demo of Purser, a spending control for AI agents. Write one plain sentence, at most 30 words, to the CFO: propose paying this invoice now and say why it needs their signature. You only propose: you cannot pay, approve, or change any limit. Use only the facts given; no quotes, no markup.";

/** The facts the model is given, all from the test world's constants. */
export function agentLineFacts(p: { payee: string; reference: string; amount: string; currency: string }, w: { balance: string; reserve_floor: string; alone_limit: string; currency: string }): string {
  return [
    `Invoice: ${p.reference}, from ${p.payee}, ${p.currency} ${p.amount}.`,
    `Balance: ${w.currency} ${w.balance}. Reserve floor (the balance may not go below it): ${w.currency} ${w.reserve_floor}.`,
    `An agent may pay alone up to ${w.currency} ${w.alone_limit}.`,
  ].join("\n");
}

/** The model's sentence as the page may show it, or null: one line, 12 to 240 characters, no markup, ends a sentence. */
export function cleanLine(s: string): string | null {
  const t = s.replace(/\s+/g, " ").trim().replace(/^["“'‘]+|["”'’]+$/g, "").trim();
  if (t.length < 12 || t.length > 240 || /[<>{}`\\]/.test(t) || !/[.!?]$/.test(t)) return null;
  return t;
}

export type { SentenceSource };
