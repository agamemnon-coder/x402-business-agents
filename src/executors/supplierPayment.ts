// Executes an approved supplier_payment (src/payouts/plan.ts): the conversion on the approved quote, if any, then the
// payout in the invoice's currency on the approved method, both carrying the approval hash and built only from the
// approved terms. Each runs under its own request_id as a saga step (src/policy/saga.ts): after a crash a step that
// started is finished, never made twice. The transfer follows Kit 11's discipline (src/executors/invoicePayment.ts,
// submitTransfer; red team of 8 November): a row with a transfer id is fetched; a row closed as refused is never sent
// again; a written row is looked up strictly by request_id before anything is sent; a row is closed as refused only on
// its first send and only for Airwallex's documented 400 refusals; a duplicate_request answer resolves the transfer
// Airwallex already holds. Whenever nothing exists at Airwallex yet, the floors are checked again on fresh balances,
// whatever an earlier attempt began. What a payment speaks for while it runs (a conversion on its way, a payout not
// yet written) is held in payout_reservations from the moment its execution begins, so a second payment executed at
// the same time counts it.

import { AirwallexAmbiguous, AirwallexError } from "../airwallex/client.js";
import type { PayoutRail, SandboxSim, Transfer } from "../airwallex/port.js";
import { audit } from "../audit/log.js";
import type { DB } from "../db/open.js";
import { fromCents, toCents } from "../lib/money.js";
import { sameLedgerInvoice } from "../lib/invoiceKey.js";
import { partyOf } from "../agents/euroBill.js";
import { beginExecution, finishExecution } from "../policy/approvals.js";
import { authorize } from "../policy/principals.js";
import { counterpartyAllowed, frozen, paused } from "../policy/rules.js";
import { exclusive, holdPayout, releasePayout } from "../policy/payoutLock.js";
import { step } from "../policy/saga.js";
import { stopped } from "../policy/velocity.js";
import { originJson } from "../provenance/origin.js";
import { freeCents, type PlatformFields, type SupplierPaymentTerms } from "../payouts/plan.js";
import { platformFeeOn } from "../airwallex/platform.js";
import { REFUSED_AT_CREATE } from "./invoicePayment.js";

const hold = holdPayout;
const release = releasePayout;

type Row = { transfer_id: string | null; status: string };
const transferRow = (db: DB, t: SupplierPaymentTerms) => db.prepare("SELECT transfer_id, status FROM transfers WHERE request_id = ?").get(t.transfer_request_id) as Row | undefined;
const converted = (db: DB, requestId: string) => db.prepare("SELECT conversion_id, buy_amount, sell_amount, status FROM fx_conversions WHERE request_id = ?").get(requestId) as
  { conversion_id: string; buy_amount: string; sell_amount: string; status: string } | undefined;
const payoutCents = (t: SupplierPaymentTerms) => toCents(t.amount) + toCents(t.fee_reserve) + toCents((t as PlatformFields).platform_fee?.amount ?? "0.00");
const closedError = (t: SupplierPaymentTerms) => new Error(`the payout ${t.transfer_request_id} was refused by Airwallex and closed; nothing is sent again under it, a new proposal is needed`);
const floorError = (t: SupplierPaymentTerms) => new Error(`${t.currency} would now drop under its floor, commitments and payouts under way; a new proposal is needed`);

