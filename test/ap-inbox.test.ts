// Payables, parts 1 and 2: every way in (upload, folder, e-mail, API) goes through one entry point; the document is
// kept once, unchanged, by its hash; the invoice is read (Claude when its reading checks out, else the parser) and
// checked; and it lands as ready, waiting for a new supplier, blocked or needing a person, with the reasons.
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ibanSha } from "../src/agents/invoice.js";
import { ingestDocument, ingestEmail, type InboxDeps } from "../src/ap/inbox.js";
import { parseEml } from "../src/ap/eml.js";
import { apInvoice, apInvoices } from "../src/ap/store.js";
import type { Asker } from "../src/ap/read.js";
import { openDb, type DB } from "../src/db/open.js";
import { DE, EN, NL } from "./fakes/apInvoices.js";
import { emlWith, pdfOf, scanPdf } from "./fakes/pdf.js";

const now = new Date("2026-11-08T10:00:00Z");
const BERGTEX_IBAN = "DE89370400440532013000";
const parserOnly: Asker = { ask: async (_a, fallback) => ({ value: fallback(), source: "fallback", model: null, note: "no key" }) } as Asker;

let dir: string;
let db: DB;
let deps: InboxDeps;
beforeEach(() => {
  dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "ap-"));
  db = openDb(":memory:");
  db.prepare("INSERT INTO beneficiaries (beneficiary_id, name, iban_last4, iban_sha256, bic, currency, method) VALUES ('ben_bergtex', 'Bergtex Textil GmbH', ?, ?, 'COBADEFFXXX', 'EUR', 'SWIFT')")
    .run(BERGTEX_IBAN.slice(-4), ibanSha(BERGTEX_IBAN));
  deps = { dir, reader: parserOnly, now: () => now };
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const add = async (text: string, filename = "invoice.pdf", source: "upload" | "folder" | "api" = "upload") =>
  ingestDocument(db, deps, { bytes: await pdfOf(text), filename, source });
const codes = (id: string) => apInvoice(db, id)!.findings.map((f) => f.code);

