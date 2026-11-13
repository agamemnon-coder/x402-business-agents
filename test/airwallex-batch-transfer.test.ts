// One Face ID → ONE Airwallex batch transfer (src/executors/airwallexBatch.ts, AIRWALLEX_BATCH_TRANSFER=on). Breaks if
// the signed batch reaches Airwallex as anything but exactly the signed lines, if a batch whose read-back differs is
// submitted, if a batch is created twice, if Purser approves or simulates past Airwallex's approval workflow, or if the
// path runs with its flag off. No network: the in-memory stand-ins only.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { seedTreasury } from "../src/agents/euroBill.js";
import { payApInvoices } from "../src/ap/batchPay.js";
import { ingestDocument, type InboxDeps } from "../src/ap/inbox.js";
import type { Asker } from "../src/ap/read.js";
import { batchTransferOn, FakeBatchTransfers, toBatch, toItem, itemBody } from "../src/airwallex/batchTransfers.js";
import { openDb, type DB } from "../src/db/open.js";
import { batchRequestId, compareReadBack, executeAsOneAirwallexBatch, followAirwallexBatch, lineShapeRefusal } from "../src/executors/airwallexBatch.js";
import { decide } from "../src/policy/approvals.js";
import { executeInvoicePayment } from "../src/executors/invoicePayment.js";
import { executePaymentBatch } from "../src/executors/paymentBatch.js";
import { setSetting } from "../src/world/settings.js";
import { FakeAirwallex } from "./fakes/airwallex.js";
import { EN } from "./fakes/apInvoices.js";
import { pdfOf } from "./fakes/pdf.js";

const now = new Date();
const ON = { AIRWALLEX_BATCH_TRANSFER: "on" };
const parserOnly: Asker = { ask: async (_a, fallback) => ({ value: fallback(), source: "fallback", model: null, note: "no key" }) } as Asker;
const bergtex = (no: string, net: string, vat: string, total: string) => EN
  .replace(/BTX-2026-21/g, no).replace("Subtotal EUR 1,554.62", `Subtotal EUR ${net}`).replace("VAT 19% EUR 295.38", `VAT 19% EUR ${vat}`).replace("Total due EUR 1,850.00", `Total due EUR ${total}`);
const INVOICES = [bergtex("BTX-2026-41", "1,100.00", "209.00", "1,309.00"), bergtex("BTX-2026-42", "1,480.00", "281.20", "1,761.20")];

let dir: string;
let db: DB;
let awx: FakeAirwallex;
let batches: FakeBatchTransfers;
beforeEach(async () => {
  dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "awxbatch-"));
  db = openDb(":memory:");
  awx = new FakeAirwallex();
  batches = new FakeBatchTransfers();
  await seedTreasury(db, awx, awx);
  // Enough free EUR that no line needs a conversion (a line with one runs line by line).
  setSetting(db, "treasury", "eur_floor", "1000.00");
  setSetting(db, "treasury", "eur_obligations", "0.00");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const row = (id: string) => db.prepare("SELECT proposal_id, status, terms_json, terms_sha256 FROM proposals WHERE proposal_id = ?").get(id) as { proposal_id: string; status: string; terms_json: string; terms_sha256: string };
const signed = async () => {
  const deps: InboxDeps = { dir, reader: parserOnly, now: () => now };
  const ids: number[] = [];
  for (const t of INVOICES) {
    const out = await ingestDocument(db, deps, { bytes: await pdfOf(t), filename: "invoice.pdf", source: "upload" });
    if (out.kind !== "invoice") throw new Error(out.kind);
    ids.push(out.invoice.id as unknown as number);
  }
  const out = await payApInvoices(db, awx, ids as never, now);
  const batch = out.batch!;
  decide(db, { proposalId: batch.proposal_id, decision: "APPROVED", typedPrefix: batch.terms_sha256.slice(0, 8), approver: "cfo", method: "cli" }, now);
  return batch;
};
const lines = (batchId: string) => (JSON.parse(row(batchId).terms_json) as { lines: { proposal_id: string; terms_sha256: string; terms: Record<string, string> }[] }).lines;
const transfers = () => db.prepare("SELECT request_id, invoice_no, amount, status, transfer_id FROM transfers ORDER BY invoice_no").all() as { request_id: string; invoice_no: string; amount: string; status: string; transfer_id: string | null }[];

