// /try/sign, step 0 "Set the policy" (Max, item 1 of the last round): the test world's CFO policy, per agent, and the
// three locks Purser makes of it, computed by Purser's own code and sent nowhere:
//   Purser's rule   the policy as Purser's settings hold it (src/policy/rules.ts's keys where Purser has one), and the
//                   world's payment check (worker/src/trySign.ts checkPayment) under it;
//   Airwallex       the card's authorization_controls as IssuingRest sends them when it issues the card
//                   (src/airwallex/cardBody.ts), from the limits as rules.ts reads them (src/policy/cardRules.ts);
//   Alta           the mandate's terms as the owner signer passes them to metal-agent (src/metal/credentialArgs.ts):
//                   cap = the limit per purchase, budget = the limit per month, the agent's payee, expiry = the end date.
// Looser, field by field (Max's rules): a higher limit per purchase or per month, more merchant categories, more
// currencies, a later end date, a lower reserve floor, a higher "may pay alone up to". For the amounts and the floor
// that is Purser's own loosens() (src/policy/loosens.ts). Pure: no I/O, no Node modules (the Worker imports it).

import { AGENTS, CARDS, INITIAL_MANDATES, MCC_WORDS, TASK_WITHIN_PER_DAY, type Agent } from "../config/policy.js";
import { fromCents, toCents } from "../lib/money.js";
import { createControlsBody, type CardControls, type CardLimits } from "../airwallex/cardBody.js";
import { agentCardControls, cardLimitsFrom } from "../policy/cardRules.js";
import { loosens } from "../policy/loosens.js";
import { credentialCreateArgs, type MandateTermsSpec } from "../metal/credentialArgs.js";
import { startPolicy, type ExposurePolicy } from "../policy/exposure.js";

export type { Agent };
/** A payment's card, word for word, when it ran without a signature under the policy the visitor signed (Max, 6 Nov). */
export const PAID_ALONE = "paid alone under your new policy";
export type Field = "per_tx" | "monthly" | "mccs" | "currencies" | "end_date" | "alone" | "reserve_floor";
/** The fields, in the order the page shows them. */
export const POLICY_FIELDS: readonly Field[] = ["per_tx", "monthly", "mccs", "currencies", "end_date", "alone", "reserve_floor"];
export const FIELD_WORDS: Record<Field, string> = {
  per_tx: "Limit per purchase", monthly: "Limit per month", mccs: "Merchant categories", currencies: "Currencies",
  end_date: "End date", alone: "May pay alone up to", reserve_floor: "Reserve floor",
};

export interface AgentPolicy { per_tx: string; monthly: string; mccs: string[]; currencies: string[]; end_date: string; alone: string }
/** The reserve floor is the company's (one balance); the rest is each agent's. */
export interface WorldPolicy { reserve_floor: string; agents: Record<Agent, AgentPolicy> }
/** What the page sends for one agent: its whole policy, and the reserve floor. */
export type PolicySet = AgentPolicy & { reserve_floor: string };

// The bounds (Max: caps derived from the test world). Every amount is at most EUR 30,000.00, the test world's bound
// (its starting balances, EUR 26,000.00 and USD 8,000.00, are below it together); a card limit at least EUR 1.00 (as Purser's own card rules), the floor and "alone" from 0.00; the
// limit per purchase no higher than the limit per month (a mandate's cap may not exceed its budget); an end date from
// today to a year ahead; categories and currencies from the lists below, each once, at least one.
export const POLICY_MAX_CENTS = 3_000_000;
export const LIMIT_MIN_CENTS = 100;
export const END_DATE_MAX_DAYS = 365;
/** The merchant categories Purser names (MCC_WORDS). */
export const POLICY_MCCS: readonly string[] = Object.keys(MCC_WORDS).sort();
export const POLICY_CURRENCIES: readonly string[] = ["CHF", "EUR", "GBP", "USD"];

/** The key a field has in Purser's settings: Purser's own where it has one (src/policy/rules.ts), else the test world's. */
export function policyKey(field: Field, agent: string): string {
  switch (field) {
    case "per_tx": return `card.${agent}.per_tx`;
    case "monthly": return `card.${agent}.monthly`;
    case "reserve_floor": return "eur_floor";
    case "alone": return `approval.${agent}.alone_eur`;
    case "mccs": return `card.${agent}.mccs`;
    case "currencies": return `card.${agent}.currencies`;
    case "end_date": return `card.${agent}.active_to`;
  }
}
/** The keys only the test world has (Purser's card holds these at Airwallex, its invoices wait for the CFO). */
export const testWorldKeys = (agent: string): string[] => (["mccs", "currencies", "end_date", "alone"] as const).map((f) => policyKey(f, agent));

