// npm run trace-record -- <copy of the main run's ledger> [--generated YYYY-MM-DD]: writes the main run's companion
// record for /trace and the month-end pack (src/demo/runTrace.ts) to docs/demo/main-run-trace.json. It refuses a ledger
// whose audit chain does not end at the main run's recorded head, or whose ledger rows differ from the record's. The
// ledger is opened read-only and copied; the dashboard code gets the copy. docs/demo/main-run.json is only read.

import Database from "better-sqlite3";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { openDb } from "../db/open.js";
import { runLedger } from "../demo/runLedger.js";
import { runTrace, TRACE_FILE } from "../demo/runTrace.js";
import { AGENT_RUN_FILE, type RunRecord } from "../redesign/run.js";

const args = process.argv.slice(2);
const at = args.indexOf("--generated");
const generated = at >= 0 ? args.splice(at, 2)[1]! : new Date().toISOString().slice(0, 10);
const [ledger] = args;
if (!ledger) { console.error("usage: npm run trace-record -- <copy of the main run's ledger> [--generated YYYY-MM-DD]"); process.exit(2); }

const record = JSON.parse(readFileSync(AGENT_RUN_FILE, "utf8")) as RunRecord & { snapshot: { audit: { head: string } } };
const source = new Database(ledger, { readonly: true, fileMustExist: true });
const dir = mkdtempSync(join(tmpdir(), "trace-record-"));
const copy = join(dir, "ledger.sqlite");
try {
  await source.backup(copy);
  for (const ext of ["-wal", "-shm"]) if (existsSync(ledger + ext) && !existsSync(copy + ext)) copyFileSync(ledger + ext, copy + ext);
  const db = openDb(copy);
  if (!isDeepStrictEqual(runLedger(db), record.ledger)) throw new Error(`this ledger's rows are not the ones in ${AGENT_RUN_FILE}`);
  const trace = runTrace(db, { generated, record: { run: record.run, audit: record.snapshot.audit }, recordFile: AGENT_RUN_FILE });
  db.close();
  writeFileSync(TRACE_FILE, JSON.stringify(trace, null, 1) + "\n");
  console.log(`${TRACE_FILE}: ${trace.payments.length} payments, ${trace.journal.length} journal lines, ${trace.audit.rows} audit links (head ${trace.audit.head.slice(0, 12)}…); ${trace.label}`);
} finally {
  source.close();
  rmSync(dir, { recursive: true, force: true });
}
