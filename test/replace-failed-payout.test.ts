// A failed transfer, replaced once and never twice (src/executors/replaceFailed.ts). When Airwallex fails a supplier
// payout for good (FAILED, then closed as CANCELLED with its failure type), Purser may send exactly one replacement under
// a new request_id, only on the same approved terms (amount, payee, terms hash), and only after it read the first one
// as final-failed itself. Anything less certain stops and goes to a person: a read that fails, a payout still under way,
// one a person cancelled at Airwallex, one that was paid and came back, a replacement whose own outcome is not known.
// Against both Airwallex stand-ins: the in-memory one (src/redteam/airwallex.ts) and the REST one behind the real client
// and adapter (src/chaos/standInAirwallex.ts). Breaks if any path pays the invoice twice.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AirwallexRest } from "../src/airwallex/adapter.js";
import { Airwallex, AirwallexAmbiguous } from "../src/airwallex/client.js";
import { proposeInvoicePayment, seedTreasury } from "../src/agents/euroBill.js";
import { parseInvoiceFallback } from "../src/agents/invoice.js";
import { StandInAirwallex } from "../src/chaos/standInAirwallex.js";
import { openDb } from "../src/db/open.js";
import { executeInvoicePayment } from "../src/executors/invoicePayment.js";
import { replaceFailedHook, replaceFailedPayout, replacementRequestId } from "../src/executors/replaceFailed.js";
import { executeSupplierPayment } from "../src/executors/supplierPayment.js";
import { apJournal } from "../src/ap/books.js";
import { syncPayments } from "../src/ap/pay.js";
import { apInvoice } from "../src/ap/store.js";
import { followPayouts } from "../src/payouts/follow.js";
import { readRationale } from "../src/payouts/rationale.js";
import { decide } from "../src/policy/approvals.js";
import { setSetting } from "../src/world/settings.js";
import { readFileSync } from "node:fs";
import { NL } from "./fakes/apInvoices.js";
import { supplierWorld, type SupplierWorld } from "./support/supplierWorld.js";

let w: SupplierWorld;
beforeEach(async () => { w = await supplierWorld(); });
afterEach(() => w.done());

const events = (event: string) => (w.db.prepare("SELECT subject, payload_json FROM audit_log WHERE event = ? ORDER BY seq").all(event) as { subject: string; payload_json: string }[])
  .map((r) => ({ subject: r.subject, ...(JSON.parse(r.payload_json) as Record<string, unknown>) }));
const rows = () => w.db.prepare("SELECT request_id, transfer_id, status, replaces_request_id FROM transfers ORDER BY rowid").all() as { request_id: string; transfer_id: string | null; status: string; replaces_request_id: string | null }[];

/** Never paid twice: at Airwallex at most one transfer for the invoice that is not failed, and at most one PAID. */
function paidOnce(transfers: { status: string; amountCents: number }[]): void {
  expect(transfers.filter((t) => !["FAILED", "CANCELLED"].includes(t.status)).length).toBeLessThanOrEqual(1);
  expect(transfers.filter((t) => t.status === "PAID").length).toBeLessThanOrEqual(1);
}

/** An approved Dutch supplier payment, sent (PROCESSING at Airwallex), then failed by the supplier's bank. */
async function sentThenFailed() {
  const pay = await w.approvedPayment(NL, "nl.pdf");
  const r = await executeSupplierPayment(w.db, w.awx, null, pay.proposalId);
  expect(r.transfer.status).toBe("PROCESSING");
  await w.awx.transitionTransfer(r.transfer.id, "FAILED", "INVALID_BENEFICIARY_ACCOUNT");
  return { ...pay, first: r.transfer };
}

