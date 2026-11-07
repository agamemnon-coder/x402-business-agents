// npm run verify-receipt -- receipt.json
// Checks a /try/sign receipt offline, with Node's own crypto: no network, no server, no key of ours. Exit 0 when every
// check passes, 1 when one fails, 2 when the file cannot be read. src/try/receipt.ts says what it checks.

import { readFileSync } from "node:fs";
import { RECEIPT_CHAIN_MEANS, RECEIPT_FX_MEANS, RECEIPT_MEANS, verifyReceipt } from "../try/receipt.js";

const file = process.argv[2];
if (!file) { console.error("usage: npm run verify-receipt -- receipt.json"); process.exit(2); }
let json: unknown;
try { json = JSON.parse(readFileSync(file, "utf8")); } catch (e) { console.error(`cannot read ${file} as JSON: ${(e as Error).message}`); process.exit(2); }
const r = verifyReceipt(json);
for (const c of r.checks) console.log(`${c.ok ? "ok  " : "FAIL"}  ${c.check.padEnd(18)} ${c.detail}`);
const fx = r.checks.some((c) => c.check === "fx quote");
const chain = r.checks.some((c) => c.check === "chain");
console.log(r.ok ? `\nVALID: ${file}\n${[...RECEIPT_MEANS, ...(fx ? [RECEIPT_FX_MEANS] : []), ...(chain ? [RECEIPT_CHAIN_MEANS] : [])].join("\n")}` : `\nNOT VALID: ${file} (${r.checks.filter((c) => !c.ok).map((c) => c.check).join(", ")})`);
process.exit(r.ok ? 0 : 1);
