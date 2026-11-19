// npm run verify-eidas -- approval.jades.json
// Checks an eIDAS evidence export offline (src/eidas/jades.ts): the terms hash, each passkey's WebAuthn signature with
// the runner's own verifier, the times and the policy version, any RFC 3161 time-stamp, and any JAdES signature with
// the certificate inside the file. No network, no server, no key of ours, no flag needed. Exit 0 when every check
// passes, 1 when one fails, 2 when the file cannot be read.

import { readFileSync } from "node:fs";
import { EIDAS_MEANS, verifyJadesText } from "../eidas/jades.js";

const file = process.argv[2];
if (!file) { console.error("usage: npm run verify-eidas -- approval.jades.json"); process.exit(2); }
let text: string;
try { text = readFileSync(file, "utf8"); } catch (e) { console.error(`cannot read ${file}: ${(e as Error).message}`); process.exit(2); }
const r = await verifyJadesText(text);
for (const c of r.checks) console.log(`${c.ok ? "pass" : "FAIL"}  ${c.check.padEnd(18)} ${c.detail}`);
console.log(r.ok ? `\nVALID: ${file}\n${r.levels.map((l) => `- ${l}`).join("\n")}\n\n${EIDAS_MEANS.join("\n")}` : `\nNOT VALID: ${file} (${r.checks.filter((c) => !c.ok).map((c) => c.check).join(", ")})`);
process.exit(r.ok ? 0 : 1);
