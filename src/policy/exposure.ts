// 1.1: the maximum exposure the CFO policy allows, per agent and in all, per day and per month. Pure (no database, no
// files, no Node modules), so the Worker's /try/sign and the pages built in Node compute it with the same code. The
// inputs are read from the policy by src/policy/exposureSources.ts (the ledger, the main run's record) or startPolicy.
//
// What counts, per agent:
//   card     (Airwallex, EUR): the card's monthly limit, card.<agent>.monthly. A card has a limit per purchase and per
//            month, none per day, so the whole month can go in one day: per day = per month = the monthly limit.
//   mandate  (Metal, *USDZ = test USD): the mandate's budget, over its whole life (MANDATE_EXPIRES_IN_SECONDS, 40 days).
//            It can all go in one day: per day = per month = the budget.
//   alone    (EUR): what Purser's policy lets the agent pay without a person beyond its card and mandate, as its
//            profile lists it (src/agents/profiles.ts): for the Treasury agent, task cards issued without Face ID, each
//            up to approval.task_card_eur, at most TASK_WITHIN_PER_DAY in 24 hours; per day that many cards, per month
//            that many on each of MONTH_DAYS days. Refunds and sweeps are paid under the mandates, so already counted.
// EUR and USD are never added together here; approxEurCents converts USD only at a rate given to it, with its source.

import { AGENTS, CARDS, INITIAL_MANDATES, TASK_CARD_EUR_FALLBACK, TASK_WITHIN_PER_DAY, type Agent } from "../config/policy.js";
import { toCents } from "../lib/money.js";

/** The longest calendar month: a rule per day allows at most this many days' worth in a month. */
export const MONTH_DAYS = 31;

export interface ExposurePolicy {
  /** card.<agent>.monthly, in EUR cents. */
  cardMonthlyCents: Record<Agent, number>;
  /** Each agent's mandate budget, in *USDZ cents. */
  mandateBudgetCents: Record<Agent, number>;
  /** approval.task_card_eur, in EUR cents: a task card up to this is issued without Face ID. */
  taskCardEurCents: number;
  /** TASK_WITHIN_PER_DAY: at most this many such task cards in 24 hours. */
  taskCardsPerDay: number;
}

export interface Amounts { eurCents: number; usdCents: number }
export interface AgentExposure {
  agent: Agent;
  card: { dayEurCents: number; monthEurCents: number };
  mandate: { dayUsdCents: number; monthUsdCents: number };
  alone: { dayEurCents: number; monthEurCents: number };
  day: Amounts;
  month: Amounts;
}
export interface Exposure { agents: AgentExposure[]; total: { day: Amounts; month: Amounts } }

/** The policy every world starts from: the cards' and mandates' starting values and the rule's fallback (rules.ts). */
export function startPolicy(): ExposurePolicy {
  const by = <T>(f: (a: Agent) => T) => Object.fromEntries(AGENTS.map((a) => [a, f(a)])) as Record<Agent, T>;
  return {
    cardMonthlyCents: by((a) => CARDS[a].monthlyCents), mandateBudgetCents: by((a) => INITIAL_MANDATES[a].budgetCents),
    taskCardEurCents: toCents(TASK_CARD_EUR_FALLBACK), taskCardsPerDay: TASK_WITHIN_PER_DAY,
  };
}

/** The most each agent, and all of them, may spend per day and per month under this policy; EUR and USD apart. */
export function exposureOf(p: ExposurePolicy): Exposure {
  const agents = AGENTS.map((agent): AgentExposure => {
    const card = p.cardMonthlyCents[agent], budget = p.mandateBudgetCents[agent];
    const tasksDay = agent === "treasury" ? p.taskCardEurCents * p.taskCardsPerDay : 0;
    return {
      agent,
      card: { dayEurCents: card, monthEurCents: card },
      mandate: { dayUsdCents: budget, monthUsdCents: budget },
      alone: { dayEurCents: tasksDay, monthEurCents: tasksDay * MONTH_DAYS },
      day: { eurCents: card + tasksDay, usdCents: budget },
      month: { eurCents: card + tasksDay * MONTH_DAYS, usdCents: budget },
    };
  });
  const sum = (f: (e: AgentExposure) => Amounts): Amounts => agents.reduce((s, e) => ({ eurCents: s.eurCents + f(e).eurCents, usdCents: s.usdCents + f(e).usdCents }), { eurCents: 0, usdCents: 0 });
  return { agents, total: { day: sum((e) => e.day), month: sum((e) => e.month) } };
}

/**
 * EUR plus USD in EUR, at a rate of USD per EUR written as a decimal (as Airwallex quotes it, e.g. "1.129917"): EUR =
 * USD / rate, in whole cents, half up. Integer arithmetic on the rate's digits, so no float rounding decides a cent.
 */
export function approxEurCents(eurCents: number, usdCents: number, usdPerEur: string): number {
  const m = /^(\d+)\.(\d{1,9})$/.exec(usdPerEur);
  if (!m) throw new Error(`not a rate: ${usdPerEur}`);
  const scale = 10n ** BigInt(m[2]!.length);
  const rate = BigInt(m[1]!) * scale + BigInt(m[2]!);
  const usd = BigInt(usdCents) * scale;
  return eurCents + Number((usd * 2n + rate) / (rate * 2n));
}

