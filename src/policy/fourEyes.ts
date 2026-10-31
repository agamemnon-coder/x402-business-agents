// E1, four eyes: which proposals need the Face ID of two different people. Set by the CFO policy
// (approval.four_eyes_eur); off until the CFO sets it. Above the threshold: an invoice payment, and an outside
// agent's card whose monthly limit is above it; at any amount, a supplier's new bank details and a change of the
// agents' on-chain mandates (Kit 11's rebalance within the 20.00 total).

import type { DB } from "../db/open.js";
import { toCents } from "../lib/money.js";
import type { ProposalRow } from "./approvals.js";
import { policyValue } from "./rules.js";

export const FOUR_EYES_KEY = "approval.four_eyes_eur";

export function fourEyes(db: DB, p: Pick<ProposalRow, "kind" | "terms_json">): boolean {
  const v = policyValue(db, FOUR_EYES_KEY);
  if (v === "") return false;
  const threshold = toCents(v);
  const t = JSON.parse(p.terms_json) as { amount?: string; card?: { monthly?: string } };
  const over = (s: string | undefined) => (s !== undefined && /^\d+\.\d{2}$/.test(s) ? toCents(s) > threshold : false);
  if (p.kind === "invoice_payment") return over(t.amount);
  if (p.kind === "agent_onboard") return over(t.card?.monthly);
  if (p.kind === "task_card") return over(t.amount);
  // 4.2 Resuming a paused agent binds a mandate again: a change of its mandate, so two people. Pausing only takes away.
  if (p.kind === "policy_change") return ((JSON.parse(p.terms_json) as { changes?: { key: string; from: string; to: string }[] }).changes ?? []).some((c) => c.key.startsWith("pause.") && c.from === "on" && c.to !== "on");
  return p.kind === "payee_change" || p.kind === "mandate_replace";
}
