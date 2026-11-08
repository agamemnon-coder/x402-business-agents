// Executes an approved supplier_payment (src/payouts/plan.ts): the conversion on the approved quote, if any, then the
// payout in the invoice's currency on the approved method, both carrying the approval hash and built only from the
// approved terms. Each runs under its own request_id as a saga step (src/policy/saga.ts): after a crash a step that
// started is finished, never made twice. A lost answer is resolved by a strict look-up by request_id, never a blind
// resend; a transfer found that way is adopted only if it is exactly this payout (amount, currency, payee).

import { AirwallexAmbiguous, AirwallexError } from "../airwallex/client.js";
import type { PayoutRail, SandboxSim, Transfer } from "../airwallex/port.js";
import { audit } from "../audit/log.js";
import type { DB } from "../db/open.js";
import { fromCents, toCents } from "../lib/money.js";
import { sameInvoiceNo } from "../lib/invoiceKey.js";
import { beginExecution, finishExecution } from "../policy/approvals.js";
import { counterpartyAllowed, frozen, paused } from "../policy/rules.js";
import { step } from "../policy/saga.js";
import { stopped } from "../policy/velocity.js";
import { originJson } from "../provenance/origin.js";
import { freeCents, type SupplierPaymentTerms } from "../payouts/plan.js";

