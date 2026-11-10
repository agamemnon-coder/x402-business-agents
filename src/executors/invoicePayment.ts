// Executes an approved invoice_payment: the conversion (if any) on the approved quote, then the SWIFT
// transfer, both carrying the approval hash in metadata and built only from the approved terms.
// Transfer lifecycle: SUBMITTING (row written before the call) -> SENT -> PAID, or FAILED -> CANCELLED; or
// SUBMITTING -> CANCELLED when Airwallex refuses the first create outright (a documented 400: no transfer exists).
// A resend under the same request_id never closes the row on Airwallex's answer alone: Airwallex may hold an earlier
// send, whatever it answers. The fee retry's attempts 2 to 6 are such resends, so after them the row is closed only when
// a strict look-up by request_id finds nothing; a transfer found is adopted (if it is this payout), and a look-up that
// fails leaves the row SUBMITTING (transfer.left_open). A resend from a later run (a re-run, a resume) never closes it.
// A lost answer is resolved by looking the request_id up, never by a blind resend with a new id; a transfer found that
// way, or named by duplicate_request_id, is adopted only if it is exactly this payout (amount, currency, payee).

import { SWIFT_FEE_MAX_EUR_CENTS } from "../config/policy.js";
import { originJson } from "../provenance/origin.js";
import { counterpartyAllowed, frozen, paused } from "../policy/rules.js";
import { stopped } from "../policy/velocity.js";
import { AIRWALLEX_FEE_CODES, AirwallexAmbiguous, AirwallexError } from "../airwallex/client.js";
import type { AirwallexRail, NewTransfer, SandboxSim, Transfer } from "../airwallex/port.js";
import { audit } from "../audit/log.js";
import type { DB } from "../db/open.js";
import { fromCents, toCents } from "../lib/money.js";
import { beginExecution, finishExecution } from "../policy/approvals.js";
import { checkPayingAccount } from "../airwallex/binding.js";
import { takePlatformFee } from "./supplierPayment.js";
import type { PlatformFields, SupplierPaymentTerms } from "../payouts/plan.js";
import { partyOf, snapshot, treasuryState, type InvoicePaymentTerms } from "../agents/euroBill.js";
import { sameLedgerInvoice } from "../lib/invoiceKey.js";
import { eurInFlightCents } from "../policy/available.js";
import { exclusive, heldPayoutCents, holdPayout, releasePayout } from "../policy/payoutLock.js";
import { checkpoint, step } from "../policy/saga.js";
import { authorize } from "../policy/principals.js";

export interface InvoicePaymentResult {
  conversionId: string | null;
  transfer: Transfer;
}

/**
 * What this payment takes from the EUR balance as signed: the amount, the fee reserve and Purser's fee (on this route
 * too since 9 November). Purser's fee is held from here until it is settled (src/policy/payoutLock.ts).
 */
const outCents = (t: InvoicePaymentTerms) => toCents(t.amount) + toCents(t.fee_max) + toCents((t as PlatformFields).platform_fee?.amount ?? "0.00");

/** The retry of a transfer create that Airwallex refused for its own fee configuration (see FEE_RETRY_CODES). */
export interface FeeRetry {
  /** The wait before each retry, in order: as many retries as entries. */
  delaysMs: readonly number[];
  sleep: (ms: number) => Promise<void>;
}

/**
 * Live: 15, 30, 60, 90 and 120 s, 5 min 15 s in all. Airwallex staff advised a retry with some backoff on these codes
 * (Slack, 2 November); the delays they measured before it worked were 33 s to 3.2 min. An invoice payment proposal lives 20 minutes (INVOICE_PROPOSAL_TTL_MS).
 */
export const FEE_RETRY: FeeRetry = { delaysMs: [15_000, 30_000, 60_000, 90_000, 120_000], sleep: (ms) => new Promise((r) => setTimeout(r, ms)) };

/** Airwallex's fee configuration on its side, transient (agent run 1: the same payout paid 5 times that day). */
export const FEE_RETRY_CODES = AIRWALLEX_FEE_CODES;

