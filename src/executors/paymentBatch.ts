// Runs an approved payment batch (src/policy/batch.ts): each line is its own approved payment proposal, run by its own
// executor, which checks again everything a single payment checks (its approval and hash, fraud, duplicates, floors,
// limits) and pays at most once by its own request id. A line that fails leaves the others as they are; the batch is
// then FAILED, and running it again runs only the lines not paid yet. The result per line is recorded.

import { audit } from "../audit/log.js";
import type { DB } from "../db/open.js";
import { beginExecution, finishExecution } from "../policy/approvals.js";
import { batchLinesOf, BATCH_KIND, type BatchTerms } from "../policy/batchLines.js";
import { awxBatchOf } from "../policy/awxBatchLink.js";

export type LineOutcome = "paid" | "failed" | "not paid";
export interface BatchResult { batch_id: string; lines: { proposal_id: string; outcome: LineOutcome; status: string; detail: string | null }[] }

const status = (db: DB, id: string) => (db.prepare("SELECT status FROM proposals WHERE proposal_id = ?").get(id) as { status: string } | undefined)?.status ?? "missing";

/** Statuses after which a line is never run again from the batch. */
const DONE_OR_CLOSED = new Set(["EXECUTED", "REJECTED", "EXPIRED", "SUPERSEDED", "NEEDS_REAPPROVAL", "missing"]);

export async function executePaymentBatch(db: DB, batchId: string, runLine: (proposalId: string) => Promise<void>, now = new Date()): Promise<BatchResult> {
  const kind = (db.prepare("SELECT kind FROM proposals WHERE proposal_id = ?").get(batchId) as { kind: string } | undefined)?.kind;
  if (kind !== BATCH_KIND) throw new Error(`${batchId} is not a payment batch`);
  // Sent to Airwallex as one batch transfer (AIRWALLEX_BATCH_TRANSFER): never also run line by line.
  const awx = awxBatchOf(db, batchId);
  if (awx && awx.status !== "REFUSED") throw new Error(`${batchId} is at Airwallex as one batch transfer (${awx.status}); it is never also run line by line`);
  // The batch's own guard: its terms still hash to the approved hash, the approval is there and has not run out.
  const terms = beginExecution<BatchTerms>(db, batchId, (t) => {
    const filed = batchLinesOf(db, batchId).map((l) => `${l.proposal_id}:${l.terms_sha256}`);
    if (filed.join(",") !== t.lines.map((l) => `${l.proposal_id}:${l.terms_sha256}`).join(",")) throw new Error(`${batchId}: its lines no longer match the signed batch`);
  }, now);
  const lines: BatchResult["lines"] = [];
  for (const l of terms.lines) {
    const before = status(db, l.proposal_id);
    if (DONE_OR_CLOSED.has(before)) {
      lines.push({ proposal_id: l.proposal_id, outcome: before === "EXECUTED" ? "paid" : "not paid", status: before, detail: before === "EXECUTED" ? null : `the line is ${before}` });
      continue;
    }
    let detail: string | null = null;
    try {
      await runLine(l.proposal_id);
    } catch (e) {
      detail = (e as Error).message.slice(0, 300);
    }
    const after = status(db, l.proposal_id);
    lines.push({ proposal_id: l.proposal_id, outcome: after === "EXECUTED" ? "paid" : "failed", status: after, detail });
  }
  const allPaid = lines.every((l) => l.outcome === "paid");
  const result: BatchResult = { batch_id: batchId, lines };
  finishExecution(db, batchId, allPaid ? "EXECUTED" : "FAILED", { lines: lines.map((l) => ({ proposal_id: l.proposal_id, outcome: l.outcome, status: l.status, detail: l.detail })) }, now);
  if (!allPaid) audit(db, "system", "batch.partly_paid", batchId, { paid: lines.filter((l) => l.outcome === "paid").length, of: lines.length }, now);
  return result;
}
