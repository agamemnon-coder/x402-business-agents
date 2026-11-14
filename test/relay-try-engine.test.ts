// The hands-on demo on the site's own address (worker/src/tryEngine.ts): with the TRY_ENGINE service binding, the site
// passes /try and exactly the paths its page calls to purser-try, the request unchanged; everything else stays the
// site's (/try/sign and under it above all), and without the binding the site answers as before.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isTryEngineRequest, tryEngineResponse, TRY_ENGINE_PATHS, type TryEngine } from "../worker/src/tryEngine.js";
import { tryPage } from "../cloud/src/tryPage.js";
import { INTER_WOFF2_B64 } from "../cloud/src/font.gen.js";
import { pageResponse, type Pages } from "../worker/src/core.js";
import { isTrySignPath } from "../worker/src/trySign.js";
import { X402_PATH } from "../worker/src/x402.js";
import { METAL_INSPECTOR_PATH } from "../worker/src/metalInspector.js";
import { stripJsonComments } from "./support/wranglerConfig.js";

const SITE = "https://kit11.max-31b.workers.dev";
const req = (method: string, path: string) => new Request(`${SITE}${path}`, { method, ...(method === "POST" ? { body: "{}", headers: { origin: SITE, "content-type": "application/json" } } : {}) });

/** Every request the demo's page makes, with a sample id where the path has one. */
const PAGE_CALLS: [string, string][] = [
  ["GET", "/try"], ["HEAD", "/try"],
  ["POST", "/v1/try/start"], ["POST", "/v1/try/session"],
  ["GET", "/v1/engine"], ["GET", "/v1/engine/events?after=0&limit=200"], ["GET", "/v1/engine/samples"], ["POST", "/v1/engine/samples/clean"],
  ["GET", "/v1/engine/suppliers"], ["POST", "/v1/engine/compose"], ["GET", "/v1/engine/invoices"], ["POST", "/v1/engine/invoices/AP-0001/pay"],
  ["GET", "/v1/engine/proposals/P-0001"], ["GET", "/v1/engine/proposals/P-0001/terms"], ["POST", "/v1/engine/proposals/P-0001/approve"],
  ["POST", "/v1/engine/proposals/P-0001/pay"], ["POST", "/v1/engine/proposals/P-0001/retry"], ["POST", "/v1/engine/passkey/start"],
  ["POST", "/v1/engine/passkey/finish"], ["GET", "/v1/engine/vault"], ["GET", "/v1/engine/vault/file?path=a.pdf"], ["GET", "/v1/engine/export"], ["GET", "/v1/engine/export.pdf"],
  ["GET", "/v1/payments?cursor=x"], ["GET", "/v1/transactions"], ["GET", "/v1/ledger/entries"],
];

/** The site's own: never passed on, bound or not. */
const SITE_OWN: [string, string][] = [
  ["GET", "/"], ["GET", "/home"], ["GET", "/proof"], ["GET", "/runs"], ["GET", "/try/"], ["POST", "/try"], ["GET", "/try/sign"], ["GET", "/try/sign/x"], ["GET", "/try/verify"],
  ["POST", "/api/try-sign/sign"], ["POST", "/api/try-sign/passkey"], ["POST", "/api/try"], ["GET", "/api/state"], ["POST", "/hooks/airwallex"], ["GET", "/health"], ["GET", "/health/live"],
  ["GET", "/go"], ["POST", X402_PATH], ["GET", METAL_INSPECTOR_PATH], ["GET", "/assets/inter.woff2"], ["GET", "/assets/approve.js"], ["GET", "/favicon.ico"],
  // The cloud's other routes: not the demo page's, so not on the site's address.
  ["GET", "/v1/me"], ["POST", "/v1/admin/tenants"], ["POST", "/v1/try/admin"], ["GET", "/v1/try/ops"], ["POST", "/v1/engine/documents"], ["POST", "/v1/engine/sync"],
  ["GET", "/v1/openapi.json"], ["GET", "/v1/engine/proposals/P-0001/terms/x"], ["GET", "/v1/engine/invoices/AP-0001/pay"], ["DELETE", "/v1/engine"],
];

