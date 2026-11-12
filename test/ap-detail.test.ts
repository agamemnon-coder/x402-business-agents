// Payables detail view: one invoice as the CFO reads it on its own page (src/ap/detail.ts): every check with its
// result in plain words, the timeline from the audit log, the supplier's own total line, and which actions are open
// and why not. And rejecting an invoice from the page (src/ap/pay.ts rejectApInvoice): never one that is paid or waiting
// for the CFO, always with a reason, and the accrual a sink holds is taken back.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { seedTreasury } from "../src/agents/euroBill.js";
import type { ApEntry, BookkeepingSink } from "../src/ap/books.js";
import { CHECKS, checkRows, invoiceDetail } from "../src/ap/detail.js";
import { ingestDocument, type InboxDeps } from "../src/ap/inbox.js";
import { payApInvoice, rejectApInvoice } from "../src/ap/pay.js";
import type { Asker } from "../src/ap/read.js";
import { apInvoice } from "../src/ap/store.js";
import { openDb, type DB } from "../src/db/open.js";
import { DE, EN } from "./fakes/apInvoices.js";
import { FakeAirwallex } from "./fakes/airwallex.js";
import { pdfOf } from "./fakes/pdf.js";

const now = new Date();
const parserOnly: Asker = { ask: async (_a, fallback) => ({ value: fallback(), source: "fallback", model: null, note: "no key" }) } as Asker;

class MemSink implements BookkeepingSink {
  readonly name = "mem";
  entries: ApEntry[] = [];
  push(e: ApEntry[]) { this.entries.push(...e); }
}

let dir: string;
let db: DB;
let awx: FakeAirwallex;
let deps: InboxDeps;
let sink: MemSink;
beforeEach(async () => {
  dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "ap-detail-"));
  db = openDb(":memory:");
  awx = new FakeAirwallex();
  await seedTreasury(db, awx, awx);
  sink = new MemSink();
  deps = { dir, reader: parserOnly, now: () => now, sink };
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const add = async (text: string, name = "invoice.pdf") => {
  const out = await ingestDocument(db, deps, { bytes: await pdfOf(text), filename: name, source: "upload" });
  if (out.kind !== "invoice") throw new Error(out.kind);
  return out.invoice.id;
};

describe("an invoice's detail", () => {
  it("lists every check as passed for a clean invoice, with the total line and an open Pay", async () => {
    const id = await add(EN, "Bergtex BTX-2026-21.pdf");
    const d = await invoiceDetail(db, id);
    expect(d).not.toBeNull();
    expect(d!.checks.map((c) => c.key)).toEqual(CHECKS.map((c) => c.key));
    expect(d!.checks.every((c) => c.result === "passed")).toBe(true);
    expect(d!.total_line).toMatch(/Total due EUR 1,850\.00/);
    expect(d!.document).toMatchObject({ filename: "Bergtex BTX-2026-21.pdf", source: "upload" });
    expect(d!.actions.pay).toEqual({ allowed: true, why: "", code: "", vars: {} });
    expect(d!.actions.supplier_request.allowed).toBe(false);
    expect(d!.actions.reject.allowed).toBe(true);
    // The account stays masked on the page as on the list.
    expect(JSON.stringify(d)).not.toContain("DE89370400440532013000");
  });

  it("shows the failing check with its level and the code's own reason", async () => {
    const id = await add(DE);
    const d = (await invoiceDetail(db, id))!;
    const supplier = d.checks.find((c) => c.key === "supplier")!;
    expect(supplier.result).toBe("wait");
    expect(supplier.reasons.join(" ")).toMatch(/not on file|new supplier/i);
    expect(d.actions.pay.allowed).toBe(false);
    expect(d.actions.pay.why).toMatch(/new supplier/i);
    expect(d.actions.supplier_request.allowed).toBe(true);
  });

  it("tells a timeline from the audit log: received, checked, filed for the CFO", async () => {
    const id = await add(EN);
    await payApInvoice(db, awx, id, now);
    const d = (await invoiceDetail(db, id))!;
    expect(d.timeline.map((t) => t.what)).toEqual(["Received", "Checked: Ready to pay", "Waits for the CFO's Face ID", "Note written"]);
    expect(d.timeline.at(-1)!.detail).toBe("by Purser's code");
    expect(d.timeline[0]!.detail).toMatch(/upload/);
    expect(d.timeline.every((t) => /^\d{4}-\d{2}-\d{2}T/.test(t.at))).toBe(true);
    expect(d.actions.pay.allowed).toBe(false);
    expect(d.actions.reject.allowed).toBe(false);
    expect(d.actions.reject.why).toMatch(/phone/);
  });

  it("fails the check a fraud signal belongs to, with that signal's own reason (not only the fraud check)", () => {
    const rows = checkRows([{ code: "possible_fraud", level: "block", detail: "possible invoice fraud: the invoice asks for IBAN …4780; on file: IBAN …3000. Nothing is paid",
      signals: [{ code: "bank_details_changed", detail: "the invoice asks for IBAN …4780; on file: IBAN …3000" }] }], "invoice");
    expect(rows.find((r) => r.key === "fraud")).toMatchObject({ result: "block" });
    expect(rows.find((r) => r.key === "bank")).toMatchObject({ result: "block", reasons: ["the invoice asks for IBAN …4780; on file: IBAN …3000"] });
    expect(rows.find((r) => r.key === "supplier")!.result).toBe("passed");
  });

  it("marks the checks a document that is not an invoice never reached as not checked", () => {
    const rows = checkRows([{ code: "not_an_invoice", level: "review", detail: "a delivery note" }], "other");
    expect(rows[0]).toMatchObject({ key: "document", result: "review" });
    expect(rows.slice(1).every((r) => r.result === "not_checked")).toBe(true);
  });

  it("is null for an invoice that does not exist", async () => {
    expect(await invoiceDetail(db, "AP-9999")).toBeNull();
  });
});

describe("rejecting from the page", () => {
  it("rejects a ready invoice with a reason, says so in the timeline, and takes the accrual back in the sink", async () => {
    const id = await add(EN);
    expect(sink.entries.some((e) => e.event === "accrual")).toBe(true);
    const out = await rejectApInvoice(db, id, "  ordered twice; the supplier sends a credit note  ", deps, now);
    expect(out.status).toBe("rejected");
    expect(sink.entries.filter((e) => e.event === "reversal").length).toBeGreaterThan(0);
    const d = (await invoiceDetail(db, id))!;
    expect(d.timeline.at(-1)).toMatchObject({ what: "Rejected", detail: expect.stringContaining("ordered twice") });
    expect(d.actions.reject.allowed).toBe(false);
    await expect(payApInvoice(db, awx, id, now)).rejects.toThrow(/not ready/);
  });

  it("needs a reason, and never touches an invoice that waits for the CFO or is paid", async () => {
    const id = await add(EN);
    await expect(rejectApInvoice(db, id, "   ", deps, now)).rejects.toThrow(/say why/);
    await payApInvoice(db, awx, id, now);
    await expect(rejectApInvoice(db, id, "changed my mind", deps, now)).rejects.toThrow(/waits for the CFO/);
    expect(apInvoice(db, id)!.status).toBe("waiting_cfo");
    await expect(rejectApInvoice(db, "AP-9999", "x", deps, now)).rejects.toThrow(/no payables invoice/);
  });
});
