// The Treasury agent's facts about invoices, read from the ledger at every wake (review, 2 November: at 14:40 the agent
// still called the licence "unpaid" ten minutes after it was paid, because its facts showed refused payouts and nothing
// said an invoice IS paid). An invoice is paid when the ledger holds a PAID payout for it, or its payment proposal was
// executed; it is open when it came in (a world event, or a planned invoice) and is neither paid nor being paid. For
// each open invoice the facts say what code's own rules say about planning it now: the same duplicate guard
// proposeInvoicePayment applies (invoiceAlreadyHandled), and the money at the last balance reading, which code reads
// again when it plans. Facts only: the agent decides, code checks, the CFO approves with Face ID.
//
// An invoice's own words are not facts (Opus review, 2 November): its number passes a strict shape check or is not
// repeated, its vendor is named only when the name is on the payee allowlist, and every line built from an invoice
// says it is what the invoice states, unverified.

import { invoiceAlreadyHandled, invoiceKey, measuredSwiftFeesCents, treasuryState } from "../agents/euroBill.js";
import { parseInvoiceFallback } from "../agents/invoice.js";
import type { DB } from "../db/open.js";
import { fromCents, toCents } from "../lib/money.js";
import { feeReserveCents, feeReserveOverCap, planInvoice } from "../policy/treasury.js";

export interface PaidInvoice { invoice_no: string; amount: string; currency: string; paid_at: string; transfer_id: string | null; proposal_id: string | null }
export interface OpenInvoice {
  invoice_no: string;
  /** The vendor as the invoice states it when that name is on the payee allowlist, else "an unlisted vendor". */
  vendor: string;
  amount: string;
  currency: string;
  due_date: string;
  /** Code's duplicate guard on this invoice now (a plan waits, a payout runs), or null: nothing stops a new plan. */
  handled: string | null;
  /** The latest payment proposal for it that is over (expired, rejected…), in words, as a fact. */
  lastPlan: { proposal_id: string; status: string; at: string } | null;
  /** Copies of this invoice that came in disagree with each other or with the invoice plan_invoice plans. */
  conflict: string | null;
}
export interface InvoiceFacts { paid: PaidInvoice[]; inFlight: { invoice_no: string; status: string }[]; open: OpenInvoice[]; unreadable: number; lines: string[] }
/** The invoice plan_invoice plans, as code read it from its own file (live: the licence fixture). */
export type PlannedInvoice = { invoice_no: string; vendor: string; amount: string; currency: string; due_date: string; iban?: string; bic?: string };

/** A balance reading older than this is too old to judge the money by; code reads the balances again when it plans. */
export const BALANCE_READING_STALE_MS = 60 * 60_000;

