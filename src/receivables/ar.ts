// Receivables, money in (docs/receivables.md): Northwind invoices a customer, Purser books it (debtors 1300 against
// revenue 4200 and output VAT) and asks Airwallex for a single-use payment link for exactly that invoice
// (src/airwallex/paymentLinks.ts, sandbox only, test money). Payments that arrive (a deposit to a Global Account, a
// Global Account transaction, a card payment through the link) are matched to an invoice by the rules below and booked
// once (bank against debtors); what does not fit goes to a review queue and to suspense (2900), never to revenue.
// Reminders are drafts for a person to send (due + 3, + 10, + 20 days); Purser sends nothing. Customer names, contact
// addresses and payer names never go to the audit log or the console: invoice numbers and amounts do. The ledger goes
// to Purser Cloud too, so its entries name an invoice by its number only: the number is the open item's party, and the
// customer's name stays in ar_invoices here.
//
// Matching, in order (one payment is matched once, by its Airwallex id):
//   1 reference  the payment's reference names an invoice number, written any way (src/lib/invoiceKey.ts); the
//                longest one named wins; two different ones of the same length go to review. The invoice must be open
//                and in the payment's currency, or the payment goes to review.
//   2 amount     no invoice named: exactly one open invoice in the same currency with exactly this amount open. None,
//                or more than one, goes to review (never a guess).
//   3 amounts    exact: paid. Short by at most the tolerance (the smaller of 2.00 and 0.5% of what is open): paid, the
//                difference written off to bank fees (6800). Short by more: partly paid, the rest stays open.
//                Over: the open amount is applied, the excess waits in suspense and in the review queue (a refund or a
//                credit is the CFO's decision).

import { audit } from "../audit/log.js";
import type { Airwallex } from "../airwallex/client.js";
import { createInvoiceLink, linkDifferences, retireLink, type PaymentLink } from "../airwallex/paymentLinks.js";
import { bankAccountFor } from "../config/gl.js";
import type { DB } from "../db/open.js";
import { RECEIVABLES } from "../ledger/accounts.js";
import { postEntry } from "../ledger/core.js";
import { salesInvoice, settleOpenItem } from "../ledger/documents.js";
import { vatOn } from "../ledger/vat.js";
import { invoiceKey, referenceWords, unknownInvoiceWord } from "../lib/invoiceKey.js";
import { withoutAccountsOrAddresses, withoutNames } from "../lib/personalData.js";
import { matchReceipt, namesReceivable, type Deposit } from "../agents/receivables.js";
import { fromCents } from "../lib/money.js";

export const REVENUE = "4200";
export const SUSPENSE = "2900";
export const BANK_FEES = "6800";
/** A short payment within this is paid in full: the smaller of TOLERANCE.cents and TOLERANCE.bps of what is open. */
export const TOLERANCE = { cents: 200, bps: 50 } as const;
export const toleranceCents = (openCents: number) => Math.min(TOLERANCE.cents, Math.floor((openCents * TOLERANCE.bps) / 10_000));
/** Reminder drafts, days after the due date. */
export const DUNNING_DAYS = [3, 10, 20] as const;

export type ArStatus = "OPEN" | "PARTIAL" | "PAID" | "OVERPAID";
export type ArOutcome = "MATCHED" | "MATCHED_TOLERANCE" | "PARTIAL" | "OVERPAID" | "REVIEW";
export interface ArInvoice {
  invoice_no: string; customer: string; contact_email: string | null; currency: string; net_cents: number; vat_code: string; amount_cents: number;
  paid_cents: number; issue_date: string; due_date: string; status: ArStatus; link_id: string | null; link_url: string | null; link_active: number; issued_at: string;
}
export interface NewArInvoice { invoice_no: string; customer: string; contact_email?: string | null; currency: string; net_cents: number; vat_code: string; issue_date: string; due_date: string }
export interface IncomingPayment { payment_id: string; currency: string; amount_cents: number; reference: string | null; payer: string | null; received_at: string }
export interface MatchResult { outcome: ArOutcome; invoice_no: string | null; rule: string; applied_cents: number; written_off_cents: number; suspense_cents: number }

const DAY = 86_400_000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const days = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const money = (c: number, cur: string) => `${cur} ${fromCents(c)}`;
const ACTOR = "treasury";

