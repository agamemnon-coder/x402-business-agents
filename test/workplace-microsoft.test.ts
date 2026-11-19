// The Microsoft Graph inboxes (src/workplace/graph.ts) against a local mock of Graph v1.0, with request shapes from the
// reference: mailfolder-list-messages ($filter, $select, $top, @odata.nextLink), message-list-attachments,
// attachment-get /$value, driveitem-list-children by path (/drives/{id}/root:/{path}:/children) and
// driveitem-get-content. What they fetch goes through Purser's own inbox unchanged. No network. Built and tested against
// a mock; needs the owner's Entra app to run live. (Teams approval notices are the integrations branch's webhook
// notifier; nothing here posts to Teams.)
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { InboxDeps } from "../src/ap/inbox.js";
import type { Asker } from "../src/ap/read.js";
import { openDb, type DB } from "../src/db/open.js";
import { graphPath, pollOneDriveFolder, pollOutlookFolder } from "../src/workplace/graph.js";
import { deliverToInbox } from "../src/workplace/inbox.js";
import { DE, EN } from "./fakes/apInvoices.js";
import { pdfOf } from "./fakes/pdf.js";
import { MockApi, ublInvoice } from "./fakes/workplace.js";

const parserOnly: Asker = { ask: async (_a, fallback) => ({ value: fallback(), source: "fallback", model: null, note: "no key" }) } as Asker;
const token = async () => "eyJ0eXAiOi.test.graph-token";
let dir: string;
let db: DB;
let deps: InboxDeps;
beforeEach(() => {
  dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "workplace-ms-"));
  db = openDb(":memory:");
  deps = { dir, reader: parserOnly, now: () => new Date("2026-11-19T09:00:00Z") };
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const FOLDER = "AAMkAGI2THVSAAA=";
const MSG = "AAMkAGI2TG93AAA=";

function outlook(pdf: Uint8Array, o: { nextLink?: string } = {}) {
  const api = new MockApi("https://graph.microsoft.com");
  api.on("GET", /\/v1\.0\/me\/mailFolders\/([^/]+)\/messages/, () => ({ json: {
    "@odata.context": "https://graph.microsoft.com/v1.0/$metadata#users('...')/mailFolders('...')/messages",
    value: [{ id: MSG, subject: "Invoice BTX-2026-21", receivedDateTime: "2026-11-02T08:00:00Z", internetMessageId: "<btx-21@bergtex.example>", hasAttachments: true, from: { emailAddress: { name: "Bergtex Accounts", address: "accounts@bergtex.example" } } }],
    ...(o.nextLink ? { "@odata.nextLink": o.nextLink } : {}),
  } }));
  api.on("GET", /\/v1\.0\/me\/messages\/([^/]+)\/attachments/, () => ({ json: { value: [
    { "@odata.type": "#microsoft.graph.fileAttachment", id: "AAMkAtt1=", name: "BTX-2026-21.pdf", contentType: "application/pdf", size: pdf.length, isInline: false },
    { "@odata.type": "#microsoft.graph.itemAttachment", id: "AAMkAtt2=", name: "Forwarded message", contentType: null, size: 2000, isInline: false },
    { "@odata.type": "#microsoft.graph.fileAttachment", id: "AAMkAtt3=", name: "huge.pdf", contentType: "application/pdf", size: 80 * 1024 * 1024, isInline: false },
  ] } }));
  api.on("GET", /\/v1\.0\/me\/messages\/([^/]+)\/attachments\/AAMkAtt1=\/\$value/, () => ({ bytes: pdf }));
  return api;
}