export async function executeSupplierPayment(db: DB, rail: PayoutRail, sim: SandboxSim | null, proposalId: string, now = () => new Date()): Promise<{ conversionId: string | null; transfer: Transfer }> {
  const sha = (db.prepare("SELECT terms_sha256 FROM proposals WHERE proposal_id = ?").get(proposalId) as { terms_sha256: string }).terms_sha256;
  const begun = (name: string) => !!db.prepare("SELECT 1 FROM money_steps WHERE action_id = ? AND step = ?").get(proposalId, name);

  // The balances are read and judged, and what this payment speaks for is held, before any other payment can read them.
  const terms = await exclusive(async () => {
    const pre = await rail.balancesAll();
    return beginExecution<SupplierPaymentTerms>(db, proposalId, (t) => {
      if (t.kind !== "supplier_payment") throw new Error(`${proposalId} is not a supplier payment`);
      // Purser as a platform: the payout leaves only the account the CFO signed for (docs/airwallex-platform.md).
      const paying = (t as PlatformFields).paying_account?.id ?? null;
      if ((rail.payingAccount ?? null) !== paying) throw new Error(`the terms were signed for payment from ${paying ?? "the company's own Airwallex account"}, but this runner pays from ${rail.payingAccount ?? "the company's own Airwallex account"}; nothing is paid`);
      const held = holdReason(db, t, now());
      if (held) throw new Error(held);
      const other = (db.prepare("SELECT invoice_no, status FROM transfers WHERE request_id <> ? AND status <> 'CANCELLED'").all(t.transfer_request_id) as { invoice_no: string; status: string }[])
        .find((r) => sameLedgerInvoice(r.invoice_no, partyOf(db, r.invoice_no), t.invoice_no, { ...partyOf(db, t.invoice_no), vendor: t.vendor }));
      if (other) throw new Error(`invoice ${t.invoice_no} ${other.status === "PAID" ? "is already paid" : `already has a payout (${other.status})`} by another proposal; nothing is converted or paid`);
      const row = transferRow(db, t);
      if (row?.status === "CANCELLED") throw closedError(t);
      // Written: the transfer step resolves it at Airwallex first; anything it sends again is checked on fresh balances.
      if (row) return;
      const c = t.conversion;
      const pending = c && !converted(db, c.request_id);
      if (c && pending && begun("conversion")) return; // its outcome is unknown: the step looks it up before anything else
      if (c && pending) {
        if (Date.parse(c.valid_to) - 30_000 <= now().getTime()) throw new Error(`quote ${c.quote_id} expired at ${c.valid_to}; approval void`);
        const q = db.prepare("SELECT used_by_conversion FROM fx_quotes WHERE quote_id = ?").get(c.quote_id) as { used_by_conversion: string | null } | undefined;
        if (!q) throw new Error(`unknown quote ${c.quote_id}`);
        if (q.used_by_conversion && q.used_by_conversion !== c.request_id) throw new Error(`quote ${c.quote_id} was already used`);
        if (freeCents(db, pre, c.sell_currency, undefined, proposalId) - toCents(c.sell_amount) < 0) throw new Error(`${c.sell_currency} would now drop under its floor; a new proposal is needed`);
      }
      const incoming = c && pending ? toCents(c.buy_amount) : 0;
      if (freeCents(db, pre, t.currency, t.transfer_request_id, proposalId) + incoming - payoutCents(t) < 0) throw floorError(t);
      // Spoken for in the same transaction as the check: a payment executed at the same time counts it.
      if (c && pending) hold(db, proposalId, c.request_id, c.sell_currency, toCents(c.sell_amount));
      hold(db, proposalId, t.transfer_request_id, t.currency, payoutCents(t) - incoming);
    }, now());
  });

  let conversionId: string | null = null;
  try {
    if (terms.conversion) {
      const c = terms.conversion;
      const conv = await step(db, proposalId, 1, "conversion", c.request_id, async (retry) => {
        const done = converted(db, c.request_id);
        if (done) return { conversionId: done.conversion_id, buyAmountCents: toCents(done.buy_amount), sellAmountCents: toCents(done.sell_amount), status: done.status, adopted: false };
        db.prepare("UPDATE fx_quotes SET used_by_conversion = ? WHERE quote_id = ? AND (used_by_conversion IS NULL OR used_by_conversion = ?)").run(c.request_id, c.quote_id, c.request_id);
        const found = retry ? await rail.findConversionByRequestId(c.request_id) : undefined;
        if (found) return { conversionId: found.conversionId, buyAmountCents: found.buyAmountCents, sellAmountCents: found.sellAmountCents, status: found.status, adopted: true };
        if (retry) {
          // Nothing under its request_id: the conversion is made now, so its floor is checked again on fresh balances.
          await exclusive(async () => {
            const fresh = await rail.balancesAll();
            if (freeCents(db, fresh, c.sell_currency, undefined, proposalId) - toCents(c.sell_amount) < 0) throw new Error(`${c.sell_currency} would now drop under its floor; a new proposal is needed`);
            hold(db, proposalId, c.request_id, c.sell_currency, toCents(c.sell_amount));
          });
        }
        try {
          const made = await rail.createConversionAny({
            requestId: c.request_id, approvalSha256: sha,
            quote: { quoteId: c.quote_id, buyCurrency: c.buy_currency, sellCurrency: c.sell_currency, buyAmountCents: toCents(c.buy_amount), sellAmountCents: toCents(c.sell_amount), clientRate: c.client_rate, validFrom: "", validTo: c.valid_to },
          });
          return { conversionId: made.conversionId, buyAmountCents: made.buyAmountCents, sellAmountCents: made.sellAmountCents, status: made.status, adopted: false };
        } catch (e) {
          // Refused outright: nothing was converted. A lost answer keeps the hold: Airwallex may have converted it.
          if (!(e instanceof AirwallexAmbiguous)) release(db, c.request_id);
          throw e;
        }
      }, now);
      // Recorded, and the hold moved onto the balance it is now in, before any other payment reads the balances.
      await exclusive(() => db.transaction(() => {
        const added = db.prepare("INSERT OR IGNORE INTO fx_conversions (conversion_id, quote_id, request_id, buy_amount, sell_amount, status, approval_sha256) VALUES (?, ?, ?, ?, ?, ?, ?)")
          .run(conv.conversionId, c.quote_id, c.request_id, fromCents(conv.buyAmountCents), fromCents(conv.sellAmountCents), conv.status, sha);
        if (added.changes === 1) {
          audit(db, "awx-executor", conv.adopted ? "fx.adopted" : "fx.converted", conv.conversionId,
            { quote_id: c.quote_id, request_id: c.request_id, buy: `${c.buy_currency} ${fromCents(conv.buyAmountCents)}`, sell: `${c.sell_currency} ${fromCents(conv.sellAmountCents)}`, approval_sha256: sha });
        }
        release(db, c.request_id);
        if (!transferRow(db, terms)) hold(db, proposalId, terms.transfer_request_id, terms.currency, payoutCents(terms));
      }).immediate());
      conversionId = conv.conversionId;
    }

    const transfer = await step(db, proposalId, 2, "transfer", terms.transfer_request_id, () => submit(db, rail, terms, sha, proposalId), now);
    const final = sim ? await step(db, proposalId, 3, "settle", transfer.id, () => settleInSandbox(db, rail, sim, transfer), now) : transfer;
    recordFee(db, final, terms, sha);
    if (final.status === "PAID") await step(db, proposalId, 4, "platform_fee", (terms as PlatformFields).platform_fee?.request_id ?? `${terms.transfer_request_id}:fee`, () => takePlatformFee(db, rail, terms, sha, proposalId), now);
    const failed = final.status === "FAILED" || final.status === "CANCELLED";
    finishExecution(db, proposalId, failed ? "FAILED" : "EXECUTED", { conversion_id: conversionId, transfer_id: final.id, status: final.status });
    return { conversionId, transfer: final };
  } catch (err) {
    // The payout's hold goes: a payout written is counted by its own row from then on; one never written moves nothing.
    release(db, terms.transfer_request_id);
    finishExecution(db, proposalId, (err as { code?: string }).code === "expired_quote" ? "NEEDS_REAPPROVAL" : "FAILED", { error: (err as Error).message });
    throw err;
  }
}