export const arInvoice = (db: DB, no: string) => db.prepare("SELECT * FROM ar_invoices WHERE invoice_no = ?").get(no) as ArInvoice | undefined;
export const arInvoices = (db: DB) => db.prepare("SELECT * FROM ar_invoices ORDER BY due_date, invoice_no").all() as ArInvoice[];
export const openArInvoices = (db: DB) => arInvoices(db).filter((i) => i.status === "OPEN" || i.status === "PARTIAL");

/** The party an invoice's open item is booked under: the one its issue entry used (an invoice issued before 27 Nov
 *  carries its customer's name there and keeps it, so it can still be settled), else its number. */
const ledgerParty = (db: DB, inv: ArInvoice): string =>
  (db.prepare("SELECT l.party FROM ledger_lines l JOIN ledger_entries e ON e.entry_id = l.entry_id WHERE e.source_key = ? AND l.account = ? AND l.party IS NOT NULL LIMIT 1")
    .get(`ar:issue:${inv.invoice_no}`, RECEIVABLES) as { party: string } | undefined)?.party ?? inv.invoice_no;

/**
 * Issues one invoice: recorded, booked (debtors against revenue and output VAT, once), and, when `links` is given, a
 * single-use Airwallex payment link for exactly its amount, read back against the invoice before it is kept.
 */
export async function issueInvoice(db: DB, inv: NewArInvoice, links: Pick<Airwallex, "call"> | null, now = new Date()): Promise<{ invoice: ArInvoice; entry_id: number; link: PaymentLink | null; link_problem: string | null }> {
  if (!/^[A-Za-z0-9][A-Za-z0-9/-]{1,39}$/.test(inv.invoice_no)) throw new Error(`not an invoice number: ${JSON.stringify(inv.invoice_no)}`);
  if (!/^[A-Z]{3}$/.test(inv.currency)) throw new Error(`not a currency: ${JSON.stringify(inv.currency)}`);
  if (!DATE.test(inv.issue_date) || !DATE.test(inv.due_date) || inv.due_date < inv.issue_date) throw new Error("an invoice needs an issue date and a due date on or after it (YYYY-MM-DD)");
  if (!Number.isSafeInteger(inv.net_cents) || inv.net_cents <= 0) throw new Error("the net amount is whole cents above zero");
  if (!inv.customer.trim()) throw new Error("an invoice needs a customer");
  if (arInvoice(db, inv.invoice_no)) throw new Error(`${inv.invoice_no} is already issued; nothing was done`);
  const amount = inv.net_cents + vatOn(inv.net_cents, inv.vat_code);
  const posted = db.transaction(() => {
    db.prepare(`INSERT INTO ar_invoices (invoice_no, customer, contact_email, currency, net_cents, vat_code, amount_cents, issue_date, due_date, status, issued_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', ?)`).run(inv.invoice_no, inv.customer, inv.contact_email ?? null, inv.currency, inv.net_cents, inv.vat_code, amount, inv.issue_date, inv.due_date, now.toISOString());
    const e = salesInvoice(db, {
      // By number only (the ledger goes to the cloud): the invoice number is the open item's party.
      date: inv.issue_date, doc_ref: inv.invoice_no, due_date: inv.due_date, currency: inv.currency, created_by: ACTOR, customer: inv.invoice_no, description: `Sales invoice ${inv.invoice_no}`,
      source_key: `ar:issue:${inv.invoice_no}`, lines: [{ account: REVENUE, net_cents: inv.net_cents, vat_code: inv.vat_code }],
    }, now);
    audit(db, ACTOR, "ar.issued", inv.invoice_no, { currency: inv.currency, amount: fromCents(amount), due_date: inv.due_date, entry_id: e.entry_id, test_money: true }, now);
    return e;
  })();
  let link: PaymentLink | null = null, problem: string | null = null;
  if (links) {
    const made = await createInvoiceLink(links, { invoice_no: inv.invoice_no, customer: inv.customer, currency: inv.currency, amount_cents: amount, due_date: inv.due_date }, now);
    const diffs = linkDifferences(made, { invoice_no: inv.invoice_no, customer: inv.customer, currency: inv.currency, amount_cents: amount, due_date: inv.due_date });
    if (diffs.length) {
      problem = `the link Airwallex made is not this invoice (${diffs.join("; ")}); it is not kept`;
      await retireLink(links, made.id, "NOT_KEPT").catch(() => undefined);
    } else {
      link = made;
      db.prepare("UPDATE ar_invoices SET link_id = ?, link_url = ?, link_active = 1 WHERE invoice_no = ?").run(made.id, made.url, inv.invoice_no);
    }
    audit(db, ACTOR, problem ? "ar.link_refused" : "ar.link_created", inv.invoice_no, { link_id: made.id, ...(problem ? { problem } : {}), test_money: true }, now);
  }
  return { invoice: arInvoice(db, inv.invoice_no)!, entry_id: posted.entry_id, link, link_problem: problem };
}

