// Signed audit checkpoints (outside audit, finding 1.4): the hash chain (src/audit/log.ts) proves the rows link up, but
// someone who can write the SQLite file can cut its tail or rewrite it and recompute every hash. A checkpoint pins the
// chain from outside the database: {n, entries, head, ts, key_id} signed with an Ed25519 key that is never in the
// ledger (src/audit/checkpointer.ts loads it from the environment). The checkpoints are one JSON line each in an
// append-only file, each linking to the one before, so the file is a chain of its own.
//
// This module is the verifier: pure functions over the checkpoint lines and the audit rows, no database, no files. It
// finds, each by its own code:
// - truncated:        the ledger has fewer rows than the latest checkpoint covers;
// - rewritten:        a row a checkpoint covers no longer has the hash it signed (a full-chain rewrite, recomputed);
// - replay:           an old checkpoint presented as the latest (re-appended, or the file cut back to it while a newer
//                     one is known); rollback when a later checkpoint covers fewer rows;
// - uncovered_money:  a forged append: a money row after the latest checkpoint that no signed intent announced (the
//                     process that records a money row signs an intent for its exact hash before committing it, and
//                     a checkpoint right after), and bad_signature for a line that was forged or changed;
// - unknown_key / rotated_out_key: a checkpoint signed by a key the chain never introduced, or by one it retired. A
//                     new key is introduced only by a checkpoint signed with the old one (rotate_to);
// - untrusted:        no checkpoint is signed by a key the verifier pinned, so the whole file could be anyone's.

import { createHash, createPublicKey, sign as edSign, verify as edVerify, type KeyObject } from "node:crypto";
import { jcs, type Json } from "@metalntwx/metal-pay/mandates";
import { sha256Hex } from "../lib/terms.js";
import { MONEY_EVENTS } from "../provenance/origin.js";
import { GENESIS, verifyAuditRowsFrom, type AuditRowStored } from "./log.js";

export const CHECKPOINT_SCHEMA = "purser.checkpoint/v1";

export interface CheckpointBody {
  v: typeof CHECKPOINT_SCHEMA;
  /** The checkpoint's own sequence number, 1, 2, 3… with no gaps. */
  n: number;
  /** The audit rows it covers: seq 1..entries (the ledger's seqs run without gaps, so this is also the last seq). */
  entries: number;
  /** row_hash of row `entries` (the genesis hash when entries is 0). */
  head: string;
  /** When it was signed (the signer's clock). */
  ts: string;
  /** The first 16 hex of SHA-256 over the raw public key. */
  key_id: string;
  /** The raw Ed25519 public key that signed it, base64url (32 bytes). Whether it may sign is the chain's to say. */
  public_key: string;
  /** checkpointId of the checkpoint before, or the genesis hash for n = 1. */
  prev: string;
  /** Key rotation: the key that signs every checkpoint after this one. This one is still signed by the old key. */
  rotate_to?: { key_id: string; public_key: string };
}

export interface Checkpoint extends CheckpointBody { sig: string }

export type ProblemCode =
  | "malformed" | "bad_signature" | "unknown_key" | "rotated_out_key" | "broken_link" | "replay" | "rollback" | "untrusted"
  | "no_checkpoint" | "chain_broken" | "truncated" | "rewritten" | "uncovered_money" | "stale_tail" | "key_rotated";

export interface Problem { code: ProblemCode; n?: number; seq?: number; detail: string }

const HEX64 = /^[0-9a-f]{64}$/;
const KEY_ID = /^[0-9a-f]{16}$/;
const B64URL_32 = /^[A-Za-z0-9_-]{43}$/;

/** The raw public key of an Ed25519 key (private or public), base64url. */
export function rawPublicKey(key: KeyObject): string {
  const pub = key.type === "private" ? createPublicKey(key) : key;
  if (pub.asymmetricKeyType !== "ed25519") throw new Error(`a checkpoint key is Ed25519, not ${pub.asymmetricKeyType ?? "unknown"}`);
  const x = pub.export({ format: "jwk" }).x;
  if (typeof x !== "string") throw new Error("the key has no public part");
  return x;
}

