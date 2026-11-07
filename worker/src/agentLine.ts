// /try/sign's live agents (Max, 7 Nov, section 6 and spec 6b): Claude Sonnet reads the invoice (the runner's reader) and
// Claude Opus advises when to pay (the runner's Treasury timing agent). What goes to a model is written by code: the
// fixed invoice documents and the test world's facts. Nothing a visitor sends (no body, no address, no world id or
// token) is ever part of it. The models only read and advise: the amounts, the payee, the plan, the checks and the
// approval stay in code and the visitor's passkey. Limits: a budget of USD 10 a UTC day for every live agent call on the
// page together, a few calls a minute for everyone and a few an hour per address, an 8 s timeout per call; past any of
// them, or on any error, the page shows a recorded real output of the same agent (docs/demo/try-agents-recorded.json,
// labelled "recorded: the live agent was unavailable") or, without one, code's reading and a fixed sentence, labelled
// with the reason. The calls are made whenever the Worker has its ANTHROPIC_API_KEY secret (Max sets it himself; no
// script or config in this repo does), unless the emergency switch is thrown: the Worker var TRY_SIGN_AGENTS set to
// "off" (any case, trimmed) stops every live agent call, with no request to Anthropic and no budget spent. The old name,
// TRY_SIGN_HAIKU, still works the same way, so a Worker deployed with it stays off. Any other value, or none, leaves
// them on.
//
// Opus's reason is checked by code before it is shown: one or two plain sentences, at most 300 characters, and every
// amount in it one of code's numbers, written as code gave it (see amountsFit); else the fixed sentence is shown,
// labelled.

import { claudeAgentAsk, claudeReadInvoice, type InvoiceReadSource } from "../../src/try/claude.js";
import type { AgentAsk } from "../../src/try/world.js";
import { adviceBounds, licenceNumbers, type TimingFacts } from "../../src/agents/timingCore.js";

/** Model spend allowed per UTC day for every live agent call on /try/sign together, in US dollars. */
export const AGENT_LINE_DAILY_USD = 10;
/** A live call that takes longer is dropped (the reader's call, and each of Opus's calls). */
export const AGENT_LINE_TIMEOUT_MS = 8_000;

/** The labels, word for word (Max, 7 Nov). */
export const READER_LIVE_LABEL = "Claude Sonnet · live · invoice reader";
export const ADVICE_LIVE_LABEL = "Claude Opus · live · treasury advice";
export const CODE_LABEL = "Purser's code";
export const RECORDED_LABEL = "recorded: the live agent was unavailable";
export const STAND_IN_LABEL = "stand-in, not Claude";
/** Without a live or recorded answer: "read by code · <reason>" and "fixed text · <reason>". */
export const READ_BY_CODE = "read by code";
export const FIXED_TEXT = "fixed text";

/** A live answer's label by the model that gave it: a Claude model by its name and role; a local stand-in says it is not Claude. */
export function liveLabel(model: string, role: "reader" | "advice"): string {
  if (!/^claude-/.test(model)) return STAND_IN_LABEL;
  const name = /opus/.test(model) ? "Opus" : /haiku/.test(model) ? "Haiku" : "Sonnet";
  return `Claude ${name} · live · ${role === "reader" ? "invoice reader" : "treasury advice"}`;
}

/**
 * The emergency switch: "off" (any case, surrounding spaces ignored) in TRY_SIGN_AGENTS, or in the old TRY_SIGN_HAIKU,
 * stops every live agent call; anything else leaves them on.
 */
export const agentsSwitchedOff = (env: { TRY_SIGN_AGENTS?: string; TRY_SIGN_HAIKU?: string }) =>
  [env.TRY_SIGN_AGENTS, env.TRY_SIGN_HAIKU].some((v) => (v ?? "").trim().toLowerCase() === "off");

type AgentEnv = { ANTHROPIC_API_KEY?: string; TRY_SIGN_AGENTS?: string; TRY_SIGN_HAIKU?: string };

/**
 * The live invoice reader (section 6), from the Worker's env: Sonnet through the runner's reader when the Worker has its
 * key, null without one, "off" under the emergency switch. The desk is handed the function, never the key.
 */
export function invoiceReaderSource(env: AgentEnv, fetcher: typeof fetch = fetch): InvoiceReadSource | "off" | null {
  if (agentsSwitchedOff(env)) return "off";
  return env.ANTHROPIC_API_KEY ? claudeReadInvoice(env.ANTHROPIC_API_KEY, fetcher, AGENT_LINE_TIMEOUT_MS) : null;
}

/** The Treasury agent's advice (Opus, one Messages API call with tools per turn), from the Worker's env the same way. */
export function treasuryAdvisorSource(env: AgentEnv, fetcher: typeof fetch = fetch): AgentAsk | "off" | null {
  if (agentsSwitchedOff(env)) return "off";
  return env.ANTHROPIC_API_KEY ? claudeAgentAsk(env.ANTHROPIC_API_KEY, fetcher, AGENT_LINE_TIMEOUT_MS) : null;
}