describe("a definite failure: one replacement, on the same approved terms", () => {
  it("failed → one replacement under a new request_id → PAID; asked again, nothing more is sent", async () => {
    const { proposalId, terms, first } = await sentThenFailed();
    const out = await replaceFailedPayout(w.db, w.awx, w.awx, proposalId);
    expect(out).toMatchObject({ outcome: "replaced", original: terms.transfer_request_id, request_id: replacementRequestId(terms.transfer_request_id) });
    expect(w.awx.transfers).toHaveLength(2);
    const [a, b] = w.awx.transfers;
    // Same amount, payee, currency and approval hash; a new request_id.
    expect(b).toMatchObject({ amountCents: a!.amountCents, currency: a!.currency, beneficiaryId: a!.beneficiaryId, metadata: a!.metadata, status: "PAID" });
    expect(b!.requestId).not.toBe(a!.requestId);
    expect(rows()).toEqual([
      { request_id: terms.transfer_request_id, transfer_id: first.id, status: "CANCELLED", replaces_request_id: null },
      { request_id: b!.requestId, transfer_id: b!.id, status: "PAID", replaces_request_id: terms.transfer_request_id },
    ]);
    expect(events("transfer.replaced")).toEqual([expect.objectContaining({ subject: terms.transfer_request_id, replacement_request_id: b!.requestId, failure_type: "INVALID_BENEFICIARY_ACCOUNT" })]);
    // The rationale records the replacement and why.
    expect(readRationale(w.db, proposalId)!.replacement).toMatchObject({ request_id: b!.requestId, status: "PAID" });
    // Asked again (a second runner, a re-run): the replacement is there; nothing is sent.
    expect(await replaceFailedPayout(w.db, w.awx, w.awx, proposalId)).toMatchObject({ outcome: "already_replaced", request_id: b!.requestId });
    expect(w.awx.transfers).toHaveLength(2);
    paidOnce(w.awx.transfers);
  });

  it("the replacement fails too: it stops for a person; a third transfer is never sent", async () => {
    const { proposalId } = await sentThenFailed();
    const out = await replaceFailedPayout(w.db, w.awx, null, proposalId);
    expect(out.outcome).toBe("replaced");
    await w.awx.transitionTransfer(w.awx.transfers[1]!.id, "FAILED");
    const again = await replaceFailedPayout(w.db, w.awx, w.awx, proposalId);
    expect(again).toMatchObject({ outcome: "stopped", code: "replaced_once" });
    expect(w.awx.transfers).toHaveLength(2);
    expect(events("transfer.replace_stopped").at(-1)).toMatchObject({ code: "replaced_once", proposal_id: proposalId });
    paidOnce(w.awx.transfers);
  });

  it("the follow-up replaces it by itself only when switched on, and follows the replacement to PAID", async () => {
    const { invoiceId, proposalId, terms } = await sentThenFailed();
    // Off (no KIT11_REPLACE_FAILED_PAYOUT=on): no hook, and the follow-up only reads.
    expect(replaceFailedHook(w.db, w.awx, {})).toBeNull();
    await followPayouts(w.db, w.awx, w.now);
    expect(w.awx.transfers).toHaveLength(1);
    const hook = replaceFailedHook(w.db, w.awx, { KIT11_REPLACE_FAILED_PAYOUT: "on" })!;
    await followPayouts(w.db, w.awx, w.now, { replaceFailed: hook });
    expect(w.awx.transfers).toHaveLength(2);
    await w.awx.transitionTransfer(w.awx.transfers[1]!.id, "SENT");
    await w.awx.transitionTransfer(w.awx.transfers[1]!.id, "PAID");
    await followPayouts(w.db, w.awx, w.now, { replaceFailed: hook });
    expect(rows().find((r) => r.replaces_request_id === terms.transfer_request_id)!.status).toBe("PAID");
    expect(w.awx.transfers).toHaveLength(2);
    expect(readRationale(w.db, proposalId)!.outcome).toBe("executed");
    paidOnce(w.awx.transfers);
    // The invoice is paid by the replacement, booked once, as the CFO signed it.
    await syncPayments(w.db, { now: () => w.now, rail: w.awx, replaceFailed: hook });
    expect(apInvoice(w.db, invoiceId)!.status).toBe("paid");
    const lines = apJournal(w.db).filter((e) => e.invoice_id === invoiceId && e.event === "payment");
    expect(lines.map((e) => [e.debit, e.credit])).toEqual([[terms.amount, ""], ["", terms.amount]]);
  });
});

