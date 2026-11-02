// A payout row left SUBMITTING with no transfer behind it (agent run 1's P-0005 row, from before 78a761b; or a crash
// after the row was written and before the first create, then a resend refused) blocks its invoice for ever. The CFO's
// `npm run reconcile -- --close-unsent <request_id>` closes it, and only it: after a read-only look-up by request_id
// finds nothing, for a row quiet for N minutes whose proposal can no longer run. Every other case is refused.
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { invoiceAlreadyHandled, proposeInvoicePayment, seedTreasury } from "../src/agents/euroBill.js";
import { parseInvoiceFallback } from "../src/agents/invoice.js";
import { AirwallexError } from "../src/airwallex/client.js";
import type { NewTransfer, Transfer } from "../src/airwallex/port.js";
import { audit } from "../src/audit/log.js";
import { openDb, type DB } from "../src/db/open.js";
import { executeInvoicePayment } from "../src/executors/invoicePayment.js";
import { CLOSE_UNSENT_MIN_AGE_MINUTES, closeUnsent, strictTransferLookup } from "../src/finance/closeUnsent.js";
import { reconcile } from "../src/finance/reconcile.js";
import { eurInFlightCents } from "../src/policy/available.js";
import { decide } from "../src/policy/approvals.js";
import { chaos } from "../src/policy/saga.js";
import { parseOrigin } from "../src/provenance/origin.js";
import { FakeAirwallex } from "../src/redteam/airwallex.js";

const text = readFileSync(new URL("../fixtures/stockline-licence-SLL-2026-11.txt", import.meta.url), "utf8");

/** The sandbox answering fee_unknown to the next `refuse` creates (agent run 1, 2 November). */
class FeeUnknownAirwallex extends FakeAirwallex {
  refuse = 0;
  override async createTransfer(t: NewTransfer): Promise<Transfer> {
    if (this.refuse > 0) {
      this.refuse--;
      this.calls.push("createTransfer:refused");
      throw new AirwallexError(400, "fee_unknown", { code: "fee_unknown", message: "There is a problem with your transfer fee configuration." }, "/transfers/create", { traceId: "t1" });
    }
    return super.createTransfer(t);
  }
}

