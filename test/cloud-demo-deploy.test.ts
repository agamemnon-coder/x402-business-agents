// The demo deployment as it is configured and checked (docs/cloud-demo.md): its own environment in cloud/wrangler.jsonc
// (its own Worker, database and bucket, the demo's variables, no mail, no cron, no secret) while the private preview's
// configuration stays as it was; and the smoke check the runbook runs after a deploy (src/demoworld/smoke.ts): GETs
// only, a bounded number of them, passing on the demo world and failing on anything else. With `npm run test:d1` the
// whole runbook is rehearsed in workerd: the bundle the seed command writes, loaded as the runbook loads it, behind the
// Worker started with the demo environment's own variables, then the smoke check against it. No network.
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import ts from "typescript";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { handle, type CloudEnv } from "../cloud/src/app.js";
import { DEMO_BROWSER_SEC, DEMO_RATE, DEMO_TTL_SEC, demoFromVars } from "../cloud/src/demo.js";
import { SCHEMA } from "../cloud/src/schema.js";
import { splitScript, type D1Like } from "../cloud/src/store.js";
import { localDemo, writeBundle, type BundleManifest, type LocalDemo } from "../src/demoworld/bundle.js";
import { DEMO_COMPANIES } from "../src/demoworld/companies.js";
import { SMOKE_COMPANY_READS, SMOKE_REFUSED, smokeBudget, smokeDemo, type SmokeFetch } from "../src/demoworld/smoke.js";

const onD1 = process.env.CLOUD_DB === "d1";
const SLUGS = DEMO_COMPANIES.map((c) => c.slug);

type Json = Record<string, unknown>;
/** cloud/wrangler.jsonc as wrangler reads it (JSON with comments), through TypeScript's own reader of such files. */
function wranglerConfig(): Json & { env: Record<string, Json> } {
  const r = ts.parseConfigFileTextToJson("wrangler.jsonc", readFileSync("cloud/wrangler.jsonc", "utf8"));
  if (r.error) throw new Error(String(r.error.messageText));
  return r.config as Json & { env: Record<string, Json> };
}

