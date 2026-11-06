// From the CFO policy to an agent's card, without I/O: its limits (from the policy's card.<agent>.per_tx and .monthly)
// and what it may pay at all (its plans' merchant categories, euros, CARD_ACTIVE_DAYS from issue). The runner reads the
// policy from its settings (src/policy/rules.ts cardLimits, src/policy/cards.ts cardControls); /try/sign's policy step
// (src/try/policy.ts) from the visitor's test world. Both go through these functions.

import { CARD_ACTIVE_DAYS, OUTSIDE_AGENT_MCCS, PLANS } from "../config/policy.js";
import { toCents } from "../lib/money.js";
import type { CardControls } from "../airwallex/cardBody.js";

/** The limits an agent's card should have at Airwallex, from the policy's values (read by key). */
export function cardLimitsFrom(value: (key: string) => string, agent: string): { currency: "EUR"; perTxCents: number; monthlyCents: number } {
  return { currency: "EUR", perTxCents: toCents(value(`card.${agent}.per_tx`)), monthlyCents: toCents(value(`card.${agent}.monthly`)) };
}

/**
 * What an agent's card (our own or an outside agent's, not a task card) may pay at all: our agents' cards only the
 * merchant categories of their own plans, an outside agent's card only OUTSIDE_AGENT_MCCS; euros only; for
 * CARD_ACTIVE_DAYS from issue.
 */
export function agentCardControls(agent: string, now: Date): CardControls {
  const mccs = agent.startsWith("ext:") ? OUTSIDE_AGENT_MCCS : Object.values(PLANS).filter((p) => p.agent === agent && !/on the .* card$/.test(p.label)).map((p) => p.mcc);
  return { mccs: [...new Set(mccs)].sort(), currencies: ["EUR"], activeTo: new Date(now.getTime() + CARD_ACTIVE_DAYS * 86_400_000).toISOString() };
}
