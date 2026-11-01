// The receivables agent (awards item 5): retailers pay Northwind into its Airwallex Global Accounts (EUR by SEPA, GBP
// by Faster Payments). Each payment is matched to an open invoice by the invoice number in its reference, written any
// way (src/agents/euroBill.ts invoiceKey), and recorded once per Airwallex deposit id. A payment that does not settle
// its invoice exactly (short, over, in another currency, or with no invoice at all) is escalated to the CFO with the
// difference in words. Nothing here moves money: a refund of an overpayment is a separate decision for the CFO.

import { autonomyOn } from "../config/agents.js";
import { publish } from "../autonomy/bus.js";
import { audit } from "../audit/log.js";
import type { DB } from "../db/open.js";
import { fromCents } from "../lib/money.js";
import { invoiceKey } from "./euroBill.js";

export type ReceiptOutcome = "MATCHED" | "SHORT" | "OVER" | "WRONG_CURRENCY" | "UNMATCHED";

export interface Receivable { invoice_no: string; customer: string; currency: string; amount_cents: number; due_date: string }
export interface Deposit { deposit_id: string; global_account_id: string | null; currency: string; amount_cents: number; reference: string | null; payer: string | null; received_at: string }

type Row = { invoice_no: string; customer: string; currency: string; amount_cents: number; paid_cents: number; status: string };

export function openReceivable(db: DB, r: Receivable, now = new Date()): void {
  db.prepare("INSERT OR IGNORE INTO receivables (invoice_no, customer, currency, amount_cents, due_date, status, issued_at) VALUES (?, ?, ?, ?, ?, 'OPEN', ?)")
    .run(r.invoice_no, r.customer, r.currency, r.amount_cents, r.due_date, now.toISOString());
}

/** The invoice a reference names: the longest invoice number found in it, compared the way duplicates are. */
function invoiceIn(db: DB, reference: string | null): Row | undefined {
  if (!reference) return undefined;
  const ref = invoiceKey(reference);
  return (db.prepare("SELECT invoice_no, customer, currency, amount_cents, paid_cents, status FROM receivables").all() as Row[])
    .filter((r) => ref.includes(invoiceKey(r.invoice_no)))
    .sort((a, b) => b.invoice_no.length - a.invoice_no.length)[0];
}

