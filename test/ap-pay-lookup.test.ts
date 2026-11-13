// Code review 13 Nov: (4) a paid invoice's payout is found by the request id its signed proposal names, not by the
// invoice number (a number can be corrected after filing, or name another payout); (5) an invoice whose document row is
// gone is refused with that reason, and the early Payer logs it rather than dropping it silently.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { seedTreasury } from "../src/agents/euroBill.js";
import { paymentEntries } from "../src/ap/books.js";
import { ingestDocument, type InboxDeps } from "../src/ap/inbox.js";
import { earlyPayer, payApInvoice, syncPayments } from "../src/ap/pay.js";
import type { Asker } from "../src/ap/read.js";
import { apInvoice } from "../src/ap/store.js";
import { openDb, type DB } from "../src/db/open.js";
import { executeInvoicePayment } from "../src/executors/invoicePayment.js";
import { decide } from "../src/policy/approvals.js";
import { EN } from "./fakes/apInvoices.js";
import { FakeAirwallex } from "./fakes/airwallex.js";
import { pdfOf } from "./fakes/pdf.js";

const now = new Date();
const parserOnly: Asker = { ask: async (_a, fallback) => ({ value: fallback(), source: "fallback", model: null, note: "no key" }) } as Asker;

let dir: string;
let db: DB;
let awx: FakeAirwallex;
let deps: InboxDeps;
beforeEach(async () => {
  dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "ap-pay-lookup-"));
  db = openDb(":memory:");
  awx = new FakeAirwallex();
  await seedTreasury(db, awx, awx);
  deps = { dir, reader: parserOnly, now: () => now };
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const add = async (text: string, name: string): Promise<string> => {
  const out = await ingestDocument(db, deps, { bytes: await pdfOf(text), filename: name, source: "upload" });
  if (out.kind !== "invoice") throw new Error(out.kind);
  return out.invoice.id;
};

describe("a paid invoice's payout is found by its proposal's request id", () => {
  it("books the payment even when the invoice's number was corrected after it was filed", async () => {
    const id = await add(EN, "en.pdf");
    const out = await payApInvoice(db, awx, id, now);
    if (out.kind !== "proposed") throw new Error(out.reason);
    const pid = out.proposal.proposal_id;
    const p = db.prepare("SELECT terms_sha256, json_extract(terms_json, '$.transfer_request_id') AS request_id FROM proposals WHERE proposal_id = ?").get(pid) as { terms_sha256: string; request_id: string };
    decide(db, { proposalId: pid, decision: "APPROVED", typedPrefix: p.terms_sha256.slice(0, 8), approver: "cfo", method: "cli" }, now);
    await executeInvoicePayment(db, awx, awx, pid);
    expect(db.prepare("SELECT status FROM transfers WHERE request_id = ?").get(p.request_id)).toEqual({ status: "PAID" });
    // A person corrects the number on the row after filing: the payout's own row still names the number it was paid under.
    db.prepare("UPDATE ap_invoices SET invoice_no = ? WHERE id = ?").run("BTX-2026-21A", id);
    await syncPayments(db, deps);
    const inv = apInvoice(db, id)!;
    expect(inv.status).toBe("paid");
    const es = paymentEntries(db, inv);
    expect(es.filter((e) => e.account === "2100").map((e) => e.debit)).toEqual(["1850.00"]);
  });
});

describe("an invoice whose document row is missing", () => {
  it("is refused with that reason, and the early Payer logs it", async () => {
    const id = await add(EN, "en.pdf");
    // A row lost outside the app (a restore without it): the foreign key is off for the delete only.
    db.pragma("foreign_keys = OFF");
    db.prepare("DELETE FROM ap_documents WHERE sha256 = ?").run(apInvoice(db, id)!.doc_sha256);
    db.pragma("foreign_keys = ON");
    await expect(payApInvoice(db, awx, id, now)).rejects.toThrow(`${id}: its document is missing`);
    const logged: string[] = [];
    expect(await earlyPayer(db, awx, id, now, {} as Anthropic, (l) => logged.push(l))).toBeNull();
    expect(logged).toEqual([`early Payer for ${id}: ${id}: its document is missing`]);
  });
});