export async function executeInvoicePayment(db: DB, rail: AirwallexRail, sim: SandboxSim | null, proposalId: string, now = () => new Date(), feeRetry: FeeRetry = FEE_RETRY): Promise<InvoicePaymentResult> {
  const sha = (db.prepare("SELECT terms_sha256 FROM proposals WHERE proposal_id = ?").get(proposalId) as { terms_sha256: string }).terms_sha256;

  const begun = (name: string) => !!db.prepare("SELECT 1 FROM money_steps WHERE action_id = ? AND step = ?").get(proposalId, name);
  const resumedAfterConversion = begun("conversion") && !begun("transfer");
  // The balances are read and judged, and what this payment speaks for is held, under the one payout lock shared with
  // the supplier payments (src/policy/payoutLock.ts): a payment executed at the same time, by either executor, counts it.
  const terms = await exclusive(async () => {
    const pre = treasuryState(db, await snapshot(db, rail, `pre-exec:${proposalId}`));
    return beginExecution<InvoicePaymentTerms>(db, proposalId, (t) => {
      // Purser as a platform (red team 6): only from the account the CFO signed for, the company's own in its binding.
      checkPayingAccount(db, t, rail as { payingAccount?: string | null }, now());
      // The CFO may block a payee after the approval: checked again here, before Airwallex is called (review L2).
      const held = holdReason(db, t, now());
      if (held) throw new Error(held);
      // Another payout for the same invoice (an older proposal approved elsewhere): stop before any conversion.
      const other = (db.prepare("SELECT invoice_no, status FROM transfers WHERE request_id <> ? AND status <> 'CANCELLED'").all(t.transfer_request_id) as { invoice_no: string; status: string }[])
        .find((r) => sameLedgerInvoice(r.invoice_no, partyOf(db, r.invoice_no), t.invoice_no, { ...partyOf(db, t.invoice_no), vendor: t.vendor }));
      if (other) throw new Error(`invoice ${t.invoice_no} ${other.status === "PAID" ? "is already paid" : `already has a payout (${other.status})`} by another proposal; nothing is converted or paid`);
      // A resume after a crash (src/policy/saga.ts): a step already started was decided on when it started; it is now
      // finished, not judged again on balances it has itself changed. The euro check is then made fresh before step 2.
      if (begun("transfer")) return;
      if (t.conversion && !begun("conversion")) {
        if (Date.parse(t.conversion.valid_to) - 30_000 <= now().getTime()) throw new Error(`quote ${t.conversion.quote_id} expired at ${t.conversion.valid_to}; approval void`);
        const q = db.prepare("SELECT used_by_conversion FROM fx_quotes WHERE quote_id = ?").get(t.conversion.quote_id) as { used_by_conversion: string | null } | undefined;
        if (!q) throw new Error(`unknown quote ${t.conversion.quote_id}`);
        if (q.used_by_conversion && q.used_by_conversion !== t.conversion.request_id) throw new Error(`quote ${t.conversion.quote_id} was already used`);
        if (pre.usdAvailableCents - toCents(t.conversion.sell_amount) - heldPayoutCents(db, "USD", proposalId) < pre.usdFloorCents) throw new Error("USD would now drop under its floor; a new proposal is needed");
      }
      if (begun("conversion")) return;
      const eurAfter = pre.eurAvailableCents + (t.conversion ? toCents(t.conversion.buy_amount) : 0);
      // Other payouts written but not yet at Airwallex are spoken for too (this one's own row, on a retry, is not).
      if (eurAfter - outCents(t) < pre.eurFloorCents + pre.eurObligationsCents + eurInFlightCents(db, t.transfer_request_id, proposalId)) {
        throw new Error("EUR would now drop under its floor, commitments and payouts under way; a new proposal is needed");
      }
      // Spoken for in the same transaction as the check: the USD a conversion sells, and the euros the payout needs beyond
      // what the conversion brings in, until the conversion is recorded and the payout row is written.
      if (t.conversion) holdPayout(db, proposalId, t.conversion.request_id, "USD", toCents(t.conversion.sell_amount));
      holdPayout(db, proposalId, t.transfer_request_id, "EUR", outCents(t) - (t.conversion ? toCents(t.conversion.buy_amount) : 0));
    }, now());
  });

  let conversionId: string | null = null;
  try {
    if (terms.conversion) {
      const c = terms.conversion;
      // Step 1: the conversion. On a retry after a crash, Airwallex may already have converted under this request_id:
      // that conversion is adopted, never a second one made.
      const conv = await step(db, proposalId, 1, "conversion", c.request_id, async (retry) => {
        const done = db.prepare("SELECT conversion_id, buy_amount, sell_amount, status FROM fx_conversions WHERE request_id = ?").get(c.request_id) as { conversion_id: string; buy_amount: string; sell_amount: string; status: string } | undefined;
        if (done) return { conversionId: done.conversion_id, buyAmountCents: toCents(done.buy_amount), sellAmountCents: toCents(done.sell_amount), status: done.status, adopted: false };
        // Single use in code: Airwallex itself accepts a reused quote under a new request_id.
        db.prepare("UPDATE fx_quotes SET used_by_conversion = ? WHERE quote_id = ? AND (used_by_conversion IS NULL OR used_by_conversion = ?)").run(c.request_id, c.quote_id, c.request_id);
        const found = retry ? await rail.findConversionByRequestId(c.request_id) : undefined;
        const made = found ?? await rail.createConversion({
          requestId: c.request_id,
          quote: { quoteId: c.quote_id, buyCurrency: c.buy_currency, sellCurrency: c.sell_currency, buyAmountCents: toCents(c.buy_amount), sellAmountCents: toCents(c.sell_amount), clientRate: c.client_rate, validFrom: "", validTo: c.valid_to },
          approvalSha256: sha,
        });
        return { conversionId: made.conversionId, buyAmountCents: made.buyAmountCents, sellAmountCents: made.sellAmountCents, status: made.status, adopted: !!found };
      }, now);
      // Recorded, and the hold moved onto the balance it is now in, before any other payment reads the balances.
      await exclusive(() => db.transaction(() => {
        const added = db.prepare("INSERT OR IGNORE INTO fx_conversions (conversion_id, quote_id, request_id, buy_amount, sell_amount, status, approval_sha256) VALUES (?, ?, ?, ?, ?, ?, ?)")
          .run(conv.conversionId, c.quote_id, c.request_id, fromCents(conv.buyAmountCents), fromCents(conv.sellAmountCents), conv.status, sha);
        if (added.changes === 1) {
          audit(db, "awx-executor", conv.adopted ? "fx.adopted" : "fx.converted", conv.conversionId, { quote_id: c.quote_id, request_id: c.request_id, buy: `EUR ${fromCents(conv.buyAmountCents)}`, sell: `USD ${fromCents(conv.sellAmountCents)}`, approval_sha256: sha });
        }
        releasePayout(db, c.request_id);
        if (!db.prepare("SELECT 1 FROM transfers WHERE request_id = ?").get(terms.transfer_request_id)) holdPayout(db, proposalId, terms.transfer_request_id, "EUR", outCents(terms));
      }).immediate());
      conversionId = conv.conversionId;
    }

    if (resumedAfterConversion) {
      // Resumed between the conversion and the payout: the euro check on a fresh balance, now the conversion is in it.
      await exclusive(async () => {
        const fresh = treasuryState(db, await snapshot(db, rail, `resume:${proposalId}`));
        if (fresh.eurAvailableCents - outCents(terms) < fresh.eurFloorCents + fresh.eurObligationsCents + eurInFlightCents(db, terms.transfer_request_id, proposalId)) {
          throw new Error("EUR would now drop under its floor, commitments and payouts under way; a new proposal is needed");
        }
        if (!db.prepare("SELECT 1 FROM transfers WHERE request_id = ?").get(terms.transfer_request_id)) holdPayout(db, proposalId, terms.transfer_request_id, "EUR", outCents(terms));
      });
    }
    // Step 2: the payout, under its own request_id (the transfers row is its outbox entry). Step 3: its settlement.
    const transfer = await step(db, proposalId, 2, "transfer", terms.transfer_request_id, () => submitTransfer(db, rail, terms, sha, now, feeRetry), now);
    const final = sim ? await step(db, proposalId, 3, "settle", transfer.id, () => settleInSandbox(db, rail, sim, transfer), now) : transfer;
    recordFee(db, final, terms, sha);
    // Purser's fee, once the payment is PAID (never failing it); a live payment's is taken when the follow-up reads it PAID.
    if (final.status === "PAID") await takePlatformFee(db, rail as never, terms as unknown as SupplierPaymentTerms, sha, proposalId);
    await snapshot(db, rail, `post-exec:${proposalId}`);
    finishExecution(db, proposalId, final.status === "PAID" ? "EXECUTED" : "FAILED", { conversion_id: conversionId, transfer_id: final.id, status: final.status });
    return { conversionId, transfer: final };
  } catch (err) {
    // The payout's hold goes (a payout written is counted by its own row); a conversion refused outright moved nothing,
    // while one whose answer was lost keeps its hold until a person or a re-run resolves it.
    releasePayout(db, terms.transfer_request_id);
    if (terms.conversion && !(err instanceof AirwallexAmbiguous) && !db.prepare("SELECT 1 FROM fx_conversions WHERE request_id = ?").get(terms.conversion.request_id)) releasePayout(db, terms.conversion.request_id);
    finishExecution(db, proposalId, err instanceof AirwallexError && err.code === "expired_quote" ? "NEEDS_REAPPROVAL" : "FAILED", { error: (err as Error).message, ...awxFacts(err) });
    throw err;
  }
}

