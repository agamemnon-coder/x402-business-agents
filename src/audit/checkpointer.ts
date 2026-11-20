// Signed audit checkpoints at run time (outside audit, finding 1.4): writing them, and checking the ledger against the
// latest one before anything sensitive runs. The format and the verifier are src/audit/checkpoint.ts.
//
// The key is never in the ledger. It is an Ed25519 private key (PKCS#8 PEM) in a file named by
// PURSER_CHECKPOINT_KEY_FILE (mode 0600; a file others can read is refused), or the PEM itself in
// PURSER_CHECKPOINT_KEY. With neither set, checkpoints are off and everything runs as before. With one set they are on:
// - written after every money action (an audit row whose event is in MONEY_EVENTS: from audit(), right after the row
//   is committed; inside a transaction, once it has committed), after each sensitive operation's check has passed, and
//   by the runner on a schedule (PURSER_CHECKPOINT_EVERY_MS, 5 minutes by default), to an append-only file:
//   PURSER_CHECKPOINT_FILE, or
//   <ledger>.checkpoints.jsonl beside a ledger file (an in-memory ledger keeps them in memory: tests);
// - checked before every payment (reserveSpend, holdBeyondCap, beginExecution), every policy change that loosens the
//   policy, every key enrolment (a passkey, a security key, an agent's key) and a rotation of the checkpoint key. A
//   ledger that does not match refuses them, records audit.checkpoint_refused and raises the critical /health alarm
//   audit_checkpoint_mismatch (checkpointAlerts, src/ops/health.ts) until a person has checked it.
// Before a money row is committed, its signed intent (its seq and hash) goes to the same file (beforeAuditCommit), so a
// process killed between the commit and the checkpoint leaves a row the key holder vouched for; a forged one has none.
// Never signed over a mismatch: a checkpoint is written only after the same check passes, inside the ledger's write
// lock, so two processes on one ledger never write the same checkpoint number.
//
// What it cannot see (docs/security.md): a non-money row forged and appended between two checkpoints is signed by the
// next one; and a fresh process that is shown a checkpoint file cut back to an old checkpoint, with the ledger rewritten
// after it, only finds it through the money rows it no longer covers, or a copy of the file kept elsewhere
// (npm run verify-audit -- --known <copy>). Within a running process the latest checkpoint seen is remembered.

import { createPrivateKey, type KeyObject } from "node:crypto";
import { closeSync, existsSync, fsyncSync, openSync, readFileSync, statSync, writeSync } from "node:fs";
import { resolve } from "node:path";
import type { DB } from "../db/open.js";
import type { Alert } from "../ops/publicHealth.js";
import { MONEY_EVENTS } from "../provenance/origin.js";
import { auditChainRefusal } from "./intact.js";
import { audit, GENESIS, type AuditRowStored } from "./log.js";
import {
  CHECKPOINT_SCHEMA, EMPTY_CHAIN, INTENT_SCHEMA, checkKnown, checkLedger, checkpointId, intentKey, keyIdOf, normalisePublicKey, parseCheckpoint,
  rawPublicKey, signCheckpoint, signIntent, splitCheckpointFile, walkCheckpoints, type ChainState, type Checkpoint, type LedgerView, type Problem,
} from "./checkpoint.js";

export const CHECKPOINT_ENV = {
  keyFile: "PURSER_CHECKPOINT_KEY_FILE",
  key: "PURSER_CHECKPOINT_KEY",
  file: "PURSER_CHECKPOINT_FILE",
  trust: "PURSER_CHECKPOINT_TRUST",
  every: "PURSER_CHECKPOINT_EVERY_MS",
} as const;

export const DEFAULT_EVERY_MS = 5 * 60_000;

export type SensitiveOp = "payment" | "policy change" | "key enrolment" | "checkpoint key rotation";

export class CheckpointConfigError extends Error {}

export interface CheckpointSigner { key: KeyObject; publicKey: string; keyId: string }

const env = (name: string): string | undefined => (typeof process !== "undefined" ? process.env[name] : undefined) || undefined;

let signerCache: { spec: string; signer: CheckpointSigner } | null = null;