export async function executeSupplierPayment(db: DB, rail: PayoutRail, sim: SandboxSim | null, proposalId: string, now = () => new Date()): Promise<{ conversionId: string | null; transfer: Transfer }> {
  const sha = (db.prepare("SELECT terms_sha256 FROM proposals WHERE proposal_id = ?").get(proposalId) as { terms_sha256: string }).terms_sha256;
  const begun = (name: string) => !!db.prepare("SELECT 1 FROM money_steps WHERE action_id = ? AND step = ?").get(proposalId, name);
  const pre = await rail.balancesAll();

  const terms = beginExecution<SupplierPaymentTerms>(db, proposalId, (t) => {
    if (t.kind !== "supplier_payment") throw new Error(`${proposalId} is not a supplier payment`);
    const held = holdReason(db, t);
    if (held) throw new Error(held);
    const other = (db.prepare("SELECT invoice_no, status FROM transfers WHERE request_id <> ? AND status <> 'CANCELLED'").all(t.transfer_request_id) as { invoice_no: string; status: string }[])
      .find((r) => sameInvoiceNo(r.invoice_no, t.invoice_no));
    if (other) throw new Error(`invoice ${t.invoice_no} ${other.status === "PAID" ? "is already paid" : `already has a payout (${other.status})`} by another proposal; nothing is converted or paid`);
    if (begun("transfer")) return;
    if (t.conversion && !begun("conversion")) {
      if (Date.parse(t.conversion.valid_to) - 30_000 <= now().getTime()) throw new Error(`quote ${t.conversion.quote_id} expired at ${t.conversion.valid_to}; approval void`);
      const q = db.prepare("SELECT used_by_conversion FROM fx_quotes WHERE quote_id = ?").get(t.conversion.quote_id) as { used_by_conversion: string | null } | undefined;
      if (!q) throw new Error(`unknown quote ${t.conversion.quote_id}`);
      if (q.used_by_conversion && q.used_by_conversion !== t.conversion.request_id) throw new Error(`quote ${t.conversion.quote_id} was already used`);
      if (freeCents(db, pre, t.conversion.sell_currency) - toCents(t.conversion.sell_amount) < 0) throw new Error(`${t.conversion.sell_currency} would now drop under its floor; a new proposal is needed`);
    }
    if (begun("conversion")) return;
    const after = freeCents(db, pre, t.currency, t.transfer_request_id) + (t.conversion ? toCents(t.conversion.buy_amount) : 0);
    if (after - toCents(t.amount) - toCents(t.fee_reserve) < 0) throw new Error(`${t.currency} would now drop under its floor, commitments and payouts under way; a new proposal is needed`);
  }, now());

  let conversionId: string | null = null;
  try {
    if (terms.conversion) {
      const c = terms.conversion;
      const conv = await step(db, proposalId, 1, "conversion", c.request_id, async (retry) => {
        db.prepare("UPDATE fx_quotes SET used_by_conversion = ? WHERE quote_id = ? AND (used_by_conversion IS NULL OR used_by_conversion = ?)").run(c.request_id, c.quote_id, c.request_id);
        const found = retry ? await rail.findConversionByRequestId(c.request_id) : undefined;
        const made = found ?? await rail.createConversionAny({
          requestId: c.request_id, approvalSha256: sha,
          quote: { quoteId: c.quote_id, buyCurrency: c.buy_currency, sellCurrency: c.sell_currency, buyAmountCents: toCents(c.buy_amount), sellAmountCents: toCents(c.sell_amount), clientRate: c.client_rate, validFrom: "", validTo: c.valid_to },
        });
        return { conversionId: made.conversionId, buyAmountCents: made.buyAmountCents, sellAmountCents: made.sellAmountCents, status: made.status, adopted: !!found };
      }, now);
      const added = db.prepare("INSERT OR IGNORE INTO fx_conversions (conversion_id, quote_id, request_id, buy_amount, sell_amount, status, approval_sha256) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(conv.conversionId, c.quote_id, c.request_id, fromCents(conv.buyAmountCents), fromCents(conv.sellAmountCents), conv.status, sha);
      if (added.changes === 1) {
        audit(db, "awx-executor", conv.adopted ? "fx.adopted" : "fx.converted", conv.conversionId,
          { quote_id: c.quote_id, request_id: c.request_id, buy: `${c.buy_currency} ${fromCents(conv.buyAmountCents)}`, sell: `${c.sell_currency} ${fromCents(conv.sellAmountCents)}`, approval_sha256: sha });
      }
      conversionId = conv.conversionId;
    }

    if (!begun("transfer")) {
      // On fresh balances, now any conversion is in them: the payout still keeps the floor (this payout's own row excepted).
      const fresh = await rail.balancesAll();
      if (freeCents(db, fresh, terms.currency, terms.transfer_request_id) - toCents(terms.amount) - toCents(terms.fee_reserve) < 0) {
        throw new Error(`${terms.currency} would now drop under its floor, commitments and payouts under way; a new proposal is needed`);
      }
    }
    const transfer = await step(db, proposalId, 2, "transfer", terms.transfer_request_id, () => submit(db, rail, terms, sha), now);
    const final = sim ? await step(db, proposalId, 3, "settle", transfer.id, () => settleInSandbox(db, rail, sim, transfer), now) : transfer;
    recordFee(db, final, terms, sha);
    const failed = final.status === "FAILED" || final.status === "CANCELLED";
    finishExecution(db, proposalId, failed ? "FAILED" : "EXECUTED", { conversion_id: conversionId, transfer_id: final.id, status: final.status });
    return { conversionId, transfer: final };
  } catch (err) {
    finishExecution(db, proposalId, (err as { code?: string }).code === "expired_quote" ? "NEEDS_REAPPROVAL" : "FAILED", { error: (err as Error).message });
    throw err;
  }
}

/** Why nothing may be paid now, or null: the CFO's holds, the treasury agent's stops, and the approved payee still on file. */
function holdReason(db: DB, t: SupplierPaymentTerms): string | null {
  if (!counterpartyAllowed(db, t.beneficiary_name)) return `${t.beneficiary_name} is blocked by the CFO policy; nothing is paid`;
  if (frozen(db)) return "the CFO pulled the emergency stop; nothing is paid until it is lifted";
  if (stopped(db, "treasury")) return "the treasury agent was stopped automatically (velocity limit); nothing is paid until the CFO lifts the stop";
  if (paused(db, "treasury")) return "the treasury agent is paused by the CFO; nothing is paid until the CFO resumes it with Face ID";
  const b = db.prepare("SELECT status, currency FROM beneficiaries WHERE beneficiary_id = ?").get(t.beneficiary_id) as { status: string; currency: string } | undefined;
  if (!b || b.status !== "ACTIVE") return `the approved account of ${t.beneficiary_name} is no longer the one on file; nothing is paid (a new proposal pays it)`;
  if (b.currency !== t.currency) return `the approved account receives ${b.currency}, not ${t.currency}; nothing is paid`;
  return null;
}

/** This payout's own transfer: our request_id, amount, currency and payee. */
function isThis(found: Transfer, t: SupplierPaymentTerms): boolean {
  return found.requestId === t.transfer_request_id && found.amountCents === toCents(t.amount) && found.currency === t.currency
    && (found.beneficiaryId == null || found.beneficiaryId === t.beneficiary_id);
}

async function submit(db: DB, rail: PayoutRail, t: SupplierPaymentTerms, sha: string): Promise<Transfer> {
  const at = () => new Date().toISOString();
  db.prepare("INSERT OR IGNORE INTO transfers (request_id, invoice_no, amount, currency, method, fee_estimate, status, approval_sha256, updated_at, origin_json) VALUES (?, ?, ?, ?, ?, ?, 'SUBMITTING', ?, ?, ?)")
    .run(t.transfer_request_id, t.invoice_no, t.amount, t.currency, t.method, t.fee_reserve, sha, at(), originJson());
  const close = (status: string, why: Record<string, unknown>) => {
    db.prepare("UPDATE transfers SET status = ?, failure_reason = ?, updated_at = ? WHERE request_id = ? AND status = 'SUBMITTING'").run(status, String(why.error ?? ""), at(), t.transfer_request_id);
    audit(db, "awx-executor", "transfer.refused", t.transfer_request_id, { request_id: t.transfer_request_id, amount: `${t.currency} ${t.amount}`, approval_sha256: sha, ...why });
  };
  let tr: Transfer;
  try {
    tr = await rail.createPayoutTransfer({
      requestId: t.transfer_request_id, beneficiaryId: t.beneficiary_id, amountCents: toCents(t.amount), currency: t.currency, sourceCurrency: t.currency,
      method: t.method, reference: t.reference, reason: t.reason, approvalSha256: sha,
    });
  } catch (e) {
    if (e instanceof AirwallexAmbiguous) {
      // The answer was lost: Airwallex may hold the transfer. Look it up by request_id; never resend blind.
      const found = await rail.findTransferByRequestIdStrict(t.transfer_request_id);
      if (!found) { audit(db, "awx-executor", "transfer.left_open", t.transfer_request_id, { request_id: t.transfer_request_id, reason: "the answer was lost and no transfer is found under the request_id yet" }); throw e; }
      if (!isThis(found, t)) throw new Error(`Airwallex holds transfer ${found.id} under this request_id, but not for this payout; a person checks it (npm run reconcile)`, { cause: e });
      tr = found;
      audit(db, "awx-executor", "transfer.adopted", tr.id, { request_id: t.transfer_request_id, amount: `${t.currency} ${t.amount}`, approval_sha256: sha });
    } else {
      // A documented refusal (4xx): no transfer exists under this request_id; the row is closed with the reason.
      const code = e instanceof AirwallexError ? e.code ?? String(e.status) : (e as { code?: string }).code ?? "error";
      close("CANCELLED", { error: (e as Error).message, code });
      throw e;
    }
  }
  db.prepare("UPDATE transfers SET transfer_id = ?, status = ?, updated_at = ? WHERE request_id = ?").run(tr.id, tr.status, at(), t.transfer_request_id);
  audit(db, "awx-executor", "transfer.created", tr.id, { request_id: t.transfer_request_id, amount: `${t.currency} ${t.amount}`, method: t.method, beneficiary_id: t.beneficiary_id, status: tr.status, approval_sha256: sha });
  return tr;
}

/** Sandbox only: Purser moves the transfer to SENT, then PAID, through Airwallex's simulation API (the settlement is simulated). */
async function settleInSandbox(db: DB, rail: PayoutRail, sim: SandboxSim, tr: Transfer): Promise<Transfer> {
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

/** The fee Airwallex charged, recorded; above the reserve the CFO approved, it is flagged for a person. */
function recordFee(db: DB, tr: Transfer, t: SupplierPaymentTerms, sha: string): void {
  if (!tr.fee) return;
  const actual = `${tr.fee.currency} ${fromCents(tr.fee.cents)}`;
  db.prepare("UPDATE transfers SET fee_actual = ? WHERE transfer_id = ?").run(actual, tr.id);
  const within = tr.fee.currency === t.currency && tr.fee.cents <= toCents(t.fee_reserve);
  audit(db, "awx-executor", within ? "transfer.fee" : "transfer.fee_over_reserve", tr.id, { fee: actual, fee_reserve: `${t.currency} ${t.fee_reserve}`, approval_sha256: sha });
}