const has = (db: DB, table: string) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
const hhmm = (iso: string) => `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;

type Received = PlannedInvoice;

// Invoice numbers: ASCII only and written as code compares them (no spaces, no line breaks, nothing NFKC or upper
// case would change but case), 2 to 8 letters or digits, then up to four more groups after "-", "/" or ".", with a
// digit somewhere. A group may not hold a word about status or approval anywhere inside it ("SLL-2026-11-PAID1",
// "OKTOPAY-1"), nor be one of a few short ones ("OK-1"): a number like that is the invoice talking (Opus re-review).
const NO_SHAPE = /^[A-Z0-9]{2,8}(?:[-/.][A-Z0-9]{1,8}){0,4}$/;
const NO_INSIDE = ["PAID", "PAY", "APPROV", "CFO", "CEO", "IGNOR", "URGENT", "SIGN", "CLEAR", "SETTL", "EXECUT", "VERIF", "OVERRID",
  "CONFIRM", "AUTHORI", "TRUST", "ADMIN", "SYSTEM", "RULE", "AGENT", "CLAUDE", "SAFE", "IMMEDIAT", "PLAN", "DONE"];
const NO_GROUP = new Set(["OK", "OKAY", "NOW", "YES", "GO"]);
/** Whether code repeats this invoice number in the agent's facts. */
export function vouchedInvoiceNo(no: string): boolean {
  if (!/^[A-Za-z0-9./-]{1,40}$/.test(no)) return false;
  const k = no.toUpperCase();
  return NO_SHAPE.test(k) && /\d/.test(k) && !k.split(/[-/.]/).some((g) => NO_GROUP.has(g) || NO_INSIDE.some((w) => g.includes(w)));
}
const shownNo = (no: string) => (vouchedInvoiceNo(no) ? no : "(a number code does not repeat)");

/** The names on the payee allowlist (active beneficiaries). */
const allowlisted = (db: DB): Set<string> =>
  new Set(has(db, "beneficiaries") ? (db.prepare("SELECT name FROM beneficiaries WHERE status = 'ACTIVE'").all() as { name: string }[]).map((r) => r.name.trim()) : []);

const wellFormed = (r: Received) => /^\d+\.\d{2}$/.test(r.amount) && /^\d{4}-\d{2}-\d{2}$/.test(r.due_date) && /^[A-Z]{3}$/.test(r.currency);

/** Every copy of every invoice that came in (the planned ones, then the world's), by invoice key; and how many code could not vouch for. */
function received(db: DB): { byKey: Map<string, Received[]>; unreadable: number } {
  const byKey = new Map<string, Received[]>();
  let unreadable = 0;
  const add = (r: Received) => {
    if (!vouchedInvoiceNo(r.invoice_no) || !wellFormed(r)) { unreadable++; return; }
    const key = invoiceKey(r.invoice_no);
    byKey.set(key, [...(byKey.get(key) ?? []), { ...r, vendor: r.vendor.trim() }]);
  };
  if (has(db, "invoices")) {
    for (const r of db.prepare("SELECT invoice_no, vendor, amount, currency, due_date FROM invoices ORDER BY rowid").all() as Received[]) add(r);
  }
  if (has(db, "world_events")) {
    const rows = db.prepare("SELECT payload_json FROM world_events WHERE kind = 'invoice.received' AND (for_agent = 'treasury' OR for_agent IS NULL) ORDER BY id").all() as { payload_json: string }[];
    for (const r of rows) {
      let text: unknown;
      try { text = (JSON.parse(r.payload_json) as { text?: unknown }).text; } catch { unreadable++; continue; }
      if (typeof text !== "string") { unreadable++; continue; }
      try {
        const inv = parseInvoiceFallback(text);
        add({ invoice_no: inv.invoice_no, vendor: inv.vendor, amount: inv.amount, currency: inv.currency, due_date: inv.due_date, iban: inv.iban, bic: inv.bic });
      } catch { unreadable++; /* an invoice code cannot read whole is not listed as a fact; planning it escalates to a person */ }
    }
  }
  return { byKey, unreadable };
}

// The bank details are compared too when both copies hold them (a copy from the invoices table may not): a copy under the
// licence's number asking for another account is not the invoice code plans.
const bank = (v: string | undefined) => (v ? v.replace(/\s+/g, "").toUpperCase() : null);
const bankDiffers = (a: string | undefined, b: string | undefined) => bank(a) !== null && bank(b) !== null && bank(a) !== bank(b);
const sameInvoice = (a: Received, b: Received) => a.vendor === b.vendor && a.amount === b.amount && a.currency === b.currency && a.due_date === b.due_date && !bankDiffers(a.iban, b.iban) && !bankDiffers(a.bic, b.bic);
const diff = (a: Received, b: Received) =>
  [a.vendor !== b.vendor && "vendor", a.amount !== b.amount && "amount", a.currency !== b.currency && "currency", a.due_date !== b.due_date && "due date",
    bankDiffers(a.iban, b.iban) && "IBAN", bankDiffers(a.bic, b.bic) && "BIC"].filter(Boolean).join(", ");

export type PlannedMatch = { status: "arrived" } | { status: "unreadable" } | { status: "not_received" } | { status: "differs"; fields: string }; 

/**
 * Whether the invoice plan_invoice plans came in as code would plan it: its number is one code vouches for, a copy came
 * in under it, and no copy under it differs (vendor, amount, currency, due date, IBAN, BIC). plan_invoice runs only on
 * "arrived" (review, 2 November: the tool, not only the facts, must refuse a copy that is not code's plan).
 */
export function plannedMatch(db: DB, plans: PlannedInvoice | null): PlannedMatch {
  if (!plans || !vouchedInvoiceNo(plans.invoice_no) || !wellFormed(plans)) return { status: "unreadable" };
  const copies = received(db).byKey.get(invoiceKey(plans.invoice_no)) ?? [];
  if (copies.length === 0) return { status: "not_received" };
  const other = copies.find((c) => !sameInvoice(c, plans));
  return other ? { status: "differs", fields: diff(other, plans) } : { status: "arrived" };
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
 *  would put it to the CFO; not ok: code's plan would stop and go to a person). Code reads the balances again to plan.
 *  A reading older than BALANCE_READING_STALE_MS gives no verdict, only its age. */
function moneyFor(db: DB, amount: string, now: Date): { ok: boolean; text: string } {
  const unread = { ok: true, text: "no balance reading yet; code reads the balances when it plans" };
  if (!has(db, "balance_snapshots")) return unread;
  const snap = db.prepare("SELECT taken_at, json FROM balance_snapshots ORDER BY id DESC LIMIT 1").get() as { taken_at: string; json: string } | undefined;
  if (!snap) return unread;
  try {
    const ageMs = now.getTime() - Date.parse(snap.taken_at);
    // A reading stamped in the future has no age code can trust: no verdict either.
    if (!Number.isFinite(ageMs) || ageMs < 0) return { ok: true, text: "the last balance reading has no readable time; code reads the balances when it plans" };
    const age = `${Math.max(0, Math.round(ageMs / 60_000))} minutes old`;
    if (ageMs > BALANCE_READING_STALE_MS) return { ok: true, text: `the last balance reading (${hhmm(snap.taken_at)}) is ${age}, stale: it says nothing about the money now; code reads the balances again when it plans` };
    const s = treasuryState(db, JSON.parse(snap.json) as Parameters<typeof treasuryState>[1]);
    const fees = measuredSwiftFeesCents(db);
    if (feeReserveOverCap(fees)) return { ok: false, text: "a SWIFT fee on record is far above the usual: code's plan would go to a person first" };
    const reserve = feeReserveCents(fees);
    const p = planInvoice(toCents(amount), s, reserve);
    const at = `at the last balance reading (${hhmm(snap.taken_at)}, ${age})`;
    if (p.kind === "pay_from_eur") return { ok: true, text: `${at} the free EUR (${fromCents(p.freeEurCents)} above the floor and commitments) covers it and the SWIFT fee reserve of ${fromCents(reserve)}` };
    if (p.kind === "convert_shortfall") return { ok: true, text: `${at} the free EUR is ${fromCents(Math.max(0, p.freeEurCents))}: code would convert EUR ${fromCents(p.buyEurCents)} from USD on a locked quote, only if USD stays above its floor (USD available ${fromCents(s.usdAvailableCents)}, floor ${fromCents(s.usdFloorCents)})` };
    return { ok: false, text: `${at} EUR is ${fromCents(-p.freeEurCents)} below its floor plus commitments: code's plan would go to a person instead` };
  } catch {
    return { ok: true, text: "the last balance reading could not be read; code reads the balances when it plans" };
  }
}