/** The configured checkpoint key, or null when none is (checkpoints off). Throws CheckpointConfigError on a bad one. */
export function checkpointSigner(): CheckpointSigner | null {
  const file = env(CHECKPOINT_ENV.keyFile);
  const pem = env(CHECKPOINT_ENV.key);
  if (!file && !pem) return null;
  const spec = `${file ?? ""}\0${pem ?? ""}`;
  if (signerCache?.spec === spec) return signerCache.signer;
  let text: string;
  if (file) {
    if (!existsSync(file)) throw new CheckpointConfigError(`${CHECKPOINT_ENV.keyFile} names ${file}, which does not exist`);
    if (process.platform !== "win32" && (statSync(file).mode & 0o077) !== 0) throw new CheckpointConfigError(`${CHECKPOINT_ENV.keyFile}: ${file} can be read by others; chmod 600 it`);
    text = readFileSync(file, "utf8");
  } else text = pem!.replace(/\\n/g, "\n");
  let key: KeyObject;
  try { key = createPrivateKey(text); } catch { throw new CheckpointConfigError(`the checkpoint key is not a PEM private key`); }
  if (key.asymmetricKeyType !== "ed25519") throw new CheckpointConfigError(`the checkpoint key is ${key.asymmetricKeyType ?? "unknown"}, not Ed25519`);
  const publicKey = rawPublicKey(key);
  const signer = { key, publicKey, keyId: keyIdOf(publicKey) };
  signerCache = { spec, signer };
  return signer;
}

/** The pinned public keys: this process's own, and any in PURSER_CHECKPOINT_TRUST (comma-separated). */
export function trustedKeys(signer: CheckpointSigner | null): string[] {
  const pinned = (env(CHECKPOINT_ENV.trust) ?? "").split(",").map((s) => s.trim()).filter(Boolean).map(normalisePublicKey);
  return [...new Set([...(signer ? [signer.publicKey] : []), ...pinned])];
}

export function checkpointEveryMs(): number {
  const v = Number(env(CHECKPOINT_ENV.every));
  return Number.isFinite(v) && v >= 1_000 ? v : DEFAULT_EVERY_MS;
}

export interface CheckpointStore { id: string; path: string | null; read(): string; append(text: string): void }

const memoryStores = new WeakMap<DB, { id: string; text: string }>();
let memoryCount = 0;

/** Where this ledger's checkpoints go: PURSER_CHECKPOINT_FILE, beside the ledger file, or in memory for an in-memory ledger. */
export function checkpointStore(db: DB): CheckpointStore {
  const named = env(CHECKPOINT_ENV.file);
  const path = named ?? (db.memory ? null : `${db.name}.checkpoints.jsonl`);
  if (path !== null) {
    if (!db.memory && resolve(path) === resolve(db.name)) throw new CheckpointConfigError(`${CHECKPOINT_ENV.file} is the ledger itself`);
    return {
      id: `file:${resolve(path)}`,
      path,
      read: () => (existsSync(path) ? readFileSync(path, "utf8") : ""),
      append: (text) => {
        const fd = openSync(path, "a", 0o600);
        try { writeSync(fd, text); fsyncSync(fd); } finally { closeSync(fd); }
      },
    };
  }
  let m = memoryStores.get(db);
  if (!m) memoryStores.set(db, (m = { id: `memory:${++memoryCount}`, text: "" }));
  const mem = m;
  return { id: mem.id, path: null, read: () => mem.text, append: (text) => { mem.text += text; } };
}

// What this process knows. Rows it appended (seq -> row_hash) and has not checkpointed yet; ledgers with a money row
// committed inside a transaction, to checkpoint once it has; the latest checkpoint seen per store (a file cut back to
// an older one is a replay); and the walk over each store's checkpoints so far, so only new lines are verified.
// Rows are this process's per ledger file, whichever connection wrote them (a process may open one file twice); an
// in-memory ledger's per connection.
const own = new WeakMap<DB, Map<number, string>>();
const ownByFile = new Map<string, Map<number, string>>();
// Held until flushed (a closed ledger is dropped then); flushed at the process's exit too, so a CLI that calls
// process.exit right after a money transaction still leaves its checkpoint.
const pending = new Set<DB>();
let flushOnExit = false;
const highWater = new Map<string, { n: number; id: string }>();
const walked = new Map<string, { text: string; state: ChainState; cps: Checkpoint[]; intents: Set<string> }>();
const headsChecked = new WeakMap<DB, Map<string, number>>();

