// Payables, part 3: paying a ready invoice. A supplier added through the inbox (payee_add, any country and currency)
// is paid in the invoice's own currency on its route (supplier_payment, src/payouts/plan.ts); a Kit 11 payee on file
// in EUR still goes through the existing invoice payment (src/agents/euroBill.ts). Either way the plan keeps the reserve
// floors, buys only the shortfall, holds a fee reserve and guards against paying twice, and the CFO approves the terms
// with Face ID before an executor pays. Nothing here moves money or approves anything. syncPayments follows each
// proposal: paid once the ledger's transfer is PAID.

import { followPayouts } from "../payouts/follow.js";
import { readFileSync } from "node:fs";
import type { AirwallexRail, PayoutRail } from "../airwallex/port.js";
import { proposeInvoicePayment, type InvoiceOutcome } from "../agents/euroBill.js";
import type { DB } from "../db/open.js";
import type { InboxDeps } from "./inbox.js";
import { accrualEntries, accrualPushed, paymentEntries, pushOnce, reversalEntries, type BookkeepingSink } from "./books.js";
import { audit } from "../audit/log.js";
import type { Terms } from "../lib/terms.js";
import { expireDue, signedTerms } from "../policy/approvals.js";
import { pdfText } from "./pdfText.js";
import type { Asker } from "./read.js";
import { writeReviewNote } from "./review.js";
import { ledgerInvoiceNo } from "./ledgerKey.js";
import { cleanText, totalLine, totalLineCurrency } from "./reading.js";
import { scanTotalLine, scanView } from "./detail.js";
import { apInvoice, apInvoices, setStatus, type ApInvoiceRow, type Finding } from "./store.js";
import { payoutBeneficiary, proposeSupplierPayment, type SupplierPaymentOutcome } from "../payouts/plan.js";
import { MAX_REFERENCE, payableCurrency, referenceProblem } from "../payouts/routes.js";

export type PayOutcome = InvoiceOutcome | SupplierPaymentOutcome;

/**
 * The payout's reason code, from the invoice's expense account (screenshot pass S6: goods were sent as professional
 * services): goods bought (6200 Goods from the manufacturer) go as goods_purchased, anything else as
 * professional_business_services, the code Kit 11's recorded sandbox payouts were accepted with. goods_purchased is the
 * code the supplier payments already sent. Both values were accepted by the Airwallex sandbox's transfer validation
 * (POST /api/v1/transfers/validate, 200) on 9 November 2026.
 */
export function transferReason(glAccount: string): string {
  return glAccount === "6200" ? "goods_purchased" : "professional_business_services";
}

/** The longest payment reference Purser sends (src/payouts/routes.ts). */
export { MAX_REFERENCE };