describe("cloud/wrangler.jsonc, the demo's own environment", () => {
  const cfg = wranglerConfig();
  const demo = (cfg.env?.demo ?? {}) as Json;

  it("leaves the private preview's configuration as it was", () => {
    const { env: _env, ...top } = cfg;
    expect(top).toEqual({
      $schema: "../worker/node_modules/wrangler/config-schema.json", name: "purser-cloud", main: "src/worker.ts", compatibility_date: "2026-10-01",
      compatibility_flags: ["nodejs_compat"], workers_dev: false, preview_urls: false,
      d1_databases: [{ binding: "DB", database_name: "purser-cloud", database_id: "SET-AFTER-wrangler-d1-create", migrations_dir: "migrations" }],
      r2_buckets: [{ binding: "DOCS", bucket_name: "purser-cloud-docs", jurisdiction: "eu" }],
      vars: { RP_ID: "cloud.example.invalid", ORIGIN: "https://cloud.example.invalid" },
      assets: { directory: "./public", binding: "ASSETS", run_worker_first: true },
      triggers: { crons: ["17 3 * * *"] },
    });
    expect(Object.keys(cfg.env)).toEqual(["demo"]);
  });

  it("is a Worker of its own on workers.dev, with its own database and bucket", () => {
    expect(demo.name).toBe("purser-demo");
    expect(demo.workers_dev).toBe(true);
    expect(demo.preview_urls).toBe(false);
    const [db] = demo.d1_databases as Json[];
    expect((demo.d1_databases as Json[]).length).toBe(1);
    expect(db).toEqual({ binding: "DB", database_name: "purser-demo", database_id: "SET-AFTER-wrangler-d1-create-purser-demo", migrations_dir: "migrations" });
    expect(demo.r2_buckets).toEqual([{ binding: "DOCS", bucket_name: "purser-demo-docs" }]);
    // Never the preview's stores.
    const top = { db: (cfg.d1_databases as Json[])[0]!, bucket: (cfg.r2_buckets as Json[])[0]! };
    expect(db!.database_name).not.toBe(top.db.database_name);
    expect(db!.database_id).not.toBe(top.db.database_id);
    expect((demo.r2_buckets as Json[])[0]!.bucket_name).not.toBe(top.bucket.bucket_name);
  });

  it("switches demo mode on for the three seeded companies, takes no mail, runs no cron and holds no secret", () => {
    const vars = demo.vars as Record<string, string>;
    expect(Object.keys(vars).sort()).toEqual(["DEMO_PUBLIC", "DEMO_SLUGS", "ORIGIN", "RP_ID"]);
    expect(vars.DEMO_PUBLIC).toBe("on");
    expect(vars.DEMO_SLUGS).toBe(SLUGS.join(","));
    expect(demoFromVars(vars)?.slugs).toEqual(SLUGS);
    // Passkeys and the console's page are bound to the address it is served at: its workers.dev host.
    const origin = new URL(vars.ORIGIN!);
    expect([origin.protocol, origin.pathname, origin.search]).toEqual(["https:", "/", ""]);
    expect(vars.ORIGIN).toBe(`https://${vars.RP_ID}`);
    expect(vars.RP_ID).toMatch(/^purser-demo\.[a-z0-9-]+\.workers\.dev$/);
    expect(demo.triggers).toEqual({ crons: [] });
    const text = readFileSync("cloud/wrangler.jsonc", "utf8");
    expect(text).not.toMatch(/MAIL_DOMAIN"\s*:|SESSION_SECRET"\s*:|ADMIN_TOKEN_SHA256"\s*:|account_id/);
    // Nothing that looks like a key, a token or an account id: no long run of hex or base64.
    expect(text).not.toMatch(/[A-Fa-f0-9]{32,}|[A-Za-z0-9+_-]{48,}/);
  });
});

describe("the smoke check after a deploy (GETs only, bounded)", () => {
  let dir: string;
  let world: LocalDemo;
  beforeAll(async () => {
    dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "demo-smoke-"));
    world = await localDemo(dir);
  }, 120_000);
  afterAll(() => { world?.close(); rmSync(dir, { recursive: true, force: true }); });

  /** The cloud's own handler as the network, recording every request. */
  const over = (env: CloudEnv, seen: { method: string; path: string }[] = [], tamper?: (path: string, r: Response) => Promise<Response> | Response): SmokeFetch => async (url, init) => {
    const u = new URL(url);
    seen.push({ method: init.method ?? "GET", path: u.pathname });
    const r = await handle(new Request(url, init), env);
    return tamper ? tamper(u.pathname, r) : r;
  };
  const failed = (r: { checks: { name: string; ok: boolean }[] }) => r.checks.filter((c) => !c.ok).map((c) => c.name);

  it("passes on the demo world, with GETs only and within its budget", async () => {
    const seen: { method: string; path: string }[] = [];
    const r = await smokeDemo(world.env.origin, { slugs: SLUGS, fetch: over(world.env, seen) });
    expect(failed(r)).toEqual([]);
    expect(r.ok).toBe(true);
    expect(new Set(seen.map((s) => s.method))).toEqual(new Set(["GET"]));
    expect(r.requests).toBe(seen.length);
    expect(r.requests).toBeLessThanOrEqual(smokeBudget(SLUGS.length));
    expect(smokeBudget(SLUGS.length)).toBeLessThan(world.env.demo!.rate.perMinute / 4);
    // Each company's reads were made, and every refused GET was tried.
    for (const slug of SLUGS) for (const read of SMOKE_COMPANY_READS) expect(seen.some((s) => s.path === `/v1/demo/${slug}/${read}`), `${slug} ${read}`).toBe(true);
    for (const p of SMOKE_REFUSED) expect(seen.some((s) => s.path === p.replace("{company}", SLUGS[0]!)), p).toBe(true);
  }, 60_000);

  it("fails on a cloud that is not in demo mode", async () => {
    const { demo: _demo, ...plain } = world.env;
    const r = await smokeDemo(world.env.origin, { slugs: SLUGS, fetch: over({ ...plain, sessionSecret: "s".repeat(48) }) });
    expect(r.ok).toBe(false);
    expect(failed(r)).toEqual(expect.arrayContaining(["health", "companies"]));
  }, 60_000);

  it("fails when a GET that must be refused answers, when a company is missing, or when a document is not what its hash says", async () => {
    const opened = await smokeDemo(world.env.origin, { slugs: SLUGS, fetch: over(world.env, [], (p, r) => p === "/v1/keys" ? new Response("[]", { status: 200 }) : r) });
    expect(failed(opened)).toEqual(["refused GET /v1/keys"]);
    const missing = await smokeDemo(world.env.origin, { slugs: [...SLUGS, "one-more-co"], fetch: over(world.env) });
    expect(failed(missing)).toEqual(expect.arrayContaining(["health", "companies"]));
    const flipped = await smokeDemo(world.env.origin, { slugs: SLUGS, fetch: over(world.env, [], async (p, r) => {
      if (!p.includes("/documents/")) return r;
      const b = new Uint8Array(await r.arrayBuffer()); b[0] = b[0]! ^ 1;
      return new Response(b, { status: r.status, headers: r.headers });
    }) });
    expect(failed(flipped).sort()).toEqual(SLUGS.map((s) => `${s} vault document`).sort());
    // The console page is checked to be the demo's, at this address.
    const elsewhere = await smokeDemo("https://somewhere-else.example", { slugs: SLUGS, fetch: over(world.env) });
    expect(failed(elsewhere)).toEqual(["console"]);
  }, 120_000);

  it("stays within its budget whatever comes back, and an unreachable address is a failure, not a crash", async () => {
    let n = 0;
    const junk = await smokeDemo(world.env.origin, { slugs: SLUGS, fetch: async () => { n++; return new Response("{}", { status: 200, headers: { "content-type": "application/json" } }); } });
    expect(junk.ok).toBe(false);
    expect(n).toBeLessThanOrEqual(smokeBudget(SLUGS.length));
    const down = await smokeDemo(world.env.origin, { slugs: SLUGS, fetch: async () => { throw new TypeError("fetch failed"); } });
    expect(down.ok).toBe(false);
    expect(down.checks.every((c) => !c.ok)).toBe(true);
  }, 60_000);

  it("refuses an address it cannot check and a list it cannot use", async () => {
    for (const base of ["ftp://x.example", "https://x.example/path", "not a url", "http://purser-demo.example.workers.dev"]) {
      await expect(smokeDemo(base, { slugs: SLUGS, fetch: over(world.env) }), base).rejects.toThrow();
    }
    await expect(smokeDemo(world.env.origin, { slugs: [], fetch: over(world.env) })).rejects.toThrow();
    await expect(smokeDemo(world.env.origin, { slugs: ["Not A Slug"], fetch: over(world.env) })).rejects.toThrow();
  });
});

