// An Outlook mail folder and a OneDrive (or SharePoint) folder as invoice inboxes, through Microsoft Graph v1.0
// (docs/integrations/workplace.md, "Microsoft"). Read-only: Mail.Read and Files.Read (delegated), so Purser reads the
// folder the owner names and cannot send, move or delete mail or files. Each invoice attachment or file goes to
// Purser's inbox (./inbox.ts). (Purser's document vault in OneDrive, src/vault/onedrive.ts, is a separate integration
// that writes. Approval notices to Teams are the integrations branch's webhook notifier, src/integrations/approvalChat.ts;
// this file does not post to Teams.)
//
// Endpoints, each from the Graph v1.0 reference (learn.microsoft.com/en-us/graph/api/...):
// - mailfolder-list-messages: GET /me/mailFolders/{id}/messages?$filter=hasAttachments eq true&$select=&$top=
//   (paged with @odata.nextLink)
// - message-list-attachments: GET /me/messages/{id}/attachments?$select=id,name,contentType,size,isInline
//   (#microsoft.graph.fileAttachment is a file; item and reference attachments are not fetched)
// - attachment-get, raw contents: GET /me/messages/{id}/attachments/{attachment-id}/$value
// - driveitem-list-children by path: GET /drives/{drive-id}/root:/{folder-path}:/children?$select=&$top=
// - driveitem-get-content: GET /drives/{drive-id}/items/{item-id}/content (302 to a pre-authenticated download URL)
//
// Built and tested against a mock (test/workplace-microsoft.test.ts); needs the owner's Entra app to run live.

import { z } from "zod";
import { callBytes, callJson, clean, safeId, WorkplaceError, type Fetch, type TokenSource } from "./http.js";
import { invoiceLike, MAX_FETCH_BYTES, type FetchedFile, type PollResult, type SkippedFile } from "./inbox.js";

export const GRAPH_API = "https://graph.microsoft.com/v1.0";
/** Graph ids are base64-like (letters, digits, -, _, =, +, /, .; a SharePoint drive id starts with b!); a well-known folder name (inbox) is letters. */
const GRAPH_ID = /^[A-Za-z0-9=_+/.!-]{1,512}$/;
const enc = (what: string, id: string) => encodeURIComponent(safeId(what, id, GRAPH_ID));

/** A next page only on Graph's own address: a nextLink elsewhere is refused, so a page can never send the token away. */
function nextOf(link: string | undefined, base: string): string | undefined {
  if (!link) return undefined;
  let u: URL, b: URL;
  try { u = new URL(link); b = new URL(base); } catch { throw new WorkplaceError("invalid", "Graph answered a next page that is not a URL"); }
  if (u.origin !== b.origin || !u.pathname.startsWith(b.pathname)) throw new WorkplaceError("invalid", "Graph answered a next page on another address; it is not followed");
  return u.toString();
}

const Messages = z.object({
  value: z.array(z.object({
    id: z.string().max(512), subject: z.string().max(4096).nullable().optional(), receivedDateTime: z.string().max(40).optional(),
    internetMessageId: z.string().max(1024).nullable().optional(), hasAttachments: z.boolean().optional(),
    from: z.object({ emailAddress: z.object({ name: z.string().max(512).optional(), address: z.string().max(320).optional() }) }).nullable().optional(),
  })).max(1000),
  "@odata.nextLink": z.string().max(4096).optional(),
});
const Attachments = z.object({
  value: z.array(z.object({
    "@odata.type": z.string().max(100), id: z.string().max(1024), name: z.string().max(1024).nullable().optional(),
    contentType: z.string().max(255).nullable().optional(), size: z.number().int().nonnegative(), isInline: z.boolean().optional(),
  })).max(500),
});
const Children = z.object({
  value: z.array(z.object({
    id: z.string().max(512), name: z.string().max(1024), size: z.number().int().nonnegative().optional(),
    file: z.object({ mimeType: z.string().max(255).optional() }).optional(), folder: z.object({}).passthrough().optional(),
    lastModifiedDateTime: z.string().max(40).optional(),
  })).max(1000),
  "@odata.nextLink": z.string().max(4096).optional(),
});

export interface OutlookConfig {
  token: TokenSource;
  /** A mail folder id, or a well-known name such as inbox. */
  folderId: string;
  /** Only messages received at or after this moment (RFC 3339). */
  receivedAfter?: string;
  maxMessages?: number;
  maxBytes?: number;
  fetch?: Fetch;
  base?: string;
}

