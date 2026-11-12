// SPIKE: how long a freshly started workerd takes to give its first answer on a route that needs nothing of the engine
// (GET /v1/health), for a bundle built by `wrangler deploy --dry-run`. Compares the Worker whose Engine object imports
// the engine statically (leadWorker) with the one that loads it on first use (lazyWorker), then runs the lazy one's check.
//   unshare -n python3 spike/do/nonet.py node spike/do-lead/startup.mjs <eager dist> <lazy dist> [runs]
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readdirSync } from "node:fs";
import { join } from "node:path";
const require = createRequire(new URL("../../worker/package.json", import.meta.url));
const { Miniflare, convertV4MiniflareOptions } = require("miniflare");

const [eager, lazy, runsArg] = process.argv.slice(2);
const runs = Number(runsArg ?? 3);
const start = (dist, main) => {
  const files = readdirSync(dist).filter((f) => /\.(js|sql|pdf)$/.test(f)).sort((a, b) => Number(b === main) - Number(a === main));
  const modules = files.map((f) => ({ type: f.endsWith(".js") ? "ESModule" : f.endsWith(".sql") ? "Text" : "Data", path: join(dist, f) }));
  return new Miniflare(convertV4MiniflareOptions({
    cf: false, host: "127.0.0.1", port: 0, verbose: false, name: "startup", modules, modulesRoot: dist,
    compatibilityDate: "2026-10-01", compatibilityFlags: ["nodejs_compat"],
    durableObjects: { ENGINE: { className: "Engine", useSQLite: true } },
    d1Databases: { DB: "00000000-0000-0000-0000-000000000001" }, r2Buckets: { DOCS: "purser-cloud-docs" },
    bindings: { RP_ID: "cloud.example.invalid", ORIGIN: "https://cloud.example.invalid", SESSION_SECRET: "spike-session-secret-0123456789abcdef-not-a-real-secret", ADMIN_TOKEN_SHA256: createHash("sha256").update("spike-admin-token").digest("hex") },
  }));
};
const firstAnswer = async (dist, main) => {
  const t = performance.now();
  const mf = start(dist, main);
  try {
    const r = await mf.dispatchFetch("https://cloud.example.invalid/v1/health");
    await r.text();
    const first = performance.now() - t;
    const t2 = performance.now();
    await (await mf.dispatchFetch("https://cloud.example.invalid/v1/health")).text();
    return { status: r.status, first_ms: Math.round(first), second_ms: Math.round(performance.now() - t2) };
  } finally { await mf.dispose(); }
};
const out = { eager: [], lazy: [] };
for (let i = 0; i < runs; i++) {
  out.eager.push(await firstAnswer(eager, "leadWorker.js"));
  out.lazy.push(await firstAnswer(lazy, "lazyWorker.js"));
}
const mf = start(lazy, "lazyWorker.js");
try { out.lazy_check = await (await mf.dispatchFetch("https://cloud.example.invalid/")).json(); } finally { await mf.dispose(); }
console.log(JSON.stringify(out, null, 1));