/**
 * Decision B (with Max): the worst case step 0 shows takes its chain part from Purser's own mandates, which step 0
 * does not change ("purser", B1, the default), or from this test world's mandate as panel 3 shows it ("test_world",
 * B2: its budget is the card's monthly limit, unconverted). The cards are the visitor's, as set; the task-card rule
 * Purser's own (step 0 does not change it).
 */
export const STEP0_CHAIN: "purser" | "test_world" = "purser";
export function exposurePolicyOfWorld(p: WorldPolicy, chain: "purser" | "test_world" = STEP0_CHAIN): ExposurePolicy {
  const start = startPolicy();
  const monthly = Object.fromEntries(AGENTS.map((a) => [a, toCents(p.agents[a].monthly)])) as Record<Agent, number>;
  // Only the Treasury agent's payments run alone in the test world (runAlone reads its limit, rulesOf); another agent's
  // "may pay alone" has no payment to apply to here, so it adds nothing a payment could reach.
  const alone = Object.fromEntries(AGENTS.map((a) => [a, a === "treasury" ? toCents(p.agents[a].alone) : 0])) as Record<Agent, number>;
  return { ...start, cardMonthlyCents: monthly, mandateBudgetCents: chain === "purser" ? start.mandateBudgetCents : { ...monthly }, invoiceAloneCents: alone, invoicesAlonePerDay: ALONE_PER_DAY };
}

/**
 * At most this many payments an agent makes alone in 24 hours (Max, 7 Nov: the worst case must count them, so they need
 * a limit per day). Purser's existing per-day rule for what an agent does without a person, the task cards'
 * (TASK_WITHIN_PER_DAY), reused; the test world's runAlone enforces it.
 */
export const ALONE_PER_DAY = TASK_WITHIN_PER_DAY;
/** The amounts /try/sign's screen 4 offers for "may pay alone up to"; the server gives each one's worst case. */
export const ALONE_CHOICES: readonly string[] = ["500.00", "2000.00", "5000.00"];

/** The card's end, as Airwallex takes it: the end of the end date, UTC. */
export const activeToOf = (endDate: string) => `${endDate}T23:59:59.000Z`;

/** The world's starting policy: each agent's card as Purser starts it (CARDS, cardControls), the world's floor and limit. */
export function defaultPolicy(now: Date, world: { reserve_floor: string; alone_limit: string }): WorldPolicy {
  const agents = Object.fromEntries(AGENTS.map((a) => {
    const c = agentCardControls(a, now);
    return [a, { per_tx: fromCents(CARDS[a].perTxCents), monthly: fromCents(CARDS[a].monthlyCents), mccs: c.mccs, currencies: c.currencies, end_date: c.activeTo!.slice(0, 10), alone: world.alone_limit }];
  })) as Record<Agent, AgentPolicy>;
  return { reserve_floor: world.reserve_floor, agents };
}

// ── Reading what the visitor sent: every field, nothing else, each within its bounds ──

const MONEY = /^\d{1,9}\.\d{2}$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const day = (d: Date) => d.toISOString().slice(0, 10);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const words = (c: number) => `EUR ${fromCents(c).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;

function money(field: Field, v: unknown, minCents: number): string | { error: string } {
  if (typeof v !== "string" || !MONEY.test(v)) return { error: `${FIELD_WORDS[field]}: write an amount in euros with two decimals, like 25.00 (no minus sign)` };
  const c = toCents(v);
  if (c < minCents || c > POLICY_MAX_CENTS) return { error: `${FIELD_WORDS[field]}: from ${words(minCents)} to ${words(POLICY_MAX_CENTS)} (the test world's bound)` };
  return v;
}
function list(field: Field, v: unknown, allowed: readonly string[]): string[] | { error: string } {
  const bad = { error: `${FIELD_WORDS[field]}: choose one or more of ${allowed.join(", ")}, each once` };
  if (!Array.isArray(v) || v.length === 0 || v.length > allowed.length) return bad;
  if (!v.every((x) => typeof x === "string" && allowed.includes(x)) || new Set(v).size !== v.length) return bad;
  return [...(v as string[])].sort();
}
function date(v: unknown, now: Date): string | { error: string } {
  const last = day(new Date(now.getTime() + END_DATE_MAX_DAYS * 86_400_000));
  const bad = { error: `End date: a date from ${day(now)} to ${last}, written YYYY-MM-DD` };
  const m = typeof v === "string" ? DATE.exec(v) : null;
  if (!m) return bad;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (Number.isNaN(d.getTime()) || day(d) !== v) return bad;
  if (v < day(now) || v > last) return bad;
  return v;
}