export async function payApInvoice(db: DB, rail: AirwallexRail & PayoutRail, id: string, now = new Date(), reader?: Asker): Promise<PayOutcome> {
  const inv = apInvoice(db, id);
  if (!inv) throw new Error(`no payables invoice ${id}`);
  // A credit note is money the supplier owes back: it is set against its invoices, never paid out (whatever its status).
  if (inv.doc_kind === "credit_note") throw new Error(`${id} is a credit note: it is never paid; it lowers what is open to ${inv.vendor || "the supplier"}`);
  if (inv.status !== "ready") {
    const why = inv.findings.filter((f) => f.level !== "warn").map((f) => f.detail).join("; ");
    throw new Error(`${id} is ${inv.status.replace(/_/g, " ")}, not ready to pay${why ? `: ${why}` : ""}`);
  }
  if (!payableCurrency(inv.currency)) throw new Error(`${id} is in ${inv.currency}; Purser does not pay that currency (pays EUR only in two-decimal currencies SWIFT carries), so a person pays it`);
  const doc = db.prepare("SELECT path FROM ap_documents WHERE sha256 = ?").get(inv.doc_sha256) as { path: string };
  const text = (await pdfText(readFileSync(doc.path))).text;
  const r = inv.reading;
  const invoiceNo = ledgerInvoiceNo(r.invoice_no, r.vendor);
  const due = r.due_date || now.toISOString().slice(0, 10);
  const reference = r.reference || r.invoice_no;
  const refWrong = referenceProblem(reference);
  if (refWrong) throw new Error(`${id}: ${refWrong}`);
  // The supplier's own total line and its currency go with the terms, so the CFO sees them beside the amount.
  // A scan has no text line: the terms carry what was read from it, and say so (the phone shows it beside the amount).
  const scan = text ? null : scanView(db, id);
  const document = scan
    ? { total_line: scanTotalLine(inv, scan), currency: inv.currency, reason: transferReason(inv.gl_account) }
    : { total_line: totalLine(text), currency: totalLineCurrency(text), reason: transferReason(inv.gl_account) };
  // A supplier added through the inbox carries its route; a Kit 11 payee on file is paid in EUR as before.
  const out: PayOutcome = payoutBeneficiary(db, r.vendor) || r.currency !== "EUR"
    ? await proposeSupplierPayment(db, rail, { invoice_no: invoiceNo, vendor: r.vendor, amount: r.total, currency: r.currency, due_date: due, reference, reason: document.reason }, text, now, document)
    : await proposeInvoicePayment(db, rail, { invoice_no: invoiceNo, vendor: r.vendor, amount: r.total, currency: r.currency, due_date: due, iban: r.iban, bic: r.bic, reference }, text, now, "MIN_15", document);
  if (out.kind === "proposed") {
    setStatus(db, id, "waiting_cfo", "treasury", { proposal_id: out.proposal.proposal_id, reason: "payment filed for the CFO's Face ID" }, now);
    // Opus's advisory note goes with the proposal the CFO sees (its explanation; never part of the signed terms).
    const noted = await writeReviewNote(db, reader, id, now);
    // Stored as every review is ("[model] RECOMMENDATION: text"), so the phone names its real source: the model, or
    // Purser's code when no model wrote it (screenshot pass S3).
    const source = noted.review_by?.startsWith("claude:") ? noted.review_by.slice("claude:".length) : "no model";
    db.prepare("UPDATE proposals SET explanation = ? WHERE proposal_id = ? AND explanation IS NULL").run(`[${source}] NOTE: ${noted.review_note ?? ""}`, out.proposal.proposal_id);
    return out;
  }
  // Not planned (the reserve is short, a quote refused, a duplicate found late): the invoice stays as it is, with the reason.
  // Only over the status this call read (red team round 4: of two "pay" calls at once, the loser wrote its stale "ready"
  // over the winner's "waiting_cfo", and the paid invoice stayed open for good).
  const now_ = apInvoice(db, id);
  if (!now_ || now_.status !== inv.status || now_.proposal_id !== inv.proposal_id) return out;
  const findings: Finding[] = [...inv.findings.filter((f) => f.code !== "payment_not_planned"), { code: "payment_not_planned", level: "warn", detail: `the payment could not be planned: ${out.reason}` }];
  setStatus(db, id, "fraud" in out && out.fraud?.suspicious ? "blocked" : inv.status, "treasury", { findings, reason: out.reason }, now);
  return out;
}

/**
 * The note written while the invoice waited for the CFO no longer describes it once paid, rejected or ready again
 * (screenshot pass S3: a paid invoice still said "Waits for the CFO's Face ID"): it is taken away; the audit log keeps it.
 */
function clearStaleNote(db: DB, id: string): void {
  db.prepare("UPDATE ap_invoices SET review_note = NULL, review_by = NULL WHERE id = ?").run(id);
}

interface PaidPayout { amount: string; currency: string; approval_sha256: string }

/**
 * Why a paid payout may not be booked, or null: the proposal's stored terms no longer hash to what the CFO approved
 * (changed after signing), or the payout's own row is not the payment those terms describe (another approval hash,
 * amount or currency). The executor checks the same hash before it pays; the books check it again before they book.
 */
function bookingProblem(db: DB, proposalId: string, paid: PaidPayout): string | null {
  const signed = signedTerms<Terms & { amount?: string; currency?: string }>(db, proposalId);
  if (!signed.ok) return signed.reason;
  if (paid.approval_sha256 !== signed.sha256) return `the payout carries another approval hash than ${proposalId}'s`;
  if (paid.amount !== signed.terms.amount || paid.currency !== signed.terms.currency) {
    return `the payout on record (${paid.currency} ${paid.amount}) is not the ${String(signed.terms.currency)} ${String(signed.terms.amount)} the CFO signed in ${proposalId}`;
  }
  return null;
}