/** Why nothing may be paid now (the holds and the agent's identity, checked before every create), or null. */
function holdReason(db: DB, t: InvoicePaymentTerms, at: Date): string | null {
  if (!counterpartyAllowed(db, t.beneficiary_name)) return `${t.beneficiary_name} is blocked by the CFO policy; nothing is paid`;
  if (frozen(db)) return "the CFO pulled the emergency stop; nothing is paid until it is lifted";
  if (stopped(db, "treasury")) return "the treasury agent was stopped automatically (velocity limit); nothing is paid until the CFO lifts the stop";
  if (paused(db, "treasury")) return "the treasury agent is paused by the CFO; nothing is paid until the CFO resumes it with Face ID";
  // The treasury agent's identity (B5): still active, and allowed to pay a bank beneficiary in euros over Airwallex.
  const denied = authorize(db, "treasury", { rail: "airwallex", currency: "EUR", payee: "beneficiaries" }, at);
  return denied ? `${denied}; nothing is paid` : null;
}

/** The approved payee must still be the supplier's active account (a bank-detail change applied meanwhile replaces it). */
function payeeReason(db: DB, t: InvoicePaymentTerms): string | null {
  const b = db.prepare("SELECT status FROM beneficiaries WHERE beneficiary_id = ?").get(t.beneficiary_id) as { status: string } | undefined;
  return b?.status === "ACTIVE" ? null : `the approved payee ${t.beneficiary_id} is no longer the active account of ${t.beneficiary_name} (${b?.status ?? "missing"}); nothing is paid, a new proposal is needed`;
}