export function keyIdOf(publicKey: string): string {
  return createHash("sha256").update(Buffer.from(publicKey, "base64url")).digest("hex").slice(0, 16);
}

/** A public key given as base64url raw bytes, standard base64, or a PEM (SPKI): its base64url raw form. */
export function normalisePublicKey(text: string): string {
  const t = text.trim();
  if (t.includes("BEGIN PUBLIC KEY")) return rawPublicKey(createPublicKey(t));
  const raw = Buffer.from(t.replace(/^ed25519:/, ""), /[+/=]/.test(t) ? "base64" : "base64url");
  if (raw.length !== 32) throw new Error(`a checkpoint public key is 32 bytes, base64url; got ${raw.length} bytes`);
  return raw.toString("base64url");
}

function publicKeyObject(publicKey: string): KeyObject {
  return createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: publicKey }, format: "jwk" });
}

function bodyOf(cp: Checkpoint): CheckpointBody {
  const { sig: _sig, ...body } = cp;
  return body;
}

export function signCheckpoint(body: CheckpointBody, key: KeyObject): Checkpoint {
  return { ...body, sig: edSign(null, Buffer.from(jcs(body as unknown as Json), "utf8"), key).toString("base64url") };
}

/** A checkpoint's id: SHA-256 over its canonical JSON, signature included. The next checkpoint's prev. */
export function checkpointId(cp: Checkpoint): string {
  return sha256Hex(jcs(cp as unknown as Json));
}

export function signatureValid(cp: Checkpoint): boolean {
  try {
    return edVerify(null, Buffer.from(jcs(bodyOf(cp) as unknown as Json), "utf8"), publicKeyObject(cp.public_key), Buffer.from(cp.sig, "base64url"));
  } catch {
    return false;
  }
}

/**
 * A money row's intent: written by the process that records the row, signed, before the row is committed. A crash
 * between the commit and the next checkpoint (a SIGKILL) then leaves a money row no checkpoint covers but that the key
 * holder announced, which is told apart from one appended by someone else, who cannot sign one. An intent whose row was
 * never committed (rolled back, or the crash came first) excuses nothing: it names that row's exact hash.
 */
export interface IntentBody { v: typeof INTENT_SCHEMA; seq: number; row_hash: string; ts: string; key_id: string; public_key: string }
export interface Intent extends IntentBody { sig: string }

export const INTENT_SCHEMA = "purser.checkpoint-intent/v1";

export const intentKey = (seq: number, rowHash: string) => `${seq}:${rowHash}`;

export function signIntent(body: IntentBody, key: KeyObject): Intent {
  return { ...body, sig: edSign(null, Buffer.from(jcs(body as unknown as Json), "utf8"), key).toString("base64url") };
}

function intentSignatureValid(i: Intent): boolean {
  const { sig, ...body } = i;
  try {
    return edVerify(null, Buffer.from(jcs(body as unknown as Json), "utf8"), publicKeyObject(i.public_key), Buffer.from(sig, "base64url"));
  } catch {
    return false;
  }
}

function parseIntent(c: Record<string, unknown>): Intent | string {
  const extra = Object.keys(c).filter((k) => !["v", "seq", "row_hash", "ts", "key_id", "public_key", "sig"].includes(k));
  if (extra.length) return `unknown field(s) ${extra.join(", ")}`;
  if (!Number.isInteger(c.seq) || (c.seq as number) < 1) return "seq is not a positive integer";
  if (typeof c.row_hash !== "string" || !HEX64.test(c.row_hash)) return "row_hash is not a SHA-256 hex digest";
  if (typeof c.ts !== "string" || Number.isNaN(Date.parse(c.ts))) return "ts is not a time";
  if (typeof c.public_key !== "string" || !B64URL_32.test(c.public_key)) return "public_key is not a raw Ed25519 key";
  if (typeof c.key_id !== "string" || c.key_id !== keyIdOf(c.public_key)) return "key_id does not match public_key";
  if (typeof c.sig !== "string" || !/^[A-Za-z0-9_-]{86}$/.test(c.sig)) return "sig is not an Ed25519 signature";
  return c as unknown as Intent;
}

