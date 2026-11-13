// npm run verify-anchor [-- <docs/runs/<date>-anchor.json>]
// Recomputes the anchor head from this repo, reads the anchor transaction from Metal testnet (METAL_RPC_URL) and prints
// MATCH or MISMATCH. Exit 0 on MATCH, 1 on MISMATCH, 2 when there is no record or no RPC.

import { resolve } from "node:path";
import { latestRecordFile, readRecord, verifyAnchor } from "../anchor/anchor.js";
import { metalReader } from "../anchor/metalChain.js";

const root = resolve(import.meta.dirname, "../..");
const file = process.argv[2] ?? latestRecordFile(root);
if (!file) { console.error("no anchor record yet (docs/runs/<date>-anchor.json): run `npm run anchor -- --live` first"); process.exit(2); }
if (!process.env.METAL_RPC_URL) { console.error("METAL_RPC_URL is not set: it is needed to read the transaction"); process.exit(2); }
let record;
try { record = readRecord(file); } catch (e) { console.error((e as Error).message); process.exit(2); }
const r = await verifyAnchor(root, record, metalReader());
for (const l of r.lines) console.log(`${l.ok ? "ok  " : "FAIL"}  ${l.what.padEnd(36)} ${l.detail}`);
console.log(`\n${r.match ? "MATCH" : "MISMATCH"}: ${file}, tx ${record.tx}`);
process.exit(r.match ? 0 : 1);