/** Matches one Airwallex deposit; a deposit already recorded returns its stored result and changes nothing. */
export function matchReceipt(db: DB, d: Deposit, now = new Date(), via: "webhook" | "poll" = "poll"): { outcome: ReceiptOutcome; invoice_no: string | null; detail: string } {
  return db.transaction(() => {
    const seen = db.prepare("SELECT outcome, invoice_no, detail FROM receipts WHERE deposit_id = ?").get(d.deposit_id) as { outcome: ReceiptOutcome; invoice_no: string | null; detail: string } | undefined;
    if (seen) return seen;
    const inv = invoiceIn(db, d.reference);
    const money = (c: number, cur: string) => `${fromCents(c)} ${cur}`;
    let outcome: ReceiptOutcome, detail: string, applied = 0;
    if (!inv) {
      outcome = "UNMATCHED";
      detail = `${money(d.amount_cents, d.currency)} from ${d.payer ?? "an unknown payer"} names no open invoice ("${(d.reference ?? "").slice(0, 60)}"): held in suspense until the CFO identifies it`;
    } else if (inv.currency !== d.currency) {
      outcome = "WRONG_CURRENCY";
      detail = `${money(d.amount_cents, d.currency)} for ${inv.invoice_no}, invoiced in ${inv.currency}: held in suspense; the CFO decides whether to accept or return it`;
    } else {
      const due = inv.amount_cents - inv.paid_cents;
      applied = Math.min(due, d.amount_cents);
      const paid = inv.paid_cents + applied;
      outcome = d.amount_cents === due ? "MATCHED" : d.amount_cents < due ? "SHORT" : "OVER";
      detail = outcome === "MATCHED" ? `${inv.invoice_no} from ${inv.customer} paid in full, ${money(d.amount_cents, d.currency)}`
        : outcome === "SHORT" ? `${inv.invoice_no} from ${inv.customer}: paid ${money(d.amount_cents, d.currency)}, short by ${money(due - d.amount_cents, d.currency)}; the rest stays open and the customer is asked`
        : `${inv.invoice_no} from ${inv.customer}: paid ${money(d.amount_cents, d.currency)}, over by ${money(d.amount_cents - due, d.currency)}; the excess waits in suspense and a refund is the CFO's decision`;
      db.prepare("UPDATE receivables SET paid_cents = ?, status = ? WHERE invoice_no = ?")
        .run(paid, outcome === "OVER" ? "OVERPAID" : paid >= inv.amount_cents ? "PAID" : "PARTIAL", inv.invoice_no);
    }
    db.prepare("INSERT INTO receipts (deposit_id, global_account_id, currency, amount_cents, reference, payer, invoice_no, applied_cents, outcome, detail, received_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(d.deposit_id, d.global_account_id, d.currency, d.amount_cents, d.reference, d.payer, outcome === "UNMATCHED" || outcome === "WRONG_CURRENCY" ? null : inv!.invoice_no, applied, outcome, detail, d.received_at);
    audit(db, "treasury", outcome === "MATCHED" ? "receivable.matched" : "receivable.escalated", d.deposit_id, { origin: { actor: "external", party: "retailer", ...(inv?.customer ? { name: inv.customer } : {}) }, outcome, invoice_no: inv?.invoice_no ?? null, amount: fromCents(d.amount_cents), currency: d.currency, detail }, now);
    // D22: money in at Airwallex is news for the Treasury agent (autonomy only), once per deposit.
    if (autonomyOn()) {
      publish(db, "money.in", {
        rail: "airwallex", via: via === "webhook" ? "Airwallex webhook" : "Airwallex poll", deposit_id: d.deposit_id, amount: fromCents(d.amount_cents), currency: d.currency,
        payer: d.payer, outcome, invoice_no: outcome === "UNMATCHED" || outcome === "WRONG_CURRENCY" ? null : inv!.invoice_no, detail,
      }, "treasury", "system", now);
    }
    return { outcome, invoice_no: inv?.invoice_no ?? null, detail };
  })();
}

export interface ReceivablesView {
  open: { invoice_no: string; customer: string; currency: string; amount: string; paid: string; status: string }[];
  receipts: { deposit_id: string; currency: string; amount: string; reference: string; invoice_no: string | null; outcome: ReceiptOutcome; detail: string; received_at: string }[];
  escalated: number;
}

export function receivablesView(db: DB): ReceivablesView {
  const has = !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'receipts'").get();
  if (!has) return { open: [], receipts: [], escalated: 0 };
  const receipts = (db.prepare("SELECT deposit_id, currency, amount_cents, reference, invoice_no, outcome, detail, received_at FROM receipts ORDER BY received_at DESC").all() as
    { deposit_id: string; currency: string; amount_cents: number; reference: string | null; invoice_no: string | null; outcome: ReceiptOutcome; detail: string; received_at: string }[])
    .map((r) => ({ ...r, amount: fromCents(r.amount_cents), reference: r.reference ?? "" }));
  return {
    open: (db.prepare("SELECT invoice_no, customer, currency, amount_cents, paid_cents, status FROM receivables WHERE status IN ('OPEN', 'PARTIAL') ORDER BY invoice_no").all() as Row[])
      .map((r) => ({ invoice_no: r.invoice_no, customer: r.customer, currency: r.currency, amount: fromCents(r.amount_cents), paid: fromCents(r.paid_cents), status: r.status })),
    receipts: receipts.map(({ amount_cents: _, ...r }) => r),
    escalated: receipts.filter((r) => r.outcome !== "MATCHED").length,
  };
}
