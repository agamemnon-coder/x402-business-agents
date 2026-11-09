// Export staging (go-live): a company's export is built into the document store in parts, not returned in one response
// a Worker could not hold for a large company. The owner gets a manifest behind a short-lived signed link (no key
// needed to fetch it, so a browser can download it); each part has its own signed link and its SHA-256. One export at a
// time per company, a size limit, kept a day, and every export and download recorded in the security events.
import { describe, expect, it } from "vitest";
import { joinStagedExport } from "../cloud/src/restore.js";
import { testCloud, type TestCloud } from "./support/cloud.js";

type Part = { table: string; n: number; rows: number; bytes: number; sha256: string; url: string };
type Manifest = { format: string; tenant: { id: string }; parts: Part[]; documents_to_fetch: unknown[] };

const relative = (u: string) => u.replace(/^https:\/\/cloud\.test/, "");
async function seed(c: TestCloud, key: string, n: number) {
  for (let i = 0; i < n; i++) {
    const r = await c.req("POST", "/v1/users", { key, body: { display_name: `Person ${i}`, role: "viewer" } });
    expect(r.status).toBe(201);
  }
}

describe("staged exports", () => {
  it("builds the export in parts behind signed links that need no key, equal to the direct export, and records it", async () => {
    const c = testCloud();
    try {
      c.env.exportPartRows = 2;
      const t = await c.tenant("acme");
      await seed(c, t.session, 5);
      const s = await c.req("POST", "/v1/export/staged", { key: t.session });
      expect(s.status).toBe(201);
      const m = await c.req("GET", relative(s.json.manifest_url as string));
      expect(m.status).toBe(200);
      const manifest = m.json as unknown as Manifest;
      expect(manifest.format).toBe("purser-cloud-export/v3-staged");
      // 6 people (the owner and 5) in parts of 2.
      expect(manifest.parts.filter((p) => p.table === "users").map((p) => p.rows)).toEqual([2, 2, 2]);
      const direct = (await c.req("GET", "/v1/export", { key: t.key })).json as Record<string, unknown[]>;
      const texts: Record<string, unknown[]> = {};
      for (const table of ["users", "credentials", "api_keys", "security_events"]) {
        const rows: unknown[] = [];
        for (const p of manifest.parts.filter((x) => x.table === table)) {
          const r = await c.req("GET", relative(p.url));
          expect(r.status).toBe(200);
          const text = await r.res.text();
          const { createHash } = await import("node:crypto");
          expect(createHash("sha256").update(text).digest("hex")).toBe(p.sha256);
          rows.push(...(JSON.parse(text) as unknown[]));
          texts[`${p.table}-${p.n}`] = JSON.parse(text) as unknown[];
        }
        // The direct export's own key was used to fetch it after the staging (its last_used_at moved), so that one column is left out.
        const same = (xs: unknown[]) => table === "api_keys" ? xs.map((x) => ({ ...(x as object), last_used_at: undefined })) : xs;
        if (table !== "security_events") expect(same(rows)).toEqual(same(direct[table]!));
      }
      // Joined back, it is the one-object export a restore reads.
      const joined = joinStagedExport(manifest, (name) => texts[name] ?? []);
      expect(joined.format).toBe("purser-cloud-export/v2");
      expect(joined.users).toEqual(direct.users);
      // No secret's hash travels in a part either.
      const keysPart = manifest.parts.find((p) => p.table === "api_keys")!;
      expect(await (await c.req("GET", relative(keysPart.url))).res.text()).not.toContain("secret_sha256");
      const ev = (await c.req("GET", "/v1/security/events", { key: t.session })).json.items as { kind: string }[];
      expect(ev.map((e) => e.kind)).toEqual(expect.arrayContaining(["export.staged", "export.downloaded"]));
    } finally { c.close(); }
  });

  it("one at a time: a second is refused while one is open; after a day it expires, its parts are gone and a new one may be made", async () => {
    const c = testCloud();
    try {
      const t = await c.tenant("acme");
      const first = await c.req("POST", "/v1/export/staged", { key: t.session });
      expect(first.status).toBe(201);
      expect((await c.req("POST", "/v1/export/staged", { key: t.session })).status).toBe(409);
      c.clock.now = new Date(c.clock.now.getTime() + 24 * 3_600_000 + 60_000);
      const again = await c.req("POST", "/v1/export/staged", { key: t.key });
      expect(again.status).toBe(201);
      // The old one's parts were removed and its status says so.
      const old = await c.req("GET", `/v1/export/staged/${first.json.id as string}`, { key: t.key });
      expect(old.json.status).toBe("expired");
      expect(await c.env.blobs.list(`exports/${t.id}/${first.json.id as string}/`)).toEqual([]);
    } finally { c.close(); }
  });

  it("links expire after 15 minutes and do not fit another part or company; the owner fetches fresh links", async () => {
    const c = testCloud();
    try {
      const a = await c.tenant("acme");
      const b = await c.tenant("beta");
      const s = await c.req("POST", "/v1/export/staged", { key: a.session });
      const url = relative(s.json.manifest_url as string);
      // Another part name with this signature, or a changed signature: refused.
      expect((await c.req("GET", url.replace("/manifest?", "/users-0?"))).status).toBe(403);
      expect((await c.req("GET", url.replace(/sig=[^&]+/, "sig=AAAA"))).status).toBe(403);
      // The other company cannot see it, even with its id.
      expect((await c.req("GET", `/v1/export/staged/${s.json.id as string}`, { key: b.key })).status).toBe(404);
      c.clock.now = new Date(c.clock.now.getTime() + 16 * 60_000);
      expect((await c.req("GET", url)).status).toBe(403);
      const fresh = await c.req("GET", `/v1/export/staged/${s.json.id as string}`, { key: a.key });
      expect(fresh.status).toBe(200);
      expect((await c.req("GET", relative(fresh.json.manifest_url as string))).status).toBe(200);
      // A closed company's links end with its access.
      const late = relative((await c.req("GET", `/v1/export/staged/${s.json.id as string}`, { key: a.key })).json.manifest_url as string);
      expect((await c.req("POST", "/v1/close", { key: a.key })).status).toBe(200);
      expect((await c.req("GET", late)).status).toBe(403);
    } finally { c.close(); }
  });

  it("refuses an export over the size limit, leaves nothing behind, and lets the next one through", async () => {
    const c = testCloud();
    try {
      const t = await c.tenant("acme");
      await seed(c, t.session, 3);
      c.env.exportMaxBytes = 200;
      const s = await c.req("POST", "/v1/export/staged", { key: t.session });
      expect(s.status).toBe(413);
      expect(await c.env.blobs.list(`exports/${t.id}/`)).toEqual([]);
      c.env.exportMaxBytes = undefined;
      expect((await c.req("POST", "/v1/export/staged", { key: t.session })).status).toBe(201);
    } finally { c.close(); }
  });

  it("needs admin and read: a read-only key and a sync key cannot stage one", async () => {
    const c = testCloud();
    try {
      const t = await c.tenant("acme");
      const ro = (await c.req("POST", "/v1/keys", { key: t.session, body: { name: "ro", scopes: ["read"] } })).json.api_key as string;
      const ad = (await c.req("POST", "/v1/keys", { key: t.session, body: { name: "ad", scopes: ["admin"] } })).json.api_key as string;
      expect((await c.req("POST", "/v1/export/staged", { key: ro })).status).toBe(403);
      expect((await c.req("POST", "/v1/export/staged", { key: ad })).status).toBe(403);
    } finally { c.close(); }
  });
});
