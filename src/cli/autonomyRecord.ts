// npm run autonomy-record -- <copy of an autonomous dry-run ledger> "<run name>": records the CFO dashboard of an
// autonomous dry run (D19) into docs/demo/autonomy.json, so a guest can see the agents decide without a live system
// (/?autonomy). The same public form as the recorded run (src/demo/recorded.ts: no passkey id, no enrolment). It is a
// dry run with test passkeys and test money, and the page says so.

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { openDb } from "../db/open.js";
import { buildRecorded } from "../demo/recorded.js";

const [ledger, run] = process.argv.slice(2);
if (!ledger || !run) { console.error('usage: npm run autonomy-record -- <ledger copy> "<run name>"'); process.exit(2); }
const db = openDb(ledger);
const rec = buildRecorded(db, run);
const at = (db.prepare("SELECT MAX(ts) AS t FROM audit_log").get() as { t: string | null }).t;
if (!rec.snapshot.agent_chat.length) { console.error("this ledger has no agent decisions: not an autonomous run"); process.exit(1); }
const out = { ...rec, recorded_at: at ?? rec.recorded_at, kind: "autonomous dry run" };
writeFileSync(resolve(import.meta.dirname, "../../docs/demo/autonomy.json"), JSON.stringify(out, null, 2) + "\n");
const stats = rec.snapshot.agent_stats.map((s) => `${s.agent} ${s.decisions} (${s.fallback} fallback)`).join(", ");
console.log(`docs/demo/autonomy.json: ${run}; ${rec.snapshot.agent_chat.length} chat lines; decisions ${stats}`);
