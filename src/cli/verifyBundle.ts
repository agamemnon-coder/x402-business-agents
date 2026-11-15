// npm run verify-bundle -- purser-proof.json
// Checks a /try proof bundle offline: the same checks, the same code as the /verify page (src/proof/bundle.ts), run
// with Node's own WebCrypto. No network, no server, no key of ours. Exit 0 when every check passes, 1 when one fails
// or the file cannot be read.

import { readFileSync } from "node:fs";
import { proofMeans, verifyProofBundle } from "../proof/bundle.js";

const file = process.argv[2];
if (!file) { console.error("usage: npm run verify-bundle -- purser-proof.json"); process.exit(1); }
let json: unknown;
try { json = JSON.parse(readFileSync(file, "utf8")); } catch (e) { console.error(`cannot read ${file} as JSON: ${(e as Error).message}`); process.exit(1); }
const r = await verifyProofBundle(json);
for (const c of r.checks) console.log(`${c.ok ? "pass" : "FAIL"}  ${c.check.padEnd(15)} ${c.detail}`);
console.log(r.ok ? `\nVALID: ${file}\n${proofMeans(json).join("\n")}` : `\nNOT VALID: ${file} (${r.checks.filter((c) => !c.ok).map((c) => c.check).join(", ")})`);
process.exit(r.ok ? 0 : 1);
