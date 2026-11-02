// The Treasury agent's facts about invoices, read from the ledger at every wake (review, 2 November: at 14:40 the agent
// still called the licence "unpaid" ten minutes after it was paid, because its facts showed refused payouts and nothing
// said an invoice IS paid). An invoice is paid when the ledger holds a PAID payout for it, or its payment proposal was
// executed; it is open when it came in (a world event, or a planned invoice) and is neither paid nor being paid. For
// each open invoice the facts say what code's own rules say about planning it now: the same duplicate guard
// proposeInvoicePayment applies (invoiceAlreadyHandled), and the money at the last balance reading, which code reads
// again when it plans. Facts only: the agent decides, code checks, the CFO approves with Face ID.

import { invoiceAlreadyHandled, invoiceKey, measuredSwiftFeesCents, treasuryState } from "../agents/euroBill.js";
import { parseInvoiceFallback } from "../agents/invoice.js";
import type { DB } from "../db/open.js";
import { fromCents, toCents } from "../lib/money.js";
import { feeReserveCents, feeReserveOverCap, planInvoice } from "../policy/treasury.js";

export interface PaidInvoice { invoice_no: string; amount: string; currency: string; paid_at: string; transfer_id: string | null; proposal_id: string | null }
export interface OpenInvoice {
  invoice_no: string;
  vendor: string;
  amount: string;
  currency: string;
  due_date: string;
  /** Code's duplicate guard on this invoice now (a plan waits, a payout runs), or null: nothing stops a new plan. */
  handled: string | null;
  /** The latest payment proposal for it that is over (expired, rejected…), in words, as a fact. */
  lastPlan: { proposal_id: string; status: string; at: string } | null;
}
export interface InvoiceFacts { paid: PaidInvoice[]; inFlight: { invoice_no: string; status: string }[]; open: OpenInvoice[]; lines: string[] }

