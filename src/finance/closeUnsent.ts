// The CFO's command for a payout row left SUBMITTING with no transfer behind it: `npm run reconcile -- --close-unsent
// <request_id>`. Such a row counts as money under way and blocks its invoice for ever. It comes from a first send that
// Airwallex refused before 78a761b (agent run 1, P-0005, request_id bc1aca54…), or from a crash after the row was
// written and before the first create, whose re-run (a resend, which never closes the row) was refused too.
//
// It closes the row (CANCELLED, failure_type closed_unsent) only when all of these hold, and refuses otherwise:
// - the row is SUBMITTING with no transfer id;
// - its proposal can no longer run: not APPROVED or EXECUTING (a live execution, a retry waiting), not EXECUTED, and
//   past its expiry (a FAILED proposal before its expiry may still be run again, which resends under the request_id);
// - nothing happened to the row or its proposal for N minutes (CLOSE_UNSENT_MIN_AGE_MINUTES): Airwallex's list may lag
//   behind a create;
// - a read-only look-up by request_id at Airwallex finds no transfer (an error is a refusal, never "nothing"); and
// - nothing changed in the ledger for the row or its proposal while Airwallex was being asked.
// The close is audited (transfer.closed_unsent, a money event) with an origin naming the command. The reconciliation
// looks such rows up for 7 days after the close, so a transfer that shows up then is still a difference.

import { audit } from "../audit/log.js";
import type { DB } from "../db/open.js";
import type { Origin } from "../provenance/origin.js";
import { onlyRequestId } from "../airwallex/adapter.js";

export const CLOSE_UNSENT_MIN_AGE_MINUTES = 30;

/**
 * D24: who decided the close: the CFO's own command, the fifth door (src/provenance/origin.ts). It moves no money; code
 * checks every condition above; a new proposal for the invoice still needs Face ID.
 */
export const CLOSE_UNSENT_ORIGIN: Origin = { actor: "cfo-command", command: "npm run reconcile -- --close-unsent", moves_money: false };

