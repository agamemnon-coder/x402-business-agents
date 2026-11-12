// SPIKE: bundles one probe exactly as `wrangler deploy` would (dry run: nothing is uploaded, no account, no network) and
// prints the size of what would be uploaded, raw and gzipped. The bundle stays in /dev/shm for inspection.
//
//   node spike/do-runtime/bundle.mjs p8-chain
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { configFor } from "./run.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
for (const name of process.argv.slice(2)) {
  const dir = mkdtempSync("/dev/shm/spike-do-runtime-bundle-");
  writeFileSync(join(dir, "wrangler.json"), JSON.stringify(configFor(name)));
  const env = { ...process.env, WRANGLER_SEND_METRICS: "false", CLOUDFLARE_CF_FETCH_ENABLED: "false" };
  for (const k of ["HTTPS_PROXY", "HTTP_PROXY", "https_proxy", "http_proxy", "ALL_PROXY", "all_proxy"]) delete env[k];
  let log = "";
  try {
    log = execFileSync(resolve(root, "worker/node_modules/.bin/wrangler"), ["deploy", "--dry-run", "--outdir", join(dir, "out"), "--config", join(dir, "wrangler.json")], { env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) { console.log(`${name}: wrangler deploy --dry-run FAILED\n${String(e.stdout ?? "").slice(-1500)}\n${String(e.stderr ?? "").slice(-3000)}`); continue; }
  const files = readdirSync(join(dir, "out")).filter((f) => !f.endsWith(".map") && f !== "README.md").map((f) => ({ f, raw: statSync(join(dir, "out", f)).size, gz: gzipSync(readFileSync(join(dir, "out", f))).length }));
  const total = files.reduce((a, x) => ({ raw: a.raw + x.raw, gz: a.gz + x.gz }), { raw: 0, gz: 0 });
  console.log(JSON.stringify({ probe: name, out: join(dir, "out"), files, total_raw_kb: Math.round(total.raw / 1024), total_gzip_kb: Math.round(total.gz / 1024), wrangler_says: (/Total Upload: [^\n]+/.exec(log) ?? [""])[0] }, null, 1));
}
