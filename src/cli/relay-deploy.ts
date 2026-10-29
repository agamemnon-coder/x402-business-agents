// npm run relay:deploy: bundles the pages into the relay Worker, deploys it with the wrangler pinned in worker/,
// and sets the runner's bearer token as the Worker secret RELAY_TOKEN (passed on stdin, never printed).
// Needs CLOUDFLARE_API_TOKEN (Workers Scripts: Edit) and CLOUDFLARE_ACCOUNT_ID. Safe to run again.

import { spawnSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildPages, pagesModule } from "../relay/assets.js";
import { relayConfig, relayToken } from "../relay/config.js";

const worker = resolve(import.meta.dirname, "../../worker");
const wrangler = resolve(worker, "node_modules/.bin/wrangler");
const env = { ...process.env, WRANGLER_SEND_METRICS: "false" };

function run(cmd: string, args: string[], input?: string): void {
  const r = spawnSync(cmd, args, { cwd: worker, env, input, stdio: [input === undefined ? "inherit" : "pipe", "inherit", "inherit"] });
  if (r.status !== 0) {
    console.error(`${cmd.split("/").pop()} ${args[0]} failed (exit ${r.status})`);
    process.exit(1);
  }
}

if (!process.env.CLOUDFLARE_API_TOKEN || !process.env.CLOUDFLARE_ACCOUNT_ID) {
  console.error("set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID (environment secrets) first");
  process.exit(2);
}
const token = relayToken();
if (!token) throw new Error("no relay token");

writeFileSync(resolve(worker, "src/pages.gen.ts"), pagesModule(buildPages()));
if (!existsSync(wrangler)) run("npm", ["ci", "--no-audit", "--no-fund"]);
run(wrangler, ["deploy"]);
run(wrangler, ["secret", "put", "RELAY_TOKEN"], token);

const cfg = await relayConfig();
const res = await fetch(`${cfg.url}/api/snapshot`).catch((e: Error) => ({ status: 0, statusText: e.message }));
console.log(`\nrelay deployed: ${cfg.url}/  (snapshot: ${res.status === 503 ? "waiting for the runner, start npm run relay" : res.status})`);
