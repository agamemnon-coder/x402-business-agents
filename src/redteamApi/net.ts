// The red team v2's plumbing (npm run redteam:api): an HTTP client that can lie (any Host, Origin, Content-Length, a
// chunked body, a chosen source address on loopback), a second local server for the attacks on the limits, and a clock
// that can be moved forward in this process. Everything listens on and talks to 127.0.0.0/8 only; nothing here reaches
// the internet, Airwallex, Alta or Anthropic.
//
// The two servers:
//  - the judge (src/cli/judge.ts, `npm run judge`): the site and /try exactly as a judge without internet runs them. Its
//    per-address limits are lifted on purpose ("one person on their own computer", src/cli/judgeTry.ts) and it sets
//    cf-connecting-ip to 127.0.0.1 for every request, so it cannot show the start or rate limits.
//  - the edge stand-in (edgeServer below): the same Purser Cloud handler (cloud/src/app.ts) and engine, with the hosted
//    deployment's defaults (rate limits of CloudEnv, the start limits of cloud/src/try/switches.ts) and, in front of it,
//    what Cloudflare's edge does: cf-connecting-ip is the TCP peer's address, whatever the client sent. Each attack that
//    needs another address connects from another loopback address (127.0.0.2, 127.0.1.9, ...).
import { createHash, randomBytes } from "node:crypto";
import { request as httpRequest, createServer, type IncomingHttpHeaders, type Server } from "node:http";
import { Readable } from "node:stream";
import { handle, type CloudEnv } from "../../cloud/src/app.js";
import { sqlBlobs } from "../../cloud/src/blobsSql.js";
import { nodeEngines } from "../../cloud/src/engine/node.js";
import { sqliteSql } from "../../cloud/src/node.js";

export interface Answer { status: number; headers: IncomingHttpHeaders; text: string; json: Record<string, unknown> | null; ms: number; error?: string }

export interface Send {
  method: string;
  path: string;
  headers?: Record<string, string>;
  /** A JSON value (sent as JSON), or raw text/bytes as given. */
  json?: unknown;
  raw?: string | Uint8Array;
  /** Send the body in pieces with Transfer-Encoding: chunked (no Content-Length). */
  chunked?: boolean;
  /** The loopback address to connect from (127.x.y.z). */
  from?: string;
  timeoutMs?: number;
}

/** One HTTP request to `base` (http://localhost:<port> or http://127.0.0.1:<port>) with exactly the headers given. */
export function send(base: string, s: Send): Promise<Answer> {
  const url = new URL(base);
  const started = Date.now();
  const body = s.json !== undefined ? Buffer.from(JSON.stringify(s.json)) : s.raw === undefined ? null : Buffer.from(s.raw);
  const headers: Record<string, string> = { ...(s.headers ?? {}) };
  if (s.json !== undefined && !Object.keys(headers).some((k) => k.toLowerCase() === "content-type")) headers["content-type"] = "application/json";
  if (body && !s.chunked && !Object.keys(headers).some((k) => k.toLowerCase() === "content-length")) headers["content-length"] = String(body.length);
  if (s.chunked) headers["transfer-encoding"] = "chunked";
  // Always to 127.0.0.1; the Host header names the base's host (localhost:<port>) unless the attack sets its own.
  if (!Object.keys(headers).some((k) => k.toLowerCase() === "host")) headers.host = url.host;
  return new Promise((resolve) => {
    const r = httpRequest({ host: "127.0.0.1", port: Number(url.port), method: s.method, path: s.path, headers, setHost: false,
      ...(s.from ? { localAddress: s.from } : {}), timeout: s.timeoutMs ?? 60_000 }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let json: Record<string, unknown> | null = null;
        try { const v = JSON.parse(text) as unknown; json = v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null; } catch { /* a page or a file */ }
        resolve({ status: res.statusCode ?? 0, headers: res.headers, text, json, ms: Date.now() - started });
      });
      res.on("error", (e) => resolve({ status: 0, headers: {}, text: "", json: null, ms: Date.now() - started, error: e.message }));
    });
    r.on("timeout", () => { r.destroy(new Error("timed out")); });
    r.on("error", (e) => resolve({ status: 0, headers: {}, text: "", json: null, ms: Date.now() - started, error: e.message }));
    if (body && s.chunked) {
      // In pieces of 64 KB, as a client streaming an upload would; the server must stop reading at its cap.
      let at = 0;
      const next = () => {
        while (at < body.length) {
          const piece = body.subarray(at, at + 65_536);
          at += piece.length;
          if (!r.write(piece)) { r.once("drain", next); return; }
        }
        r.end();
      };
      r.on("error", () => { at = body.length; });
      next();
    } else r.end(body ?? undefined);
  });
}