describe("docs/cloud-demo.md, the runbook", () => {
  let doc = "";
  let flat = "";
  let demo: Json = {};
  beforeAll(() => {
    doc = readFileSync("docs/cloud-demo.md", "utf8");
    flat = doc.replace(/\s+/g, " ");
    demo = wranglerConfig().env.demo!;
  });

  it("names the demo's own Worker, database and bucket as the configuration has them, and the environment flag on every wrangler command", () => {
    expect(doc).toContain(`\`${String(demo.name)}\``);
    expect(doc).toContain(`npx wrangler d1 create ${String((demo.d1_databases as Json[])[0]!.database_name)}`);
    expect(doc).toContain(`npx wrangler r2 bucket create ${String((demo.r2_buckets as Json[])[0]!.bucket_name)}`);
    const commands = doc.split("\n").filter((l) => /^\s*(npx )?wrangler |npx wrangler /.test(l));
    expect(commands.length).toBeGreaterThan(6);
    for (const c of commands.filter((l) => /wrangler (deploy|d1 (migrations|execute)|secret|rollback|deployments|versions)/.test(l))) expect(c, c).toMatch(/--env demo/);
    expect(doc).toContain("npm run cloud:seed-demo -- --out");
    expect(doc).toContain("npm run cloud:smoke-demo -- --base");
  });

  it("the seed command prints the same loading commands, for the demo's own database and bucket", () => {
    const cli = readFileSync("src/cli/cloudSeedDemo.ts", "utf8");
    const printed = cli.split("\n").filter((l) => l.startsWith("console.log") && /npx wrangler|r2-put\.sh/.test(l));
    expect(printed.length).toBe(3);
    for (const l of printed.filter((x) => x.includes("npx wrangler"))) expect(l).toContain(`${String((demo.d1_databases as Json[])[0]!.database_name)} --env demo --remote`);
    expect(printed[2]).toContain(`sh r2-put.sh ${String((demo.r2_buckets as Json[])[0]!.bucket_name)})`);
    expect(cli).toContain("DEMO_SLUGS=${m.demo_slugs}");
  });

  it("sets no secret and names the two the Worker otherwise needs, by name only", () => {
    expect(doc).toContain("SESSION_SECRET");
    expect(doc).toContain("ADMIN_TOKEN_SHA256");
    expect(doc).not.toMatch(/wrangler secret put/);
    expect(doc).toMatch(/wrangler secret list -c cloud\/wrangler\.jsonc --env demo/);
    expect(doc).not.toMatch(/account_id|[A-Fa-f0-9]{32,}/);
  });

  it("lists exactly the GETs the smoke check makes, and the write attempts that must be refused", () => {
    for (const read of SMOKE_COMPANY_READS) expect(doc, read).toContain(`/v1/demo/{company}/${read}`);
    for (const p of SMOKE_REFUSED) expect(doc, p).toContain(`\`${p}\``);
    for (const w of ["POST /v1/auth/challenge", "POST /v1/admin/tenants", "POST /v1/sync", "DELETE /v1/keys/"]) expect(flat).toContain(w);
    expect(flat).toContain(`at most ${smokeBudget(SLUGS.length)} requests`);
    expect(doc).toContain(`npm run cloud:smoke-demo -- --base ${String((demo.vars as Json).ORIGIN)}`);
  });

  it("gives the numbers as the code has them", () => {
    expect(flat).toContain(`\`demo_companies\` is ${SLUGS.length}`);
    expect(flat).toContain(`the ${["", "one", "two", "three"][SLUGS.length]} companies`);
    expect(flat).toContain(`allows ${DEMO_RATE.perMinute} requests a minute per address and ${DEMO_RATE.uncachedPerMinute} uncached reads a minute per isolate`);
    expect(flat).toContain(`up to ${DEMO_TTL_SEC} seconds old, and browsers may keep them ${DEMO_BROWSER_SEC} seconds more`);
    expect(flat).toContain(`one of the ${DEMO_RATE.perMinute} requests a minute`);
    expect(SLUGS.every((s) => DEMO_COMPANIES.find((c) => c.slug === s))).toBe(true);
  });
});

