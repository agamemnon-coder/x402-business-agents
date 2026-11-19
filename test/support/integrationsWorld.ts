// A company for the integration tests (the SDKs, the n8n node, the chat notifier): Purser Cloud in this process with
// its engine (test money, the stand-in bank), one supplier invoice uploaded and fed to the read model, and an API key
// with the read and propose scopes, as an owner makes one for an agent or an integration. No network.
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { EN } from "../fakes/apInvoices.js";
import { pdfOf } from "../fakes/pdf.js";
import { ORIGIN, testCloud, type TestCloud, type TestTenant } from "./cloud.js";

export interface IntegrationsWorld {
  c: TestCloud;
  A: TestTenant;
  /** read + propose: what an agent or integration gets. */
  proposeKey: string;
  /** read only. */
  readKey: string;
}

export async function integrationsWorld(slug = "northwind"): Promise<IntegrationsWorld> {
  const c = testCloud({ engine: true });
  const A = await c.tenant(slug);
  if ((await c.req("POST", "/v1/company", { key: A.session, body: { language: "en" } })).status !== 200) throw new Error("language");
  const up = await c.req("POST", "/v1/engine/documents", { key: A.session, body: { filename: "bergtex-BTX-2026-21.pdf", mime: "application/pdf", base64: (await pdfOf(EN)).toString("base64") } });
  if (up.status !== 200) throw new Error(`upload: ${JSON.stringify(up.json)}`);
  if ((await c.req("POST", "/v1/engine/sync", { key: A.session })).status !== 200) throw new Error("sync");
  const k = async (scopes: string[]) => {
    const r = await c.req("POST", "/v1/keys", { key: A.session, body: { name: `integration ${scopes.join("+")}`, scopes } });
    if (r.status !== 201) throw new Error(`key: ${JSON.stringify(r.json)}`);
    return r.json.api_key as string;
  };
  return { c, A, proposeKey: await k(["read", "propose"]), readKey: await k(["read"]) };
}

/** The test cloud behind a real HTTP listener on 127.0.0.1 (for a client in another process, such as Python's). */
export async function listen(c: TestCloud): Promise<{ base: string; server: Server }> {
  const server = createServer((req, res) => {
    const parts: Buffer[] = [];
    req.on("data", (d: Buffer) => parts.push(d));
    req.on("end", () => {
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
      const body = parts.length ? Buffer.concat(parts) : undefined;
      void c.fetch(`${ORIGIN}${req.url ?? "/"}`, { method: req.method, headers, ...(body && req.method !== "GET" ? { body } : {}) }).then(async (r) => {
        res.writeHead(r.status, Object.fromEntries(r.headers));
        res.end(Buffer.from(await r.arrayBuffer()));
      }, () => { res.writeHead(500); res.end(); });
    });
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, server };
}
