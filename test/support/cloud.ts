// Purser Cloud in a test: the Worker's own request handler over better-sqlite3 and a temporary directory (no network,
// no Cloudflare). The platform admin token is a test value; its hash is what the cloud is configured with.
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handle, type CloudEnv } from "../../cloud/src/app.js";
import { dirBlobs, sqliteSql } from "../../cloud/src/node.js";

export const ADMIN_TOKEN = "test-platform-admin-token-not-a-secret";
export const RP = "cloud.test";
export const ORIGIN = "https://cloud.test";

export interface TestCloud {
  env: CloudEnv;
  dir: string;
  clock: { now: Date };
  req(method: string, path: string, o?: { key?: string | null; body?: unknown; raw?: string; headers?: Record<string, string> }): Promise<{ status: number; json: Record<string, unknown> & { error?: string }; res: Response }>;
  fetch: (input: string, init?: RequestInit) => Promise<Response>;
  tenant(slug: string): Promise<{ id: string; key: string; owner: string }>;
  close(): void;
}

export function testCloud(opts: { rate?: CloudEnv["rate"] } = {}): TestCloud {
  const dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "cloud-"));
  const sql = sqliteSql(":memory:");
  const clock = { now: new Date("2026-11-08T12:00:00Z") };
  const env: CloudEnv = {
    sql, blobs: dirBlobs(join(dir, "blobs")), sessionSecret: "s".repeat(48),
    adminTokenSha256: createHash("sha256").update(ADMIN_TOKEN).digest("hex"), rpId: RP, origin: ORIGIN, now: () => clock.now,
    rate: opts.rate ?? { perMinute: 100_000, signInPerMinute: 100_000 },
  };
  const fetchFn = (input: string, init?: RequestInit) => handle(new Request(input, init), env);
  const req: TestCloud["req"] = async (method, path, o = {}) => {
    const headers: Record<string, string> = { ...(o.headers ?? {}) };
    if (o.key) headers.authorization = `Bearer ${o.key}`;
    if (o.body !== undefined || o.raw !== undefined) headers["content-type"] = "application/json";
    const res = await fetchFn(`${ORIGIN}${path}`, { method, headers, ...(o.body !== undefined ? { body: JSON.stringify(o.body) } : o.raw !== undefined ? { body: o.raw } : {}) });
    const text = await res.clone().text();
    let json: Record<string, unknown> = {};
    try { json = JSON.parse(text) as Record<string, unknown>; } catch { /* a document or raw mail */ }
    return { status: res.status, json, res };
  };
  return {
    env, dir, clock, req, fetch: fetchFn,
    async tenant(slug) {
      const r = await req("POST", "/v1/admin/tenants", { key: ADMIN_TOKEN, body: { slug, name: `${slug} test company`, owner: { display_name: "Owner" } } });
      if (r.status !== 201) throw new Error(JSON.stringify(r.json));
      return { id: (r.json.tenant as { id: string }).id, key: r.json.api_key as string, owner: (r.json.owner as { id: string }).id };
    },
    close() { sql.close(); rmSync(dir, { recursive: true, force: true }); },
  };
}
