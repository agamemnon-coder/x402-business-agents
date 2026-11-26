// A failed transfer, replaced once and never twice (25 November). Airwallex: a payout can fail after it was sent (the
// supplier's bank rejects it); the money comes back and the transfer ends CANCELLED with its failure type. Until now the
// invoice then waited for a person, who filed and approved a new payment. Here Purser may send exactly one replacement:
//   - only for a supplier or invoice payment whose stored terms still hash to the approved hash (the same amount, payee,
//     currency, reference and approval hash go to Airwallex again; a new conversion is never made: the money came back
//     in the payout's own currency);
//   - only after it read the first transfer at Airwallex itself as final-failed: CANCELLED with a failure type, under our
//     own request_id, amount, currency and payee. FAILED but not yet closed waits; still under way, cancelled by a person
//     in Airwallex's approval workflow (no failure type), paid and then returned, or a read that fails: a person decides;
//   - under one new request_id derived from the first (replacementRequestId), written before it is sent, so a crash, a
//     second runner or a lost answer can only find or resend that one: Airwallex keys transfers by request_id, and the
//     ledger's one_live_transfer_per_invoice index refuses a second live payout for the invoice;
//   - once: a replacement that fails too, or whose own outcome is not known, stops for a person. Never a third send.
// Every hold the executors check (the emergency stop, a pause or stop, the agent's identity, a blocked or changed payee)
// and the currency's floor on fresh balances are checked again first. Every stop is audited (transfer.replace_stopped).

import { createHash } from "node:crypto";
import { AirwallexAmbiguous, AirwallexError } from "../airwallex/client.js";
import type { AirwallexRail, PayoutRail, SandboxSim, Transfer } from "../airwallex/port.js";
import { negotiationOf, type InvoicePaymentTerms } from "../agents/euroBill.js";
import { audit } from "../audit/log.js";
import type { DB } from "../db/open.js";
import { fromCents, toCents } from "../lib/money.js";
import { RETURNED_AFTER_PAID } from "../payouts/feeKept.js";
import { freeCents, type PlatformFields, type SupplierPaymentTerms } from "../payouts/plan.js";
import { recordRationale } from "../payouts/rationale.js";
import { signedTerms } from "../policy/approvals.js";
import { exclusive } from "../policy/payoutLock.js";
import { originJson, withOrigin } from "../provenance/origin.js";
import { floorReasonNow, holdReason as invoiceHold, payeeReason, REFUSED_AT_CREATE } from "./invoicePayment.js";
import { holdReason as supplierHold } from "./supplierPayment.js";

/** What a replacement needs of Airwallex: read a transfer, find one by request_id, the balances, and create a payout. */
export type ReplaceRail = Pick<PayoutRail, "getTransfer" | "findTransferByRequestIdStrict" | "balancesAll" | "createPayoutTransfer"> & Pick<AirwallexRail, "createTransfer" | "balances">;

export type ReplaceOutcome =
  | { outcome: "replaced"; original: string; request_id: string; transfer: Transfer; adopted: boolean }
  | { outcome: "already_replaced"; original: string; request_id: string; status: string }
  /** Airwallex has it FAILED but has not closed it yet: nothing is sent; the follow-up asks again later. */
  | { outcome: "waiting"; original: string; reason: string }
  /** Nothing is sent; a person decides (transfer.replace_stopped). */
  | { outcome: "stopped"; code: StopCode; reason: string };

export type StopCode = "not_a_payout" | "terms_changed" | "platform_fee" | "not_sent" | "read_failed" | "not_this_payout" | "returned_after_paid"
  | "cancelled_not_failed" | "not_failed" | "held" | "floor" | "refused_at_create" | "replacement_unknown" | "replaced_once";

type Terms = (SupplierPaymentTerms | InvoicePaymentTerms) & PlatformFields;
type Row = { request_id: string; transfer_id: string | null; status: string; failure_type: string | null };

