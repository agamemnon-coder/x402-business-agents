// npm run month-end-pack [-- <file>]: writes the month-end pack (src/accounting/monthPack.ts) for the main run, the
// same bytes the pages serve at assets/purser-month-end-2026-11-03.zip, built from docs/demo/main-run.json and
// docs/demo/main-run-trace.json alone. No key, no network. Prints the file's SHA-256 so two builds can be compared.

import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { monthEndPack } from "../accounting/monthPack.js";
import { loadRecord } from "../redesign/run.js";
import { loadTrace } from "../redesign/trace.js";

const pack = monthEndPack(loadRecord().record, loadTrace());
const out = process.argv[2] ?? pack.name;
writeFileSync(out, pack.zip);
console.log(`${out}: ${pack.files.length} files, ${pack.zip.length} bytes, sha256 ${createHash("sha256").update(pack.zip).digest("hex")}`);
console.log(`${pack.summary.payments.count}; reconcile ${pack.summary.reconcile.checked} checked, ${pack.summary.reconcile.differences} differences`);
