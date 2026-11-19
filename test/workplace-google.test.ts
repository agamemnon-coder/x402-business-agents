// The Google workplace integrations (src/workplace/gmail.ts, gdrive.ts, sheets.ts) against a local mock of Google's REST
// APIs, with request shapes from the official references: Gmail v1 users.messages.list / get / attachments.get, Drive v3
// files.list / files.get?alt=media, Sheets v4 spreadsheets.values.get / append. What they fetch goes through Purser's
// own inbox (src/ap/inbox.ts) unchanged. No network: the mock answers in this process. Built and tested against a mock;
// needs the owner's OAuth app to run live.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { InboxDeps } from "../src/ap/inbox.js";
import type { Asker } from "../src/ap/read.js";
import { openDb, type DB } from "../src/db/open.js";
import { pollDriveFolder, driveFolderQuery } from "../src/workplace/gdrive.js";
import { gmailQueryFromEnv, pollGmail } from "../src/workplace/gmail.js";
import { WorkplaceError } from "../src/workplace/http.js";
import { deliverToInbox } from "../src/workplace/inbox.js";
import { a1, appendNewRows, exportToSheets, JOURNAL_HEADER, PAID_HEADER, paidRows } from "../src/workplace/sheets.js";
import { readUbl } from "../src/workplace/ubl.js";
import { EN, NL } from "./fakes/apInvoices.js";
import { pdfOf } from "./fakes/pdf.js";
import { b64url, MockApi, ublInvoice } from "./fakes/workplace.js";

const parserOnly: Asker = { ask: async (_a, fallback) => ({ value: fallback(), source: "fallback", model: null, note: "no key" }) } as Asker;
const token = async () => "test-access-token";
let dir: string;
let db: DB;
let deps: InboxDeps;
beforeEach(() => {
  dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "workplace-"));
  db = openDb(":memory:");
  deps = { dir, reader: parserOnly, now: () => new Date("2026-11-19T09:00:00Z") };
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const docMeta = () => (db.prepare("SELECT source, meta_json FROM ap_documents").all() as { source: string; meta_json: string }[]).map((r) => ({ source: r.source, meta: JSON.parse(r.meta_json) as Record<string, string> }));

/** Gmail as its reference shows it: a message with a multipart/mixed payload, a text part and a PDF attachment part. */
function gmail(pdf: Uint8Array, o: { attachmentSize?: number; extraParts?: unknown[] } = {}) {
  const api = new MockApi("https://gmail.googleapis.com");
  api.on("GET", /\/gmail\/v1\/users\/me\/messages/, () => ({ json: { messages: [{ id: "18c2f0a1b2c3d4e5", threadId: "18c2f0a1b2c3d4e5" }], resultSizeEstimate: 1 } }));
  api.on("GET", /\/gmail\/v1\/users\/me\/messages\/18c2f0a1b2c3d4e5/, () => ({ json: {
    id: "18c2f0a1b2c3d4e5", threadId: "18c2f0a1b2c3d4e5", labelIds: ["Label_7", "INBOX"], internalDate: "1793606400000",
    payload: {
      partId: "", mimeType: "multipart/mixed", filename: "",
      headers: [{ name: "From", value: "Accounts <accounts@bergtex.example>" }, { name: "Subject", value: "Invoice BTX-2026-21" }, { name: "Date", value: "Mon, 02 Nov 2026 09:00:00 +0100" }, { name: "Message-ID", value: "<btx-21@bergtex.example>" }],
      body: { size: 0 },
      parts: [
        { partId: "0", mimeType: "text/plain", filename: "", headers: [], body: { size: 33, data: b64url(Buffer.from("Please find our invoice attached.")) } },
        { partId: "1", mimeType: "application/pdf", filename: "BTX-2026-21.pdf", headers: [], body: { attachmentId: "ANGjdJ8-att_1", size: o.attachmentSize ?? pdf.length } },
        ...(o.extraParts ?? []),
      ],
    },
  } }));
  api.on("GET", /\/gmail\/v1\/users\/me\/messages\/18c2f0a1b2c3d4e5\/attachments\/ANGjdJ8-att_1/, () => ({ json: { size: pdf.length, data: b64url(pdf) } }));
  return api;
}

