// Before the signature and after it (sandbox only, test money; docs: api/payouts/transfers, read 19 November 2026).
//   POST /api/v1/transfers/validate      Airwallex checks the exact transfer Purser is about to ask the CFO to sign
//                                         (payee, amount, currency, method, reference), without creating it: terms
//                                         Airwallex would refuse never reach the CFO's passkey.
//   POST /api/v1/transfers/create        with a future transfer_date: Airwallex holds it as SCHEDULED until that day.
//   POST /api/v1/transfers/{id}/cancel   the CFO withdraws a signed payment before its day: Purser cancels it at
//                                         Airwallex and reads it back. Only a SCHEDULED transfer is cancelled; money
//                                         already on its way is never "cancelled" by Purser (it is a return, the bank's).

import { AirwallexError, type Airwallex } from "./client.js";
import { fromCents } from "../lib/money.js";

export interface PlannedTransfer { requestId: string; beneficiaryId: string; amountCents: number; currency: string; reference: string; reason: string; approvalSha256: string; transferDate?: string }
export interface TransferState { id: string; status: string; amount: string; currency: string; reference: string | null; transferDate: string | null; requestId: string | null }
type RawTransfer = { id: string; status: string; transfer_amount?: number | string; amount?: number | string; transfer_currency?: string; reference?: string | null; transfer_date?: string | null; request_id?: string | null };

const toState = (t: RawTransfer): TransferState => ({
  id: t.id, status: t.status, amount: Number(t.transfer_amount ?? t.amount ?? 0).toFixed(2), currency: t.transfer_currency ?? "", reference: t.reference ?? null,
  transferDate: t.transfer_date ? String(t.transfer_date).slice(0, 10) : null, requestId: t.request_id ?? null,
});

/** The body Airwallex receives for this transfer; the same for validate and create, so what is validated is what is sent. */
export function transferBody(t: PlannedTransfer): Record<string, unknown> {
  if (!/^[0-9a-f]{64}$/.test(t.approvalSha256)) throw new Error("a transfer carries the hash of the terms the CFO signs (64 hex)");
  if (t.transferDate !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(t.transferDate)) throw new Error("transfer_date is YYYY-MM-DD");
  return {
    request_id: t.requestId, beneficiary_id: t.beneficiaryId, transfer_amount: fromCents(t.amountCents), transfer_currency: t.currency, source_currency: t.currency,
    transfer_method: "SWIFT", reference: t.reference, reason: t.reason, metadata: { approval_sha256: t.approvalSha256 }, ...(t.transferDate ? { transfer_date: t.transferDate } : {}),
  };
}

/** Airwallex's check of the exact terms, before anyone signs them. Throws Airwallex's refusal as it came. */
export async function validateTransfer(api: Pick<Airwallex, "call">, t: PlannedTransfer): Promise<{ ok: true }> {
  await api.call("POST", "/transfers/validate", transferBody(t));
  return { ok: true };
}

/** A signed transfer for a later day: Airwallex holds it SCHEDULED. */
export async function createScheduledTransfer(api: Pick<Airwallex, "call">, t: PlannedTransfer & { transferDate: string }, today = new Date()): Promise<TransferState> {
  if (t.transferDate <= today.toISOString().slice(0, 10)) throw new Error(`a scheduled transfer is for a later day than today; ${t.transferDate} is not`);
  return toState(await api.call<RawTransfer>("POST", "/transfers/create", transferBody(t)));
}

export async function readTransfer(api: Pick<Airwallex, "call">, id: string): Promise<TransferState> {
  return toState(await api.call<RawTransfer>("GET", `/transfers/${encodeURIComponent(id)}`));
}

/**
 * The CFO withdrew the signature: cancel the transfer at Airwallex, only while it is SCHEDULED (read first), and read
 * it back. Returns the state before and after; throws, without cancelling, when it is not SCHEDULED.
 *
 * An error answer to the cancel is not taken as "not cancelled": on 19 November the sandbox answered a cancel 400
 * service_unavailable and the transfer then read back CANCELLED (docs/runs/2026-11-19-airwallex-deep.md and -2.md). So
 * the transfer is read back after any refusal; only when it is still not CANCELLED does the refusal stand (thrown).
 */
export async function revokeScheduledTransfer(api: Pick<Airwallex, "call">, id: string): Promise<{ before: TransferState; after: TransferState; cancelAnswer: string }> {
  const before = await readTransfer(api, id);
  if (before.status !== "SCHEDULED") throw new Error(`transfer ${id} is ${before.status}, not SCHEDULED: Purser cancels only a payment that has not started; nothing was cancelled`);
  let cancelAnswer = "2xx";
  try {
    // The docs' cancel carries no body: none is sent.
    await api.call("POST", `/transfers/${encodeURIComponent(id)}/cancel`);
  } catch (e) {
    if (!(e instanceof AirwallexError)) throw e;
    cancelAnswer = `${e.status}${e.code ? ` ${e.code}` : ""}`;
    const after = await readTransfer(api, id);
    if (after.status !== "CANCELLED") throw e;
    return { before, after, cancelAnswer };
  }
  return { before, after: await readTransfer(api, id), cancelAnswer };
}
