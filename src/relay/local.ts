// A local stand-in for the relay Worker: the same logic (worker/src/core.ts) over an in-memory SQLite, served on
// http://localhost:<port>. For trying the phone pages on a laptop (localhost counts as a secure context for
// passkeys), for judges without a Cloudflare account, and for the browser check. The real relay runs on Cloudflare.

import { mfaOn } from "./config.js";
import Database from "better-sqlite3";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { notFoundResponse, pageResponse, Relay, type Sql } from "../../worker/src/core.js";
import { isTrySignPath, trySignNotFound, TrySignDesk } from "../../worker/src/trySign.js";
import { METAL_INSPECTOR_PATH, localInspector } from "../../worker/src/metalInspector.js";
import type { FxSource } from "../../worker/src/fxQuote.js";
import type { InvoiceReadSource } from "../try/claude.js";
import type { AgentAsk } from "../try/world.js";
import type { RecordedAgents } from "../try/recorded.js";
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

export async function startLocalRelay(opts: { port: number; token: string; /** /try/sign's FX quote source (the browser checks pass a stand-in; none: the recorded quote). */ trySignFx?: FxSource;
  /** Section 6: /try/sign's invoice reader (the browser checks pass a labelled stand-in; "off": the emergency switch; none: code reads, labelled). */ trySignReader?: InvoiceReadSource | "off";
  /** Spec 6b: /try/sign's Treasury agent advice (the browser checks pass a labelled stand-in; "off"; none: the fixed sentence). */ trySignAdvisor?: AgentAsk | "off";
  /** The recorded agents' outputs (default: the bundle's docs/demo/try-agents-recorded.json, when it exists; null: none). */ trySignRecorded?: RecordedAgents | null }): Promise<{ server: Server; url: string; relay: Relay }> {
  const relay = new Relay(sqlOver(new Database(":memory:")), { relayToken: opts.token, mfa: mfaOn() });
  const pages = buildPages();
  // /try/sign's test worlds, as on the Worker: their own store (another in-memory database), only when the bundle has the page.
  const trySign = pages.trySign ? new TrySignDesk(sqlOver(new Database(":memory:")), { fx: opts.trySignFx ?? null, reader: opts.trySignReader ?? null, advisor: opts.trySignAdvisor ?? null, recorded: opts.trySignRecorded === undefined ? pages.tryAgentsRecorded ?? null : opts.trySignRecorded, rate: pages.exposureRate ?? null }) : null;
  // /metal's inspector, as a local copy answers it: the bundle's recorded read, no chain call (the Worker reads the chain).
  const metal = localInspector(pages.metalRecorded ?? null);
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
          const path = new URL(request.url).pathname;
          const response = pageResponse(request, pages)
            ?? (isTrySignPath(path) ? await (trySign ? trySign.fetch(request) : trySignNotFound()) : null)
            ?? (path === METAL_INSPECTOR_PATH ? await metal.fetch(request) : null)
            ?? (path.startsWith("/api/") || path === "/health" || path === "/health/live" ? await relay.fetch(request) : notFoundResponse(pages));
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