const has = (db: DB, table: string) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
const hhmm = (iso: string) => `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;

type Received = { invoice_no: string; vendor: string; amount: string; currency: string; due_date: string };

// An invoice's own words reach the facts only in shapes code can vouch for (the facts are the agent's situation, not
// news): a short invoice number, a plain vendor name, an amount and an ISO date. Anything else is left out.
const NO = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,39}$/;
const VENDOR = /^[\p{L}\p{N} .,&'()-]{1,60}$/u;
const vouched = (r: Received): Received | null =>
  NO.test(r.invoice_no) && /^\d+\.\d{2}$/.test(r.amount) && /^\d{4}-\d{2}-\d{2}$/.test(r.due_date) && /^[A-Z]{3}$/.test(r.currency)
    ? { ...r, vendor: VENDOR.test(r.vendor) ? r.vendor : "a vendor whose name code does not repeat" }
    : null;

/** Every invoice that came in: the ones planned (the invoices table) and the ones the world sent the Treasury agent. */
function received(db: DB): Received[] {
  const out = new Map<string, Received>();
  if (has(db, "invoices")) {
    for (const r of db.prepare("SELECT invoice_no, vendor, amount, currency, due_date FROM invoices ORDER BY rowid").all() as Received[]) out.set(invoiceKey(r.invoice_no), r);
  }
  if (has(db, "world_events")) {
    const rows = db.prepare("SELECT payload_json FROM world_events WHERE kind = 'invoice.received' AND (for_agent = 'treasury' OR for_agent IS NULL) ORDER BY id").all() as { payload_json: string }[];
    for (const r of rows) {
      let text: unknown;
      try { text = (JSON.parse(r.payload_json) as { text?: unknown }).text; } catch { continue; }
      if (typeof text !== "string") continue;
      try {
        const inv = parseInvoiceFallback(text);
        const key = invoiceKey(inv.invoice_no);
        if (!out.has(key)) out.set(key, { invoice_no: inv.invoice_no, vendor: inv.vendor, amount: inv.amount, currency: inv.currency, due_date: inv.due_date });
      } catch { /* an invoice code cannot read whole is not listed as a fact; planning it escalates to a person */ }
    }
  }
  return [...out.values()].flatMap((r) => { const v = vouched(r); return v ? [v] : []; });
}

/** Paid invoices: a PAID payout, else an executed payment proposal (newest first). */
function paidInvoices(db: DB): PaidInvoice[] {
  const out = new Map<string, PaidInvoice>();
  if (has(db, "transfers")) {
    const rows = db.prepare(`SELECT t.invoice_no, t.amount, t.currency, t.transfer_id, t.updated_at, p.proposal_id FROM transfers t
      LEFT JOIN proposals p ON p.terms_sha256 = t.approval_sha256 WHERE t.status = 'PAID' ORDER BY t.updated_at DESC`).all() as
      { invoice_no: string; amount: string; currency: string; transfer_id: string | null; updated_at: string; proposal_id: string | null }[];
    for (const r of rows) {
      const key = invoiceKey(r.invoice_no);
      if (!out.has(key)) out.set(key, { invoice_no: r.invoice_no, amount: r.amount, currency: r.currency, paid_at: r.updated_at, transfer_id: r.transfer_id, proposal_id: r.proposal_id });
    }
  }
  if (has(db, "proposals")) {
    const rows = db.prepare(`SELECT p.proposal_id, json_extract(p.terms_json, '$.invoice_no') AS invoice_no, json_extract(p.terms_json, '$.amount') AS amount,
      json_extract(p.terms_json, '$.currency') AS currency, COALESCE((SELECT MAX(a.ts) FROM audit_log a WHERE a.event = 'proposal.executed' AND a.subject = p.proposal_id), p.created_at) AS at
      FROM proposals p WHERE p.kind = 'invoice_payment' AND p.status = 'EXECUTED' ORDER BY at DESC`).all() as
      { proposal_id: string; invoice_no: string | null; amount: string | null; currency: string | null; at: string }[];
    for (const r of rows) {
      if (!r.invoice_no) continue;
      const key = invoiceKey(r.invoice_no);
      if (!out.has(key)) out.set(key, { invoice_no: r.invoice_no, amount: r.amount ?? "?", currency: r.currency ?? "EUR", paid_at: r.at, transfer_id: null, proposal_id: r.proposal_id });
    }
  }
  return [...out.values()].sort((a, b) => b.paid_at.localeCompare(a.paid_at));
}

/** What the last balance reading says about the money for an invoice, in code's own planning terms (ok: code's plan
 *  would put it to the CFO; not ok: code's plan would stop and go to a person). Code reads the balances again to plan. */
function moneyFor(db: DB, amount: string): { ok: boolean; text: string } {
  const unread = { ok: true, text: "no balance reading yet; code reads the balances when it plans" };
  if (!has(db, "balance_snapshots")) return unread;
  const snap = db.prepare("SELECT taken_at, json FROM balance_snapshots ORDER BY id DESC LIMIT 1").get() as { taken_at: string; json: string } | undefined;
  if (!snap) return unread;
  try {
    const s = treasuryState(db, JSON.parse(snap.json) as Parameters<typeof treasuryState>[1]);
    const fees = measuredSwiftFeesCents(db);
    if (feeReserveOverCap(fees)) return { ok: false, text: "a SWIFT fee on record is far above the usual: code's plan would go to a person first" };
    const reserve = feeReserveCents(fees);
    const p = planInvoice(toCents(amount), s, reserve);
    const at = `at the last balance reading (${hhmm(snap.taken_at)})`;
    if (p.kind === "pay_from_eur") return { ok: true, text: `${at} the free EUR (${fromCents(p.freeEurCents)} above the floor and commitments) covers it and the SWIFT fee reserve of ${fromCents(reserve)}` };
    if (p.kind === "convert_shortfall") return { ok: true, text: `${at} the free EUR is ${fromCents(Math.max(0, p.freeEurCents))}: code would convert EUR ${fromCents(p.buyEurCents)} from USD on a locked quote, only if USD stays above its floor (USD available ${fromCents(s.usdAvailableCents)}, floor ${fromCents(s.usdFloorCents)})` };
    return { ok: false, text: `${at} EUR is ${fromCents(-p.freeEurCents)} below its floor plus commitments: code's plan would go to a person instead` };
  } catch {
    return { ok: true, text: "the last balance reading could not be read; code reads the balances when it plans" };
  }
}

/**
 * The invoice facts. `plans` is the invoice number plan_invoice plans (the licence, live), so the facts never say a
 * tool plans an invoice it does not.
 */