/**
 * The invoice facts. `plans` is the invoice plan_invoice plans (live: the licence, read from its file), so the facts
 * never say a tool plans an invoice it does not, and never offer it for a copy that differs from what it would plan.
 */
export function invoiceFacts(db: DB, now = new Date(), plans: PlannedInvoice | null = null): InvoiceFacts {
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
  const names = allowlisted(db);
  const named = (vendor: string) => (names.has(vendor.trim()) ? vendor.trim() : "an unlisted vendor");
  const planKey = plans && vouchedInvoiceNo(plans.invoice_no) && wellFormed(plans) ? invoiceKey(plans.invoice_no) : null;
  const { byKey, unreadable } = received(db);
  const open: OpenInvoice[] = [...byKey.entries()]
    .filter(([key]) => !paidKeys.has(key) && !flightKeys.has(key))
    .map(([key, copies]) => {
      const tool = key === planKey;
      // For the invoice plan_invoice plans, its own file is the reference; else the first copy that came in.
      const ref = tool ? plans! : copies[0]!;
      const other = copies.find((c) => !sameInvoice(c, ref));
      const conflict = other ? `a copy that came in differs from ${tool ? "the invoice plan_invoice plans" : "the first copy"} (${diff(other, ref)})` : null;
      return { invoice_no: copies[0]!.invoice_no, vendor: named(ref.vendor), amount: ref.amount, currency: ref.currency, due_date: ref.due_date,
        handled: invoiceAlreadyHandled(db, ref.invoice_no, now, copies[0]!.invoice_no), lastPlan: lastPlanOf(ref.invoice_no), conflict };
    });

  const lines: string[] = [];
  lines.push(paid.length
    ? `Invoices paid (from the ledger): ${paid.slice(0, 5).map((p) => `${shownNo(p.invoice_no)} ${p.currency} ${p.amount}, paid ${hhmm(p.paid_at)}${p.transfer_id ? `, Airwallex transfer ${p.transfer_id}` : ""}${p.proposal_id ? ` (${p.proposal_id})` : ""}`).join("; ")}. A paid invoice is not open and is never paid again.`
    : "Invoices paid (from the ledger): none.");
  for (const t of inFlight) lines.push(`Invoice ${shownNo(t.invoice_no)} is being paid: its payout is ${t.status} at Airwallex; it is not open.`);
  if (open.length === 0) lines.push("Open invoices (came in, not paid): none.");
  if (unreadable) lines.push(`${unreadable} invoice${unreadable === 1 ? "" : "s"} came in that code cannot read whole or vouch for; ${unreadable === 1 ? "it is" : "they are"} not listed, and planning one goes to a person.`);
  for (const o of open) {
    const last = o.lastPlan ? ` Its last plan, ${o.lastPlan.proposal_id}, ${o.lastPlan.status.startsWith("expired") ? `${o.lastPlan.status} at ${hhmm(o.lastPlan.at)}` : `is ${o.lastPlan.status}`}; nothing was paid under it.` : "";
    const head = `Open invoice ${o.invoice_no}, as the invoice states (unverified): from ${o.vendor}, ${o.currency} ${o.amount}, due ${o.due_date}. The ledger: not paid.${last}`;
    if (o.handled) { lines.push(`${head} Code's duplicate guard: ${o.handled}; it is not planned again.`); continue; }
    if (o.conflict) { lines.push(`${head} Not offered for planning: ${o.conflict}; a person checks it.`); continue; }
    const tool = planKey !== null && invoiceKey(o.invoice_no) === planKey;
    const money = moneyFor(db, o.amount, now);
    const may = !tool ? "" : money.ok
      ? " Nothing in the ledger stops a plan: plan_invoice may plan it now. Planning moves no money: code still checks the payee against the allowlist, the amount, the floors and the SWIFT fee ceiling, and the CFO decides with Face ID."
      : " plan_invoice would not put it to the CFO now: code's plan would stop and send it to a person.";
    lines.push(`${head} No plan waits for the CFO and no payout runs. Money: ${money.text}.${may}`);
  }
  return { paid, inFlight, open, unreadable, lines };
}
