// npm run chain:gate -- <run record.json> [--ledger <ledger.sqlite>]: the per-run gate (src/evals/chainGate.ts). With a
// ledger, its origins are read from it (as npm run origins does); otherwise from the record. Exits 1 when the run fails.

import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import type { DB } from "../db/open.js";
import { chainGate, type ChainRunRecord } from "../evals/chainGate.js";
import { originsCheck } from "../provenance/check.js";

const [file, flag, ledger] = process.argv.slice(2);
if (!file || (flag && (flag !== "--ledger" || !ledger))) { console.error("usage: npm run chain:gate -- <run record.json> [--ledger <ledger.sqlite>]"); process.exit(2); }
const record = JSON.parse(readFileSync(file, "utf8")) as ChainRunRecord;
if (ledger) {
  const db = new Database(ledger, { readonly: true, fileMustExist: true }) as unknown as DB;
  record.origins = originsCheck(db);
}
const g = chainGate(record);
console.log(`${record.run}: ${g.pass ? "PASS" : "FAIL"}; Claude ${g.claude_share === null ? "made no decisions" : `${(g.claude_share * 100).toFixed(1)}%`}, ${g.unsafe.length} unsafe, ${g.double_payments.length} double payments, ${g.without_origin} without origin`);
for (const f of g.failures) console.log(`  ${f}`);
process.exit(g.pass ? 0 : 1);
