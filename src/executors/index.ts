import { executeTaskCard } from "../agents/askPurser.js";
import { executeQuarantineRelease } from "../policy/quarantine.js";
import { LiveReceivePolicy } from "../metal/receivePolicy.js";
import { keyPath } from "../metal/agentCli.js";
import type { DB } from "../db/open.js";
import { withOrigin, type Origin } from "../provenance/origin.js";
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
import { consultHub } from "../hub/consult.js";
import { pushRuns, type DecisionsRead, type HubDeps } from "../hub/client.js";
import { hubPushEnabled } from "../hub/config.js";
import { t0SinkFor } from "../accounting/t0Sink.js";

/** D24: the origin of every money movement an approved proposal makes: its approval, and with four eyes the cosigner. */
export function approvalOrigin(db: DB, proposalId: string): Origin | null {
  const a = db.prepare("SELECT approval_id, approver, method FROM approvals WHERE proposal_id = ? AND decision = 'APPROVED'").get(proposalId) as { approval_id: number; approver: string; method: string } | undefined;
  if (!a) return null;
  const co = db.prepare("SELECT approver FROM cosignatures WHERE proposal_id = ? ORDER BY created_at, rowid LIMIT 1").get(proposalId) as { approver: string } | undefined;
  return { actor: "cfo", proposal_id: proposalId, approval_id: String(a.approval_id), method: a.method, approver: a.approver, ...(co && co.approver !== a.approver ? { cosigner: co.approver } : {}) };
}

/** The live hub calls: global fetch, this process's environment, lines to the runner's log. */
const liveHub: HubDeps = { fetch: (...a) => fetch(...a), log: (line) => console.log(line) };

/** Runs an approved proposal by its kind. Every executor re-checks the approved hash itself. Everything it moves
 *  records the approval as its origin (D24); without an approval the executor refuses on its own check.
 *  Phase D: with HUB_DECISIONS_ENABLED the hub is asked first (src/hub/consult.ts) and its answer recorded; the gate in
 *  beginExecution then decides, on top of the approval, never instead of it. `read`: the hub's decisions as the
 *  runner's hub loop just read them. With HUB_PUSH_ENABLED a run that executed is pushed again (never waited on). */
export async function execute(db: DB, proposalId: string, read?: DecisionsRead, hub: HubDeps = liveHub): Promise<void> {
  const asked = await consultHub(db, proposalId, hub, read);
  // The gate in beginExecution refuses these too; stopping here also spares the executor's own reads.
  if (asked === "reject") throw new Error(`${proposalId} was rejected on the hub; nothing runs`);
  if (asked === "none") throw new Error(`${proposalId} is approved with Face ID and waits for the hub's decision; nothing runs yet`);
  const origin = approvalOrigin(db, proposalId);
  await (origin ? withOrigin(origin, () => executeApproved(db, proposalId)) : executeApproved(db, proposalId));
  if (hubPushEnabled(hub.env ?? process.env)) void pushRuns(db, hub);
  // Phase E (T0_ENABLED): the books go to T:0 after the action, in the background; T:0 never holds up or fails a payment.
  void t0SinkFor(db).afterMoney();
}

