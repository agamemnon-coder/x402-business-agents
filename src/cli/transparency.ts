// npm run transparency -- publish [--dry] [--manifest <docs/…/manifest.json>]...
// npm run transparency -- verify [<docs/transparency/entries/<file>.json>]
// npm run transparency -- keygen --out <file outside the repo> [--replace]
// (src/transparency/transparency.ts.) publish: the statement (the anchor head recomputed from the repo, its Alta
// transaction, the manifests' SHA-256) signed with the Purser transparency key and sent to Sigstore's public Rekor log
// as one hashedrekord entry; the answer is checked offline before it is written to docs/transparency/entries/. --dry
// prints the statement and its digest, with no key and no network. The key comes from PURSER_TRANSPARENCY_KEY or
// PURSER_TRANSPARENCY_KEY_FILE and is never printed. verify: every committed entry (or the one named) checked offline,
// no network; exit 0 when each verifies, 1 when one does not, 2 when there is none. keygen: a new key pair.

import { createHash } from "node:crypto";
import { relative, resolve } from "node:path";
import { httpRekor, REKOR_URL } from "../transparency/rekor.js";
import { artifactOf, entryFiles, generateKeyFile, loadSigner, publish, readEntry, readPurserKey, rekorTrust, statementFromRepo, VERIFY_COMMAND, verifyEntry, writeEntry } from "../transparency/transparency.js";

const root = resolve(import.meta.dirname, "../..");
const [cmd, ...args] = process.argv.slice(2);
const opt = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const many = (name: string) => args.flatMap((a, i) => (a === name ? [args[i + 1] ?? ""] : []));
const usage = () => { console.error("usage: npm run transparency -- publish [--dry] [--manifest <file>]... | verify [<entry file>] | keygen --out <file> [--replace]"); process.exit(2); };

if (cmd === "publish") {
  let statement;
  try { statement = statementFromRepo(root, { manifests: many("--manifest") }); } catch (e) { console.error((e as Error).message); process.exit(2); }
  const digest = createHash("sha256").update(artifactOf(statement)).digest("hex");
  console.log(`anchor   ${statement.anchor.head}  height ${statement.anchor.height}  (${statement.anchor.record})`);
  console.log(`alta tx  ${statement.anchor.tx}  chain id ${statement.anchor.chain_id}`);
  for (const m of statement.manifests) console.log(`manifest ${m.sha256}  ${m.file}`);
  console.log(`digest   ${digest}  (sha256 of the statement's canonical JSON)`);
  if (args.includes("--dry")) { console.log("\ndry run: nothing signed or sent."); process.exit(0); }
  let key;
  try { key = loadSigner(root); } catch (e) { console.error(`\nnot sent: ${(e as Error).message}`); process.exit(2); }
  try {
    const record = await publish(root, key, httpRekor(process.env.REKOR_URL ?? REKOR_URL), rekorTrust(root), { manifests: many("--manifest") });
    const file = writeEntry(root, record);
    console.log(`\nlogged   ${record.log.url}  index ${record.entry.logIndex}  uuid ${record.uuid}\n         integrated ${new Date(record.entry.integratedTime * 1000).toISOString()}\nwrote    ${relative(root, file)}\ncheck    ${VERIFY_COMMAND}`);
  } catch (e) {
    console.error(`\npublish failed: ${(e as Error).message.split("\n")[0]}`);
    process.exit(1);
  }
} else if (cmd === "verify") {
  const files = args[0] ? [resolve(args[0])] : entryFiles(root);
  if (!files.length) { console.error("no transparency entry yet (docs/transparency/entries/): nothing is logged live. `npm run transparency -- publish` makes one."); process.exit(2); }
  const trust = { purserKeyPem: readPurserKey(root), log: rekorTrust(root) };
  let all = true;
  for (const f of files) {
    let r;
    try { r = readEntry(f); } catch (e) { console.error((e as Error).message); all = false; continue; }
    const c = verifyEntry(r, trust, root);
    console.log(`${relative(root, f)}`);
    for (const l of c.lines) console.log(`  ${l.ok ? "ok  " : "FAIL"}  ${l.what.padEnd(24)} ${l.detail}`);
    console.log(`  ${c.match ? "VERIFIED" : "NOT VERIFIED"}: Rekor index ${r.entry.logIndex}\n`);
    all &&= c.match;
  }
  process.exit(all ? 0 : 1);
} else if (cmd === "keygen") {
  const out = opt("--out");
  if (!out) usage();
  try {
    const id = generateKeyFile(root, out!, { replace: args.includes("--replace") });
    console.log(`wrote the private key to ${resolve(out!)} (mode 0600) and the public key to docs/transparency/purser-transparency.pub\nkey id ${id}`);
  } catch (e) { console.error((e as Error).message); process.exit(2); }
} else usage();