/** The EUR floor, commitments and other payouts under way, on a fresh balance (as on a resume after the conversion). */
async function floorReason(db: DB, rail: AirwallexRail, t: InvoicePaymentTerms): Promise<string | null> {
  // Under the payout lock, like every other balance read a payment is judged on.
  return exclusive(() => floorReasonNow(db, rail, t));
}

async function floorReasonNow(db: DB, rail: AirwallexRail, t: InvoicePaymentTerms): Promise<string | null> {
  let s: ReturnType<typeof treasuryState>;
  try {
    s = treasuryState(db, await snapshot(db, rail, `retry:${t.proposal_id}`));
  } catch (e) {
    return `the EUR balance could not be read (${(e as Error).message}); no attempt without the floor check`;
  }
  return s.eurAvailableCents - outCents(t) < s.eurFloorCents + s.eurObligationsCents + eurInFlightCents(db, t.transfer_request_id, t.proposal_id)
    ? "EUR would now drop under its floor, commitments and payouts under way; a new proposal is needed" : null;
}

async function submitTransfer(db: DB, rail: AirwallexRail, t: InvoicePaymentTerms, sha: string, now: () => Date, feeRetry: FeeRetry): Promise<Transfer> {
  const existing = db.prepare("SELECT transfer_id, status FROM transfers WHERE request_id = ?").get(t.transfer_request_id) as { transfer_id: string | null; status: string } | undefined;
  if (existing?.transfer_id) return rail.getTransfer(existing.transfer_id);
  // Closed as refused at create: never sent again under this request_id (a re-run of a FAILED proposal would also skip
  // the EUR floor check). A new proposal, with its own request_id and Face ID, pays the invoice.
  if (existing?.status === "CANCELLED") throw new Error(`the payout ${t.transfer_request_id} was refused by Airwallex and closed; nothing is sent again under it, a new proposal is needed`);
  // Written before the call but never answered (a crash in between): Airwallex may have it; adopt it, never resend blind.
  const listed = existing ? await rail.findTransferByRequestId(t.transfer_request_id) : undefined;
  const found = listed && await withPayee(rail, listed);
  const made = found && sameTransfer(found, req(t, sha)) ? found : undefined;
  if (found && !made) throw new Error(`Airwallex holds a transfer under ${t.transfer_request_id} that is not this payout; nothing is sent, a person checks it`);
  if (made) {
    recordTransfer(db, t, made, sha);
    auditAdopted(db, t, made, sha);
    return made;
  }
  if (!existing) {
    // Written before the call: the partial unique index allows one live payout per invoice. Its hold goes in the same
    // transaction, under the payout lock: from now on the SUBMITTING row counts it.
    await exclusive(() => db.transaction(() => {
      db.prepare("INSERT INTO transfers (request_id, invoice_no, amount, currency, method, fee_estimate, status, approval_sha256, updated_at, origin_json) VALUES (?, ?, ?, 'EUR', 'SWIFT', ?, 'SUBMITTING', ?, ?, ?)")
        .run(t.transfer_request_id, t.invoice_no, t.amount, t.fee_max, sha, new Date().toISOString(), originJson());
      // Purser's fee stays spoken for from here until it is settled, in the write that ends the hold (as a supplier payment's).
      const fee = (t as PlatformFields).platform_fee;
      if (fee) {
        db.prepare(`INSERT OR IGNORE INTO platform_fees (request_id, proposal_id, payout_request_id, amount, currency, destination, fee_transfer_id, status, approval_sha256, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, NULL, 'DUE', ?, ?)`).run(fee.request_id, t.proposal_id, t.transfer_request_id, fee.amount, fee.currency, fee.to_account, sha, new Date().toISOString());
      }
      releasePayout(db, t.transfer_request_id);
    }).immediate());
  }
  // A crash here: the row is written, nothing was sent. The re-run is a resend (it may never close the row); a row left
  // SUBMITTING with nothing behind it is closed by the CFO's `npm run reconcile -- --close-unsent` (src/finance/closeUnsent.ts).
  await checkpoint("transfer:after-insert");
  // Only the call that wrote the row sends the first create; any other path here is a resend under the same request_id.
  const firstSend = !existing;
  const create = req(t, sha);
  let tr: Transfer;
  let adopted: boolean;
  let attempts = 0;
  try {
    ({ transfer: tr, adopted } = await createWithFeeRetry(db, rail, t, sha, create, now, feeRetry, () => attempts++));
  } catch (err) {
    const refused = firstSend && err instanceof AirwallexError && err.status === 400 && REFUSED_AT_CREATE.has(err.code ?? "");
    // After the fee retry's resends (attempts > 1), Airwallex's refusal alone does not show that nothing exists.
    const afterResends = refused && attempts > 1 ? await lookUpAfterResends(db, rail, t, create, attempts, err) : null;
    if (afterResends) {
      ({ transfer: tr, adopted } = { transfer: afterResends, adopted: true });
    } else if (refused && err instanceof AirwallexError) {
      // Airwallex refused the first create outright (contract tests), and any retries too, with nothing found under the
      // request_id: no transfer exists, so the row is closed, not left SUBMITTING, where it would count as money under
      // way and block the invoice for ever. On a resend from a later run the row stays SUBMITTING whatever the answer
      // (Airwallex may hold the first send; review of 2 November), and the reconciliation looks such rows up.
      const at = new Date().toISOString();
      db.transaction(() => {
        const closed = db.prepare("UPDATE transfers SET status = 'CANCELLED', failure_type = ?, failure_reason = ?, updated_at = ? WHERE request_id = ? AND transfer_id IS NULL AND status = 'SUBMITTING'")
          .run(err.code, `refused by Airwallex at create: ${err.code}`, at, t.transfer_request_id);
        if (closed.changes !== 1) return;
        audit(db, "awx-executor", "transfer.refused", t.transfer_request_id, {
          code: err.code ?? null, status: err.status, request_id: t.transfer_request_id, amount: `EUR ${t.amount}`, approval_sha256: sha,
          trace_id: err.traceId, awx_request_id: err.awxRequestId, message: err.awxMessage, attempts,
        });
      }).immediate();
      throw err;
    } else {
      if (!(err instanceof AirwallexAmbiguous)) throw err;
      const listed = await rail.findTransferByRequestId(t.transfer_request_id);
      const found = listed && await withPayee(rail, listed);
      if (found && !sameTransfer(found, create)) throw new Error(`Airwallex holds a transfer under ${t.transfer_request_id} that is not this payout; nothing is sent, a person checks it`, { cause: err });
      if (found) ({ transfer: tr, adopted } = { transfer: found, adopted: true });
      else ({ transfer: tr, adopted } = await createOrAdopt(rail, create));
      audit(db, "awx-executor", "transfer.ambiguous", t.transfer_request_id, { resolved: adopted ? "adopted" : "resent with the same request_id" });
    }
  }
  // A crash here: Airwallex has the payout, the ledger only its SUBMITTING row. The retry adopts it by request_id.
  await checkpoint("transfer:after-create");
  recordTransfer(db, t, tr, sha);
  if (adopted) auditAdopted(db, t, tr, sha);
  else audit(db, "awx-executor", "transfer.created", tr.id, { request_id: t.transfer_request_id, amount: `EUR ${t.amount}`, beneficiary_id: t.beneficiary_id, status: tr.status, approval_sha256: sha });
  return tr;
}

