// The vault in a customer's OneDrive or SharePoint document library (Microsoft Graph v1.0), in one drive the customer
// grants Purser. Built only from Microsoft's documentation; tested against a fake shaped like it
// (test/vault-remote.test.ts). No live call has been made. The access token comes from the environment
// (KIT11_GRAPH_TOKEN), never from code, git or logs.
//
// Endpoints used, each from the official reference:
// - get an item by path:          GET  /drives/{drive-id}/root:/{item-path}         (404 when absent)
//   https://learn.microsoft.com/en-us/graph/api/driveitem-get?view=graph-rest-1.0
// - create a folder:              POST /drives/{drive-id}/items/{parent-item-id}/children  {name, folder: {}, conflictBehavior}
//   https://learn.microsoft.com/en-us/graph/api/driveitem-post-children?view=graph-rest-1.0
// - upload a new file (≤ 250 MB): PUT  /drives/{drive-id}/items/{parent-id}:/{filename}:/content
//   replace content (index only): PUT  /drives/{drive-id}/items/{item-id}/content
//   https://learn.microsoft.com/en-us/graph/api/driveitem-put-content?view=graph-rest-1.0
// - download:                     GET  /drives/{drive-id}/items/{item-id}/content   (302 to a download URL, followed)
//   https://learn.microsoft.com/en-us/graph/api/driveitem-get-content?view=graph-rest-1.0
// - hashes (sha256Hash is not guaranteed on every drive; quickXorHash is):
//   https://learn.microsoft.com/en-us/graph/api/resources/hashes?view=graph-rest-1.0

import type { VaultSink } from "./sink.js";

const GRAPH = "https://graph.microsoft.com/v1.0";
type Fetch = typeof fetch;
interface DriveItem { id: string; name: string; size?: number; file?: { hashes?: { sha256Hash?: string } }; folder?: object }

const encodePath = (path: string) => path.split("/").map(encodeURIComponent).join("/");

export class OneDriveSink implements VaultSink {
  readonly name = "onedrive";
  private readonly base: string;
  private readonly ids = new Map<string, string>();
  constructor(private readonly opts: { token: string; driveId: string; fetch?: Fetch }) {
    if (!opts.token) throw new Error("no Microsoft Graph token (set KIT11_GRAPH_TOKEN)");
    if (!opts.driveId) throw new Error("no drive id (set KIT11_GRAPH_DRIVE_ID)");
    this.base = `${GRAPH}/drives/${encodeURIComponent(opts.driveId)}`;
  }

  private async call(url: string, init: RequestInit = {}, ok: number[] = []): Promise<Response> {
    const res = await (this.opts.fetch ?? fetch)(url, { redirect: "follow", ...init, headers: { Authorization: `Bearer ${this.opts.token}`, ...(init.headers ?? {}) } });
    if (!res.ok && res.status !== 404 && !ok.includes(res.status)) throw new Error(`Microsoft Graph ${init.method ?? "GET"} ${url.replace(GRAPH, "")}: ${res.status}`);
    return res;
  }

  private async item(path: string): Promise<DriveItem | null> {
    const res = await this.call(path ? `${this.base}/root:/${encodePath(path)}` : `${this.base}/root`);
    return res.status === 404 ? null : ((await res.json()) as DriveItem);
  }

  private async folderId(path: string): Promise<string> {
    if (this.ids.has(path)) return this.ids.get(path)!;
    const found = await this.item(path);
    if (found) { this.ids.set(path, found.id); return found.id; }
    const parentPath = path.split("/").slice(0, -1).join("/");
    const parent = await this.folderId(parentPath);
    const res = await this.call(`${this.base}/items/${encodeURIComponent(parent)}/children`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: path.split("/").pop(), folder: {}, "@microsoft.graph.conflictBehavior": "fail" }),
    }, [409]);
    // 409: another run made the folder a moment ago; read it back.
    const id = res.status === 409 ? (await this.item(path))!.id : ((await res.json()) as DriveItem).id;
    this.ids.set(path, id);
    return id;
  }

  async stat(path: string): Promise<{ sha256: string | null; bytes: number | null } | null> {
    const it = await this.item(path);
    return it ? { sha256: it.file?.hashes?.sha256Hash?.toLowerCase() ?? null, bytes: it.size ?? null } : null;
  }

  private async put(path: string, bytes: Buffer, mime: string): Promise<void> {
    const parent = await this.folderId(path.split("/").slice(0, -1).join("/"));
    await this.call(`${this.base}/items/${encodeURIComponent(parent)}:/${encodeURIComponent(path.split("/").pop()!)}:/content`, { method: "PUT", headers: { "Content-Type": mime }, body: new Uint8Array(bytes) });
  }

  async create(path: string, bytes: Buffer, _sha256: string, mime = "application/pdf"): Promise<void> {
    if (await this.item(path)) throw new Error(`${path} is already in the OneDrive vault; nothing is overwritten`);
    await this.put(path, bytes, mime);
  }

  private async download(id: string): Promise<Buffer> {
    const res = await this.call(`${this.base}/items/${encodeURIComponent(id)}/content`);
    return Buffer.from(await res.arrayBuffer());
  }

  async readIndex(path: string): Promise<string | null> {
    const it = await this.item(path);
    return it ? (await this.download(it.id)).toString("utf8") : null;
  }

  async writeIndex(path: string, text: string): Promise<void> {
    const it = await this.item(path);
    if (!it) return this.put(path, Buffer.from(text), "application/json");
    await this.call(`${this.base}/items/${encodeURIComponent(it.id)}/content`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: text });
  }

  async read(path: string): Promise<Buffer | null> {
    const it = await this.item(path);
    return it ? this.download(it.id) : null;
  }
}
