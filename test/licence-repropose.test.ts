// After Airwallex refused the licence payout (agent run 1, P-0005, 400 fee_unknown), the payout row is closed
// (CANCELLED), and the Treasury agent may propose the licence again: a new proposal with new terms (a new request_id)
// that needs a new Face ID. Before it is planned again, Airwallex is asked by the closed payout's request_id: a
// transfer there stops the plan and raises an alarm (re-review item 4; before, only the runbook gated this).
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { invoiceAlreadyHandled, proposeInvoicePayment, seedTreasury } from "../src/agents/euroBill.js";
import { parseInvoiceFallback } from "../src/agents/invoice.js";
import { AirwallexError } from "../src/airwallex/client.js";
import type { NewTransfer, Transfer } from "../src/airwallex/port.js";
import { openDb, type DB } from "../src/db/open.js";
import { executeInvoicePayment } from "../src/executors/invoicePayment.js";
import { decide } from "../src/policy/approvals.js";
import { FakeAirwallex } from "../src/redteam/airwallex.js";
import { treasuryProfile } from "../src/autonomy/teamProfiles.js";

const text = readFileSync(new URL("../fixtures/stockline-licence-SLL-2026-11.txt", import.meta.url), "utf8");
const FAST = { delaysMs: [15_000, 30_000, 60_000, 90_000, 120_000], sleep: async () => {} };

class FeeUnknownAirwallex extends FakeAirwallex {
  refuse = 0;
  lookupFails = false;
  override async createTransfer(t: NewTransfer): Promise<Transfer> {
    if (this.refuse > 0) { this.refuse--; throw new AirwallexError(400, "fee_unknown", { code: "fee_unknown", message: "fee configuration" }, "/transfers/create"); }
    return super.createTransfer(t);
  }
  /** Airwallex's list ignoring the request_id filter: page one is other transfers, so a lenient look-up sees nothing. */
  listIgnoresFilter = false;
  override async findTransferByRequestId(requestId: string) {
    this.calls.push(`findTransferByRequestId:${requestId}`);
    if (this.lookupFails) throw new Error("socket hang up");
    if (this.listIgnoresFilter) return undefined;
    return super.findTransferByRequestId(requestId);
  }
  override async findTransferByRequestIdStrict(requestId: string) {
    this.calls.push(`findTransferByRequestIdStrict:${requestId}`);
    if (this.listIgnoresFilter) throw new Error("Airwallex's transfer list was not filtered by the request_id");
    return super.findTransferByRequestIdStrict(requestId);
  }
}

/** The licence proposed, approved with Face ID, and refused by Airwallex on every attempt: closed, nothing paid. */
async function refusedLicence() {
  const db = openDb(":memory:");
  const awx = new FeeUnknownAirwallex();
  await seedTreasury(db, awx, awx);
  const first = await proposeInvoicePayment(db, awx, parseInvoiceFallback(text), text);
  if (first.kind !== "proposed") throw new Error(first.reason);
  decide(db, { proposalId: first.proposal.proposal_id, decision: "APPROVED", typedPrefix: first.proposal.terms_sha256.slice(0, 8), approver: "max", method: "cli" });
  awx.refuse = 6;
  await expect(executeInvoicePayment(db, awx, awx, first.proposal.proposal_id, undefined, FAST)).rejects.toMatchObject({ code: "fee_unknown" });
  expect(db.prepare("SELECT status FROM transfers").get()).toEqual({ status: "CANCELLED" });
  expect(awx.transfers).toHaveLength(0);
  return { db, awx, first };
}
const statusOf = (db: DB, id: string) => (db.prepare("SELECT status FROM proposals WHERE proposal_id = ?").get(id) as { status: string }).status;

