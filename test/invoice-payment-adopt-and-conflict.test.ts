// An invoice payment's payout (src/executors/invoicePayment.ts) when Airwallex's answer and the ledger disagree. A
// transfer is adopted only when it is exactly this payout (its request_id, amount and currency, live); anything else
// is an error for a person and the payout row stays SUBMITTING (money may be under way), never closed or resent. A
// payout row that changed while the transfer was being made is an alarm, never overwritten.
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { proposeInvoicePayment, seedTreasury } from "../src/agents/euroBill.js";
import { parseInvoiceFallback } from "../src/agents/invoice.js";
import { AirwallexError } from "../src/airwallex/client.js";
import type { NewTransfer, Transfer } from "../src/airwallex/port.js";
import { openDb, type DB } from "../src/db/open.js";
import { executeInvoicePayment, payeeReason, sameTransfer } from "../src/executors/invoicePayment.js";
import { decide } from "../src/policy/approvals.js";
import { chaos } from "../src/policy/saga.js";
import { FakeAirwallex } from "../src/redteam/airwallex.js";

const text = readFileSync(new URL("../fixtures/stockline-licence-SLL-2026-11.txt", import.meta.url), "utf8");
const FAST = { delaysMs: [], sleep: async () => {} };

/** Airwallex makes the transfer, then answers duplicate_request_id instead of the transfer (what `onCreate` does to it first). */
class DuplicateAnswerAirwallex extends FakeAirwallex {
  dupDetailsId: string | null = null;
  onCreate: ((made: Transfer & { status: string }) => void) | null = null;
  answerDuplicate = false;
  override async createTransfer(t: NewTransfer): Promise<Transfer> {
    const made = await super.createTransfer(t);
    if (!this.answerDuplicate) return made;
    this.onCreate?.(this.transfers.find((x) => x.id === made.id)!);
    throw new AirwallexError(400, "duplicate_request_id", { code: "duplicate_request_id", details: { id: this.dupDetailsId ?? made.id } }, "/transfers/create");
  }
}

async function approved(awx: FakeAirwallex) {
  const db = openDb(":memory:");
  await seedTreasury(db, awx, awx);
  const out = await proposeInvoicePayment(db, awx, parseInvoiceFallback(text), text);
  if (out.kind !== "proposed") throw new Error(out.reason);
  const id = out.proposal.proposal_id;
  decide(db, { proposalId: id, decision: "APPROVED", typedPrefix: out.proposal.terms_sha256.slice(0, 8), approver: "test", method: "cli" });
  return { db, id, requestId: out.terms.transfer_request_id, amount: out.terms.amount };
}
const payout = (db: DB) => db.prepare("SELECT transfer_id, status FROM transfers").get() as { transfer_id: string | null; status: string };
const status = (db: DB, id: string) => (db.prepare("SELECT status FROM proposals WHERE proposal_id = ?").get(id) as { status: string }).status;
const events = (db: DB, e: string) => (db.prepare("SELECT payload_json FROM audit_log WHERE event = ?").all(e) as { payload_json: string }[]).map((r) => JSON.parse(r.payload_json) as Record<string, unknown>);

afterEach(() => { chaos.at = null; });