describe("Outlook mail folder (Mail.Read)", () => {
  it("reads the folder's messages with attachments, fetches the file attachments' raw bytes and files them", async () => {
    const pdf = await pdfOf(EN);
    const api = outlook(pdf);
    const polled = await pollOutlookFolder({ token, folderId: FOLDER, receivedAfter: "2026-11-01T00:00:00Z", fetch: api.fetch });

    const list = api.calls[0]!;
    expect(list.url.pathname).toBe(`/v1.0/me/mailFolders/${encodeURIComponent(FOLDER)}/messages`);
    expect(list.url.searchParams.get("$filter")).toBe("hasAttachments eq true and receivedDateTime ge 2026-11-01T00:00:00.000Z");
    expect(list.url.searchParams.get("$select")).toBe("id,subject,from,receivedDateTime,internetMessageId,hasAttachments");
    expect(list.headers.authorization).toBe("Bearer eyJ0eXAiOi.test.graph-token");
    expect(api.to("GET", /\/attachments$/)[0]!.url.searchParams.get("$select")).toBe("id,name,contentType,size,isInline");
    expect(api.to("GET", /\/\$value$/).map((c) => c.url.pathname)).toEqual([`/v1.0/me/messages/${encodeURIComponent(MSG)}/attachments/${encodeURIComponent("AAMkAtt1=")}/$value`]);
    expect(api.calls.every((c) => c.method === "GET")).toBe(true);
    expect(polled.skipped.map((s) => s.reason)).toEqual([expect.stringMatching(/not a file attachment/), expect.stringMatching(/above the cap/)]);

    const delivered = await deliverToInbox(db, deps, polled.files);
    expect(delivered[0]).toMatchObject({ outcome: "filed", result: { kind: "invoice", invoice: { invoice_no: "BTX-2026-21" } } });
    const meta = JSON.parse((db.prepare("SELECT meta_json FROM ap_documents").get() as { meta_json: string }).meta_json) as Record<string, string>;
    expect(meta).toMatchObject({ via: "outlook", from: "accounts@bergtex.example", subject: "Invoice BTX-2026-21", message_id: "<btx-21@bergtex.example>" });
  });

  it("follows a next page only on Graph's own address, so the token is never sent elsewhere", async () => {
    const api = outlook(await pdfOf(EN), { nextLink: "https://evil.example/v1.0/me/mailFolders/x/messages?$skip=10" });
    await expect(pollOutlookFolder({ token, folderId: "inbox", maxMessages: 50, fetch: api.fetch })).rejects.toThrow(/another address; it is not followed/);
    expect(api.calls.every((c) => c.url.origin === "https://graph.microsoft.com")).toBe(true);
  });

  it("refuses a folder id that is not a Graph id", async () => {
    await expect(pollOutlookFolder({ token, folderId: "inbox?$expand=x&", fetch: outlook(new Uint8Array()).fetch })).rejects.toThrow(/not a well-formed id/);
  });
});

describe("OneDrive folder (Files.Read)", () => {
  it("lists the folder by path, fetches each invoice file's content and files it", async () => {
    const pdf = await pdfOf(DE);
    const api = new MockApi("https://graph.microsoft.com");
    api.on("GET", /\/v1\.0\/drives\/([^/]+)\/root:\/(.+):\/children/, () => ({ json: { value: [
      { id: "01BYE5RZ1", name: "LN-2026-0815.pdf", size: pdf.length, file: { mimeType: "application/pdf", hashes: { quickXorHash: "x" } }, lastModifiedDateTime: "2026-11-04T10:00:00Z" },
      { id: "01BYE5RZ2", name: "Archive", folder: { childCount: 3 } },
      { id: "01BYE5RZ3", name: "notes.docx", size: 100, file: { mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" } },
      { id: "01BYE5RZ4", name: "bad.xml", size: 300, file: { mimeType: "application/xml" } },
    ] } }));
    api.on("GET", /\/v1\.0\/drives\/([^/]+)\/items\/01BYE5RZ1\/content/, () => ({ bytes: pdf }));
    api.on("GET", /\/v1\.0\/drives\/([^/]+)\/items\/01BYE5RZ4\/content/, () => ({ bytes: ublInvoice({ id: "Q", supplier: "Q", payable: "1.00", extra: "<!DOCTYPE x>" }) }));
    const polled = await pollOneDriveFolder({ token, driveId: "b!-RIj2DuyvEyV1T4NlOaMHk8XkS_I8MdFlUCq1BlcjgmhRfAj3-Z8RY2VpuvV_tOcd", folderPath: "Finance/Invoices in", fetch: api.fetch });

    expect(api.calls[0]!.url.pathname).toBe("/v1.0/drives/b!-RIj2DuyvEyV1T4NlOaMHk8XkS_I8MdFlUCq1BlcjgmhRfAj3-Z8RY2VpuvV_tOcd/root:/Finance/Invoices%20in:/children");
    expect(api.calls[0]!.url.searchParams.get("$select")).toBe("id,name,size,file,folder,lastModifiedDateTime");
    expect(polled.files.map((f) => f.filename)).toEqual(["LN-2026-0815.pdf", "bad.xml"]);
    expect(polled.skipped.map((s) => s.filename)).toEqual(["notes.docx"]);

    const delivered = await deliverToInbox(db, deps, polled.files);
    expect(delivered.map((d) => d.outcome)).toEqual(["filed", "refused"]);
    expect(delivered[1]).toMatchObject({ reason: expect.stringMatching(/DOCTYPE/) });
    expect((db.prepare("SELECT source FROM ap_documents").get() as { source: string }).source).toBe("folder");
  });

  it("takes a plain path below the drive's root only", () => {
    expect(graphPath("/Finance//Invoices in/")).toBe("Finance/Invoices%20in");
    expect(() => graphPath("Finance/../../other")).toThrow(/plain path/);
    expect(() => graphPath("")).toThrow(/plain path/);
  });
});
