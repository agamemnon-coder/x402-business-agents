// The console's open points (9 Nov): an owner invites a person with a one-time link and a QR code instead of passing a
// raw code by hand; the invoice's PDF is drawn in the page with pdf.js (served as the cloud's own asset, never run as a
// page); two companies asking for the same address at once get a 409, not a 500.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { consoleCsp, consolePage } from "../cloud/src/console.js";
import type { Sql } from "../cloud/src/store.js";
import { softPasskey } from "../src/metal/softPasskey.js";
import { ADMIN_TOKEN, ORIGIN, RP, testCloud, type TestCloud } from "./support/cloud.js";

const b64u = (u: Uint8Array) => Buffer.from(u).toString("base64url");
const PDFJS = readFileSync(fileURLToPath(import.meta.resolve("unpdf/pdfjs")));

let c: TestCloud;
let t: { id: string; key: string; owner: string };
beforeEach(async () => { c = testCloud(); t = await c.tenant("acme"); });
afterEach(() => c.close());

async function invite(name = "Fleur") {
  const u = await c.req("POST", "/v1/users", { key: t.key, body: { display_name: name, role: "cfo" } });
  const e = await c.req("POST", `/v1/users/${u.json.id as string}/enrolment`, { key: t.key });
  expect(e.status).toBe(201);
  return e.json as { enrolment_id: string; token: string; expires_at: string; link: string; qr_svg: string };
}
/** Opens the invite link as the console does: everything after #/enrol? is the enrolment. */
function fromLink(link: string) {
  const u = new URL(link);
  expect(u.origin).toBe(ORIGIN);
  expect(u.pathname).toBe("/");
  expect(u.search).toBe("");
  expect(u.hash.startsWith("#/enrol?")).toBe(true);
  const q = new URLSearchParams(u.hash.slice("#/enrol?".length));
  return { tenant: q.get("t")!, enrolment_id: q.get("e")!, token: q.get("k")!, name: q.get("n")! };
}
async function enrolWith(o: { tenant: string; enrolment_id: string; token: string }) {
  const pk = softPasskey();
  const x = Buffer.from(pk.key.qx.slice(2), "hex").toString("base64url");
  const y = Buffer.from(pk.key.qy.slice(2), "hex").toString("base64url");
  const a = pk.assert("0x00", { challenge: o.token, origin: ORIGIN, rpId: RP });
  return c.req("POST", "/v1/auth/enrol", { body: { tenant: o.tenant, enrolment_id: o.enrolment_id, token: o.token, credential_id: b64u(crypto.getRandomValues(new Uint8Array(16))), x, y,
    assertion: { authenticatorData: b64u(a.authenticatorData), clientDataJSON: b64u(a.clientDataJSON), signature: b64u(a.signature) } } });
}

describe("inviting a person", () => {
  it("gives the owner a one-time link to this company's console, with the secret after the # (never sent to a server), and a QR code of it", async () => {
    const e = await invite();
    const l = fromLink(e.link);
    expect(l).toEqual({ tenant: "acme", enrolment_id: e.enrolment_id, token: e.token, name: "Fleur" });
    expect(e.qr_svg.startsWith("<svg")).toBe(true);
    expect(e.qr_svg).toMatch(/<path[^>]+d="M/);
    expect(e.qr_svg).not.toMatch(/<script|on\w+=|href=/i);
    expect(Date.parse(e.expires_at) - c.clock.now.getTime()).toBe(30 * 60_000);
  });

  it("works once: the link enrols the person's passkey, and the same link again is refused", async () => {
    const l = fromLink((await invite()).link);
    expect((await enrolWith(l)).status).toBe(201);
    expect((await enrolWith(l)).status).toBe(401);
  });

  it("is refused after 30 minutes", async () => {
    const l = fromLink((await invite()).link);
    c.clock.now = new Date(c.clock.now.getTime() + 30 * 60_000 + 1000);
    expect((await enrolWith(l)).status).toBe(401);
  });

  it("enrols nobody in another company, even with the right secret", async () => {
    await c.tenant("beta");
    const l = fromLink((await invite()).link);
    const r = await enrolWith({ ...l, tenant: "beta" });
    expect([401, 404]).toContain(r.status);
    expect((await enrolWith(l)).status).toBe(201);
  });
});

describe("the invoice drawn in the page", () => {
  it("serves pdf.js as the cloud's own script, from the bundle's static assets", async () => {
    c.env.asset = async (path) => (path === "/assets/pdfjs.mjs" ? new Response(PDFJS, { headers: { "content-type": "text/javascript" } }) : null);
    const r = await c.fetch(`${ORIGIN}/assets/pdfjs.mjs`);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toMatch(/^text\/javascript/);
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    expect(Buffer.from(await r.arrayBuffer()).equals(PDFJS)).toBe(true);
  });

  it("answers 404 for pdf.js when the bundle carries no assets, and never serves another asset path", async () => {
    expect((await c.fetch(`${ORIGIN}/assets/pdfjs.mjs`)).status).toBe(404);
    c.env.asset = async () => new Response("x");
    expect((await c.fetch(`${ORIGIN}/assets/other.mjs`)).status).toBe(404);
    expect((await c.fetch(`${ORIGIN}/assets/../wrangler.jsonc`)).status).toBe(404);
  });

  it("loads pdf.js only from this origin, with eval off, and draws the pages on a canvas", () => {
    expect(consoleCsp("n")).toContain("script-src 'nonce-n' 'self'");
    const html = consolePage("n", { origin: ORIGIN, rpId: RP, mailDomain: "" });
    expect(html).toContain("import('/assets/pdfjs.mjs')");
    expect(html).toContain("isEvalSupported:false");
    expect(html).toContain("enableXfa:false");
    expect(html).toMatch(/createElement\('canvas'\)/);
  });
});

describe("two companies asking for one address at the same moment", () => {
  it("gives the second a 409, not a 500", async () => {
    // Both requests read before either writes: the second's check sees no company yet, its insert then hits the unique slug.
    const sql: Sql = c.env.sql;
    c.env.sql = { ...sql, first: async (s, p) => (/FROM tenants WHERE slug/.test(s) ? null : sql.first(s, p)) } as Sql;
    const r = await c.req("POST", "/v1/admin/tenants", { key: ADMIN_TOKEN, body: { slug: "acme", name: "Second acme", owner: { display_name: "Owner" } } });
    c.env.sql = sql;
    expect(r.status).toBe(409);
    expect(r.json.code).toBe("conflict");
    expect(((await c.env.sql.all<{ n: number }>("SELECT COUNT(*) AS n FROM tenants WHERE slug = ?", ["acme"]))[0]!).n).toBe(1);
  });
});