export const isIntent = (x: Checkpoint | Intent): x is Intent => x.v === INTENT_SCHEMA;

/** One line of the checkpoint file (a checkpoint or a money row's intent), or why it is neither. */
export function parseCheckpoint(line: string): Checkpoint | Intent | string {
  let o: unknown;
  try { o = JSON.parse(line); } catch { return "not JSON"; }
  if (!o || typeof o !== "object" || Array.isArray(o)) return "not an object";
  const c = o as Record<string, unknown>;
  if (c.v === INTENT_SCHEMA) return parseIntent(c);
  const allowed = new Set(["v", "n", "entries", "head", "ts", "key_id", "public_key", "prev", "rotate_to", "sig"]);
  const extra = Object.keys(c).filter((k) => !allowed.has(k));
  if (extra.length) return `unknown field(s) ${extra.join(", ")}`;
  if (c.v !== CHECKPOINT_SCHEMA) return `schema is not ${CHECKPOINT_SCHEMA}`;
  if (!Number.isInteger(c.n) || (c.n as number) < 1) return "n is not a positive integer";
  if (!Number.isInteger(c.entries) || (c.entries as number) < 0) return "entries is not a count";
  if (typeof c.head !== "string" || !HEX64.test(c.head)) return "head is not a SHA-256 hex digest";
  if (typeof c.prev !== "string" || !HEX64.test(c.prev)) return "prev is not a SHA-256 hex digest";
  if (typeof c.ts !== "string" || Number.isNaN(Date.parse(c.ts))) return "ts is not a time";
  if (typeof c.public_key !== "string" || !B64URL_32.test(c.public_key)) return "public_key is not a raw Ed25519 key";
  if (typeof c.key_id !== "string" || !KEY_ID.test(c.key_id) || c.key_id !== keyIdOf(c.public_key)) return "key_id does not match public_key";
  if (typeof c.sig !== "string" || !/^[A-Za-z0-9_-]{86}$/.test(c.sig)) return "sig is not an Ed25519 signature";
  if (c.rotate_to !== undefined) {
    const r = c.rotate_to as Record<string, unknown> | null;
    if (!r || typeof r !== "object" || typeof r.public_key !== "string" || !B64URL_32.test(r.public_key) || r.key_id !== keyIdOf(r.public_key) || Object.keys(r).length !== 2) return "rotate_to is not {key_id, public_key}";
    if (r.public_key === c.public_key) return "rotate_to names the key that signs it";
  }
  return c as unknown as Checkpoint;
}

/** Where the walk over the checkpoints stands: what the next one must link to and who may sign it. */
export interface ChainState {
  count: number;
  prevId: string;
  entries: number;
  /** The key that may sign the next checkpoint (null before the first). */
  active: string | null;
  retired: string[];
  /** Whether a checkpoint so far is signed by a pinned key. */
  trustedSeen: boolean;
  ids: string[];
  latest: Checkpoint | null;
  /** Intents before the first checkpoint: valid only if the first checkpoint's key signed them. */
  early: { key: string; intent: string }[];
}

// prevId is the genesis hash (GENESIS), spelled out: log.ts imports this module (through the checkpointer) before
// its own constants exist, so nothing from it may be read while this module loads.
export const EMPTY_CHAIN: ChainState = { count: 0, prevId: "0".repeat(64), entries: 0, active: null, retired: [], trustedSeen: false, ids: [], latest: null, early: [] };

export interface Walk { state: ChainState; good: Checkpoint[]; intents: string[]; problem: Problem | null }

/**
 * Walks the checkpoint file's lines on from a state (EMPTY_CHAIN for the whole file). Stops at the first problem:
 * nothing after a broken line can be trusted. Returns the state after the last good checkpoint, the checkpoints that
 * were good and the intents (intentKey) that were: each signed by the key in force where it stands in the file.
 */
