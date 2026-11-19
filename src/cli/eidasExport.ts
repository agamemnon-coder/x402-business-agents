// npm run eidas:export -- purser-proof.json [--tsa https://tsa.example/tsr] [--out file]
// npm run eidas:export -- --proposal P-0001 [--tsa …] [--out file]        (a passkey approval from the runner's ledger)
// The eIDAS option (off by default; PURSER_EIDAS=on): writes one signed approval as JAdES-layout evidence
// (src/eidas/jades.ts), checks the file it wrote, and prints what it is. With --tsa, an RFC 3161 time-stamp from that
// TSA is added: the only network call, and only when asked. No QES here: the QES adapter (src/eidas/csc.ts) is
// built and tested against a mock CSC server and needs a QTSP account to run live (docs/legal/eidas-qes.md).

import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { openDb } from "../db/open.js";
import { QES_STATUS } from "../eidas/csc.js";
import { eidasOn, EIDAS_FLAG } from "../eidas/flag.js";
import { approvalFromLedger, approvalFromProofBundle, exportJades, JADES_SUFFIX, jadesText, verifyJades } from "../eidas/jades.js";
import { requestTimestamp } from "../eidas/tsa.js";
import type { ProofBundle } from "../proof/bundle.js";

const args = process.argv.slice(2);
const opt = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const proposal = opt("--proposal"), tsa = opt("--tsa");
const file = args.find((a, i) => !a.startsWith("--") && !["--proposal", "--tsa", "--out"].includes(args[i - 1] ?? ""));
if (!eidasOn()) { console.error(`the eIDAS option is off; ${EIDAS_FLAG}=on turns it on (docs/legal/eidas-qes.md)`); process.exit(2); }
if (!proposal === !file) { console.error("usage: npm run eidas:export -- purser-proof.json | --proposal P-0001 [--tsa URL] [--out file]"); process.exit(2); }

const approval = file ? approvalFromProofBundle(JSON.parse(readFileSync(file, "utf8")) as ProofBundle) : approvalFromLedger(openDb(), proposal!);
const out = opt("--out") ?? `${file ? basename(file).replace(/\.json$/, "") : proposal}${JADES_SUFFIX}`;
const exp = await exportJades(approval, tsa ? { stamp: (d) => requestTimestamp(tsa, d) } : {});
writeFileSync(out, jadesText(exp));
const r = await verifyJades(exp);
for (const l of r.levels) console.log(`  ${l}`);
console.log(`\nwrote ${out}; check it with: npm run verify-eidas -- ${out}\nQES tier: ${QES_STATUS}.`);
