// npm run autonomy-record -- <copy of an autonomous run's ledger> "<run name>" [--out <file>] [--kind "<kind>"] [--until <ISO time>]:
// records the CFO dashboard of an autonomous run (D19) for the public pages (/?autonomy, Home, Watch, Proof), so a
// guest can see the agents decide without a live system. The same public form as the recorded run
// (src/demo/recorded.ts: no passkey id, no enrolment), plus the run's ledger rows the pages need in full
// (src/demo/runLedger.ts). The ledger is never written: it is opened read-only, and the snapshot is built from a
// temporary copy. Default output: docs/demo/autonomy.json; agent run 1's is docs/demo/agent-run.json. With --until, the
// record ends at that moment: the audit rows after it (the chain's tail) are left out of the copy, never changed.

import Database from "better-sqlite3";
import { copyFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { agentChat } from "../dashboard/agentStats.js";
import { agentTraces } from "../dashboard/trace.js";
import { openDb } from "../db/open.js";
import { buildRecorded } from "../demo/recorded.js";
import { runLedger, secretsIn } from "../demo/runLedger.js";

const args = process.argv.slice(2);
const opt = (name: string) => { const i = args.indexOf(name); if (i < 0) return undefined; const v = args[i + 1]; args.splice(i, 2); return v; };
const out = opt("--out") ?? "docs/demo/autonomy.json";
const kind = opt("--kind") ?? "autonomous dry run";
const until = opt("--until");
if (until !== undefined && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/.test(until)) { console.error("--until takes an ISO time in UTC, e.g. 2026-11-02T14:30:06Z"); process.exit(2); }
const [ledger, run] = args;
if (!ledger || !run) { console.error('usage: npm run autonomy-record -- <ledger copy> "<run name>" [--out <file>] [--kind "<kind>"]'); process.exit(2); }

// Read-only: the source ledger is only read; the dashboard code (which migrates a ledger it opens) gets a throwaway copy.
const source = new Database(ledger, { readonly: true, fileMustExist: true });
const dir = mkdtempSync(join(tmpdir(), "autonomy-record-"));
const copy = join(dir, "ledger.sqlite");
try {
  await source.backup(copy);
  for (const ext of ["-wal", "-shm"]) if (existsSync(ledger + ext) && !existsSync(copy + ext)) copyFileSync(ledger + ext, copy + ext);
  if (until) {
    // Only the throwaway copy: its append-only triggers are dropped so the tail can be left out. The ledger itself is
    // opened read-only above and never changed; the rows kept are the chain's untouched prefix.
    const c = new Database(copy);
    for (const { name } of c.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'audit_log'").all() as { name: string }[]) c.exec(`DROP TRIGGER "${name.replace(/"/g, "")}"`);
    const cut = c.prepare("DELETE FROM audit_log WHERE ts > ?").run(until).changes;
    c.close();
    console.log(`until ${until}: ${cut} later audit row(s) left out of the record`);
  }
  const db = openDb(copy);
  const at = (db.prepare("SELECT MAX(ts) AS t FROM audit_log").get() as { t: string | null }).t;
  // As the dashboard stood at the run's last row: "last hour" costs and ages are the run's own, not the recording's.
  const built = buildRecorded(db, run, at ? new Date(at) : new Date());
  // The live dashboard shows the latest 40 chat lines and 20 traces; a record keeps the whole run's (agent run 1 has more).
  const rec = { ...built, snapshot: { ...built.snapshot, agent_chat: agentChat(db, 10_000), traces: agentTraces(db).reverse() } };
  if (!rec.snapshot.agent_chat.length) { console.error("this ledger has no agent decisions: not an autonomous run"); process.exit(1); }
  const rows = until ? new Database(copy, { readonly: true }) : source;
  const record = { ...rec, recorded_at: at ?? rec.recorded_at, kind, ledger: runLedger(rows) };
  if (rows !== source) rows.close();
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
