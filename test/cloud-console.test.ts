// Purser Cloud's console (cloud/src/console.ts): one page under a strict, per-response nonce policy, its script parses
// and only ever writes values as text, the font it serves is the repo's, and the API it talks to refuses a state change
// from another site. The routes the console added (/v1/company, the richer /v1/me) are owner-only where they change
// something and stay inside the caller's company.
import { readFileSync } from "node:fs";
import { Script } from "node:vm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { consolePage } from "../cloud/src/console.js";
import { INTER_WOFF2_B64 } from "../cloud/src/font.gen.js";
import { scriptBlocks } from "./support/scriptBlocks.js";
import { ORIGIN, RP, testCloud, type TestCloud } from "./support/cloud.js";

let c: TestCloud;
let t: { id: string; key: string; owner: string };
beforeEach(async () => { c = testCloud(); t = await c.tenant("acme"); });
afterEach(() => c.close());

const script = (html: string) => {
  const blocks = scriptBlocks(html);
  expect(blocks).toHaveLength(1);
  return blocks[0]!.replace(/^<script[^>]*>/, "").replace(/<\/script>$/, "");
};

describe("the console page", () => {
  it("is served at / with a fresh nonce on its one script and its one stylesheet, and a strict policy", async () => {
    const a = await c.fetch(`${ORIGIN}/`);
    const b = await c.fetch(`${ORIGIN}/`);
    expect(a.status).toBe(200);
    expect(a.headers.get("content-type")).toMatch(/text\/html/);
    const csp = a.headers.get("content-security-policy")!;
    const n = /'nonce-([^']+)'/.exec(csp)![1]!;
    expect(n).not.toBe(/'nonce-([^']+)'/.exec(b.headers.get("content-security-policy")!)![1]);
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain(`script-src 'nonce-${n}'`);
    expect(csp).toContain(`style-src 'nonce-${n}'`);
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toMatch(/unsafe-(inline|eval)/);
    const html = await a.text();
    expect(html).toContain(`<script type="module" nonce="${n}">`);
    expect(html).toContain(`<style nonce="${n}">`);
    expect(a.headers.get("x-content-type-options")).toBe("nosniff");
    expect(a.headers.get("referrer-policy")).toBe("no-referrer");
    expect(a.headers.get("permissions-policy")).toContain("publickey-credentials-get=(self)");
  });

  it("has no inline handlers, no javascript: links and no style attributes, and its script parses", () => {
    const html = consolePage("n0nce", { origin: ORIGIN, rpId: RP, mailDomain: "in.purser.test" });
    const markup = html.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<style[\s\S]*?<\/style>/g, "");
    expect(markup).not.toMatch(/\son[a-z]+\s*=/i);
    expect(markup).not.toMatch(/javascript:/i);
    expect(markup).not.toMatch(/\sstyle\s*=/i);
    // A module script parses as a function body once its import-free top level is wrapped.
    expect(() => new Script(`(async()=>{${script(html)}})`)).not.toThrow();
  });

  it("writes every value from the API as text: innerHTML only ever receives the page's own icons", () => {
    const js = script(consolePage("n", { origin: ORIGIN, rpId: RP, mailDomain: "" }));
    const uses = [...js.matchAll(/\.innerHTML\s*=\s*([^;]+);/g)].map((m) => m[1]!.trim());
    expect(uses).toEqual(["IC[name]||''"]);
    expect(js).not.toMatch(/insertAdjacentHTML|outerHTML\s*=|document\.write|eval\(|new Function/);
  });

  it("carries its config escaped in a meta tag", () => {
    const html = consolePage("n", { origin: 'https://x"><script>alert(1)</script>', rpId: RP, mailDomain: "" });
    expect(html).not.toContain('"><script>alert(1)');
    expect(html).toContain("&quot;&gt;&lt;script&gt;");
  });

  it("serves the repo's own font, and nothing else outside /v1", async () => {
    const f = await c.fetch(`${ORIGIN}/assets/inter.woff2`);
    expect(f.status).toBe(200);
    expect(f.headers.get("content-type")).toBe("font/woff2");
    expect(Buffer.from(await f.arrayBuffer()).equals(readFileSync("src/ui/inter.woff2"))).toBe(true);
    expect(INTER_WOFF2_B64).toBe(readFileSync("src/ui/inter.woff2").toString("base64"));
    expect((await c.fetch(`${ORIGIN}/admin`)).status).toBe(404);
    expect((await c.fetch(`${ORIGIN}/.env`)).status).toBe(404);
    expect((await c.fetch(`${ORIGIN}/`, { method: "POST" })).status).toBe(405);
  });
});

describe("the API behind the console", () => {
  it("refuses a state change sent from another site, and takes one from its own origin or from a program", async () => {
    const make = (origin?: string) => c.req("POST", "/v1/keys", { key: t.key, body: { name: "x", scopes: ["read"] }, headers: origin ? { origin } : {} });
    const evil = await make("https://evil.example");
    expect(evil.status).toBe(403);
    expect(evil.json).toMatchObject({ code: "forbidden" });
    expect((await make(ORIGIN)).status).toBe(201);
    expect((await make()).status).toBe(201);
    // A page elsewhere can still not read: reads need the bearer token the console keeps in its own tab.
    expect((await c.req("GET", "/v1/invoices", { headers: { origin: "https://evil.example" } })).status).toBe(401);
    const sync = await c.req("POST", "/v1/sync", { key: t.key, body: {}, headers: { origin: "null" } });
    expect(sync.status).toBe(403);
  });

  it("/v1/me tells the console who is calling, whether an owner has a passkey, and the inbox once mail is routed", async () => {
    // A new company: only the starter key, no passkey yet.
    const fresh = await c.tenant("fresh", { bare: true });
    expect((await c.req("GET", "/v1/me", { key: fresh.key })).json).toMatchObject({ user: { id: fresh.owner, display_name: "Owner", role: "owner" }, owner_has_passkey: false, inbox: null });
    const me = await c.req("GET", "/v1/me", { key: t.key });
    expect(me.json).toMatchObject({ user: { id: t.owner, display_name: "Owner", role: "owner" }, owner_has_passkey: true, inbox: null });
    c.env.mailDomain = "in.purser.test";
    expect((await c.req("GET", "/v1/me", { key: t.key })).json.inbox).toBe("acme@in.purser.test");
  });

  it("renames the company for an owner only, and only that company", async () => {
    const other = await c.tenant("other");
    expect((await c.req("POST", "/v1/company", { key: t.key, body: { name: "Acme B.V." } })).json).toEqual({ name: "Acme B.V.", language: "nl" });
    expect((await c.req("GET", "/v1/me", { key: t.key })).json.tenant).toMatchObject({ name: "Acme B.V.", slug: "acme" });
    expect((await c.req("GET", "/v1/me", { key: other.key })).json.tenant).toMatchObject({ name: "other test company" });
    const reader = (await c.req("POST", "/v1/keys", { key: t.key, body: { name: "r", scopes: ["read"] } })).json.api_key as string;
    expect((await c.req("POST", "/v1/company", { key: reader, body: { name: "Hacked" } })).status).toBe(403);
    expect((await c.req("POST", "/v1/company", { key: t.key, body: { name: "" } })).status).toBe(400);
    expect((await c.req("POST", "/v1/company", { key: t.key, body: { name: "x".repeat(201) } })).status).toBe(400);
    expect((await c.req("POST", "/v1/company", { body: { name: "No key" } })).status).toBe(401);
  });
});