/** An amount for people: "EUR 28,200.00", "USD 20.00". */
export function moneyWords(currency: "EUR" | "USD", cents: number): string {
  const whole = Math.floor(cents / 100), rest = String(cents % 100).padStart(2, "0");
  return `${currency} ${String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${rest}`;
}

/** A recorded rate: USD per EUR, the date of its quote (YYYY-MM-DD), and the record it is from. */
export interface RecordedRate { usdPerEur: string; date: string; source: string }

/** The comparison, with no amount of its own (Max, 1.1). */
export const EXPOSURE_COMPARISON = "With a shared card or an API key, the limit is the card's or the account's.";

/**
 * Decision A (with Max): the Treasury agent's task cards (issued without Face ID within the policy) counted in the
 * worst case, on their own line ("counted", the default), or named on a line of their own but left out of it ("apart").
 */
export const EXPOSURE_TASK_CARDS: "counted" | "apart" = "counted";

const dayWords = (date: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));

/**
 * The words every place shows (step 0 of /try/sign, the CFO's view, the README; the form's rewrite quotes `form`), from
 * one Exposure, so the numbers are the same wherever they appear. EUR and USD apart; an EUR total only at the
 * recorded rate, said with its source and date.
 */
export function exposureWords(x: Exposure, p: ExposurePolicy, rate: RecordedRate | null, taskCards: "counted" | "apart" = EXPOSURE_TASK_CARDS) {
  const tasks = x.agents.find((e) => e.agent === "treasury")!.alone;
  const counted = taskCards === "counted";
  const less = (a: Amounts, t: number): Amounts => (counted ? a : { eurCents: a.eurCents - t, usdCents: a.usdCents });
  const month = less(x.total.month, tasks.monthEurCents), day = less(x.total.day, tasks.dayEurCents);
  const cards = x.agents.reduce((s, e) => s + e.card.monthEurCents, 0);
  const approx = rate ? `; ≈ ${moneyWords("EUR", approxEurCents(month.eurCents, month.usdCents, rate.usdPerEur))} at the main run's rate of ${dayWords(rate.date)} (${rate.usdPerEur} USD per EUR, ${rate.source})` : "";
  const taskWords = `task cards the Treasury agent may issue without Face ID (up to ${moneyWords("EUR", p.taskCardEurCents)} each, ${p.taskCardsPerDay} a day)`;
  return {
    /** The line every place leads with; "Worst case" word for word. */
    headline: `Worst case, set by policy: ${moneyWords("EUR", month.eurCents)} on cards + ${moneyWords("USD", month.usdCents)} on chain (test USD) a month${approx}.`,
    /** What makes up the figure. */
    parts: counted
      ? `On cards: ${moneyWords("EUR", cards)} on the agents' own cards and ${moneyWords("EUR", tasks.monthEurCents)} on ${taskWords}. On chain: ${moneyWords("USD", month.usdCents)} in the agents' Metal mandates.`
      : `On cards: ${moneyWords("EUR", cards)} on the agents' own cards. On chain: ${moneyWords("USD", month.usdCents)} in the agents' Metal mandates. Not counted above: ${taskWords}, up to ${moneyWords("EUR", tasks.monthEurCents)} a month.`,
    /** The one line that says what counts: per day, per month, the policy keys, the two currencies. */
    definition: `A month: each card's card.<agent>.monthly; each Metal mandate's budget (it lasts 40 days and can all go at once)${counted ? `; task cards up to approval.task_card_eur, ${p.taskCardsPerDay} a day, ${MONTH_DAYS} days` : ""}. A day: the same card and mandate amounts (neither has a daily limit)${counted ? ` and ${p.taskCardsPerDay} task cards` : ""}: ${moneyWords("EUR", day.eurCents)} + ${moneyWords("USD", day.usdCents)}. Test USD (*USDZ) is never added to EUR; only the ≈ total converts it, at the recorded rate.`,
    comparison: EXPOSURE_COMPARISON,
    /** The form's sentence, for the form's rewrite to quote word for word: "the agents together", a total over all agents. */
    form: `Worst case, set by policy: the agents together can spend at most ${moneyWords("EUR", month.eurCents)} and ${moneyWords("USD", month.usdCents)} (test USD) a month; everything above waits for the CFO.`,
    perAgent: x.agents.map((e) => {
      const t = e.agent === "treasury" ? tasks : { dayEurCents: 0, monthEurCents: 0 };
      const em = less(e.month, t.monthEurCents), ed = less(e.day, t.dayEurCents);
      return { agent: e.agent, month: `${moneyWords("EUR", em.eurCents)} + ${moneyWords("USD", em.usdCents)}`, day: `${moneyWords("EUR", ed.eurCents)} + ${moneyWords("USD", ed.usdCents)}` };
    }),
  };
}
export type ExposureWords = ReturnType<typeof exposureWords>;
