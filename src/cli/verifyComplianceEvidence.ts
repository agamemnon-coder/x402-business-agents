// npm run verify-compliance-evidence -- <dir> [--trust <public key>[,<public key>]] [--audit-pack <file>]
// Checks the compliance evidence (npm run compliance-evidence; src/compliance/evidence.ts) offline: the manifest's
// Ed25519 signature (and whose key, given pinned keys), every file's SHA-256 against the manifest (a changed, missing or
// added file is named), the summary against the files it sums, and, with the audit pack of the same period (npm run
// audit-pack), that the pack verifies and has every cited audit row in the period's hash chain. The pinned keys are
// --trust, else PURSER_CHECKPOINT_TRUST and the configured checkpoint key's own. No database, no network. Exit 0 when
// every check passes, 1 when one fails, 2 when the files cannot be read.

import { readFileSync, statSync } from "node:fs";
import { checkpointSigner, trustedKeys } from "../audit/checkpointer.js";
import { readComplianceEvidence, verifyComplianceEvidence } from "../compliance/evidence.js";

const args = process.argv.slice(2);
const valued = new Set(["--trust", "--audit-pack"]);
const dir = args.find((a, i) => !a.startsWith("--") && !valued.has(args[i - 1] ?? ""));
if (!dir) { console.error("usage: npm run verify-compliance-evidence -- <dir> [--trust <public key>] [--audit-pack <file>]"); process.exit(2); }
let files: Record<string, string>;
try {
  if (!statSync(dir).isDirectory()) throw new Error("not a directory");
  files = readComplianceEvidence(dir);
} catch (e) { console.error(`cannot read ${dir}: ${(e as Error).message}`); process.exit(2); }
const p = args.indexOf("--audit-pack");
let auditPack: unknown;
if (p >= 0) {
  try { auditPack = JSON.parse(readFileSync(args[p + 1] ?? "", "utf8")); } catch (e) { console.error(`cannot read the audit pack ${args[p + 1] ?? ""} as JSON: ${(e as Error).message}`); process.exit(2); }
}
const t = args.indexOf("--trust");
let trusted: string[];
try {
  if (t >= 0) trusted = (args[t + 1] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  else {
    let signer = null;
    try { signer = checkpointSigner(); } catch { /* the pinned keys alone */ }
    trusted = trustedKeys(signer);
  }
} catch (e) { console.error((e as Error).message); process.exit(2); }
const r = verifyComplianceEvidence(files!, { trusted: trusted!, auditPack });
for (const c of r.checks) console.log(`${c.ok ? "pass" : "FAIL"}  ${c.check.padEnd(12)} ${c.detail}`);
console.log(r.ok ? `\nVALID: ${dir}` : `\nNOT VALID: ${dir} (${r.checks.filter((c) => !c.ok).map((c) => c.check).join(", ")})`);
process.exit(r.ok ? 0 : 1);
