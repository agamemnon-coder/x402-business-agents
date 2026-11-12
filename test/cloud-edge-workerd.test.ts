// cloud/src/edge/ for real: the cloud Worker's entry point bundled by wrangler with the settings of cloud/wrangler.jsonc,
// its Rate Limiting bindings (ratelimits) as the config gives them, run in local workerd with the engine's Durable
// Object, local D1 and local R2. One company uploads an invoice and writes to its engine until the ENGINE_LIMITER
// binding turns it away; the counters behind GET /v1/stats are written after each answer (ctx.waitUntil); and the
// Worker's scheduled handler, fired as the Cron Trigger fires it, runs the nightly autopilot, whose digest GET
// /v1/autopilot then shows.
//
// Runs only with CLOUD_DB=d1 (npm run test:d1), where wrangler's toolchain is installed (npm ci --prefix worker).
// Local only: no network, no Cloudflare account, nothing kept (the stores are in memory and thrown away).
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sessionToken } from "../cloud/src/auth.js";
import type { AutopilotRun } from "../cloud/src/edge/autopilot.js";
import type { DayCounts } from "../cloud/src/edge/stats.js";
import { EN } from "./fakes/apInvoices.js";
import { pdfOf } from "./fakes/pdf.js";
import { ADMIN_TOKEN, ORIGIN, RP } from "./support/cloud.js";
import { aliasOf, cloudWranglerConfig, fromConfig } from "./support/wranglerConfig.js";

interface Workerd { ready: Promise<void>; fetch(url: string, init?: RequestInit): Promise<Response>; dispose(): Promise<void> }
interface Wrangler { unstable_startWorker(options: { config: string; dev: Record<string, unknown> }): Promise<Workerd> }
type Answer = { status: number; json: Record<string, unknown> & { error?: string } };

const D1 = process.env.CLOUD_DB === "d1";
/** Test values, not secrets: the session secret of this local Worker and the hash of the tests' admin token. */
const SESSION_SECRET = "s".repeat(48);
const ADMIN_TOKEN_SHA256 = createHash("sha256").update(ADMIN_TOKEN).digest("hex");

