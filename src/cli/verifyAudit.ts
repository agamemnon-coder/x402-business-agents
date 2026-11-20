// npm run verify-audit: the audit log against its signed checkpoints (outside audit 1.4; src/audit/checkpoint.ts).
//
//   npm run verify-audit [-- --checkpoints <file>] [--jsonl <audit.jsonl>] [--trust <key>[,<key>]] [--known <copy>]
//                         [--max-tail-age-min <minutes>]
//       Offline: every row's hash, every checkpoint's signature, link and key, and the one against the other. The
//       ledger is KIT11_DB (or an export, --jsonl); the checkpoints are PURSER_CHECKPOINT_FILE or the file beside the
//       ledger. The pinned keys are --trust, else PURSER_CHECKPOINT_TRUST and the configured key's own. --known is a
//       copy of the checkpoint file kept earlier (it must still be a prefix: catches a file cut back to an old
//       checkpoint). --max-tail-age-min says how long a row may go uncovered (with real clocks: a few schedules).
//   npm run verify-audit -- init                   the first checkpoint over a ledger that verifies (run npm run verify first)
//   npm run verify-audit -- checkpoint [--accept-tail]
//       one checkpoint now; --accept-tail also covers money rows another process wrote and never checkpointed (after a
//       crash), once a person has looked at them
//   npm run verify-audit -- rotate --new-key <pem file>
//       a checkpoint signed with the current key that introduces the new one, then one signed with the new one. Stop the
//       runner first; then set PURSER_CHECKPOINT_KEY_FILE to the new file and start it again
//   npm run verify-audit -- keygen --out <file>    a new Ed25519 key (PKCS#8 PEM, mode 0600), never inside this repo
//
// Exit code 0 when all is well, 1 on a finding, 2 on a usage or configuration error. Nothing secret is printed: the
// public key and its id only.

import { createPrivateKey, generateKeyPairSync } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { verifyCheckpointedLedger, keyIdOf, normalisePublicKey, rawPublicKey } from "../audit/checkpoint.js";
import { checkpointSigner, checkpointStore, CHECKPOINT_ENV, trustedKeys, writeCheckpoint } from "../audit/checkpointer.js";
import type { AuditRowStored } from "../audit/log.js";
import { openDb } from "../db/open.js";

const args = process.argv.slice(2);
const opt = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const command = args[0] && !args[0].startsWith("--") ? args[0] : "verify";

function fail(message: string, code = 2): never {
  console.error(message);
  process.exit(code);
}

function signerOrFail() {
  try {
    const s = checkpointSigner();
    if (!s) fail(`no checkpoint key: set ${CHECKPOINT_ENV.keyFile} to an Ed25519 PEM file (npm run verify-audit -- keygen --out <file>)`);
    return s;
  } catch (e) { fail((e as Error).message); }
}

if (command === "keygen") {
  const out = opt("--out");
  if (!out) fail("keygen needs --out <file>, outside this repository");
  const rel = relative(process.cwd(), resolve(out));
  if (!rel.startsWith("..") && !rel.startsWith("/")) fail(`${out} is inside this repository; a key never goes here. Put it with the runner's other keys.`);
  if (existsSync(out)) fail(`${out} exists; it is not overwritten`);
  const { privateKey } = generateKeyPairSync("ed25519");
  writeFileSync(out, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600, flag: "wx" });
  const pub = rawPublicKey(privateKey);
  console.log(`key      ${out} (mode 0600)\npublic   ${pub}\nkey id   ${keyIdOf(pub)}\nPin the public key where auditors can see it; set ${CHECKPOINT_ENV.keyFile}=${out} on the runner.`);
  process.exit(0);
}

const db = openDb();

if (command === "init" || command === "checkpoint" || command === "rotate") {
  const signer = signerOrFail();
  let rotateTo;
  if (command === "rotate") {
    const file = opt("--new-key");
    if (!file) fail("rotate needs --new-key <pem file>");
    try { rotateTo = createPrivateKey(readFileSync(file, "utf8")); } catch { fail(`${file} is not a PEM private key`); }
    if (rotateTo.asymmetricKeyType !== "ed25519") fail(`${file} is not an Ed25519 key`);
    if (rawPublicKey(rotateTo) === signer.publicKey) fail("the new key is the current key");
  }
  const r = writeCheckpoint(db, { init: command === "init", acceptTail: args.includes("--accept-tail"), rotateTo });
  if (!r.ok) fail(`REFUSED  ${r.reason}`, 1);
  for (const c of r.checkpoints) console.log(`ok    checkpoint ${c.n}: ${c.entries} rows, head ${c.head.slice(0, 16)}…, key ${c.key_id}${c.rotate_to ? `, introduces key ${c.rotate_to.key_id}` : ""}`);
  if (rotateTo) console.log(`Now set ${CHECKPOINT_ENV.keyFile} to ${opt("--new-key")} and start the runner again; key ${signer.keyId} signs nothing more.`);
  process.exit(0);
}

if (command !== "verify") fail(`unknown command ${command}: verify (the default), init, checkpoint, rotate, keygen`);

const jsonl = opt("--jsonl");
const rows: AuditRowStored[] = jsonl
  ? readFileSync(jsonl, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as AuditRowStored)
  : (db.prepare("SELECT * FROM audit_log ORDER BY seq").all() as AuditRowStored[]);
let signer = null;
try { signer = checkpointSigner(); } catch (e) { console.error(`note  the configured key cannot be loaded (${(e as Error).message}); verifying with the pinned keys only`); }
const cpFile = opt("--checkpoints");
const text = cpFile ? readFileSync(cpFile, "utf8") : checkpointStore(db).read();
const trustArg = opt("--trust");
let trusted: string[];
try { trusted = trustArg ? trustArg.split(",").map(normalisePublicKey) : trustedKeys(signer); } catch (e) { fail((e as Error).message); }
if (!trusted.length) fail(`no pinned key: pass --trust <public key>, or set ${CHECKPOINT_ENV.trust} or ${CHECKPOINT_ENV.keyFile}`);
const known = opt("--known");
const ageMin = opt("--max-tail-age-min");
const res = verifyCheckpointedLedger({
  rows, checkpoints: text, trusted, known: known ? readFileSync(known, "utf8") : undefined,
  maxTailAgeMs: ageMin ? Number(ageMin) * 60_000 : undefined,
});
console.log(`${res.ok ? "ok  " : "FAIL"}  ${res.rows} audit rows, ${res.checkpoints} checkpoint(s)${res.latest ? `; latest ${res.latest.n} covers ${res.latest.entries} rows at ${res.latest.ts}, key ${res.latest.key_id}` : ""}; pinned ${trusted.map(keyIdOf).join(", ")}`);
for (const p of res.problems) console.log(`FAIL  ${p.code}  ${p.detail}`);
process.exit(res.ok ? 0 : 1);