export function walkCheckpoints(lines: (Checkpoint | Intent | string)[], trusted: string[], from: ChainState = EMPTY_CHAIN): Walk {
  const st: ChainState = { ...from, retired: [...from.retired], ids: [...from.ids], early: [...from.early] };
  const good: Checkpoint[] = [];
  const intents: string[] = [];
  const stop = (problem: Problem): Walk => ({ state: st, good, intents, problem });
  for (const cp of lines) {
    const at = st.count + 1;
    if (typeof cp === "string") return stop({ code: "malformed", n: at, detail: `a line after checkpoint ${st.count}: ${cp}` });
    if (isIntent(cp)) {
      if (!intentSignatureValid(cp)) return stop({ code: "bad_signature", seq: cp.seq, detail: `the intent for row ${cp.seq} does not verify under key ${cp.key_id}: the line was forged or changed` });
      if (st.active === null) st.early.push({ key: cp.public_key, intent: intentKey(cp.seq, cp.row_hash) });
      else if (cp.public_key === st.active) intents.push(intentKey(cp.seq, cp.row_hash));
      else return stop(st.retired.includes(cp.public_key)
        ? { code: "rotated_out_key", seq: cp.seq, detail: `the intent for row ${cp.seq} is signed by key ${cp.key_id}, rotated out earlier` }
        : { code: "unknown_key", seq: cp.seq, detail: `the intent for row ${cp.seq} is signed by key ${cp.key_id}, which no checkpoint introduced` });
      continue;
    }
    const id = checkpointId(cp);
    if (cp.n <= st.count || st.ids.includes(id)) {
      return stop({ code: "replay", n: cp.n, detail: `checkpoint ${cp.n} comes after checkpoint ${st.count}: an old checkpoint presented again as the latest` });
    }
    if (cp.n !== at) return stop({ code: "broken_link", n: cp.n, detail: `checkpoint ${cp.n} follows checkpoint ${st.count}: a checkpoint is missing` });
    if (cp.prev !== st.prevId) return stop({ code: "broken_link", n: cp.n, detail: `checkpoint ${cp.n} does not link to checkpoint ${st.count} (prev ${cp.prev.slice(0, 12)}…)` });
    if (st.active !== null && cp.public_key !== st.active) {
      return stop(st.retired.includes(cp.public_key)
        ? { code: "rotated_out_key", n: cp.n, detail: `checkpoint ${cp.n} is signed by key ${cp.key_id}, rotated out earlier; key ${keyIdOf(st.active)} signs now` }
        : { code: "unknown_key", n: cp.n, detail: `checkpoint ${cp.n} is signed by key ${cp.key_id}, which no checkpoint introduced; key ${keyIdOf(st.active)} signs now` });
    }
    if (!signatureValid(cp)) return stop({ code: "bad_signature", n: cp.n, detail: `checkpoint ${cp.n}'s signature does not verify under key ${cp.key_id}: the line was forged or changed` });
    if (cp.entries < st.entries) return stop({ code: "rollback", n: cp.n, detail: `checkpoint ${cp.n} covers ${cp.entries} rows; checkpoint ${st.count} already covered ${st.entries}` });
    if (cp.entries === 0 && cp.head !== GENESIS) return stop({ code: "malformed", n: cp.n, detail: `checkpoint ${cp.n} covers no rows but its head is not the genesis hash` });
    if (st.active === null) {
      const stranger = st.early.find((e) => e.key !== cp.public_key);
      if (stranger) return stop({ code: "unknown_key", detail: `an intent before the first checkpoint is signed by key ${keyIdOf(stranger.key)}, not the first checkpoint's ${cp.key_id}` });
      intents.push(...st.early.map((e) => e.intent));
      st.early = [];
    }
    if (trusted.includes(cp.public_key)) st.trustedSeen = true;
    if (cp.rotate_to) { st.retired.push(cp.public_key); st.active = cp.rotate_to.public_key; } else st.active = cp.public_key;
    st.count = cp.n; st.prevId = id; st.entries = cp.entries; st.ids.push(id); st.latest = cp;
    good.push(cp);
  }
  return { state: st, good, intents, problem: null };
}