/** The bounds, as the page's form uses them (the server checks them again, readSet). */
export function policyBounds(now: Date) {
  return { max: fromCents(POLICY_MAX_CENTS), limit_min: fromCents(LIMIT_MIN_CENTS), end_date_min: day(now), end_date_max: day(new Date(now.getTime() + END_DATE_MAX_DAYS * 86_400_000)) };
}

/** The visitor's set for one agent, read whole and checked; any field out of bounds refuses it all. */
export function readSet(raw: unknown, now: Date): { ok: true; set: PolicySet } | { ok: false; error: string } {
  if (!isObj(raw)) return { ok: false, error: "send the policy as an object with its seven fields" };
  const keys = Object.keys(raw).sort();
  if (keys.join() !== [...POLICY_FIELDS].sort().join()) return { ok: false, error: `send exactly these fields: ${POLICY_FIELDS.join(", ")}` };
  const out = {
    per_tx: money("per_tx", raw.per_tx, LIMIT_MIN_CENTS), monthly: money("monthly", raw.monthly, LIMIT_MIN_CENTS),
    mccs: list("mccs", raw.mccs, POLICY_MCCS), currencies: list("currencies", raw.currencies, POLICY_CURRENCIES),
    end_date: date(raw.end_date, now), alone: money("alone", raw.alone, 0), reserve_floor: money("reserve_floor", raw.reserve_floor, 0),
  };
  for (const f of POLICY_FIELDS) {
    const v = out[f];
    if (isObj(v)) return { ok: false, error: (v as { error: string }).error };
  }
  const set = out as PolicySet;
  if (toCents(set.per_tx) > toCents(set.monthly)) return { ok: false, error: "Limit per purchase: no higher than the limit per month" };
  return { ok: true, set };
}

// ── Looser or stricter, field by field ──

/** Whether one field's change loosens the policy. The amounts and the floor: Purser's own loosens(). */
export function fieldLooser(field: Field, from: string | string[], to: string | string[]): boolean {
  if (field === "mccs" || field === "currencies") return (to as string[]).some((x) => !(from as string[]).includes(x));
  if (field === "end_date") return (to as string) > (from as string);
  return loosens({ key: policyKey(field, "treasury"), from: from as string, to: to as string });
}

export interface PolicyChange { field: Field; key: string; from: string | string[]; to: string | string[]; looser: boolean }
const valueOf = (p: WorldPolicy, agent: Agent, f: Field) => (f === "reserve_floor" ? p.reserve_floor : p.agents[agent][f]);
const same = (a: string | string[], b: string | string[]) => (Array.isArray(a) ? a.join(",") : a) === (Array.isArray(b) ? b.join(",") : b);

/** What a set changes in the policy, field by field, each marked looser or not. */
export function policyChanges(p: WorldPolicy, agent: Agent, set: PolicySet): PolicyChange[] {
  return POLICY_FIELDS.flatMap((f) => {
    const from = valueOf(p, agent, f), to = set[f];
    return same(from, to) ? [] : [{ field: f, key: policyKey(f, agent), from, to, looser: fieldLooser(f, from, to) }];
  });
}

/** The policy with one agent's set applied (and the floor, which is the company's). */
export function withSet(p: WorldPolicy, agent: Agent, set: PolicySet): WorldPolicy {
  const { reserve_floor, ...mine } = set;
  return { reserve_floor, agents: { ...p.agents, [agent]: { per_tx: mine.per_tx, monthly: mine.monthly, mccs: [...mine.mccs], currencies: [...mine.currencies], end_date: mine.end_date, alone: mine.alone } } };
}

// ── The three locks ──

