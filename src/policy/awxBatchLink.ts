// Which Airwallex batch transfer a payment line belongs to (src/executors/airwallexBatch.ts). A line whose batch is at
// Airwallex (any status but REFUSED: deleted there while DRAFTING, nothing submitted) is paid by that batch and only by
// it: neither its own executor, nor the line-by-line batch path, nor a restart's resume may send it as a transfer of
// its own (review, 12 November: a lost submit answer then a line-by-line re-run paid both lines twice).

import type { DB } from "../db/open.js";

export function awxBatchOfLine(db: DB, proposalId: string): { batch_id: string; status: string } | null {
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'awx_batches'").get()) return null;
  return (db.prepare(`SELECT a.batch_id, a.status FROM batch_lines b JOIN awx_batches a ON a.batch_id = b.batch_id
    WHERE b.proposal_id = ? AND a.status <> 'REFUSED' ORDER BY a.updated_at DESC LIMIT 1`).get(proposalId) as { batch_id: string; status: string } | undefined) ?? null;
}

export function awxBatchOf(db: DB, batchId: string): { status: string } | null {
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'awx_batches'").get()) return null;
  return (db.prepare("SELECT status FROM awx_batches WHERE batch_id = ?").get(batchId) as { status: string } | undefined) ?? null;
}

/** Throws when this line is paid by an Airwallex batch transfer, so it is never sent on its own. */
export function refuseIfInAwxBatch(db: DB, proposalId: string): void {
  const b = awxBatchOfLine(db, proposalId);
  if (b) throw new Error(`${proposalId} is a line of ${b.batch_id}, sent to Airwallex as one batch transfer (${b.status}); it is never sent on its own, the batch is followed or resumed instead`);
}