async function executeApproved(db: DB, proposalId: string): Promise<void> {
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
      await syncCardsAfterPolicy(db, proposalId, issuingFromEnv(db)?.rail ?? null);
      if (failed) throw failed;
      return;
    }
    executePolicyChange(db, proposalId);
    // A card limit in the policy only counts once the card at Airwallex has it too.
    await syncCardsAfterPolicy(db, proposalId, issuingFromEnv(db)?.rail ?? null);
    return;
  }
  if (row.kind === "quarantine_release") {
    await executeQuarantineRelease(db, new LiveReceivePolicy(), keyPath("sweep.key.json"), proposalId);
    return;
  }
  if (row.kind === "task_card") {
    const issuing = issuingFromEnv(db);
    if (!issuing) throw new Error("Airwallex sandbox keys are not set; the task card cannot be issued");
    await executeTaskCard(db, issuing.rail, proposalId);
    return;
  }
  if (row.kind === "owners_execute") {
    // Block 1: both owners' passkeys signed the account's Execute digest; the sponsor relays it and pays gas.
    // Behind the owners guard and call budget (src/metal/ownersBudget.ts): without OWNERS_GO, a budget and a log,
    // liveRelay throws here, before the proposal is touched, so it stays approved and runs at the runner's next start.
    const { executeOwnersExecute } = await import("./ownersExecute.js");
    const { liveRelay } = await import("../metal/passkeyRelay.js");
    await executeOwnersExecute(db, proposalId, liveRelay(`execute ${proposalId}`));
    return;
  }
  if (row.kind === "airi_purchase") {
    // The Airi rail (src/airi/purchase.ts), only with KIT11_AIRI_RAIL=on. The executor re-checks the approved hash
    // before the mandate and again before the credential; its outcome (refused, declined) is in the audit log.
    const { airiRailOn } = await import("../airi/policy.js");
    if (!airiRailOn()) throw new Error("the Airi rail is off (KIT11_AIRI_RAIL); nothing was run");
    const { liveAiriDeps, fileLinkSink } = await import("../airi/deps.js");
    const log = (line: string) => console.log(line);
    const deps = liveAiriDeps(fileLinkSink(log), log);
    if (!deps) throw new Error("Airwallex sandbox keys are not set; the Airi purchase's checkout cannot run");
    const { executeAiriPurchase } = await import("../airi/purchase.js");
    const out = await executeAiriPurchase(db, deps, proposalId);
    if (out.status === "refused") throw new Error(`refused by ${out.by}: ${out.code}`);
    if (out.status === "unconfirmed") throw new Error(`the checkout's outcome is not known (${out.reason}); nothing is retried`);
    return;
  }
  if (row.kind === "agent_onboard") {
    const issuing = issuingFromEnv(db);
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
    case "payee_add": {
      // Payables: a new supplier, after a person's verification and the CFO's Face ID (src/ap/vendors.ts).
      if (!awx) throw new Error("Airwallex sandbox keys are not set; the new supplier cannot be added");
      const { executePayeeAdd } = await import("../ap/vendors.js");
      const { payablesSink } = await import("../ap/books.js");
      await executePayeeAdd(db, awx.rail, proposalId, { sink: payablesSink() });
      return;
    }
    case "invoice_payment":
      if (!awx) throw new Error("Airwallex sandbox keys are not set; the payment cannot run");
      await executeInvoicePayment(db, awx.rail, awx.sim, proposalId);
      return;
    case "supplier_payment": {
      // Payables: a supplier paid in the invoice's own currency on its route (src/payouts/plan.ts).
      if (!awx) throw new Error("Airwallex sandbox keys are not set; the payment cannot run");
      const { executeSupplierPayment } = await import("./supplierPayment.js");
      await executeSupplierPayment(db, awx.rail, awx.sim, proposalId);
      return;
    }
    case "payment_batch": {
      // AIRWALLEX_BATCH_TRANSFER=on: the signed batch goes to Airwallex as ONE batch transfer, read back item by item
      // before it is submitted (src/executors/airwallexBatch.ts). Off (the default): line by line, as below.
      const { batchTransferOn, AirwallexBatchRest } = await import("../airwallex/batchTransfers.js");
      if (batchTransferOn() && awx) {
        const { fromEnv, Airwallex } = await import("../airwallex/client.js");
        const cfg = fromEnv();
        if (!cfg) throw new Error("Airwallex sandbox keys are not set; the batch cannot run");
        const { executeAsOneAirwallexBatch } = await import("./airwallexBatch.js");
        const r = await executeAsOneAirwallexBatch(db, { batches: new AirwallexBatchRest(new Airwallex(cfg)), rail: awx.rail }, proposalId);
        if (r.outcome !== "SUBMITTED") throw new Error(`the Airwallex batch was refused at the read-back and deleted: ${r.differences.join("; ").slice(0, 280)}`);
        return;
      }
      // One Face ID for many payments: each line runs as its own payment, with its own checks and idempotency.
      const { executePaymentBatch } = await import("./paymentBatch.js");
      const r = await executePaymentBatch(db, proposalId, (id) => executeApproved(db, id));
      const unpaid = r.lines.filter((l) => l.outcome !== "paid");
      if (unpaid.length) throw new Error(`${unpaid.length} of ${r.lines.length} lines not paid: ${unpaid.map((l) => `${l.proposal_id} ${l.detail ?? l.status}`).join("; ").slice(0, 280)}`);
      return;
    }
    default:
      throw new Error(`no executor for ${row.kind} yet`);
  }
}