/** A loopback address other than 127.0.0.1 can be bound here (Linux routes all of 127.0.0.0/8 to lo). */
export async function loopbackAliases(base: string): Promise<boolean> {
  const a = await send(base, { method: "GET", path: "/v1/health", from: "127.0.0.2", timeoutMs: 5_000 });
  return !a.error;
}

export interface EdgeServer {
  base: string;
  origin: string;
  /** The platform admin token of this server, made here and kept in this process only. */
  admin: string;
  env: CloudEnv;
  /** One request straight into the handler, with cf-connecting-ip as the edge would set it (for IPv6 addresses). */
  direct(req: Request, ip: string): Promise<Response>;
  close(): Promise<void>;
}

/**
 * Purser Cloud's /try with the hosted deployment's defaults, behind a stand-in for Cloudflare's edge: the client's
 * cf-connecting-ip (and every other address header) is dropped and the TCP peer's address is set instead. `switches`
 * are set with the admin token at start ("starts" on; anything else as given).
 */
export async function edgeServer(switches: Record<string, string> = {}): Promise<EdgeServer> {
  let handler: ((req: Request) => Promise<Response>) | null = null;
  const server: Server = createServer((req, res) => {
    void (async () => {
      if (!handler) { res.statusCode = 503; res.end(); return; }
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) {
        if (k === "cf-connecting-ip" || v === undefined) continue;
        headers.set(k, Array.isArray(v) ? v.join(", ") : v);
      }
      const peer = (req.socket.remoteAddress ?? "unknown").replace(/^::ffff:/, "");
      headers.set("cf-connecting-ip", peer);
      const hasBody = req.method !== "GET" && req.method !== "HEAD";
      const init: RequestInit & { duplex?: "half" } = { method: req.method, headers, ...(hasBody ? { body: Readable.toWeb(req) as ReadableStream, duplex: "half" } : {}) };
      let r: Response;
      try { r = await handler(new Request(`${origin}${req.url ?? "/"}`, init)); } catch (e) {
        res.statusCode = 599; res.end(`edge stand-in: the handler threw ${(e as Error).message}`); return;
      }
      res.statusCode = r.status;
      r.headers.forEach((v, k) => { if (k !== "set-cookie" && k !== "content-length") res.setHeader(k, v); });
      res.end(Buffer.from(await r.arrayBuffer()));
    })().catch(() => { if (!res.headersSent) { res.statusCode = 599; } res.end(); });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  const origin = `http://localhost:${port}`;
  const admin = randomBytes(24).toString("hex");
  const sql = sqliteSql(":memory:");
  const env: CloudEnv = {
    sql, blobs: sqlBlobs(sql), sessionSecret: randomBytes(32).toString("hex"), adminTokenSha256: createHash("sha256").update(admin).digest("hex"),
    rpId: "localhost", origin, tryIt: {},
  };
  env.engine = nodeEngines({ sql, blobs: env.blobs, rpId: env.rpId, origin });
  handler = (req) => handle(req, env);
  for (const [key, value] of Object.entries({ starts: "on", ...switches })) {
    const r = await handle(new Request(`${origin}/v1/try/admin`, { method: "POST", headers: { authorization: `Bearer ${admin}`, "content-type": "application/json" }, body: JSON.stringify({ op: "set", key, value }) }), env);
    if (r.status !== 200) throw new Error(`edge stand-in: switch ${key} answered ${r.status}`);
  }
  return {
    base: `http://127.0.0.1:${port}`, origin, admin, env,
    direct: (req, ip) => { const h = new Headers(req.headers); h.set("cf-connecting-ip", ip); return handle(new Request(req, { headers: h }), env); },
    close: () => new Promise((r) => { server.closeAllConnections(); server.close(() => r()); sql.close(); }),
  };
}

/**
 * A clock for this process that can be moved forward: Date (and Date.now) answer real time plus an offset. The engine
 * runs on the real clock (cloud/src/engine/node.ts), so "a day later" is only reachable this way. Undo with reset().
 */
export function shiftableClock(): { advance(ms: number): void; reset(): void } {
  const Real = globalThis.Date;
  let offset = 0;
  class Shifted extends Real {
    constructor(...a: unknown[]) {
      if (a.length === 0) super(Real.now() + offset);
      else super(...(a as [string]));
    }
    static override now(): number { return Real.now() + offset; }
  }
  globalThis.Date = Shifted as DateConstructor;
  return { advance: (ms) => { offset += ms; }, reset: () => { offset = 0; globalThis.Date = Real; } };
}
