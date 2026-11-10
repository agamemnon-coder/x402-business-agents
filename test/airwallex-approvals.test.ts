// Airwallex's own transfer approval workflow as a second lock (docs/airwallex-approvals.md). With it switched on in the
// Airwallex web app, a transfer Purser creates after the CFO's Face ID waits as IN_APPROVAL until a person at Airwallex
// approves it. Breaks if Purser simulates past that wait, calls a waiting payout failed, sends it a second time, follows
// it wrongly, or books a transfer whose amount was changed at Airwallex after the CFO signed.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { proposeInvoicePayment, seedTreasury } from "../src/agents/euroBill.js";
import { parseInvoiceFallback } from "../src/agents/invoice.js";
import { describeTransferStatus, followTransfer, inAirwallexApproval } from "../src/airwallex/approvals.js";
import { openDb, type DB } from "../src/db/open.js";
import { approvalOrigin } from "../src/executors/index.js";
import { executeInvoicePayment } from "../src/executors/invoicePayment.js";
import { checkEvent } from "../src/policy/airwallexEvents.js";
import { decide } from "../src/policy/approvals.js";
import { LICENCE_COMMAND, withOrigin } from "../src/provenance/origin.js";
import { FakeAirwallex } from "../src/redteam/airwallex.js";

const text = readFileSync(new URL("../fixtures/stockline-licence-SLL-2026-11.txt", import.meta.url), "utf8");
const FAST = { delaysMs: [15_000, 30_000, 60_000, 90_000, 120_000], sleep: async () => {} };

async function paidWithWorkflow(workflow: boolean): Promise<{ db: DB; awx: FakeAirwallex; proposalId: string; transferId: string; status: string }> {
  const db = openDb(":memory:");
  const awx = new FakeAirwallex();
  awx.approvalWorkflow = workflow;
  await seedTreasury(db, awx, awx);
  const out = await withOrigin(LICENCE_COMMAND, () => proposeInvoicePayment(db, awx, parseInvoiceFallback(text), text));
  if (out.kind !== "proposed") throw new Error(out.reason);
  const proposalId = out.proposal.proposal_id;
  const sha = (db.prepare("SELECT terms_sha256 FROM proposals WHERE proposal_id = ?").get(proposalId) as { terms_sha256: string }).terms_sha256;
  decide(db, { proposalId, decision: "APPROVED", typedPrefix: sha.slice(0, 8), approver: "max", method: "cli" });
  const r = await withOrigin(approvalOrigin(db, proposalId)!, () => executeInvoicePayment(db, awx, awx, proposalId, undefined, FAST));
  return { db, awx, proposalId, transferId: r.transfer.id, status: r.transfer.status };
}
const row = (db: DB, id: string) => db.prepare("SELECT status FROM transfers WHERE transfer_id = ?").get(id) as { status: string };
const proposal = (db: DB, id: string) => (db.prepare("SELECT status FROM proposals WHERE proposal_id = ?").get(id) as { status: string }).status;
const events = (db: DB, event: string) => db.prepare("SELECT subject, payload_json FROM audit_log WHERE event = ?").all(event) as { subject: string; payload_json: string }[];

describe("Airwallex's approval workflow as a second lock", () => {
  it("leaves a payout waiting as IN_APPROVAL after the CFO's Face ID: no simulation past it, not called failed", async () => {
    const { db, awx, proposalId, transferId, status } = await paidWithWorkflow(true);
    expect(status).toBe("IN_APPROVAL");
    expect(awx.calls.filter((c) => c.startsWith("transition:"))).toEqual([]);
    expect(row(db, transferId).status).toBe("IN_APPROVAL");
    expect(proposal(db, proposalId)).toBe("EXECUTED");
    expect(events(db, "transfer.awaiting_airwallex_approval").map((e) => e.subject)).toEqual([transferId]);
    expect(describeTransferStatus("IN_APPROVAL")).toBe("waiting for Airwallex approval");
  });

  it("still settles in the sandbox as before when the workflow is off", async () => {
    const { status } = await paidWithWorkflow(false);
    expect(status).toBe("PAID");
  });

  it("follows the payout once a person approves it at Airwallex, then to PAID, reading only", async () => {
    const { db, awx, transferId } = await paidWithWorkflow(true);
    const creates = awx.calls.filter((c) => c === "createTransfer").length;
    expect(await followTransfer(db, awx, transferId)).toMatchObject({ status: "IN_APPROVAL", changed: false, waitingOnAirwallex: true, terminal: false, mismatch: null });
    awx.decideInWebApp(transferId, "approve");
    expect(await followTransfer(db, awx, transferId)).toMatchObject({ status: "SCHEDULED", changed: true, waitingOnAirwallex: false });
    await awx.transitionTransfer(transferId, "PAID");
    expect(await followTransfer(db, awx, transferId)).toMatchObject({ status: "PAID", terminal: true });
    expect(row(db, transferId).status).toBe("PAID");
    expect(awx.calls.filter((c) => c === "createTransfer").length).toBe(creates);
  });

  it("records a rejection at Airwallex as not paid and never sends the payout again", async () => {
    const { db, awx, proposalId, transferId } = await paidWithWorkflow(true);
    awx.decideInWebApp(transferId, "reject");
    expect(await followTransfer(db, awx, transferId)).toMatchObject({ status: "APPROVAL_REJECTED", changed: true });
    expect(describeTransferStatus("APPROVAL_REJECTED")).toMatch(/not paid/);
    await expect(withOrigin(approvalOrigin(db, proposalId)!, () => executeInvoicePayment(db, awx, awx, proposalId, undefined, FAST))).rejects.toThrow();
    expect(awx.calls.filter((c) => c === "createTransfer").length).toBe(1);
    // The rejected payout still holds the invoice: no second payout can be written for it.
    expect(() => db.prepare("INSERT INTO transfers (request_id, invoice_no, amount, currency, method, fee_estimate, status, approval_sha256, updated_at) VALUES ('rq-2', 'SLL-2026-11', '240.00', 'EUR', 'SWIFT', '20.00', 'SUBMITTING', 'h', 'now')").run()).toThrow();
  });

  it("raises an alarm when the amount at Airwallex no longer matches what the CFO signed", async () => {
    const { db, awx, transferId } = await paidWithWorkflow(true);
    awx.transfers.find((t) => t.id === transferId)!.amountCents += 100_00;
    expect((await followTransfer(db, awx, transferId)).mismatch).toMatch(/EUR 340\.00 .* signed EUR 240\.00/);
    expect(events(db, "transfer.terms_changed_at_airwallex")).toHaveLength(1);
  });

  it("checks approval webhooks against the ledger: waiting agrees, rejected after a paid ledger does not", async () => {
    const { db, transferId } = await paidWithWorkflow(true);
    expect(checkEvent(db, "payout.transfer.in_approval", { id: transferId, status: "IN_APPROVAL" }).agrees).toBe(true);
    db.prepare("UPDATE transfers SET status = 'PAID' WHERE transfer_id = ?").run(transferId);
    const c = checkEvent(db, "payout.transfer.approval_rejected", { id: transferId, status: "APPROVAL_REJECTED" });
    expect(c.agrees).toBe(false);
    expect(inAirwallexApproval("APPROVAL_BLOCKED")).toBe(true);
  });
});
