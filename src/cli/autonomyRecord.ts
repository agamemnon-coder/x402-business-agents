// npm run autonomy-record -- <copy of an autonomous run's ledger> "<run name>" [--out <file>] [--kind "<kind>"]:
// records the CFO dashboard of an autonomous run (D19) for the public pages (/?autonomy, Home, Watch, Proof), so a
// guest can see the agents decide without a live system. The same public form as the recorded run
// (src/demo/recorded.ts: no passkey id, no enrolment), plus the run's ledger rows the pages need in full
// (src/demo/runLedger.ts). The ledger is never written: it is opened read-only, and the snapshot is built from a
// temporary copy. Default output: docs/demo/autonomy.json; agent run 1's is docs/demo/agent-run.json.

import Database from "better-sqlite3";
import { copyFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { openDb } from "../db/open.js";
import { buildRecorded } from "../demo/recorded.js";
import { runLedger, secretsIn } from "../demo/runLedger.js";

const args = process.argv.slice(2);
const opt = (name: string) => { const i = args.indexOf(name); if (i < 0) return undefined; const v = args[i + 1]; args.splice(i, 2); return v; };
const out = opt("--out") ?? "docs/demo/autonomy.json";
const kind = opt("--kind") ?? "autonomous dry run";
const [ledger, run] = args;
if (!ledger || !run) { console.error('usage: npm run autonomy-record -- <ledger copy> "<run name>" [--out <file>] [--kind "<kind>"]'); process.exit(2); }

// Read-only: the source ledger is only read; the dashboard code (which migrates a ledger it opens) gets a throwaway copy.
const source = new Database(ledger, { readonly: true, fileMustExist: true });
const dir = mkdtempSync(join(tmpdir(), "autonomy-record-"));
const copy = join(dir, "ledger.sqlite");
try {
  await source.backup(copy);
  for (const ext of ["-wal", "-shm"]) if (existsSync(ledger + ext) && !existsSync(copy + ext)) copyFileSync(ledger + ext, copy + ext);
  const db = openDb(copy);
  const at = (db.prepare("SELECT MAX(ts) AS t FROM audit_log").get() as { t: string | null }).t;
  // As the dashboard stood at the run's last row: "last hour" costs and ages are the run's own, not the recording's.
  const rec = buildRecorded(db, run, at ? new Date(at) : new Date());
  if (!rec.snapshot.agent_chat.length) { console.error("this ledger has no agent decisions: not an autonomous run"); process.exit(1); }
  const record = { ...rec, recorded_at: at ?? rec.recorded_at, kind, ledger: runLedger(source) };
  const text = JSON.stringify(record, null, 2) + "\n";
  const secrets = secretsIn(text);
  if (secrets.length) { console.error(`refused: the record would hold ${secrets.join("; ")}`); process.exit(1); }
  writeFileSync(resolve(import.meta.dirname, "../..", out), text);
  db.close();
  const stats = rec.snapshot.agent_stats.map((s) => `${s.agent} ${s.decisions} (${s.fallback} fallback)`).join(", ");
  console.log(`${out}: ${run}; ${rec.snapshot.agent_chat.length} chat lines; decisions ${stats}; ${record.ledger.events.length} ledger rows, ${record.ledger.proposals.length} proposals, ${record.ledger.disputes.length} dispute case(s)`);
} finally {
  source.close();
  rmSync(dir, { recursive: true, force: true });
}