export function invoiceFacts(db: DB, now = new Date(), plans: string | null = null): InvoiceFacts {
  const paid = paidInvoices(db);
  const paidKeys = new Set(paid.map((p) => invoiceKey(p.invoice_no)));
  const inFlight = has(db, "transfers")
    ? (db.prepare("SELECT invoice_no, status FROM transfers WHERE status NOT IN ('PAID', 'CANCELLED')").all() as { invoice_no: string; status: string }[]).filter((t) => !paidKeys.has(invoiceKey(t.invoice_no)))
    : [];
  const flightKeys = new Set(inFlight.map((t) => invoiceKey(t.invoice_no)));
  // The latest plan for an invoice that is over: expired (a waiting one past its time counts, as code's guard counts
  // it), rejected, superseded, failed or needing a new approval; "unsigned" only when no approval was recorded.
  const lastPlanOf = (no: string) => {
    if (!has(db, "proposals")) return null;
    const r = (db.prepare(`SELECT p.proposal_id, p.status, p.expires_at, p.created_at, json_extract(p.terms_json, '$.invoice_no') AS invoice_no,
        EXISTS (SELECT 1 FROM approvals a WHERE a.proposal_id = p.proposal_id AND a.decision = 'APPROVED') AS approved FROM proposals p WHERE p.kind = 'invoice_payment'
        AND (p.status IN ('EXPIRED', 'REJECTED', 'SUPERSEDED', 'FAILED', 'NEEDS_REAPPROVAL') OR (p.status = 'PENDING_APPROVAL' AND p.expires_at <= ?)) ORDER BY p.created_at DESC`)
      .all(now.toISOString()) as { proposal_id: string; status: string; expires_at: string; created_at: string; invoice_no: string | null; approved: number }[])
      .find((x) => invoiceKey(x.invoice_no ?? "") === invoiceKey(no));
    if (!r) return null;
    const expired = r.status === "EXPIRED" || r.status === "PENDING_APPROVAL";
    return { proposal_id: r.proposal_id, status: expired ? (r.approved ? "expired after approval, unexecuted," : "expired unsigned") : r.status.toLowerCase().replace(/_/g, " "), at: expired ? r.expires_at : r.created_at };
  };
  const open: OpenInvoice[] = received(db)
    .filter((r) => !paidKeys.has(invoiceKey(r.invoice_no)) && !flightKeys.has(invoiceKey(r.invoice_no)))
    .map((r) => ({ ...r, handled: invoiceAlreadyHandled(db, r.invoice_no, now), lastPlan: lastPlanOf(r.invoice_no) }));

  const lines: string[] = [];
  lines.push(paid.length
    ? `Invoices paid (from the ledger): ${paid.slice(0, 5).map((p) => `${p.invoice_no} ${p.currency} ${p.amount}, paid ${hhmm(p.paid_at)}${p.transfer_id ? `, Airwallex transfer ${p.transfer_id}` : ""}${p.proposal_id ? ` (${p.proposal_id})` : ""}`).join("; ")}. A paid invoice is not open and is never paid again.`
    : "Invoices paid (from the ledger): none.");
  for (const t of inFlight) lines.push(`Invoice ${t.invoice_no} is being paid: its payout is ${t.status} at Airwallex; it is not open.`);
  if (open.length === 0) lines.push("Open invoices (came in, not paid): none.");
  for (const o of open) {
    const last = o.lastPlan ? ` Its last plan, ${o.lastPlan.proposal_id}, ${o.lastPlan.status.startsWith("expired") ? `${o.lastPlan.status} at ${hhmm(o.lastPlan.at)}` : `is ${o.lastPlan.status}`}; nothing was paid under it.` : "";
    const head = `Open invoice ${o.invoice_no} from ${o.vendor}: ${o.currency} ${o.amount}, due ${o.due_date}; not paid.${last}`;
    if (o.handled) { lines.push(`${head} Code's duplicate guard: ${o.handled}; it is not planned again.`); continue; }
    const tool = plans !== null && invoiceKey(plans) === invoiceKey(o.invoice_no);
    const money = moneyFor(db, o.amount);
    const may = !tool ? "" : money.ok
      ? " Nothing in the ledger stops a plan: plan_invoice may plan it now. Planning moves no money: code still checks the payee against the allowlist, the amount, the floors and the SWIFT fee ceiling, and the CFO decides with Face ID."
      : " plan_invoice would not put it to the CFO now: code's plan would stop and send it to a person.";
    lines.push(`${head} No plan waits for the CFO and no payout runs. Money: ${money.text}.${may}`);
  }
  return { paid, inFlight, open, lines };
}