describe("duplicate_request_id at create: adopt only this payout", () => {
  it("adopts the transfer under its request_id (an id that is not a UUID is looked up by request_id), and sends nothing twice", async () => {
    const awx = new DuplicateAnswerAirwallex();
    awx.answerDuplicate = true;
    awx.dupDetailsId = "not-a-uuid";
    const { db, id, requestId } = await approved(awx);
    const r = await executeInvoicePayment(db, awx, awx, id, undefined, FAST);
    expect(awx.transfers).toHaveLength(1);
    expect(awx.calls.filter((c) => c === "createTransfer")).toHaveLength(1);
    expect(r.transfer.id).toBe(awx.transfers[0]!.id);
    expect(payout(db)).toEqual({ transfer_id: awx.transfers[0]!.id, status: "PAID" });
    expect(events(db, "transfer.adopted")).toEqual([expect.objectContaining({ request_id: requestId, payee_confirmed: true })]);
    expect(events(db, "transfer.created")).toEqual([]);
    expect(status(db, id)).toBe("EXECUTED");
  });

  it("does not adopt a transfer under its request_id that already failed: the error stands and the row stays under way", async () => {
    const awx = new DuplicateAnswerAirwallex();
    awx.answerDuplicate = true;
    awx.onCreate = (t) => { t.status = "CANCELLED"; };
    const { db, id } = await approved(awx);
    await expect(executeInvoicePayment(db, awx, awx, id, undefined, FAST)).rejects.toMatchObject({ code: "duplicate_request_id" });
    expect(payout(db)).toEqual({ transfer_id: null, status: "SUBMITTING" });
    expect(events(db, "transfer.adopted")).toEqual([]);
    expect(status(db, id)).toBe("FAILED");
    expect(awx.calls.filter((c) => c === "createTransfer")).toHaveLength(1);
  });

  it("does not adopt a transfer for another amount", async () => {
    const awx = new DuplicateAnswerAirwallex();
    awx.answerDuplicate = true;
    awx.onCreate = (t) => { t.amountCents += 1; };
    const { db, id } = await approved(awx);
    await expect(executeInvoicePayment(db, awx, awx, id, undefined, FAST)).rejects.toMatchObject({ code: "duplicate_request_id" });
    expect(payout(db)).toEqual({ transfer_id: null, status: "SUBMITTING" });
    expect(events(db, "transfer.adopted")).toEqual([]);
  });

  it("does not adopt when nothing is found under the request_id", async () => {
    const awx = new DuplicateAnswerAirwallex();
    awx.answerDuplicate = true;
    awx.dupDetailsId = "nope";
    awx.transferLookupMisses = 1;
    const { db, id } = await approved(awx);
    await expect(executeInvoicePayment(db, awx, awx, id, undefined, FAST)).rejects.toMatchObject({ code: "duplicate_request_id" });
    expect(payout(db)).toEqual({ transfer_id: null, status: "SUBMITTING" });
  });
});

describe("a lost answer, and a re-run, that find someone else's transfer", () => {
  it("a lost create answer whose look-up finds a different transfer stops for a person; nothing is resent", async () => {
    const awx = new FakeAirwallex();
    awx.loseNextTransferAnswer = true;
    const real = awx.findTransferByRequestId.bind(awx);
    awx.findTransferByRequestId = async (rid) => { const t = await real(rid); return t && { ...t, amountCents: t.amountCents * 2 }; };
    const { db, id, requestId } = await approved(awx);
    await expect(executeInvoicePayment(db, awx, awx, id, undefined, FAST)).rejects.toThrow(`Airwallex holds a transfer under ${requestId} that is not this payout; nothing is sent, a person checks it`);
    expect(awx.calls.filter((c) => c === "createTransfer")).toHaveLength(1);
    expect(payout(db)).toEqual({ transfer_id: null, status: "SUBMITTING" });
  });

  it("a re-run after a crash that finds a different transfer under the request_id sends nothing", async () => {
    const awx = new FakeAirwallex();
    const { db, id, requestId } = await approved(awx);
    chaos.at = (point) => { if (point === "transfer:after-insert") throw new Error("crash"); };
    await expect(executeInvoicePayment(db, awx, awx, id, undefined, FAST)).rejects.toThrow("crash");
    chaos.at = null;
    // Something else sits under this payout's request_id at Airwallex: another payee.
    awx.transfers.push({ id: "tr_other", requestId, status: "PROCESSING", amountCents: 100, currency: "EUR", metadata: "", beneficiaryId: "ben_other" } as never);
    await expect(executeInvoicePayment(db, awx, awx, id, undefined, FAST)).rejects.toThrow(`Airwallex holds a transfer under ${requestId} that is not this payout`);
    expect(awx.calls).not.toContain("createTransfer");
    expect(payout(db)).toEqual({ transfer_id: null, status: "SUBMITTING" });
  });

  it("a re-run of a payout Airwallex refused at create and that was closed sends nothing again", async () => {
    const awx = new FakeAirwallex();
    const real = awx.createTransfer.bind(awx);
    let refuse = true;
    awx.createTransfer = async (t) => {
      if (refuse) { awx.calls.push("createTransfer"); throw new AirwallexError(400, "validation_failed", { message: "refused" }, "/transfers/create"); }
      return real(t);
    };
    const { db, id, requestId } = await approved(awx);
    await expect(executeInvoicePayment(db, awx, awx, id, undefined, FAST)).rejects.toMatchObject({ code: "validation_failed" });
    expect(payout(db)).toEqual({ transfer_id: null, status: "CANCELLED" });
    refuse = false;
    db.prepare("UPDATE proposals SET status = 'APPROVED' WHERE proposal_id = ?").run(id);
    await expect(executeInvoicePayment(db, awx, awx, id, undefined, FAST)).rejects.toThrow(`the payout ${requestId} was refused by Airwallex and closed; nothing is sent again under it, a new proposal is needed`);
    expect(awx.transfers).toHaveLength(0);
  });
});

