// Purser's records in a public transparency log (npm run transparency): the anchor head (src/anchor/head.ts), the one
// SHA-256 over the heads of Purser's committed tamper-evident records that an Alta testnet transaction already carries,
// goes into Sigstore's public Rekor log too, so a second, independent party holds a timestamped copy that Purser cannot
// take back or rewrite.
//
// What is logged is a statement: the anchor head and height recomputed from this repo over the parts of the latest
// anchor record (docs/runs/<date>-anchor.json), that record's Alta transaction, and optionally the SHA-256 of committed
// manifests (a compliance-evidence or audit-pack manifest.json). Its canonical JSON (RFC 8785) is the artifact: Rekor
// gets its SHA-256 and an ECDSA P-256 signature over it by the dedicated "Purser transparency" key, as a hashedrekord
// v0.0.1 entry. The entry Rekor returns (uuid, logIndex, integratedTime, SET, inclusion proof and checkpoint) is kept in
// docs/transparency/entries/, and `npm run transparency -- verify` checks it with no network: the statement against the
// repo, the body against the statement and Purser's public key, the SET and the checkpoint against Rekor's public key,
// and the inclusion proof up to the checkpoint's root.
//
// The private key never enters the repo, a record or a log line: it is read from PURSER_TRANSPARENCY_KEY (the PEM) or
// from the file PURSER_TRANSPARENCY_KEY_FILE names (outside the repo, mode 0600), and it must match the committed public
// key before anything is sent. Errors name the variable or the path, never the key.

import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign as cryptoSign, verify as cryptoVerify, type KeyObject } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { jcs, type Json } from "@metalntwx/metal-pay/mandates";
import { latestRecordFile, readRecord, type AnchorRecord } from "../anchor/anchor.js";
import { ANCHOR_SCHEMA, computeAnchorHead, type AnchorSource } from "../anchor/head.js";
import { hashedRekord, keyId, leafHash, parseCheckpoint, readBody, rootFromInclusion, spkiDer, verifyCheckpoint, verifySet, type LogTrust, type RekorClient, type RekorEntry } from "./rekor.js";

export const STATEMENT_SCHEMA = "purser.transparency/v1";
export const ENTRY_SCHEMA = "purser.transparency-entry/v1";
export const TRANSPARENCY_DIR = "docs/transparency";
export const ENTRIES_DIR = `${TRANSPARENCY_DIR}/entries`;
/** Purser's transparency public key (ECDSA P-256), committed; its private half is never in the repo. */
export const PURSER_KEY_FILE = `${TRANSPARENCY_DIR}/purser-transparency.pub`;
/** Rekor's production public key, committed with its source (docs/transparency/README.md). */
export const REKOR_KEY_FILE = `${TRANSPARENCY_DIR}/rekor.sigstore.dev.pub`;
export const VERIFY_COMMAND = "npm run transparency -- verify";
/** The environment: the private key's PEM, or the path of a 0600 file outside the repo that holds it. */
export const KEY_ENV = "PURSER_TRANSPARENCY_KEY";
export const KEY_FILE_ENV = "PURSER_TRANSPARENCY_KEY_FILE";

export interface Statement {
  schema: typeof STATEMENT_SCHEMA;
  anchor: { schema: typeof ANCHOR_SCHEMA; record: string; head: string; height: number; network: string; chain_id: number; tx: string };
  manifests: { file: string; sha256: string }[];
}

export interface EntryRecord {
  schema: typeof ENTRY_SCHEMA;
  published_at: string;
  log: { url: string; origin: string; log_id: string; public_key: string };
  signer: { key_id: string; public_key: string; algorithm: "ECDSA P-256 SHA-256" };
  statement: Statement;
  artifact_sha256: string;
  uuid: string;
  entry: RekorEntry;
  check: string;
}

export class TransparencyError extends Error {}

const sha256Hex = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
const posix = (p: string) => p.split(sep).join("/");

/** The statement's bytes, the artifact Rekor gets the digest of: its canonical JSON (RFC 8785). */
export function artifactOf(s: Statement): Buffer {
  return Buffer.from(jcs(s as unknown as Json), "utf8");
}

