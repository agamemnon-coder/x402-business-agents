// npm run compliance-evidence -- --from YYYY-MM-DD --to YYYY-MM-DD [--out <dir>]
// The compliance evidence of a period (src/compliance/evidence.ts): per control of the map (src/compliance/controls.ts,
// docs/compliance/controls.md), the records in the ledger that show it ran in the days from..to (inclusive, UTC), a
// summary per framework, and a manifest signed with Ed25519 by the audit checkpoint key (PURSER_CHECKPOINT_KEY_FILE, as
// npm run audit-pack signs). Reads the ledger (KIT11_DB) read-only. The same ledger and period give the same files.
// Check it with npm run verify-compliance-evidence -- <dir> --trust <public key> --audit-pack <file>. Exit 0 when
// written, 1 when refused (an audit log that does not verify), 2 on a usage or configuration error.

import Database from "better-sqlite3";
import { existsSync } from "node:fs";
import { checkpointSigner, CHECKPOINT_ENV } from "../audit/checkpointer.js";
import { buildComplianceEvidence, evidenceSummaryLines, writeComplianceEvidence } from "../compliance/evidence.js";
import { DEFAULT_LEDGER, type DB } from "../db/open.js";

const args = process.argv.slice(2);
const opt = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const fail = (message: string, code: number): never => { console.error(message); process.exit(code); };

const from = opt("--from"), to = opt("--to");
if (!from || !to) fail("usage: npm run compliance-evidence -- --from YYYY-MM-DD --to YYYY-MM-DD [--out <dir>]", 2);
const ledger = process.env.KIT11_DB ?? DEFAULT_LEDGER;
if (!existsSync(ledger)) fail(`no ledger at ${ledger} (KIT11_DB)`, 2);
let signer;
try { signer = checkpointSigner(); } catch (e) { fail((e as Error).message, 2); }
if (!signer) fail(`no signing key: set ${CHECKPOINT_ENV.keyFile} to the audit checkpoint key (npm run verify-audit -- keygen --out <file>, outside this repository)`, 2);
const db = new Database(ledger, { readonly: true, fileMustExist: true }) as unknown as DB;
let ev;
try { ev = buildComplianceEvidence(db, { from: from!, to: to! }, signer!); } catch (e) { fail(`REFUSED  ${(e as Error).message}`, /not a day|ends .* before/.test((e as Error).message) ? 2 : 1); }
const out = opt("--out") ?? `purser-compliance-evidence-${from}_${to}`;
try { writeComplianceEvidence(out, ev!); } catch (e) { fail((e as Error).message, 2); }
console.log(`${out}/ (${Object.keys(ev!.files).length} files)`);
for (const l of evidenceSummaryLines(ev!.summary)) console.log(l);
console.log(`check it: npm run verify-compliance-evidence -- ${out} --trust ${signer!.publicKey} --audit-pack <npm run audit-pack -- --from ${from} --to ${to}>`);
