// npm run origins -- <ledger>: D24, every money movement and who decided it. Exits 1 when any movement has no origin
// (Thursday's run must have none), and says so when the ledger was recorded before origins existed. Read-only.

import Database from "better-sqlite3";
import type { DB } from "../db/open.js";
import { originsCheck } from "../provenance/check.js";

const path = process.argv[2];
if (!path) { console.error("usage: npm run origins -- <ledger>"); process.exit(2); }
const db = new Database(path, { readonly: true, fileMustExist: true }) as unknown as DB;
const c = originsCheck(db);
if (!c.recorded) {
  console.log(`${c.movements} money movements; this ledger was recorded before origins existed (D24), so none has one`);
  process.exit(c.movements ? 1 : 0);
}
for (const m of c.missing) console.log(`NO ORIGIN  #${m.seq} ${m.event} ${m.subject ?? ""}`);
console.log(`${c.movements} money movements, ${c.missing.length} without an origin${c.missing.length ? ": a run with these is blocked" : ""}`);
process.exit(c.missing.length ? 1 : 0);
