// npm run visa:tap-live: the live TAP run (D25, src/visa/tapLiveRun.ts) in a fresh test world.
//
// Before: Visa's reference cloned at 16d59bd outside this repo, tracked files unchanged, and running (registry on
// 127.0.0.1:9002 with a fresh database, proxy on 3001, as .github/workflows/tap-interop.yml starts them); ports 3000 on
// 127.0.0.1 and ::1 free (our merchant listens there); the Airwallex sandbox keys and the Anthropic key in the
// environment; KIT11_DB naming a ledger that does not exist yet. Run from the repo root:
//   KIT11_DB=data/visa-tap-live-2026-11-02.sqlite TAP_REF_DIR=/path/to/clone npm run visa:tap-live
// Optional: KIT11_TAP_PROXY (default http://localhost:3001), TAP_REGISTRY_URL (default http://127.0.0.1:9002),
// TAP_MERCHANT_PORT (default 3000), RUN_OUT (default docs/runs/visa-tap-live-<date>.json; never overwritten).
// Writes the run record; prints one line per step. Nothing secret is printed or written: the TAP key is a test key in
// memory, the card's number is never read beyond its last 4 digits. Exit 0 only when both steps hold; 2 when a check
// stops it before anything is done.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Airwallex, fromEnv } from "../airwallex/client.js";
import { issuingFromEnv } from "../airwallex/issuing.js";
import { claudeClient } from "../claude/reader.js";
import { openDb } from "../db/open.js";
import { liveRunPreflight, runTapLive } from "../visa/tapLiveRun.js";

const stop = (why: string): never => { console.error(`visa:tap-live: ${why}; nothing was done`); process.exit(2); };

const pre = liveRunPreflight(process.env, {
  exists: (p) => existsSync(p),
  git: (dir, args) => { const r = spawnSync("git", ["-C", dir, ...args], { encoding: "utf8" }); return { status: r.status, stdout: r.stdout ?? "" }; },
  today: () => new Date().toISOString().slice(0, 10),
});
if ("problem" in pre) stop(pre.problem);
const ok = pre as Exclude<typeof pre, { problem: string }>;
const db = openDb(ok.dbPath);
const issuing = issuingFromEnv(db);
const awxCfg = fromEnv();
const client = claudeClient();
if (!issuing || !awxCfg || !client) stop("the keys are not readable");

const api = new Airwallex(awxCfg!);
const record = await runTapLive({
  db,
  issuing: issuing!,
  readBack: {
    card: (id) => api.call<Record<string, unknown>>("GET", `/issuing/cards/${encodeURIComponent(id)}`),
    transactions: (id) => issuing!.rail.listCardTransactions(id),
  },
  proxyUrl: process.env.KIT11_TAP_PROXY ?? "http://localhost:3001",
  registryUrl: process.env.TAP_REGISTRY_URL ?? "http://127.0.0.1:9002",
  merchantPort: Number(process.env.TAP_MERCHANT_PORT ?? 3000),
  client,
  refCommit: ok.refCommit,
}).catch((e: Error) => stop(e.message));

const out = resolve(ok.out);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(record, null, 2) + "\n", { flag: "wx" });
for (const s of record.steps) {
  const awx = s.airwallex ? `${s.airwallex.approved ? "approved" : `declined (${s.airwallex.failure_reason ?? s.airwallex.status})`} ${s.airwallex.transaction_id}, GET ${s.airwallex.confirmed_by_get ? "confirms" : "DID NOT CONFIRM"}` : "not charged";
  console.log(`${s.ok ? "OK  " : "FAIL"}  ${s.step} (${s.by}): proxy ${s.tap?.proxy_status ?? "-"}, merchant ${s.tap?.merchant ?? "-"}, Airwallex ${awx}`);
}
console.log(`card ${record.card?.last4 ?? "?"} (${record.card?.nickname ?? "?"}): brand as Airwallex returns it: ${JSON.stringify(record.card?.brand_as_returned)}`);
console.log(`${record.ok ? "both steps hold" : "NOT all steps hold"}; record: ${out}`);
process.exit(record.ok ? 0 : 1);
