// Payables, part 3: paying a ready invoice. A supplier added through the inbox (payee_add, any country and currency)
// is paid in the invoice's own currency on its route (supplier_payment, src/payouts/plan.ts); a Kit 11 payee on file
// in EUR still goes through the existing invoice payment (src/agents/euroBill.ts). Either way the plan keeps the reserve
// floors, buys only the shortfall, holds a fee reserve and guards against paying twice, and the CFO approves the terms
// with Face ID before an executor pays. Nothing here moves money or approves anything. syncPayments follows each
// proposal: paid once the ledger's transfer is PAID.

import { readFileSync } from "node:fs";
import type { AirwallexRail, PayoutRail } from "../airwallex/port.js";
import { proposeInvoicePayment, type InvoiceOutcome } from "../agents/euroBill.js";
import type { DB } from "../db/open.js";
import { accrualEntries, accrualPushed, paymentEntries, pushOnce, reversalEntries, type BookkeepingSink } from "./books.js";
import { expireDue } from "../policy/approvals.js";
import { pdfText } from "./pdfText.js";
import type { Asker } from "./read.js";
import { writeReviewNote } from "./review.js";
import { ledgerInvoiceNo } from "./ledgerKey.js";
import { apInvoice, apInvoices, setStatus, type ApInvoiceRow, type Finding } from "./store.js";
import { payoutBeneficiary, proposeSupplierPayment, type SupplierPaymentOutcome } from "../payouts/plan.js";
import { payableCurrency } from "../payouts/routes.js";

export type PayOutcome = InvoiceOutcome | SupplierPaymentOutcome;

export async function payApInvoice(db: DB, rail: AirwallexRail & PayoutRail, id: string, now = new Date(), reader?: Asker): Promise<PayOutcome> {
  const inv = apInvoice(db, id);
  if (!inv) throw new Error(`no payables invoice ${id}`);
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
  // A supplier added through the inbox carries its route; a Kit 11 payee on file is paid in EUR as before.
  const out: PayOutcome = payoutBeneficiary(db, r.vendor) || r.currency !== "EUR"
    ? await proposeSupplierPayment(db, rail, { invoice_no: invoiceNo, vendor: r.vendor, amount: r.total, currency: r.currency, due_date: due, reference: r.reference || r.invoice_no }, text, now)
    : await proposeInvoicePayment(db, rail, { invoice_no: invoiceNo, vendor: r.vendor, amount: r.total, currency: r.currency, due_date: due, iban: r.iban, bic: r.bic, reference: r.reference || r.invoice_no }, text, now);
  if (out.kind === "proposed") {
    setStatus(db, id, "waiting_cfo", "treasury", { proposal_id: out.proposal.proposal_id, reason: "payment filed for the CFO's Face ID" }, now);
    // Opus's advisory note goes with the proposal the CFO sees (its explanation; never part of the signed terms).
    const noted = await writeReviewNote(db, reader, id, now);
    db.prepare("UPDATE proposals SET explanation = ? WHERE proposal_id = ? AND explanation IS NULL").run(noted.review_note, out.proposal.proposal_id);
    return out;
  }
  // Not planned (the reserve is short, a quote refused, a duplicate found late): the invoice stays as it is, with the reason.
  const findings: Finding[] = [...inv.findings.filter((f) => f.code !== "payment_not_planned"), { code: "payment_not_planned", level: "warn", detail: `the payment could not be planned: ${out.reason}` }];
  setStatus(db, id, "fraud" in out && out.fraud?.suspicious ? "blocked" : inv.status, "treasury", { findings, reason: out.reason }, now);
  return out;
}

/** Follows each invoice waiting for the CFO: paid when its transfer is PAID; rejected; or ready again when its terms ran out. */
export async function syncPayments(db: DB, opts: { now?: () => Date; sink?: BookkeepingSink } = {}): Promise<ApInvoiceRow[]> {
  const now = (opts.now ?? (() => new Date()))();
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
      // The accrual a sink already holds is taken back there, so the payable is closed in the books too.
      if (opts.sink && accrualPushed(db, next, opts.sink)) await pushOnce(db, opts.sink, "reversal", reversalEntries(next, now.toISOString().slice(0, 10)), next, now);
      changed.push(next);
    } else if (["EXPIRED", "FAILED", "NEEDS_REAPPROVAL", "SUPERSEDED"].includes(p.status)) {
      changed.push(setStatus(db, inv.id, "ready", "system", { proposal_id: null, reason: `${inv.proposal_id} ${p.status.toLowerCase()}; it can be filed again` }, now));
    } else if (p.status === "EXECUTED") {
      const paid = db.prepare("SELECT 1 FROM transfers WHERE invoice_no = ? AND status = 'PAID'").get(ledgerInvoiceNo(inv.invoice_no, inv.vendor));
      if (!paid) continue;
      const next = setStatus(db, inv.id, "paid", "awx-executor", { paid_at: now.toISOString(), reason: `paid under ${inv.proposal_id}` }, now);
      // The accrual first if the sink never got it (a supplier added by the executor, a sink that was down), then the payment.
      await pushOnce(db, opts.sink, "accrual", accrualEntries(next), next, now);
      await pushOnce(db, opts.sink, "payment", paymentEntries(db, next), next, now);
      changed.push(next);
    }
  }
  return changed;
}
