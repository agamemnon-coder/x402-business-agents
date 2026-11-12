// A batch the CFO signed with one Face ID (src/policy/batch.ts), sent to Airwallex as ONE batch transfer
// (src/airwallex/batchTransfers.ts) instead of one transfer per line. Behind AIRWALLEX_BATCH_TRANSFER=on; off, a batch
// runs line by line as before (src/executors/paymentBatch.ts).
//
// Order of events, and why:
//  1. Purser's own checks, as for a single payment, for every line and for the whole: the batch's hash and approval, each
//     line's hash and approval, the CFO's holds and blocks, the payee still the supplier's active account, no other live
//     payout for the invoice, and the EUR floor for the sum of the lines. One line failing refuses the whole batch:
//     nothing is created at Airwallex.
//  2. Each line's payout row is written (SUBMITTING) before any call, so the one-live-payout-per-invoice rule holds.
//  3. ONE batch is created at Airwallex under a request_id derived from the signed batch hash (never sent twice; a lost
//     answer is resolved by listing by that request_id), with the batch hash in its metadata.
//  4. The lines are added as items, each under its own transfer_request_id (Airwallex ignores a repeated one), with its
//     own approval hash in the item's metadata.
//  5. The batch is quoted, then read back item by item and compared with the signed terms: count, request ids, payee,
//     amount, currencies, method, reference, the approval hashes, the fee within each line's ceiling, and what the payer
//     pays within the signed total plus the fee ceilings. Any difference: the batch is deleted at Airwallex (it is still
//     DRAFTING, so nothing can move), every row is closed, and the batch needs a new signature. Nothing is submitted.
//  6. Only then is it submitted. With Airwallex's approval workflow on, it waits IN_APPROVAL for a person in Airwallex's
//     web app (Purser never approves there and never simulates past it); otherwise Airwallex schedules it.
//  followAirwallexBatch reads it back later (GET only) and records each booked transfer id on its payout row.

import { audit } from "../audit/log.js";
import type { DB } from "../db/open.js";
import { fromCents, toCents } from "../lib/money.js";
import { sha256Hex } from "../lib/terms.js";
import { partyOf, snapshot, treasuryState, type InvoicePaymentTerms } from "../agents/euroBill.js";
import { sameLedgerInvoice } from "../lib/invoiceKey.js";
import { beginExecution, finishExecution } from "../policy/approvals.js";
import { batchLinesOf, BATCH_KIND, type BatchTerms } from "../policy/batchLines.js";
import { eurInFlightCents } from "../policy/available.js";
import { exclusive } from "../policy/payoutLock.js";
import { originJson } from "../provenance/origin.js";
import type { AirwallexRail } from "../airwallex/port.js";
import { batchTransferOn, BATCH_TRANSFER_FLAG, type AwxBatch, type AwxBatchItem, type BatchItemIn, type BatchTransferRail } from "../airwallex/batchTransfers.js";
import { describeTransferStatus } from "../airwallex/approvals.js";
import { holdReason, payeeReason } from "./invoicePayment.js";
import { checkPayingAccount } from "../airwallex/binding.js";

export interface OneBatchResult {
  batch_id: string;
  awx_batch_id: string | null;
  request_id: string;
  /**
   * SUBMITTED: sent for Airwallex's approval or schedule; REFUSED: refused before submit (the read-back differed, or a
   * hold), deleted while DRAFTING, nothing submitted; NOT_PAID: at Airwallex but rejected, cancelled, failed, or not as
   * signed (an alarm), so these terms do not run again.
   */
  outcome: "SUBMITTED" | "REFUSED" | "NOT_PAID";
  status: string;
  differences: string[];
  items: { proposal_id: string; request_id: string; item_id: string | null; status: string }[];
}

