// A watched Google Drive folder for supplier invoices (docs/integrations/workplace.md, "Drive"): the PDFs and UBL files
// in one folder the owner names go to Purser's inbox (./inbox.ts). Read-only: the scope is drive.readonly; nothing is
// moved, renamed or deleted, and a file filed before is recognised by its hash in the inbox. (Purser's document vault
// in Drive, src/vault/gdrive.ts, is a separate integration that writes; this one only reads.)
//
// Endpoints, each from Drive API v3's reference (developers.google.com/workspace/drive/api/reference/rest/v3):
// - files.list: GET /drive/v3/files?q='<folder>' in parents and trashed = false and (...)&fields=&pageSize=&pageToken=
//   &supportsAllDrives=true&includeItemsFromAllDrives=true (a shared drive's folder works too); the query syntax and
//   its escaping are from the search guide (.../guides/search-files).
// - files.get with alt=media: GET /drive/v3/files/{fileId}?alt=media&supportsAllDrives=true (the file's bytes).
//
// Built and tested against a mock (test/workplace-google.test.ts); needs the owner's OAuth app to run live.

import { z } from "zod";
import { driveQuoted } from "../vault/gdrive.js";
import { callBytes, callJson, clean, safeId, type Fetch, type TokenSource } from "./http.js";
import { invoiceLike, MAX_FETCH_BYTES, type FetchedFile, type PollResult, type SkippedFile } from "./inbox.js";

export const DRIVE_API = "https://www.googleapis.com/drive/v3/files";
const TYPES = ["application/pdf", "application/xml", "text/xml", "image/jpeg", "image/png"];

export interface DriveFolderConfig {
  token: TokenSource;
  /** The watched folder's id (the last part of its URL in Drive). */
  folderId: string;
  /** Only files changed after this moment (RFC 3339), so a poll does not fetch the whole folder again. */
  modifiedAfter?: string;
  maxFiles?: number;
  maxBytes?: number;
  fetch?: Fetch;
  base?: string;
}

const FileList = z.object({
  nextPageToken: z.string().max(1024).optional(),
  files: z.array(z.object({
    id: z.string().max(256), name: z.string().max(1024), mimeType: z.string().max(255),
    size: z.string().regex(/^\d{1,15}$/).optional(), modifiedTime: z.string().max(40).optional(),
  })).max(1000).optional(),
});

/** The files.list query for the folder: invoice types only, nothing in the bin, optionally changed since a moment. */
export function driveFolderQuery(folderId: string, modifiedAfter?: string): string {
  safeId("the Drive folder id", folderId, /^[A-Za-z0-9_-]{5,200}$/);
  const types = TYPES.map((t) => `mimeType = '${t}'`).join(" or ");
  let q = `${driveQuoted(folderId)} in parents and trashed = false and (${types})`;
  if (modifiedAfter) {
    if (Number.isNaN(Date.parse(modifiedAfter))) throw new Error("modifiedAfter is not a date");
    q += ` and modifiedTime > '${new Date(modifiedAfter).toISOString()}'`;
  }
  return q;
}

export async function pollDriveFolder(cfg: DriveFolderConfig): Promise<PollResult> {
  const base = cfg.base ?? DRIVE_API;
  const max = Math.min(Math.max(1, cfg.maxFiles ?? 50), 500);
  const cap = cfg.maxBytes ?? MAX_FETCH_BYTES;
  const o = { token: cfg.token, ...(cfg.fetch ? { fetch: cfg.fetch } : {}) };
  const q = driveFolderQuery(cfg.folderId, cfg.modifiedAfter);
  const files: FetchedFile[] = [];
  const skipped: SkippedFile[] = [];
  let page: string | undefined;
  let seen = 0;
  for (let n = 0; n < 20 && seen < max; n++) {
    const params = new URLSearchParams({ q, fields: "nextPageToken,files(id,name,mimeType,size,modifiedTime)", pageSize: String(Math.min(100, max - seen)), supportsAllDrives: "true", includeItemsFromAllDrives: "true", orderBy: "modifiedTime" });
    if (page) params.set("pageToken", page);
    const list = await callJson(`${base}?${params}`, FileList, o);
    for (const f of list.files ?? []) {
      if (seen >= max) break;
      seen++;
      const id = safeId("a Drive file id", f.id);
      const filename = clean(f.name, 200);
      const size = Number(f.size ?? "0");
      if (!invoiceLike(filename, f.mimeType)) { skipped.push({ provider: "gdrive", ref: id, filename, reason: `${clean(f.mimeType, 100)} is not an invoice type` }); continue; }
      if (size > cap) { skipped.push({ provider: "gdrive", ref: id, filename, reason: `${size} bytes is above the cap of ${cap}; not fetched` }); continue; }
      try {
        const bytes = await callBytes(`${base}/${id}?alt=media&supportsAllDrives=true`, cap, o);
        files.push({ provider: "gdrive", ref: id, filename, mime: clean(f.mimeType, 100), bytes, meta: { folder_id: cfg.folderId, drive_file_id: id, modified: clean(f.modifiedTime, 40) } });
      } catch (e) {
        skipped.push({ provider: "gdrive", ref: id, filename, reason: (e as Error).message });
      }
    }
    page = list.nextPageToken;
    if (!page) break;
  }
  return { files, skipped };
}
