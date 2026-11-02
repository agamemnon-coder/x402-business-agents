// npm run visa:tap-live: the live TAP run (D25, src/visa/tapLiveRun.ts) in a fresh test world.
//
// Before: Visa's reference cloned at 16d59bd outside this repo and running unchanged (registry on 127.0.0.1:9002, proxy
// on 3001, as .github/workflows/tap-interop.yml starts them); port 3000 free (our merchant listens there, loopback only);
// the Airwallex sandbox keys and the Anthropic key in the environment; KIT11_DB naming a ledger that does not exist yet.
//   KIT11_DB=data/visa-tap-live-2026-11-02.sqlite TAP_REF_DIR=/path/to/clone npm run visa:tap-live
// Optional: KIT11_TAP_PROXY (default http://localhost:3001), TAP_REGISTRY_URL (default http://127.0.0.1:9002),
// TAP_MERCHANT_PORT (default 3000), RUN_OUT (default docs/runs/visa-tap-live-<date>.json).
// Writes the run record; prints one line per step. Nothing secret is printed or written: the TAP key is a test key in
// memory, the card's number is never read beyond its last 4 digits. Exit 0 only when both steps hold.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Airwallex, fromEnv } from "../airwallex/client.js";
import { issuingFromEnv } from "../airwallex/issuing.js";
import { claudeClient } from "../claude/reader.js";
import { openDb } from "../db/open.js";
import { freshWorldProblem, runTapLive } from "../visa/tapLiveRun.js";

const REF_COMMIT = "16d59bdf3f8a542bc538d0962edbb80ea30a02af";
const stop = (why: string): never => { console.error(`visa:tap-live: ${why}; nothing was done`); process.exit(2); };

const dbPath = process.env.KIT11_DB;
const fresh = freshWorldProblem(dbPath, !!dbPath && existsSync(dbPath));
if (fresh) stop(fresh);
const issuing = issuingFromEnv();
const awxCfg = fromEnv();
if (!issuing || !awxCfg) stop("the Airwallex sandbox keys are not set");
const client = claudeClient();
if (!client) stop("the Anthropic key is not set: the Sourcing agent picks the rail itself, with Claude");

// The reference clone must be at the pinned commit (read with git, an argument array, no shell).
let refCommit: string | null = null;
if (process.env.TAP_REF_DIR) {
  const r = spawnSync("git", ["-C", process.env.TAP_REF_DIR, "rev-parse", "HEAD"], { encoding: "utf8" });
  refCommit = r.status === 0 ? r.stdout.trim() : null;
  if (refCommit !== REF_COMMIT) stop(`the reference clone in TAP_REF_DIR is at ${refCommit ?? "an unknown commit"}, not ${REF_COMMIT}`);
} else {
  stop("TAP_REF_DIR must name the clone of github.com/visa/trusted-agent-protocol the proxy and registry run from");
}

const db = openDb(dbPath);
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
  refCommit,
}).catch((e: Error) => stop(e.message));

const out = resolve(process.env.RUN_OUT ?? `docs/runs/visa-tap-live-${record.ran_at.slice(0, 10)}.json`);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(record, null, 2) + "\n");
for (const s of record.steps) {
  const awx = s.airwallex ? `${s.airwallex.approved ? "approved" : `declined (${s.airwallex.failure_reason ?? s.airwallex.status})`} ${s.airwallex.transaction_id}, GET ${s.airwallex.confirmed_by_get ? "confirms" : "DID NOT CONFIRM"}` : "not charged";
  console.log(`${s.ok ? "OK  " : "FAIL"}  ${s.step} (${s.by}): proxy ${s.tap?.proxy_status ?? "-"}, merchant ${s.tap?.merchant ?? "-"}, Airwallex ${awx}`);
}
console.log(`card ${record.card?.last4 ?? "?"}: brand as Airwallex returns it: ${JSON.stringify(record.card?.brand_as_returned)}`);
console.log(`${record.ok ? "both steps hold" : "NOT all steps hold"}; record: ${out}`);
process.exit(record.ok ? 0 : 1);
