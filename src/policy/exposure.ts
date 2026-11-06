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
/** The same, in whole units where the cents are .00 (Max, 1.1: "EUR 300", "EUR 28,217.70"). */
export function moneyShort(currency: "EUR" | "USD", cents: number): string {
  const w = moneyWords(currency, cents);
  return cents % 100 === 0 ? w.slice(0, -3) : w;
}

/** A recorded rate: USD per EUR, the date of its quote (YYYY-MM-DD), and the record it is from. */
export interface RecordedRate { usdPerEur: string; date: string; source: string }

/** The comparison, with no amount of its own (Max, 1.1). */
export const EXPOSURE_COMPARISON = "With a shared card or an API key, the limit is the card's or the account's.";
/** The line under the figure, word for word. */
export const EXPOSURE_ABOVE = "Everything above waits for the CFO.";
/** The fold's summary, word for word; closed by default wherever the block is. */
export const EXPOSURE_HOW = "How this is computed";

/**
 * Decision A (Max, 6 Nov: "apart"): the Treasury agent's task cards (issued without Face ID within the policy) named on
 * a line of their own and left out of the figure ("apart"), or counted in it ("counted").
 */
export const EXPOSURE_TASK_CARDS: "counted" | "apart" = "apart";

const dayWords = (date: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
const agentWords = (a: Agent) => `${a[0]!.toUpperCase()}${a.slice(1)} agent`;

/**
 * The words every place shows (step 0 of /try/sign, the CFO's view, the README; the form's rewrite quotes `form`), from
 * one Exposure, so the numbers are the same wherever they appear. In sight: the figure, the task cards' line and
 * EXPOSURE_ABOVE; everything else (`how`) behind one fold, EXPOSURE_HOW, closed by default. EUR and test USD apart;
 * an EUR total only at the recorded rate, said with its source and date, inside the fold.
 */
export function exposureWords(x: Exposure, p: ExposurePolicy, rate: RecordedRate | null, taskCards: "counted" | "apart" = EXPOSURE_TASK_CARDS) {
  const tasks = x.agents.find((e) => e.agent === "treasury")!.alone;
  const counted = taskCards === "counted";
  const less = (a: Amounts, t: number): Amounts => (counted ? a : { eurCents: a.eurCents - t, usdCents: a.usdCents });
  const month = less(x.total.month, tasks.monthEurCents), day = less(x.total.day, tasks.dayEurCents);
  /** The figure itself, as "If you sign it:" repeats it in step 0. */
  const figure = `${moneyShort("EUR", month.eurCents)} on cards + ${moneyShort("USD", month.usdCents)} on chain a month`;
  const approx = rate ? `≈ ${moneyShort("EUR", approxEurCents(month.eurCents, month.usdCents, rate.usdPerEur))} in all at the main run's rate of ${dayWords(rate.date)} (${rate.usdPerEur} USD per EUR, ${rate.source}); test USD is never added to EUR otherwise.` : "No EUR total: the record has no usable rate, and test USD is never added to EUR without one.";
  return {
    /** In sight, large: "Worst case, set by policy" word for word. */
    headline: `Worst case, set by policy: ${figure}.`,
    figure,
    /** In sight, one short line. */
    tasks: `${counted ? "Including task" : "Task"} cards the Treasury agent may issue alone: up to ${moneyShort("EUR", tasks.dayEurCents)} a day.`,
    above: EXPOSURE_ABOVE,
    /** Behind the fold, one item each. */
    how: [
      ...x.agents.map((e) => {
        const t = e.agent === "treasury" && counted ? tasks.monthEurCents : 0;
        return `${agentWords(e.agent)}: ${moneyShort("EUR", e.card.monthEurCents + t)} on its card${t ? " and task cards" : ""} + ${moneyShort("USD", e.mandate.monthUsdCents)} on chain (test USD) a month.`;
      }),
      `A day: ${moneyShort("EUR", day.eurCents)} + ${moneyShort("USD", day.usdCents)}, the same as a month: neither a card nor a mandate has a daily limit.`,
      `Counted: each card's monthly limit (card.*.monthly, EUR) and each Metal mandate's budget (test USD, *USDZ; it lasts 40 days and can all go at once). Task cards: up to ${moneyShort("EUR", p.taskCardEurCents)} each (approval.task_card_eur), ${p.taskCardsPerDay} a day, ${counted ? `${MONTH_DAYS} days a month, counted above` : "not counted above"}.`,
      approx,
      EXPOSURE_COMPARISON,
    ],
    /** The form's sentence, for the form's rewrite to quote word for word: "the agents together", a total over all agents. */
    form: `Worst case, set by policy: the agents together can spend at most ${moneyShort("EUR", month.eurCents)} and ${moneyShort("USD", month.usdCents)} (test USD) a month; everything above waits for the CFO.`,
  };
}
export type ExposureWords = ReturnType<typeof exposureWords>;
