// ASVS 4.0.3 V13.1.5, V13.2.5 and V14.4.2 (docs/security/asvs-l2.md): a JSON body is taken only when the request says
// it is JSON (415 otherwise, before anything is parsed), and every JSON answer is marked as a download
// (Content-Disposition: attachment) with nosniff, so a browser never renders an API answer as a page.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ORIGIN, testCloud, type TestCloud, type TestTenant } from "./support/cloud.js";

let c: TestCloud;
let t: TestTenant;
beforeEach(async () => { c = testCloud(); t = await c.tenant("acme"); });
afterEach(() => c.close());

const post = (path: string, headers: Record<string, string>, body: string) =>
  c.fetch(`${ORIGIN}${path}`, { method: "POST", headers: { authorization: `Bearer ${t.session}`, origin: ORIGIN, ...headers }, body });

describe("a JSON body needs Content-Type: application/json", () => {
  const key = JSON.stringify({ name: "ci", scopes: ["read"] });

  it("is refused with 415 when the type is another one", async () => {
    for (const type of ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data; boundary=x", "application/jsonp", "text/json"]) {
      const r = await post("/v1/keys", { "content-type": type }, key);
      expect(r.status, type).toBe(415);
      expect(await r.json(), type).toEqual({ error: expect.stringContaining("application/json"), code: "unsupported_media_type" });
    }
  });

  it("is refused with 415 when the type is missing, and nothing is made", async () => {
    const before = (await c.req("GET", "/v1/keys", { key: t.session })).json.items as unknown[];
    const r = await post("/v1/keys", {}, key);
    expect(r.status).toBe(415);
    expect(((await c.req("GET", "/v1/keys", { key: t.session })).json.items as unknown[]).length).toBe(before.length);
  });

  it("is taken with application/json, with or without a charset, in any case", async () => {
    for (const type of ["application/json", "application/json; charset=utf-8", "Application/JSON;charset=UTF-8"]) {
      expect((await post("/v1/keys", { "content-type": type }, key)).status, type).toBe(201);
    }
  });

  it("holds on public routes too (a sign-in start)", async () => {
    const r = await c.fetch(`${ORIGIN}/v1/auth/challenge`, { method: "POST", headers: { origin: ORIGIN, "content-type": "text/plain" }, body: JSON.stringify({ tenant: "acme" }) });
    expect(r.status).toBe(415);
  });
});

describe("every JSON answer is a download with nosniff", () => {
  it("on a read, an error and the public health", async () => {
    for (const r of [await c.fetch(`${ORIGIN}/v1/me`, { headers: { authorization: `Bearer ${t.key}` } }), await c.fetch(`${ORIGIN}/v1/no-such`), await c.fetch(`${ORIGIN}/v1/health`)]) {
      expect(r.headers.get("content-type")).toMatch(/^application\/json/);
      expect(r.headers.get("content-disposition")).toBe('attachment; filename="api.json"');
      expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    }
  });

  it("keeps a file's own name (a CSV export) and puts none on a page", async () => {
    const csv = await c.fetch(`${ORIGIN}/v1/export/csv/xero/bills`, { headers: { authorization: `Bearer ${t.key}` } });
    expect(csv.headers.get("content-disposition")).toBe('attachment; filename="purser-bills-xero.csv"');
    const page = await c.fetch(`${ORIGIN}/`);
    expect(page.headers.get("content-type")).toMatch(/^text\/html/);
    expect(page.headers.get("content-disposition")).toBeNull();
  });
});
