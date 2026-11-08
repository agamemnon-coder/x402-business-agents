// The vault in a customer's Google Drive (Drive API v3), under one folder the customer shares with Purser. Built only
// from Google's documentation; tested against a fake shaped like it (test/vault-remote.test.ts). No live call has been
// made. The access token comes from the environment (KIT11_GDRIVE_TOKEN), never from code, git or logs.
//
// Endpoints used, each from the official reference:
// - files.list (search by name and parent):   GET  https://www.googleapis.com/drive/v3/files?q=...
//   https://developers.google.com/workspace/drive/api/reference/rest/v3/files/list
//   query syntax and escaping (\' and \\):      https://developers.google.com/workspace/drive/api/guides/search-files
// - create a folder (mimeType application/vnd.google-apps.folder, parents):  POST https://www.googleapis.com/drive/v3/files
//   https://developers.google.com/workspace/drive/api/guides/folder
// - multipart upload (metadata + content):     POST https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart
//   https://developers.google.com/workspace/drive/api/guides/manage-uploads
// - update content (index.json only):          PATCH https://www.googleapis.com/upload/drive/v3/files/{fileId}?uploadType=media
//   https://developers.google.com/workspace/drive/api/reference/rest/v3/files/update
// - download:                                  GET  https://www.googleapis.com/drive/v3/files/{fileId}?alt=media
//   https://developers.google.com/workspace/drive/api/reference/rest/v3/files/get
// - sha256Checksum and appProperties fields:   https://developers.google.com/workspace/drive/api/reference/rest/v3/files

import { randomBytes } from "node:crypto";
import type { VaultSink } from "./sink.js";

const API = "https://www.googleapis.com/drive/v3/files";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";
const FOLDER = "application/vnd.google-apps.folder";

type Fetch = typeof fetch;
interface DriveFile { id: string; name: string; size?: string; sha256Checksum?: string; appProperties?: Record<string, string> }

/** A Drive query string literal: apostrophes and backslashes escaped with a backslash (the search guide). */
export const driveQuoted = (s: string) => `'${s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;

export class GoogleDriveSink implements VaultSink {
  readonly name = "gdrive";
  private readonly folders = new Map<string, string>();
  constructor(private readonly opts: { token: string; rootFolderId: string; fetch?: Fetch }) {
    if (!opts.token) throw new Error("no Google Drive token (set KIT11_GDRIVE_TOKEN)");
    if (!opts.rootFolderId) throw new Error("no Google Drive folder (set KIT11_GDRIVE_FOLDER_ID)");
  }

  private async call(url: string, init: RequestInit = {}): Promise<Response> {
    const res = await (this.opts.fetch ?? fetch)(url, { ...init, headers: { Authorization: `Bearer ${this.opts.token}`, ...(init.headers ?? {}) } });
    if (!res.ok && res.status !== 404) throw new Error(`Google Drive ${init.method ?? "GET"} ${url.split("?")[0]}: ${res.status}`);
    return res;
  }

  private async find(parent: string, name: string, folder: boolean): Promise<DriveFile | null> {
    const q = `name = ${driveQuoted(name)} and ${driveQuoted(parent)} in parents and trashed = false${folder ? ` and mimeType = '${FOLDER}'` : ` and mimeType != '${FOLDER}'`}`;
    const res = await this.call(`${API}?${new URLSearchParams({ q, fields: "files(id,name,size,sha256Checksum,appProperties)", spaces: "drive" })}`);
    const body = (await res.json()) as { files?: DriveFile[] };
    return body.files?.[0] ?? null;
  }

  private async folderOf(path: string, create: boolean): Promise<string | null> {
    const parts = path.split("/").slice(0, -1);
    let parent = this.opts.rootFolderId;
    for (let i = 0; i < parts.length; i += 1) {
      const key = parts.slice(0, i + 1).join("/");
      const cached = this.folders.get(key);
      if (cached) { parent = cached; continue; }
      let f = await this.find(parent, parts[i]!, true);
      if (!f) {
        if (!create) return null;
        const res = await this.call(`${API}?fields=id`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: parts[i], mimeType: FOLDER, parents: [parent] }) });
        f = { id: ((await res.json()) as { id: string }).id, name: parts[i]! };
      }
      this.folders.set(key, f.id);
      parent = f.id;
    }
    return parent;
  }

  private async file(path: string): Promise<DriveFile | null> {
    const folder = await this.folderOf(path, false);
    return folder ? this.find(folder, path.split("/").pop()!, false) : null;
  }

  async stat(path: string): Promise<{ sha256: string | null; bytes: number | null } | null> {
    const f = await this.file(path);
    if (!f) return null;
    return { sha256: f.sha256Checksum?.toLowerCase() ?? f.appProperties?.sha256 ?? null, bytes: f.size ? Number(f.size) : null };
  }

  private async upload(path: string, bytes: Buffer, mime: string, sha256: string | null): Promise<void> {
    const folder = (await this.folderOf(path, true))!;
    const boundary = `purser_${randomBytes(12).toString("hex")}`;
    const meta = { name: path.split("/").pop(), parents: [folder], mimeType: mime, ...(sha256 ? { appProperties: { sha256, purser: "vault" } } : {}) };
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`),
      bytes, Buffer.from(`\r\n--${boundary}--`),
    ]);
    await this.call(`${UPLOAD}?uploadType=multipart&fields=id`, { method: "POST", headers: { "Content-Type": `multipart/related; boundary=${boundary}` }, body });
  }

  async create(path: string, bytes: Buffer, sha256: string, mime = "application/pdf"): Promise<void> {
    if (await this.file(path)) throw new Error(`${path} is already in the Drive vault; nothing is overwritten`);
    await this.upload(path, bytes, mime, sha256);
  }

  private async download(id: string): Promise<Buffer> {
    const res = await this.call(`${API}/${encodeURIComponent(id)}?alt=media`);
    return Buffer.from(await res.arrayBuffer());
  }

  async readIndex(path: string): Promise<string | null> {
    const f = await this.file(path);
    return f ? (await this.download(f.id)).toString("utf8") : null;
  }

  async writeIndex(path: string, text: string): Promise<void> {
    const f = await this.file(path);
    if (!f) return this.upload(path, Buffer.from(text), "application/json", null);
    await this.call(`${UPLOAD}/${encodeURIComponent(f.id)}?uploadType=media`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: text });
  }

  async read(path: string): Promise<Buffer | null> {
    const f = await this.file(path);
    return f ? this.download(f.id) : null;
  }
}
