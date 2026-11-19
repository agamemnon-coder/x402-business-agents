// A Gmail inbox for supplier invoices (docs/integrations/workplace.md, "Gmail"). Read-only: the scope is gmail.readonly,
// so Purser can list and read the messages the owner's label or query picks, and nothing else; it cannot send, delete,
// label or move mail. Each invoice attachment goes to Purser's inbox (./inbox.ts) as an upload would.
//
// Endpoints, each from Gmail API v1's reference (developers.google.com/workspace/gmail/api/reference/rest):
// - users.messages.list:             GET /gmail/v1/users/me/messages?q=&labelIds=&maxResults=&pageToken=
// - users.messages.get (format=full): GET /gmail/v1/users/me/messages/{id}?format=full
//   (payload: a MessagePart tree; a part with a filename and body.attachmentId is an attachment; body.size its bytes)
// - users.messages.attachments.get:  GET /gmail/v1/users/me/messages/{messageId}/attachments/{id}  ({ size, data })
//   where data is base64url (MessagePartBody, "base64url encoded string").
//
// Built and tested against a mock (test/workplace-google.test.ts); needs the owner's OAuth app to run live.

import { z } from "zod";
import { callJson, clean, decodeBase64, safeId, setting, type Fetch, type TokenSource } from "./http.js";
import { invoiceLike, MAX_FETCH_BYTES, type FetchedFile, type PollResult, type SkippedFile } from "./inbox.js";

export const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";

export interface GmailConfig {
  token: TokenSource;
  /** Gmail search syntax, e.g. "label:invoices has:attachment newer_than:7d". */
  query?: string;
  /** Label ids (users.labels.list); a message must carry all of them. */
  labelIds?: string[];
  /** At most this many messages a poll (default 25, at most 100). */
  maxMessages?: number;
  /** The largest attachment fetched (default MAX_FETCH_BYTES). */
  maxBytes?: number;
  fetch?: Fetch;
  base?: string;
}

const MessageList = z.object({
  messages: z.array(z.object({ id: z.string().max(256), threadId: z.string().max(256).optional() })).max(500).optional(),
  nextPageToken: z.string().max(1024).optional(),
  resultSizeEstimate: z.number().optional(),
});

interface Part { partId?: string | undefined; mimeType?: string | undefined; filename?: string | undefined; headers?: { name: string; value: string }[] | undefined; body?: { attachmentId?: string | undefined; size?: number | undefined; data?: string | undefined } | undefined; parts?: Part[] | undefined }
const PartSchema: z.ZodType<Part> = z.lazy(() => z.object({
  partId: z.string().max(64).optional(),
  mimeType: z.string().max(255).optional(),
  filename: z.string().max(1024).optional(),
  headers: z.array(z.object({ name: z.string().max(256), value: z.string().max(8192) })).max(500).optional(),
  body: z.object({ attachmentId: z.string().max(4096).optional(), size: z.number().int().nonnegative().optional(), data: z.string().optional() }).optional(),
  parts: z.array(PartSchema).max(200).optional(),
}));
const Message = z.object({ id: z.string().max(256), threadId: z.string().max(256).optional(), internalDate: z.string().max(20).optional(), payload: PartSchema });
const Attachment = z.object({ size: z.number().int().nonnegative().optional(), data: z.string() });

/** Every part of a message, depth first, with a cap on depth and count (a hostile message can nest without end). */
function partsOf(root: Part): Part[] {
  const out: Part[] = [];
  const walk = (p: Part, depth: number) => {
    if (depth > 10 || out.length >= 200) return;
    out.push(p);
    for (const c of p.parts ?? []) walk(c, depth + 1);
  };
  walk(root, 0);
  return out;
}

const header = (p: Part, name: string) => p.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";

/** The query from the environment: PURSER_GMAIL_QUERY, or PURSER_GMAIL_LABEL (a label's name) as label:<name>. */
export function gmailQueryFromEnv(env: Record<string, string | undefined>): string {
  const q = env.PURSER_GMAIL_QUERY?.trim();
  if (q) return q;
  const label = setting(env, "PURSER_GMAIL_LABEL");
  return `label:${/^[\w-]+$/.test(label) ? label : `"${label.replace(/"/g, "")}"`} has:attachment`;
}

/** One poll: the messages the query picks, and from each the attachments that look like invoices, within the cap. */
export async function pollGmail(cfg: GmailConfig): Promise<PollResult> {
  const base = cfg.base ?? GMAIL_API;
  const max = Math.min(Math.max(1, cfg.maxMessages ?? 25), 100);
  const cap = cfg.maxBytes ?? MAX_FETCH_BYTES;
  const o = { token: cfg.token, ...(cfg.fetch ? { fetch: cfg.fetch } : {}) };
  const ids: string[] = [];
  let page: string | undefined;
  for (let n = 0; n < 10 && ids.length < max; n++) {
    const q = new URLSearchParams({ maxResults: String(Math.min(100, max - ids.length)) });
    if (cfg.query) q.set("q", cfg.query);
    for (const l of cfg.labelIds ?? []) q.append("labelIds", safeId("a Gmail label id", l));
    if (page) q.set("pageToken", page);
    const list = await callJson(`${base}/messages?${q}`, MessageList, o);
    for (const m of list.messages ?? []) if (ids.length < max) ids.push(safeId("a Gmail message id", m.id));
    page = list.nextPageToken;
    if (!page) break;
  }

  const files: FetchedFile[] = [];
  const skipped: SkippedFile[] = [];
  for (const id of ids) {
    const msg = await callJson(`${base}/messages/${id}?format=full`, Message, o);
    const meta = { from: clean(header(msg.payload, "From")), subject: clean(header(msg.payload, "Subject")), date: clean(header(msg.payload, "Date"), 80), message_id: clean(header(msg.payload, "Message-ID")), gmail_id: id };
    for (const p of partsOf(msg.payload)) {
      const filename = clean(p.filename, 200);
      if (!filename) continue;
      const mime = clean(p.mimeType, 100) || "application/octet-stream";
      const size = p.body?.size ?? 0;
      if (!invoiceLike(filename, mime)) { skipped.push({ provider: "gmail", ref: id, filename, reason: `${mime} is not an invoice type` }); continue; }
      if (size > cap) { skipped.push({ provider: "gmail", ref: id, filename, reason: `${size} bytes is above the cap of ${cap}; not fetched` }); continue; }
      let data: string;
      if (p.body?.attachmentId) {
        const a = await callJson(`${base}/messages/${id}/attachments/${safeId("a Gmail attachment id", p.body.attachmentId, /^[A-Za-z0-9_-]{1,4096}$/)}`, Attachment, o, Math.ceil(cap * 1.4) + 4096);
        data = a.data;
      } else if (p.body?.data) {
        data = p.body.data;
      } else continue;
      try {
        files.push({ provider: "gmail", ref: id, filename, mime, bytes: decodeBase64(data, cap, true), meta });
      } catch (e) {
        skipped.push({ provider: "gmail", ref: id, filename, reason: (e as Error).message });
      }
    }
  }
  return { files, skipped };
}
