// npm run verify-audit-pack -- <file> [--trust <public key>[,<public key>]]
// Checks a signed audit pack (npm run audit-pack; src/audit/pack.ts) offline: every row's hash against the manifest,
// the manifest's Ed25519 signature, the audit chain from its genesis hash through the period, each reading section
// against the audit rows it was sorted out of, every proposal's terms against their hash, every policy version's rules.
// The pinned keys are --trust, else PURSER_CHECKPOINT_TRUST and the configured checkpoint key's own; with none, whose
// key signed it is not checked (said so). No database, no network. Exit 0 when every check passes, 1 when one fails,
// 2 when the file cannot be read.

import { readFileSync } from "node:fs";
import { checkpointSigner, trustedKeys } from "../audit/checkpointer.js";
import { verifyAuditPack } from "../audit/pack.js";

const args = process.argv.slice(2);
const file = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--trust");
if (!file) { console.error("usage: npm run verify-audit-pack -- <file> [--trust <public key>]"); process.exit(2); }
let json: unknown;
try { json = JSON.parse(readFileSync(file, "utf8")); } catch (e) { console.error(`cannot read ${file} as JSON: ${(e as Error).message}`); process.exit(2); }
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
const r = verifyAuditPack(json, { trusted });
for (const c of r.checks) console.log(`${c.ok ? "pass" : "FAIL"}  ${c.check.padEnd(20)} ${c.detail}`);
console.log(r.ok ? `\nVALID: ${file}` : `\nNOT VALID: ${file} (${r.checks.filter((c) => !c.ok).map((c) => c.check).join(", ")})`);
process.exit(r.ok ? 0 : 1);