describe("the paths the site passes to purser-try", () => {
  it("are every call of the demo's page, and nothing else", () => {
    for (const [m, p] of PAGE_CALLS) expect(isTryEngineRequest(m, new URL(p, SITE).pathname), `${m} ${p}`).toBe(true);
    for (const [m, p] of SITE_OWN) expect(isTryEngineRequest(m, p), `${m} ${p}`).toBe(false);
    // An explicit list, each pattern anchored at both ends: no catch-all.
    for (const [, re] of TRY_ENGINE_PATHS) expect(re.source).toMatch(/^\^.*\$$/);
  });

  it("follows the page: every path it names is in the list above (a new call fails here until it is passed on)", () => {
    const html = tryPage("n", { origin: "https://x.test", rpId: "x.test" });
    const named = [...new Set([...html.matchAll(/['"`(](\/(?:v1|try|assets)\/?[A-Za-z0-9_./-]*)/g)].map((m) => m[1]!))].sort();
    expect(named).toEqual([
      "/assets/inter.woff2", "/try", "/v1/engine", "/v1/engine/compose", "/v1/engine/events", "/v1/engine/export", "/v1/engine/export.pdf", "/v1/engine/invoices", "/v1/engine/invoices/",
      "/v1/engine/passkey/finish", "/v1/engine/passkey/start", "/v1/engine/proposals/", "/v1/engine/samples", "/v1/engine/samples/", "/v1/engine/suppliers",
      "/v1/engine/vault", "/v1/engine/vault/file", "/v1/ledger/entries", "/v1/payments", "/v1/transactions", "/v1/try/session", "/v1/try/start",
    ]);
    for (const p of named) if (!p.endsWith("/") && p !== "/assets/inter.woff2") expect(PAGE_CALLS.some(([, c]) => new URL(c, SITE).pathname === p), p).toBe(true);
  });

  it("leaves /try/sign and everything under it to the site", () => {
    for (const p of ["/try/sign", "/api/try-sign", "/api/try-sign/sign"]) {
      expect(isTryEngineRequest("GET", p)).toBe(false);
      expect(isTryEngineRequest("POST", p)).toBe(false);
    }
    for (const [m, p] of PAGE_CALLS) expect(isTrySignPath(new URL(p, SITE).pathname), `${m} ${p}`).toBe(false);
  });

  it("collides with the site's pages only at /try, on purpose; the page's font is the site's own file, the same bytes", () => {
    const pages = { csp: {}, images: {}, font: "", try: "the site's /try", client: "", css: "" } as unknown as Pages;
    const hits = PAGE_CALLS.filter(([m, p]) => pageResponse(req(m, p), pages) !== null).map(([m, p]) => `${m} ${p}`);
    expect(hits).toEqual(["GET /try", "HEAD /try"]);
    expect(INTER_WOFF2_B64).toBe(readFileSync(new URL("../src/ui/inter.woff2", import.meta.url)).toString("base64"));
  });
});

describe("tryEngineResponse", () => {
  /** A stand-in for the service binding: records what it was handed. */
  const standIn = () => {
    const seen: Request[] = [];
    const engine: TryEngine = { fetch: async (r) => { seen.push(r); return new Response(`purser-try ${new URL(r.url).pathname}`, { status: 200 }); } };
    return { engine, seen };
  };

  it("passes the request itself, unchanged (URL, method, headers, body), and answers with purser-try's response", async () => {
    const { engine, seen } = standIn();
    const r = req("POST", "/v1/engine/passkey/start");
    const res = await tryEngineResponse(r, engine)!;
    expect(seen).toEqual([r]);
    expect(seen[0]).toBe(r);
    expect(seen[0]!.url).toBe(`${SITE}/v1/engine/passkey/start`);
    expect(seen[0]!.headers.get("origin")).toBe(SITE);
    expect(await res.text()).toBe("purser-try /v1/engine/passkey/start");
    expect(await (await tryEngineResponse(req("GET", "/try"), engine)!).text()).toBe("purser-try /try");
  });

  it("is null for the site's own paths, and for every path without the binding (the site answers as today)", () => {
    const { engine, seen } = standIn();
    for (const [m, p] of SITE_OWN) expect(tryEngineResponse(req(m, p), engine), `${m} ${p}`).toBeNull();
    for (const [m, p] of PAGE_CALLS) expect(tryEngineResponse(req(m, p), undefined), `${m} ${p}`).toBeNull();
    expect(seen).toEqual([]);
  });

  it("is wired into the Worker after /go and before the pages, with the binding in wrangler.jsonc naming purser-try", () => {
    const index = readFileSync(new URL("../worker/src/index.ts", import.meta.url), "utf8");
    expect(index).toMatch(/TRY_ENGINE\?: Fetcher;/);
    expect(index).toMatch(/tryEngineResponse\(req, env\.TRY_ENGINE\)/);
    expect(index.indexOf("goResponse(req")).toBeLessThan(index.indexOf("tryEngineResponse(req"));
    expect(index.indexOf("tryEngineResponse(req")).toBeLessThan(index.indexOf("pageResponse(req"));
    const strip = (s: string) => JSON.parse(stripJsonComments(s)) as { name: string; services?: { binding: string; service: string }[] };
    const relay = strip(readFileSync(new URL("../worker/wrangler.jsonc", import.meta.url), "utf8"));
    const engine = strip(readFileSync(new URL("../cloud/wrangler.try.jsonc", import.meta.url), "utf8"));
    expect(relay.services).toEqual([{ binding: "TRY_ENGINE", service: engine.name }]);
    expect(engine.name).toBe("purser-try");
  });
});
