// Security sweep 3, 15 Nov (docs/audit/security-sweep-2026-11-15.md): the baseline headers on every answer of the cloud,
// not only on its pages; a page's own policy and the CORS headers are kept. Failed before cloud/src/baseHeaders.ts.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { INERT_CSP, PERMISSIONS_POLICY, withBaseline } from "../cloud/src/baseHeaders.js";
import { testCloud, type TestCloud } from "./support/cloud.js";

let c: TestCloud;
beforeEach(() => { c = testCloud({ engine: true, tryIt: { claude: false } }); });
afterEach(() => c.close());

const BASE = {
  "strict-transport-security": "max-age=31536000; includeSubDomains",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
  "cross-origin-opener-policy": "same-origin",
  "permissions-policy": PERMISSIONS_POLICY,
};
const expectBase = (h: Headers, except: string[] = []) => {
  for (const [k, v] of Object.entries(BASE)) if (!except.includes(k)) expect(h.get(k), k).toBe(v);
};

describe("S4: the baseline headers on the cloud's JSON answers, redirects and plain text", () => {
  it("a JSON error and a JSON answer carry the full set and a CSP that allows nothing", async () => {
    for (const r of [await c.req("GET", "/v1/engine", { key: null }), await c.req("GET", "/v1/try/admin", { key: null }), await c.req("GET", "/v1/nope", { key: null })]) {
      expect(r.res.headers.get("content-type")).toMatch(/^application\/json/);
      expectBase(r.res.headers);
      expect(r.res.headers.get("content-security-policy")).toBe(INERT_CSP);
    }
  });

  it("the console's typed-path redirect and the plain 404 carry them too", async () => {
    const r = await c.req("GET", "/console", { key: null });
    expect(r.status).toBe(302);
    expect(r.res.headers.get("location")).toBe("/#/sign-in");
    expectBase(r.res.headers);
    expect(r.res.headers.get("content-security-policy")).toBe(INERT_CSP);
    const nf = await c.req("GET", "/no-such-page", { key: null });
    expect(nf.status).toBe(404);
    expectBase(nf.res.headers);
    expect(nf.res.headers.get("content-security-policy")).toBe(INERT_CSP);
  });

  it("keeps each page's own policy: the console's nonce CSP, and the PDF frame's SAMEORIGIN and sandbox CSP", async () => {
    const page = await c.req("GET", "/", { key: null });
    expect(page.res.headers.get("content-security-policy")).toMatch(/script-src 'nonce-[^']+' 'self'/);
    expectBase(page.res.headers);
    const pdf = await c.req("GET", "/pdfview", { key: null });
    expect(pdf.res.headers.get("x-frame-options")).toBe("SAMEORIGIN");
    expect(pdf.res.headers.get("content-security-policy")).toMatch(/^sandbox allow-scripts;/);
    expectBase(pdf.res.headers, ["x-frame-options"]);
  });

  it("never touches CORS headers, the status, the body or a header the answer set, and adds no CSP to a script or font", async () => {
    const js = withBaseline(new Response("export {}", { status: 200, headers: { "content-type": "text/javascript", "access-control-allow-origin": "*", "cross-origin-resource-policy": "cross-origin", "cache-control": "public, max-age=86400" } }));
    expect(js.headers.get("access-control-allow-origin")).toBe("*");
    expect(js.headers.get("cross-origin-resource-policy")).toBe("cross-origin");
    expect(js.headers.get("cache-control")).toBe("public, max-age=86400");
    expect(js.headers.get("content-security-policy")).toBeNull();
    expect(await js.text()).toBe("export {}");
    const font = withBaseline(new Response(new Uint8Array([1, 2]), { headers: { "content-type": "font/woff2" } }));
    expect(font.headers.get("content-security-policy")).toBeNull();
    expectBase(font.headers);
    const own = withBaseline(new Response("{}", { status: 418, statusText: "teapot", headers: { "content-type": "application/json", "referrer-policy": "same-origin", "content-security-policy": "default-src 'self'" } }));
    expect([own.status, own.statusText]).toEqual([418, "teapot"]);
    expect(own.headers.get("referrer-policy")).toBe("same-origin");
    expect(own.headers.get("content-security-policy")).toBe("default-src 'self'");
    // An HTML answer without its own CSP is left without one: a policy that allows nothing would blank it.
    expect(withBaseline(new Response("<p>x</p>", { headers: { "content-type": "text/html" } })).headers.get("content-security-policy")).toBeNull();
  });
});
