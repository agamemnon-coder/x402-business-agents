// npm run airwallex-trail: every Airwallex sandbox API call in Purser's recorded runs, from the committed run records
// alone (src/airwallex/apiTrail.ts), offline, no keys. It prints the calls run by run, newest first, then re-runs every
// transfer's hash check: the approval_sha256 it carries against the terms hash the passkey signed (and, where the record
// keeps the terms, against SHA-256 of those terms recomputed here). Exit 1 on any mismatch.

import { apiTrail, FAMILIES, FAMILY_LABEL } from "../airwallex/apiTrail.js";

const t = apiTrail();
const short = (h: string | null) => (h ? `${h.slice(0, 12)}…` : "not recorded");
for (const r of t.runs) {
  console.log(`\n== ${r.iso.slice(0, 10)}  ${r.title}  (${r.record})`);
  for (const c of r.calls) {
    const when = c.at ? c.at.replace("T", " ").replace("Z", "") : "".padEnd(23);
    const n = c.count > 1 ? ` ×${c.count}` : "";
    console.log(`   ${when}  ${c.method.padEnd(4)} ${c.path}${n}${c.outcome ? `  → ${c.outcome}` : ""}${c.objectId ? `  [${c.objectId}]` : ""}`);
  }
  if (r.unlisted) console.log(`   note: ${r.unlisted}`);
}
console.log(`\n${t.calls} calls in ${t.runs.length} records (${t.timed} with a recorded time): ${FAMILIES.filter((f) => t.byFamily[f]).map((f) => `${FAMILY_LABEL[f]} ${t.byFamily[f]}`).join(", ")}`);
console.log("\nHash checks, recomputed offline from the records:");
let bad = 0;
for (const c of t.runs.flatMap((r) => r.checks)) {
  if (!c.match) bad++;
  console.log(`${c.match ? "ok   " : "FAIL "} ${c.label}\n        carries ${short(c.carried)}  signed ${short(c.signed)}${c.recomputed ? `  recomputed ${short(c.recomputed)}` : ""}`);
}
console.log(`\n${t.checks.transfers.match} of ${t.checks.transfers.total} transfers carry the signed hash; ${t.checks.batches.match} of ${t.checks.batches.total} batches carry the signed batch hash; ${t.checks.recomputed} recomputed from the signed terms.`);
if (bad) { console.log(`MISMATCH: ${bad} check(s) failed`); process.exit(1); }
