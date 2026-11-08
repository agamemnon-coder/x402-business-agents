// Payables, part 3: paying a ready invoice. The existing invoice payment does the work (src/agents/euroBill.ts:
// reserve floors, FX for the shortfall only, the fee reserve, the duplicate guard, the fraud check again) and files an
// invoice_payment proposal; the CFO approves it with Face ID; the existing executor pays by SWIFT. Nothing here moves
// money or approves anything. syncPayments follows each proposal: paid once the ledger's transfer is PAID.

import { readFileSync } from "node:fs";
import type { AirwallexRail } from "../airwallex/port.js";
import { proposeInvoicePayment, type InvoiceOutcome } from "../agents/euroBill.js";
import type { DB } from "../db/open.js";
import { paymentEntries, pushToSink, type BookkeepingSink } from "./books.js";
import { audit } from "../audit/log.js";
import { pdfText } from "./pdfText.js";
import type { Asker } from "./read.js";
import { writeReviewNote } from "./review.js";
import { apInvoice, apInvoices, setStatus, type ApInvoiceRow, type Finding } from "./store.js";

export async function payApInvoice(db: DB, rail: AirwallexRail, id: string, now = new Date(), reader?: Asker): Promise<InvoiceOutcome> {
  const inv = apInvoice(db, id);
  if (!inv) throw new Error(`no payables invoice ${id}`);
  if (inv.status !== "ready") {
    const why = inv.findings.filter((f) => f.level !== "warn").map((f) => f.detail).join("; ");
    throw new Error(`${id} is ${inv.status.replace(/_/g, " ")}, not ready to pay${why ? `: ${why}` : ""}`);
  }
  if (inv.currency !== "EUR") throw new Error(`${id} is in ${inv.currency}; Purser pays EUR only in this version`);
  const doc = db.prepare("SELECT path FROM ap_documents WHERE sha256 = ?").get(inv.doc_sha256) as { path: string };
  const text = (await pdfText(readFileSync(doc.path))).text;
  const r = inv.reading;
  const out = await proposeInvoicePayment(db, rail, {
    invoice_no: r.invoice_no, vendor: r.vendor, amount: r.total, currency: r.currency, due_date: r.due_date || now.toISOString().slice(0, 10),
    iban: r.iban, bic: r.bic, reference: r.reference || r.invoice_no,
  }, text, now);
  if (out.kind === "proposed") {
    setStatus(db, id, "waiting_cfo", "treasury", { proposal_id: out.proposal.proposal_id, reason: "payment filed for the CFO's Face ID" }, now);
    // Opus's advisory note goes with the proposal the CFO sees (its explanation; never part of the signed terms).
    const noted = await writeReviewNote(db, reader, id, now);
    db.prepare("UPDATE proposals SET explanation = ? WHERE proposal_id = ? AND explanation IS NULL").run(noted.review_note, out.proposal.proposal_id);
    return out;
  }
  // Not planned (the reserve is short, a quote refused, a duplicate found late): the invoice stays as it is, with the reason.
  const findings: Finding[] = [...inv.findings.filter((f) => f.code !== "payment_not_planned"), { code: "payment_not_planned", level: "warn", detail: `the payment could not be planned: ${out.reason}` }];
  setStatus(db, id, out.fraud?.suspicious ? "blocked" : inv.status, "treasury", { findings, reason: out.reason }, now);
  return out;
}

/** Follows each invoice waiting for the CFO: paid when its transfer is PAID; rejected; or ready again when its terms ran out. */
export async function syncPayments(db: DB, opts: { now?: () => Date; sink?: BookkeepingSink } = {}): Promise<ApInvoiceRow[]> {
  const now = (opts.now ?? (() => new Date()))();
  const changed: ApInvoiceRow[] = [];
  for (const inv of apInvoices(db, { status: "waiting_cfo" })) {
    const p = inv.proposal_id ? db.prepare("SELECT status FROM proposals WHERE proposal_id = ?").get(inv.proposal_id) as { status: string } | undefined : undefined;
    if (!p) continue;
    if (p.status === "REJECTED") {
      changed.push(setStatus(db, inv.id, "rejected", "human", { reason: `the CFO rejected ${inv.proposal_id}` }, now));
    } else if (p.status === "EXPIRED" || p.status === "FAILED") {
      changed.push(setStatus(db, inv.id, "ready", "system", { proposal_id: null, reason: `${inv.proposal_id} ${p.status.toLowerCase()}; it can be filed again` }, now));
    } else if (p.status === "EXECUTED") {
      const paid = db.prepare("SELECT 1 FROM transfers WHERE invoice_no = ? AND status = 'PAID'").get(inv.invoice_no);
      if (!paid) continue;
      const next = setStatus(db, inv.id, "paid", "awx-executor", { paid_at: now.toISOString(), reason: `paid under ${inv.proposal_id}` }, now);
      const failed = await pushToSink(opts.sink, paymentEntries(db, next), next);
      if (failed) audit(db, "system", "ap.sink_failed", inv.id, { sink: failed }, now);
      changed.push(next);
    }
  }
  return changed;
}
