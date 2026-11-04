// A local stand-in for the relay Worker: the same logic (worker/src/core.ts) over an in-memory SQLite, served on
// http://localhost:<port>. For trying the phone pages on a laptop (localhost counts as a secure context for
// passkeys), for judges without a Cloudflare account, and for the browser check. The real relay runs on Cloudflare.

import { mfaOn } from "./config.js";
import Database from "better-sqlite3";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { pageResponse, Relay, type Sql } from "../../worker/src/core.js";
import { buildPages } from "./assets.js";

/** The Durable Object's SQL call shape over better-sqlite3. */
export function sqlOver(db: Database.Database): Sql {
  return {
    exec(query, ...bindings) {
      const st = db.prepare(query);
      const rows = st.reader ? st.all(...bindings) : (st.run(...bindings), []);
      return { toArray: () => rows };
    },
  };
}

export async function startLocalRelay(opts: { port: number; token: string }): Promise<{ server: Server; url: string; relay: Relay }> {
  const relay = new Relay(sqlOver(new Database(":memory:")), { relayToken: opts.token, mfa: mfaOn() });
  const pages = buildPages();
  let base = "";
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      void (async () => {
        try {
          const headers = new Headers();
          for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
          const method = req.method ?? "GET";
          const request = new Request(`${base}${req.url ?? "/"}`, { method, headers, body: method === "GET" || method === "HEAD" ? undefined : Buffer.concat(chunks) });
          const response = pageResponse(request, pages)
            ?? (new URL(request.url).pathname.startsWith("/api/") ? await relay.fetch(request) : new Response("not found", { status: 404 }));
          res.writeHead(response.status, Object.fromEntries(response.headers));
          res.end(Buffer.from(await response.arrayBuffer()));
        } catch (e) {
          res.writeHead(500, { "content-type": "text/plain" });
          res.end(`error: ${(e as Error).message}`);
        }
      })();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port, "127.0.0.1", () => resolve());
  });
  // Pages and passkeys use the name localhost (a secure context); the origin check compares against it.
  base = `http://localhost:${(server.address() as AddressInfo).port}`;
  return { server, url: base, relay };
}
