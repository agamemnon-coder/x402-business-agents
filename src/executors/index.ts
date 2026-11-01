import { executeTaskCard } from "../agents/askPurser.js";
import { executeQuarantineRelease } from "../policy/quarantine.js";
import { LiveReceivePolicy } from "../metal/receivePolicy.js";
import { keyPath } from "../metal/agentCli.js";
import type { DB } from "../db/open.js";
import { executeMandateReplace } from "./mandateReplace.js";
import { executeRefundBatch } from "./refundBatch.js";
import { executeInvoicePayment } from "./invoicePayment.js";
import { airwallexFromEnv } from "../airwallex/adapter.js";
import { executeDevTest } from "./devTest.js";
import { executePolicyChange, touchesPause, type PolicyChangeTerms } from "./policyChange.js";
import { executePauseChange, pausedCredential } from "../policy/pause.js";
import { LivePauseChain } from "../metal/pauseChain.js";
import { issuingFromEnv } from "../airwallex/issuing.js";
import { syncCardsAfterPolicy } from "../policy/cards.js";
import { executePayeeChange } from "../policy/payeeChange.js";
import { executeAgentOnboard } from "../platform/externalAgents.js";

/** Runs an approved proposal by its kind. Every executor re-checks the approved hash itself. */
export async function execute(db: DB, proposalId: string): Promise<void> {
  const row = db.prepare("SELECT kind FROM proposals WHERE proposal_id = ?").get(proposalId) as { kind: string } | undefined;
  if (!row) throw new Error(`no proposal ${proposalId}`);
  if (row.kind === "dev_test") return executeDevTest(db, proposalId);
  if (row.kind === "policy_change") {
    const terms = JSON.parse((db.prepare("SELECT terms_json FROM proposals WHERE proposal_id = ?").get(proposalId) as { terms_json: string }).terms_json) as PolicyChangeTerms;
    if (touchesPause(terms)) {
      // 4.2 Pause or resume one agent: the chain step runs here too (src/policy/pause.ts). The card is synced even
      // when the revoke failed: the agent is paused in Purser, so its card must be frozen whatever the chain said.
      let failed: unknown = null;
      try {
        await executePauseChange(db, proposalId, new LivePauseChain(() => `resume-${proposalId}`, (agent) => pausedCredential(db, agent)));
      } catch (e) {
        failed = e;
      }
      await syncCardsAfterPolicy(db, proposalId, issuingFromEnv()?.rail ?? null);
      if (failed) throw failed;
      return;
    }
    executePolicyChange(db, proposalId);
    // A card limit in the policy only counts once the card at Airwallex has it too.
    await syncCardsAfterPolicy(db, proposalId, issuingFromEnv()?.rail ?? null);
    return;
  }
  if (row.kind === "quarantine_release") {
    await executeQuarantineRelease(db, new LiveReceivePolicy(), keyPath("sweep.key.json"), proposalId);
    return;
  }
  if (row.kind === "task_card") {
    const issuing = issuingFromEnv();
    if (!issuing) throw new Error("Airwallex sandbox keys are not set; the task card cannot be issued");
    await executeTaskCard(db, issuing.rail, proposalId);
    return;
  }
  if (row.kind === "owners_execute") {
    // Block 1: both owners' passkeys signed the account's Execute digest; the sponsor relays it and pays gas.
    const { executeOwnersExecute } = await import("./ownersExecute.js");
    const { liveRelay } = await import("../metal/passkeyRelay.js");
    await executeOwnersExecute(db, proposalId, liveRelay());
    return;
  }
  if (row.kind === "agent_onboard") {
    const issuing = issuingFromEnv();
    if (!issuing) throw new Error("Airwallex sandbox keys are not set; the card cannot be issued");
    await executeAgentOnboard(db, issuing.rail, proposalId);
    return;
  }
  const awx = await airwallexFromEnv();
  switch (row.kind) {
    case "mandate_replace":
      return executeMandateReplace(db, proposalId);
    case "refund_batch":
      return executeRefundBatch(db, proposalId);
    case "payee_change":
      if (!awx) throw new Error("Airwallex sandbox keys are not set; the new account cannot be added");
      await executePayeeChange(db, awx.rail, proposalId);
      return;
    case "invoice_payment":
      if (!awx) throw new Error("Airwallex sandbox keys are not set; the payment cannot run");
      await executeInvoicePayment(db, awx.rail, awx.sim, proposalId);
      return;
    default:
      throw new Error(`no executor for ${row.kind} yet`);
  }
}
