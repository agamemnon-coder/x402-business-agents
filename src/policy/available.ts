// What is available, the same way everywhere (backend review B3): available = limit or balance − held − pending.
//   held:    holds reserved for a payment being made now (src/policy/holds.ts);
//   pending: money that has left or is leaving but is not final (a pull sent or held on chain, a card authorisation
//            under way, a euro payout written but not yet at Airwallex).
// The dashboard, the agents, the sweep, the euro bill and the agent API read these functions, so a screen never shows
// more than a payment could use.

import type { DB } from "../db/open.js";
import { toCents } from "../lib/money.js";
import { cardLimits } from "./rules.js";
import { heldCents, spendLimits } from "./holds.js";

export interface MandateAvailability {
  budgetCents: number | null;
  /** Paid and final. */
  paidCents: number;
  /** Sent, not final: a refund or sweep pending or held on chain. */
  pendingCents: number;
  /** Reserved for a payment being made now. */
  heldCents: number;
  /** budget − paid − pending − held; null when no mandate is bound. */
  availableCents: number | null;
}

const sum = (db: DB, sql: string): number => (db.prepare(sql).get() as { n: number | null }).n ?? 0;
const hasTable = (db: DB, name: string): boolean => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);

/**
 * What Summit's buying mandate paid: its sales on the mandate route (scheme 'exact'). A clearing sale ('bajillion') is
 * paid from Summit's clearing deposit, not under the mandate, so Metal's mandate does not count it and neither does this.
 */
/**
 * A settlement whose sale is recorded counts once, as the sale: also when its row could not be closed as DONE (that
 * write comes after the sale's own transaction, so it never undoes a sale), and when it was found CHARGED while the
 * sale's row was being committed (review of 2 November).
 */
const NO_SALE = "NOT EXISTS (SELECT 1 FROM sales x WHERE x.status = 'DELIVERED' AND lower(x.settlement_id) LIKE '%:' || s.nonce)";

const hasScheme = new WeakMap<DB, boolean>();
const customerSales = (db: DB): string => {
  // A ledger from before clearing (opened read-only, so not migrated) has no scheme column: every sale was 'exact'.
  let scheme = hasScheme.get(db);
  if (scheme === undefined) {
    scheme = (db.prepare("PRAGMA table_info(sales)").all() as { name: string }[]).some((c) => c.name === "scheme");
    hasScheme.set(db, scheme);
  }
  return `FROM sales WHERE status = 'DELIVERED'${scheme ? " AND scheme = 'exact'" : ""}`;
};

/**
 * One agent's Metal mandate: what its budget still allows. The one source for what a mandate paid: the dashboard, the
 * recorded Metal page and the check against the chain (src/metal/dashboardVsChain.ts) all read it here.
 */
export function mandateAvailability(db: DB, agent: string): MandateAvailability {
  const { budgetCents } = spendLimits(db, agent);
  let paid = 0;
  let pending = 0;
  if (agent === "sourcing") paid = sum(db, "SELECT SUM(price_cents) AS n FROM upstream_purchases WHERE outcome = 'PAID'");
  else if (agent === "support") {
    paid = sum(db, "SELECT SUM(amount_cents) AS n FROM refunds WHERE outcome = 'PAID'");
    pending = sum(db, "SELECT SUM(amount_cents) AS n FROM refunds WHERE outcome IN ('PENDING', 'HELD')");
  } else if (agent === "treasury") {
    paid = sum(db, "SELECT SUM(amount_cents) AS n FROM sweeps WHERE outcome = 'PAID'");
    pending = sum(db, "SELECT SUM(amount_cents) AS n FROM sweeps WHERE outcome IN ('PENDING', 'HELD')");
  } else if (agent === "customer") {
    paid = sum(db, `SELECT SUM(price_cents) AS n ${customerSales(db)}`);
    if (hasTable(db, "sale_settlements")) {
      // Charged with no sale behind it (found by the reconciliation): Metal counts it under the mandate, so does this.
      paid += sum(db, `SELECT SUM(price_cents) AS n FROM sale_settlements s WHERE s.status = 'CHARGED' AND ${NO_SALE}`);
      // Sent to Metal's facilitator, its sale not yet recorded (src/seller/settling.ts): the chain may count it already.
      pending = sum(db, `SELECT SUM(price_cents) AS n FROM sale_settlements s WHERE s.status = 'SETTLING' AND ${NO_SALE}`);
    }
  }
  const held = heldCents(db, agent);
  return { budgetCents, paidCents: paid, pendingCents: pending, heldCents: held, availableCents: budgetCents === null ? null : budgetCents - paid - pending - held };
}

/** A payment under a mandate as the ledger has it, for naming the one that explains a difference with the chain. */
export interface LedgerPayment {
  /** In words: "sale 33", "purchase 6", "refund-6", "sweep-20261102-1", "the hold upstream:3:…". */
  what: string;
  cents: number;
  tx: string | null;
  /** The ERC-3009 nonce, when the ledger knows it (sales, purchases, settlements under way). */
  nonce: string | null;
  /**
   * paid: counted as spent. pending: sent, not final (counted as pending). held: reserved for a payment being made now.
   * in_doubt: sent, its outcome unknown (its hold counts). failed: the ledger says nothing moved.
   */
  state: "paid" | "pending" | "held" | "in_doubt" | "failed";
  /** Why it is in that state, when the ledger says. */
  detail?: string;
  /** Since when it has been on its way (a sale being settled, a hold), for telling one under way from one left behind. */
  since?: string;
}