/** A committed file under docs/, by its path from the repo root: nothing outside, no "..". */
function repoFile(root: string, file: string): string {
  if (!/^docs\/[\w./-]+$/.test(file) || file.split("/").includes("..")) throw new TransparencyError(`${file}: a manifest is a file under docs/, named from the repo root`);
  const p = join(root, file);
  if (!existsSync(p)) throw new TransparencyError(`${file}: no such file`);
  return p;
}

/**
 * The statement from the repo: the anchor head recomputed over the anchor record's own parts, which must equal the head
 * the record (and its Alta transaction) carries, and the SHA-256 of each manifest named.
 */
export function statementFromRepo(root: string, o: { record?: string; manifests?: string[] } = {}): Statement {
  const recordPath = o.record ? join(root, o.record) : latestRecordFile(root);
  if (!recordPath || !existsSync(recordPath)) throw new TransparencyError("no anchor record (docs/runs/<date>-anchor.json): run `npm run anchor -- --live` first");
  const rec: AnchorRecord = readRecord(recordPath);
  const sources: AnchorSource[] = rec.parts.map(({ name, file, kind }) => ({ name, file, kind }));
  const head = computeAnchorHead(root, sources);
  if (head.head !== rec.head || head.height !== rec.height) throw new TransparencyError(`the repo's anchor head ${head.head} is not the one anchored (${rec.head}): anchor it first`);
  return {
    schema: STATEMENT_SCHEMA,
    anchor: { schema: ANCHOR_SCHEMA, record: posix(relative(root, recordPath)), head: head.head, height: head.height, network: rec.network, chain_id: rec.chain_id, tx: rec.tx },
    manifests: (o.manifests ?? []).map((file) => ({ file, sha256: sha256Hex(readFileSync(repoFile(root, file))) })),
  };
}

/** The committed public key (PEM) of Purser's transparency key. */
export const readPurserKey = (root: string) => readFileSync(join(root, PURSER_KEY_FILE), "utf8");
/** The committed Rekor key and its origin. */
export const rekorTrust = (root: string, origin = "rekor.sigstore.dev"): LogTrust => ({ publicKeyPem: readFileSync(join(root, REKOR_KEY_FILE), "utf8"), origin });

