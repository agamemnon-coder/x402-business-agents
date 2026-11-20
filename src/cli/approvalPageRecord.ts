// npm run approval-page-record [-- --check]: writes docs/evidence/approval-page.json, the SHA-256 and CSP of each
// approval page as this commit serves it (src/approve/pageRecord.ts). With --check it writes nothing and exits 1 when
// the committed record differs from the code (CI runs the same comparison in test/approval-page-integrity.test.ts).

import { readFileSync, writeFileSync } from "node:fs";
import { RECORD_PATH } from "../approve/integrity.js";
import { approvalPageRecord, recordText } from "../approve/pageRecord.js";

const file = new URL(`../../${RECORD_PATH}`, import.meta.url);
const text = recordText(approvalPageRecord());
let committed: string;
try { committed = readFileSync(file, "utf8"); } catch { committed = ""; }
if (process.argv.includes("--check")) {
  if (committed !== text) {
    console.error(`${RECORD_PATH} differs from the approval pages this code serves: run npm run approval-page-record and commit it`);
    process.exit(1);
  }
  console.log(`ok  ${RECORD_PATH} matches the approval pages this code serves`);
  process.exit(0);
}
writeFileSync(file, text);
for (const p of (JSON.parse(text) as { pages: { name: string; sha256: string; build?: string }[] }).pages) console.log(`${p.name.padEnd(14)} ${p.sha256}${p.build ? `  build ${p.build}` : ""}`);
console.log(`wrote ${RECORD_PATH}`);