/** A UUID-shaped request_id derived from the signed batch hash: the same signed batch always maps to the same id. */
export function batchRequestId(batchSha256: string): string {
  const h = sha256Hex(`kit11 awx-batch v1 ${batchSha256}`);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

type Line = { proposal_id: string; terms_sha256: string; terms: InvoicePaymentTerms };

/** Why a line cannot go into an Airwallex batch transfer, or null. Only a EUR SWIFT invoice payment without a conversion. */
export function lineShapeRefusal(l: { proposal_id: string; kind: string; terms: unknown }): string | null {
  const t = l.terms as Partial<InvoicePaymentTerms>;
  if (l.kind !== "invoice_payment") return `${l.proposal_id} is a ${l.kind}; an Airwallex batch transfer holds EUR invoice payments only (run this batch line by line)`;
  if (t.conversion) return `${l.proposal_id} needs a conversion on its own approved quote first; run this batch line by line`;
  if (t.currency !== "EUR" || t.method !== "SWIFT") return `${l.proposal_id} is not a EUR SWIFT payment`;
  if ((t as { platform_fee?: unknown }).platform_fee) return `${l.proposal_id} carries a Purser fee, which this path does not take; run this batch line by line`;
  if ((t as { paying_account?: unknown }).paying_account) return `${l.proposal_id} pays from a connected account; run this batch line by line`;
  return null;
}

const outCents = (t: InvoicePaymentTerms) => toCents(t.amount) + toCents(t.fee_max);

/** The item Airwallex is asked to book for one signed line: exactly its terms. */
export function itemOf(l: Line, batchSha256: string): BatchItemIn {
  const t = l.terms;
  return {
    requestId: t.transfer_request_id, beneficiaryId: t.beneficiary_id, amountCents: toCents(t.amount), currency: "EUR", sourceCurrency: "EUR",
    method: "SWIFT", reference: t.reference, reason: t.reason, metadata: { approval_sha256: l.terms_sha256, batch_sha256: batchSha256, proposal_id: l.proposal_id },
  };
}

/** The differences on one item: Airwallex's transfer draft against the signed line, to the cent. */
function itemDifferences(l: Line, i: AwxBatchItem, opts: { requireDraft: boolean; status: string | null }): string[] {
  const out: string[] = [];
  const t = l.terms;
  const tag = `${l.proposal_id} (${t.invoice_no})`;
  if (opts.status && i.status !== opts.status) out.push(`${tag}: item is ${i.status}${i.errors.length ? ` (${i.errors.join("; ")})` : ""}`);
  const d = i.draft;
  if (!d) { if (opts.requireDraft) out.push(`${tag}: Airwallex shows no transfer draft to compare`); return out; }
  const want: [string, unknown, unknown][] = [
    ["payee", d.beneficiaryId, t.beneficiary_id],
    ["amount", fromCents(d.amountCents), t.amount],
    ["currency", d.currency, "EUR"],
    ["source currency", d.sourceCurrency, "EUR"],
    ["method", d.method, "SWIFT"],
    ["reference", d.reference, t.reference],
    ["approval hash", d.metadata.approval_sha256, l.terms_sha256],
  ];
  for (const [what, got, signed] of want) if (got !== signed) out.push(`${tag}: ${what} at Airwallex is ${String(got)}, signed ${String(signed)}`);
  if (d.reason != null && d.reason !== t.reason) out.push(`${tag}: reason at Airwallex is ${d.reason}, signed ${t.reason}`);
  // The fee and what the payer pays must be shown, in euros, and add up: the payer pays the amount plus the fee, and the
  // fee is within the signed ceiling. A draft without them is not a read-back.
  if (d.feeCents == null) out.push(`${tag}: Airwallex shows no fee to compare with the signed ceiling EUR ${t.fee_max}`);
  else {
    if (d.feeCurrency !== "EUR") out.push(`${tag}: fee is in ${d.feeCurrency ?? "no currency"}, not EUR`);
    if (d.feeCents > toCents(t.fee_max)) out.push(`${tag}: fee EUR ${fromCents(d.feeCents)} is above the signed ceiling EUR ${t.fee_max}`);
  }
  if (d.payerPaysCents == null) out.push(`${tag}: Airwallex shows no amount the payer pays`);
  else if (d.feeCents != null && d.payerPaysCents !== d.amountCents + d.feeCents) out.push(`${tag}: the payer would pay EUR ${fromCents(d.payerPaysCents)}, not the amount plus the fee (EUR ${fromCents(d.amountCents + d.feeCents)})`);
  return out;
}

/** Items Airwallex holds against the signed lines: exactly one per line, and none the CFO did not sign. */
function setDifferences(lines: Line[], items: AwxBatchItem[]): string[] {
  const out: string[] = [];
  if (items.length !== lines.length) out.push(`Airwallex holds ${items.length} items, the CFO signed ${lines.length}`);
  const signedIds = new Set(lines.map((l) => l.terms.transfer_request_id));
  for (const i of items) if (!signedIds.has(i.requestId)) out.push(`item ${i.id} (${i.requestId}) is not a line the CFO signed`);
  for (const l of lines) {
    const n = items.filter((i) => i.requestId === l.terms.transfer_request_id).length;
    if (n !== 1) out.push(`${l.proposal_id}: Airwallex holds ${n} items under ${l.terms.transfer_request_id}`);
  }
  return out;
}

/**
 * The read-back before submit: every difference between what Airwallex holds and what the CFO signed, line by line;
 * empty when they agree exactly. Pure, so it is tested on its own.
 */
export function compareReadBack(lines: Line[], batchSha256: string, batch: AwxBatch, items: AwxBatchItem[]): string[] {
  const out: string[] = [];
  if (batch.metadata.approval_sha256 !== batchSha256) out.push(`the batch at Airwallex carries approval hash ${batch.metadata.approval_sha256 ?? "none"}, the CFO signed ${batchSha256}`);
  if (batch.totalItemCount !== lines.length || batch.validItemCount !== lines.length) out.push(`Airwallex counts ${batch.validItemCount} valid of ${batch.totalItemCount} items, the CFO signed ${lines.length}`);
  out.push(...setDifferences(lines, items));
  let ceiling = 0, itemsPay = 0;
  for (const l of lines) {
    ceiling += outCents(l.terms);
    const i = items.find((x) => x.requestId === l.terms.transfer_request_id);
    if (!i) continue;
    out.push(...itemDifferences(l, i, { requireDraft: true, status: "VALIDATED" }));
    itemsPay += i.draft?.payerPaysCents ?? 0;
  }
  // The quote: present, in euros only, the same total as the items, and within the signed amounts plus fee ceilings.
  if (!batch.quotes.length) out.push("Airwallex shows no quote for the batch");
  if (batch.quotes.some((q) => q.sourceCurrency !== "EUR" || q.transferCurrency !== "EUR")) out.push("Airwallex quotes a currency other than EUR");
  const pays = batch.quotes.reduce((s, q) => s + q.payerPaysCents, 0);
  if (batch.quotes.length && pays !== itemsPay) out.push(`the quote totals EUR ${fromCents(pays)}, the items EUR ${fromCents(itemsPay)}`);
  if (pays > ceiling) out.push(`the payer would pay EUR ${fromCents(pays)}, above the signed EUR ${fromCents(ceiling)} (amounts plus fee ceilings)`);
  return out;
}

/** A batch already past DRAFTING at Airwallex (a resume): exactly the signed items, and any draft still shown agrees. */
export function compareSubmitted(lines: Line[], batchSha256: string, batch: AwxBatch, items: AwxBatchItem[]): string[] {
  const out: string[] = [];
  if (batch.metadata.approval_sha256 !== batchSha256) out.push(`the batch at Airwallex carries approval hash ${batch.metadata.approval_sha256 ?? "none"}, the CFO signed ${batchSha256}`);
  out.push(...setDifferences(lines, items));
  for (const l of lines) {
    const i = items.find((x) => x.requestId === l.terms.transfer_request_id);
    if (i?.draft) out.push(...itemDifferences(l, i, { requireDraft: false, status: null }));
  }
  return out;
}

const awxRow = (db: DB, batchId: string) => db.prepare("SELECT * FROM awx_batches WHERE batch_id = ?").get(batchId) as
  { batch_id: string; request_id: string; awx_batch_id: string | null; status: string; batch_sha256: string; detail_json: string | null } | undefined;

function setAwx(db: DB, batchId: string, f: { awx_batch_id?: string | null; status: string; detail?: unknown }): void {
  db.prepare("UPDATE awx_batches SET awx_batch_id = COALESCE(?, awx_batch_id), status = ?, detail_json = COALESCE(?, detail_json), updated_at = ? WHERE batch_id = ?")
    .run(f.awx_batch_id ?? null, f.status, f.detail === undefined ? null : JSON.stringify(f.detail), new Date().toISOString(), batchId);
}

/** Purser's own states of the record, before anything was submitted at Airwallex. */
const BEFORE_SUBMIT = new Set(["CREATING", "DRAFTING", "DELETING"]);
/** Airwallex batch statuses after which the batch goes on towards payment (or waits for a person at Airwallex). */
const GOING = new Set(["IN_APPROVAL", "SCHEDULED", "OVERDUE", "BOOKING", "BOOKED", "PARTIALLY_BOOKED"]);

/** Why one line must not be submitted now (the holds, the payee, its expiry), or null. Checked again just before submit. */
function lineRefusalNow(db: DB, l: Line, at: Date): string | null {
  const held = holdReason(db, l.terms, at) ?? payeeReason(db, l.terms);
  if (held) return `${l.proposal_id}: ${held}`;
  if (Date.parse(l.terms.expires_at) <= at.getTime()) return `${l.proposal_id} ran out at ${l.terms.expires_at}; approval void`;
  return null;
}

/** Runs an approved batch as one Airwallex batch transfer. Throws when the flag is off or a check refuses it. */
export async function executeAsOneAirwallexBatch(db: DB, rails: { batches: BatchTransferRail; rail: AirwallexRail }, batchId: string,
  opts: { now?: () => Date; env?: Record<string, string | undefined> } = {}): Promise<OneBatchResult> {
  const now = opts.now ?? (() => new Date());
  if (!batchTransferOn(opts.env ?? process.env)) throw new Error(`${BATCH_TRANSFER_FLAG} is not on; the batch runs line by line`);
  const p = db.prepare("SELECT kind, terms_sha256 FROM proposals WHERE proposal_id = ?").get(batchId) as { kind: string; terms_sha256: string } | undefined;
  if (p?.kind !== BATCH_KIND) throw new Error(`${batchId} is not a payment batch`);
  const sha = p.terms_sha256;
  const requestId = batchRequestId(sha);
  const prior = awxRow(db, batchId);
  if (prior && prior.status === "REFUSED") throw new Error(`${batchId} was refused at the read-back and deleted at Airwallex; a new batch and signature are needed`);
  // Submitted at Airwallex already (a resume): what was decided then is recorded now, not judged again on balances.
  const submitted = !!prior && !BEFORE_SUBMIT.has(prior.status);

  // 1 and 2: every check, and in the same transaction the payout rows and the record of the Airwallex batch, under the
  // payout lock: from the moment the floor is judged, these rows count as money under way.
  const lines = await exclusive(async () => {
    const pre = submitted ? null : treasuryState(db, await snapshot(db, rails.rail, `pre-exec:${batchId}`));
    let checked: Line[] = [];
    beginExecution<BatchTerms>(db, batchId, (t) => {
      const filed = batchLinesOf(db, batchId).map((l) => `${l.proposal_id}:${l.terms_sha256}`);
      if (filed.join(",") !== t.lines.map((l) => `${l.proposal_id}:${l.terms_sha256}`).join(",")) throw new Error(`${batchId}: its lines no longer match the signed batch`);
      checked = t.lines.map((l) => {
        const shape = lineShapeRefusal(l);
        if (shape) throw new Error(shape);
        const row = db.prepare("SELECT p.status, p.terms_sha256, a.approved_sha256, a.decision FROM proposals p LEFT JOIN approvals a ON a.proposal_id = p.proposal_id WHERE p.proposal_id = ?").get(l.proposal_id) as
          { status: string; terms_sha256: string; approved_sha256: string | null; decision: string | null } | undefined;
        if (!row || row.terms_sha256 !== l.terms_sha256 || row.approved_sha256 !== l.terms_sha256 || row.decision !== "APPROVED") throw new Error(`${l.proposal_id} is not approved on the terms signed in the batch`);
        if (row.status !== "APPROVED" && !(prior && (row.status === "FAILED" || row.status === "EXECUTING"))) throw new Error(`${l.proposal_id} is ${row.status}, not approved`);
        const line: Line = { proposal_id: l.proposal_id, terms_sha256: l.terms_sha256, terms: l.terms as unknown as InvoicePaymentTerms };
        // Purser as a platform: only from the account the CFO signed for (the batch client acts for the same account).
        checkPayingAccount(db, line.terms, { payingAccount: rails.batches.payingAccount ?? null }, now());
        if (submitted) return line;
        const why = lineRefusalNow(db, line, now());
        if (why) throw new Error(why);
        const other = (db.prepare("SELECT invoice_no, status FROM transfers WHERE request_id <> ? AND status <> 'CANCELLED'").all(line.terms.transfer_request_id) as { invoice_no: string; status: string }[])
          .find((r) => sameLedgerInvoice(r.invoice_no, partyOf(db, r.invoice_no), line.terms.invoice_no, { ...partyOf(db, line.terms.invoice_no), vendor: line.terms.vendor }));
        if (other) throw new Error(`${l.proposal_id}: invoice ${line.terms.invoice_no} already has a payout (${other.status}); nothing is sent`);
        return line;
      });
      if (pre) {
        // This batch's own rows (a re-run) are not counted twice: they are what the floor is judged for.
        const own = checked.reduce((s, l) => {
          const r = db.prepare("SELECT amount, fee_estimate FROM transfers WHERE request_id = ? AND status = 'SUBMITTING'").get(l.terms.transfer_request_id) as { amount: string; fee_estimate: string } | undefined;
          return s + (r ? toCents(r.amount) + toCents(r.fee_estimate) : 0);
        }, 0);
        const total = checked.reduce((s, l) => s + outCents(l.terms), 0);
        if (pre.eurAvailableCents - total < pre.eurFloorCents + pre.eurObligationsCents + eurInFlightCents(db) - own) {
          throw new Error(`EUR would drop under its floor, commitments and payouts under way with this batch (EUR ${fromCents(total)} with fee ceilings); nothing is sent`);
        }
      }
      if (!prior) db.prepare("INSERT INTO awx_batches (batch_id, request_id, awx_batch_id, status, batch_sha256, detail_json, updated_at) VALUES (?, ?, NULL, 'CREATING', ?, NULL, ?)").run(batchId, requestId, sha, now().toISOString());
      for (const l of checked) {
        if (db.prepare("SELECT 1 FROM transfers WHERE request_id = ?").get(l.terms.transfer_request_id)) continue;
        // A plain insert: the one-live-payout-per-invoice index refuses a duplicate here, before anything is sent.
        db.prepare("INSERT INTO transfers (request_id, invoice_no, amount, currency, method, fee_estimate, status, approval_sha256, updated_at, origin_json) VALUES (?, ?, ?, 'EUR', 'SWIFT', ?, 'SUBMITTING', ?, ?, ?)")
          .run(l.terms.transfer_request_id, l.terms.invoice_no, l.terms.amount, l.terms.fee_max, l.terms_sha256, now().toISOString(), originJson());
      }
    }, now());
    // Each line moves to EXECUTING through its own guard (its hash against its own approval), as a single payment does.
    try {
      for (const l of checked) {
        const st = (db.prepare("SELECT status FROM proposals WHERE proposal_id = ?").get(l.proposal_id) as { status: string }).status;
        if (st === "APPROVED" || st === "FAILED") beginExecution(db, l.proposal_id, () => {}, now());
      }
    } catch (err) {
      for (const l of checked) {
        if ((db.prepare("SELECT status FROM proposals WHERE proposal_id = ?").get(l.proposal_id) as { status: string }).status === "EXECUTING") finishExecution(db, l.proposal_id, "FAILED", { error: (err as Error).message.slice(0, 300), batch_id: batchId }, now());
      }
      finishExecution(db, batchId, "FAILED", { error: (err as Error).message.slice(0, 300) }, now());
      throw err;
    }
    return checked;
  });

  const finishAll = (outcome: "EXECUTED" | "FAILED" | "NEEDS_REAPPROVAL", detail: Record<string, unknown>) => {
    for (const l of lines) {
      const st = (db.prepare("SELECT status FROM proposals WHERE proposal_id = ?").get(l.proposal_id) as { status: string }).status;
      if (st === "EXECUTING") finishExecution(db, l.proposal_id, outcome, { ...detail, batch_id: batchId } as never, now());
    }
    finishExecution(db, batchId, outcome, detail as never, now());
  };
  const itemsOf = (read: AwxBatchItem[]) => lines.map((l) => {
    const i = read.find((x) => x.requestId === l.terms.transfer_request_id);
    return { proposal_id: l.proposal_id, request_id: l.terms.transfer_request_id, item_id: i?.id ?? null, status: i?.status ?? "missing" };
  });

  /** Refuses the batch while DRAFTING: the intent is recorded first, then Airwallex deletes it; nothing is submitted. */
  const refuse = async (batch: AwxBatch, differences: string[], read: AwxBatchItem[]): Promise<OneBatchResult> => {
    setAwx(db, batchId, { status: "DELETING", detail: { differences } });
    if (batch.status === "DRAFTING") await rails.batches.deleteBatch(batch.id);
    db.transaction(() => {
      for (const l of lines) db.prepare("UPDATE transfers SET status = 'CANCELLED', failure_type = 'READ_BACK_DIFFERS', updated_at = ? WHERE request_id = ? AND transfer_id IS NULL").run(now().toISOString(), l.terms.transfer_request_id);
      setAwx(db, batchId, { status: "REFUSED" });
    }).immediate();
    audit(db, "awx-executor", "awx_batch.refused_and_deleted", batch.id, { batch_id: batchId, reason: "refused before submit; deleted while DRAFTING, nothing submitted", differences: differences.slice(0, 20) });
    finishAll("NEEDS_REAPPROVAL", { awx_batch_id: batch.id, error: `refused before submit: ${differences.join("; ").slice(0, 280)}` });
    return { batch_id: batchId, awx_batch_id: batch.id, request_id: requestId, outcome: "REFUSED", status: "CANCELLED", differences, items: itemsOf(read) };
  };

  try {
    // 3: one batch, never two.
    let batch = await findOrCreate(db, rails.batches, batchId, requestId, sha, lines.length, !!prior);
    if (batch.metadata.approval_sha256 !== sha) throw new Error(`the batch under ${requestId} at Airwallex does not carry this batch's approval hash; nothing is submitted, a person checks it`);
    const was = awxRow(db, batchId)!.status;
    if (was !== "DELETING") setAwx(db, batchId, { awx_batch_id: batch.id, status: batch.status === "DRAFTING" ? "DRAFTING" : was });
    else setAwx(db, batchId, { awx_batch_id: batch.id, status: was });
    audit(db, "awx-executor", "awx_batch.created", batch.id, { batch_id: batchId, request_id: requestId, approval_sha256: sha, items: lines.length, status: batch.status });

    if (was === "DELETING" && (batch.status === "DRAFTING" || batch.status === "CANCELLED")) {
      // A refusal that did not finish (its answer lost, a crash): finished now, never submitted.
      const d = JSON.parse(awxRow(db, batchId)!.detail_json ?? "{}") as { differences?: string[] };
      return await refuse(batch, d.differences ?? ["an earlier refusal, finished on a re-run"], []);
    }
    let read: AwxBatchItem[] = [];
    if (batch.status === "DRAFTING") {
      // 4: the items (≤ 100 per call; a Purser batch holds at most 50). A repeated request_id is ignored by Airwallex.
      const items = lines.map((l) => itemOf(l, sha));
      for (let i = 0; i < items.length; i += 100) batch = await rails.batches.addItems(batch.id, items.slice(i, i + 100));
      // 5: the quote fills each item's transfer draft; then the read-back, item by item.
      batch = await rails.batches.quoteBatch(batch.id, "MIN_15");
      read = await rails.batches.listItems(batch.id);
      const differences = compareReadBack(lines, sha, batch, read);
      audit(db, "awx-executor", "awx_batch.read_back", batch.id, {
        batch_id: batchId, items: read.length, valid: batch.validItemCount, agrees: differences.length === 0, differences: differences.slice(0, 20),
        // What Airwallex would book, per item, as read: the numbers a page about this batch shows come from here.
        read: read.map((i) => ({ request_id: i.requestId, status: i.status, amount: i.draft ? fromCents(i.draft.amountCents) : null, currency: i.draft?.currency ?? null, fee: i.draft?.feeCents != null ? fromCents(i.draft.feeCents) : null, fee_currency: i.draft?.feeCurrency ?? null, payer_pays: i.draft?.payerPaysCents != null ? fromCents(i.draft.payerPaysCents) : null })),
        quotes: batch.quotes.map((q) => ({ source_currency: q.sourceCurrency, transfer_currency: q.transferCurrency, payer_pays: fromCents(q.payerPaysCents), fee: fromCents(q.feeCents), fee_currency: q.feeCurrency })),
      });
      if (differences.length) return await refuse(batch, differences, read);
      // The holds, the payee and each line's expiry, again just before submit (several calls have passed).
      const late = lines.map((l) => lineRefusalNow(db, l, now())).filter((x): x is string => !!x);
      if (late.length) return await refuse(batch, late, read);
      // 6: submit.
      batch = await rails.batches.submitBatch(batch.id);
    } else if (BEFORE_SUBMIT.has(was) || was === "DELETING") {
      // Past DRAFTING at Airwallex though Purser never recorded a submit (a lost answer, or submitted elsewhere): adopted
      // only if it holds exactly the signed items.
      read = await rails.batches.listItems(batch.id);
      const differences = compareSubmitted(lines, sha, batch, read);
      if (was === "DELETING") differences.unshift("Purser had refused this batch, yet Airwallex shows it past DRAFTING");
      if (differences.length) {
        audit(db, "awx-executor", "awx_batch.submitted_differs", batch.id, { batch_id: batchId, status: batch.status, differences: differences.slice(0, 20) });
        db.transaction(() => {
          setAwx(db, batchId, { status: batch.status, detail: { differences } });
          for (const l of lines) db.prepare("UPDATE transfers SET status = ?, updated_at = ? WHERE request_id = ? AND transfer_id IS NULL").run(rowStatus(batch.status), now().toISOString(), l.terms.transfer_request_id);
        }).immediate();
        finishAll("NEEDS_REAPPROVAL", { awx_batch_id: batch.id, status: batch.status, error: `at Airwallex past DRAFTING and not as signed: ${differences.join("; ").slice(0, 260)}` });
        return { batch_id: batchId, awx_batch_id: batch.id, request_id: requestId, outcome: "NOT_PAID", status: batch.status, differences, items: itemsOf(read) };
      }
    }
    const status = batch.status;
    db.transaction(() => {
      setAwx(db, batchId, { status });
      for (const l of lines) db.prepare("UPDATE transfers SET status = ?, updated_at = ? WHERE request_id = ? AND transfer_id IS NULL").run(rowStatus(status), now().toISOString(), l.terms.transfer_request_id);
    }).immediate();
    audit(db, "awx-executor", "awx_batch.submitted", batch.id, { batch_id: batchId, status, in_words: describeBatchStatus(status), approval_sha256: sha });
    const final = await rails.batches.listItems(batch.id).catch(() => read);
    if (!GOING.has(status)) {
      // Rejected, recalled, blocked, cancelled or failed at Airwallex: not paid, and these terms do not run again.
      finishAll("NEEDS_REAPPROVAL", { awx_batch_id: batch.id, status, error: `Airwallex ${describeBatchStatus(status)}` });
      return { batch_id: batchId, awx_batch_id: batch.id, request_id: requestId, outcome: "NOT_PAID", status, differences: [], items: itemsOf(final) };
    }
    finishAll("EXECUTED", { awx_batch_id: batch.id, status, ...(status === "IN_APPROVAL" ? { waiting_for: "Airwallex approval" } : {}) });
    return { batch_id: batchId, awx_batch_id: batch.id, request_id: requestId, outcome: "SUBMITTED", status, differences: [], items: itemsOf(final) };
  } catch (err) {
    // The payout rows stay as they are (SUBMITTING counts them as money under way): a re-run resumes from the recorded
    // Airwallex batch, by its id or its request_id, and never creates a second one. The lines stay tied to the batch
    // (src/policy/awxBatchLink.ts), so they are never paid on their own meanwhile.
    finishAll("FAILED", { error: (err as Error).message.slice(0, 300) });
    throw err;
  }
}

async function findOrCreate(db: DB, rail: BatchTransferRail, batchId: string, requestId: string, sha: string, n: number, resuming: boolean): Promise<AwxBatch> {
  const known = awxRow(db, batchId)?.awx_batch_id;
  if (known) return rail.getBatch(known);
  if (resuming) {
    const found = await rail.findBatchByRequestId(requestId);
    if (found) { audit(db, "awx-executor", "awx_batch.adopted", found.id, { batch_id: batchId, request_id: requestId }); return found; }
  }
  try {
    return await rail.createBatch({ requestId, name: `Purser ${batchId} (${n} invoices)`, metadata: { approval_sha256: sha, purser_batch: batchId } });
  } catch (err) {
    // The answer may be lost while Airwallex made it (or it already holds this request_id): look it up, never resend.
    const found = await rail.findBatchByRequestId(requestId);
    if (found) { audit(db, "awx-executor", "awx_batch.adopted", found.id, { batch_id: batchId, request_id: requestId }); return found; }
    throw err;
  }
}

/** The payout rows' status while their batch is at Airwallex. */
function rowStatus(batchStatus: string): string {
  if (batchStatus === "IN_APPROVAL" || batchStatus.startsWith("APPROVAL_")) return batchStatus;
  if (batchStatus === "CANCELLED" || batchStatus === "FAILED") return "CANCELLED";
  return "SCHEDULED";
}

export function describeBatchStatus(status: string): string {
  switch (status) {
    case "DRAFTING": return "being drafted at Airwallex; nothing submitted";
    case "SCHEDULED": case "BOOKING": case "BOOKED": case "PARTIALLY_BOOKED": return `${status.toLowerCase().replace("_", " ")} at Airwallex`;
    default: return describeTransferStatus(status);
  }
}

/**
 * Reads the Airwallex batch back (GET only) and records what changed: its status, and each booked item's transfer id on
 * its payout row (from then on each payout is followed like any other, src/airwallex/approvals.ts). Never approves,
 * submits or resends anything.
 */
export async function followAirwallexBatch(db: DB, rail: BatchTransferRail, batchId: string, now = new Date()): Promise<{ status: string; changed: boolean; booked: number; mismatch: string | null }> {
  const row = awxRow(db, batchId);
  if (!row?.awx_batch_id) throw new Error(`${batchId} has no Airwallex batch`);
  const b = await rail.getBatch(row.awx_batch_id);
  const items = await rail.listItems(row.awx_batch_id);
  const changed = b.status !== row.status;
  let booked = 0;
  let mismatch: string | null = null;
  const ours = new Set((db.prepare("SELECT proposal_id FROM batch_lines WHERE batch_id = ?").all(batchId) as { proposal_id: string }[]).map((r) => r.proposal_id));
  const signed = new Map<string, string>();
  for (const id of ours) {
    const t = JSON.parse((db.prepare("SELECT terms_json FROM proposals WHERE proposal_id = ?").get(id) as { terms_json: string }).terms_json) as InvoicePaymentTerms;
    signed.set(t.transfer_request_id, id);
  }
  for (const i of items) if (!signed.has(i.requestId)) mismatch = `item ${i.id} (${i.requestId}) at Airwallex is not a line the CFO signed`;
  db.transaction(() => {
    setAwx(db, batchId, { status: b.status });
    for (const i of items) {
      if (!signed.has(i.requestId)) continue;
      if (i.transferId) {
        booked++;
        db.prepare("UPDATE transfers SET transfer_id = ?, status = CASE WHEN status IN ('IN_APPROVAL', 'SCHEDULED', 'SUBMITTING') THEN 'SCHEDULED' ELSE status END, updated_at = ? WHERE request_id = ? AND transfer_id IS NULL")
          .run(i.transferId, now.toISOString(), i.requestId);
      } else if (i.status === "BOOKING_FAILED" || i.status === "VALIDATION_FAILED") {
        // This item will never be booked: its payout row is closed, so the invoice can be paid again (a new proposal).
        db.prepare("UPDATE transfers SET status = 'CANCELLED', failure_type = ?, updated_at = ? WHERE request_id = ? AND transfer_id IS NULL AND status <> 'CANCELLED'").run(i.status, now.toISOString(), i.requestId);
      } else if (changed) {
        db.prepare("UPDATE transfers SET status = ?, updated_at = ? WHERE request_id = ? AND transfer_id IS NULL").run(rowStatus(b.status), now.toISOString(), i.requestId);
      }
    }
  }).immediate();
  if (changed) audit(db, "awx-executor", "awx_batch.status", row.awx_batch_id, { batch_id: batchId, status: b.status, was: row.status, in_words: describeBatchStatus(b.status), booked }, now);
  if (mismatch) audit(db, "awx-executor", "awx_batch.item_not_signed", row.awx_batch_id, { batch_id: batchId, detail: mismatch }, now);
  return { status: b.status, changed, booked, mismatch };
}
