// SPIKE (spike-do-lead): bundles leadWorker.ts exactly as a wrangler deploy would (nodejs_compat, a SQLite-backed
// Durable Object, D1 and R2 bindings), starts it in local workerd, calls it once and prints what it answered.
// Local only, no network: run it as   unshare -n python3 spike/do/nonet.py node spike/do-lead/run.mjs [out.json]
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

process.env.WRANGLER_SEND_METRICS = "false";
process.env.CLOUDFLARE_CF_FETCH_ENABLED = "false";
for (const k of ["HTTPS_PROXY", "HTTP_PROXY", "https_proxy", "http_proxy", "ALL_PROXY", "all_proxy"]) delete process.env[k];

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const require = createRequire(resolve(root, "worker/package.json"));
const { unstable_startWorker } = require("wrangler");

const config = {
  name: "purser-cloud-lead-probe", main: resolve(here, "leadWorker.ts"),
  compatibility_date: "2026-10-01", compatibility_flags: ["nodejs_compat"],
  durable_objects: { bindings: [{ name: "ENGINE", class_name: "Engine" }] },
  migrations: [{ tag: "v1", new_sqlite_classes: ["Engine"] }],
  d1_databases: [{ binding: "DB", database_name: "purser-cloud", database_id: "00000000-0000-0000-0000-000000000001" }],
  r2_buckets: [{ binding: "DOCS", bucket_name: "purser-cloud-docs" }],
  rules: [{ type: "Data", globs: ["**/*.pdf"], fallthrough: true }, { type: "Text", globs: ["**/*.sql"], fallthrough: true }],
  // Test values made up for this spike; nothing real.
  vars: { RP_ID: "cloud.example.invalid", ORIGIN: "https://cloud.example.invalid", SESSION_SECRET: "spike-session-secret-0123456789abcdef-not-a-real-secret", ADMIN_TOKEN_SHA256: createHash("sha256").update("spike-admin-token").digest("hex") },
  define: { "import.meta.url": JSON.stringify("file:///purser-cloud/worker.js"), "import.meta.dirname": JSON.stringify("/purser-cloud"), "import.meta.filename": JSON.stringify("/purser-cloud/worker.js") },
  alias: { playwright: resolve(root, "spike/do-runtime/probes/_stub.ts"), "better-sqlite3": resolve(root, "spike/do-runtime/probes/_stub.ts") },
};

const dir = mkdtempSync("/dev/shm/spike-do-lead-");
writeFileSync(join(dir, "wrangler.json"), JSON.stringify(config));
const started = Date.now();
let worker, failed = 0;
try {
  worker = await unstable_startWorker({ config: join(dir, "wrangler.json"), dev: { persist: false, watch: false, remote: false, inspector: false, logLevel: "warn", server: { hostname: "127.0.0.1", port: 0 } } });
  const builtMs = Date.now() - started;
  const res = await Promise.race([worker.fetch("http://probe.local/"), new Promise((_r, reject) => setTimeout(() => reject(new Error("no answer within 120 s")), 120000))]);
  const text = await res.text();
  let body; try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 6000) }; }
  const out = { http: res.status, start_ms: builtMs, total_ms: Date.now() - started, ...body };
  if (process.argv[2]) writeFileSync(process.argv[2], `${JSON.stringify(out, null, 1)}\n`);
  console.log(JSON.stringify(out, null, 1));
  if (res.status !== 200) failed = 1;
} catch (e) {
  failed = 1;
  console.log(`DID NOT RUN\n${String(e?.stack ?? e).slice(0, 4000)}`);
} finally {
  await Promise.race([worker?.dispose().catch(() => undefined), new Promise((r) => setTimeout(r, 5000))]);
  rmSync(dir, { recursive: true, force: true });
}
process.exit(failed);
