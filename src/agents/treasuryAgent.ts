// The Treasury agent decides how to answer a supplier's price rise: how to rebalance the three mandates inside the
// fixed 20.00, the Sourcing agent's new cap per purchase, and which sell prices to put to the CFO, with its advice.
// Opus designs the plan and submits it with a tool; code checks it (checkPricePlan) and sends a refused plan back
// with the reasons, at most three tries. Code's fixed plan (the one Purser always used) takes over when Opus is not
// there, fails, or cannot satisfy the checks. Either way, nothing changes on chain until the CFO and the controller
// approve with their passkeys.

import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { audit } from "../audit/log.js";
import { MODELS } from "../claude/reader.js";
import { ALT_SELL_PRICE_CENTS, TOTAL_BUDGET_CENTS, type Agent } from "../config/policy.js";
import type { DB } from "../db/open.js";
import { fromCents } from "../lib/money.js";
import { planReplaceSteps, priceRiseOptions, type MandateNow, type MandateTarget } from "../policy/mandates.js";
import { runAgent, type AgentRun } from "./loop.js";
import { claudeClient } from "../claude/reader.js";

/** What code knows when the price rises: the chain's mandates and the prices. Nothing here comes from an outside party. */
export interface PricePlanFacts {
  sellCents: number;
  oldUpstreamCents: number;
  newUpstreamCents: number;
  refusal: string;
  mandates: MandateNow[];
  /** What the Sourcing agent told Treasury, in its own words (an agent of ours, not an outside party). */
  sourcingMessage?: string;
}

export interface PlanOption {
  id: "A" | "B";
  label: string;
  sellCents: number;
}

export interface PricePlan {
  targets: MandateTarget[];
  options: PlanOption[];
  /** The agent's advice to the CFO, in its own words; empty for code's fixed plan. */
  advice: string;
}

/** Treasury keeps at least this much for the sweep of the day's earnings after finality. */
export const TREASURY_SWEEP_ROOM_CENTS = 200;
/** A sell price above this is not a price for a stock check. */
const MAX_SELL_CENTS = 20;
const MAX_TRIES = 3;

/** The plan Purser used before the agent: sourcing's cap at exactly the new price, 12 / 4 / 4, options A and B. */
export function fallbackPricePlan(f: PricePlanFacts): PricePlan {
  const support = f.mandates.find((m) => m.agent === "support")!;
  return {
    targets: [
      { agent: "sourcing", capCents: f.newUpstreamCents, budgetCents: 1200 },
      { agent: "treasury", capCents: 400, budgetCents: 400 },
      { agent: "support", capCents: support.capCents, budgetCents: support.budgetCents },
    ],
    options: priceRiseOptions(f.sellCents, ALT_SELL_PRICE_CENTS, f.newUpstreamCents)
      .filter((o): o is typeof o & { id: "A" | "B"; sellCents: number } => o.sellCents !== null && (o.id === "A" || o.id === "B"))
      .map((o) => ({ id: o.id, label: o.label, sellCents: o.sellCents })),
    advice: "",
  };
}