describe("the inbox", () => {
  it("keeps the PDF once, unchanged, by its hash, and reads a known supplier's invoice as ready", async () => {
    const out = await add(EN);
    expect(out).toMatchObject({ kind: "invoice", invoice: { id: "AP-0001", status: "ready", vendor: "Bergtex Textil GmbH", invoice_no: "BTX-2026-21", total: "1850.00", currency: "EUR" } });
    const doc = db.prepare("SELECT * FROM ap_documents").get() as { sha256: string; path: string; source: string; mime: string };
    expect(doc).toMatchObject({ source: "upload", mime: "application/pdf" });
    expect(existsSync(doc.path)).toBe(true);
    expect(doc.path).toBe(join(dir, "docs", `${doc.sha256}.pdf`));
    const inv = apInvoice(db, "AP-0001")!;
    expect(inv).toMatchObject({ read_by: "parser", gl_account: "6200", cost_centre: "CC300", iban_last4: "3000" });
    expect(db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE event = 'ap.received'").get()).toEqual({ n: 1 });
  });

  it("recognises the same file a second time and makes no second invoice", async () => {
    const pdf = await pdfOf(EN);
    await ingestDocument(db, deps, { bytes: pdf, filename: "a.pdf", source: "upload" });
    const again = await ingestDocument(db, deps, { bytes: pdf, filename: "copy.pdf", source: "folder" });
    expect(again).toMatchObject({ kind: "duplicate_document", invoice_id: "AP-0001" });
    expect(apInvoices(db)).toHaveLength(1);
  });

  it("blocks a second copy of the same invoice in another file (a reminder is never paid twice)", async () => {
    await add(EN);
    const out = await add(`${EN}\nReminder: this invoice is still open.`, "reminder.pdf");
    expect(out).toMatchObject({ kind: "invoice", invoice: { id: "AP-0002", status: "blocked" } });
    expect(codes("AP-0002")).toContain("duplicate");
  });

  it("holds an invoice from a supplier not on file until the supplier is verified", async () => {
    const out = await add(NL);
    expect(out).toMatchObject({ invoice: { status: "needs_vendor", vendor: "Zeeland Verpakkingen B.V." } });
    expect(apInvoice(db, "AP-0001")!.findings.find((f) => f.code === "new_supplier")?.detail).toMatch(/not on file/);
  });

  it("blocks a known supplier's invoice that asks for other bank details: possible fraud", async () => {
    const out = await add(EN.replace("DE89 3704 0044 0532 0130 00", "DE02 1203 0000 0000 2020 51"));
    expect(out).toMatchObject({ invoice: { status: "blocked" } });
    expect(codes("AP-0001")).toContain("possible_fraud");
  });

  it("blocks an invoice whose subtotal and tax do not add up to the total", async () => {
    await add(EN.replace("VAT 19% EUR 295.38", "VAT 19% EUR 295.00"));
    expect(apInvoice(db, "AP-0001")).toMatchObject({ status: "blocked" });
    expect(codes("AP-0001")).toContain("sum_mismatch");
  });

  it("blocks an IBAN whose checksum is wrong", async () => {
    await add(EN.replace("DE89 3704 0044 0532 0130 00", "DE89 3704 0044 0532 0130 01"));
    expect(codes("AP-0001")).toContain("iban_invalid");
    expect(apInvoice(db, "AP-0001")!.status).toBe("blocked");
  });

  it("keeps a scan with no text and asks a person", async () => {
    const out = await ingestDocument(db, deps, { bytes: await scanPdf(), filename: "scan.pdf", source: "upload" });
    expect(out).toMatchObject({ invoice: { status: "needs_review" } });
    expect(apInvoice(db, "AP-0001")!.findings[0]!.detail).toMatch(/no text/);
  });

  it("asks a person for an invoice in a currency Purser does not pay yet", async () => {
    await add(DE.replace(/EUR/g, "CHF"));
    expect(apInvoice(db, "AP-0001")!.status).toBe("needs_review");
    expect(codes("AP-0001")).toContain("currency_not_paid");
  });

  it("warns when a supplier's invoice is far above its usual, and when the due date has passed", async () => {
    for (const [no, amt] of [["BTX-1", "1,850.00"], ["BTX-2", "1,850.00"]] as const) {
      await add(EN.replace(/BTX-2026-21/g, no).replace("Subtotal EUR 1,554.62\nVAT 19% EUR 295.38\n", "").replace("1,850.00", amt), `${no}.pdf`);
    }
    await add(EN.replace(/BTX-2026-21/g, "BTX-3").replace("Subtotal EUR 1,554.62\nVAT 19% EUR 295.38\n", "").replace("1,850.00", "9,250.00").replace("16 November 2026", "1 November 2026"), "BTX-3.pdf");
    const inv = apInvoice(db, "AP-0003")!;
    expect(inv.status).toBe("ready");
    expect(inv.findings.map((f) => [f.code, f.level])).toEqual(expect.arrayContaining([["unusual_amount", "warn"], ["overdue", "warn"]]));
  });

  it("refuses a file that is neither a PDF nor an e-mail", async () => {
    await expect(ingestDocument(db, deps, { bytes: Buffer.from("hello"), filename: "notes.txt", source: "upload" })).rejects.toThrow(/PDF/);
    expect(apInvoices(db)).toHaveLength(0);
  });
});

describe("reading with Claude", () => {
  it("uses Claude's reading when its number, total and IBAN are in the document, and takes its expense account from the chart", async () => {
    deps.reader = { ask: async (_a, fallback) => ({ value: { ...(fallback() as object), vendor: "Zeeland Verpakkingen B.V.", gl_account: "6100" }, source: "claude", model: "claude-sonnet-5-5" }) } as Asker;
    await add(NL);
    expect(apInvoice(db, "AP-0001")).toMatchObject({ read_by: "claude:claude-sonnet-5-5", gl_account: "6100", gl_rule: "suggested by Claude, from the chart" });
  });

  it("does not use a reading that names another IBAN (a planted instruction), and records why", async () => {
    deps.reader = { ask: async (_a, fallback) => ({ value: { ...(fallback() as object), iban: "GB29NWBK60161331926819" }, source: "claude", model: "claude-sonnet-5-5" }) } as Asker;
    await add(NL);
    expect(apInvoice(db, "AP-0001")).toMatchObject({ read_by: "parser" });
    expect(db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE event = 'ap.reading_not_used'").get()).toEqual({ n: 1 });
  });

  it("refuses an expense account that is not in the chart", async () => {
    deps.reader = { ask: async (_a, fallback) => ({ value: { ...(fallback() as object), gl_account: "1200" }, source: "claude", model: "claude-sonnet-5-5" }) } as Asker;
    await add(NL);
    expect(apInvoice(db, "AP-0001")).toMatchObject({ gl_account: "6900", gl_rule: "default for supplier invoices" });
  });
});

describe("e-mail", () => {
  it("takes the PDF out of an e-mail and files it with the sender and subject", async () => {
    const raw = emlWith(await pdfOf(EN), "BTX-2026-21.pdf");
    expect(parseEml(raw)).toMatchObject({ from: "Accounts <accounts@supplier.example>", subject: "Invoice", attachments: [{ filename: "BTX-2026-21.pdf", mime: "application/pdf" }] });
    const out = await ingestEmail(db, deps, raw, { mailbox: "payables" });
    expect(out).toEqual([expect.objectContaining({ kind: "invoice", invoice: expect.objectContaining({ status: "ready" }) })]);
    const meta = JSON.parse((db.prepare("SELECT meta_json FROM ap_documents").get() as { meta_json: string }).meta_json);
    expect(meta).toMatchObject({ from: "Accounts <accounts@supplier.example>", subject: "Invoice", mailbox: "payables" });
    expect((db.prepare("SELECT source FROM ap_documents").get() as { source: string }).source).toBe("email");
  });

  it("an .eml file dropped in goes the same way", async () => {
    const out = await ingestDocument(db, deps, { bytes: emlWith(await pdfOf(NL)), filename: "mail.eml", source: "folder" });
    expect(out).toMatchObject({ kind: "email", results: [{ kind: "invoice", invoice: { status: "needs_vendor" } }] });
  });

  it("an e-mail with no PDF attached files nothing and says so", async () => {
    const raw = Buffer.from("From: a@b.example\r\nSubject: hi\r\nContent-Type: text/plain\r\n\r\nno attachment");
    expect(parseEml(raw).attachments).toEqual([]);
    expect(await ingestEmail(db, deps, raw)).toEqual([]);
  });

  it("the stored PDF is byte for byte the attachment", async () => {
    const pdf = await pdfOf(EN);
    await ingestEmail(db, deps, emlWith(pdf));
    const doc = db.prepare("SELECT path FROM ap_documents").get() as { path: string };
    expect(readFileSync(doc.path).equals(pdf)).toBe(true);
  });
});
