// Spend holds (backend review B1). Before an agent signs a Metal payment or makes a card purchase, its amount is
// reserved here in one exclusive (IMMEDIATE) SQLite transaction that checks, together: the emergency stop and the
// agent's stop, the CFO policy's cap per payment, the mandate's cap per payment, the agent's mandate budget, the
// agents' shared total, the card's month and the velocity limits. Two payments racing for the last cents therefore
// cannot both pass: the second sees the first one's hold. (A card's limits are the issuer's to enforce: see below.) The runner, the agent API and the CLIs are separate
// processes on one ledger, so the lock is the database's, not a JavaScript one.
//
// Counting: what the ledger records as spent (paid, or sent and not yet final) plus every HELD hold. A hold becomes
// SETTLED once its payment is in the ledger (then the ledger counts it) or RELEASED when it did not happen. Between
// the ledger write and the settle a payment counts twice: never less than the truth, so never over a limit.

import { originJson } from "../provenance/origin.js";
import { audit } from "../audit/log.js";
import { TOTAL_BUDGET_CENTS, type Agent } from "../config/policy.js";
import type { DB } from "../db/open.js";
import { fromCents, toCents } from "../lib/money.js";
import { randomUUID } from "node:crypto";
import type { CardTransaction } from "../airwallex/issuing.js";
import { capRefusal, paused } from "./rules.js";
import { stopped, velocityGate } from "./velocity.js";
import { policyVersion } from "./versions.js";
import { authorize, type Payee } from "./principals.js";

export type HoldRail = "metal" | "card";
export interface SpendRequest { agent: Agent | `ext:${string}`; rail: HoldRail; cents: number; ref: string; now?: Date; payee?: Payee }

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
  // A ledger from before the holds, opened read-only by the dashboard, has none.
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'holds'").get()) return 0;
  const row = (agent
    ? db.prepare("SELECT SUM(cents) AS n FROM holds WHERE status = 'HELD' AND rail = ? AND agent = ?").get(rail, agent)
    : db.prepare("SELECT SUM(cents) AS n FROM holds WHERE status = 'HELD' AND rail = ?").get(rail)) as { n: number | null };
  return row.n ?? 0;
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
    // The agent's identity first (B5): revoked, expired, or not allowed this rail, currency or kind of payee.
    const denied = authorize(db, agent, { rail: r.rail, currency: r.rail === "metal" ? "USDZ" : "EUR", payee: r.payee }, now);
    if (denied) return denied;
    if (r.rail === "metal") {
      if (ours) {
        const refused = capRefusal(db, agent as Agent, r.cents);
        if (refused) return refused;
      }
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
    } else if (paused(db, agent)) {
      return `paused_by_cfo: the ${agent} agent is paused by the CFO; it buys nothing until the CFO resumes it with Face ID`;
    } else if (stopped(db, agent)) {
      // A card's limits sit on the card at Airwallex, which authorises each charge against them atomically: the
      // issuer, not this ledger, refuses a purchase over them (and the demo shows its decline). Here a card hold only
      // records the authorisation under way, so what is available counts it; a stopped agent charges nothing.
      return `stopped_by_velocity: the ${agent} agent was stopped automatically (velocity limit); it buys nothing until the CFO lifts the stop with Face ID`;
    }
    const ts = now.toISOString();
    // The policy version this reservation was checked against (backend review B4).
    const policy = policyVersion(db, now).version;
    if (existing) db.prepare("UPDATE holds SET agent = ?, rail = ?, cents = ?, status = 'HELD', reason = NULL, updated_at = ?, policy_version = ? WHERE ref = ?").run(agent, r.rail, r.cents, ts, policy, r.ref);
    else db.prepare("INSERT INTO holds (ref, agent, rail, cents, status, created_at, updated_at, policy_version, origin_json) VALUES (?, ?, ?, ?, 'HELD', ?, ?, ?, ?)").run(r.ref, agent, r.rail, r.cents, ts, ts, policy, originJson());
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
 * Charges an agent's card under a hold: reserved before the charge (refused while the agent is stopped), settled when
 * Airwallex approves, released when it declines. When the charge throws, the authorisation may exist or not, so the
 * hold stays and counts until the card's transactions show which (recoverHolds).
 */
export async function chargeUnderHold(db: DB, agent: string, cents: number, now: Date, charge: () => Promise<CardTransaction>): Promise<CardTransaction> {
  const ref = `card:${agent}:${now.toISOString()}:${randomUUID().slice(0, 8)}`;
  const refused = reserveSpend(db, { agent: agent as SpendRequest["agent"], rail: "card", cents, ref, now, payee: "merchants" });
  if (refused) throw new Error(refused.replace(/^[a-z_]+: /, ""));
  const t = await charge();
  if (t.approved) settleHold(db, ref, now);
  else releaseHold(db, ref, `declined by Airwallex${t.failureReason ? `: ${t.failureReason}` : ""}`, now);
  return t;
}

/**
 * On start, after a crash: a hold whose payment the ledger records is settled; one whose payment the ledger records
 * as refused is released; the rest stay held (and keep counting) until the reconciliation or a person resolves them.
 */
export function recoverHolds(db: DB, now = new Date()): { settled: number; released: number; open: number } {
  let settled = 0, released = 0, open = 0;
  const holds = db.prepare("SELECT ref, agent, rail, cents, created_at FROM holds WHERE status = 'HELD'").all() as { ref: string; agent: string; rail: HoldRail; cents: number; created_at: string }[];
  for (const h of holds) {
    if (h.rail === "card") {
      // A card authorisation is found by agent, amount and time: the charge's own id was never returned to us.
      const since = new Date(Date.parse(h.created_at) - 300_000).toISOString();
      const t = db.prepare("SELECT approved FROM card_transactions WHERE agent = ? AND amount_cents = ? AND occurred_at >= ? ORDER BY approved DESC LIMIT 1").get(h.agent, h.cents, since) as { approved: number } | undefined;
      if (t?.approved) { settleHold(db, h.ref, now); settled++; }
      else if (t) { releaseHold(db, h.ref, "declined (found on restart)", now); released++; }
      else open++;
      continue;
    }
    const row = (db.prepare("SELECT outcome FROM refunds WHERE payment_id = ?").get(h.ref) ?? db.prepare("SELECT outcome FROM sweeps WHERE payment_id = ?").get(h.ref)) as { outcome: string } | undefined;
    if (row && ["PAID", "PENDING", "HELD"].includes(row.outcome)) { settleHold(db, h.ref, now); settled++; }
    else if (row && row.outcome === "REFUSED") { releaseHold(db, h.ref, "refused (found on restart)", now); released++; }
    else open++;
  }
  if (holds.length) audit(db, "treasury", "holds.recovered", "holds", { settled, released, open }, now);
  return { settled, released, open };
}
