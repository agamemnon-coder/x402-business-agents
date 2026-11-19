// Staged-export links (cloud/src/exports.ts; ASVS 4.0.3 V8.3.1, V13.1.3 in docs/security/asvs-l2.md). A program fetches
// a manifest or a part with its signature in a header (x-purser-export-link) on a URL that carries nothing secret; a
// browser, which cannot send a header on a download, may use the query form. Either way a link is good once and for 15
// minutes, so a link copied out of a history, a log or a Referer is spent or expired; the cloud logs only the route.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { testCloud, type TestCloud, type TestTenant } from "./support/cloud.js";
import { EXPORT_LINKS_SCHEMA } from "../cloud/src/exports.js";

type Link = { url: string; header: string; value: string };
type Part = { table: string; n: number; url: string; link: Link };

let c: TestCloud;
let t: TestTenant;
beforeEach(async () => { c = testCloud(); t = await c.tenant("acme"); });
afterEach(() => { c.close(); vi.restoreAllMocks(); });

const relative = (u: string) => u.replace(/^https:\/\/cloud\.test/, "");
const viaHeader = (l: Link) => c.req("GET", relative(l.url), { headers: { [l.header]: l.value } });

describe("staged-export links", () => {
  it("give a program a URL with nothing secret in it and the signature for a header", async () => {
    const s = await c.req("POST", "/v1/export/staged", { key: t.session });
    expect(s.status).toBe(201);
    const link = s.json.manifest_link as Link;
    expect(link.header).toBe("x-purser-export-link");
    expect(link.url).toMatch(/^https:\/\/cloud\.test\/v1\/export\/download\/x_[A-Za-z0-9]+\/manifest$/);
    expect(link.value).toMatch(/sig=/);
    const m = await viaHeader(link);
    expect(m.status).toBe(200);
    const part = (m.json.parts as Part[]).find((p) => p.table === "users")!;
    expect(part.link.url).not.toContain("?");
    expect((await viaHeader(part.link)).status).toBe(200);
  });

  it("are good once: the same link again, by header or by query, is refused", async () => {
    const s = await c.req("POST", "/v1/export/staged", { key: t.session });
    const link = s.json.manifest_link as Link;
    expect((await viaHeader(link)).status).toBe(200);
    const again = await viaHeader(link);
    expect(again.status).toBe(403);
    expect(again.json.error).toMatch(/used/);
    // The query form is the same link (one nonce): spent by the header download too.
    const query = relative(s.json.manifest_url as string);
    expect(query).toContain("sig=");
    expect((await c.req("GET", query)).status).toBe(403);
    // A fresh one from the owner works, once, in the query form a browser uses.
    const fresh = await c.req("GET", `/v1/export/staged/${s.json.id as string}`, { key: t.key });
    const q2 = relative(fresh.json.manifest_url as string);
    expect((await c.req("GET", q2)).status).toBe(200);
    expect((await c.req("GET", q2)).status).toBe(403);
    // The refused reuse is in the security log, as access denied.
    const denied = await c.env.sql.all<{ kind: string; route: string }>("SELECT kind, route FROM security_log WHERE kind = 'access.denied'");
    expect(denied.some((r) => r.route === "GET /v1/export/download/{id}/{part}")).toBe(true);
  });

  it("refuse a URL with no signature at all, and a header signature moved to another part", async () => {
    const s = await c.req("POST", "/v1/export/staged", { key: t.session });
    const link = s.json.manifest_link as Link;
    expect((await c.req("GET", relative(link.url))).status).toBe(403);
    expect((await c.req("GET", relative(link.url).replace("/manifest", "/users-0"), { headers: { [link.header]: link.value } })).status).toBe(403);
  });

  it("leave no signature in the request log or the security log", async () => {
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((l: unknown) => { lines.push(String(l)); });
    const s = await c.req("POST", "/v1/export/staged", { key: t.session });
    const sig = /sig=([^&]+)/.exec(s.json.manifest_url as string)![1]!;
    expect((await c.req("GET", relative(s.json.manifest_url as string))).status).toBe(200);
    expect(lines.join("\n")).not.toContain(sig);
    expect(JSON.stringify(await c.env.sql.all("SELECT * FROM security_log"))).not.toContain(sig);
  });
});

describe("the D1 migration", () => {
  it("is the table the module makes on first use, word for word", () => {
    const statements = readFileSync("cloud/migrations/0007_export_links.sql", "utf8").split("\n").filter((l) => l.startsWith("CREATE")).map((l) => l.replace(/;$/, ""));
    expect(statements).toEqual([EXPORT_LINKS_SCHEMA]);
  });
});