/**
 * An adopted transfer names our payee as ours (our_beneficiary_id), never as if Airwallex had confirmed it, and records
 * whether Airwallex's answer stated it (payee_confirmed). Unconfirmed is an alarm (transfer.payee_unconfirmed): a red
 * line on the dashboard and a missed objective in System health, until a person checks the payee at Airwallex.
 */
function auditAdopted(db: DB, t: InvoicePaymentTerms, tr: Transfer, sha: string): void {
  const confirmed = tr.beneficiaryId != null;
  audit(db, "awx-executor", "transfer.adopted", tr.id, {
    request_id: t.transfer_request_id, amount: `EUR ${t.amount}`, our_beneficiary_id: t.beneficiary_id, payee_confirmed: confirmed, status: tr.status, approval_sha256: sha,
  });
  if (!confirmed) {
    audit(db, "awx-executor", "transfer.payee_unconfirmed", tr.id, {
      request_id: t.transfer_request_id, amount: `EUR ${t.amount}`, our_beneficiary_id: t.beneficiary_id,
      reason: "Airwallex's answers did not state the payee; the transfer was adopted on its request_id, amount and currency",
    });
  }
}

/**
 * After a refusal that followed resends under the same request_id: a strict look-up by it. A transfer there that is this
 * payout is returned (adopted); one that is not is an error for a person; nothing there returns null (the row may be
 * closed). A failed look-up leaves the row SUBMITTING, under way, and records why (transfer.left_open), then rethrows.
 */
