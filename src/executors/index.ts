import type { DB } from "../db/open.js";
import { executeMandateReplace } from "./mandateReplace.js";
import { executeRefundBatch } from "./refundBatch.js";

/** Runs an approved proposal by its kind. Every executor re-checks the approved hash itself. */
export async function execute(db: DB, proposalId: string): Promise<void> {
  const row = db.prepare("SELECT kind FROM proposals WHERE proposal_id = ?").get(proposalId) as { kind: string } | undefined;
  if (!row) throw new Error(`no proposal ${proposalId}`);
  switch (row.kind) {
    case "mandate_replace":
      return executeMandateReplace(db, proposalId);
    case "refund_batch":
      return executeRefundBatch(db, proposalId);
    default:
      throw new Error(`no executor for ${row.kind} yet`);
  }
}