function ownRows(db: DB): Map<number, string> {
  const path = db.memory ? null : resolve(db.name);
  let m = path === null ? own.get(db) : ownByFile.get(path);
  if (!m) {
    m = new Map();
    if (path === null) own.set(db, m); else ownByFile.set(path, m);
  }
  return m;
}

function ledgerView(db: DB): LedgerView {
  return {
    last: () => (db.prepare("SELECT MAX(seq) AS s FROM audit_log").get() as { s: number | null }).s ?? 0,
    rowHash: (seq) => (db.prepare("SELECT row_hash FROM audit_log WHERE seq = ?").get(seq) as { row_hash: string } | undefined)?.row_hash ?? null,
    after: (seq) => db.prepare("SELECT * FROM audit_log WHERE seq > ? ORDER BY seq").all(seq) as AuditRowStored[],
  };
}

interface Evaluation { problems: Problem[]; state: ChainState; text: string; intents: Set<string> }

/** The checkpoint file walked (only its new lines, when the rest is unchanged) and the ledger against it. */
function evaluate(db: DB, store: CheckpointStore, signer: CheckpointSigner): Evaluation {
  const text = store.read();
  const trusted = trustedKeys(signer);
  const cacheKey = `${store.id}\0${trusted.join(",")}`;
  const cached = walked.get(cacheKey);
  const resume = cached && text.startsWith(cached.text) ? cached : null;
  const walk = walkCheckpoints(splitCheckpointFile(resume ? text.slice(resume.text.length) : text).map(parseCheckpoint), trusted, resume?.state ?? EMPTY_CHAIN);
  const st = walk.state;
  const cps = resume ? [...resume.cps, ...walk.good] : walk.good;
  const intents = new Set(resume?.intents);
  for (const i of walk.intents) intents.add(i);
  if (!walk.problem && (text === "" || text.endsWith("\n"))) walked.set(cacheKey, { text, state: st, cps, intents });
  const problems: Problem[] = [];
  if (walk.problem) problems.push(walk.problem);
  if (st.count === 0) {
    if (!walk.problem) problems.push({ code: "no_checkpoint", detail: `no checkpoint yet for this ledger${store.path ? ` (${store.path})` : ""}; after npm run verify, npm run verify-audit -- init signs the first` });
    return { problems, state: st, text, intents };
  }
  if (!st.trustedSeen) problems.push({ code: "untrusted", detail: `no checkpoint is signed by this runner's key ${signer.keyId} or a key in ${CHECKPOINT_ENV.trust}` });
  const hw = highWater.get(store.id);
  const replay = hw ? checkKnown(st.ids, [hw]) : null;
  if (replay) problems.push(replay);
  else if (!hw || st.count > hw.n) highWater.set(store.id, { n: st.count, id: st.prevId });
  if (st.active !== signer.publicKey) problems.push({ code: "key_rotated", detail: `this process signs with key ${signer.keyId}, but the checkpoints' active key is ${st.active ? keyIdOf(st.active) : "none"}: restart it with the current key` });
  // Each checkpoint's head once per ledger handle, then the new ones and the latest every time. With the chain verified
  // (auditChainRefusal), the latest head alone pins every row it covers.
  let checked = headsChecked.get(db);
  if (!checked) headsChecked.set(db, (checked = new Map()));
  const from = resume ? Math.min(checked.get(store.id) ?? 0, cps.length - 1) : 0;
  const mine = ownRows(db);
  const ledger = checkLedger(ledgerView(db), cps.slice(from), { intents, exempt: (r) => mine.get(r.seq) === r.row_hash });
  if (!ledger.some((p) => p.code === "truncated" || p.code === "rewritten")) checked.set(store.id, cps.length);
  problems.push(...ledger);
  return { problems, state: st, text, intents };
}

function ownsAll(db: DB): boolean {
  const mine = ownRows(db);
  return (db.prepare("SELECT seq, row_hash FROM audit_log").all() as { seq: number; row_hash: string }[]).every((r) => mine.get(r.seq) === r.row_hash);
}

export type WriteResult =
  | { ok: true; checkpoints: Checkpoint[]; deferred?: true }
  | { ok: false; reason: string; problems: Problem[] };