/** Everything wrong with a plan, in words the agent can act on; empty when it may go to the CFO. */
export function checkPricePlan(f: PricePlanFacts, p: PricePlan): string[] {
  const problems: string[] = [];
  const now = new Map(f.mandates.map((m) => [m.agent, m]));
  const agents: Agent[] = ["sourcing", "support", "treasury"];
  const target = new Map(p.targets.map((t) => [t.agent, t]));
  if (p.targets.length !== 3 || agents.some((a) => !target.has(a))) return ["the plan must set one mandate for each of sourcing, support and treasury"];
  const total = p.targets.reduce((s, t) => s + t.budgetCents, 0);
  if (total > TOTAL_BUDGET_CENTS) problems.push(`the budgets add up to ${fromCents(total)}, over the ${fromCents(TOTAL_BUDGET_CENTS)} the mandates may bind in total`);
  const src = target.get("sourcing")!;
  if (src.capCents < f.newUpstreamCents) problems.push(`the sourcing cap ${fromCents(src.capCents)} is below Stockline's new price ${fromCents(f.newUpstreamCents)}, so every purchase would still be refused`);
  for (const t of p.targets) {
    const m = now.get(t.agent)!;
    if (t.capCents <= 0 || t.budgetCents <= 0) problems.push(`${t.agent}'s cap and budget must be above zero`);
    if (t.capCents > t.budgetCents) problems.push(`${t.agent}'s cap ${fromCents(t.capCents)} is above its budget ${fromCents(t.budgetCents)}`);
    if (t.budgetCents < m.spentCents + t.capCents) problems.push(`${t.agent}'s budget ${fromCents(t.budgetCents)} does not cover what it already spent (${fromCents(m.spentCents)}) plus one payment at its cap`);
  }
  const sup = target.get("support")!, supNow = now.get("support")!;
  if (sup.budgetCents < supNow.budgetCents || sup.capCents !== supNow.capCents) problems.push(`Support's mandate stays as it is (cap ${fromCents(supNow.capCents)}, budget ${fromCents(supNow.budgetCents)}): it pays the refunds in disputes`);
  const tre = target.get("treasury")!, treNow = now.get("treasury")!;
  if (tre.budgetCents < treNow.spentCents + TREASURY_SWEEP_ROOM_CENTS) problems.push(`Treasury needs at least ${fromCents(TREASURY_SWEEP_ROOM_CENTS)} left for the sweep after finality`);
  if (tre.capCents !== tre.budgetCents) problems.push(`Treasury's cap equals its budget (one sweep at a time): set both to ${fromCents(tre.budgetCents)}`);
  if (problems.length === 0) {
    try {
      planReplaceSteps(f.mandates, p.targets);
    } catch (e) {
      problems.push((e as Error).message);
    }
  }
  if (p.options.length < 1 || p.options.length > 2) problems.push("give one or two sell prices for the CFO to choose from");
  const seen = new Set<number>();
  for (const o of p.options) {
    if (o.sellCents <= f.newUpstreamCents) problems.push(`option ${o.id} sells at ${fromCents(o.sellCents)}: no margin over Stockline's ${fromCents(f.newUpstreamCents)}`);
    if (o.sellCents > MAX_SELL_CENTS) problems.push(`option ${o.id} sells at ${fromCents(o.sellCents)}, above ${fromCents(MAX_SELL_CENTS)} for a stock check`);
    if (seen.has(o.sellCents)) problems.push(`the same price ${fromCents(o.sellCents)} is offered twice`);
    seen.add(o.sellCents);
    if (!o.label.trim() || o.label.length > 60) problems.push(`option ${o.id} needs a short label (at most 60 characters)`);
  }
  return problems;
}

const Money = z.string();
const SubmitPlan = z.strictObject({
  sourcing_cap: Money, sourcing_budget: Money, support_budget: Money, treasury_budget: Money,
  options: z.array(z.strictObject({ label: z.string(), sell_price: Money })),
  advice: z.string(),
});
type Submitted = z.infer<typeof SubmitPlan>;

/** Cents from "0.04"; null for anything that is not an amount with two decimals. */
const cents = (s: string): number | null => (/^\d{1,4}\.\d{2}$/.test(s.trim()) ? Math.round(Number(s.trim()) * 100) : null);

function toPlan(f: PricePlanFacts, s: Submitted): PricePlan | string[] {
  const vals = { sourcing_cap: cents(s.sourcing_cap), sourcing_budget: cents(s.sourcing_budget), support_budget: cents(s.support_budget), treasury_budget: cents(s.treasury_budget) };
  const bad = Object.entries(vals).filter(([, v]) => v === null).map(([k]) => `${k} must be an amount like 4.00`);
  const prices = s.options.map((o) => cents(o.sell_price));
  if (prices.some((p) => p === null)) bad.push("each sell_price must be an amount like 0.07");
  if (bad.length) return bad;
  const support = f.mandates.find((m) => m.agent === "support")!;
  return {
    targets: [
      { agent: "sourcing", capCents: vals.sourcing_cap!, budgetCents: vals.sourcing_budget! },
      { agent: "treasury", capCents: vals.treasury_budget!, budgetCents: vals.treasury_budget! },
      { agent: "support", capCents: support.capCents, budgetCents: vals.support_budget! },
    ],
    options: s.options.map((o, i) => ({ id: (i === 0 ? "A" : "B") as "A" | "B", label: o.label.trim(), sellCents: prices[i]! })),
    advice: s.advice.trim().slice(0, 2000),
  };
}