/** Whether a path lies inside a directory (both resolved through links). */
function inside(dir: string, p: string): boolean {
  const rel = relative(realpathSync(dir), realpathSync(p));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/**
 * The signing key, from PURSER_TRANSPARENCY_KEY or the file PURSER_TRANSPARENCY_KEY_FILE names: an ECDSA P-256 private
 * key whose public half is the committed one. A file must sit outside the repo and be readable by its owner only (0600).
 * Every error names the variable or the path; none quotes the key.
 */
export function loadSigner(root: string, env: Record<string, string | undefined> = process.env): KeyObject {
  let pem: string, from: string;
  if (env[KEY_ENV]) { pem = env[KEY_ENV]!; from = KEY_ENV; }
  else if (env[KEY_FILE_ENV]) {
    const file = resolve(env[KEY_FILE_ENV]!);
    from = file;
    if (!existsSync(file)) throw new TransparencyError(`no key file at ${file}`);
    if (inside(root, file)) throw new TransparencyError(`${file} is inside the repository: keep the key file outside it`);
    if ((statSync(file).mode & 0o077) !== 0) throw new TransparencyError(`${file} is readable by others: chmod 600 it`);
    pem = readFileSync(file, "utf8");
  } else throw new TransparencyError(`no key: set ${KEY_ENV} or ${KEY_FILE_ENV} (docs/security/key-management.md)`);
  let key: KeyObject;
  try { key = createPrivateKey(pem); } catch { throw new TransparencyError(`${from} holds no private key`); }
  if (key.asymmetricKeyType !== "ec" || key.asymmetricKeyDetails?.namedCurve !== "prime256v1") throw new TransparencyError(`${from} is not an ECDSA P-256 key`);
  const pub = createPublicKey(key).export({ type: "spki", format: "der" });
  if (!pub.equals(spkiDer(readPurserKey(root)))) throw new TransparencyError(`${from} is not the key whose public half is ${PURSER_KEY_FILE}`);
  return key;
}

/** The hashedrekord entry for a statement, signed by the key: what is sent to the log. */
export function proposeEntry(s: Statement, key: KeyObject, publicKeyPem: string) {
  const artifact = artifactOf(s);
  const sig = cryptoSign("sha256", artifact, key).toString("base64");
  return { artifactSha256: sha256Hex(artifact), body: hashedRekord(sha256Hex(artifact), sig, publicKeyPem) };
}

export interface Line { ok: boolean; what: string; detail: string }
export interface EntryCheck { match: boolean; lines: Line[] }

/**
 * The offline check of one entry record. `root` set: the statement is recomputed from the repo first. Then the body
 * against the statement and Purser's key, the SET and the checkpoint against the log's key, the inclusion proof up to
 * the checkpoint's root. No network.
 */
export function verifyEntry(r: EntryRecord, trust: { purserKeyPem: string; log: LogTrust }, root?: string): EntryCheck {
  const lines: Line[] = [];
  const add = (ok: boolean, what: string, detail: string) => lines.push({ ok, what, detail });
  const s = r.statement;
  if (root) {
    try {
      const now = statementFromRepo(root, { record: s.anchor.record, manifests: s.manifests.map((m) => m.file) });
      add(now.anchor.head === s.anchor.head && now.anchor.height === s.anchor.height, "anchor head", `recomputed from the repo: ${now.anchor.head}, height ${now.anchor.height}`);
      add(now.anchor.tx === s.anchor.tx && now.anchor.chain_id === s.anchor.chain_id, "Alta transaction", `${s.anchor.tx} on chain id ${s.anchor.chain_id} (${s.anchor.record})`);
      for (const m of s.manifests) {
        const n = now.manifests.find((x) => x.file === m.file);
        add(n?.sha256 === m.sha256, `manifest ${m.file}`, `sha256 ${n?.sha256 ?? "missing"}`);
      }
    } catch (e) { add(false, "repo", (e as Error).message); }
  }
  const artifact = artifactOf(s), digest = sha256Hex(artifact);
  add(digest === r.artifact_sha256, "statement digest", digest);
  const body = readBody(r.entry?.body ?? "");
  if (!body) { add(false, "entry body", "not a hashedrekord v0.0.1 entry"); return { match: false, lines }; }
  add(body.spec.data.hash.value === digest, "entry hash", `the log holds sha256 ${body.spec.data.hash.value}`);
  let bodyKey: Buffer | null = null;
  try { bodyKey = spkiDer(Buffer.from(body.spec.signature.publicKey.content, "base64").toString("utf8")); } catch { /* not a key */ }
  const purser = spkiDer(trust.purserKeyPem);
  add(!!bodyKey && bodyKey.equals(purser), "entry key", `Purser's transparency key ${keyId(trust.purserKeyPem).slice(0, 16)}…`);
  let sigOk = false;
  try { sigOk = cryptoVerify("sha256", artifact, createPublicKey(trust.purserKeyPem), Buffer.from(body.spec.signature.content, "base64")); } catch { /* bad signature */ }
  add(sigOk, "entry signature", "ECDSA P-256 over the statement by Purser's key");
  const logId = keyId(trust.log.publicKeyPem);
  add(r.entry.logID === logId, "log id", `${r.entry.logID}${r.entry.logID === logId ? "" : `, the trusted key is ${logId}`}`);
  add(verifySet(r.entry, trust.log), "signed entry timestamp", `log index ${r.entry.logIndex}, integrated ${new Date(r.entry.integratedTime * 1000).toISOString()}`);
  const leaf = leafHash(r.entry.body);
  add(r.uuid.endsWith(leaf) && r.uuid.length >= 64, "entry uuid", `ends with the leaf hash ${leaf.slice(0, 16)}…`);
  const p = r.entry.verification?.inclusionProof;
  if (!p) { add(false, "inclusion proof", "none recorded"); return { match: false, lines }; }
  const root2 = rootFromInclusion(leaf, p.logIndex, p.treeSize, p.hashes ?? []);
  add(!!root2 && root2 === p.rootHash, "inclusion proof", `leaf ${p.logIndex} of ${p.treeSize} hashes up to root ${p.rootHash.slice(0, 16)}…`);
  const cp = parseCheckpoint(p.checkpoint ?? "");
  add(!!cp && cp.rootHash === p.rootHash && cp.treeSize === p.treeSize, "checkpoint", cp ? `${cp.origin}, size ${cp.treeSize}` : "malformed");
  add(!!cp && verifyCheckpoint(cp, trust.log), "checkpoint signature", `signed by ${trust.log.origin}`);
  return { match: lines.every((l) => l.ok), lines };
}

/**
 * Publishes the statement: signs it, sends the entry to the log, checks what comes back offline with the log's key, and
 * returns the record (not yet written). Refuses an answer that does not verify.
 */
export async function publish(root: string, key: KeyObject, client: RekorClient, trust: LogTrust, o: { manifests?: string[]; now?: Date; purserKeyPem?: string } = {}): Promise<EntryRecord> {
  const statement = statementFromRepo(root, { manifests: o.manifests });
  const purserKeyPem = o.purserKeyPem ?? readPurserKey(root);
  const { artifactSha256, body } = proposeEntry(statement, key, purserKeyPem);
  const { uuid, entry } = await client.createEntry(body);
  const record: EntryRecord = {
    schema: ENTRY_SCHEMA, published_at: (o.now ?? new Date()).toISOString(),
    log: { url: client.url, origin: trust.origin, log_id: keyId(trust.publicKeyPem), public_key: REKOR_KEY_FILE },
    signer: { key_id: keyId(purserKeyPem), public_key: PURSER_KEY_FILE, algorithm: "ECDSA P-256 SHA-256" },
    statement, artifact_sha256: artifactSha256, uuid, entry, check: VERIFY_COMMAND,
  };
  const c = verifyEntry(record, { purserKeyPem, log: trust }, root);
  if (!c.match) throw new TransparencyError(`the log's answer does not verify: ${c.lines.filter((l) => !l.ok).map((l) => l.what).join(", ")}`);
  return record;
}

/** Writes docs/transparency/entries/<date>-rekor-<logIndex>.json; returns its path. */
export function writeEntry(root: string, r: EntryRecord): string {
  const file = join(root, ENTRIES_DIR, `${r.published_at.slice(0, 10)}-rekor-${r.entry.logIndex}.json`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(r, null, 2)}\n`);
  return file;
}

/** Every committed entry record, oldest first. */
export function entryFiles(root: string): string[] {
  const dir = join(root, ENTRIES_DIR);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => /^\d{4}-\d{2}-\d{2}-rekor-\d+\.json$/.test(f)).sort().map((f) => join(dir, f));
}

/**
 * A new transparency key (`npm run transparency -- keygen --out <file>`): the private key written to `out` (outside the
 * repo, mode 0600, never over an existing file), its public half to docs/transparency/purser-transparency.pub (only with
 * `replace` when one is there: rotating the key is a decision, docs/security/key-management.md). Returns the key id.
 */
export function generateKeyFile(root: string, out: string, o: { replace?: boolean } = {}): string {
  const file = resolve(out);
  if (existsSync(file)) throw new TransparencyError(`${file} exists: not overwritten`);
  mkdirSync(dirname(file), { recursive: true });
  if (inside(root, dirname(file))) throw new TransparencyError(`${file} is inside the repository: keep the key file outside it`);
  const pubFile = join(root, PURSER_KEY_FILE);
  if (existsSync(pubFile) && !o.replace) throw new TransparencyError(`${PURSER_KEY_FILE} exists: pass --replace to rotate the key`);
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  writeFileSync(file, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600, flag: "wx" });
  const pem = publicKey.export({ type: "spki", format: "pem" }).toString();
  mkdirSync(dirname(pubFile), { recursive: true });
  writeFileSync(pubFile, pem);
  return keyId(pem);
}

export function readEntry(file: string): EntryRecord {
  const r = JSON.parse(readFileSync(file, "utf8")) as EntryRecord;
  if (r.schema !== ENTRY_SCHEMA || r.statement?.schema !== STATEMENT_SCHEMA || typeof r.entry?.body !== "string") throw new TransparencyError(`${file} is not a transparency entry record`);
  return r;
}