/** The lines of a checkpoint file. A blank or cut-off line is kept, so it is reported as malformed, never skipped. */
export function splitCheckpointFile(text: string): string[] {
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** A copy of the checkpoint file kept earlier (or the latest checkpoint seen): each of its checkpoints must still be there, the same. */
export function checkKnown(ids: string[], known: { n: number; id: string }[]): Problem | null {
  for (const k of known) {
    if (ids.length < k.n) return { code: "replay", n: k.n, detail: `the checkpoint file ends at checkpoint ${ids.length}, but checkpoint ${k.n} was seen before: the file was cut back to an old checkpoint` };
    if (ids[k.n - 1] !== k.id) return { code: "replay", n: k.n, detail: `checkpoint ${k.n} is not the one seen before: the file was replaced` };
  }
  return null;
}

/** The ledger as the checks need it: the hash of a row, and the rows after a point. */
export interface LedgerView {
  /** The highest seq, 0 when empty. */
  last(): number;
  rowHash(seq: number): string | null;
  after(seq: number): AuditRowStored[];
}

export function rowsView(rows: AuditRowStored[]): LedgerView {
  const bySeq = new Map(rows.map((r) => [r.seq, r]));
  return {
    last: () => rows.reduce((m, r) => Math.max(m, r.seq), 0),
    rowHash: (seq) => bySeq.get(seq)?.row_hash ?? null,
    after: (seq) => rows.filter((r) => r.seq > seq).sort((a, b) => a.seq - b.seq),
  };
}

export interface LedgerCheckOptions {
  /** Money rows after the latest checkpoint that the key holder announced (intentKey of each valid intent). */
  intents?: Set<string>;
  /** A money row after the latest checkpoint that is still allowed (this process wrote it and checkpoints it next). */
  exempt?: (row: AuditRowStored) => boolean;
  /** With real clocks: a row may stay uncovered this long at most, and none may predate the latest checkpoint. */
  maxTailAgeMs?: number;
  now?: Date;
}

/** Clock skew allowed between the ledger's writer and the checkpoint's signer before a row counts as backdated. */
export const BACKDATE_SKEW_MS = 60_000;

/**
 * The ledger against the checkpoints already walked: every checkpoint's head is still the row it signed, the rows run
 * on from the latest one, and nothing after it is a money row no checkpoint covers. The rows' own hashes are checked
 * by verifyAuditRows / auditChainRefusal; run that too (verifyCheckpointedLedger does).
 */
export function checkLedger(view: LedgerView, cps: Checkpoint[], o: LedgerCheckOptions = {}): Problem[] {
  const latest = cps[cps.length - 1];
  if (!latest) return [];
  const last = view.last();
  if (last < latest.entries) return [{ code: "truncated", n: latest.n, seq: last, detail: `the ledger has ${last} rows; checkpoint ${latest.n} covers ${latest.entries}: rows were cut off the end` }];
  for (const cp of cps) {
    const h = cp.entries === 0 ? GENESIS : view.rowHash(cp.entries);
    if (h === null) return [{ code: "truncated", n: cp.n, seq: cp.entries, detail: `row ${cp.entries}, which checkpoint ${cp.n} covers, is gone` }];
    if (h !== cp.head) return [{ code: "rewritten", n: cp.n, seq: cp.entries, detail: `row ${cp.entries} has hash ${h.slice(0, 12)}…; checkpoint ${cp.n} signed ${cp.head.slice(0, 12)}…: the history up to it was rewritten` }];
  }
  const tail = view.after(latest.entries);
  const linked = verifyAuditRowsFrom(tail, { seq: latest.entries, head: latest.head });
  if (!linked.ok) return [{ code: "chain_broken", seq: linked.seq, detail: `row ${linked.seq} after checkpoint ${latest.n}: ${linked.reason}` }];
  const problems: Problem[] = [];
  const money = tail.filter((r) => MONEY_EVENTS.has(r.event) && !o.intents?.has(intentKey(r.seq, r.row_hash)) && !(o.exempt?.(r) ?? false));
  if (money.length) {
    problems.push({ code: "uncovered_money", n: latest.n, seq: money[0]!.seq, detail: `${money.length} money row(s) after checkpoint ${latest.n} that no checkpoint covers and no signed intent announced (first: row ${money[0]!.seq}, ${money[0]!.event}): appended outside Purser's code` });
  }
  if (o.maxTailAgeMs !== undefined && tail.length) {
    const now = (o.now ?? new Date()).getTime();
    const cpAt = Date.parse(latest.ts);
    const old = tail.find((r) => now - Date.parse(r.ts) > o.maxTailAgeMs!);
    const backdated = tail.find((r) => Date.parse(r.ts) < cpAt - BACKDATE_SKEW_MS);
    if (backdated) problems.push({ code: "stale_tail", n: latest.n, seq: backdated.seq, detail: `row ${backdated.seq} is dated ${backdated.ts}, before checkpoint ${latest.n} (${latest.ts}) that does not cover it: appended later and backdated` });
    else if (old) problems.push({ code: "stale_tail", n: latest.n, seq: old.seq, detail: `row ${old.seq} (${old.ts}) has gone uncovered longer than the checkpoint schedule allows: the checkpoints stopped, or it was appended past them` });
  }
  return problems;
}

export interface VerifyInput {
  rows: AuditRowStored[];
  /** The checkpoint file's text. */
  checkpoints: string;
  /** Pinned public keys (base64url raw): at least one checkpoint must be signed by one of them. */
  trusted: string[];
  /** A copy of the checkpoint file kept earlier: it must still be a prefix of this one. */
  known?: string;
  maxTailAgeMs?: number;
  now?: Date;
}

export interface VerifyResult { ok: boolean; problems: Problem[]; latest: Checkpoint | null; checkpoints: number; rows: number; keys: string[] }

/** The whole check, offline: the chain's own hashes, the checkpoint file, and the one against the other. */
export function verifyCheckpointedLedger(input: VerifyInput): VerifyResult {
  const problems: Problem[] = [];
  const sorted = [...input.rows].sort((a, b) => a.seq - b.seq);
  const chain = verifyAuditRowsFrom(sorted, { seq: 0, head: GENESIS });
  if (!chain.ok) problems.push({ code: "chain_broken", seq: chain.seq, detail: `row ${chain.seq}: ${chain.reason}` });
  const lines = splitCheckpointFile(input.checkpoints);
  const walk = walkCheckpoints(lines.map(parseCheckpoint), input.trusted);
  if (walk.problem) problems.push(walk.problem);
  if (!lines.length) problems.push({ code: "no_checkpoint", detail: "there is no checkpoint" });
  else if (walk.good.length && !walk.state.trustedSeen) {
    problems.push({ code: "untrusted", detail: `no checkpoint is signed by a pinned key (signed by ${[...new Set(walk.good.map((c) => c.key_id))].join(", ")}; pinned ${input.trusted.map(keyIdOf).join(", ") || "none"})` });
  }
  if (input.known !== undefined) {
    const known = splitCheckpointFile(input.known).map(parseCheckpoint).filter((c): c is Checkpoint => typeof c !== "string" && !isIntent(c)).map((c) => ({ n: c.n, id: checkpointId(c) }));
    const k = checkKnown(walk.state.ids, known);
    if (k) problems.push(k);
  }
  problems.push(...checkLedger(rowsView(sorted), walk.good, { intents: new Set(walk.intents), maxTailAgeMs: input.maxTailAgeMs, now: input.now }));
  return { ok: problems.length === 0, problems, latest: walk.state.latest, checkpoints: walk.good.length, rows: sorted.length, keys: [...new Set(walk.good.map((c) => c.key_id))] };
}