/** Why nothing may be paid now, or null: the CFO's holds, the treasury agent's stops, and the approved payee still on file. */
function holdReason(db: DB, t: SupplierPaymentTerms, at: Date): string | null {
  if (!counterpartyAllowed(db, t.beneficiary_name)) return `${t.beneficiary_name} is blocked by the CFO policy; nothing is paid`;
  if (frozen(db)) return "the CFO pulled the emergency stop; nothing is paid until it is lifted";
  if (stopped(db, "treasury")) return "the treasury agent was stopped automatically (velocity limit); nothing is paid until the CFO lifts the stop";
  if (paused(db, "treasury")) return "the treasury agent is paused by the CFO; nothing is paid until the CFO resumes it with Face ID";
  // The treasury agent's identity (B5), as for Kit 11's payments: still active, and allowed to pay a bank beneficiary in
  // this currency over Airwallex (red team round 3: a revoked agent still paid suppliers).
  const denied = authorize(db, "treasury", { rail: "airwallex", currency: t.currency, payee: "beneficiaries" }, at);
  if (denied) return `${denied}; nothing is paid`;
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

/** Airwallex's answer that this request_id already made a transfer (the stand-in's code included). */
const DUPLICATE = new Set(["duplicate_request_id", "request_id_duplicate", "duplicate_request"]);
const codeOf = (e: unknown) => (e instanceof AirwallexError ? e.code : (e as { code?: string }).code) ?? "";
/** A documented refusal at create (HTTP 400 at Airwallex; the stand-in throws the same codes without a status). */
const refusedAtCreate = (e: unknown) => REFUSED_AT_CREATE.has(codeOf(e)) && (!(e instanceof AirwallexError) || e.status === 400);

async function submit(db: DB, rail: PayoutRail, t: SupplierPaymentTerms, sha: string, proposalId: string): Promise<Transfer> {
  const at = () => new Date().toISOString();
  const existing = transferRow(db, t);
  if (existing?.transfer_id) return rail.getTransfer(existing.transfer_id);
  if (existing?.status === "CANCELLED") throw closedError(t);
  const notThis = (found: Transfer, cause?: unknown) => new Error(`Airwallex holds transfer ${found.id} under this request_id, but not for this payout; nothing is sent, a person checks it (npm run reconcile)`, cause ? { cause } : undefined);
  const adopt = async (found: Transfer) => {
    await record(db, t, found);
    audit(db, "awx-executor", "transfer.adopted", found.id, { request_id: t.transfer_request_id, amount: `${t.currency} ${t.amount}`, our_beneficiary_id: t.beneficiary_id, payee_confirmed: found.beneficiaryId != null, status: found.status, approval_sha256: sha });
    return found;
  };
  // Written before but never answered (a lost answer, a crash): Airwallex may hold it. Looked up, never resent blind.
  if (existing) {
    const found = await rail.findTransferByRequestIdStrict(t.transfer_request_id);
    if (found && !isThis(found, t)) throw notThis(found);
    if (found) return adopt(found);
  }
  // Nothing at Airwallex under this request_id: the floor on fresh balances, and the row written, as one step.
  await exclusive(async () => {
    const fresh = await rail.balancesAll();
    if (freeCents(db, fresh, t.currency, t.transfer_request_id, proposalId) - payoutCents(t) < 0) throw floorError(t);
    db.transaction(() => {
      if (!existing) {
        db.prepare("INSERT INTO transfers (request_id, invoice_no, amount, currency, method, fee_estimate, status, approval_sha256, updated_at, origin_json) VALUES (?, ?, ?, ?, ?, ?, 'SUBMITTING', ?, ?, ?)")
          .run(t.transfer_request_id, t.invoice_no, t.amount, t.currency, t.method, t.fee_reserve, sha, at(), originJson());
      }
      release(db, t.transfer_request_id);
    }).immediate();
  });
  // Only the call that wrote the row sends the first create; any other is a resend under the same request_id.
  const firstSend = !existing;
  let tr: Transfer;
  try {
    tr = await rail.createPayoutTransfer({
      requestId: t.transfer_request_id, beneficiaryId: t.beneficiary_id, amountCents: toCents(t.amount), currency: t.currency, sourceCurrency: t.currency,
      method: t.method, reference: t.reference, reason: t.reason, approvalSha256: sha,
    });
  } catch (e) {
    if (firstSend && refusedAtCreate(e)) {
      // Refused outright at the first send: no transfer exists, so the row is closed, not left counting as under way.
      const closed = db.prepare("UPDATE transfers SET status = 'CANCELLED', failure_type = ?, failure_reason = ?, updated_at = ? WHERE request_id = ? AND transfer_id IS NULL AND status = 'SUBMITTING'")
        .run(codeOf(e), `refused by Airwallex at create: ${codeOf(e)}`, at(), t.transfer_request_id);
      if (closed.changes === 1) audit(db, "awx-executor", "transfer.refused", t.transfer_request_id, { request_id: t.transfer_request_id, code: codeOf(e), amount: `${t.currency} ${t.amount}`, approval_sha256: sha, error: (e as Error).message });
      throw e;
    }
    if (!(e instanceof AirwallexAmbiguous) && !DUPLICATE.has(codeOf(e))) throw e; // the row stays SUBMITTING: a re-run looks it up first
    // A lost answer, or Airwallex saying it has this request_id already: the transfer it holds is resolved, never a second.
    const found = await rail.findTransferByRequestIdStrict(t.transfer_request_id);
    if (found && !isThis(found, t)) throw notThis(found, e);
    if (!found || (!(e instanceof AirwallexAmbiguous) && (found.status === "FAILED" || found.status === "CANCELLED"))) {
      audit(db, "awx-executor", "transfer.left_open", t.transfer_request_id, { request_id: t.transfer_request_id, reason: found ? `Airwallex holds it as ${found.status}` : "no transfer is found under the request_id yet; a re-run looks it up first" });
      throw e;
    }
    return adopt(found);
  }
  await record(db, t, tr);
  audit(db, "awx-executor", "transfer.created", tr.id, { request_id: t.transfer_request_id, amount: `${t.currency} ${t.amount}`, method: t.method, beneficiary_id: t.beneficiary_id, status: tr.status, approval_sha256: sha });
  return tr;
}

/** The transfer id and status on the row, together with every other payment's reading of the balances it changed. */
function record(db: DB, t: SupplierPaymentTerms, tr: Transfer): Promise<void> {
  return exclusive(() => {
    db.prepare("UPDATE transfers SET transfer_id = ?, status = ?, updated_at = ? WHERE request_id = ?").run(tr.id, tr.status, new Date().toISOString(), t.transfer_request_id);
  });
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

/**
 * Purser's fee for a paid payout (docs/airwallex-platform.md), taken once under the request id in the signed terms and
 * only with AIRWALLEX_PLATFORM_FEE=on; recorded whatever happens, so a fee that could not be taken shows for a person.
 */
async function takePlatformFee(db: DB, rail: PayoutRail, t: SupplierPaymentTerms, sha: string, proposalId: string): Promise<void> {
  const fee = (t as PlatformFields).platform_fee;
  if (!fee) return;
  const done = db.prepare("SELECT status FROM platform_fees WHERE request_id = ?").get(fee.request_id) as { status: string } | undefined;
  if (done?.status === "SETTLED") return;
  const write = (status: string, id: string | null) => db.prepare(`INSERT INTO platform_fees (request_id, proposal_id, payout_request_id, amount, currency, destination, fee_transfer_id, status, approval_sha256, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(request_id) DO UPDATE SET fee_transfer_id = excluded.fee_transfer_id, status = excluded.status, updated_at = excluded.updated_at`)
    .run(fee.request_id, proposalId, t.transfer_request_id, fee.amount, fee.currency, fee.to_account, id, status, sha, new Date().toISOString());
  if (!platformFeeOn() || !rail.collectPlatformFee) { write("NOT_TAKEN", null); audit(db, "awx-executor", "platform_fee.not_taken", fee.request_id, { why: "AIRWALLEX_PLATFORM_FEE is off or the rail cannot take it", amount: `${fee.currency} ${fee.amount}` }); return; }
  const r = await rail.collectPlatformFee({ requestId: fee.request_id, amountCents: toCents(fee.amount), currency: fee.currency, destination: fee.to_account, reference: `Purser fee, invoice ${t.invoice_no}` });
  write(r.status === "SETTLED" || r.status === "NEW" || r.status === "PENDING" ? "SETTLED" : r.status, r.id);
  audit(db, "awx-executor", "platform_fee.taken", fee.request_id, { amount: `${fee.currency} ${fee.amount}`, to: fee.to_account, fee_transfer: r.id, status: r.status, approval_sha256: sha });
}