/** The one request_id a payout's replacement is sent under: derived from the first, so every runner finds the same one. */
export function replacementRequestId(original: string): string {
  const h = createHash("sha256").update(`purser:replacement:1:${original}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${((parseInt(h[16]!, 16) & 3) | 8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

const DONE = new Set(["FAILED", "CANCELLED"]);
/** The failure type of a replacement row Purser closed before its create because a hold was set. */
const HELD = "held_by_purser";
/** A person's or Airwallex's own stop that is not a payment failure: approval rejected, recalled or blocked. */
const NOT_A_FAILURE = new Set(["APPROVAL_REJECTED", "APPROVAL_RECALLED", "APPROVAL_BLOCKED"]);
const codeOf = (e: unknown) => (e instanceof AirwallexError ? e.code : (e as { code?: string }).code) ?? "";

/**
 * Replaces the failed payout of an executed supplier or invoice payment once, as the header says. `sim` (sandbox only)
 * moves the replacement to PAID through Airwallex's simulation API, as the executors do. Never throws for a payment
 * reason: the outcome says what happened, and every stop is audited for a person.
 */
export async function replaceFailedPayout(db: DB, rail: ReplaceRail, sim: SandboxSim | null, proposalId: string, now: () => Date = () => new Date()): Promise<ReplaceOutcome> {
  const { approvalOrigin } = await import("./index.js");
  const origin = approvalOrigin(db, proposalId);
  const run = () => replace(db, rail, sim, proposalId, now);
  const out = await (origin ? withOrigin(origin, run) : run());
  recordRationale(db, proposalId, null, now());
  return out;
}

async function replace(db: DB, rail: ReplaceRail, sim: SandboxSim | null, proposalId: string, now: () => Date): Promise<ReplaceOutcome> {
  const kind = (db.prepare("SELECT kind FROM proposals WHERE proposal_id = ?").get(proposalId) as { kind: string } | undefined)?.kind;
  let original = proposalId;
  const stop = (code: StopCode, reason: string): ReplaceOutcome => {
    audit(db, "awx-executor", "transfer.replace_stopped", original, { proposal_id: proposalId, code, reason: reason.slice(0, 300), next: "nothing was sent; a person decides" }, now());
    return { outcome: "stopped", code, reason };
  };
  if (kind !== "supplier_payment" && kind !== "invoice_payment") return stop("not_a_payout", `${proposalId} is not a supplier or invoice payment`);
  // The same approved terms: the stored terms still hash to the hash the CFO's approval records.
  const signed = signedTerms<Terms>(db, proposalId);
  if (!signed.ok) return stop("terms_changed", signed.reason);
  const t = signed.terms;
  const sha = signed.sha256;
  original = t.transfer_request_id;
  // Purser's fee rides on the payout it was signed with; a payout carrying it is not replaced by code.
  if (t.platform_fee) return stop("platform_fee", "the payout carried Purser's platform fee; a replacement with it is left to a person");
  const row = db.prepare("SELECT request_id, transfer_id, status, failure_type FROM transfers WHERE request_id = ?").get(original) as Row | undefined;
  if (!row?.transfer_id) return stop("not_sent", "no transfer of this payment is at Airwallex; nothing to replace (an unsent row is the reconciliation's)");
  const newId = replacementRequestId(original);

  // Replaced before: never a second replacement. One whose outcome is not known yet is looked up by its own request_id.
  const prior = db.prepare("SELECT request_id, transfer_id, status, failure_type FROM transfers WHERE replaces_request_id = ?").get(original) as Row | undefined;
  if (prior) {
    // Held by Purser right before its create (below): nothing was sent under it, and it is never tried again by code.
    if (!prior.transfer_id && prior.status === "CANCELLED" && prior.failure_type === HELD) return stop("held", `the replacement ${prior.request_id} was held by Purser before its create; nothing was sent, and it is not tried again (a new proposal pays it)`);
    if (!prior.transfer_id) {
      let found: Transfer | undefined;
      try { found = await rail.findTransferByRequestIdStrict(prior.request_id); } catch { found = undefined; }
      if (!found || !isThis(found, t, prior.request_id)) return stop("replacement_unknown", `the replacement ${prior.request_id} was written but Airwallex does not show it; nothing is sent again under another request_id`);
      return adopt(db, t, sha, original, found, sim, now);
    }
    let cur: Transfer;
    try { cur = await rail.getTransfer(prior.transfer_id); } catch (e) { return stop("read_failed", `the replacement ${prior.transfer_id} could not be read (${(e as Error).message.slice(0, 120)})`); }
    note(db, prior.transfer_id, prior.status, cur, now());
    if (DONE.has(cur.status) || NOT_A_FAILURE.has(cur.status)) return stop("replaced_once", `the replacement ${prior.transfer_id} is ${cur.status} too; a payout is replaced once, never twice`);
    return { outcome: "already_replaced", original, request_id: prior.request_id, status: cur.status };
  }

  // The first transfer, read at Airwallex now: it must be this payout, and final-failed.
  let first: Transfer;
  try { first = await rail.getTransfer(row.transfer_id); } catch (e) { return stop("read_failed", `the transfer ${row.transfer_id} could not be read at Airwallex (${(e as Error).message.slice(0, 120)}); whether it failed is not known`); }
  if (!isThis(first, t, original)) return stop("not_this_payout", `Airwallex's transfer ${first.id} is not this payout's (request_id, amount, currency or payee differ)`);
  note(db, row.transfer_id, row.status, first, now());
  if (db.prepare("SELECT 1 FROM audit_log WHERE event = ? AND subject = ?").get(RETURNED_AFTER_PAID, row.transfer_id)) {
    return stop("returned_after_paid", "it was paid and then returned by the supplier's bank; nothing is sent again under this approval");
  }
  if (first.status === "FAILED") return { outcome: "waiting", original, reason: "Airwallex has it FAILED and has not closed it yet; asked again once it is" };
  if (first.status === "CANCELLED" && !first.failureType) return stop("cancelled_not_failed", "cancelled at Airwallex without a failure (a person's decision in Airwallex); it is not replaced");
  if (first.status !== "CANCELLED") return stop(NOT_A_FAILURE.has(first.status) ? "cancelled_not_failed" : "not_failed", `Airwallex has it ${first.status}, not failed`);

  // Every hold the executor checks, then the floor on fresh balances, before anything is written.
  const holdNow = () => (kind === "supplier_payment" ? supplierHold(db, t as SupplierPaymentTerms, now()) : invoiceHold(db, t as InvoicePaymentTerms, now()) ?? payeeReason(db, t as InvoicePaymentTerms));
  const held = holdNow();
  if (held) return stop("held", held);
  const fee = kind === "supplier_payment" ? (t as SupplierPaymentTerms).fee_reserve : (t as InvoicePaymentTerms).fee_max;
  const written = await exclusive(async (): Promise<string | null> => {
    if (kind === "invoice_payment") {
      const why = await floorReasonNow(db, rail as unknown as AirwallexRail, t as InvoicePaymentTerms);
      if (why) return why;
    } else {
      const fresh = await rail.balancesAll();
      if (freeCents(db, fresh, t.currency, newId, proposalId) - toCents(t.amount) - toCents(fee) < 0) return `${t.currency} would now drop under its floor, commitments and payouts under way`;
    }
    // Written before it is sent, once: the unique index allows one live payout per invoice, and the check below one
    // replacement per payout, in the same transaction.
    return db.transaction((): string | null => {
      if (db.prepare("SELECT 1 FROM transfers WHERE replaces_request_id = ?").get(original)) return "replaced already by another runner";
      db.prepare("INSERT INTO transfers (request_id, invoice_no, amount, currency, method, fee_estimate, status, replaces_request_id, approval_sha256, updated_at, origin_json) VALUES (?, ?, ?, ?, ?, ?, 'SUBMITTING', ?, ?, ?, ?)")
        .run(newId, t.invoice_no, t.amount, t.currency, t.method, fee, original, sha, now().toISOString(), originJson());
      return null;
    }).immediate();
  });
  if (written) return stop(written.startsWith("replaced already") ? "replaced_once" : "floor", written);

  // Review of 26 Nov: the holds again right before the create, so one set during the floor's round-trip (the emergency
  // stop, a pause, a revocation) stops it. The written row is closed as never sent, and the replacement is spent.
  const heldAtCreate = holdNow();
  if (heldAtCreate) {
    db.transaction(() => {
      db.prepare("UPDATE transfers SET status = 'CANCELLED', failure_type = ?, failure_reason = ?, updated_at = ? WHERE request_id = ? AND transfer_id IS NULL AND status = 'SUBMITTING'")
        .run(HELD, `not sent: ${heldAtCreate}`.slice(0, 300), now().toISOString(), newId);
      audit(db, "awx-executor", "transfer.held_before_create", newId, { before: "transfer", reason: heldAtCreate.slice(0, 300), proposal_id: proposalId, request_id: newId, replaces: original, amount: `${t.currency} ${t.amount}`, approval_sha256: sha }, now());
    })();
    return stop("held", heldAtCreate);
  }

  let made: Transfer;
  try {
    made = kind === "invoice_payment"
      ? await rail.createTransfer({ requestId: newId, beneficiaryId: t.beneficiary_id, amountCents: toCents(t.amount), currency: "EUR", sourceCurrency: "EUR", reference: t.reference, reason: t.reason, approvalSha256: sha, ...(negotiationOf(t) ? { agreementSha256: negotiationOf(t)!.agreement_sha256 } : {}) })
      : await rail.createPayoutTransfer({ requestId: newId, beneficiaryId: t.beneficiary_id, amountCents: toCents(t.amount), currency: t.currency, sourceCurrency: t.currency, method: (t as SupplierPaymentTerms).method, reference: t.reference, reason: t.reason, approvalSha256: sha });
  } catch (e) {
    if (REFUSED_AT_CREATE.has(codeOf(e)) && (!(e instanceof AirwallexError) || e.status === 400) && !(e instanceof AirwallexAmbiguous)) {
      // Refused outright at its first send: nothing was made. The row is closed, and the replacement is spent: never another.
      db.prepare("UPDATE transfers SET status = 'CANCELLED', failure_type = ?, failure_reason = ?, updated_at = ? WHERE request_id = ? AND transfer_id IS NULL AND status = 'SUBMITTING'")
        .run(codeOf(e), `replacement refused by Airwallex at create: ${codeOf(e)}`, now().toISOString(), newId);
      return stop("refused_at_create", `Airwallex refused the replacement at create (${codeOf(e)}); nothing was made`);
    }
    // A lost answer, a duplicate, a server error: Airwallex may hold it. Looked up by its own request_id, never resent blind.
    let found: Transfer | undefined;
    try { found = await rail.findTransferByRequestIdStrict(newId); } catch { found = undefined; }
    if (!found || !isThis(found, t, newId)) return stop("replacement_unknown", `the replacement's outcome is not known (${(e as Error).message.slice(0, 120)}); it stays written under ${newId} and is never sent under another`);
    return adopt(db, t, sha, original, found, sim, now);
  }
  return finish(db, t, sha, original, made, false, sim, now);
}