describe("Cloudflare's platform behind the cloud (local workerd): the rate limiter, the counters, the nightly autopilot", () => {
  if (!D1) {
    it.skip("skipped in the plain run: it needs wrangler's toolchain and runs with npm run test:d1", () => undefined);
    return;
  }

  const config = cloudWranglerConfig() as ReturnType<typeof cloudWranglerConfig> & { ratelimits: unknown[] };
  let dir: string;
  let workerd: Workerd | undefined;
  let session: string;

  const req = async (method: string, path: string, o: { key?: string; body?: unknown } = {}): Promise<Answer> => {
    const headers: Record<string, string> = {};
    if (o.key) headers.authorization = `Bearer ${o.key}`;
    if (o.body !== undefined) headers["content-type"] = "application/json";
    const res = await workerd!.fetch(`${ORIGIN}${path}`, { method, headers, ...(o.body !== undefined ? { body: JSON.stringify(o.body) } : {}) });
    const text = await res.text();
    let json: Record<string, unknown> = {};
    try { json = JSON.parse(text) as Record<string, unknown>; } catch { /* not JSON */ }
    return { status: res.status, json };
  };
  const today = async (): Promise<DayCounts> => ((await req("GET", "/v1/stats?days=1")).json.days as DayCounts[])[0]!;

  beforeAll(async () => {
    // Nothing here may leave the machine: no proxy, no metrics, no request of Miniflare's own.
    for (const k of ["HTTPS_PROXY", "HTTP_PROXY", "https_proxy", "http_proxy", "ALL_PROXY", "all_proxy"]) delete process.env[k];
    process.env.WRANGLER_SEND_METRICS = "false";
    process.env.CLOUDFLARE_CF_FETCH_ENABLED = "false";
    const wrangler = createRequire(resolve("worker/package.json"))("wrangler") as Wrangler;
    dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "cloud-edge-"));
    // cloud/wrangler.jsonc itself, its rate limiters included as they are, with local stores and this test's vars.
    writeFileSync(join(dir, "wrangler.json"), JSON.stringify({
      name: config.name, main: fromConfig(config.main), compatibility_date: config.compatibility_date, compatibility_flags: config.compatibility_flags,
      durable_objects: config.durable_objects, migrations: config.migrations, define: config.define, alias: aliasOf(config), rules: config.rules,
      ratelimits: config.ratelimits,
      d1_databases: [{ binding: config.d1_databases[0]!.binding, database_name: config.d1_databases[0]!.database_name, database_id: "00000000-0000-0000-0000-000000000002" }],
      ...(config.r2_buckets?.length ? { r2_buckets: [{ binding: config.r2_buckets[0]!.binding, bucket_name: config.r2_buckets[0]!.bucket_name }] } : {}),
      vars: { RP_ID: RP, ORIGIN, ENGINE_MODE: "test_money", SESSION_SECRET, ADMIN_TOKEN_SHA256 },
    }));
    workerd = await wrangler.unstable_startWorker({ config: join(dir, "wrangler.json"), dev: { persist: false, watch: false, remote: false, inspector: false, testScheduled: true, logLevel: "error", server: { hostname: "127.0.0.1", port: 0 } } });
    await workerd.ready;
    const r = await req("POST", "/v1/admin/tenants", { key: ADMIN_TOKEN, body: { slug: "northwind", name: "northwind test company", owner: { display_name: "Owner" } } });
    expect(r.status, JSON.stringify(r.json)).toBe(201);
    session = await sessionToken(SESSION_SECRET, { tenantId: (r.json.tenant as { id: string }).id, userId: (r.json.owner as { id: string }).id, role: "owner", gen: 0 }, new Date());
  }, 240_000);

  afterAll(async () => {
    await Promise.race([workerd?.dispose().catch(() => undefined), new Promise((r) => setTimeout(r, 10_000))]);
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("takes an upload, then turns the company's engine writes away with 429 once ENGINE_LIMITER's 20 a minute are used", async () => {
    const up = await req("POST", "/v1/engine/documents", { key: session, body: { filename: "bergtex-BTX-2026-21.pdf", mime: "application/pdf", base64: Buffer.from(await pdfOf(EN)).toString("base64") } });
    expect(up.status, JSON.stringify(up.json)).toBe(200);
    let allowed = 1, refused: Answer | null = null;
    // The binding counts per minute: a minute that turns over during the loop lets up to 20 more through.
    while (!refused && allowed <= 40) {
      const r = await req("POST", "/v1/engine/sync", { key: session });
      if (r.status === 429) refused = r; else { expect(r.status, JSON.stringify(r.json)).toBe(200); allowed++; }
    }
    expect(refused?.json).toEqual({ error: expect.stringMatching(/too many uploads, payments or approvals/), code: "rate_limited" });
    expect(allowed).toBeGreaterThanOrEqual(20);
    // Reads go on.
    expect((await req("GET", "/v1/engine/invoices", { key: session })).status).toBe(200);
  }, 120_000);

  it("counts after each answer: the upload, the requests and the rate-limited one are in today's counters", async () => {
    // The upload was written at once; the rest is kept in the isolate and written with a count ten seconds on.
    let d = await today();
    for (let i = 0; i < 200 && !(d.uploads === 1 && d.rate_limited >= 1); i++) { await new Promise((r) => setTimeout(r, 100)); d = await today(); }
    expect(d).toMatchObject({ uploads: 1, rate_limited: 1, approvals: 0 });
    expect(d.requests).toBeGreaterThanOrEqual(23);
  }, 30_000);

  it("runs the nightly autopilot when the Cron Trigger fires: the company's digest of today, both chains whole", async () => {
    const fired = await workerd!.fetch(`${ORIGIN}/__scheduled?cron=${encodeURIComponent("17 3 * * *")}`);
    expect(fired.status).toBe(200);
    const items = (await req("GET", "/v1/autopilot", { key: session })).json.items as AutopilotRun[];
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ day: new Date().toISOString().slice(0, 10), status: "done", error: null });
    expect(items[0]!.digest).toMatchObject({ mode: "test_money", invoices: { total: 1, by_status: { ready: 1 } }, chains: { audit: true, ledger: true } });
    // Once a day: a second firing runs nothing more.
    await workerd!.fetch(`${ORIGIN}/__scheduled?cron=${encodeURIComponent("17 3 * * *")}`);
    expect((await req("GET", "/v1/autopilot", { key: session })).json.items).toHaveLength(1);
  }, 120_000);
});