async function lookUpAfterResends(db: DB, rail: AirwallexRail, t: InvoicePaymentTerms, want: NewTransfer, attempts: number, refusal: unknown): Promise<Transfer | null> {
  let held: Transfer | undefined;
  try {
    held = await rail.findTransferByRequestIdStrict(t.transfer_request_id);
  } catch (e) {
    audit(db, "awx-executor", "transfer.left_open", t.transfer_request_id, {
      request_id: t.transfer_request_id, attempts, amount: `EUR ${t.amount}`, reason: `the look-up by request_id after ${attempts} attempts failed: ${(e as Error).message}`,
    });
    throw refusal;
  }
  if (!held) return null;
  const mine = await withPayee(rail, held);
  if (!sameTransfer(mine, want)) throw new Error(`Airwallex holds a transfer under ${t.transfer_request_id} that is not this payout; nothing is sent, a person checks it`, { cause: refusal });
  return mine;
}

/** What Airwallex said, for the audit and the CFO: its code, trace and request ids, and its own words (none on our side). */
function awxFacts(err: unknown): { code: string | null; trace_id: string | null; awx_request_id: string | null; awx_message: string | null } | Record<string, never> {
  const e = err instanceof AirwallexError ? err : err instanceof AirwallexAmbiguous && err.cause instanceof AirwallexError ? err.cause : null;
  return e ? { code: e.code ?? null, trace_id: e.traceId, awx_request_id: e.awxRequestId, awx_message: e.awxMessage } : {};
}

/**
 * Writes the transfer Airwallex holds into its own payout row, only while that row is still SUBMITTING with no id. A row
 * that changed meanwhile (closed, or holding another id) is never overwritten: money may have left while the ledger
 * says otherwise, so it is an alarm and a stop for a person, never a silent write.
 */
function recordTransfer(db: DB, t: InvoicePaymentTerms, tr: Transfer, sha: string): void {
  const r = db.prepare("UPDATE transfers SET transfer_id = ?, status = ?, updated_at = ? WHERE request_id = ? AND status = 'SUBMITTING' AND transfer_id IS NULL")
    .run(tr.id, tr.status, new Date().toISOString(), t.transfer_request_id);
  if (r.changes === 1) return;
  const row = db.prepare("SELECT transfer_id, status FROM transfers WHERE request_id = ?").get(t.transfer_request_id) as { transfer_id: string | null; status: string } | undefined;
  if (row?.transfer_id === tr.id) return; // the same transfer, already recorded by another path
  audit(db, "awx-executor", "transfer.row_conflict", tr.id, {
    request_id: t.transfer_request_id, row_status: row?.status ?? null, row_transfer_id: row?.transfer_id ?? null, status: tr.status, amount: `EUR ${t.amount}`, approval_sha256: sha,
  });
  throw new Error(`Airwallex holds transfer ${tr.id} (${tr.status}) under ${t.transfer_request_id}, but the ledger's payout row is ${row?.status ?? "missing"}; nothing more is sent, a person checks it now`);
}

const req = (t: InvoicePaymentTerms, sha: string): NewTransfer => ({
  requestId: t.transfer_request_id, beneficiaryId: t.beneficiary_id, amountCents: toCents(t.amount), currency: "EUR", sourceCurrency: "EUR",
  reference: t.reference, reason: t.reason, approvalSha256: sha,
});

