// npm run retention -- --check [--now <ISO time>]
// Reports, per record kind of src/compliance/retention.ts, the rows of the runner's ledger (KIT11_DB, opened read-only)
// older than its retention period. It never deletes anything (docs/compliance/retention.md says how expired records
// leave). Exit 0 when nothing is past its period, 1 when something is (so a scheduled check can alert), 2 on a usage
// or configuration error.

import Database from "better-sqlite3";
import { existsSync } from "node:fs";
import { retentionCheck } from "../compliance/retention.js";
import { DEFAULT_LEDGER, type DB } from "../db/open.js";

const args = process.argv.slice(2);
const fail = (message: string, code: number): never => { console.error(message); process.exit(code); };
if (!args.includes("--check")) fail("usage: npm run retention -- --check [--now <ISO time>] (reports only; deletes nothing)", 2);
const i = args.indexOf("--now");
const now = i >= 0 ? new Date(args[i + 1] ?? "") : new Date();
if (Number.isNaN(now.getTime())) fail("--now: not a time", 2);
const ledger = process.env.KIT11_DB ?? DEFAULT_LEDGER;
if (!existsSync(ledger)) fail(`no ledger at ${ledger} (KIT11_DB)`, 2);
const db = new Database(ledger, { readonly: true, fileMustExist: true }) as unknown as DB;
const found = retentionCheck(db, now);
db.close();
console.log(`retention check at ${now.toISOString()} (reports only; nothing is deleted)`);
for (const f of found) {
  const what = !f.present ? "no such table in this ledger" : f.past ? `${f.past} of ${f.rows} rows past the period (oldest ${f.oldest_past})` : `${f.rows} rows, none past the period`;
  console.log(`  ${f.past ? "PAST" : "ok  "}  ${f.table.padEnd(20)} kept ${f.keep.padEnd(24)} ${what}`);
}
const past = found.reduce((n, f) => n + f.past, 0);
console.log(past ? `${past} rows are past their period: see docs/compliance/retention.md for how they leave` : "nothing is past its period");
process.exit(past ? 1 : 0);