export type CloseUnsentResult =
  | { closed: true; requestId: string; invoiceNo: string; proposalId: string; lookedUpAt: string }
  | { closed: false; reason: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Row = { request_id: string; transfer_id: string | null; invoice_no: string; amount: string; currency: string; status: string; updated_at: string };
type Proposal = { proposal_id: string; status: string; expires_at: string };

/** What the close must find unchanged after the look-up: the row, the proposal's status and their latest audit row. */
function fingerprint(db: DB, requestId: string, proposalId: string): string {
  const r = db.prepare("SELECT transfer_id, status, updated_at FROM transfers WHERE request_id = ?").get(requestId);
  const p = db.prepare("SELECT status FROM proposals WHERE proposal_id = ?").get(proposalId);
  const last = db.prepare("SELECT MAX(seq) AS seq FROM audit_log WHERE subject IN (?, ?)").get(requestId, proposalId);
  return JSON.stringify([r, p, last]);
}

export async function closeUnsent(
  db: DB, requestId: string, lookup: (requestId: string) => Promise<{ id: string } | undefined>,
  opts: { now?: () => Date; minAgeMinutes?: number } = {},
): Promise<CloseUnsentResult> {
  const now = opts.now ?? (() => new Date());
  const minAge = opts.minAgeMinutes ?? CLOSE_UNSENT_MIN_AGE_MINUTES;
  const no = (reason: string): CloseUnsentResult => ({ closed: false, reason: `${reason}; nothing was changed` });
  if (!UUID.test(requestId)) return no(`${JSON.stringify(requestId)} is not a request_id`);

  const row = db.prepare("SELECT request_id, transfer_id, invoice_no, amount, currency, status, updated_at FROM transfers WHERE request_id = ?").get(requestId) as Row | undefined;
  if (!row) return no(`no payout row has request_id ${requestId}`);
  if (row.transfer_id) return no(`the payout row has a transfer (${row.transfer_id}, ${row.status})`);
  if (row.status !== "SUBMITTING") return no(`the payout row is ${row.status}, not SUBMITTING`);

  const props = db.prepare("SELECT proposal_id, status, expires_at FROM proposals WHERE kind = 'invoice_payment' AND json_extract(terms_json, '$.transfer_request_id') = ?").all(requestId) as Proposal[];
  if (props.length !== 1) return no(`${props.length} proposals carry request_id ${requestId}; a person checks it`);
  const p = props[0]!;
  if (p.status === "APPROVED" || p.status === "EXECUTING") return no(`${p.proposal_id} is ${p.status}: an execution is live or may start (a retry may be waiting)`);
  if (p.status === "EXECUTED") return no(`${p.proposal_id} is EXECUTED while its payout row is SUBMITTING; a person checks it`);
  if (Date.parse(p.expires_at) > now().getTime()) return no(`${p.proposal_id} is ${p.status} and may still be run again until ${p.expires_at} (that would resend under this request_id); try after it`);

  const lastAudit = (db.prepare("SELECT MAX(ts) AS ts FROM audit_log WHERE subject IN (?, ?)").get(requestId, p.proposal_id) as { ts: string | null }).ts;
  const lastMs = Math.max(Date.parse(row.updated_at), lastAudit ? Date.parse(lastAudit) : 0);
  const quietMs = now().getTime() - lastMs;
  if (!(quietMs >= minAge * 60_000)) return no(`the payout or ${p.proposal_id} changed ${Math.max(0, Math.floor(quietMs / 60_000))} minutes ago, at ${new Date(lastMs).toISOString()}; it may be closed only after ${minAge} quiet minutes`);

  const before = fingerprint(db, requestId, p.proposal_id);
  const lookedUpAt = now().toISOString();
  let found: { id: string } | undefined;
  try {
    found = await lookup(requestId);
  } catch (e) {
    return no(`the look-up at Airwallex by request_id failed (${(e as Error).message}), so it cannot be shown that nothing is there`);
  }
  if (found) return no(`Airwallex holds transfer ${found.id} under ${requestId}; it is not closed (the reconciliation shows it; a person adopts or checks it)`);

  return db.transaction((): CloseUnsentResult => {
    if (fingerprint(db, requestId, p.proposal_id) !== before) return no(`the payout or ${p.proposal_id} changed while Airwallex was being asked; run the command again later`);
    const closed = db.prepare("UPDATE transfers SET status = 'CANCELLED', failure_type = 'closed_unsent', failure_reason = ?, updated_at = ? WHERE request_id = ? AND status = 'SUBMITTING' AND transfer_id IS NULL")
      .run(`closed by the CFO's command: no transfer at Airwallex under this request_id (looked up ${lookedUpAt})`, now().toISOString(), requestId);
    if (closed.changes !== 1) return no("the payout row changed meanwhile");
    audit(db, "human", "transfer.closed_unsent", requestId, {
      request_id: requestId, invoice_no: row.invoice_no, amount: `${row.currency} ${row.amount}`, proposal_id: p.proposal_id, proposal_status: p.status,
      looked_up_at: lookedUpAt, quiet_since: new Date(lastMs).toISOString(), min_quiet_minutes: minAge, origin: CLOSE_UNSENT_ORIGIN as never,
    }, now());
    return { closed: true, requestId, invoiceNo: row.invoice_no, proposalId: p.proposal_id, lookedUpAt };
  }).immediate();
}

/**
 * The read-only look-up the command uses: GET /transfers?request_id=…, with the same query the adapter uses (contract
 * tests). It answers "nothing" only for an empty list; a list holding another request_id, or saying it has more pages,
 * means the filter was not applied, and is an error, never "nothing".
 */
export function strictTransferLookup(get: (path: string, query?: Record<string, string>) => Promise<unknown>) {
  return async (requestId: string): Promise<{ id: string; status: string } | undefined> => {
    const r = (await get("/transfers", { request_id: requestId })) as { items?: { id?: unknown; request_id?: unknown; status?: unknown }[]; has_more?: unknown };
    const hit = onlyRequestId(r, requestId);
    return hit ? { id: String(hit.id), status: String(hit.status) } : undefined;
  };
}