describe("one signed batch as ONE Airwallex batch transfer", () => {
  it("creates one batch with exactly the signed lines, reads it back item by item, then submits; it waits IN_APPROVAL", async () => {
    const batch = await signed();
    const r = await executeAsOneAirwallexBatch(db, { batches, rail: awx }, batch.proposal_id, { env: ON });
    expect(r).toMatchObject({ outcome: "SUBMITTED", status: "IN_APPROVAL", differences: [] });
    expect(batches.calls).toEqual(["createBatch", "addItems", "quoteBatch", "listItems", "submitBatch", "listItems"]);
    expect(batches.batches.size).toBe(1);
    const b = [...batches.batches.values()][0]!;
    expect(b.batch.requestId).toBe(batchRequestId(batch.terms_sha256));
    expect(b.batch.metadata.approval_sha256).toBe(batch.terms_sha256);
    for (const l of lines(batch.proposal_id)) {
      const item = b.items.find((i) => i.requestId === l.terms.transfer_request_id)!;
      expect(item.input).toMatchObject({ beneficiaryId: l.terms.beneficiary_id, currency: "EUR", sourceCurrency: "EUR", method: "SWIFT", reference: l.terms.reference });
      expect(item.input.metadata.approval_sha256).toBe(l.terms_sha256);
      expect(row(l.proposal_id).status).toBe("EXECUTED");
    }
    expect(row(batch.proposal_id).status).toBe("EXECUTED");
    // No single transfer was created, nothing was simulated, and the payouts hold their invoices while they wait.
    expect(awx.calls.filter((c) => c === "createTransfer" || c.startsWith("transition"))).toEqual([]);
    expect(transfers().map((t) => [t.status, t.transfer_id])).toEqual([["IN_APPROVAL", null], ["IN_APPROVAL", null]]);
    expect(() => db.prepare("INSERT INTO transfers (request_id, invoice_no, amount, currency, method, fee_estimate, status, approval_sha256, updated_at) VALUES ('x', ?, '1.00', 'EUR', 'SWIFT', '1.00', 'SUBMITTING', 'h', 'now')").run(transfers()[0]!.invoice_no)).toThrow();
  });

  it("follows the batch once a person approves it in Airwallex's web app: each booked transfer id lands on its payout row", async () => {
    const batch = await signed();
    const r = await executeAsOneAirwallexBatch(db, { batches, rail: awx }, batch.proposal_id, { env: ON });
    expect(await followAirwallexBatch(db, batches, batch.proposal_id)).toMatchObject({ status: "IN_APPROVAL", changed: false, booked: 0 });
    batches.decideInWebApp(r.awx_batch_id!, "approve");
    expect(await followAirwallexBatch(db, batches, batch.proposal_id)).toMatchObject({ status: "BOOKED", changed: true, booked: 2, mismatch: null });
    expect(transfers().every((t) => t.status === "SCHEDULED" && /^tr_b/.test(t.transfer_id ?? ""))).toBe(true);
    expect(batches.calls.filter((c) => c === "submitBatch")).toHaveLength(1);
  });

  it("records a rejection at Airwallex as not paid, and the invoices stay held", async () => {
    const batch = await signed();
    const r = await executeAsOneAirwallexBatch(db, { batches, rail: awx }, batch.proposal_id, { env: ON });
    batches.decideInWebApp(r.awx_batch_id!, "reject");
    expect(await followAirwallexBatch(db, batches, batch.proposal_id)).toMatchObject({ status: "APPROVAL_REJECTED", changed: true });
    expect(transfers().map((t) => t.status)).toEqual(["APPROVAL_REJECTED", "APPROVAL_REJECTED"]);
  });

  it("deletes the batch and submits nothing when an amount at Airwallex differs from the signed line", async () => {
    const batch = await signed();
    batches.tamper = (items) => { items[1]!.input.amountCents += 1; };
    const r = await executeAsOneAirwallexBatch(db, { batches, rail: awx }, batch.proposal_id, { env: ON });
    expect(r.outcome).toBe("REFUSED");
    expect(r.differences.join("\n")).toMatch(/amount at Airwallex is \d+\.\d{2}, signed/);
    expect(batches.calls).not.toContain("submitBatch");
    expect(batches.calls).toContain("deleteBatch");
    expect([...batches.batches.values()][0]!.batch.status).toBe("CANCELLED");
    expect(transfers().map((t) => t.status)).toEqual(["CANCELLED", "CANCELLED"]);
    expect(row(batch.proposal_id).status).toBe("NEEDS_REAPPROVAL");
    for (const l of lines(batch.proposal_id)) expect(row(l.proposal_id).status).toBe("NEEDS_REAPPROVAL");
    await expect(executeAsOneAirwallexBatch(db, { batches, rail: awx }, batch.proposal_id, { env: ON })).rejects.toThrow();
    expect(batches.calls.filter((c) => c === "createBatch")).toHaveLength(1);
  });

  it("refuses an item Airwallex holds that the CFO did not sign, and a dropped line", async () => {
    const batch = await signed();
    batches.tamper = (items) => { items.push({ ...structuredClone(items[0]!), id: "bti_extra", requestId: "not-signed" }); };
    const r = await executeAsOneAirwallexBatch(db, { batches, rail: awx }, batch.proposal_id, { env: ON });
    expect(r.outcome).toBe("REFUSED");
    expect(r.differences.join("\n")).toMatch(/not a line the CFO signed/);
    const b2 = await (async () => { db = openDb(":memory:"); awx = new FakeAirwallex(); batches = new FakeBatchTransfers(); await seedTreasury(db, awx, awx); setSetting(db, "treasury", "eur_floor", "1000.00"); setSetting(db, "treasury", "eur_obligations", "0.00"); return signed(); })();
    batches.tamper = (items) => { items.pop(); };
    const r2 = await executeAsOneAirwallexBatch(db, { batches, rail: awx }, b2.proposal_id, { env: ON });
    expect(r2.outcome).toBe("REFUSED");
    expect(r2.differences.join("\n")).toMatch(/holds 1 items, the CFO signed 2/);
  });

  it("refuses an unknown payee at validation (VALIDATION_FAILED) before anything is submitted", async () => {
    const batch = await signed();
    batches.knownBeneficiaries = new Set();
    const r = await executeAsOneAirwallexBatch(db, { batches, rail: awx }, batch.proposal_id, { env: ON });
    expect(r.outcome).toBe("REFUSED");
    expect(r.differences.join("\n")).toMatch(/VALIDATION_FAILED/);
  });

  it("adopts the batch after a lost create answer, by its request_id: never two batches", async () => {
    const batch = await signed();
    batches.loseNextCreateAnswer = true;
    const r = await executeAsOneAirwallexBatch(db, { batches, rail: awx }, batch.proposal_id, { env: ON });
    expect(r.outcome).toBe("SUBMITTED");
    expect(batches.batches.size).toBe(1);
    expect(batches.calls.slice(0, 2)).toEqual(["createBatch", "findBatchByRequestId"]);
  });

  it("a re-run after a failed submit resumes the same Airwallex batch and replays no item twice", async () => {
    const batch = await signed();
    const submit = batches.submitBatch.bind(batches);
    batches.submitBatch = async () => { throw new Error("network: no answer"); };
    await expect(executeAsOneAirwallexBatch(db, { batches, rail: awx }, batch.proposal_id, { env: ON })).rejects.toThrow(/no answer/);
    expect(row(batch.proposal_id).status).toBe("FAILED");
    expect(transfers().map((t) => t.status)).toEqual(["SUBMITTING", "SUBMITTING"]);
    batches.submitBatch = submit;
    const r = await executeAsOneAirwallexBatch(db, { batches, rail: awx }, batch.proposal_id, { env: ON });
    expect(r).toMatchObject({ outcome: "SUBMITTED", status: "IN_APPROVAL" });
    expect(batches.batches.size).toBe(1);
    expect([...batches.batches.values()][0]!.items).toHaveLength(2);
    expect(batches.calls.filter((c) => c === "createBatch")).toHaveLength(1);
  });

  it("is on by default; does nothing with its emergency stop set, and nothing at Airwallex when Purser's own checks refuse", async () => {
    const batch = await signed();
    expect(batchTransferOn({})).toBe(true);
    await expect(executeAsOneAirwallexBatch(db, { batches, rail: awx }, batch.proposal_id, { env: { AIRWALLEX_BATCH_TRANSFER: "off" } })).rejects.toThrow(/AIRWALLEX_BATCH_TRANSFER is not on/);
    setSetting(db, "treasury", "eur_floor", "34000.00");
    await expect(executeAsOneAirwallexBatch(db, { batches, rail: awx }, batch.proposal_id, { env: ON })).rejects.toThrow(/floor/);
    expect(batches.calls).toEqual([]);
    expect(transfers()).toEqual([]);
    expect(row(batch.proposal_id).status).toBe("APPROVED");
  });

  it("refuses an unapproved batch and lines it cannot carry", async () => {
    const deps: InboxDeps = { dir, reader: parserOnly, now: () => now };
    const out = await ingestDocument(db, deps, { bytes: await pdfOf(INVOICES[0]!), filename: "invoice.pdf", source: "upload" });
    if (out.kind !== "invoice") throw new Error(out.kind);
    const out2 = await ingestDocument(db, deps, { bytes: await pdfOf(INVOICES[1]!), filename: "invoice.pdf", source: "upload" });
    if (out2.kind !== "invoice") throw new Error(out2.kind);
    const b = (await payApInvoices(db, awx, [out.invoice.id, out2.invoice.id] as never, now)).batch!;
    await expect(executeAsOneAirwallexBatch(db, { batches, rail: awx }, b.proposal_id, { env: ON })).rejects.toThrow(/not approved/);
    expect(lineShapeRefusal({ proposal_id: "P-1", kind: "supplier_payment", terms: {} })).toMatch(/line by line/);
    expect(lineShapeRefusal({ proposal_id: "P-1", kind: "invoice_payment", terms: { currency: "EUR", method: "SWIFT", conversion: { quote_id: "q" } } })).toMatch(/conversion/);
    expect(batches.calls).toEqual([]);
  });
});

