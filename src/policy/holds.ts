// Spend holds (backend review B1). Before an agent signs a Metal payment or makes a card purchase, its amount is
// reserved here in one exclusive (IMMEDIATE) SQLite transaction that checks, together: the emergency stop and the
// agent's stop, the CFO policy's cap per payment, the mandate's cap per payment, the agent's mandate budget, the
// agents' shared total, the card's month and the velocity limits. Two payments racing for the last cents therefore
// cannot both pass: the second sees the first one's hold. The runner, the agent API and the CLIs are separate
// processes on one ledger, so the lock is the database's, not a JavaScript one.
//
// Counting: what the ledger records as spent (paid, or sent and not yet final) plus every HELD hold. A hold becomes
// SETTLED once its payment is in the ledger (then the ledger counts it) or RELEASED when it did not happen. Between
// the ledger write and the settle a payment counts twice: never less than the truth, so never over a limit.

import { audit } from "../audit/log.js";
import { TOTAL_BUDGET_CENTS, type Agent } from "../config/policy.js";
import type { DB } from "../db/open.js";
import { fromCents, toCents } from "../lib/money.js";
import { capRefusal, cardLimits } from "./rules.js";
import { velocityGate } from "./velocity.js";

export type HoldRail = "metal" | "card";
export interface SpendRequest { agent: Agent | `ext:${string}`; rail: HoldRail; cents: number; ref: string; now?: Date }

const AGENTS: Agent[] = ["sourcing", "support", "treasury"];

/** What each agent's mandate allows (from the last bind or replace on chain) and what its ledger shows spent. */
export function spendLimits(db: DB, agent: string): { capCents: number | null; budgetCents: number | null; spentCents: number } {
  const last = db.prepare("SELECT payload_json FROM audit_log WHERE event IN ('mandate.bound', 'mandate.replaced') AND subject = ? ORDER BY seq DESC LIMIT 1").get(agent) as { payload_json: string } | undefined;
  const m = last ? (JSON.parse(last.payload_json) as { cap?: unknown; budget?: unknown }) : {};
  const cents = (v: unknown) => (typeof v === "string" && /^\d+(\.\d{1,2})?$/.test(v) ? toCents(v) : null);
  return { capCents: cents(m.cap), budgetCents: cents(m.budget), spentCents: ledgerSpent(db, agent) };
}

/** What the ledger records as gone or on its way: paid, plus pulls sent or held on chain (they may still settle). */
export function ledgerSpent(db: DB, agent: string): number {
  const n = (sql: string) => (db.prepare(sql).get() as { n: number | null }).n ?? 0;
  if (agent === "sourcing") return n("SELECT SUM(price_cents) AS n FROM upstream_purchases WHERE outcome = 'PAID'");
  if (agent === "support") return n("SELECT SUM(amount_cents) AS n FROM refunds WHERE outcome IN ('PAID', 'PENDING', 'HELD')");
  if (agent === "treasury") return n("SELECT SUM(amount_cents) AS n FROM sweeps WHERE outcome IN ('PAID', 'PENDING', 'HELD')");
  return 0;
}

/** The open holds' total, for one agent or all, on one rail (Metal by default). */
export function heldCents(db: DB, agent?: string, rail: HoldRail = "metal"): number {
  const row = (agent
    ? db.prepare("SELECT SUM(cents) AS n FROM holds WHERE status = 'HELD' AND rail = ? AND agent = ?").get(rail, agent)
    : db.prepare("SELECT SUM(cents) AS n FROM holds WHERE status = 'HELD' AND rail = ?").get(rail)) as { n: number | null };
  return row.n ?? 0;
}

/** Card spend this calendar month (UTC), approved by Airwallex, for one agent. */
function cardMonthCents(db: DB, agent: string, now: Date): number {
  const month = now.toISOString().slice(0, 7);
  return (db.prepare("SELECT SUM(amount_cents) AS n FROM card_transactions WHERE agent = ? AND approved = 1 AND substr(occurred_at, 1, 7) = ?").get(agent, month) as { n: number | null }).n ?? 0;
}

/**
 * Reserves a payment's amount, or says why not. Null means reserved: the caller may sign or charge, and must then
 * settle the hold (the payment is in its ledger) or release it (it did not happen). The same ref twice is the same
 * payment: reserved once.
 */