/**
 * The invoice a reference names (rule 1), or why none can be chosen. A reference names an invoice only as a whole word
 * (review of 26 Nov: "NW-1077" named NW-10 and paid it); one that names a number shaped like ours that is not on file
 * ("NW-1077") goes to review, never to the amount rule; so does one that names two or more different invoices.
 */
function named(db: DB, reference: string | null): { inv: ArInvoice } | { review: string } | null {
  if (!reference) return null;
  const perWord = referenceWords(reference);
  const all = arInvoices(db);
  const found = all.filter((i) => perWord.some((w) => w.includes(invoiceKey(i.invoice_no))));
  // A number that is only a "/"-part of a longer one named ("NW/7" in "NW/7/2") is that one, not a second invoice; but
  // only when every word that names it names a longer one on file too (red team round 2, finding C: "NW/7, NW/7/2"
  // names NW/7 as a word of its own, so two invoices are named and a person decides).
  const within = (a: string, b: string) => a !== b && `/${b}/`.includes(`/${a}/`);
  const partOnly = (k: string) => perWord.filter((w) => w.includes(k)).every((w) => found.some((o) => within(k, invoiceKey(o.invoice_no)) && w.includes(invoiceKey(o.invoice_no))));
  const hits = found.filter((i) => !partOnly(invoiceKey(i.invoice_no)));
  if (!hits.length) {
    const unknown = unknownInvoiceWord(reference, all.map((i) => i.invoice_no));
    return unknown ? { review: `the reference names ${unknown}, which is not an invoice on file` } : null;
  }
  // Two different invoices named ("NW-10 / NW-100"): which one is paid is a person's call, never the longer number's.
  if (hits.length > 1) return { review: `the reference names ${hits.length} invoices: ${hits.map((i) => i.invoice_no).sort().join(", ")}` };
  return { inv: hits[0]! };
}