const lower = (s: unknown): string | null => (typeof s === "string" && s ? s.toLowerCase() : null);
const nonceOf = (settlementId: unknown): string | null => {
  const last = typeof settlementId === "string" ? settlementId.split(":").at(-1) ?? "" : "";
  return /^0x[0-9a-fA-F]{64}$/.test(last) ? last.toLowerCase() : null;
};

/** Every payment the ledger has under an agent's mandates, paid or on its way, from the same tables as mandateAvailability. */
export function mandatePayments(db: DB, agent: string): LedgerPayment[] {
  type R = Record<string, unknown>;
  const rows = (sql: string): R[] => db.prepare(sql).all() as R[];
  const out: LedgerPayment[] = [];
  if (agent === "sourcing") {
    for (const r of rows("SELECT id, price_cents, tx_hash, nonce, outcome FROM upstream_purchases WHERE outcome IN ('PAID', 'IN_DOUBT') ORDER BY id")) {
      out.push({ what: `purchase ${String(r.id)}`, cents: Number(r.price_cents), tx: lower(r.tx_hash), nonce: lower(r.nonce), state: r.outcome === "PAID" ? "paid" : "in_doubt" });
    }
  } else if (agent === "support") {
    for (const r of rows("SELECT payment_id, sale_id, amount_cents, tx_hash, outcome FROM refunds WHERE outcome IN ('PAID', 'PENDING', 'HELD') ORDER BY refund_id")) {
      out.push({ what: `${String(r.payment_id)} (refund of sale ${String(r.sale_id)})`, cents: Number(r.amount_cents), tx: lower(r.tx_hash), nonce: null, state: r.outcome === "PAID" ? "paid" : "pending" });
    }
  } else if (agent === "treasury") {
    for (const r of rows("SELECT payment_id, amount_cents, tx_hash, outcome FROM sweeps WHERE outcome IN ('PAID', 'PENDING', 'HELD') ORDER BY created_at")) {
      out.push({ what: String(r.payment_id), cents: Number(r.amount_cents), tx: lower(r.tx_hash), nonce: null, state: r.outcome === "PAID" ? "paid" : "pending" });
    }
  } else if (agent === "customer") {
    for (const r of rows(`SELECT sale_id, price_cents, tx_hash, settlement_id ${customerSales(db)} ORDER BY sale_id`)) {
      out.push({ what: `sale ${String(r.sale_id)}`, cents: Number(r.price_cents), tx: lower(r.tx_hash), nonce: nonceOf(r.settlement_id), state: "paid" });
    }
    if (hasTable(db, "sale_settlements")) {
      for (const r of rows(`SELECT key, nonce, price_cents, status, tx_hash, detail, started_at FROM sale_settlements s
                            WHERE (s.status IN ('SETTLING', 'CHARGED') AND ${NO_SALE}) OR s.status = 'FAILED' ORDER BY started_at`)) {
        const by = String(r.key).split(":")[0]!.slice(0, 10);
        if (r.status === "CHARGED") {
          out.push({ what: `a payment by ${by}… charged with no delivery recorded`, cents: Number(r.price_cents), tx: lower(r.tx_hash), nonce: lower(r.nonce), state: "paid", detail: typeof r.detail === "string" ? r.detail : undefined });
          continue;
        }
        out.push({ what: `a sale being settled (paid by ${by}…)`, cents: Number(r.price_cents), tx: null, nonce: lower(r.nonce), state: r.status === "SETTLING" ? "pending" : "failed", detail: typeof r.detail === "string" ? r.detail : undefined, since: String(r.started_at) });
      }
    }
  }
  if (hasTable(db, "holds")) {
    for (const r of db.prepare("SELECT ref, cents, created_at FROM holds WHERE status = 'HELD' AND rail = 'metal' AND agent = ? ORDER BY created_at").all(agent) as R[]) {
      out.push({ what: `the hold ${String(r.ref)}`, cents: Number(r.cents), tx: null, nonce: null, state: "held", since: String(r.created_at) });
    }
  }
  return out;
}

export interface CardAvailability {
  monthlyCents: number;
  /** Approved by Airwallex this calendar month (UTC). */
  spentCents: number;
  /** Authorisations under way (card holds). */
  heldCents: number;
  /** monthly − spent − held. */
  availableCents: number;
}

/** One card's month: what is left of its monthly limit. Airwallex enforces the limit; this shows it. */
export function cardAvailability(db: DB, agent: string, now = new Date()): CardAvailability {
  const { monthlyCents } = cardLimits(db, agent);
  const month = now.toISOString().slice(0, 7);
  const spent = (db.prepare("SELECT COALESCE(SUM(amount_cents), 0) AS n FROM card_transactions WHERE agent = ? AND approved = 1 AND substr(occurred_at, 1, 7) = ?").get(agent, month) as { n: number }).n;
  const held = heldCents(db, agent, "card");
  return { monthlyCents, spentCents: spent, heldCents: held, availableCents: monthlyCents - spent - held };
}

/**
 * Euro payouts written but not yet at Airwallex (SUBMITTING): Airwallex's available balance does not show them
 * yet, so they are subtracted here. One payout can be left out (the one being checked).
 */
export function eurInFlightCents(db: DB, exceptRequestId?: string): number {
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'transfers'").get()) return 0;
  const rows = db.prepare("SELECT amount, fee_estimate FROM transfers WHERE status = 'SUBMITTING' AND currency = 'EUR' AND request_id <> ?").all(exceptRequestId ?? "") as { amount: string; fee_estimate: string }[];
  return rows.reduce((s, r) => s + toCents(r.amount) + toCents(r.fee_estimate), 0);
}
