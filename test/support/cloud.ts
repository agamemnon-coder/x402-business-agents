// Purser Cloud in a test: the Worker's own request handler over better-sqlite3 and a temporary directory (no network,
// no Cloudflare). The platform admin token is a test value; its hash is what the cloud is configured with.
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handle, type CloudEnv } from "../../cloud/src/app.js";
import type { EngineApi } from "../../cloud/src/engine/api.js";
import { dirBlobs, sqliteSql } from "../../cloud/src/node.js";
import { d1Sql, type Sql } from "../../cloud/src/store.js";
import { softPasskey } from "../../src/metal/softPasskey.js";

export const ADMIN_TOKEN = "test-platform-admin-token-not-a-secret";
export const RP = "cloud.test";
export const ORIGIN = "https://cloud.test";

export interface TestCloud {
  env: CloudEnv;
  dir: string;
  clock: { now: Date };
  req(method: string, path: string, o?: { key?: string | null; body?: unknown; raw?: string; headers?: Record<string, string> }): Promise<{ status: number; json: Record<string, unknown> & { error?: string }; res: Response }>;
  fetch: (input: string, init?: RequestInit) => Promise<Response>;
  /**
   * A company as its owner leaves the first run: the owner's passkey enrolled with the starter key (which that revokes),
   * signed in, and a full read+sync+admin key made with that session. { bare: true }: straight after the platform made
   * it, with only the starter key (as `key`) and no passkey.
   */
  tenant(slug: string, opts?: { bare?: boolean }): Promise<TestTenant>;
  close(): void;
}

export interface TestTenant {
  id: string;
  /** A full key (read, sync, admin) the owner made; with { bare: true }, the starter key. */
  key: string;
  owner: string;
  /** The starter key the platform handed over (revoked once the owner's passkey exists). */
  starter: string;
  /** The owner's session (15 minutes on the test clock) and passkey; empty with { bare: true }. */
  session: string;
  ownerPasskey: { pk: ReturnType<typeof softPasskey>; credential_id: string };
}

const b64u = (u: Uint8Array) => Buffer.from(u).toString("base64url");

/** { tryIt }: the hands-on demo's routes (/v1/try, cloud/src/try/), with { engine: true }. */
/** { engine: true }: every company gets an engine in this process (cloud/src/engine/node.ts), so the /v1/engine routes answer. */
export function testCloud(opts: { rate?: CloudEnv["rate"]; engine?: boolean; tryIt?: CloudEnv["tryIt"] } = {}): TestCloud {
  const dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "cloud-"));
  // npm run test:d1 (CLOUD_DB=d1, test/support/d1.ts): a fresh local D1 database instead of better-sqlite3.
  const d1 = globalThis.__cloudD1?.next();
  const sql: Sql & { close(): void } = d1 ? { ...d1Sql(d1), close: () => {} } : sqliteSql(":memory:");
  const clock = { now: new Date("2026-11-08T12:00:00Z") };
  const env: CloudEnv = {
    sql, blobs: dirBlobs(join(dir, "blobs")), sessionSecret: "s".repeat(48),
    adminTokenSha256: createHash("sha256").update(ADMIN_TOKEN).digest("hex"), rpId: RP, origin: ORIGIN, now: () => clock.now,
    rate: opts.rate ?? { perMinute: 100_000, signInPerMinute: 100_000 },
    ...(opts.tryIt ? { tryIt: opts.tryIt } : {}),
  };
  if (opts.engine) {
    // Loaded on first use: the engine is a large graph, and a cloud test that never asks for it does not pay for it.
    let engines: Promise<(tenantId: string) => EngineApi> | null = null;
    const load = () => (engines ??= import("../../cloud/src/engine/node.js").then((m) => m.nodeEngines({ sql, blobs: env.blobs, rpId: RP, origin: ORIGIN, now: () => clock.now })));
    // Every method passes the call on, as the Worker's stub of a company's Durable Object does.
    env.engine = (tenantId) => new Proxy({} as EngineApi, {
      get: (_t, method) => async (...args: unknown[]) => ((await load())(tenantId)[method as keyof EngineApi] as (...a: unknown[]) => unknown)(...args),
    });
  }
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
    async tenant(slug, opts = {}) {
      const r = await req("POST", "/v1/admin/tenants", { key: ADMIN_TOKEN, body: { slug, name: `${slug} test company`, owner: { display_name: "Owner" } } });
      if (r.status !== 201) throw new Error(JSON.stringify(r.json));
      const id = (r.json.tenant as { id: string }).id, starter = r.json.api_key as string, owner = (r.json.owner as { id: string }).id;
      const pk = softPasskey();
      const credential_id = b64u(crypto.getRandomValues(new Uint8Array(16)));
      const bare = { id, key: starter, owner, starter, session: "", ownerPasskey: { pk, credential_id } };
      if (opts.bare) return bare;
      const e = await req("POST", `/v1/users/${owner}/enrolment`, { key: starter });
      const x = Buffer.from(pk.key.qx.slice(2), "hex").toString("base64url");
      const y = Buffer.from(pk.key.qy.slice(2), "hex").toString("base64url");
      const ea = pk.assert("0x00", { challenge: e.json.token as string, origin: ORIGIN, rpId: RP });
      const en = await req("POST", "/v1/auth/enrol", { body: { tenant: slug, enrolment_id: e.json.enrolment_id, token: e.json.token, credential_id, x, y,
        assertion: { authenticatorData: b64u(ea.authenticatorData), clientDataJSON: b64u(ea.clientDataJSON), signature: b64u(ea.signature) } } });
      if (en.status !== 201) throw new Error(`owner enrolment: ${JSON.stringify(en.json)}`);
      const ch = await req("POST", "/v1/auth/challenge", { body: { tenant: slug } });
      const la = pk.assert("0x00", { challenge: ch.json.challenge as string, origin: ORIGIN, rpId: RP });
      const s = await req("POST", "/v1/auth/login", { body: { tenant: slug, challenge_id: ch.json.challenge_id, credential_id,
        assertion: { authenticatorData: b64u(la.authenticatorData), clientDataJSON: b64u(la.clientDataJSON), signature: b64u(la.signature) } } });
      if (s.status !== 200) throw new Error(`owner sign-in: ${JSON.stringify(s.json)}`);
      const session = s.json.session as string;
      const k = await req("POST", "/v1/keys", { key: session, body: { name: "owner (test, full)", scopes: ["read", "sync", "admin"] } });
      if (k.status !== 201) throw new Error(`owner key: ${JSON.stringify(k.json)}`);
      return { ...bare, key: k.json.api_key as string, session };
    },
    close() { sql.close(); rmSync(dir, { recursive: true, force: true }); },
  };
}
