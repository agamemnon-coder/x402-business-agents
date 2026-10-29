// npm run proposals: what waits for a person, with the exact terms and their hash.

import { approvalHint } from "./hint.js";
import { openDb } from "../db/open.js";
import { termsHash, type Terms } from "../lib/terms.js";
import { expireDue, type ProposalRow } from "../policy/approvals.js";

const db = openDb();
expireDue(db);
const all = process.argv.includes("--all");
const rows = db.prepare(`SELECT * FROM proposals ${all ? "" : "WHERE status = 'PENDING_APPROVAL'"} ORDER BY created_at`).all() as (ProposalRow & { explanation: string | null })[];
if (rows.length === 0) console.log(all ? "no proposals" : "nothing waits for approval");

function print(value: unknown, indent = "  "): void {
  if (Array.isArray(value)) {
    value.forEach((v, i) => {
      if (v && typeof v === "object") { console.log(`${indent}[${i + 1}]`); print(v, indent + "    "); }
      else console.log(`${indent}- ${String(v)}`);
    });
    return;
  }
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (v && typeof v === "object") { console.log(`${indent}${k}:`); print(v, indent + "  "); }
    else console.log(`${indent}${k.padEnd(26)} ${String(v)}`);
  }
}

for (const r of rows) {
  const terms = JSON.parse(r.terms_json) as Terms;
  const recomputed = termsHash(terms);
  console.log(`\n${r.proposal_id}  ${r.kind}  ${r.status}  expires ${r.expires_at}`);
  print(terms);
  if (r.explanation) console.log(`  explanation (advisory, from Claude): ${r.explanation}`);
  console.log(`  sha256 ${r.terms_sha256}${recomputed === r.terms_sha256 ? "" : "  (MISMATCH: terms changed)"}`);
  if (r.status === "PENDING_APPROVAL") console.log(`  decide: ${approvalHint(db, r.proposal_id, r.terms_sha256.slice(0, 8))}`);
}