describe("Gmail inbox (gmail.readonly)", () => {
  it("lists by the owner's query, reads the message, fetches the PDF and files it through the inbox", async () => {
    const pdf = await pdfOf(EN);
    const api = gmail(pdf);
    const polled = await pollGmail({ token, query: "label:invoices has:attachment", fetch: api.fetch, maxMessages: 10 });

    const list = api.to("GET", /\/messages$/)[0]!;
    expect(list.url.searchParams.get("q")).toBe("label:invoices has:attachment");
    expect(list.url.searchParams.get("maxResults")).toBe("10");
    expect(list.headers.authorization).toBe("Bearer test-access-token");
    expect(api.to("GET", /\/messages\/18c2f0a1b2c3d4e5$/)[0]!.url.searchParams.get("format")).toBe("full");
    expect(api.calls.every((c) => c.method === "GET")).toBe(true);
    expect(polled.files).toHaveLength(1);
    expect(Buffer.compare(Buffer.from(polled.files[0]!.bytes), pdf)).toBe(0);

    const delivered = await deliverToInbox(db, deps, polled.files);
    expect(delivered[0]).toMatchObject({ outcome: "filed", result: { kind: "invoice" } });
    const r = delivered[0]!.outcome === "filed" ? delivered[0]!.result : null;
    expect(r?.kind === "invoice" && r.invoice.invoice_no).toBe("BTX-2026-21");
    expect(docMeta()[0]).toMatchObject({ source: "email", meta: { via: "gmail", from: "Accounts <accounts@bergtex.example>", subject: "Invoice BTX-2026-21", message_id: "<btx-21@bergtex.example>" } });

    // The same message polled again is the same document: the inbox knows it by its hash.
    const again = await deliverToInbox(db, deps, (await pollGmail({ token, query: "label:invoices", fetch: api.fetch })).files);
    expect(again[0]).toMatchObject({ outcome: "filed", result: { kind: "duplicate_document" } });
  });

  it("filters by label ids, and takes the query from the environment", async () => {
    const api = gmail(await pdfOf(EN));
    await pollGmail({ token, labelIds: ["Label_7"], fetch: api.fetch });
    expect(api.to("GET", /\/messages$/)[0]!.url.searchParams.getAll("labelIds")).toEqual(["Label_7"]);
    expect(gmailQueryFromEnv({ PURSER_GMAIL_LABEL: "invoices" })).toBe("label:invoices has:attachment");
    expect(gmailQueryFromEnv({ PURSER_GMAIL_QUERY: "from:billing@x.example" })).toBe("from:billing@x.example");
    expect(() => gmailQueryFromEnv({})).toThrow(/PURSER_GMAIL_LABEL is not set/);
  });

  it("never fetches an attachment above the cap, or one that is not an invoice type", async () => {
    const api = gmail(await pdfOf(EN), { attachmentSize: 40 * 1024 * 1024, extraParts: [{ partId: "2", mimeType: "application/zip", filename: "all.zip", body: { attachmentId: "ZIP_1", size: 10 } }] });
    const polled = await pollGmail({ token, query: "x", fetch: api.fetch });
    expect(polled.files).toEqual([]);
    expect(polled.skipped.map((s) => s.reason)).toEqual([expect.stringMatching(/above the cap/), expect.stringMatching(/not an invoice type/)]);
    expect(api.to("GET", /\/attachments\//)).toEqual([]);
  });

  it("refuses an answer that is not Gmail's documented shape, and a message id that is not an id", async () => {
    const bad = new MockApi("https://gmail.googleapis.com").on("GET", /\/gmail\/v1\/users\/me\/messages/, () => ({ json: { messages: [{ id: 42 }] } }));
    await expect(pollGmail({ token, query: "x", fetch: bad.fetch })).rejects.toThrow(/not the documented shape \(messages\.0\.id/);
    const odd = new MockApi("https://gmail.googleapis.com").on("GET", /\/gmail\/v1\/users\/me\/messages/, () => ({ json: { messages: [{ id: "../../drive" }] } }));
    await expect(pollGmail({ token, query: "x", fetch: odd.fetch })).rejects.toThrow(/not a well-formed id/);
    const denied = new MockApi("https://gmail.googleapis.com").on("GET", /\/gmail\/v1\/users\/me\/messages/, () => ({ status: 403, json: { error: { code: 403, message: "Request had insufficient authentication scopes.", status: "PERMISSION_DENIED" } } }));
    const e = await pollGmail({ token, query: "secret-search", fetch: denied.fetch }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(WorkplaceError);
    expect((e as WorkplaceError).kind).toBe("auth");
    expect(String(e)).not.toContain("secret-search");
    expect(String(e)).not.toContain("test-access-token");
  });
});

/** Drive v3 files.list as its reference shows it, and files.get?alt=media with each file's bytes. */
function drive(files: { id: string; name: string; mimeType: string; bytes: Uint8Array; size?: number }[]) {
  const api = new MockApi("https://www.googleapis.com");
  api.on("GET", /\/drive\/v3\/files/, () => ({ json: { files: files.map((f) => ({ id: f.id, name: f.name, mimeType: f.mimeType, size: String(f.size ?? f.bytes.length), modifiedTime: "2026-11-18T10:00:00.000Z" })) } }));
  api.on("GET", /\/drive\/v3\/files\/([A-Za-z0-9_-]+)/, (_req, m) => ({ bytes: files.find((f) => f.id === m[1])!.bytes }));
  return api;
}
const FOLDER = "1AbCdEfGhIjKlMnOpQrStUvWxYz012345";

describe("Drive watched folder (drive.readonly)", () => {
  it("lists the folder's invoice files with the documented query and files PDFs and UBL invoices through the inbox", async () => {
    const pdf = await pdfOf(EN);
    const ublPdf = await pdfOf(NL);
    const api = drive([
      { id: "file_pdf_1", name: "BTX-2026-21.pdf", mimeType: "application/pdf", bytes: pdf },
      { id: "file_ubl_1", name: "ZV-4471.xml", mimeType: "application/xml", bytes: ublInvoice({ id: "ZV-4471", supplier: "Zeeland Verpakkingen B.V.", payable: "484.00", pdf: ublPdf }) },
      { id: "file_ubl_2", name: "no-pdf.xml", mimeType: "text/xml", bytes: ublInvoice({ id: "X-1", supplier: "Nobody B.V.", payable: "1.00" }) },
    ]);
    const polled = await pollDriveFolder({ token, folderId: FOLDER, fetch: api.fetch });

    const list = api.to("GET", /\/drive\/v3\/files$/)[0]!;
    expect(list.url.searchParams.get("q")).toBe(driveFolderQuery(FOLDER));
    expect(list.url.searchParams.get("q")).toContain(`'${FOLDER}' in parents and trashed = false and (mimeType = 'application/pdf'`);
    expect(list.url.searchParams.get("fields")).toBe("nextPageToken,files(id,name,mimeType,size,modifiedTime)");
    expect(list.url.searchParams.get("supportsAllDrives")).toBe("true");
    expect(api.to("GET", /\/drive\/v3\/files\/file_pdf_1$/)[0]!.url.searchParams.get("alt")).toBe("media");
    expect(api.calls.every((c) => c.method === "GET")).toBe(true);

    const delivered = await deliverToInbox(db, deps, polled.files);
    expect(delivered.map((d) => d.outcome)).toEqual(["filed", "filed", "refused"]);
    const nos = (db.prepare("SELECT invoice_no FROM ap_invoices ORDER BY id").all() as { invoice_no: string }[]).map((r) => r.invoice_no);
    expect(nos).toEqual(["BTX-2026-21", "ZV-4471"]);
    // The UBL's own figures ride along as labelled metadata; the PDF inside it is what was read and checked.
    expect(docMeta()[1]).toMatchObject({ source: "folder", meta: { via: "gdrive", ubl_id: "ZV-4471", ubl_supplier: "Zeeland Verpakkingen B.V.", ubl_payable: "EUR 484.00" } });
    expect(delivered[2]).toMatchObject({ reason: expect.stringMatching(/no PDF embedded/) });
    expect((db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE event = 'workplace.file_refused'").get() as { n: number }).n).toBe(1);
  });

  it("narrows to files changed since the last poll, and refuses a folder id that is not one", () => {
    expect(driveFolderQuery(FOLDER, "2026-11-18T00:00:00Z")).toMatch(/and modifiedTime > '2026-11-18T00:00:00.000Z'$/);
    expect(() => driveFolderQuery("x' or trashed = true or '")).toThrow(/not a well-formed id/);
  });

  it("does not fetch a file above the cap", async () => {
    const api = drive([{ id: "big_1", name: "big.pdf", mimeType: "application/pdf", bytes: new Uint8Array(10), size: 99 * 1024 * 1024 }]);
    const polled = await pollDriveFolder({ token, folderId: FOLDER, fetch: api.fetch });
    expect(polled.skipped[0]!.reason).toMatch(/above the cap/);
    expect(api.to("GET", /\/files\/big_1$/)).toEqual([]);
  });

  it("stops reading a download that passes the cap, even when its size was not declared", async () => {
    const api = drive([{ id: "liar_1", name: "liar.pdf", mimeType: "application/pdf", bytes: new Uint8Array(4096), size: 10 }]);
    const polled = await pollDriveFolder({ token, folderId: FOLDER, fetch: api.fetch, maxBytes: 1024 });
    expect(polled.files).toEqual([]);
    expect(polled.skipped[0]!.reason).toMatch(/cap of 1024/);
  });
});

describe("UBL invoices", () => {
  it("refuses a DOCTYPE or an entity declaration unread", () => {
    const xxe = Buffer.from(`<?xml version="1.0"?><!DOCTYPE Invoice [<!ENTITY x SYSTEM "file:///etc/passwd">]><Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"><cbc:ID>&x;</cbc:ID></Invoice>`);
    expect(() => readUbl(xxe)).toThrow(/DOCTYPE or an entity/);
  });

  it("refuses a root outside the UBL namespace, and an embedded 'PDF' that is not one", async () => {
    expect(() => readUbl(Buffer.from(`<Invoice xmlns="urn:example:not-ubl"><ID>1</ID></Invoice>`))).toThrow(/UBL namespace/);
    const fake = ublInvoice({ id: "F-1", supplier: "S", payable: "1.00", pdf: new Uint8Array(Buffer.from("MZ not a pdf at all")) });
    expect(() => readUbl(fake)).toThrow(/is not a PDF/);
    const credit = readUbl(ublInvoice({ id: "CN-1", supplier: "S & Co", payable: "-1.00", root: "CreditNote", pdf: await pdfOf(EN) }));
    expect(credit).toMatchObject({ kind: "CreditNote", id: "CN-1", supplier: "S & Co", pdf: { filename: "CN-1.pdf" } });
  });
});

/** Sheets v4 values.get and values.append as the reference shows them, over an in-memory sheet. */
function sheets() {
  const tabs = new Map<string, string[][]>();
  const api = new MockApi("https://sheets.googleapis.com");
  const tab = (range: string) => /^'((?:[^']|'')+)'!/.exec(range)![1]!.replace(/''/g, "'");
  api.on("GET", /\/v4\/spreadsheets\/([A-Za-z0-9_-]+)\/values\/(.+)/, (_req, m) => {
    const rows = tabs.get(tab(m[2]!)) ?? [];
    return { json: { range: m[2], majorDimension: "COLUMNS", ...(rows.length ? { values: [rows.map((r) => r[0]!)] } : {}) } };
  });
  api.on("POST", /\/v4\/spreadsheets\/([A-Za-z0-9_-]+)\/values\/(.+):append/, (req, m) => {
    const body = JSON.parse(req.body!) as { values: string[][] };
    const name = tab(m[2]!);
    tabs.set(name, [...(tabs.get(name) ?? []), ...body.values]);
    return { json: { spreadsheetId: m[1], tableRange: `'${name}'!A1:Q1`, updates: { spreadsheetId: m[1], updatedRange: m[2], updatedRows: body.values.length, updatedColumns: 17, updatedCells: body.values.length * 17 } } };
  });
  return { api, tabs };
}
const SHEET = "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms";

describe("Sheets export (spreadsheets, the one Google scope that writes)", () => {
  it("appends the journal with RAW input and a header once; a second export appends nothing", async () => {
    const { api, tabs } = sheets();
    const { ingestDocument } = await import("../src/ap/inbox.js");
    await ingestDocument(db, deps, { bytes: await pdfOf(NL), filename: "zv.pdf", source: "upload" });
    const first = await exportToSheets(db, { token, spreadsheetId: SHEET, fetch: api.fetch });
    expect(first.find((x) => x.sheet === "Journal")!.appended).toBeGreaterThan(0);
    // An empty tab gets its header even with no rows yet (no invoice is paid here).
    expect(tabs.get("Paid invoices")).toEqual([[...PAID_HEADER]]);
    const append = api.to("POST", /:append$/).find((c) => c.url.pathname.includes("Journal"))!;
    expect(append.url.pathname).toBe(`/v4/spreadsheets/${SHEET}/values/${encodeURIComponent("'Journal'!A1")}:append`);
    expect(append.url.searchParams.get("valueInputOption")).toBe("RAW");
    expect(append.url.searchParams.get("insertDataOption")).toBe("INSERT_ROWS");
    expect(JSON.parse(append.body!)).toMatchObject({ range: "'Journal'!A1", majorDimension: "ROWS" });
    expect(tabs.get("Journal")![0]).toEqual([...JOURNAL_HEADER]);
    const rows = tabs.get("Journal")!.length;

    const second = await exportToSheets(db, { token, spreadsheetId: SHEET, fetch: api.fetch });
    expect(second.every((x) => x.appended === 0)).toBe(true);
    expect(tabs.get("Journal")!.length).toBe(rows);
  });

  it("keeps a value that looks like a formula as text (RAW), and quotes a sheet name with an apostrophe", async () => {
    const { api, tabs } = sheets();
    const row = { id: "AP-0009", status: "paid", vendor: "=HYPERLINK(\"http://evil.example\",\"x\")", invoice_no: "1", currency: "EUR", total: "1.00" } as never;
    await appendNewRows({ token, spreadsheetId: SHEET, fetch: api.fetch }, "Paid invoices", PAID_HEADER, paidRows([row]));
    expect(api.to("POST", /:append$/)[0]!.url.searchParams.get("valueInputOption")).toBe("RAW");
    expect(tabs.get("Paid invoices")![1]![2]).toBe("=HYPERLINK(\"http://evil.example\",\"x\")");
    expect(a1("CFO's sheet", "A:A")).toBe("'CFO''s sheet'!A:A");
  });
});
