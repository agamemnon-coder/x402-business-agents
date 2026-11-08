// Fakes of Google Drive (API v3) and Microsoft Graph (OneDrive), each answering only the requests the vault's sinks
// make, shaped like the official references cited in src/vault/gdrive.ts and src/vault/onedrive.ts. In memory; every
// request is recorded.
import { createHash } from "node:crypto";

const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

interface GFile { id: string; name: string; parents: string[]; mimeType: string; content: Buffer; appProperties?: Record<string, string> }

export class FakeDrive {
  readonly files = new Map<string, GFile>();
  readonly calls: string[] = [];
  private n = 0;
  constructor(readonly root = "root-folder") {}

  byPath(path: string): GFile | undefined {
    let parent = this.root;
    let found: GFile | undefined;
    for (const name of path.split("/")) {
      found = [...this.files.values()].find((f) => f.name === name && f.parents[0] === parent);
      if (!found) return undefined;
      parent = found.id;
    }
    return found;
  }

  fetch = async (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(String(input));
    const method = init.method ?? "GET";
    this.calls.push(`${method} ${url.pathname}${url.searchParams.get("uploadType") ? `?uploadType=${url.searchParams.get("uploadType")}` : ""}`);
    if (!String((init.headers as Record<string, string>)?.Authorization ?? "").startsWith("Bearer ")) return json(401, { error: "no token" });
    if (method === "GET" && url.pathname === "/drive/v3/files") {
      const q = url.searchParams.get("q") ?? "";
      const m = /^name = '((?:[^'\\]|\\.)*)' and '([^']+)' in parents and trashed = false and mimeType (=|!=) '([^']+)'$/.exec(q);
      if (!m) return json(400, { error: `unexpected q: ${q}` });
      const name = m[1]!.replace(/\\(.)/g, "$1");
      const files = [...this.files.values()].filter((f) => f.name === name && f.parents.includes(m[2]!) && (m[3] === "=" ? f.mimeType === m[4] : f.mimeType !== m[4]));
      return json(200, { files: files.map((f) => ({ id: f.id, name: f.name, size: String(f.content.length), ...(f.mimeType.startsWith("application/vnd.google-apps") ? {} : { sha256Checksum: sha(f.content) }), appProperties: f.appProperties })) });
    }
    if (method === "POST" && url.pathname === "/drive/v3/files") {
      const meta = JSON.parse(String(init.body)) as { name: string; mimeType: string; parents: string[] };
      const id = `g${++this.n}`;
      this.files.set(id, { id, name: meta.name, parents: meta.parents, mimeType: meta.mimeType, content: Buffer.alloc(0) });
      return json(200, { id });
    }
    if (method === "POST" && url.pathname === "/upload/drive/v3/files" && url.searchParams.get("uploadType") === "multipart") {
      const boundary = /boundary=(\S+)/.exec(String((init.headers as Record<string, string>)["Content-Type"]))![1]!;
      const body = init.body as Buffer;
      const parts = body.toString("latin1").split(`--${boundary}`);
      const meta = JSON.parse(parts[1]!.split("\r\n\r\n")[1]!.trim()) as { name: string; parents: string[]; mimeType: string; appProperties?: Record<string, string> };
      const start = body.indexOf("\r\n\r\n", body.indexOf(`--${boundary}`, body.indexOf(`--${boundary}`) + 1)) + 4;
      const end = body.lastIndexOf(`\r\n--${boundary}--`);
      const id = `g${++this.n}`;
      this.files.set(id, { id, name: meta.name, parents: meta.parents, mimeType: meta.mimeType, content: Buffer.from(body.subarray(start, end)), appProperties: meta.appProperties });
      return json(200, { id });
    }
    const upd = /^\/upload\/drive\/v3\/files\/([^/]+)$/.exec(url.pathname);
    if (method === "PATCH" && upd && url.searchParams.get("uploadType") === "media") {
      const f = this.files.get(decodeURIComponent(upd[1]!));
      if (!f) return json(404, {});
      f.content = Buffer.from(String(init.body));
      return json(200, { id: f.id });
    }
    const get = /^\/drive\/v3\/files\/([^/]+)$/.exec(url.pathname);
    if (method === "GET" && get && url.searchParams.get("alt") === "media") {
      const f = this.files.get(decodeURIComponent(get[1]!));
      return f ? new Response(f.content, { status: 200 }) : json(404, {});
    }
    return json(400, { error: `unexpected ${method} ${url.pathname}` });
  };
}

interface GItem { id: string; name: string; parent: string | null; folder: boolean; content: Buffer }

export class FakeGraph {
  readonly items = new Map<string, GItem>([["root", { id: "root", name: "root", parent: null, folder: true, content: Buffer.alloc(0) }]]);
  readonly calls: string[] = [];
  private n = 0;
  constructor(readonly driveId = "drive-1") {}

  private resolve(path: string): GItem | undefined {
    let cur = this.items.get("root")!;
    for (const name of path.split("/").map(decodeURIComponent)) {
      const next = [...this.items.values()].find((i) => i.parent === cur.id && i.name === name);
      if (!next) return undefined;
      cur = next;
    }
    return cur;
  }

  private view(i: GItem) {
    return i.folder ? { id: i.id, name: i.name, folder: { childCount: 0 } } : { id: i.id, name: i.name, size: i.content.length, file: { hashes: { sha256Hash: sha(i.content).toUpperCase() } } };
  }

  fetch = async (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(String(input));
    const method = init.method ?? "GET";
    const p = url.pathname.replace(`/v1.0/drives/${this.driveId}`, "");
    this.calls.push(`${method} ${p}`);
    if (!String((init.headers as Record<string, string>)?.Authorization ?? "").startsWith("Bearer ")) return json(401, {});
    if (method === "GET" && p === "/root") return json(200, this.view(this.items.get("root")!));
    const byPath = /^\/root:\/(.+)$/.exec(p);
    if (method === "GET" && byPath) { const i = this.resolve(byPath[1]!); return i ? json(200, this.view(i)) : json(404, { error: { code: "itemNotFound" } }); }
    const children = /^\/items\/([^/]+)\/children$/.exec(p);
    if (method === "POST" && children) {
      const body = JSON.parse(String(init.body)) as { name: string };
      const parent = decodeURIComponent(children[1]!);
      if ([...this.items.values()].some((i) => i.parent === parent && i.name === body.name)) return json(409, { error: { code: "nameAlreadyExists" } });
      const id = `i${++this.n}`;
      this.items.set(id, { id, name: body.name, parent, folder: true, content: Buffer.alloc(0) });
      return json(201, this.view(this.items.get(id)!));
    }
    const put = /^\/items\/([^/:]+):\/([^/:]+):\/content$/.exec(p);
    if (method === "PUT" && put) {
      const id = `i${++this.n}`;
      this.items.set(id, { id, name: decodeURIComponent(put[2]!), parent: decodeURIComponent(put[1]!), folder: false, content: Buffer.from(init.body as Buffer) });
      return json(201, this.view(this.items.get(id)!));
    }
    const content = /^\/items\/([^/]+)\/content$/.exec(p);
    if (content) {
      const i = this.items.get(decodeURIComponent(content[1]!));
      if (!i) return json(404, {});
      if (method === "PUT") { i.content = Buffer.from(String(init.body)); return json(200, this.view(i)); }
      return new Response(i.content, { status: 200 });
    }
    return json(400, { error: `unexpected ${method} ${p}` });
  };
}
