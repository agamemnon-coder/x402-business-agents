// Pure planning for mandate changes. No I/O: callers pass in what the chain says.

import { TOTAL_BUDGET_CENTS, type Agent } from "../config/policy.js";

export interface MandateNow {
  agent: Agent;
  capCents: number;
  budgetCents: number;
  spentCents: number;
}

export interface MandateTarget {
  agent: Agent;
  capCents: number;
  budgetCents: number;
}

export interface ReplaceStep extends MandateTarget {
  order: number;
  /** Sum of all bound budgets after this step. */
  totalAfterCents: number;
}

/**
 * Orders the replaces so the 20.00 total holds after every single step: budgets that shrink go first.
 * A replacement carries spend over, so each new budget must exceed what the agent has already spent.
 */
export function planReplaceSteps(current: MandateNow[], targets: MandateTarget[]): ReplaceStep[] {
  const byAgent = new Map(current.map((m) => [m.agent, m]));
  if (byAgent.size !== current.length) throw new Error("duplicate agent in current mandates");

  for (const t of targets) {
    const now = byAgent.get(t.agent);
    if (!now) throw new Error(`no bound mandate for ${t.agent}`);
    if (!Number.isSafeInteger(t.capCents) || t.capCents <= 0) throw new Error(`${t.agent}: cap must be a positive whole number of cents`);
    if (!Number.isSafeInteger(t.budgetCents) || t.budgetCents <= 0) throw new Error(`${t.agent}: budget must be a positive whole number of cents`);
    if (t.capCents > t.budgetCents) throw new Error(`${t.agent}: cap ${t.capCents} exceeds budget ${t.budgetCents}`);
    if (t.budgetCents <= now.spentCents) {
      throw new Error(`${t.agent}: new budget ${t.budgetCents} must exceed spend carried over (${now.spentCents})`);
    }
  }
  if (new Set(targets.map((t) => t.agent)).size !== targets.length) throw new Error("duplicate agent in targets");

  const changed = targets.filter((t) => {
    const now = byAgent.get(t.agent)!;
    return now.capCents !== t.capCents || now.budgetCents !== t.budgetCents;
  });
  const delta = (t: MandateTarget) => t.budgetCents - byAgent.get(t.agent)!.budgetCents;
  // Shrinking budgets first, then growing ones; ties keep a stable, readable order.
  const ordered = [...changed].sort((a, b) => delta(a) - delta(b) || a.agent.localeCompare(b.agent));

  let total = current.reduce((s, m) => s + m.budgetCents, 0);
  if (total > TOTAL_BUDGET_CENTS) throw new Error(`bound budgets already exceed the total: ${total}`);

  return ordered.map((t, i) => {
    total += delta(t);
    if (total > TOTAL_BUDGET_CENTS) throw new Error(`step ${i + 1} (${t.agent}) would bind ${total} cents, over the ${TOTAL_BUDGET_CENTS} total`);
    return { ...t, order: i + 1, totalAfterCents: total };
  });
}

export interface PriceOption {
  id: "A" | "B" | "C";
  label: string;
  sellCents: number | null;
  marginCents: number | null;
  /** Margin as a whole percent of the sell price. */
  marginPercent: number | null;
}

/** The options the treasury agent puts in front of the approver when the supplier raises its price. */
export function priceRiseOptions(sellCents: number, altSellCents: number, newUpstreamCents: number): PriceOption[] {
  const opt = (id: "A" | "B", label: string, sell: number): PriceOption => {
    const margin = sell - newUpstreamCents;
    return { id, label, sellCents: sell, marginCents: margin, marginPercent: Math.round((margin * 100) / sell) };
  };
  return [
    opt("A", "keep the price", sellCents),
    opt("B", "raise the price", altSellCents),
    { id: "C", label: "pause sales", sellCents: null, marginCents: null, marginPercent: null },
  ];
}
