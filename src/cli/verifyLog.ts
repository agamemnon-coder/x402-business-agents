// npm run verify-log [-- --jsonl audit.jsonl] [--anchor <seq>:<hash>]
// Checks the audit log alone, offline: every row's hash and its link to the row before. From the ledger (KIT11_DB)
// or from an export (npm run audit:export). With an anchor, as printed in an audit report or a run log, it also
// proves that row is still there with the same hash, so no tail was cut off and nothing before it was rehashed.

import { readFileSync } from "node:fs";
import { checkAnchor, verifyAuditRows, type AuditRowStored } from "../audit/log.js";
import { openDb } from "../db/open.js";

const args = process.argv.slice(2);
const opt = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const jsonl = opt("--jsonl");
const rows: AuditRowStored[] = jsonl
  ? readFileSync(jsonl, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as AuditRowStored)
  : (openDb().prepare("SELECT * FROM audit_log ORDER BY seq").all() as AuditRowStored[]);
let ok = true;
const chain = verifyAuditRows(rows);
if (chain.ok) console.log(`ok    chain  ${chain.rows} rows from ${jsonl ?? "the ledger"}, each hash recomputed and linked; head ${chain.head}`);
else { ok = false; console.log(`FAIL  chain  row ${chain.seq}: ${chain.reason}`); }
const anchor = opt("--anchor");
if (anchor) {
  const m = /^(\d+):([0-9a-f]{64})$/.exec(anchor);
  if (!m) { console.error("an anchor is <seq>:<64 hex>, as printed in the audit report"); process.exit(2); }
  const a = checkAnchor(rows, { seq: Number(m[1]), hash: m[2]! });
  if (a.ok) console.log(`ok    anchor row ${m[1]} still has hash ${m[2]!.slice(0, 12)}…: nothing up to it was changed or removed`);
  else { ok = false; console.log(`FAIL  anchor ${a.reason}`); }
}
process.exit(ok ? 0 : 1);
