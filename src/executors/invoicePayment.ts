// Executes an approved invoice_payment: the conversion (if any) on the approved quote, then the SWIFT
// transfer, both carrying the approval hash in metadata and built only from the approved terms.
// Transfer lifecycle: SUBMITTING (row written before the call) -> SENT -> PAID, or FAILED -> CANCELLED.
// A lost answer is resolved by looking the request_id up, never by a blind resend with a new id.

import { AirwallexAmbiguous, AirwallexError } from "../airwallex/client.js";
import type { AirwallexRail, SandboxSim, Transfer } from "../airwallex/port.js";
import { audit } from "../audit/log.js";
import type { DB } from "../db/open.js";
import { fromCents, toCents } from "../lib/money.js";
import { beginExecution, finishExecution } from "../policy/approvals.js";
import { snapshot, treasuryState, type InvoicePaymentTerms } from "../agents/euroBill.js";

export interface InvoicePaymentResult {
  conversionId: string | null;
  transfer: Transfer;
}

export async function executeInvoicePayment(db: DB, rail: AirwallexRail, sim: SandboxSim | null, proposalId: string, now = () => new Date()): Promise<InvoicePaymentResult> {
  const pre = treasuryState(db, await snapshot(db, rail, `pre-exec:${proposalId}`));
  const sha = (db.prepare("SELECT terms_sha256 FROM proposals WHERE proposal_id = ?").get(proposalId) as { terms_sha256: string }).terms_sha256;

  const terms = beginExecution<InvoicePaymentTerms>(db, proposalId, (t) => {
    if (t.conversion) {
      if (Date.parse(t.conversion.valid_to) - 30_000 <= now().getTime()) throw new Error(`quote ${t.conversion.quote_id} expired at ${t.conversion.valid_to}; approval void`);
      const q = db.prepare("SELECT used_by_conversion FROM fx_quotes WHERE quote_id = ?").get(t.conversion.quote_id) as { used_by_conversion: string | null } | undefined;
      if (!q) throw new Error(`unknown quote ${t.conversion.quote_id}`);
      if (q.used_by_conversion && q.used_by_conversion !== t.conversion.request_id) throw new Error(`quote ${t.conversion.quote_id} was already used`);
      if (pre.usdAvailableCents - toCents(t.conversion.sell_amount) < pre.usdFloorCents) throw new Error("USD would now drop under its floor; a new proposal is needed");
    }
    const eurAfter = pre.eurAvailableCents + (t.conversion ? toCents(t.conversion.buy_amount) : 0);
    if (eurAfter - toCents(t.amount) - toCents(t.fee_max) < pre.eurFloorCents + pre.eurObligationsCents) {
      throw new Error("EUR would now drop under its floor and commitments; a new proposal is needed");
    }
  }, now());

  let conversionId: string | null = null;
  try {
    if (terms.conversion) {
      const c = terms.conversion;
      const done = db.prepare("SELECT conversion_id FROM fx_conversions WHERE request_id = ?").get(c.request_id) as { conversion_id: string } | undefined;
      if (done) conversionId = done.conversion_id;
      else {
        // Single use in code: Airwallex itself accepts a reused quote under a new request_id.
        db.prepare("UPDATE fx_quotes SET used_by_conversion = ? WHERE quote_id = ? AND (used_by_conversion IS NULL OR used_by_conversion = ?)").run(c.request_id, c.quote_id, c.request_id);
        const conv = await rail.createConversion({
          requestId: c.request_id,
          quote: { quoteId: c.quote_id, buyCurrency: c.buy_currency, sellCurrency: c.sell_currency, buyAmountCents: toCents(c.buy_amount), sellAmountCents: toCents(c.sell_amount), clientRate: c.client_rate, validFrom: "", validTo: c.valid_to },
          approvalSha256: sha,
        });
        db.prepare("INSERT INTO fx_conversions (conversion_id, quote_id, request_id, buy_amount, sell_amount, status, approval_sha256) VALUES (?, ?, ?, ?, ?, ?, ?)")
          .run(conv.conversionId, c.quote_id, c.request_id, fromCents(conv.buyAmountCents), fromCents(conv.sellAmountCents), conv.status, sha);
        audit(db, "awx-executor", "fx.converted", conv.conversionId, { quote_id: c.quote_id, request_id: c.request_id, buy: `EUR ${fromCents(conv.buyAmountCents)}`, sell: `USD ${fromCents(conv.sellAmountCents)}`, approval_sha256: sha });
        conversionId = conv.conversionId;
      }
    }

    const transfer = await submitTransfer(db, rail, terms, sha);
    const final = sim ? await settleInSandbox(db, rail, sim, transfer) : transfer;
    recordFee(db, final, terms, sha);
    await snapshot(db, rail, `post-exec:${proposalId}`);
    finishExecution(db, proposalId, final.status === "PAID" ? "EXECUTED" : "FAILED", { conversion_id: conversionId, transfer_id: final.id, status: final.status });
    return { conversionId, transfer: final };
  } catch (err) {
    finishExecution(db, proposalId, err instanceof AirwallexError && err.code === "expired_quote" ? "NEEDS_REAPPROVAL" : "FAILED", { error: (err as Error).message });
    throw err;
  }
}

