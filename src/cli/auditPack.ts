// npm run audit-pack -- --from YYYY-MM-DD --to YYYY-MM-DD [--out <file>]
// The signed audit pack of a period for an auditor (src/audit/pack.ts): every payment decision, approval (method,
// passkey, approved terms hash), policy version and change, refusal and hold, and reconciliation in the days from..to
// (inclusive, UTC), with the audit chain from its genesis hash, a manifest of SHA-256 hashes and an Ed25519 signature
// by the audit checkpoint key (PURSER_CHECKPOINT_KEY_FILE, as npm run verify-audit uses). The ledger is KIT11_DB.
// Check it with npm run verify-audit-pack -- <file> --trust <public key>. Exit 0 when written, 1 when refused (a ledger
// that does not verify), 2 on a usage or configuration error.

import { writeFileSync } from "node:fs";
import { buildAuditPack, packSummary } from "../audit/pack.js";
import { checkpointSigner, CHECKPOINT_ENV } from "../audit/checkpointer.js";
import { openDb } from "../db/open.js";

const args = process.argv.slice(2);
const opt = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const fail = (message: string, code: number): never => { console.error(message); process.exit(code); };

const from = opt("--from"), to = opt("--to");
if (!from || !to) fail("usage: npm run audit-pack -- --from YYYY-MM-DD --to YYYY-MM-DD [--out <file>]", 2);
let signer;
try { signer = checkpointSigner(); } catch (e) { fail((e as Error).message, 2); }
if (!signer) fail(`no signing key: set ${CHECKPOINT_ENV.keyFile} to the audit checkpoint key (npm run verify-audit -- keygen --out <file>, outside this repository)`, 2);
let pack;
try { pack = buildAuditPack(openDb(), { from: from!, to: to! }, signer!); } catch (e) { fail(`REFUSED  ${(e as Error).message}`, /not a day|ends .* before/.test((e as Error).message) ? 2 : 1); }
const out = opt("--out") ?? `purser-audit-pack-${from}_${to}.json`;
writeFileSync(out, `${JSON.stringify(pack, null, 1)}\n`);
console.log(`${out}`);
for (const l of packSummary(pack!)) console.log(l);
console.log(`check it: npm run verify-audit-pack -- ${out} --trust ${pack!.manifest.public_key}`);