const SYSTEM = [
  "You are the Treasury agent of Northwind Outdoor, an outdoor wholesaler that sells live stock data to retailers per query.",
  "Three agents spend from one Metal account under on-chain mandates that together may bind at most 20.00 test USD: the Sourcing agent buys each stock check from the supplier Stockline, the Support agent refunds customers in disputes, and you sweep earnings to Airwallex.",
  "When Stockline raises its price, you decide how to answer it: the new budget for each mandate, the Sourcing agent's cap per purchase, and one or two sell prices per stock check for the CFO to choose from, with your advice.",
  "Submit your plan with the submit_plan tool. Code checks it against the limits; if it refuses the plan, it tells you why, and you fix it and submit again.",
  "You cannot pay anyone, choose a payee or bind a mandate yourself: the CFO and the controller approve the change with their passkeys, and Metal enforces the mandates on chain.",
  "Write your advice for a CFO in two or three plain sentences: which option you recommend and why, in numbers.",
].join("\n");

function prompt(f: PricePlanFacts): string {
  return [
    "Facts checked by code:",
    `- Stockline's price per stock check rose from ${fromCents(f.oldUpstreamCents)} to ${fromCents(f.newUpstreamCents)} (its live offer says the same).`,
    `- The next purchase was refused by Metal against the on-chain mandate: ${f.refusal}.`,
    `- Northwind sells a stock check at ${fromCents(f.sellCents)}.`,
    ...(f.sourcingMessage ? [`- The Sourcing agent told you: "${f.sourcingMessage.replace(/"/g, "'")}"`] : []),
    ...f.mandates.map((m) => `- ${m.agent} mandate now: cap ${fromCents(m.capCents)} a payment, budget ${fromCents(m.budgetCents)}, spent ${fromCents(m.spentCents)}.`),
    `- Rules: total budgets at most ${fromCents(TOTAL_BUDGET_CENTS)}; Support's mandate stays as it is; Treasury keeps at least ${fromCents(TREASURY_SWEEP_ROOM_CENTS)} for the sweep and its cap equals its budget; each budget covers what that agent already spent plus one payment at its cap; each sell price above Stockline's new price.`,
    "Design the plan and submit it.",
  ].join("\n");
}

export interface PriceDesign {
  plan: PricePlan;
  source: "claude" | "fallback";
  attempts: number;
  run: AgentRun;
  /** Why code's plan was used, when it was. */
  note?: string;
}

export async function designPriceRise(db: DB, f: PricePlanFacts, client: Anthropic | null = claudeClient()): Promise<PriceDesign> {
  let attempts = 0;
  let accepted: PricePlan | null = null;
  const run = await runAgent(db, {
    agent: "treasury", task: "price_rise.plan", model: MODELS.review, system: SYSTEM, prompt: prompt(f), maxTurns: MAX_TRIES + 1, effort: "medium",
    tools: [{
      name: "submit_plan",
      description: "Submit your rebalance and sell-price options. Amounts in test USD with two decimals (e.g. \"12.00\", \"0.04\"). Code checks the plan and answers with its reasons if it refuses it.",
      input: SubmitPlan,
      run: async (s: Submitted) => {
        attempts++;
        const plan = toPlan(f, s);
        const problems = Array.isArray(plan) ? plan : checkPricePlan(f, plan);
        if (problems.length === 0 && !Array.isArray(plan)) {
          accepted = plan;
          return { text: "Accepted: the plan goes to the CFO and the controller for their passkeys.", final: true };
        }
        const last = attempts >= MAX_TRIES;
        return { text: `Refused by code: ${problems.join("; ")}.${last ? " No tries left; code's fixed plan will be used." : " Fix these and submit again."}`, blocked: "plan check", ...(last ? { final: true } : {}) };
      },
    }],
  }, client);
  const plan: PricePlan = accepted ?? fallbackPricePlan(f);
  const source = accepted ? "claude" : "fallback";
  const note = accepted ? undefined : run.status !== "done" ? `the agent was ${run.status}${run.note ? ` (${run.note})` : ""}` : attempts >= MAX_TRIES ? `${attempts} plans refused by code` : "no plan submitted";
  audit(db, "treasury", "price_rise.plan", null, {
    source, attempts, model: run.model, ...(note ? { note } : {}),
    budgets: plan.targets.map((t) => `${t.agent} ${fromCents(t.budgetCents)} (cap ${fromCents(t.capCents)})`),
    options: plan.options.map((o) => `${o.id} ${o.label} ${fromCents(o.sellCents)}`), advice: plan.advice,
  });
  return { plan, source, attempts, run, ...(note ? { note } : {}) };
}
