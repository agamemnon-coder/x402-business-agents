// D25: Packwise's checkout over HTTP, behind Visa's reference proxy (which forwards /product/* to port 3000). It listens
// on loopback only (127.0.0.1 and ::1), reads the request exactly as received (raw header lines, body bytes), and
// answers with our merchant layer's verdict (src/visa/tapMerchant.ts): 200 accepted, 422 refused, both as JSON. The
// card is charged by the caller after a 200, under the agent's own origin (src/visa/tapRail.ts). The interop test
// runs this same server (test/interop/tap-interop.ts).

import { createServer, type IncomingMessage, type Server } from "node:http";
import type { DB } from "../db/open.js";
import { verifyTapCheckout, type TapMerchantConfig, type TapMerchantVerdict } from "./tapMerchant.js";

export interface TapReceived { method: string; url: string; rawHeaders: string[]; body: Buffer; verdict: TapMerchantVerdict }
export interface TapMerchantServer { port: number; hosts: string[]; close(): Promise<void> }

/** The JSON our merchant answers with: the verdict, nothing secret in it. */
export type TapMerchantAnswer = { accepted: boolean; verdict: TapMerchantVerdict };

const MAX_BODY = 64 * 1024;

export async function startTapMerchant(db: DB, cfg: TapMerchantConfig, o: { port: number; hosts?: string[]; now?: () => number; onReceived?: (r: TapReceived) => void }): Promise<TapMerchantServer> {
  const handle = (req: IncomingMessage, body: Buffer): { status: number; answer: TapMerchantAnswer } => {
    const verdict = verifyTapCheckout(db, { method: req.method ?? "", target: req.url ?? "", rawHeaders: req.rawHeaders, body }, cfg, o.now?.());
    o.onReceived?.({ method: req.method ?? "", url: req.url ?? "", rawHeaders: [...req.rawHeaders], body, verdict });
    return { status: verdict.ok ? 200 : 422, answer: { accepted: verdict.ok, verdict } };
  };
  const listen = (host: string) => new Promise<Server | string>((ok) => {
    const server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      let size = 0;
      req.on("data", (c: Buffer) => { size += c.length; if (size <= MAX_BODY) chunks.push(c); });
      req.on("end", () => {
        const r = size > MAX_BODY ? { status: 413, answer: { accepted: false, verdict: { ok: false, reason: "body too large", sig1: "not checked", sig2: "not checked" } as TapMerchantVerdict } } : handle(req, Buffer.concat(chunks));
        res.writeHead(r.status, { "content-type": "application/json" }).end(JSON.stringify(r.answer));
      });
    });
    server.once("error", (e: NodeJS.ErrnoException) => ok(e.code ?? "error"));
    server.listen(o.port, host, () => ok(server));
  });
  const wanted = o.hosts ?? ["127.0.0.1", "::1"];
  const servers: Server[] = [];
  const hosts: string[] = [];
  for (const h of wanted) {
    const s = await listen(h);
    // An address family this machine does not have (no ::1): nothing else can listen there either, so it is skipped.
    if (s === "EADDRNOTAVAIL" || s === "EAFNOSUPPORT") continue;
    if (typeof s === "string") {
      // Review, 2 November: every address that exists must bind, or the proxy may reach something else on the port.
      await Promise.all(servers.map((x) => new Promise<void>((ok) => x.close(() => ok()))));
      throw new Error(`Packwise's checkout could not listen on ${h} port ${o.port} (${s})`);
    }
    servers.push(s);
    hosts.push(h);
  }
  if (!servers.length) throw new Error(`Packwise's checkout could not listen on port ${o.port}`);
  const addr = servers[0]!.address();
  return {
    port: typeof addr === "object" && addr ? addr.port : o.port,
    hosts,
    close: () => Promise.all(servers.map((s) => new Promise<void>((ok) => s.close(() => ok())))).then(() => undefined),
  };
}
