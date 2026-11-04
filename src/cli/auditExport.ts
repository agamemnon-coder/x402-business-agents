// npm run audit:export: writes audit.jsonl (one row per line, as stored) and audit.head (the chain head).

import { writeFileSync } from "node:fs";
import { verifyAuditChain } from "../audit/log.js";
import { openDb } from "../db/open.js";

const db = openDb();
const check = verifyAuditChain(db);
if (!check.ok) throw new Error(`audit chain broken at row ${check.seq}: ${check.reason}`);
const rows = db.prepare("SELECT * FROM audit_log ORDER BY seq").all();
writeFileSync("audit.jsonl", rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
writeFileSync("audit.head", `${check.head}\n`);
console.log(`audit.jsonl: ${check.rows} rows; head ${check.head}`);
