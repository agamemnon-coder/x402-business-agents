// Cloud tests on D1 itself (npm run test:d1): when CLOUD_DB=d1, every testCloud() gets a fresh, empty local D1
// database from wrangler's platform proxy (workerd running Cloudflare's D1 shim), instead of better-sqlite3. The guards
// that rely on D1 semantics (a batch is one transaction; a failed statement rolls the batch back; changes counts)
// are then exercised on the real thing. No network and no Cloudflare account: the databases are local and thrown away.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll } from "vitest";
import type { D1Like } from "../../cloud/src/store.js";

/** Fresh databases one test file can take; a file that needs more fails loudly rather than sharing one. */
const DATABASES = 160;

declare global {
  var __cloudD1: { next(): D1Like } | undefined;
}

if (process.env.CLOUD_DB === "d1") {
  const dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "cloud-d1-"));
  const d1 = Array.from({ length: DATABASES }, (_, i) => ({ binding: `DB${i}`, database_name: `t${i}`, database_id: `00000000-0000-0000-0000-${String(i).padStart(12, "0")}` }));
  writeFileSync(join(dir, "wrangler.json"), JSON.stringify({ name: "cloud-d1-test", main: "w.js", compatibility_date: "2026-10-01", d1_databases: d1 }));
  writeFileSync(join(dir, "w.js"), "export default { fetch() { return new Response('') } }\n");
  // wrangler is pinned in worker/ (the relay's toolchain): npm ci --prefix worker installs it.
  const require = createRequire(resolve("worker/package.json"));
  const { getPlatformProxy } = require("wrangler") as { getPlatformProxy(o: { configPath: string; persist: boolean }): Promise<{ env: Record<string, D1Like>; dispose(): Promise<void> }> };
  process.env.WRANGLER_SEND_METRICS = "false";
  const proxy = await getPlatformProxy({ configPath: join(dir, "wrangler.json"), persist: false });
  let used = 0;
  globalThis.__cloudD1 = {
    next() {
      if (used >= DATABASES) throw new Error(`more than ${DATABASES} cloud databases in one test file`);
      return proxy.env[`DB${used++}`]!;
    },
  };
  afterAll(async () => { await proxy.dispose(); rmSync(dir, { recursive: true, force: true }); });
}