describe("the payout row changed while the transfer was made", () => {
  it("is never overwritten: an alarm row and a stop for a person", async () => {
    const awx = new FakeAirwallex();
    const { db, id, requestId } = await approved(awx);
    chaos.at = (point) => { if (point === "transfer:after-create") db.prepare("UPDATE transfers SET status = 'CANCELLED' WHERE request_id = ?").run(requestId); };
    await expect(executeInvoicePayment(db, awx, awx, id, undefined, FAST)).rejects.toThrow(/but the ledger's payout row is CANCELLED; nothing more is sent, a person checks it now/);
    expect(payout(db)).toEqual({ transfer_id: null, status: "CANCELLED" });
    expect(events(db, "transfer.row_conflict")).toEqual([expect.objectContaining({ request_id: requestId, row_status: "CANCELLED", row_transfer_id: null })]);
  });
});

describe("the pure checks", () => {
  const want = { requestId: "rq", beneficiaryId: "ben-1", amountCents: 1000, currency: "EUR", sourceCurrency: "EUR", reference: "r", reason: "x", approvalSha256: "h" } as NewTransfer;
  const found = { id: "tr", requestId: "rq", status: "PROCESSING", amountCents: 1000, currency: "EUR", beneficiaryId: "ben-1" } as Transfer;
  it("a transfer is this payout only with its request_id, amount, currency and payee; live only when adopting", () => {
    expect(sameTransfer(found, want)).toBe(true);
    expect(sameTransfer({ ...found, beneficiaryId: null } as never, want)).toBe(true);
    expect(sameTransfer({ ...found, beneficiaryId: "ben-2" }, want)).toBe(false);
    expect(sameTransfer({ ...found, requestId: "rq2" }, want)).toBe(false);
    expect(sameTransfer({ ...found, currency: "USD" } as never, want)).toBe(false);
    expect(sameTransfer({ ...found, status: "FAILED" }, want)).toBe(true);
    expect(sameTransfer({ ...found, status: "FAILED" }, want, true)).toBe(false);
    expect(sameTransfer({ ...found, status: "CANCELLED" }, want, true)).toBe(false);
    expect(sameTransfer(found, want, true)).toBe(true);
  });
  it("names a payee missing from the ledger", () => {
    const db = openDb(":memory:");
    expect(payeeReason(db, { beneficiary_id: "ben-x", beneficiary_name: "Acme" } as never)).toBe("the approved payee ben-x is no longer the active account of Acme (missing); nothing is paid, a new proposal is needed");
  });
});