export interface WriteOptions {
  now?: Date;
  /** The first checkpoint over a ledger this process did not write (npm run verify-audit -- init). */
  init?: boolean;
  /** Sign the rows after the latest checkpoint as they are, money rows from elsewhere included, after a person looked. */
  acceptTail?: boolean;
  /** Key rotation: a checkpoint signed with this process's key that introduces this one, then one signed with it. */
  rotateTo?: KeyObject;
  /** Only when there are rows the latest checkpoint does not cover yet (the gates; the schedule writes regardless). */
  ifMoved?: boolean;
}

/**
 * Signs and appends a checkpoint over the ledger as it stands, after checking it against the latest one. Inside a
 * transaction it waits for the commit (deferred). Never signs over a mismatch, and never covers a money row that is
 * neither this process's nor announced by a signed intent (unless acceptTail, after a person looked): it stops before it.
 */
export function writeCheckpoint(db: DB, o: WriteOptions = {}): WriteResult {
  let signer: CheckpointSigner | null;
  try { signer = checkpointSigner(); } catch (e) { return { ok: false, reason: (e as Error).message, problems: [] }; }
  if (!signer) return { ok: false, reason: `no checkpoint key is configured (${CHECKPOINT_ENV.keyFile})`, problems: [] };
  if (db.inTransaction) {
    pending.add(db);
    return { ok: true, checkpoints: [], deferred: true };
  }
  const s = signer;
  return db.transaction((): WriteResult => {
    const store = checkpointStore(db);
    const chain = auditChainRefusal(db);
    if (chain) return { ok: false, reason: chain, problems: [{ code: "chain_broken", detail: chain }] };
    const ev = evaluate(db, store, s);
    if (o.init && ev.text !== "") return { ok: false, reason: `checkpoints already exist${store.path ? ` in ${store.path}` : ""}; move that file aside first if the ledger was restored`, problems: [] };
    const genesisAllowed = ev.state.count === 0 && (o.init === true || ownsAll(db));
    // A money row no intent announced blocks nothing here: the checkpoint stops before it (below), and the gates refuse.
    const blocking = ev.problems.filter((p) => p.code !== "uncovered_money" && !(p.code === "no_checkpoint" && genesisAllowed));
    if (blocking.length) return { ok: false, reason: blocking.map((p) => p.detail).join("; "), problems: blocking };
    const view = ledgerView(db);
    const latest = ev.state.latest;
    let end = view.last();
    if (!o.acceptTail) {
      const mine = ownRows(db);
      const foreign = view.after(latest?.entries ?? 0).find((r) => MONEY_EVENTS.has(r.event) && mine.get(r.seq) !== r.row_hash && !ev.intents.has(intentKey(r.seq, r.row_hash)));
      if (foreign) end = foreign.seq - 1;
    }
    end = Math.max(end, latest?.entries ?? 0);
    if (o.ifMoved && latest && !o.rotateTo && end === latest.entries) return { ok: true, checkpoints: [] };
    const head = end === 0 ? GENESIS : view.rowHash(end)!;
    const ts = (o.now ?? new Date()).toISOString();
    const first = signCheckpoint({
      v: CHECKPOINT_SCHEMA, n: ev.state.count + 1, entries: end, head, ts, key_id: s.keyId, public_key: s.publicKey, prev: ev.state.prevId,
      ...(o.rotateTo ? { rotate_to: { key_id: keyIdOf(rawPublicKey(o.rotateTo)), public_key: rawPublicKey(o.rotateTo) } } : {}),
    }, s.key);
    const written = [first];
    if (o.rotateTo) {
      const pub = rawPublicKey(o.rotateTo);
      written.push(signCheckpoint({ v: CHECKPOINT_SCHEMA, n: first.n + 1, entries: end, head, ts, key_id: keyIdOf(pub), public_key: pub, prev: checkpointId(first) }, o.rotateTo));
    }
    store.append(written.map((c) => `${JSON.stringify(c)}\n`).join(""));
    const last = written[written.length - 1]!;
    highWater.set(store.id, { n: last.n, id: checkpointId(last) });
    const mine = ownRows(db);
    for (const k of [...mine.keys()]) if (k <= end) mine.delete(k);
    pending.delete(db);
    return { ok: true, checkpoints: written };
  }).immediate();
}