/**
 * Money as the page writes it (its amt()/eur() in src/try/sign.ts; test/try-agent-line.test.ts runs both and compares):
 * the currency code, a space, the whole part grouped by commas, the cents: "EUR 1,850.00", "EUR 25,000.00".
 */
export function moneyForPeople(currency: string, amount: string): string {
  const [whole, cents] = amount.split(".");
  return `${currency} ${whole!.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${cents === undefined ? "" : `.${cents}`}`;
}

/** What a reason may contain that has a digit in it: code's amounts, references and dates, each only as written here. */
export interface Given { amounts: readonly string[]; references: readonly string[] }

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** A day the ways a sentence may write it: 2026-11-12, 12 November 2026, 12 November, November 12, 12 Nov. */
const dayForms = (iso: string): string[] => {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return [iso];
  const name = MONTHS[m - 1]!;
  return [iso, `${d} ${name} ${y}`, `${name} ${d}, ${y}`, `${d} ${name}`, `${name} ${d}`, `${d} ${name.slice(0, 3)}`];
};

/**
 * Code's numbers for the advice, the only ones its reason may name: the invoice, the fee ceiling, EUR needed, free
 * EUR, the shortfall, the FX buy and sell, the rate, the limit the agent may pay alone, the balances and floors and the
 * position after, each as the facts write it ("EUR 1850.00") or as the page does ("EUR 1,850.00"); the invoice number,
 * the proposal id; and the days in the facts (today, the due date, the bounds of a wait, the quote's end).
 */
export function adviceGiven(f: TimingFacts, aloneLimit: string, extraDays: readonly string[] = []): Given {
  const n = licenceNumbers(f);
  const eurs = [f.amount, f.feeMax, n.needed, n.freeBefore, n.shortfall, n.fxBuy, aloneLimit, f.eurAvailable, f.eurFloor, f.eurObligations, f.after.eurFree].filter((x): x is string => !!x);
  const usds = [f.usdAvailable, f.usdFloor, f.after.usdAvailable, f.quote?.sell.replace(/^[A-Z]{3}\s*/, "")].filter((x): x is string => !!x);
  const forms = (cur: string, a: string) => [`${cur} ${a}`, moneyForPeople(cur, a), a, moneyForPeople(cur, a).slice(4)];
  const b = adviceBounds(f);
  const days = [f.today, f.dueDate, b.earliest, b.latest, ...extraDays].flatMap(dayForms);
  return {
    amounts: [...eurs.flatMap((a) => forms("EUR", a)), ...usds.flatMap((a) => forms("USD", a)), ...(f.quote ? [f.quote.rate] : [])],
    references: [f.invoiceNo, `Invoice ${f.invoiceNo}`, f.proposalId, ...(f.quote ? [f.quote.validTo] : []), ...days],
  };
}

/**
 * Whether every amount in the sentence is one it was given, written as given. The given amounts and references are
 * taken out, longest first; if anything money-like is left (any digit at all, as in "1850", "EUR 1850.005", "1,850 EUR",
 * "€1,850", or a currency sign or code, or a number word such as "thousand"), it does not fit.
 */
export function amountsFit(sentence: string, given: Given): boolean {
  let rest = sentence;
  for (const t of [...given.amounts, ...given.references].sort((a, b) => b.length - a.length)) rest = rest.split(t).join(" | ");
  return !/\d|[€$£¥₹¢]|\b(?:EUR|USD|GBP|CHF|JPY|euros?|dollars?|cents?|thousand|hundred|million|billion|grand)\b/i.test(rest);
}

/** The reason as the page may show it, or null: one or two plain sentences, 20 to 300 characters, no markup. */
export function cleanReason(s: string): string | null {
  const t = s.replace(/\s+/g, " ").trim().replace(/^["“'‘]+|["”'’]+$/g, "").trim();
  if (t.length < 20 || t.length > 300 || /[<>{}`\\]/.test(t) || !/[.!?]$/.test(t)) return null;
  // Sentences end at . ! or ? before a space or the end (a decimal point has a digit after it).
  const sentences = t.split(/[.!?](?=\s|$)/).filter((x) => x.trim()).length;
  return sentences >= 1 && sentences <= 2 ? t : null;
}

/** The reason the page may show, or why not: not one or two plain sentences ("shape"), or an amount not code's ("amounts"). */
export function checkReason(s: string, given: Given): { says: string } | { bad: "shape" | "amounts" } {
  const says = cleanReason(s);
  if (!says) return { bad: "shape" };
  return amountsFit(says, given) ? { says } : { bad: "amounts" };
}