export function reserveSpend(db: DB, r: SpendRequest): string | null {
  const now = r.now ?? new Date();
  if (!Number.isInteger(r.cents) || r.cents <= 0) return `invalid_amount: ${r.cents}`;
  return db.transaction((): string | null => {
    const existing = db.prepare("SELECT status, agent, cents FROM holds WHERE ref = ?").get(r.ref) as { status: string; agent: string; cents: number } | undefined;
    if (existing && existing.status !== "RELEASED") {
      return existing.agent === r.agent && existing.cents === r.cents ? null : `hold_conflict: ${r.ref} is held for another payment`;
    }
    const agent = r.agent;
    const ours = (AGENTS as string[]).includes(agent);
    if (ours) {
      const refused = capRefusal(db, agent as Agent, r.cents);
      if (refused) return refused;
    }
    if (r.rail === "metal") {
      const l = spendLimits(db, agent);
      if (l.capCents !== null && r.cents > l.capCents) return `mandate_cap_exceeded: ${fromCents(r.cents)} is over the ${agent} mandate's ${fromCents(l.capCents)} a payment`;
      const used = l.spentCents + heldCents(db, agent);
      if (l.budgetCents !== null && used + r.cents > l.budgetCents) {
        return `budget_exceeded: the ${agent} mandate has ${fromCents(Math.max(0, l.budgetCents - used))} of ${fromCents(l.budgetCents)} left (spent and held), not ${fromCents(r.cents)}`;
      }
      const total = AGENTS.reduce((s, a) => s + ledgerSpent(db, a), 0) + heldCents(db);
      if (total + r.cents > TOTAL_BUDGET_CENTS) {
        return `total_budget_exceeded: the agents together have ${fromCents(Math.max(0, TOTAL_BUDGET_CENTS - total))} of ${fromCents(TOTAL_BUDGET_CENTS)} left (spent and held), not ${fromCents(r.cents)}`;
      }
      // The velocity limits count this payment now, under its ref (a retry is counted once).
      if (ours) {
        const fast = velocityGate(db, agent, "metal", r.cents, now, r.ref);
        if (fast) return fast;
      }
    } else if (ours) {
      const card = cardLimits(db, agent);
      if (card.perTxCents > 0 && r.cents > card.perTxCents) return `card_limit_exceeded: ${fromCents(r.cents)} is over the card's ${fromCents(card.perTxCents)} a purchase`;
      const month = cardMonthCents(db, agent, now) + heldCents(db, agent, "card");
      if (card.monthlyCents > 0 && month + r.cents > card.monthlyCents) {
        return `card_month_exceeded: the card has ${fromCents(Math.max(0, card.monthlyCents - month))} of ${fromCents(card.monthlyCents)} left this month (spent and held), not ${fromCents(r.cents)}`;
      }
    }
    const ts = now.toISOString();
    if (existing) db.prepare("UPDATE holds SET agent = ?, rail = ?, cents = ?, status = 'HELD', reason = NULL, updated_at = ? WHERE ref = ?").run(agent, r.rail, r.cents, ts, r.ref);
    else db.prepare("INSERT INTO holds (ref, agent, rail, cents, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'HELD', ?, ?)").run(r.ref, agent, r.rail, r.cents, ts, ts);
    return null;
  }).immediate();
}

/** The payment is in its ledger now; the ledger counts it from here. */
export function settleHold(db: DB, ref: string, now = new Date()): void {
  db.prepare("UPDATE holds SET status = 'SETTLED', updated_at = ? WHERE ref = ? AND status = 'HELD'").run(now.toISOString(), ref);
}

/** The payment did not happen (refused, declined, never sent): its amount is free again. */
export function releaseHold(db: DB, ref: string, reason: string, now = new Date()): void {
  db.prepare("UPDATE holds SET status = 'RELEASED', reason = ?, updated_at = ? WHERE ref = ? AND status = 'HELD'").run(reason.slice(0, 300), now.toISOString(), ref);
}

/**
 * On start, after a crash: a hold whose payment the ledger records is settled; one whose payment the ledger records
 * as refused is released; the rest stay held (and keep counting) until the reconciliation or a person resolves them.
 */
export function recoverHolds(db: DB, now = new Date()): { settled: number; released: number; open: number } {
  let settled = 0, released = 0, open = 0;
  const holds = db.prepare("SELECT ref FROM holds WHERE status = 'HELD'").all() as { ref: string }[];
  for (const { ref } of holds) {
    const row = (db.prepare("SELECT outcome FROM refunds WHERE payment_id = ?").get(ref) ?? db.prepare("SELECT outcome FROM sweeps WHERE payment_id = ?").get(ref)) as { outcome: string } | undefined;
    if (row && ["PAID", "PENDING", "HELD"].includes(row.outcome)) { settleHold(db, ref, now); settled++; }
    else if (row && row.outcome === "REFUSED") { releaseHold(db, ref, "refused (found on restart)", now); released++; }
    else open++;
  }
  if (holds.length) audit(db, "treasury", "holds.recovered", "holds", { settled, released, open }, now);
  return { settled, released, open };
}