describe("the licence after Airwallex refused its payout", () => {
  it("may be proposed again: a new proposal, new terms and request_id, a new Face ID; then paid exactly once", async () => {
    const { db, awx, first } = await refusedLicence();
    expect(invoiceAlreadyHandled(db, "SLL-2026-11")).toBeNull();
    const again = await proposeInvoicePayment(db, awx, parseInvoiceFallback(text), text);
    if (again.kind !== "proposed") throw new Error(again.reason);
    expect(again.proposal.proposal_id).not.toBe(first.proposal.proposal_id);
    expect(again.terms.transfer_request_id).not.toBe(first.terms.transfer_request_id);
    expect(again.proposal.terms_sha256).not.toBe(first.proposal.terms_sha256);
    expect(again.proposal.status).toBe("PENDING_APPROVAL");
    // Airwallex was asked by the closed payout's request_id before the new plan.
    expect(awx.calls).toContain(`findTransferByRequestIdStrict:${first.terms.transfer_request_id}`);
    // Nothing runs without the new Face ID; the old approval does not carry over.
    await expect(executeInvoicePayment(db, awx, awx, again.proposal.proposal_id, undefined, FAST)).rejects.toThrow(/not approved/);
    expect(awx.transfers).toHaveLength(0);
    decide(db, { proposalId: again.proposal.proposal_id, decision: "APPROVED", typedPrefix: again.proposal.terms_sha256.slice(0, 8), approver: "max", method: "cli" });
    const r = await executeInvoicePayment(db, awx, awx, again.proposal.proposal_id, undefined, FAST);
    expect(r.transfer.status).toBe("PAID");
    expect(awx.transfers).toHaveLength(1);
    expect(awx.transfers[0]!.requestId).toBe(again.terms.transfer_request_id);
    // The refused proposal can never send again under its own request_id.
    await expect(executeInvoicePayment(db, awx, awx, first.proposal.proposal_id, undefined, FAST)).rejects.toThrow(/already paid|closed|expired|not approved/);
    expect(awx.transfers).toHaveLength(1);
    expect(statusOf(db, again.proposal.proposal_id)).toBe("EXECUTED");
    expect(invoiceAlreadyHandled(db, "SLL-2026-11")).toMatch(/already paid/);
  });

  it("is not planned again when Airwallex holds a transfer under the closed payout's request_id: an alarm, no proposal", async () => {
    const { db, awx, first } = await refusedLicence();
    const id = randomUUID();
    awx.transfers.push({ id, requestId: first.terms.transfer_request_id, status: "PAID", amountCents: 24_000, currency: "EUR", metadata: "x", beneficiaryId: first.terms.beneficiary_id });
    const out = await proposeInvoicePayment(db, awx, parseInvoiceFallback(text), text);
    expect(out).toMatchObject({ kind: "escalated", reason: expect.stringContaining(id) });
    expect(db.prepare("SELECT COUNT(*) AS n FROM proposals").get()).toEqual({ n: 1 });
    const alarm = db.prepare("SELECT subject, payload_json FROM audit_log WHERE event = 'transfer.found_after_close'").get() as { subject: string; payload_json: string } | undefined;
    expect(alarm?.subject).toBe(id);
    expect(JSON.parse(alarm!.payload_json)).toMatchObject({ request_id: first.terms.transfer_request_id, invoice_no: "SLL-2026-11", status: "PAID" });
  });

  it("is not planned again when Airwallex's list ignores the request_id filter: the strict look-up refuses to call that 'nothing' (else the invoice is paid twice)", async () => {
    const { db, awx, first } = await refusedLicence();
    // The closed payout hides a transfer after all, and the list's first page does not show it.
    awx.transfers.push({ id: randomUUID(), requestId: first.terms.transfer_request_id, status: "PAID", amountCents: 24_000, currency: "EUR", metadata: "x", beneficiaryId: first.terms.beneficiary_id });
    awx.listIgnoresFilter = true;
    const out = await proposeInvoicePayment(db, awx, parseInvoiceFallback(text), text);
    expect(out).toMatchObject({ kind: "escalated", reason: expect.stringMatching(/could not be asked.*not filtered/) });
    expect(db.prepare("SELECT COUNT(*) AS n FROM proposals").get()).toEqual({ n: 1 });
  });

  it("is not planned again while Airwallex cannot be asked: no proposal until the look-up answers", async () => {
    const { db, awx } = await refusedLicence();
    awx.lookupFails = true;
    const out = await proposeInvoicePayment(db, awx, parseInvoiceFallback(text), text);
    expect(out).toMatchObject({ kind: "escalated", reason: expect.stringMatching(/could not be asked.*socket hang up/) });
    expect(db.prepare("SELECT COUNT(*) AS n FROM proposals").get()).toEqual({ n: 1 });
  });

  it("the Treasury agent's plan_invoice is open again (nothing waits), and its position states the refused payout as a fact", async () => {
    const { db } = await refusedLicence();
    const flows: string[] = [];
    const profile = treasuryProfile(30 * 60_000, { runFlow: (script: string) => { flows.push(script); return { ok: true, text: "planned P-0002" }; } });
    const plan = profile.tools(db).find((t) => t.name === "plan_invoice")!;
    expect(await plan.run({} as never)).toMatchObject({ text: "planned P-0002" });
    expect(flows).toEqual(["licence.ts"]);
    const sim = { mandates: async () => [], client: null, sweep: async () => ({ ok: true, text: "" }), planInvoice: async () => ({ ok: true, text: "" }), proposePriceRise: async () => [] };
    const seen = await treasuryProfile(30 * 60_000, { runFlow: () => ({ ok: true, text: "" }), sim }).observe(db);
    expect(seen).toMatch(/SLL-2026-11.*EUR 240\.00.*fee_unknown.*nothing was paid/);
  });
});