/** Follows each invoice waiting for the CFO: paid when its transfer is PAID; rejected; or ready again when its terms ran out. */
export async function syncPayments(db: DB, opts: { now?: () => Date; sink?: BookkeepingSink; rail?: PayoutRail } = {}): Promise<ApInvoiceRow[]> {
  const now = (opts.now ?? (() => new Date()))();
  // With Airwallex at hand: each sent supplier payout is read again, and a PAID one's Purser fee taken (red team 6).
  if (opts.rail) await followPayouts(db, opts.rail, now);
  // A proposal past its time that nothing has marked yet is expired first, so its invoice is not left waiting forever.
  expireDue(db, now);
  const changed: ApInvoiceRow[] = [];
  for (const inv of apInvoices(db, { status: "waiting_cfo" })) {
    const p = inv.proposal_id ? db.prepare("SELECT status, json_extract(terms_json, '$.transfer_request_id') AS request_id FROM proposals WHERE proposal_id = ?").get(inv.proposal_id) as { status: string; request_id: string | null } | undefined : undefined;
    if (!p) continue;
    // A proposal that failed with its payout still open at Airwallex (a lost answer, not resolved yet) or already paid
    // is not over: the invoice is never offered for payment again while that payout may be live (red team, 8 November).
    const payout = p.request_id ? db.prepare("SELECT status FROM transfers WHERE request_id = ?").get(p.request_id) as { status: string } | undefined : undefined;
    if (p.status !== "EXECUTED" && payout && payout.status !== "CANCELLED" && payout.status !== "PAID") continue;
    if (p.status !== "EXECUTED" && payout?.status === "PAID") p.status = "EXECUTED";
    if (p.status === "REJECTED") {
      const next = setStatus(db, inv.id, "rejected", "human", { reason: `the CFO rejected ${inv.proposal_id}` }, now);
      clearStaleNote(db, inv.id);
      // The accrual a sink already holds is taken back there, so the payable is closed in the books too.
      if (opts.sink && accrualPushed(db, next, opts.sink)) await pushOnce(db, opts.sink, "reversal", reversalEntries(next, now.toISOString().slice(0, 10)), next, now);
      changed.push(next);
    } else if (["EXPIRED", "FAILED", "NEEDS_REAPPROVAL", "SUPERSEDED"].includes(p.status)) {
      changed.push(setStatus(db, inv.id, "ready", "system", { proposal_id: null, reason: `${inv.proposal_id} ${p.status.toLowerCase()}; it can be filed again` }, now));
      clearStaleNote(db, inv.id);
    } else if (p.status === "EXECUTED") {
      const paid = db.prepare("SELECT amount, currency, approval_sha256 FROM transfers WHERE invoice_no = ? AND status = 'PAID'").get(ledgerInvoiceNo(inv.invoice_no, inv.vendor)) as PaidPayout | undefined;
      if (!paid) continue;
      // Booked only as the CFO signed it: the same hash the executor checked before the payment is checked again here.
      const wrong = bookingProblem(db, inv.proposal_id!, paid);
      if (wrong) {
        if (!db.prepare("SELECT 1 FROM audit_log WHERE event = 'ap.booking_refused' AND subject = ? AND json_extract(payload_json, '$.reason') = ?").get(inv.id, wrong)) {
          audit(db, "system", "ap.booking_refused", inv.id, { proposal_id: inv.proposal_id, reason: wrong, note: "not booked as paid; a person checks the payout against what the CFO signed" }, now);
        }
        continue;
      }
      const next = setStatus(db, inv.id, "paid", "awx-executor", { paid_at: now.toISOString(), reason: `paid under ${inv.proposal_id}` }, now);
      clearStaleNote(db, inv.id);
      // The accrual first if the sink never got it (a supplier added by the executor, a sink that was down), then the payment.
      await pushOnce(db, opts.sink, "accrual", accrualEntries(next), next, now);
      await pushOnce(db, opts.sink, "payment", paymentEntries(db, next), next, now);
      changed.push(next);
    }
  }
  return changed;
}

/** The states a person may reject an invoice from on the page: never one filed for the CFO, paid or rejected. */
const REJECTABLE = new Set(["blocked", "needs_review", "needs_vendor", "ready"]);

/**
 * A person rejects an invoice on the payables page: it is never paid, with the reason in the audit log. One filed for
 * the CFO is approved or rejected on the phone only; a paid one is never undone here. The accrual a sink already holds
 * is taken back there, as when the CFO rejects (the stored ledger reverses it on its next sync, src/ledger/feed.ts).
 */
export async function rejectApInvoice(db: DB, id: string, reason: string, deps: Pick<InboxDeps, "sink">, now = new Date()): Promise<ApInvoiceRow> {
  const inv = apInvoice(db, id);
  if (!inv) throw new Error(`no payables invoice ${id}`);
  const why = cleanText(reason, 300);
  if (!why) throw new Error("say why it is rejected: the reason is kept with the invoice");
  if (inv.status === "waiting_cfo") throw new Error(`${id} waits for the CFO's Face ID: approve or reject it on the phone`);
  if (!REJECTABLE.has(inv.status)) throw new Error(`${id} is ${inv.status.replace(/_/g, " ")} already; it cannot be rejected`);
  const next = setStatus(db, id, "rejected", "human", { reason: `rejected on the payables page: ${why}` }, now);
  clearStaleNote(db, id);
  if (deps.sink && accrualPushed(db, next, deps.sink)) await pushOnce(db, deps.sink, "reversal", reversalEntries(next, now.toISOString().slice(0, 10), "a person rejected the invoice"), next, now);
  return next;
}