async function submitTransfer(db: DB, rail: AirwallexRail, t: InvoicePaymentTerms, sha: string): Promise<Transfer> {
  const existing = db.prepare("SELECT transfer_id, status FROM transfers WHERE request_id = ?").get(t.transfer_request_id) as { transfer_id: string | null; status: string } | undefined;
  if (existing?.transfer_id) return rail.getTransfer(existing.transfer_id);
  if (!existing) {
    // Written before the call: the partial unique index allows one live payout per invoice.
    db.prepare("INSERT INTO transfers (request_id, invoice_no, amount, currency, method, fee_estimate, status, approval_sha256, updated_at) VALUES (?, ?, ?, 'EUR', 'SWIFT', ?, 'SUBMITTING', ?, ?)")
      .run(t.transfer_request_id, t.invoice_no, t.amount, t.fee_max, sha, new Date().toISOString());
  }
  const req = { requestId: t.transfer_request_id, beneficiaryId: t.beneficiary_id, amountCents: toCents(t.amount), currency: "EUR" as const, sourceCurrency: "EUR" as const, reference: t.reference, reason: t.reason, approvalSha256: sha };
  let tr: Transfer;
  try {
    tr = await rail.createTransfer(req);
  } catch (err) {
    if (!(err instanceof AirwallexAmbiguous)) throw err;
    const found = await rail.findTransferByRequestId(t.transfer_request_id);
    audit(db, "awx-executor", "transfer.ambiguous", t.transfer_request_id, { resolved: found ? "adopted" : "resent with the same request_id" });
    tr = found ?? (await rail.createTransfer(req));
  }
  db.prepare("UPDATE transfers SET transfer_id = ?, status = ?, updated_at = ? WHERE request_id = ?").run(tr.id, tr.status, new Date().toISOString(), t.transfer_request_id);
  audit(db, "awx-executor", "transfer.created", tr.id, { request_id: t.transfer_request_id, amount: `EUR ${t.amount}`, beneficiary_id: t.beneficiary_id, status: tr.status, approval_sha256: sha });
  return tr;
}

/** The fee is only known once Airwallex charges it: record it, and flag it if it broke the approved ceiling. */
function recordFee(db: DB, tr: Transfer, t: InvoicePaymentTerms, sha: string): void {
  if (!tr.fee) return;
  const actual = `${tr.fee.currency} ${fromCents(tr.fee.cents)}`;
  db.prepare("UPDATE transfers SET fee_actual = ? WHERE transfer_id = ?").run(actual, tr.id);
  const withinMax = tr.fee.currency === "EUR" && tr.fee.cents <= toCents(t.fee_max);
  audit(db, "awx-executor", withinMax ? "transfer.fee" : "transfer.fee_over_ceiling", tr.id, { fee: actual, fee_max: `EUR ${t.fee_max}`, approval_sha256: sha });
}

/** Sandbox only: the transfer goes SENT, then PAID. Status is read back, never assumed. */
async function settleInSandbox(db: DB, rail: AirwallexRail, sim: SandboxSim, tr: Transfer): Promise<Transfer> {
  let cur = await rail.getTransfer(tr.id);
  for (const to of ["SENT", "PAID"] as const) {
    if (cur.status === "PAID") break;
    if (to === "SENT" && cur.status === "SENT") continue;
    await sim.transitionTransfer(tr.id, to);
    cur = await rail.getTransfer(tr.id);
    db.prepare("UPDATE transfers SET status = ?, failure_type = ?, failure_reason = ?, updated_at = ? WHERE transfer_id = ?")
      .run(cur.status, cur.failureType ?? null, cur.failureReason ?? null, new Date().toISOString(), tr.id);
    audit(db, "awx-executor", "transfer.status", tr.id, { status: cur.status });
  }
  return cur;
}