/** Airwallex's transfer is this payout under this request_id: the amount, currency and payee the CFO approved. */
function isThis(found: Transfer, t: Terms, requestId: string): boolean {
  return found.requestId === requestId && found.amountCents === toCents(t.amount) && found.currency === t.currency && (found.beneficiaryId == null || found.beneficiaryId === t.beneficiary_id);
}

/** The ledger row follows Airwallex's status when it changed. */
function note(db: DB, transferId: string, was: string, fresh: Transfer, at: Date): void {
  if (fresh.status === was) return;
  db.prepare("UPDATE transfers SET status = ?, failure_type = ?, failure_reason = ?, updated_at = ? WHERE transfer_id = ?").run(fresh.status, fresh.failureType ?? null, fresh.failureReason ?? null, at.toISOString(), transferId);
  audit(db, "awx-executor", "transfer.status", transferId, { status: fresh.status, read: "read at Airwallex before a replacement" }, at);
}

function adopt(db: DB, t: Terms, sha: string, original: string, found: Transfer, sim: SandboxSim | null, now: () => Date): Promise<ReplaceOutcome> {
  return finish(db, t, sha, original, found, true, sim, now);
}

async function finish(db: DB, t: Terms, sha: string, original: string, tr: Transfer, adopted: boolean, sim: SandboxSim | null, now: () => Date): Promise<ReplaceOutcome> {
  const at = now();
  const first = db.prepare("SELECT transfer_id, failure_type FROM transfers WHERE request_id = ?").get(original) as { transfer_id: string; failure_type: string | null };
  db.transaction(() => {
    db.prepare("UPDATE transfers SET transfer_id = ?, status = ?, updated_at = ? WHERE request_id = ?").run(tr.id, tr.status, at.toISOString(), tr.requestId);
    audit(db, "awx-executor", adopted ? "transfer.adopted" : "transfer.created", tr.id, { request_id: tr.requestId, replaces: original, amount: `${t.currency} ${t.amount}`, beneficiary_id: t.beneficiary_id, status: tr.status, approval_sha256: sha }, at);
    audit(db, "awx-executor", "transfer.replaced", original, {
      proposal_id: t.proposal_id, first_transfer: first.transfer_id, failure_type: first.failure_type, replacement_request_id: tr.requestId, replacement_transfer: tr.id,
      same_terms: { amount: `${t.currency} ${t.amount}`, beneficiary_id: t.beneficiary_id, approval_sha256: sha }, once: "a payout is replaced once; if this one fails too, a person decides",
    }, at);
  }).immediate();
  let cur = tr;
  if (sim && !["IN_APPROVAL", "PAID"].includes(cur.status)) {
    // Sandbox only: the settlement Airwallex simulates, as the executors do (src/executors/supplierPayment.ts).
    for (const to of ["SENT", "PAID"] as const) {
      if (cur.status === to) continue;
      cur = await sim.transitionTransfer(tr.id, to);
      db.prepare("UPDATE transfers SET status = ?, updated_at = ? WHERE transfer_id = ?").run(cur.status, now().toISOString(), tr.id);
      audit(db, "awx-executor", "transfer.status", tr.id, { status: cur.status }, now());
    }
    if (cur.fee) db.prepare("UPDATE transfers SET fee_actual = ? WHERE transfer_id = ?").run(`${cur.fee.currency} ${fromCents(cur.fee.cents)}`, tr.id);
  }
  return { outcome: "replaced", original, request_id: tr.requestId, transfer: cur, adopted };
}

