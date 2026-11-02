// An agent buying software on its own company card (K2). The agent does not check its limit first: the limit sits
// on the card at Airwallex, so even an agent that ignores the policy cannot spend past it. When Airwallex declines,
// the agent may ask the CFO for a higher limit; that is a policy change, approved with Face ID like any other.

import { stopped } from "../policy/velocity.js";
import { paused } from "../policy/rules.js";
import { CARD_RAISE_TTL_MS, PLANS, type Agent } from "../config/policy.js";
import { audit } from "../audit/log.js";
import type { DB } from "../db/open.js";
import { fromCents } from "../lib/money.js";
import type { CardTransaction, IssuingSim } from "../airwallex/issuing.js";
import { proposePolicyChange } from "../executors/policyChange.js";
import type { ProposalRow } from "../policy/approvals.js";
import { cardOf, ingestCardTransaction } from "../policy/cards.js";
import { chargeUnderHold } from "../policy/holds.js";
import { withOrigin, type Origin } from "../provenance/origin.js";

/**
 * The agent subscribes to a plan; the merchant charges the card. In the sandbox that charge is Airwallex's
 * simulation endpoint (an honest stand-in for the merchant's checkout); the approve or decline is Airwallex's own.
 */
export async function buyPlan(db: DB, sim: IssuingSim, planId: string, now = new Date(), o: { chargeOrigin?: (t: CardTransaction) => Origin } = {}): Promise<CardTransaction> {
  const plan = PLANS[planId];
  if (!plan) throw new Error(`no plan ${planId}; known: ${Object.keys(PLANS).join(", ")}`);
  const card = cardOf(db, plan.agent);
  if (!card) throw new Error(`the ${plan.agent} agent has no card yet; run npm run cards -- setup`);
  // A stopped agent buys nothing, also in the seconds before the runner's sync freezes its card at Airwallex.
  if (stopped(db, plan.agent)) throw new Error(`the ${plan.agent} agent was stopped automatically (velocity limit); it buys nothing until the CFO lifts the stop with Face ID`);
  if (paused(db, plan.agent)) throw new Error(`the ${plan.agent} agent is paused by the CFO; it buys nothing until the CFO resumes it with Face ID`);
  const purpose = `${plan.merchant}, ${plan.label}`;
  audit(db, plan.agent, "card.purchase_started", planId, { agent: plan.agent, last4: card.last4, merchant: plan.merchant, plan: plan.label, amount: fromCents(plan.amountCents), currency: "EUR" }, now);
  const t = await chargeUnderHold(db, plan.agent, plan.amountCents, now, () => sim.simulateCardCharge({ cardId: card.card_id, amountCents: plan.amountCents, currency: "EUR", merchant: plan.merchant, mcc: plan.mcc }));
  // D25: on the TAP rail the charge's own origin also names Airwallex's authorisation id, known only now.
  const record = () => ingestCardTransaction(db, t, "simulation", now, purpose);
  if (o.chargeOrigin) withOrigin(o.chargeOrigin(t), record);
  else record();
  return t;
}

/** The agent asks the CFO for a higher card limit. Nothing changes until a person approves it. */
export function proposeCardRaise(db: DB, agent: Agent, to: { perTx?: string; monthly?: string }, reason: string, now = new Date()): ProposalRow {
  const changes = [
    ...(to.perTx ? [{ key: `card.${agent}.per_tx`, to: to.perTx }] : []),
    ...(to.monthly ? [{ key: `card.${agent}.monthly`, to: to.monthly }] : []),
  ];
  return proposePolicyChange(db, { changes, reason, ttlMs: CARD_RAISE_TTL_MS }, agent, now);
}
