// The runner's side of learning from the CFO's past decisions (src/learning/precedent.ts): the labelled cases in its own
// audit log, with each proposal's supplier and amount from its signed terms or its invoice. Read only.

import type { DB } from "../db/open.js";
import type { ApReading } from "../ap/reading.js";
import { casesFromAudit, centsOf, precedentsFor, type AuditLike, type LabelledCase, type Precedent, type ProposalFacts } from "./precedent.js";

/** Every labelled case in this runner's records, oldest first. */
export function labelledCases(db: DB): LabelledCase[] {
  const rows = db.prepare("SELECT seq, ts, actor, event, subject, payload_json FROM audit_log WHERE event IN ('proposal.created', 'proposal.approved', 'proposal.rejected', 'proposal.expired', 'proposal.superseded', 'card.charge_declined', 'card.decline_met', 'ap.checker_decided') ORDER BY seq").all() as AuditLike[];
  const terms = db.prepare("SELECT terms_json FROM proposals WHERE proposal_id = ?");
  const invoiceByProposal = db.prepare("SELECT id, vendor, total, currency FROM ap_invoices WHERE proposal_id = ?");
  const invoiceById = db.prepare("SELECT id, vendor, total, currency FROM ap_invoices WHERE id = ?");
  type Inv = { id: string; vendor: string; total: string; currency: string } | undefined;
  const ofInvoice = (i: Inv): ProposalFacts | null => (i ? { counterparty: i.vendor || null, currency: i.currency || null, amountCents: centsOf(i.total), invoice: i.id } : null);
  return casesFromAudit(rows, (ref) => {
    if (/^AP-/.test(ref)) return ofInvoice(invoiceById.get(ref) as Inv);
    const inv = ofInvoice(invoiceByProposal.get(ref) as Inv);
    if (inv) return inv;
    const t = terms.get(ref) as { terms_json: string } | undefined;
    if (!t) return null;
    const x = JSON.parse(t.terms_json) as Record<string, unknown>;
    const party = [x.vendor, x.beneficiary_name, x.payee, x.merchant].find((v) => typeof v === "string" && v !== "") as string | undefined;
    return { counterparty: party ?? null, currency: typeof x.currency === "string" ? x.currency : null, amountCents: centsOf(x.amount), invoice: null };
  });
}

/** The precedent for the Checker's decision on an invoice: the CFO's past decisions on this supplier and amount band. */
export function invoicePrecedents(db: DB, invoiceId: string | null, r: Pick<ApReading, "vendor" | "currency" | "total">, at: string | null, k = 5): Precedent[] {
  return precedentsFor(labelledCases(db), { category: "supplier_payment", counterparty: r.vendor || null, currency: r.currency || null, amountCents: centsOf(r.total), ref: invoiceId, invoice: invoiceId, at }, k);
}