/**
 * Called by audit() inside its transaction, right after the row is inserted and before it is committed: a money row's
 * signed intent is appended to the checkpoint file first, so a crash after the commit (before the checkpoint) leaves a
 * row the key holder announced. A failure here never stops the row from being recorded: the gates refuse it later.
 */
export function beforeAuditCommit(db: DB, row: { seq: number; row_hash: string; event: string }): void {
  if (!MONEY_EVENTS.has(row.event)) return;
  try {
    const signer = checkpointSigner();
    if (!signer) return;
    const intent = signIntent({ v: INTENT_SCHEMA, seq: row.seq, row_hash: row.row_hash, ts: new Date().toISOString(), key_id: signer.keyId, public_key: signer.publicKey }, signer.key);
    checkpointStore(db).append(`${JSON.stringify(intent)}\n`);
  } catch { /* no intent: the row stands, uncovered until a checkpoint this process writes covers it */ }
}

/**
 * Called by audit() after it appended a row: remembered as this process's; a money row, or the ledger's first row
 * (its genesis checkpoint), is checkpointed now.
 */
export function afterAuditAppend(db: DB, row: { seq: number; row_hash: string; event: string }): void {
  let signer: CheckpointSigner | null;
  try { signer = checkpointSigner(); } catch { return; } // the gates refuse on a bad key; the row itself stands
  if (!signer) return;
  ownRows(db).set(row.seq, row.row_hash);
  const due = MONEY_EVENTS.has(row.event) || row.seq === 1;
  if (db.inTransaction) {
    if (!due) return;
    // Checkpointed once the transaction has committed: the next gate, the next audit row outside it, right after this
    // turn of the event loop, or at the process's exit, whichever comes first.
    if (!pending.has(db) && typeof setImmediate === "function") setImmediate(() => flushPending(db));
    if (!flushOnExit && typeof process !== "undefined" && typeof process.once === "function") {
      flushOnExit = true;
      process.once("exit", () => { for (const d of [...pending]) flushPending(d); });
    }
    pending.add(db);
    return;
  }
  if (!due && !pending.has(db)) return;
  // The row is committed whatever happens here: a checkpoint that cannot be written (a mismatch, a busy ledger) leaves
  // it uncovered, and the next gate says so.
  try {
    if (!writeCheckpoint(db).ok) pending.delete(db);
  } catch {
    pending.delete(db);
  }
}

function flushPending(db: DB): void {
  if (!pending.has(db)) return;
  if (!db.open) { pending.delete(db); return; }
  if (db.inTransaction) return;
  try { writeCheckpoint(db); } catch { /* the next gate reports it */ }
}

function refusal(db: DB, op: SensitiveOp, detail: string, now: Date): string {
  try { audit(db, "system", "audit.checkpoint_refused", null, { op, reason: detail }, now); } catch { /* the refusal stands without its row */ }
  return `audit_checkpoint_mismatch: the audit log does not match its latest signed checkpoint (${detail}); no ${op} until a person has checked it (npm run verify-audit)`;
}

/**
 * Why a sensitive operation must not run on this ledger, or null. Null at once when no checkpoint key is configured.
 * Otherwise the chain must verify (auditChainRefusal) and match its latest signed checkpoint.
 */
export function checkpointRefusal(db: DB, op: SensitiveOp, now = new Date()): string | null {
  let signer: CheckpointSigner | null;
  let store: CheckpointStore;
  try {
    signer = checkpointSigner();
    if (!signer) return null;
    store = checkpointStore(db);
  } catch (e) {
    return refusal(db, op, `the checkpoint configuration is broken: ${(e as Error).message}`, now);
  }
  const chain = auditChainRefusal(db);
  if (chain) return chain;
  // A ledger this process made that has no checkpoint yet: its first (the write checks before it signs, and refuses a
  // ledger it did not write: then no_checkpoint is found below).
  if (!db.inTransaction && store.read() === "") quietly(() => writeCheckpoint(db));
  const ev = evaluate(db, store, signer);
  if (ev.problems.length) return refusal(db, op, ev.problems.map((p) => p.detail).join("; "), now);
  // It matches: sign the rows up to here, so the history this operation ran on is pinned (this process's money rows
  // inside a transaction included), not only at the next money row or the next scheduled checkpoint.
  if (!db.inTransaction) quietly(() => writeCheckpoint(db, { ifMoved: true }));
  return null;
}

