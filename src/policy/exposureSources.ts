// 1.1: where the maximum exposure's inputs come from, read by Purser's own code: the ledger's policy (rules.ts
// policyValue, the mandates bound in the audit log), or the main run's record (docs/demo/main-run.json: its policy
// and the one FX rate it recorded). The calculation itself is src/policy/exposure.ts.

import { AGENTS, INITIAL_MANDATES, TASK_WITHIN_PER_DAY, type Agent } from "../config/policy.js";
import type { DB } from "../db/open.js";
import { toCents } from "../lib/money.js";
import { spendLimits } from "./holds.js";
import { policyValue } from "./rules.js";
import { EXPOSURE_HOW, exposureOf, exposureWords, startPolicy, type ExposurePolicy, type RecordedRate } from "./exposure.js";
import { loadRecord } from "../redesign/run.js";

export { startPolicy };

const by = <T>(f: (a: Agent) => T) => Object.fromEntries(AGENTS.map((a) => [a, f(a)])) as Record<Agent, T>;

/** The policy in a ledger: each card's monthly limit, each mandate's budget as bound (else its starting value), the task-card rule. */
export function exposurePolicyFromDb(db: DB): ExposurePolicy {
  return {
    cardMonthlyCents: by((a) => toCents(policyValue(db, `card.${a}.monthly`))),
    mandateBudgetCents: by((a) => spendLimits(db, a).budgetCents ?? INITIAL_MANDATES[a].budgetCents),
    taskCardEurCents: toCents(policyValue(db, "approval.task_card_eur")),
    taskCardsPerDay: TASK_WITHIN_PER_DAY,
  };
}

/** The parts of the main run's record read here. */
export interface RecordForExposure {
  snapshot: { agents: { id: string; card: { monthly: string }; mandate: { budget: string } | null; settings?: { key: string; value: string }[] }[] };
  ledger: { proposals: { status: string; terms?: { conversion?: { client_rate?: string; valid_to?: string; buy_currency?: string; sell_currency?: string } } }[] };
}

/** The policy the main run ended with, as its record holds it (the CFO's view replays that run). */
export function exposurePolicyFromRecord(r: RecordForExposure): ExposurePolicy {
  const of = (a: Agent) => {
    const x = r.snapshot.agents.find((y) => y.id === a);
    if (!x?.mandate) throw new Error(`the record has no ${a} agent with a mandate`);
    return x;
  };
  const task = r.snapshot.agents.flatMap((x) => x.settings ?? []).find((s) => s.key === "approval.task_card_eur");
  if (!task) throw new Error("the record has no approval.task_card_eur");
  return {
    cardMonthlyCents: by((a) => toCents(of(a).card.monthly)), mandateBudgetCents: by((a) => toCents(of(a).mandate!.budget)),
    taskCardEurCents: toCents(task.value), taskCardsPerDay: TASK_WITHIN_PER_DAY,
  };
}

/**
 * The one EUR/USD rate the main run recorded: its executed conversion's client rate (USD sold per EUR bought), with
 * the date of its quote. Null when the record has no such conversion, or more than one rate: then no total is shown.
 */
export function recordedRate(r: Pick<RecordForExposure, "ledger">): RecordedRate | null {
  const rates = r.ledger.proposals.filter((p) => p.status === "EXECUTED").map((p) => p.terms?.conversion)
    .filter((c): c is NonNullable<typeof c> => !!c && c.buy_currency === "EUR" && c.sell_currency === "USD" && /^\d+\.\d+$/.test(String(c.client_rate)) && /^\d{4}-\d{2}-\d{2}/.test(String(c.valid_to)));
  if (rates.length !== 1) return null;
  return { usdPerEur: rates[0]!.client_rate!, date: rates[0]!.valid_to!.slice(0, 10), source: "docs/demo/main-run.json" };
}

/**
 * The worst case under the policy every world starts from, with the main run's rate: the words the README, the CFO's
 * view, step 0 and the form's rewrite share. `worstCaseLine()` is the form's sentence, word for word.
 */
export function worstCaseWords(record: Pick<RecordForExposure, "ledger"> = loadRecord().record as unknown as RecordForExposure) {
  const p = startPolicy();
  return exposureWords(exposureOf(p), p, recordedRate(record));
}
export const worstCaseLine = (): string => worstCaseWords().form;
/** The same words for another policy (the /try/sign test world's, under its own heading), with the main run's rate. */
export function worstCaseWordsOf(p: ExposurePolicy, record: Pick<RecordForExposure, "ledger"> = loadRecord().record as unknown as RecordForExposure, head?: string) {
  return exposureWords(exposureOf(p), p, recordedRate(record), undefined, head);
}

/** The README's block (between its worst-case markers), from the same words: the figure, two lines, the fold. */
export function readmeWorstCase(w: ReturnType<typeof worstCaseWords> = worstCaseWords()): string {
  return [
    `**${w.headline}**`, "", `${w.tasks} ${w.above}`, "", `<details><summary>${EXPOSURE_HOW}</summary>`, "",
    ...w.how.map((l) => `- ${l}`),
    "- Computed from the policy by [`exposureOf`](src/policy/exposure.ts); `test/exposure.test.ts` checks this block against it.",
    "", "</details>",
  ].join("\n");
}