/** One poll of the mail folder: its messages with attachments, and their invoice files within the cap. */
export async function pollOutlookFolder(cfg: OutlookConfig): Promise<PollResult> {
  const base = cfg.base ?? GRAPH_API;
  const max = Math.min(Math.max(1, cfg.maxMessages ?? 25), 100);
  const cap = cfg.maxBytes ?? MAX_FETCH_BYTES;
  const o = { token: cfg.token, ...(cfg.fetch ? { fetch: cfg.fetch } : {}) };
  let filter = "hasAttachments eq true";
  if (cfg.receivedAfter) {
    if (Number.isNaN(Date.parse(cfg.receivedAfter))) throw new WorkplaceError("config", "receivedAfter is not a date");
    filter += ` and receivedDateTime ge ${new Date(cfg.receivedAfter).toISOString()}`;
  }
  const q = new URLSearchParams({ $filter: filter, $select: "id,subject,from,receivedDateTime,internetMessageId,hasAttachments", $top: String(Math.min(50, max)) });
  let url: string | undefined = `${base}/me/mailFolders/${enc("the mail folder id", cfg.folderId)}/messages?${q}`;
  const messages: z.infer<typeof Messages>["value"] = [];
  for (let n = 0; url && n < 20 && messages.length < max; n++) {
    const page: z.infer<typeof Messages> = await callJson(url, Messages, o);
    messages.push(...page.value.slice(0, max - messages.length));
    url = nextOf(page["@odata.nextLink"], base);
  }

  const files: FetchedFile[] = [];
  const skipped: SkippedFile[] = [];
  for (const m of messages) {
    const mid = enc("a message id", m.id);
    const meta = { from: clean(m.from?.emailAddress.address ?? ""), subject: clean(m.subject), date: clean(m.receivedDateTime, 40), message_id: clean(m.internetMessageId), graph_id: clean(m.id, 200) };
    const atts = await callJson(`${base}/me/messages/${mid}/attachments?${new URLSearchParams({ $select: "id,name,contentType,size,isInline" })}`, Attachments, o);
    for (const a of atts.value.slice(0, 50)) {
      const filename = clean(a.name, 200) || "attachment";
      const mime = clean(a.contentType, 100) || "application/octet-stream";
      if (a["@odata.type"] !== "#microsoft.graph.fileAttachment") { skipped.push({ provider: "outlook", ref: m.id, filename, reason: "not a file attachment (an attached item or a link); not fetched" }); continue; }
      if (!invoiceLike(filename, mime)) { skipped.push({ provider: "outlook", ref: m.id, filename, reason: `${mime} is not an invoice type` }); continue; }
      if (a.size > cap) { skipped.push({ provider: "outlook", ref: m.id, filename, reason: `${a.size} bytes is above the cap of ${cap}; not fetched` }); continue; }
      try {
        const bytes = await callBytes(`${base}/me/messages/${mid}/attachments/${enc("an attachment id", a.id)}/$value`, cap, o);
        files.push({ provider: "outlook", ref: m.id, filename, mime, bytes, meta });
      } catch (e) {
        skipped.push({ provider: "outlook", ref: m.id, filename, reason: (e as Error).message });
      }
    }
  }
  return { files, skipped };
}

export interface OneDriveFolderConfig {
  token: TokenSource;
  driveId: string;
  /** The folder's path from the drive's root, e.g. "Finance/Invoices in". */
  folderPath: string;
  maxFiles?: number;
  maxBytes?: number;
  fetch?: Fetch;
  base?: string;
}

/** A folder path as Graph addresses it: each segment encoded, no "..", no empty segment. */
export function graphPath(path: string): string {
  const parts = path.split("/").filter((s) => s !== "");
  if (parts.length === 0 || parts.length > 20 || parts.some((s) => s === "." || s === ".." || s.length > 255 || /[\p{Cc}:]/u.test(s))) throw new WorkplaceError("config", "the OneDrive folder path is not a plain path below the drive's root");
  return parts.map(encodeURIComponent).join("/");
}

/** One poll of the OneDrive folder: its invoice files within the cap (subfolders are not entered). */
export async function pollOneDriveFolder(cfg: OneDriveFolderConfig): Promise<PollResult> {
  const base = cfg.base ?? GRAPH_API;
  const max = Math.min(Math.max(1, cfg.maxFiles ?? 50), 500);
  const cap = cfg.maxBytes ?? MAX_FETCH_BYTES;
  const o = { token: cfg.token, ...(cfg.fetch ? { fetch: cfg.fetch } : {}) };
  const drive = `${base}/drives/${enc("the drive id", cfg.driveId)}`;
  let url: string | undefined = `${drive}/root:/${graphPath(cfg.folderPath)}:/children?${new URLSearchParams({ $select: "id,name,size,file,folder,lastModifiedDateTime", $top: "100" })}`;
  const files: FetchedFile[] = [];
  const skipped: SkippedFile[] = [];
  let seen = 0;
  for (let n = 0; url && n < 20 && seen < max; n++) {
    const page: z.infer<typeof Children> = await callJson(url, Children, o);
    for (const item of page.value) {
      if (seen >= max) break;
      if (!item.file) continue;
      seen++;
      const filename = clean(item.name, 200);
      const mime = clean(item.file.mimeType, 100) || "application/octet-stream";
      const size = item.size ?? 0;
      if (!invoiceLike(filename, mime)) { skipped.push({ provider: "onedrive", ref: item.id, filename, reason: `${mime} is not an invoice type` }); continue; }
      if (size > cap) { skipped.push({ provider: "onedrive", ref: item.id, filename, reason: `${size} bytes is above the cap of ${cap}; not fetched` }); continue; }
      try {
        const bytes = await callBytes(`${drive}/items/${enc("a drive item id", item.id)}/content`, cap, o);
        files.push({ provider: "onedrive", ref: item.id, filename, mime, bytes, meta: { drive_id: clean(cfg.driveId, 200), folder: clean(cfg.folderPath, 200), item_id: clean(item.id, 200), modified: clean(item.lastModifiedDateTime, 40) } });
      } catch (e) {
        skipped.push({ provider: "onedrive", ref: item.id, filename, reason: (e as Error).message });
      }
    }
    url = nextOf(page["@odata.nextLink"], base);
  }
  return { files, skipped };
}