/** The policy as Purser's settings would hold it, for one agent: key → value. */
export function settingsOf(p: WorldPolicy, agent: Agent): Record<string, string> {
  const a = p.agents[agent];
  return {
    [policyKey("per_tx", agent)]: a.per_tx, [policyKey("monthly", agent)]: a.monthly, [policyKey("reserve_floor", agent)]: p.reserve_floor,
    [policyKey("mccs", agent)]: a.mccs.join(","), [policyKey("currencies", agent)]: a.currencies.join(","),
    [policyKey("end_date", agent)]: activeToOf(a.end_date), [policyKey("alone", agent)]: a.alone,
  };
}

/** The card's limits (as rules.ts's cardLimits reads them) and controls, the inputs IssuingRest takes. */
export function cardOf(p: WorldPolicy, agent: Agent): { limits: CardLimits; controls: CardControls } {
  const s = settingsOf(p, agent);
  const a = p.agents[agent];
  return { limits: cardLimitsFrom((k) => s[k] ?? "", agent), controls: { mccs: [...a.mccs], currencies: [...a.currencies], activeTo: activeToOf(a.end_date) } };
}

/**
 * Test addresses for the mandates' principal and payees: shaped like Alta addresses, starting 0x7e57 ("test"), and
 * Purser's own accounts are none of them. Nothing is sent to them or anywhere.
 */
export const TEST_PRINCIPAL = "0x7e57000000000000000000000000000000000000";
export const TEST_PAYEES = {
  supplier: { address: "0x7e57000000000000000000000000000000000001", name: "Stockline (supplier, test address)" },
  customer: { address: "0x7e57000000000000000000000000000000000002", name: "Summit Outfitters (customer, test address)" },
  sweep: { address: "0x7e57000000000000000000000000000000000003", name: "Northwind sweep account (test address)" },
} as const;

/** The mandate's terms for one agent: cap = limit per purchase, budget = limit per month, its payee, until the end date. */
export function mandateOf(p: WorldPolicy, agent: Agent, now: Date, worldId: string): MandateTermsSpec {
  const a = p.agents[agent];
  return {
    principal: TEST_PRINCIPAL, capCents: toCents(a.per_tx), budgetCents: toCents(a.monthly), payees: [{ ...TEST_PAYEES[INITIAL_MANDATES[agent].payee] }],
    expiresInSeconds: Math.max(0, Math.floor((Date.parse(activeToOf(a.end_date)) - now.getTime()) / 1000)), description: `kit11 test world ${worldId}, ${agent} agent (not sent)`,
  };
}

export interface Locks {
  purser: { settings: Record<string, string>; test_world_keys: string[]; rules: string[] };
  airwallex: { authorization_controls: ReturnType<typeof createControlsBody> };
  metal: { args: string[]; params: { cap: string; budget: string; payee: string; expires_in_seconds: string; expires_at: string } };
}

const longDate = (d: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));

/** One policy, three locks: what each would hold for this agent, by the same code Purser uses. Nothing is sent. */
export function threeLocks(p: WorldPolicy, agent: Agent, now: Date, worldId: string): Locks {
  const a = p.agents[agent];
  const card = cardOf(p, agent);
  const args = credentialCreateArgs(mandateOf(p, agent, now, worldId));
  const after = (flag: string) => args[args.indexOf(flag) + 1] ?? "";
  const secs = after("--expires-in");
  return {
    purser: {
      settings: settingsOf(p, agent), test_world_keys: testWorldKeys(agent),
      rules: [
        `Card: at most ${words(card.limits.perTxCents)} a purchase and ${words(card.limits.monthlyCents)} a month; Purser keeps the card at Airwallex at these limits.`,
        `What the card may pay: ${a.mccs.map((m) => `${m} (${MCC_WORDS[m] ?? m})`).join(", ")}; in ${a.currencies.join(", ")}; until ${longDate(a.end_date)}.`,
        `Payments: the balance may not go below ${words(toCents(p.reserve_floor))} (reserve floor); above ${words(toCents(a.alone))} the agent waits for a person's signature.`,
      ],
    },
    airwallex: { authorization_controls: createControlsBody(card.limits, card.controls) },
    metal: { args, params: { cap: after("--cap"), budget: after("--budget"), payee: after("--payee"), expires_in_seconds: secs, expires_at: new Date(now.getTime() + Number(secs) * 1000).toISOString() } },
  };
}
