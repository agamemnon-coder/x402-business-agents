// The cloud Worker itself in Cloudflare's own runtime: cloud/src/worker.ts bundled and started in workerd (locally,
// through the miniflare that comes with the wrangler pinned in worker/), in demo mode over local D1 and R2. What a demo
// deployment would run, short of Cloudflare's network: the bundle loads, the demo's reads answer from real D1 and R2,
// everything else is refused, and nothing is written. Only with CLOUD_DB=d1 (npm run test:d1), where that toolchain is
// installed; the plain run skips it. Nothing leaves this machine.
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SCHEMA } from "../cloud/src/schema.js";
import { splitScript, type D1Like } from "../cloud/src/store.js";

const onD1 = process.env.CLOUD_DB === "d1";

interface Runtime {
  dispatchFetch(url: string, init?: RequestInit): Promise<Response>;
  getD1Database(name: string): Promise<D1Like>;
  getR2Bucket(name: string): Promise<{ put(key: string, value: Uint8Array): Promise<unknown> }>;
  dispose(): Promise<void>;
}

const HOST = "http://demo.purser.test";
const PDF = new TextEncoder().encode("%PDF-1.4 a test invoice for the workerd run");
const SHA = createHash("sha256").update(PDF).digest("hex");
const TENANT = "t_workerdalder1";
let demo: Runtime;
let plain: Runtime;
let db: D1Like;

const counts = async () => JSON.stringify(await db.prepare(
  "SELECT (SELECT COUNT(*) FROM rate_hits) AS rate_hits, (SELECT COUNT(*) FROM push_log) AS push_log, (SELECT COUNT(*) FROM api_keys) AS api_keys, (SELECT COUNT(*) FROM tenants) AS tenants, (SELECT COUNT(*) FROM challenges) AS challenges").bind().first());
const get = async (rt: Runtime, path: string, init?: RequestInit) => {
  const r = await rt.dispatchFetch(`${HOST}${path}`, init);
  const bytes = new Uint8Array(await r.arrayBuffer());
  let json: Record<string, unknown> = {};
  try { json = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>; } catch { /* a document or a page */ }
  return { status: r.status, headers: r.headers, bytes, json };
};