/** A checkpoint write whose failure the check after it (or the next one) reports. */
function quietly(write: () => unknown): void {
  try { write(); } catch { /* found by the next check */ }
}

/** The payment gate: the chain verifies (always), and matches its latest checkpoint (when a checkpoint key is configured). */
export function ledgerRefusal(db: DB, op: SensitiveOp, now = new Date()): string | null {
  return auditChainRefusal(db) ?? checkpointRefusal(db, op, now);
}

/** The /health alarms (src/ops/health.ts): the ledger against its latest checkpoint now, and refusals in the last day. */
export function checkpointAlerts(db: DB, now = new Date()): Alert[] {
  let signer: CheckpointSigner | null;
  let store: CheckpointStore;
  try {
    signer = checkpointSigner();
    if (!signer) return [];
    store = checkpointStore(db);
  } catch (e) {
    return [{ code: "audit_checkpoint_config", severity: "critical", since: null, words: `Audit checkpoints are switched on but cannot run: ${(e as Error).message}. Payments, loosening policy changes and key enrolments are refused until it is fixed.` }];
  }
  const alerts: Alert[] = [];
  const chain = auditChainRefusal(db);
  // This process's own checkpoint still to write (a money row, or a new ledger's first row, inside a transaction that
  // has committed since) is written first: it is no alarm.
  if (!chain && !db.inTransaction && (pending.has(db) || store.read() === "")) quietly(() => writeCheckpoint(db));
  const ev = chain ? null : evaluate(db, store, signer);
  const problems = chain ? [chain] : ev!.problems.map((p) => p.detail);
  if (problems.length) {
    alerts.push({ code: "audit_checkpoint_mismatch", severity: "critical", since: ev?.state.latest?.ts ?? null, words: `The audit log does not match its latest signed checkpoint: ${problems.join("; ")}. Payments, loosening policy changes and key enrolments are refused. Pull the emergency stop, run npm run verify-audit, and find who wrote to the ledger.` });
  }
  const DAY = new Date(now.getTime() - 24 * 60 * 60_000).toISOString();
  const refused = db.prepare("SELECT COUNT(*) AS n, MIN(ts) AS since FROM audit_log WHERE event = 'audit.checkpoint_refused' AND ts > ?").get(DAY) as { n: number; since: string | null };
  if (refused.n > 0) alerts.push({ code: "audit_checkpoint_refused", severity: "critical", since: refused.since, words: `${refused.n} sensitive operation(s) refused in the last day because the audit log did not match its signed checkpoint.` });
  return alerts;
}

/** What the runner says at its start, and its scheduled checkpoint (relay.ts calls checkpointTick every loop). */
export function checkpointStatus(db: DB): string {
  try {
    const signer = checkpointSigner();
    if (!signer) return `off (no ${CHECKPOINT_ENV.keyFile}): the audit log is hash-chained but not checkpointed`;
    const store = checkpointStore(db);
    return `signed with key ${signer.keyId} to ${store.path ?? "memory"}, after every money action and every ${Math.round(checkpointEveryMs() / 1000)} s`;
  } catch (e) {
    return `BROKEN: ${(e as Error).message}`;
  }
}

let scheduledAt = 0;

/** The scheduled checkpoint: one every PURSER_CHECKPOINT_EVERY_MS; null when it is not due or checkpoints are off. */
export function checkpointTick(db: DB, at = Date.now()): WriteResult | null {
  let signer: CheckpointSigner | null;
  try { signer = checkpointSigner(); } catch (e) { return { ok: false, reason: (e as Error).message, problems: [] }; }
  if (!signer || at - scheduledAt < checkpointEveryMs()) return null;
  scheduledAt = at;
  return writeCheckpoint(db);
}

/** Forgets what this process remembers, as a fresh process would start (tests). */
export function resetCheckpointMemory(db?: DB): void {
  highWater.clear();
  walked.clear();
  signerCache = null;
  scheduledAt = 0;
  ownByFile.clear();
  if (db) for (const m of [own, headsChecked]) m.delete(db);
  if (db) pending.delete(db);
}