// The runbook, rehearsed in Cloudflare's own runtime: only with CLOUD_DB=d1 (npm run test:d1), where the toolchain is.
if (onD1) describe("the runbook, rehearsed in workerd: seed bundle, the demo environment's variables, the smoke check", () => {
  interface Runtime { dispatchFetch(url: string, init?: RequestInit): Promise<Response>; getD1Database(name: string): Promise<D1Like>; getR2Bucket(name: string): Promise<{ put(key: string, value: Uint8Array, o?: unknown): Promise<unknown> }>; dispose(): Promise<void> }
  let rt: Runtime;
  let out: string;
  let manifest: BundleManifest;
  let vars: Record<string, string> = {};

  beforeAll(async () => {
    vars = wranglerConfig().env.demo!.vars as Record<string, string>;
    out = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "demo-bundle-"));
    manifest = await writeBundle(out);
    const fromWorker = createRequire(resolve("worker/package.json"));
    const fromWrangler = createRequire(fromWorker.resolve("wrangler/package.json"));
    // wrangler's own reading of the file, offline: the environment it would deploy.
    const { unstable_readConfig } = fromWorker("wrangler") as { unstable_readConfig(a: { config: string; env: string }, o: { hideWarnings: boolean }): Json };
    const read = unstable_readConfig({ config: "cloud/wrangler.jsonc", env: "demo" }, { hideWarnings: true });
    expect([read.name, read.workers_dev, read.vars, read.triggers]).toEqual(["purser-demo", true, vars, { crons: [] }]);
    expect((read.d1_databases as Json[]).map((d) => d.database_name)).toEqual(["purser-demo"]);
    expect((read.r2_buckets as Json[]).map((b) => b.bucket_name)).toEqual(["purser-demo-docs"]);
    expect((read.assets as Json).binding).toBe("ASSETS");
    const { build } = fromWrangler("esbuild") as { build(o: Record<string, unknown>): Promise<{ outputFiles: { text: string }[] }> };
    const { Miniflare, convertV4MiniflareOptions } = fromWrangler("miniflare") as { Miniflare: new (o: unknown) => Runtime; convertV4MiniflareOptions(o: unknown): unknown };
    const built = await build({ entryPoints: [resolve("cloud/src/worker.ts")], bundle: true, format: "esm", platform: "neutral", mainFields: ["browser", "module", "main"],
      conditions: ["workerd", "worker", "browser", "import"], external: ["node:*"], outfile: "worker.mjs", write: false, logLevel: "silent" });
    rt = new Miniflare(convertV4MiniflareOptions({
      modules: [{ type: "ESModule", path: "worker.mjs", contents: built.outputFiles[0]!.text }], compatibilityDate: "2026-10-01", compatibilityFlags: ["nodejs_compat"],
      d1Databases: { DB: "00000000-0000-0000-0000-00000000de03" }, r2Buckets: { DOCS: "purser-demo-docs-rehearsal" }, bindings: vars }));
    // As the runbook loads it: the migration, then seed.sql statement by statement, then every object of r2-put.sh.
    const db = await rt.getD1Database("DB");
    for (const part of splitScript(SCHEMA)) await db.prepare(part).run();
    for (const s of readFileSync(join(out, manifest.sql.file), "utf8").split("\n").filter((l) => l && !l.startsWith("--"))) await db.prepare(s.replace(/;$/, "")).run();
    const bucket = await rt.getR2Bucket("DOCS");
    for (const o of manifest.objects) await bucket.put(o.key, readFileSync(join(out, o.file)));
  }, 240_000);
  afterAll(async () => { await rt?.dispose(); if (out) rmSync(out, { recursive: true, force: true }); });

  it("passes the smoke check at the demo's own address", async () => {
    const r = await smokeDemo(vars.ORIGIN!, { slugs: vars.DEMO_SLUGS!.split(","), fetch: (url, init) => rt.dispatchFetch(url, init) });
    expect(r.checks.filter((c) => !c.ok)).toEqual([]);
    expect(r.requests).toBeLessThanOrEqual(smokeBudget(SLUGS.length));
    // The bundle's objects are what its manifest says.
    for (const o of manifest.objects.slice(0, 5)) expect(createHash("sha256").update(readFileSync(join(out, o.file))).digest("hex")).toBe(o.sha256);
  }, 120_000);
});

else describe("the runbook, rehearsed in workerd", () => {
  it("is tested with npm run test:d1 only: the Worker toolchain is installed there", () => { expect(process.env.CLOUD_DB).not.toBe("d1"); });
});