/**
 * A transfer Airwallex holds is this payout only if it carries its request_id, amount and currency, and no other payee.
 * Adopting it on duplicate_request_id also needs it live (`live`): a failed or cancelled one is not a payout made by
 * this resend.
 *
 * The payee: no recorded run shows `beneficiary_id` in Airwallex's GET or list answers (docs/runs/airwallex-readback.json
 * keeps only kind, status and amount; re-review of 2 November). So a stated payee must be ours, but adoption does not
 * depend on Airwallex stating one: withPayee first reads it back by id, and a transfer under our own request_id (a
 * random UUID only our key can send, and Airwallex keeps one transfer per request_id) with our amount and currency is
 * our own create. transfer.adopted records whether the payee was confirmed.
 */
export function sameTransfer(found: Transfer, want: NewTransfer, live = false): boolean {
  return found.requestId === want.requestId && found.amountCents === want.amountCents && found.currency === want.currency
    && (found.beneficiaryId == null || found.beneficiaryId === want.beneficiaryId) && (!live || (found.status !== "FAILED" && found.status !== "CANCELLED"));
}

/** A transfer from the list without its payee is read back by its id (GET /transfers/{id}, a UUID only), which is then judged. */
async function withPayee(rail: AirwallexRail, found: Transfer): Promise<Transfer> {
  if (found.beneficiaryId != null || !UUID.test(found.id)) return found;
  return rail.getTransfer(found.id);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The create errors Airwallex documents for POST /transfers/create that mean no transfer was made
 * (https://www.airwallex.com/docs/payouts/errors/transfer-error-codes). Not here: duplicate_request_id (one exists) and
 * service_unavailable (the outcome is not stated); those keep the payout open as under way.
 */
export const REFUSED_AT_CREATE = new Set([
  "validation_failed", "amount_above_transfer_method_limit", "amount_below_transfer_method_limit", "amount_beneficiary_receives_below_limit",
  "amount_beneficiary_receives_above_cumulative_limit", "balance_insufficient", "beneficiary_type_unsupported", "currency_pair_invalid", "fee_unknown",
  "open_position_limit_exceeded", "transfer_currency_unsupported", "transfer_amount_above_account_limit", "transfer_amount_below_account_limit",
  "transfer_method_unsupported", "source_amount_above_account_limit", "source_amount_below_account_limit", "source_currency_unsupported",
  "quote_expired", "quote_id_invalid", "quote_id_required", "workflow_invalid", "transfer_date_invalid", "payer_unsupported",
  // The builder guide: FX on a newly activated account (https://airwallexdev.com/guide).
  "unconfigured_client_fee",
]);

/**
 * The create, retried while Airwallex refuses it for its own fee configuration (fee_unknown, unconfigured_client_fee):
 * after each such 400 it waits the next delay and sends the very same create again. Any other answer ends it at once
 * (a success, an adoption, or the error for the caller's existing paths: a lost answer is looked up, never retried blind).
 * It stops, with the last refusal, when no retry is left, when the next attempt would fall at or after the approved
 * terms' expiry, or when a hold is set during the wait. Each refused attempt is audited (transfer.retry).
 *
 * Why a retry under the same request_id cannot pay twice:
 * - Airwallex is idempotent on request_id: a create under a request_id that already made a transfer is answered
 *   duplicate_request_id naming that transfer, never with a second one ([TERR]; the contract tests "a lost answer, then
 *   duplicate_request_id on the resend" and "duplicate_request_id on a retry"). That answer goes through the existing
 *   adoption checks (createOrAdopt): this request_id, amount, currency, a payee that is ours, and live; else it stays an
 *   error and the payout stays open as under way.
 * - A retry follows only a documented 400 refusal, which made nothing; a lost answer (AirwallexAmbiguous) is never
 *   retried here but looked up by request_id first.
 * - Every attempt sends the same object (`want`): the approved request_id, payee, amount, currency and approval hash.
 * - Whatever is finally paid is still judged against the SWIFT fee ceiling (recordFee), as before.
 */
async function createWithFeeRetry(db: DB, rail: AirwallexRail, t: InvoicePaymentTerms, sha: string, want: NewTransfer, now: () => Date, retry: FeeRetry, attempted: () => void): Promise<{ transfer: Transfer; adopted: boolean }> {
  const expires = Date.parse(t.expires_at);
  for (let attempt = 1; ; attempt++) {
    try {
      attempted();
      return await createOrAdopt(rail, want);
    } catch (err) {
      if (!(err instanceof AirwallexError) || err.status !== 400 || !FEE_RETRY_CODES.has(err.code ?? "")) throw err;
      const wait = retry.delaysMs[attempt - 1];
      const stopped = wait === undefined ? `no attempts left (${attempt} made)`
        : now().getTime() + wait >= expires ? `the approved terms expire at ${t.expires_at}; no attempt after that`
          : null;
      const log = (extra: { next_attempt_in_s: number | null; stopped: string | null }) => audit(db, "awx-executor", "transfer.retry", t.transfer_request_id, {
        attempt, code: err.code ?? null, trace_id: err.traceId, awx_request_id: err.awxRequestId, message: err.awxMessage,
        request_id: t.transfer_request_id, amount: `EUR ${t.amount}`, approval_sha256: sha, ...extra,
      });
      if (stopped !== null || wait === undefined) { log({ next_attempt_in_s: null, stopped }); throw err; }
      log({ next_attempt_in_s: wait / 1000, stopped: null });
      await retry.sleep(wait);
      // After the wait: still before the expiry, no hold set meanwhile (the emergency stop, a pause, a blocked payee),
      // the approved payee still the supplier's active account, and the EUR floor still kept on a fresh balance.
      const late = now().getTime() >= expires ? `the approved terms expired at ${t.expires_at} during the wait` : null;
      const held = late ?? holdReason(db, t, now()) ?? payeeReason(db, t) ?? await floorReason(db, rail, t);
      if (held) {
        audit(db, "awx-executor", "transfer.retry_stopped", t.transfer_request_id, { after_attempt: attempt, reason: held, request_id: t.transfer_request_id, approval_sha256: sha });
        throw err;
      }
    }
  }
}

/**
 * Creates the transfer; if Airwallex answers that this request_id already made one (duplicate_request_id, or the
 * legacy request_id_duplicate, with the transfer's id in details), that transfer is adopted, never a second one made.
 */
async function createOrAdopt(rail: AirwallexRail, want: NewTransfer): Promise<{ transfer: Transfer; adopted: boolean }> {
  try {
    return { transfer: await rail.createTransfer(want), adopted: false };
  } catch (err) {
    if (!(err instanceof AirwallexError) || (err.code !== "duplicate_request_id" && err.code !== "request_id_duplicate")) throw err;
    // The id Airwallex names goes into a URL path only if it is a UUID; otherwise the transfer is looked up by request_id.
    const id = (err.body as { details?: { id?: unknown } } | null)?.details?.id;
    const listed = typeof id === "string" && UUID.test(id) ? await rail.getTransfer(id) : await rail.findTransferByRequestId(want.requestId);
    const existing = listed && await withPayee(rail, listed);
    // Adopted only when it is exactly this payout; anything else stays an error (the payout stays open, under way).
    if (!existing || !sameTransfer(existing, want, true)) throw err;
    return { transfer: existing, adopted: true };
  }
}

/**
 * A fee is within the ceiling only in EUR and at most both the fee the CFO's terms reserved and the EUR 20.00 policy
 * ceiling (review, 2 November: when the reserve rises after a high fee, the alarm must not rise with it).
 */
export function feeWithinCeiling(fee: { currency: string; cents: number }, feeMax: string): boolean {
  return fee.currency === "EUR" && fee.cents <= Math.min(toCents(feeMax), SWIFT_FEE_MAX_EUR_CENTS);
}

/** The fee is only known once Airwallex charges it: record it, and flag it if it broke the approved ceiling. */
function recordFee(db: DB, tr: Transfer, t: InvoicePaymentTerms, sha: string): void {
  if (!tr.fee) return;
  const actual = `${tr.fee.currency} ${fromCents(tr.fee.cents)}`;
  db.prepare("UPDATE transfers SET fee_actual = ? WHERE transfer_id = ?").run(actual, tr.id);
  const withinMax = feeWithinCeiling(tr.fee, t.fee_max);
  audit(db, "awx-executor", withinMax ? "transfer.fee" : "transfer.fee_over_ceiling", tr.id, { fee: actual, fee_max: `EUR ${t.fee_max}`, approval_sha256: sha });
}

/** Sandbox only: the transfer goes SENT, then PAID. Status is read back, never assumed. */
async function settleInSandbox(db: DB, rail: AirwallexRail, sim: SandboxSim, tr: Transfer): Promise<Transfer> {
  let cur = await rail.getTransfer(tr.id);
  // Airwallex's own approval workflow holds the transfer IN_APPROVAL until a person approves it in Airwallex's web app:
  // a second lock next to the CFO's Face ID. Purser never simulates past it; the payout is followed up once approved.
  if (cur.status === "IN_APPROVAL") return cur;
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
