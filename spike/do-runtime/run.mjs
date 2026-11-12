// SPIKE (spike-do-runtime): runs each probe Worker in workerd, bundled by wrangler exactly as a deploy would bundle it
// (nodejs_compat, the cloud Worker's compatibility date, a SQLite-backed Durable Object, D1 and R2 bindings), calls it
// once and writes what it answered to results/<probe>.json. Local only: no Cloudflare account, no network.
//
//   node spike/do-runtime/run.mjs p3-crypto p1-pdftext …      (no arguments: every probe in probes/)
import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

process.env.WRANGLER_SEND_METRICS = "false";
process.env.CLOUDFLARE_CF_FETCH_ENABLED = "false";
// Nothing here may leave the machine: without a proxy any stray request fails at once.
for (const k of ["HTTPS_PROXY", "HTTP_PROXY", "https_proxy", "http_proxy", "ALL_PROXY", "all_proxy"]) delete process.env[k];

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const require = createRequire(resolve(root, "worker/package.json"));
const { unstable_startWorker } = require("wrangler");

export const configFor = (name) => ({
  name: `probe-${name}`, main: resolve(here, `probes/${name}.ts`),
  // As cloud/wrangler.jsonc.
  compatibility_date: "2026-10-01", compatibility_flags: ["nodejs_compat"],
  durable_objects: { bindings: [{ name: "ENGINE", class_name: "Engine" }] },
  migrations: [{ tag: "v1", new_sqlite_classes: ["Engine"] }],
  d1_databases: [{ binding: "DB", database_name: "purser-cloud", database_id: "00000000-0000-0000-0000-000000000001" }],
  r2_buckets: [{ binding: "DOCS", bucket_name: "purser-cloud-docs" }],
  rules: [{ type: "Data", globs: ["**/*.pdf"], fallthrough: true }, { type: "Text", globs: ["**/*.sql"], fallthrough: true }],
  vars: {
    RP_ID: "cloud.example.invalid", ORIGIN: "https://cloud.example.invalid", MAIL_DOMAIN: "mail.example.invalid",
    // Test values, made up for this spike; nothing real.
    SESSION_SECRET: "spike-session-secret-0123456789abcdef-not-a-real-secret", ADMIN_TOKEN_SHA256: "f0a4c2a5ce0a3bb7ad4f4ac7a2a1b6b0d6c3c9f0d5d9d0d2b9f0c0c1d1e2f3a4",
    AIRWALLEX_CLIENT_ID: "spike-client-id", AIRWALLEX_API_KEY: "spike-api-key", KIT11_ANTHROPIC_API_KEY: "spike-not-a-key",
  },
  // A wrangler bundle has no import.meta.url (measured: undefined in workerd), and pdfkit's browser build reads it when
  // it loads ("Invalid URL string" at start, the whole Worker fails). NO_DEFINE=1 leaves it out, to see that failure.
  ...(process.env.NO_DEFINE ? {} : { define: { "import.meta.url": JSON.stringify("file:///purser-cloud/worker.js") } }),
  // Packages no Worker can carry, swapped for a stub that throws when used (wrangler's own alias setting).
  alias: { playwright: resolve(here, "probes/_stub.ts"), "better-sqlite3": resolve(here, "probes/_stub.ts") },
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const names = process.argv.slice(2).length ? process.argv.slice(2) : readdirSync(join(here, "probes")).filter((f) => /^p\d.*\.ts$/.test(f)).map((f) => f.replace(/\.ts$/, "")).sort();
  mkdirSync(join(here, "results"), { recursive: true });
  let failed = 0;
  for (const name of names) {
    const dir = mkdtempSync("/dev/shm/spike-do-runtime-");
    writeFileSync(join(dir, "wrangler.json"), JSON.stringify(configFor(name)));
    const started = Date.now();
    let worker;
    try {
      worker = await unstable_startWorker({ config: join(dir, "wrangler.json"), dev: { persist: false, watch: false, remote: false, inspector: false, logLevel: "warn", server: { hostname: "127.0.0.1", port: 0 } } });
      const builtMs = Date.now() - started;
      // PROBE_PATH picks one step of a probe (?only=…); a probe that does not answer in time is reported, not waited for.
      const res = await Promise.race([
        worker.fetch(`http://probe.local/${process.env.PROBE_PATH ?? ""}`),
        new Promise((_r, reject) => setTimeout(() => reject(new Error(`no answer from the probe within ${Number(process.env.PROBE_TIMEOUT_MS ?? 60000)} ms`)), Number(process.env.PROBE_TIMEOUT_MS ?? 60000))),
      ]);
      const text = await res.text();
      let body; try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 4000) }; }
      const out = { probe: name, http: res.status, start_ms: builtMs, total_ms: Date.now() - started, ...body };
      writeFileSync(join(here, "results", `${name}.json`), `${JSON.stringify(out, null, 1)}\n`);
      console.log(`\n=== ${name}: HTTP ${res.status}, ${out.total_ms} ms`);
      console.log(JSON.stringify(body, null, 1).slice(0, Number(process.env.SHOW ?? 6000)));
      if (res.status !== 200) failed++;
    } catch (e) {
      failed++;
      const msg = String(e?.stack ?? e).slice(0, 3000);
      writeFileSync(join(here, "results", `${name}.json`), `${JSON.stringify({ probe: name, harness_error: msg }, null, 1)}\n`);
      console.log(`\n=== ${name}: DID NOT RUN\n${msg}`);
    } finally {
      await Promise.race([worker?.dispose().catch(() => undefined), new Promise((r) => setTimeout(r, 5000))]);
      rmSync(dir, { recursive: true, force: true });
    }
  }
  process.exit(failed ? 1 : 0);
}