describe("the review's cases (12 November): never twice, never past a refusal, never on a partial read-back", () => {
  it("a lost submit answer, then a line-by-line run or a line on its own: refused, nothing sent as a single transfer", async () => {
    const batch = await signed();
    const submit = batches.submitBatch.bind(batches);
    batches.submitBatch = async (id) => { await submit(id); throw new Error("network: no answer"); };
    await expect(executeAsOneAirwallexBatch(db, { batches, rail: awx }, batch.proposal_id, { env: ON })).rejects.toThrow(/no answer/);
    expect([...batches.batches.values()][0]!.batch.status).toBe("IN_APPROVAL");
    await expect(executePaymentBatch(db, batch.proposal_id, async (id) => { await executeInvoicePayment(db, awx, awx, id); }, now)).rejects.toThrow(/never also run line by line/);
    for (const l of lines(batch.proposal_id)) await expect(executeInvoicePayment(db, awx, awx, l.proposal_id)).rejects.toThrow(/never sent on its own/);
    expect(awx.calls.filter((c) => c === "createTransfer")).toEqual([]);
    // The batch path resumes it: adopted after checking the items, recorded as waiting, never submitted twice.
    batches.submitBatch = submit;
    const r = await executeAsOneAirwallexBatch(db, { batches, rail: awx }, batch.proposal_id, { env: ON });
    expect(r).toMatchObject({ outcome: "SUBMITTED", status: "IN_APPROVAL" });
    expect(batches.calls.filter((c) => c === "submitBatch")).toHaveLength(1);
  });

  it("a refusal whose delete answer was lost finishes as refused on the re-run, never as executed", async () => {
    const batch = await signed();
    batches.tamper = (items) => { items[0]!.input.amountCents += 1; };
    const del = batches.deleteBatch.bind(batches);
    batches.deleteBatch = async (id) => { await del(id); throw new Error("network: no answer"); };
    await expect(executeAsOneAirwallexBatch(db, { batches, rail: awx }, batch.proposal_id, { env: ON })).rejects.toThrow(/no answer/);
    batches.deleteBatch = del;
    const r = await executeAsOneAirwallexBatch(db, { batches, rail: awx }, batch.proposal_id, { env: ON });
    expect(r.outcome).toBe("REFUSED");
    expect(row(batch.proposal_id).status).toBe("NEEDS_REAPPROVAL");
    expect(transfers().map((t) => t.status)).toEqual(["CANCELLED", "CANCELLED"]);
    expect(batches.calls).not.toContain("submitBatch");
  });

  it("a batch submitted elsewhere with an item the CFO did not sign is not adopted as executed", async () => {
    const batch = await signed();
    batches.submitBatch = async () => { throw new Error("network: no answer"); };
    await expect(executeAsOneAirwallexBatch(db, { batches, rail: awx }, batch.proposal_id, { env: ON })).rejects.toThrow();
    const b = [...batches.batches.values()][0]!;
    b.items.push({ ...structuredClone(b.items[0]!), id: "bti_x", requestId: "not-signed" });
    b.batch.status = "IN_APPROVAL";
    const r = await executeAsOneAirwallexBatch(db, { batches, rail: awx }, batch.proposal_id, { env: ON });
    expect(r.outcome).toBe("NOT_PAID");
    expect(r.differences.join()).toMatch(/not a line the CFO signed/);
    expect(row(batch.proposal_id).status).toBe("NEEDS_REAPPROVAL");
    expect(transfers().map((t) => t.status)).toEqual(["IN_APPROVAL", "IN_APPROVAL"]);
  });

  it("a rejection seen at submit is not recorded as executed", async () => {
    const batch = await signed();
    const submit = batches.submitBatch.bind(batches);
    batches.submitBatch = async (id) => { const b = await submit(id); batches.decideInWebApp(id, "reject"); return { ...b, status: "APPROVAL_REJECTED" }; };
    const r = await executeAsOneAirwallexBatch(db, { batches, rail: awx }, batch.proposal_id, { env: ON });
    expect(r.outcome).toBe("NOT_PAID");
    expect(row(batch.proposal_id).status).toBe("NEEDS_REAPPROVAL");
  });

  it("checks the EUR floor again on a re-run before anything is submitted", async () => {
    const batch = await signed();
    batches.createBatch = async () => { throw new Error("Airwallex /batch_transfers/create -> 400 validation_error"); };
    await expect(executeAsOneAirwallexBatch(db, { batches, rail: awx }, batch.proposal_id, { env: ON })).rejects.toThrow(/400/);
    setSetting(db, "treasury", "eur_floor", "34000.00");
    await expect(executeAsOneAirwallexBatch(db, { batches, rail: awx }, batch.proposal_id, { env: ON })).rejects.toThrow(/floor/);
    // Its own payout rows are not counted twice: with room for exactly this batch, the re-run goes ahead.
    setSetting(db, "treasury", "eur_floor", "1000.00");
    batches.createBatch = FakeBatchTransfers.prototype.createBatch.bind(batches);
    expect((await executeAsOneAirwallexBatch(db, { batches, rail: awx }, batch.proposal_id, { env: ON })).outcome).toBe("SUBMITTED");
  });

  it("honours an emergency stop set while the batch was being read back: deleted, nothing submitted", async () => {
    const batch = await signed();
    const list = batches.listItems.bind(batches);
    batches.listItems = async (id) => { db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('freeze', 'on', ?)").run(now.toISOString()); return list(id); };
    const r = await executeAsOneAirwallexBatch(db, { batches, rail: awx }, batch.proposal_id, { env: ON });
    expect(r.outcome).toBe("REFUSED");
    expect(r.differences.join()).toMatch(/emergency stop/);
    expect(batches.calls).not.toContain("submitBatch");
  });

  it("closes the payout row of an item Airwallex failed to book, so its invoice is not held for ever", async () => {
    const batch = await signed();
    const r = await executeAsOneAirwallexBatch(db, { batches, rail: awx }, batch.proposal_id, { env: ON });
    batches.decideInWebApp(r.awx_batch_id!, "approve");
    const b = [...batches.batches.values()][0]!;
    b.items[1]!.status = "BOOKING_FAILED"; b.items[1]!.transferId = null; b.batch.status = "PARTIALLY_BOOKED";
    await followAirwallexBatch(db, batches, batch.proposal_id);
    expect(transfers().map((t) => t.status).sort()).toEqual(["CANCELLED", "SCHEDULED"]);
  });
});

describe("the read-back comparison and the REST mapping", () => {
  const line = { proposal_id: "P-0002", terms_sha256: "a".repeat(64), terms: { transfer_request_id: "rq-1", beneficiary_id: "ben-1", amount: "100.00", fee_max: "20.00", reference: "INV-1", invoice_no: "INV-1", reason: "x" } as never };
  const batch = toBatch({ id: "b1", request_id: "r", status: "DRAFTING", total_item_count: 1, valid_item_count: 1, metadata: { approval_sha256: "s".repeat(64) }, quote_summary: { quotes: [{ amount_payer_pays: 113.4, fee_amount: 13.4, fee_currency: "EUR", source_currency: "EUR", transfer_currency: "EUR" }] } });
  const item = toItem({ id: "i1", request_id: "rq-1", status: "VALIDATED", transfer_draft: { beneficiary_id: "ben-1", transfer_amount: 100, transfer_currency: "EUR", source_currency: "EUR", transfer_method: "SWIFT", reference: "INV-1", reason: "x", fee_amount: 13.4, fee_currency: "EUR", amount_payer_pays: 113.4, metadata: { approval_sha256: "a".repeat(64) } } });

  it("agrees when everything matches, to the cent", () => {
    expect(compareReadBack([line], "s".repeat(64), batch, [item])).toEqual([]);
  });

  it("names each difference: payee, fee above its ceiling, a missing draft, the batch hash, the payer's total", () => {
    const d = compareReadBack([line], "t".repeat(64), { ...batch, quotes: [{ ...batch.quotes[0]!, payerPaysCents: 12_001 }] },
      [{ ...item, draft: { ...item.draft!, beneficiaryId: "ben-2", feeCents: 2001, payerPaysCents: 12_001 } }]);
    expect(d.join("\n")).toMatch(/approval hash/);
    expect(d.join("\n")).toMatch(/payee at Airwallex is ben-2, signed ben-1/);
    expect(d.join("\n")).toMatch(/fee EUR 20.01 is above the signed ceiling EUR 20.00/);
    expect(d.join("\n")).toMatch(/payer would pay EUR 120.01, above the signed EUR 120.00/);
    expect(compareReadBack([line], "s".repeat(64), batch, [{ ...item, draft: null }]).join()).toMatch(/no transfer draft/);
  });

  it("does not pass without a fee, a payer total or a quote, nor with a fee in another currency or totals that do not add up", () => {
    const S = "s".repeat(64);
    expect(compareReadBack([line], S, { ...batch, quotes: [] }, [{ ...item, draft: { ...item.draft!, feeCents: null, payerPaysCents: null } }]).join("\n"))
      .toMatch(/no fee[\s\S]*no amount the payer pays[\s\S]*no quote/);
    expect(compareReadBack([line], S, batch, [{ ...item, draft: { ...item.draft!, payerPaysCents: 99_900 } }]).join()).toMatch(/not the amount plus the fee/);
    expect(compareReadBack([line], S, batch, [{ ...item, draft: { ...item.draft!, feeCurrency: "USD" } }]).join()).toMatch(/fee is in USD/);
    expect(compareReadBack([line], S, batch, [{ ...item, draft: { ...item.draft!, reason: "other" } }]).join()).toMatch(/reason at Airwallex/);
    expect(compareReadBack([line], S, { ...batch, quotes: [{ ...batch.quotes[0]!, payerPaysCents: 11_000 }] }, [item]).join()).toMatch(/quote totals EUR 110.00, the items EUR 113.40/);
  });

  it("sends each item with the signed amount as a two-decimal string, a saved payee and its hash in metadata", () => {
    expect(itemBody({ requestId: "rq", beneficiaryId: "b", amountCents: 130_900, currency: "EUR", sourceCurrency: "EUR", method: "SWIFT", reference: "R", reason: "x", metadata: { approval_sha256: "h" } }))
      .toEqual({ request_id: "rq", beneficiary_id: "b", transfer_amount: "1309.00", transfer_currency: "EUR", source_currency: "EUR", transfer_method: "SWIFT", reference: "R", reason: "x", metadata: { approval_sha256: "h" } });
    expect(batchRequestId("a".repeat(64))).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(batchRequestId("a".repeat(64))).toBe(batchRequestId("a".repeat(64)));
  });
});

// Switched on in the flow (13 November): the approved batch's executor picks ONE Airwallex batch by default, with no
// setting in the environment; a host without a batch rail, or a batch whose lines do not all fit, runs line by line.
describe("in the flow: the payment batch executor (src/executors/index.ts)", () => {
  const was = process.env.AIRWALLEX_BATCH_TRANSFER;
  beforeEach(() => { delete process.env.AIRWALLEX_BATCH_TRANSFER; });
  afterEach(() => { if (was === undefined) delete process.env.AIRWALLEX_BATCH_TRANSFER; else process.env.AIRWALLEX_BATCH_TRANSFER = was; });

  it("sends several approved payouts as ONE Airwallex batch, read back and held IN_APPROVAL, by default", async () => {
    const { execute } = await import("../src/executors/index.js");
    const batch = await signed();
    await execute(db, batch.proposal_id, undefined, undefined, { rail: awx, sim: awx, batches });
    expect(batches.batches.size).toBe(1);
    expect(batches.calls.filter((c) => c === "createBatch" || c === "submitBatch")).toEqual(["createBatch", "submitBatch"]);
    expect([...batches.batches.values()][0]!.batch.status).toBe("IN_APPROVAL");
    expect(awx.calls.filter((c) => c.startsWith("createTransfer") || c.startsWith("createPayoutTransfer"))).toEqual([]);
    expect(row(batch.proposal_id).status).toBe("EXECUTED");
  });

  it("runs line by line on a host that holds no batch rail", async () => {
    const { execute } = await import("../src/executors/index.js");
    const batch = await signed();
    await execute(db, batch.proposal_id, undefined, undefined, { rail: awx, sim: awx });
    expect(batches.calls).toEqual([]);
    expect(transfers().filter((t) => t.transfer_id)).toHaveLength(2);
  });
});
