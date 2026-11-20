// npm run verify-approval-page -- <url> [<url> …]: fetches a live approval page and compares it with the published
// record (docs/evidence/approval-page.json, src/approve/integrity.ts): its HTML, script and stylesheet by SHA-256, and
// its Content-Security-Policy. Run it from any machine; it trusts neither the relay nor the cloud. A site address with
// no path checks the relay's three phone pages (/approve/P-0001, /enrol, /policy), or Purser Cloud's console when that
// is what answers at /. Exits 1 when any page differs.
//
// What it proves: what this address serves now, to this machine. A relay that serves one script to this check and
// another to the CFO's phone is not caught by it (docs/security.md, accepted risks).

import { readFileSync } from "node:fs";
import { RECORD_PATH, verifyApprovalPages, type PageRecord } from "../approve/integrity.js";

const urls = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (urls.length === 0) {
  console.error("usage: npm run verify-approval-page -- <url> [<url> …]   (the relay's address, an /approve/P-… link, or Purser Cloud's address)");
  process.exit(2);
}
const record = JSON.parse(readFileSync(new URL(`../../${RECORD_PATH}`, import.meta.url), "utf8")) as PageRecord;
const out = await verifyApprovalPages(urls, record);
for (const l of out.lines) console.log(l);
process.exit(out.ok ? 0 : 1);