describe("anything less certain: no replacement, a person decides", () => {
  it("the first transfer is still under way (PROCESSING): nothing is sent", async () => {
    const pay = await w.approvedPayment(NL, "nl.pdf");
    await executeSupplierPayment(w.db, w.awx, null, pay.proposalId);
    expect(await replaceFailedPayout(w.db, w.awx, w.awx, pay.proposalId)).toMatchObject({ outcome: "stopped", code: "not_failed" });
    expect(w.awx.transfers).toHaveLength(1);
  });

  it("FAILED but not yet closed by Airwallex: it waits, nothing is sent", async () => {
    const { proposalId } = await sentThenFailed();
    w.awx.transfers[0]!.status = "FAILED";
    expect(await replaceFailedPayout(w.db, w.awx, w.awx, proposalId)).toMatchObject({ outcome: "waiting" });
    expect(w.awx.transfers).toHaveLength(1);
  });

  it("Airwallex cannot be read (the answer is lost): nothing is sent", async () => {
    const { proposalId } = await sentThenFailed();
    w.awx.getTransfer = async () => { throw new AirwallexAmbiguous("/transfers/x", new Error("socket hang up")); };
    expect(await replaceFailedPayout(w.db, w.awx, w.awx, proposalId)).toMatchObject({ outcome: "stopped", code: "read_failed" });
    expect(w.awx.transfers).toHaveLength(1);
  });

  it("cancelled by a person in Airwallex's approval workflow (no failure type): that decision is never overridden", async () => {
    w.awx.approvalWorkflow = true;
    const pay = await w.approvedPayment(NL, "nl.pdf");
    const r = await executeSupplierPayment(w.db, w.awx, null, pay.proposalId);
    w.awx.approveInWebApp(r.transfer.id, false);
    expect(await replaceFailedPayout(w.db, w.awx, w.awx, pay.proposalId)).toMatchObject({ outcome: "stopped", code: "cancelled_not_failed" });
    expect(w.awx.transfers).toHaveLength(1);
  });

  it("paid, then returned by the supplier's bank: never sent again under the old approval", async () => {
    const pay = await w.approvedPayment(NL, "nl.pdf");
    const r = await executeSupplierPayment(w.db, w.awx, w.awx, pay.proposalId);
    expect(r.transfer.status).toBe("PAID");
    await w.awx.transitionTransfer(r.transfer.id, "FAILED");
    // Airwallex's payout.transfer.failed webhook asks for a read; the follow-up reads it and records the return.
    const { checkEvent } = await import("../src/policy/airwallexEvents.js");
    checkEvent(w.db, "payout.transfer.failed", { id: r.transfer.id, status: "FAILED" }, w.now);
    await followPayouts(w.db, w.awx, w.now);
    expect(await replaceFailedPayout(w.db, w.awx, w.awx, pay.proposalId)).toMatchObject({ outcome: "stopped", code: "returned_after_paid" });
    expect(w.awx.transfers).toHaveLength(1);
  });

  it("the replacement's create is lost on its way and not found: it stops; asked again it never sends under another request_id", async () => {
    const { proposalId } = await sentThenFailed();
    w.awx.dropNextTransfer = true;
    expect(await replaceFailedPayout(w.db, w.awx, w.awx, proposalId)).toMatchObject({ outcome: "stopped", code: "replacement_unknown" });
    expect(w.awx.transfers).toHaveLength(1);
    expect(await replaceFailedPayout(w.db, w.awx, w.awx, proposalId)).toMatchObject({ outcome: "stopped", code: "replacement_unknown" });
    expect(w.awx.transfers).toHaveLength(1);
    expect(rows().filter((r) => r.replaces_request_id)).toHaveLength(1);
  });

  it("the replacement's answer is lost after Airwallex made it: it is found by its request_id and adopted, not sent again", async () => {
    const { proposalId } = await sentThenFailed();
    w.awx.loseNextTransferAnswer = true;
    expect(await replaceFailedPayout(w.db, w.awx, null, proposalId)).toMatchObject({ outcome: "replaced", adopted: true });
    expect(w.awx.transfers).toHaveLength(2);
    paidOnce(w.awx.transfers);
  });

  it("the emergency stop, or terms changed after the approval: nothing is sent", async () => {
    const { proposalId } = await sentThenFailed();
    setSetting(w.db, "human", "freeze", "on");
    expect(await replaceFailedPayout(w.db, w.awx, w.awx, proposalId)).toMatchObject({ outcome: "stopped", code: "held" });
    setSetting(w.db, "human", "freeze", "off");
    const t = JSON.parse((w.db.prepare("SELECT terms_json FROM proposals WHERE proposal_id = ?").get(proposalId) as { terms_json: string }).terms_json) as Record<string, unknown>;
    w.db.prepare("UPDATE proposals SET terms_json = ? WHERE proposal_id = ?").run(JSON.stringify({ ...t, amount: "999.00" }), proposalId);
    expect(await replaceFailedPayout(w.db, w.awx, w.awx, proposalId)).toMatchObject({ outcome: "stopped", code: "terms_changed" });
    expect(w.awx.transfers).toHaveLength(1);
  });
});