const FAST = { delaysMs: [15_000, 30_000, 60_000, 90_000, 120_000], sleep: async () => {} };
const row = (db: DB) => db.prepare("SELECT transfer_id, status, failure_type FROM transfers").get() as { transfer_id: string | null; status: string; failure_type: string | null };
const closedRows = (db: DB) => (db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE event = 'transfer.closed_unsent'").get() as { n: number }).n;
const minutes = (n: number) => n * 60_000;

/** The coordinator's case 1: a crash after the row was written and before the first create; the re-run, a resend, is refused. */
async function stuckRow() {
  const db = openDb(":memory:");
  const awx = new FeeUnknownAirwallex();
  await seedTreasury(db, awx, awx);
  const out = await proposeInvoicePayment(db, awx, parseInvoiceFallback(text), text);
  if (out.kind !== "proposed") throw new Error(out.reason);
  const id = out.proposal.proposal_id;
  decide(db, { proposalId: id, decision: "APPROVED", typedPrefix: out.proposal.terms_sha256.slice(0, 8), approver: "test", method: "cli" });
  chaos.at = (point) => { if (point === "transfer:after-insert") throw new Error("crash"); };
  try {
    await expect(executeInvoicePayment(db, awx, awx, id, undefined, FAST)).rejects.toThrow("crash");
  } finally {
    chaos.at = null;
  }
  awx.refuse = 6;
  await expect(executeInvoicePayment(db, awx, awx, id, undefined, FAST)).rejects.toMatchObject({ code: "fee_unknown" });
  expect(row(db)).toEqual({ transfer_id: null, status: "SUBMITTING", failure_type: null });
  const requestId = out.terms.transfer_request_id;
  // Well after the proposal expired and the row went quiet.
  const later = new Date(Date.parse(out.terms.expires_at) + minutes(CLOSE_UNSENT_MIN_AGE_MINUTES + 1));
  return { db, awx, out, id, requestId, later };
}

const nothing = async () => undefined;

describe("closing a stale SUBMITTING payout row with no transfer behind it (npm run reconcile -- --close-unsent)", () => {
  it("the stuck row of a crash before the first send: closed after the look-up finds nothing, audited with the CFO's command as origin; the invoice can be proposed again", async () => {
    const { db, awx, out, requestId, later } = await stuckRow();
    expect(invoiceAlreadyHandled(db, "SLL-2026-11")).toMatch(/already has a payout \(SUBMITTING\)/);
    const looked: string[] = [];
    const r = await closeUnsent(db, requestId, async (rid) => { looked.push(rid); return awx.findTransferByRequestId(rid); }, { now: () => later });
    expect(r).toMatchObject({ closed: true });
    expect(looked).toEqual([requestId]);
    expect(row(db)).toEqual({ transfer_id: null, status: "CANCELLED", failure_type: "closed_unsent" });
    const a = db.prepare("SELECT subject, payload_json FROM audit_log WHERE event = 'transfer.closed_unsent'").get() as { subject: string; payload_json: string };
    expect(a.subject).toBe(requestId);
    const p = JSON.parse(a.payload_json) as Record<string, unknown>;
    expect(p).toMatchObject({ request_id: requestId, invoice_no: "SLL-2026-11", amount: "EUR 240.00", proposal_id: out.proposal.proposal_id });
    expect(parseOrigin(JSON.stringify(p.origin))).toMatchObject({ actor: "code", rule: expect.stringContaining("--close-unsent") });
    expect(eurInFlightCents(db)).toBe(0);
    expect(invoiceAlreadyHandled(db, "SLL-2026-11")).toBeNull();
    // Closed rows are never sent again under their request_id.
    expect(awx.transfers).toHaveLength(0);
  });

  it("refuses an unknown request_id, a row with a transfer, a row already closed, and an id that is not a request_id", async () => {
    const { db, awx, requestId, later } = await stuckRow();
    const opts = { now: () => later };
    expect(await closeUnsent(db, randomUUID(), nothing, opts)).toMatchObject({ closed: false, reason: expect.stringMatching(/no payout row/) });
    expect(await closeUnsent(db, "../balances", nothing, opts)).toMatchObject({ closed: false, reason: expect.stringMatching(/not a request_id/) });
    db.prepare("UPDATE transfers SET transfer_id = 'tr-x', status = 'PAID' WHERE request_id = ?").run(requestId);
    expect(await closeUnsent(db, requestId, nothing, opts)).toMatchObject({ closed: false, reason: expect.stringMatching(/has a transfer/) });
    db.prepare("UPDATE transfers SET transfer_id = NULL, status = 'CANCELLED' WHERE request_id = ?").run(requestId);
    expect(await closeUnsent(db, requestId, nothing, opts)).toMatchObject({ closed: false, reason: expect.stringMatching(/not SUBMITTING/) });
    expect(closedRows(db)).toBe(0);
    expect(awx.calls.filter((c) => c.startsWith("createTransfer"))).toHaveLength(6);
  });

  it("refuses a row that is not yet quiet for N minutes, without looking anything up", async () => {
    const { db, requestId, out } = await stuckRow();
    let looked = 0;
    const soon = new Date(Date.parse(out.terms.expires_at) + minutes(1));
    const r = await closeUnsent(db, requestId, async () => { looked++; return undefined; }, { now: () => soon });
    expect(r).toMatchObject({ closed: false, reason: expect.stringMatching(/minutes/) });
    expect(looked).toBe(0);
    expect(row(db).status).toBe("SUBMITTING");
  });

  it("refuses while its proposal executes (a live execution, a retry waiting) or can still be run again", async () => {
    const { db, id, requestId, out, later } = await stuckRow();
    db.prepare("UPDATE proposals SET status = 'EXECUTING' WHERE proposal_id = ?").run(id);
    expect(await closeUnsent(db, requestId, nothing, { now: () => later })).toMatchObject({ closed: false, reason: expect.stringMatching(/EXECUTING/) });
    db.prepare("UPDATE proposals SET status = 'FAILED' WHERE proposal_id = ?").run(id);
    // FAILED but not yet expired: it may be run again (a resend), so it is not closed under it.
    const beforeExpiry = new Date(Date.parse(out.terms.expires_at) - 1000);
    expect(await closeUnsent(db, requestId, nothing, { now: () => beforeExpiry, minAgeMinutes: 0 })).toMatchObject({ closed: false, reason: expect.stringMatching(/run again/) });
    expect(row(db).status).toBe("SUBMITTING");
    expect(closedRows(db)).toBe(0);
  });

  it("refuses when Airwallex holds a transfer under the request_id, and when the look-up fails", async () => {
    const { db, awx, out, requestId, later } = await stuckRow();
    const found = { id: randomUUID(), requestId, status: "PAID", amountCents: 24_000, currency: "EUR" as const, metadata: "x", beneficiaryId: out.terms.beneficiary_id };
    expect(await closeUnsent(db, requestId, async () => found, { now: () => later })).toMatchObject({ closed: false, reason: expect.stringMatching(new RegExp(`holds transfer ${found.id}`)) });
    expect(await closeUnsent(db, requestId, async () => { throw new Error("socket hang up"); }, { now: () => later })).toMatchObject({ closed: false, reason: expect.stringMatching(/look-up .*failed.*socket hang up/) });
    expect(row(db).status).toBe("SUBMITTING");
    expect(closedRows(db)).toBe(0);
    expect(awx.transfers).toHaveLength(0);
  });

  it("refuses when an execution of its proposal starts while Airwallex is being asked", async () => {
    const { db, id, requestId, later } = await stuckRow();
    const r = await closeUnsent(db, requestId, async () => { audit(db, "system", "proposal.executing", id, { terms_sha256: "x" }); return undefined; }, { now: () => later });
    expect(r).toMatchObject({ closed: false, reason: expect.stringMatching(/changed while/) });
    expect(row(db).status).toBe("SUBMITTING");
  });

  it("a row it closed stays in the reconciliation: a transfer that shows up later under its request_id is a difference", async () => {
    const { db, awx, out, requestId, later } = await stuckRow();
    expect(await closeUnsent(db, requestId, nothing, { now: () => later })).toMatchObject({ closed: true });
    awx.transfers.push({ id: randomUUID(), requestId, status: "PAID", amountCents: 24_000, currency: "EUR", metadata: "x", beneficiaryId: out.terms.beneficiary_id });
    const r = await reconcile(db, {
      transfer: async (tid) => awx.getTransfer(tid),
      transferByRequestId: async (rid) => { const t = await awx.findTransferByRequestId(rid); return t && { id: t.id, status: t.status, amountCents: t.amountCents, currency: t.currency }; },
    });
    expect(r.differences).toEqual([expect.objectContaining({ ref: requestId, ledger: expect.stringContaining("closed") })]);
  });
});

describe("the strict look-up the command uses: Airwallex's list must really be filtered by the request_id", () => {
  const rid = randomUUID();
  it("asks GET /transfers with the request_id only, and reads its item", async () => {
    const asked: unknown[] = [];
    const look = strictTransferLookup(async (path, query) => { asked.push([path, query]); return { items: [{ id: "t-1", request_id: rid, status: "PAID" }] }; });
    expect(await look(rid)).toMatchObject({ id: "t-1" });
    expect(asked).toEqual([["/transfers", { request_id: rid }]]);
  });
  it("an empty list is nothing", async () => {
    expect(await strictTransferLookup(async () => ({ items: [] }))(rid)).toBeUndefined();
  });
  it("a list holding other request_ids (the filter ignored), or more pages, is an error, never 'nothing'", async () => {
    await expect(strictTransferLookup(async () => ({ items: [{ id: "t-9", request_id: "another" }] }))(rid)).rejects.toThrow(/not filtered/);
    await expect(strictTransferLookup(async () => ({ items: [], has_more: true }))(rid)).rejects.toThrow(/not filtered/);
    await expect(strictTransferLookup(async () => ({ nothing: true }))(rid)).rejects.toThrow();
  });
});
