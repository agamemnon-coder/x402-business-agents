// /try/sign (A2): the Treasury agent's sentence on the payment it proposes, from a real Claude Haiku call. What goes
// to the model is the test world only, written by code: the invoice (payee, reference, amount), the balance, the
// reserve floor and the limit an agent may pay alone. Nothing a visitor sends (no body, no address, no world id or
// token) is ever part of it. The model only proposes words: the checks, the limits and the approval stay in code and
// the visitor's passkey, and its sentence is not in the signed terms. Limits: a budget of USD 1 a UTC day, a few calls a
// minute for everyone and a few an hour per address, an 8 s timeout; past any of them, or on any error, the fixed
// sentence is shown, labelled. The call is made whenever the Worker has its ANTHROPIC_API_KEY secret (Max sets it
// himself; no script or config in this repo does), unless the emergency switch is thrown: the Worker var
// TRY_SIGN_HAIKU set to "off" (any case, trimmed) stops it, with no request to Anthropic and no budget spent; the
// fixed sentence is shown, labelled "fixed text (live model switched off)". Any other value, or none, leaves it on.
//
// The amounts go in already written the page's way ("EUR 1,850.00"), and code checks the sentence that comes back:
// every amount in it must be one of the amounts it was given, written exactly as given (see amountsFit), else the
// fixed sentence is shown, labelled "fixed text (sentence did not match the terms)".

import { claudeSentence, type SentenceSource } from "../../src/try/claude.js";

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
  | { source: "fixed"; reason: "budget" | "unavailable" | "mismatch" | "off"; why: string };

/** The emergency switch: only "off" (any case, surrounding spaces ignored) stops the call; anything else leaves it on. */
export const agentLineSwitchedOff = (value: string | undefined) => (value ?? "").trim().toLowerCase() === "off";

/**
 * Where the desk's sentence comes from, from the Worker's env: a function that asks Haiku for one sentence when the
 * Worker has its Anthropic key, else null (the fixed sentence); "off" when TRY_SIGN_HAIKU is "off" (the emergency
 * switch: no call at all). The desk is handed that function, never the key itself.
 */
export function agentLineSource(env: { ANTHROPIC_API_KEY?: string; TRY_SIGN_HAIKU?: string }, fetcher: typeof fetch = fetch): SentenceSource | "off" | null {
  if (agentLineSwitchedOff(env.TRY_SIGN_HAIKU)) return "off";
  const model = env.ANTHROPIC_API_KEY;
  return model ? claudeSentence(model, fetcher, AGENT_LINE_TIMEOUT_MS) : null;
}

/**
 * Money as the page writes it (its amt()/eur() in src/try/sign.ts; test/try-agent-line.test.ts runs both and compares):
 * the currency code, a space, the whole part grouped by commas, the cents: "EUR 1,850.00", "EUR 25,000.00".
 */
export function moneyForPeople(currency: string, amount: string): string {
  const [whole, cents] = amount.split(".");
  return `${currency} ${whole!.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${cents === undefined ? "" : `.${cents}`}`;
}

export const AGENT_LINE_SYSTEM = "You are the Treasury agent of a company's test world on a public demo of Purser, a spending control for AI agents. Write one plain sentence, at most 30 words, to the CFO: propose paying this invoice now and say why it needs their signature. You only propose: you cannot pay, approve, or change any limit. Use only the facts given; no quotes, no markup. Copy every amount exactly as the facts write it (currency code, commas and cents, as in EUR 1,850.00), and write no other amount or number.";

type LineInvoice = { payee: string; reference: string; amount: string; currency: string };
type LineWorld = { balance: string; reserve_floor: string; alone_limit: string; currency: string };

/** The facts the model is given, all from the test world's constants, every amount already written the page's way. */
export function agentLineFacts(p: LineInvoice, w: LineWorld): string {
  const m = moneyForPeople;
  return [
    `Invoice: ${p.reference}, from ${p.payee}, ${m(p.currency, p.amount)}.`,
    `Balance: ${m(w.currency, w.balance)}. Reserve floor (the balance may not go below it): ${m(w.currency, w.reserve_floor)}.`,
    `An agent may pay alone up to ${m(w.currency, w.alone_limit)}.`,
  ].join("\n");
}

/**
 * What the sentence may contain that has a digit in it: the amounts the model was given (the invoice's, which is the
 * signed amount, and the balance, the reserve floor and the limit, the only other amounts in the facts), each only
 * exactly as given ("EUR 1,850.00"), and the invoice's reference ("Invoice INV-2026-118", or "INV-2026-118").
 */
export function agentLineGiven(p: LineInvoice, w: LineWorld): { amounts: string[]; references: string[] } {
  return {
    amounts: [p.amount, w.balance, w.reserve_floor, w.alone_limit].map((a, i) => moneyForPeople(i === 0 ? p.currency : w.currency, a)),
    references: [p.reference, ...(p.reference.match(/[A-Z]{2,}-[\d-]*\d/g) ?? [])],
  };
}

/**
 * Whether every amount in the sentence is one it was given, written exactly as given. The given amounts and the
 * reference are taken out; if anything money-like is left (any digit at all, as in "1850", "EUR 1850.00", "1,850 EUR",
 * "€1,850", "EUR 1,850.005", or a currency sign or code, or a number word such as "thousand"), it does not fit.
 */
export function amountsFit(sentence: string, given: { amounts: readonly string[]; references: readonly string[] }): boolean {
  let rest = sentence;
  for (const t of [...given.amounts, ...given.references].sort((a, b) => b.length - a.length)) rest = rest.split(t).join(" | ");
  return !/\d|[€$£¥₹¢]|\b(?:EUR|USD|GBP|CHF|JPY|euros?|dollars?|cents?|thousand|hundred|million|billion|grand)\b/i.test(rest);
}

/** The model's sentence as the page may show it, or null: one line, 12 to 240 characters, no markup, ends a sentence. */
export function cleanLine(s: string): string | null {
  const t = s.replace(/\s+/g, " ").trim().replace(/^["“'‘]+|["”'’]+$/g, "").trim();
  if (t.length < 12 || t.length > 240 || /[<>{}`\\]/.test(t) || !/[.!?]$/.test(t)) return null;
  return t;
}

/** The sentence the page may show, or why not: not one plain sentence ("shape"), or an amount not as given ("amounts"). */
export function checkLine(s: string, given: { amounts: readonly string[]; references: readonly string[] }): { says: string } | { bad: "shape" | "amounts" } {
  const says = cleanLine(s);
  if (!says) return { bad: "shape" };
  return amountsFit(says, given) ? { says } : { bad: "amounts" };
}

export type { SentenceSource };