// Registered only on the D1 run: the plain run has one test here that says so, and none that is skipped.
if (onD1) describe("the cloud Worker in workerd, in demo mode", () => {
  beforeAll(async () => {
    // The toolchain is wrangler's own: its bundler and its local runtime, as pinned in worker/.
    const fromWorker = createRequire(resolve("worker/package.json"));
    const fromWrangler = createRequire(fromWorker.resolve("wrangler/package.json"));
    const { build } = fromWrangler("esbuild") as { build(o: Record<string, unknown>): Promise<{ outputFiles: { text: string }[] }> };
    const { Miniflare, convertV4MiniflareOptions } = fromWrangler("miniflare") as { Miniflare: new (o: unknown) => Runtime; convertV4MiniflareOptions(o: unknown): unknown };
    // One ES module, as wrangler would make it: for the Workers runtime, Node's built-ins left to nodejs_compat.
    const built = await build({ entryPoints: [resolve("cloud/src/worker.ts")], bundle: true, format: "esm", platform: "neutral", mainFields: ["browser", "module", "main"],
      conditions: ["workerd", "worker", "browser", "import"], external: ["node:*"], outfile: "worker.mjs", write: false, logLevel: "silent" });
    const bundle = built.outputFiles[0]!.text;
    expect(bundle.length).toBeGreaterThan(100_000);
    const worker = (bindings: Record<string, string>, d1: string) => new Miniflare(convertV4MiniflareOptions({
      modules: [{ type: "ESModule", path: "worker.mjs", contents: bundle }], compatibilityDate: "2026-10-01", compatibilityFlags: ["nodejs_compat"],
      d1Databases: { DB: d1 }, r2Buckets: { DOCS: `docs-${d1.slice(-4)}` }, bindings }));
    demo = worker({ DEMO_PUBLIC: "on", DEMO_SLUGS: "alder,never-seeded", RP_ID: "demo.purser.test", ORIGIN: HOST }, "00000000-0000-0000-0000-00000000de01");
    plain = worker({ SESSION_SECRET: "p".repeat(48), ADMIN_TOKEN_SHA256: "", RP_ID: "demo.purser.test", ORIGIN: HOST }, "00000000-0000-0000-0000-00000000de02");
    // The seed, as a seed loads it: the schema and the rows straight into D1, the document straight into R2.
    db = await demo.getD1Database("DB");
    for (const part of splitScript(SCHEMA)) await db.prepare(part).run();
    await db.prepare("INSERT INTO tenants (id, slug, name, language, created_at) VALUES (?, 'alder', 'Alder (test company)', 'en', '2026-11-12T09:00:00.000Z')").bind(TENANT).run();
    await db.prepare("INSERT INTO tenants (id, slug, name, language, created_at) VALUES ('t_workerdother1', 'other-co', 'Not a demo company', 'en', '2026-11-12T09:00:00.000Z')").bind().run();
    await db.prepare("INSERT INTO documents (tenant_id, sha256, filename, mime, size, blob_key, received_at) VALUES (?, ?, 'invoice.pdf', 'application/pdf', ?, ?, '2026-11-12T09:00:00.000Z')").bind(TENANT, SHA, PDF.length, `t/${TENANT}/docs/${SHA}`).run();
    await db.prepare("INSERT INTO invoices (tenant_id, id, vendor, invoice_no, due_date, currency, total, status, doc_sha256, received_at, updated_at, version, body_json, body_sha256) VALUES (?, 'AP-0001', 'Bergtex Textil GmbH', 'BTX-1', '2026-11-30', 'EUR', '100.00', 'paid', ?, '2026-11-12', '2026-11-12', 1, ?, 'x')")
      .bind(TENANT, SHA, JSON.stringify({ vendor: "Bergtex Textil GmbH", invoice_no: "BTX-1", total: "100.00", currency: "EUR", status: "paid" })).run();
    await (await demo.getR2Bucket("DOCS")).put(`t/${TENANT}/docs/${SHA}`, PDF);
  }, 120_000);
  afterAll(async () => { await demo?.dispose(); await plain?.dispose(); });

  it("serves the demo's reads from D1 and R2, remembers them, refuses the rest, and writes nothing", async () => {
    const before = await counts();
    const list = await get(demo, "/v1/demo/companies");
    expect([list.status, list.headers.get("x-purser-cache"), list.headers.get("cache-control")]).toEqual([200, "miss", "public, max-age=60"]);
    expect(list.json).toMatchObject({ test_world: true, read_only: true, companies: [{ slug: "alder", name: "Alder (test company)", language: "en",
      counts: { invoices: 1, invoices_paid: 1, suppliers: 0, payments: 0, transactions: 0, documents: 1, ledger_entries: 0 } }] });
    expect((list.json.companies as unknown[]).length).toBe(1);
    expect((await get(demo, "/v1/demo/companies")).headers.get("x-purser-cache")).toBe("hit");
    expect((await get(demo, "/v1/demo/alder/me")).json).toMatchObject({ tenant: { slug: "alder" }, kind: "demo", scopes: ["read"], user: null, inbox: null });
    expect(((await get(demo, "/v1/demo/alder/invoices")).json.items as { id: string }[]).map((i) => i.id)).toEqual(["AP-0001"]);
    for (const p of [`/v1/demo/alder/documents/${SHA}`, "/v1/demo/alder/invoices/AP-0001/document"]) {
      // Made once, then served from the isolate's memory: the same bytes and headers every time, in this runtime too.
      for (const from of ["miss", "hit", "hit"]) {
        const doc = await get(demo, p);
        expect([doc.status, doc.headers.get("x-purser-cache"), doc.headers.get("content-type"), doc.headers.get("x-content-type-options"), doc.headers.get("content-security-policy")], `${p} (${from})`)
          .toEqual([200, from, "application/pdf", "nosniff", "default-src 'none'; sandbox; frame-ancestors 'none'"]);
        expect(createHash("sha256").update(doc.bytes).digest("hex"), `${p} (${from})`).toBe(SHA);
      }
    }
    // A JSON answer from memory is the answer that was made.
    const made = await get(demo, "/v1/demo/alder/invoices/AP-0001");
    for (let i = 0; i < 2; i++) {
      const kept = await get(demo, "/v1/demo/alder/invoices/AP-0001");
      expect([kept.status, kept.headers.get("x-purser-cache"), kept.json]).toEqual([200, "hit", made.json]);
    }
    expect(made.json).toMatchObject({ id: "AP-0001", vendor: "Bergtex Textil GmbH", total: "100.00" });
    for (const p of ["/v1/demo/alder/insights", "/v1/demo/alder/reports/trial", "/v1/demo/alder/transactions/summary", "/v1/health", "/v1/openapi.json"]) expect((await get(demo, p)).status, p).toBe(200);
    // The health check counts the demo's own companies that are there: "never-seeded" is on the list and not in the database.
    expect((await get(demo, "/v1/health")).json).toEqual({ ok: true, version: "dev", d1: "ok", r2: "ok", demo_companies: 1 });
    // A company that is not a demo company, one that was never seeded and one that does not exist: one answer.
    const other = await get(demo, "/v1/demo/other-co/invoices");
    expect(other.status).toBe(404);
    for (const slug of ["never-seeded", "nobody"]) expect((await get(demo, `/v1/demo/${slug}/invoices`)).json, slug).toEqual(other.json);
    // Everything else.
    for (const [method, path] of [["GET", "/v1/invoices"], ["GET", "/v1/keys"], ["GET", "/v1/admin/companies"], ["POST", "/v1/auth/challenge"], ["POST", "/v1/admin/tenants"], ["POST", "/v1/demo/alder/sync"], ["DELETE", "/v1/keys/k1"]] as const) {
      const r = await get(demo, path, { method, ...(method === "POST" ? { body: "{}", headers: { "content-type": "application/json" } } : {}) });
      expect([r.status, r.json.code], `${method} ${path}`).toEqual([403, "demo_read_only"]);
    }
    expect((await get(demo, "/v1/health", { method: "HEAD" })).status).toBe(403);
    const page = await get(demo, "/");
    expect([page.status, page.headers.get("content-type")]).toEqual([200, "text/html; charset=utf-8"]);
    expect(await counts()).toBe(before);
  }, 60_000);

  it("and with the variable unset, the same bundle is the cloud as it was: no demo routes, a sign-in asked for", async () => {
    expect((await get(plain, "/v1/health")).status).toBe(200);
    const none = await get(plain, "/v1/demo/companies");
    expect([none.status, none.json.error]).toEqual([404, "no such route"]);
    expect((await get(plain, "/v1/invoices")).status).toBe(401);
    expect((await get(plain, "/v1/demo/alder/me")).status).toBe(404);
  }, 60_000);
});

else describe("the cloud Worker in workerd", () => {
  it("is tested with npm run test:d1 only: the Worker toolchain is installed there", () => { expect(process.env.CLOUD_DB).not.toBe("d1"); });
});