/** Matches one incoming payment and books it, once per payment id. */
export function matchPayment(db: DB, payment: IncomingPayment, now = new Date()): MatchResult & { repeat: boolean } {
  // "eur" is EUR (red team, review 153: the ledger refused it, and again on every poll).
  const p = { ...payment, currency: payment.currency.trim().toUpperCase() };
  if (!Number.isSafeInteger(p.amount_cents) || p.amount_cents <= 0) throw new Error("a payment is whole cents above zero");
  return db.transaction(() => {
    const seen = db.prepare("SELECT outcome, invoice_no, rule, applied_cents, written_off_cents, suspense_cents FROM ar_payments WHERE payment_id = ?").get(p.payment_id) as MatchResult | undefined;
    if (seen) return { ...seen, repeat: true };
    let inv: ArInvoice | undefined, rule: string, review: string | null = null;
    const n = named(db, p.reference);
    if (n && "review" in n) { rule = "reference"; review = n.review; }
    else if (n) {
      inv = n.inv; rule = `reference names ${inv.invoice_no}`;
      if (inv.status !== "OPEN" && inv.status !== "PARTIAL") review = `${inv.invoice_no} is already ${inv.status.toLowerCase()}`;
      else if (inv.currency !== p.currency) review = `${inv.invoice_no} is invoiced in ${inv.currency}, the payment is in ${p.currency}`;
    } else {
      const fits = openArInvoices(db).filter((i) => i.currency === p.currency && i.amount_cents - i.paid_cents === p.amount_cents);
      rule = "amount";
      if (fits.length === 1) { inv = fits[0]!; rule = `no invoice named; the one open ${p.currency} invoice of exactly this amount is ${inv.invoice_no}`; }
      else review = fits.length ? `no invoice named and ${fits.length} open invoices are open for exactly this amount` : "no invoice named and no open invoice is open for exactly this amount";
    }
    const bank = bankAccountFor(p.currency);
    let outcome: ArOutcome, applied = 0, writeOff = 0, suspense = 0;
    if (review || !inv) {
      outcome = "REVIEW"; suspense = p.amount_cents; inv = undefined;
    } else {
      const open = inv.amount_cents - inv.paid_cents;
      if (p.amount_cents === open) { outcome = "MATCHED"; applied = open; }
      else if (p.amount_cents < open && open - p.amount_cents <= toleranceCents(open)) { outcome = "MATCHED_TOLERANCE"; applied = p.amount_cents; writeOff = open - p.amount_cents; }
      else if (p.amount_cents < open) { outcome = "PARTIAL"; applied = p.amount_cents; }
      else { outcome = "OVERPAID"; applied = open; suspense = p.amount_cents - open; review = `${inv.invoice_no} overpaid by ${money(suspense, p.currency)}: a refund or a credit is the CFO's decision`; }
    }
    const base = { date: p.received_at.slice(0, 10), created_by: ACTOR };
    const party = inv ? ledgerParty(db, inv) : null;
    if (applied) settleOpenItem(db, { ...base, kind: "receive", party: party!, doc_ref: inv!.invoice_no, amount_cents: applied, currency: p.currency, bank, source_key: `ar:pay:${p.payment_id}`, proof: p.payment_id, description: `Receipt of ${inv!.invoice_no}` }, now);
    if (writeOff) postEntry(db, { ...base, description: `Short payment of ${inv!.invoice_no} within tolerance, written off`, source_key: `ar:writeoff:${p.payment_id}`, doc_ref: inv!.invoice_no,
      lines: [{ account: BANK_FEES, debit: writeOff, currency: p.currency, doc_ref: inv!.invoice_no }, { account: RECEIVABLES, credit: writeOff, currency: p.currency, party: party!, doc_ref: inv!.invoice_no }] }, now);
    if (suspense) postEntry(db, { ...base, description: inv ? `Overpayment of ${inv.invoice_no}, held in suspense` : "Payment to review, held in suspense", source_key: `ar:suspense:${p.payment_id}`, doc_ref: p.payment_id,
      lines: [{ account: bank, debit: suspense, currency: p.currency, doc_ref: p.payment_id }, { account: SUSPENSE, credit: suspense, currency: p.currency, doc_ref: p.payment_id, memo: "until a person identifies it" }] }, now);
    if (inv && applied) {
      const paid = inv.paid_cents + applied + writeOff;
      db.prepare("UPDATE ar_invoices SET paid_cents = ?, status = ? WHERE invoice_no = ?").run(paid, outcome === "OVERPAID" ? "OVERPAID" : paid >= inv.amount_cents ? "PAID" : "PARTIAL", inv.invoice_no);
    }
    const invoiceNo = inv && applied ? inv.invoice_no : null;
    db.prepare(`INSERT INTO ar_payments (payment_id, currency, amount_cents, reference, payer, invoice_no, applied_cents, written_off_cents, suspense_cents, outcome, rule, received_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(p.payment_id, p.currency, p.amount_cents, p.reference, p.payer, invoiceNo, applied, writeOff, suspense, outcome, rule, p.received_at);
    if (review) db.prepare("INSERT INTO ar_review (payment_id, reason, status, created_at) VALUES (?, ?, 'OPEN', ?)").run(p.payment_id, review, now.toISOString());
    audit(db, ACTOR, outcome === "REVIEW" || outcome === "OVERPAID" ? "ar.payment_review" : "ar.payment_matched", p.payment_id, {
      outcome, invoice_no: invoiceNo, amount: fromCents(p.amount_cents), currency: p.currency, applied: fromCents(applied), written_off: fromCents(writeOff), suspense: fromCents(suspense), rule, ...(review ? { review } : {}), test_money: true,
    }, now);
    return { outcome, invoice_no: invoiceNo, rule, applied_cents: applied, written_off_cents: writeOff, suspense_cents: suspense, repeat: false };
  })();
}

/**
 * One deposit to whichever matcher owns it, once: one already recorded stays where it was; else this module when it has
 * invoices and the reference names one of them or none of the older receivables' (src/agents/receivables.ts, which
 * books cash basis through the journal); else the older matcher, exactly as before.
 */
export function routeDeposit(db: DB, deposit: Deposit, now = new Date(), via: "webhook" | "poll" = "poll"): { by: "ar" | "receivables"; outcome: string; detail: string } {
  const d = { ...deposit, currency: deposit.currency.trim().toUpperCase() }; // "eur" is EUR, for either matcher
  const p = { payment_id: d.deposit_id, currency: d.currency, amount_cents: d.amount_cents, reference: d.reference, payer: d.payer, received_at: d.received_at };
  const ar = (): { by: "ar"; outcome: string; detail: string } => { const r = matchPayment(db, p, now); return { by: "ar", outcome: r.outcome, detail: `${r.invoice_no ?? "no invoice"}: ${r.rule}` }; };
  if (db.prepare("SELECT 1 FROM ar_payments WHERE payment_id = ?").get(d.deposit_id)) return ar();
  // An invoice of this module named as a whole word wins; else a receivable of the older matcher named as a whole word
  // goes there (review of 26 Nov: a looser match, or a review answer here, must not take it); else this module.
  const n = named(db, d.reference);
  const mine = !db.prepare("SELECT 1 FROM receipts WHERE deposit_id = ?").get(d.deposit_id) && !!db.prepare("SELECT 1 FROM ar_invoices LIMIT 1").get()
    && ((n !== null && "inv" in n) || !namesReceivable(db, d.reference));
  if (mine) return ar();
  const m = matchReceipt(db, d, now, via);
  return { by: "receivables", outcome: m.outcome, detail: m.detail };
}

export interface ReviewItem { payment_id: string; currency: string; amount: string; reference: string; reason: string; created_at: string }
export function reviewQueue(db: DB): ReviewItem[] {
  return (db.prepare(`SELECT r.payment_id, p.currency, p.amount_cents, COALESCE(p.reference, '') AS reference, r.reason, r.created_at FROM ar_review r JOIN ar_payments p USING (payment_id)
    WHERE r.status = 'OPEN' ORDER BY r.created_at, r.payment_id`).all() as (Omit<ReviewItem, "amount"> & { amount_cents: number })[])
    .map(({ amount_cents, ...r }) => ({ ...r, amount: fromCents(amount_cents) }));
}

/** Switches off the link of each invoice no longer open (paid, overpaid, or partly paid by other means: its amount is stale). */
export async function retireDoneLinks(db: DB, links: Pick<Airwallex, "call">, now = new Date()): Promise<string[]> {
  const done = db.prepare("SELECT invoice_no, link_id, status FROM ar_invoices WHERE link_active = 1 AND link_id IS NOT NULL AND status <> 'OPEN'").all() as { invoice_no: string; link_id: string; status: string }[];
  for (const d of done) {
    await retireLink(links, d.link_id, d.status);
    db.prepare("UPDATE ar_invoices SET link_active = 0 WHERE invoice_no = ?").run(d.invoice_no);
    audit(db, ACTOR, "ar.link_retired", d.invoice_no, { link_id: d.link_id, status: d.status, test_money: true }, now);
  }
  return done.map((d) => d.invoice_no);
}

export type ArBucket = "0-30" | "31-60" | "61-90" | "90+";
export const AR_BUCKETS: ArBucket[] = ["0-30", "31-60", "61-90", "90+"];
export const arBucket = (daysOverdue: number): ArBucket => (daysOverdue <= 30 ? "0-30" : daysOverdue <= 60 ? "31-60" : daysOverdue <= 90 ? "61-90" : "90+");
export interface AgedRow { invoice_no: string; customer: string; currency: string; open_cents: number; due_date: string; days_overdue: number; bucket: ArBucket }

/**
 * Aged debtors on a day: each open invoice by days past its due date (not yet due counts as 0, in 0-30, and is also
 * totalled apart as not_due), per currency; currencies are never added together.
 */
export function agedDebtors(db: DB, asOf: string): { as_of: string; rows: AgedRow[]; totals: Record<string, Record<ArBucket, number>>; not_due: Record<string, number> } {
  if (!DATE.test(asOf)) throw new Error("asOf is YYYY-MM-DD");
  const rows = openArInvoices(db).filter((i) => i.issue_date <= asOf).map((i): AgedRow => {
    const late = Math.max(0, days(i.due_date, asOf));
    return { invoice_no: i.invoice_no, customer: i.customer, currency: i.currency, open_cents: i.amount_cents - i.paid_cents, due_date: i.due_date, days_overdue: late, bucket: arBucket(late) };
  }).sort((a, b) => b.days_overdue - a.days_overdue || a.invoice_no.localeCompare(b.invoice_no));
  const totals: Record<string, Record<ArBucket, number>> = {};
  const notDue: Record<string, number> = {};
  for (const r of rows) {
    const t = totals[r.currency] ??= { "0-30": 0, "31-60": 0, "61-90": 0, "90+": 0 };
    t[r.bucket] += r.open_cents;
    if (r.due_date >= asOf) notDue[r.currency] = (notDue[r.currency] ?? 0) + r.open_cents;
  }
  return { as_of: asOf, rows, totals, not_due: notDue };
}

/** The days an invoice's reminders fall due: due + 3, + 10 and + 20. */
export const dunningDates = (dueDate: string) => DUNNING_DAYS.map((d, n) => ({ stage: n + 1, on: addDays(dueDate, d) }));

const TONE = ["a friendly reminder", "a second reminder", "a final reminder before we follow this up in other ways"];

export interface DunningDraft { invoice_no: string; stage: number; due_on: string; draft: string; created_at: string }

/**
 * The reminder drafts due by `asOf` for every invoice still open: written once per invoice and stage, stored as
 * DRAFT (the table allows nothing else), and never sent by Purser. The addressee is the invoice's contact; a person sends.
 */
export function draftReminders(db: DB, asOf: string, now = new Date()): DunningDraft[] {
  if (!DATE.test(asOf)) throw new Error("asOf is YYYY-MM-DD");
  for (const i of openArInvoices(db)) {
    for (const s of dunningDates(i.due_date).filter((s) => s.on <= asOf)) {
      const open = money(i.amount_cents - i.paid_cents, i.currency);
      const text = [
        `Subject: Invoice ${i.invoice_no}: ${TONE[s.stage - 1]}`,
        `Dear ${i.customer} accounts team,`,
        `our invoice ${i.invoice_no} of ${money(i.amount_cents, i.currency)} was due on ${i.due_date}; ${open} is still open.`,
        i.link_url && i.link_active ? `You can pay it by card here: ${i.link_url}` : `Please pay by bank transfer with ${i.invoice_no} as the reference.`,
        "If you have already paid, please send us the payment's date and reference so we can match it.",
        "(Test money: Airwallex sandbox. This draft is not sent by Purser.)",
      ].join("\n");
      const r = db.prepare("INSERT OR IGNORE INTO ar_dunning (invoice_no, stage, due_on, draft, status, created_at) VALUES (?, ?, ?, ?, 'DRAFT', ?)").run(i.invoice_no, s.stage, s.on, text, now.toISOString());
      if (r.changes) audit(db, ACTOR, "ar.reminder_drafted", i.invoice_no, { stage: s.stage, due_on: s.on, sent: false }, now);
    }
  }
  return db.prepare(`SELECT d.invoice_no, d.stage, d.due_on, d.draft, d.created_at FROM ar_dunning d JOIN ar_invoices i USING (invoice_no)
    WHERE i.status IN ('OPEN', 'PARTIAL') ORDER BY d.due_on, d.invoice_no, d.stage`).all() as DunningDraft[];
}

/**
 * A payment's reference as it may leave the runner (the money loop's review queue, src/treasury/cloudSnapshot.ts): the
 * payer writes it, so it can carry their name, their bank account or an e-mail address. Every IBAN and e-mail address,
 * however written, is taken out, and so is every name the runner knows for it: the payer's (whole, and each word of
 * three letters or more) and every customer's on file. What is left (an order number, an invoice number, a month)
 * still helps a person find the payment; the reference itself stays in ar_payments here.
 */
export function referenceForCloud(db: DB, paymentId: string, reference: string): string {
  const payer = (db.prepare("SELECT payer FROM ar_payments WHERE payment_id = ?").get(paymentId) as { payer: string | null } | undefined)?.payer ?? "";
  const customers = (db.prepare("SELECT customer FROM ar_invoices").all() as { customer: string }[]).map((r) => r.customer);
  const hasOld = !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'receivables'").get();
  if (hasOld) customers.push(...(db.prepare("SELECT customer FROM receivables").all() as { customer: string }[]).map((r) => r.customer));
  // Each name whole, next to any letter (src/lib/personalData.ts withoutNames: "Émile Ørsted" too, not only ASCII).
  return withoutNames(withoutAccountsOrAddresses(reference), [payer, ...customers, ...payer.split(/[\s,.;:]+/).filter((w) => w.length >= 3)]).replace(/\s{2,}/g, " ").trim();
}

/** An address shown masked (j…@example.com), for a console or a page; the stored one is never logged. */
export const maskEmail = (e: string | null) => (e && e.includes("@") ? `${e[0]}…@${e.split("@")[1]}` : "no contact on file");