/**
 * The follow-up's hook (src/payouts/follow.ts FollowOptions.replaceFailed) for a runner that switched replacements on
 * (KIT11_REPLACE_FAILED_PAYOUT=on): null when it is off, or when the rail cannot also send a Kit 11 euro payout.
 */
export function replaceFailedHook(db: DB, rail: unknown, env: Record<string, string | undefined> = process.env): ((proposalId: string) => Promise<string>) | null {
  const r = rail as Partial<ReplaceRail>;
  if (env.KIT11_REPLACE_FAILED_PAYOUT !== "on" || typeof r.createTransfer !== "function" || typeof r.createPayoutTransfer !== "function") return null;
  return async (proposalId) => {
    // Asked once: a payout replaced already, or whose replacement stopped for a person, is not asked again.
    const t = db.prepare("SELECT json_extract(terms_json, '$.transfer_request_id') AS r FROM proposals WHERE proposal_id = ?").get(proposalId) as { r: string | null } | undefined;
    if (t?.r && (db.prepare("SELECT 1 FROM transfers WHERE replaces_request_id = ?").get(t.r) || db.prepare("SELECT 1 FROM audit_log WHERE event = 'transfer.replace_stopped' AND subject = ?").get(t.r))) return "asked before";
    const out = await replaceFailedPayout(db, rail as ReplaceRail, null, proposalId);
    return out.outcome === "replaced" ? `replaced: ${out.transfer.status}` : out.outcome;
  };
}
