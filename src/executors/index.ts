import type { DB } from "../db/open.js";
import { executeMandateReplace } from "./mandateReplace.js";
import { executeRefundBatch } from "./refundBatch.js";
import { executeInvoicePayment } from "./invoicePayment.js";
import { airwallexFromEnv } from "../airwallex/adapter.js";
import { executeDevTest } from "./devTest.js";
import { executePolicyChange } from "./policyChange.js";

/** Runs an approved proposal by its kind. Every executor re-checks the approved hash itself. */
export async function execute(db: DB, proposalId: string): Promise<void> {
  const row = db.prepare("SELECT kind FROM proposals WHERE proposal_id = ?").get(proposalId) as { kind: string } | undefined;
  if (!row) throw new Error(`no proposal ${proposalId}`);
  if (row.kind === "dev_test") return executeDevTest(db, proposalId);
  if (row.kind === "policy_change") return executePolicyChange(db, proposalId);
  const awx = await airwallexFromEnv();
  switch (row.kind) {
    case "mandate_replace":
      return executeMandateReplace(db, proposalId);
    case "refund_batch":
      return executeRefundBatch(db, proposalId);
    case "invoice_payment":
      if (!awx) throw new Error("Airwallex sandbox keys are not set; the payment cannot run");
      await executeInvoicePayment(db, awx.rail, awx.sim, proposalId);
      return;
    default:
      throw new Error(`no executor for ${row.kind} yet`);
  }
}