describe("over the real Airwallex client and adapter, against the REST stand-in", () => {
  const INVOICE = readFileSync(new URL("../fixtures/bergtex-invoice-BTX-2026-11.txt", import.meta.url), "utf8");

  async function euroPayment() {
    const awx = new StandInAirwallex(() => Date.now());
    const rail = new AirwallexRest(new Airwallex({ clientId: "stand-in", apiKey: "stand-in", fetchImpl: awx.fetch, sleep: async () => {}, minGapMs: 0, timeoutMs: 1_000 }));
    const db = openDb(":memory:");
    await seedTreasury(db, rail, rail);
    const out = await proposeInvoicePayment(db, rail, parseInvoiceFallback(INVOICE), INVOICE, new Date());
    if (out.kind !== "proposed") throw new Error(out.kind);
    const id = out.proposal.proposal_id;
    decide(db, { proposalId: id, decision: "APPROVED", typedPrefix: out.proposal.terms_sha256.slice(0, 8), approver: "cfo", method: "cli" });
    const r = await executeInvoicePayment(db, rail, null, id, () => new Date(), { delaysMs: [], sleep: async () => {} });
    return { awx, rail, db, id, first: r.transfer };
  }
  /** The supplier's bank fails the transfer; Airwallex returns its amount to the EUR balance ("Handle failed transfers"). */
  async function bankFails(awx: StandInAirwallex, rail: AirwallexRest, first: { id: string; amountCents: number }) {
    await rail.transitionTransfer(first.id, "FAILED");
    // The stand-in keeps a failed transfer's money reserved; Airwallex gives it back (amount and fee: it was never paid
    // out), which is what this payment's floor reads.
    const back = first.amountCents + (awx.transfers.find((t) => t.id === first.id)!.fee?.cents ?? 0);
    awx.fake.bal.EUR.reservedCents -= back;
    awx.fake.bal.EUR.availableCents += back;
  }

  it("failed → one replacement → PAID; a second failure stops", async () => {
    const { awx, rail, db, id, first } = await euroPayment();
    await bankFails(awx, rail, first);
    expect(await replaceFailedPayout(db, rail, rail, id)).toMatchObject({ outcome: "replaced" });
    expect(awx.transfers).toHaveLength(2);
    expect(awx.transfers[1]).toMatchObject({ status: "PAID", amountCents: awx.transfers[0]!.amountCents, beneficiaryId: awx.transfers[0]!.beneficiaryId, metadata: awx.transfers[0]!.metadata });
    paidOnce(awx.transfers);
    // The euro invoice's rationale: SWIFT, funded by the shortfall bought from USD on its locked quote, the replacement named.
    const why = readRationale(db, id)!;
    expect(why).toMatchObject({ kind: "invoice_payment", outcome: "executed", rail: { method: "SWIFT" }, replacement: { status: "PAID" } });
    expect(why.funding.conversion).toMatchObject({ sell: expect.stringMatching(/^USD [\d.]+$/) as string, buy: expect.stringMatching(/^EUR [\d.]+$/) as string });
    // Then the replacement comes back too: it stops for a person, never a third send.
    await rail.transitionTransfer(awx.transfers[1]!.id, "FAILED");
    expect(await replaceFailedPayout(db, rail, rail, id)).toMatchObject({ outcome: "stopped", code: "replaced_once" });
    expect(awx.transfers).toHaveLength(2);
    db.close();
  });

  it("the replacement's create answer is lost (connection dropped after Airwallex made it): adopted by request_id, never doubled", async () => {
    const { awx, rail, db, id, first } = await euroPayment();
    await bankFails(awx, rail, first);
    awx.faultOf = (c) => (c.method === "POST" && c.path === "/transfers/create" ? "lost-answer" : null);
    const out = await replaceFailedPayout(db, rail, null, id);
    expect(out).toMatchObject({ outcome: "replaced", adopted: true });
    awx.faultOf = () => null;
    expect(await replaceFailedPayout(db, rail, null, id)).toMatchObject({ outcome: "already_replaced" });
    expect(awx.transfers).toHaveLength(2);
    paidOnce(awx.transfers);
    db.close();
  });

  it("Airwallex answers 500 to every read of the first transfer: nothing is sent", async () => {
    const { awx, rail, db, id, first } = await euroPayment();
    await bankFails(awx, rail, first);
    awx.faultOf = (c) => (c.method === "GET" && c.path.startsWith("/transfers/") ? "500" : null);
    expect(await replaceFailedPayout(db, rail, rail, id)).toMatchObject({ outcome: "stopped", code: "read_failed" });
    expect(awx.transfers).toHaveLength(1);
    db.close();
  });
});
