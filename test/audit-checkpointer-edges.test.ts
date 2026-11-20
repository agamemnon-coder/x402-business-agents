// The checkpointer's own edges (src/audit/checkpointer.ts): a checkpoint key that is missing, not a PEM or not Ed25519
// is a configuration error every caller reports (the gate refuses, /health and the runner's start say BROKEN, the
// schedule writes nothing); a key given inline, pinned keys, the schedule's interval, where the checkpoints of a ledger
// file go, and the writes that are deferred, refused or stopped before a money row no one announced. A dev key per
// test, in a temporary directory; no network.
import { generateKeyPairSync } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { jcs, type Json } from "@metalntwx/metal-pay/mandates";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CHECKPOINT_SCHEMA, keyIdOf, parseCheckpoint, rawPublicKey, signCheckpoint, signatureValid, walkCheckpoints, type Checkpoint, type Intent } from "../src/audit/checkpoint.js";
import {
  CHECKPOINT_ENV, CheckpointConfigError, checkpointAlerts, checkpointEveryMs, checkpointRefusal, checkpointSigner, checkpointStatus, checkpointStore,
  checkpointTick, DEFAULT_EVERY_MS, resetCheckpointMemory, trustedKeys, writeCheckpoint,
} from "../src/audit/checkpointer.js";
import { AUDIT_GUARDS, auditChainRefusal } from "../src/audit/intact.js";
import { audit, GENESIS, type AuditRowStored } from "../src/audit/log.js";
import { openDb, type DB } from "../src/db/open.js";
import { sha256Hex } from "../src/lib/terms.js";
import { devCheckpointKey, useCheckpointKey, type CheckpointFixture } from "./support/checkpointKey.js";

const MONEY = "refund.paid";
let fx: CheckpointFixture;
afterEach(() => fx?.restore());

const rowHash = (r: Omit<AuditRowStored, "row_hash">) =>
  sha256Hex(r.prev_hash + jcs({ seq: r.seq, ts: r.ts, actor: r.actor, event: r.event, subject: r.subject, payload: JSON.parse(r.payload_json) as Json }));
function withoutGuards(db: DB, fn: () => void): void {
  const sqls = AUDIT_GUARDS.map((n) => (db.prepare("SELECT sql FROM sqlite_master WHERE name = ?").get(n) as { sql: string }).sql);
  for (const n of AUDIT_GUARDS) db.exec(`DROP TRIGGER ${n}`);
  try { fn(); } finally { for (const s of sqls) db.exec(s); }
}
/** A correctly chained row appended by plain SQL, past Purser's code (no intent, not this process's). */
function forgeAppend(db: DB, event: string): AuditRowStored {
  const last = db.prepare("SELECT seq, row_hash FROM audit_log ORDER BY seq DESC LIMIT 1").get() as { seq: number; row_hash: string };
  const r = { seq: last.seq + 1, ts: new Date().toISOString(), actor: "treasury", event, subject: "forged", payload_json: jcs({ amount: "9.00", origin: null }), prev_hash: last.row_hash };
  const full = { ...r, row_hash: rowHash(r) };
  db.prepare("INSERT INTO audit_log (seq, ts, actor, event, subject, payload_json, prev_hash, row_hash) VALUES (@seq, @ts, @actor, @event, @subject, @payload_json, @prev_hash, @row_hash)").run(full);
  return full;
}
/** Changes a row's subject without rehashing: the chain no longer verifies. */
function breakChain(db: DB, seq: number): void {
  withoutGuards(db, () => db.prepare("UPDATE audit_log SET subject = 'changed' WHERE seq = ?").run(seq));
}
const cpLines = (text: string) => text.split("\n").filter(Boolean).map(parseCheckpoint).filter((c): c is Checkpoint => typeof c !== "string" && c.v === CHECKPOINT_SCHEMA);

describe("the checkpoint key: a broken configuration is an error every caller reports", () => {
  beforeEach(() => { fx = useCheckpointKey(); });

  it("a key file that does not exist", () => {
    const db = openDb(":memory:");
    process.env[CHECKPOINT_ENV.keyFile] = join(fx.dir, "missing.pem");
    resetCheckpointMemory();
    expect(() => checkpointSigner()).toThrow(CheckpointConfigError);
    expect(() => checkpointSigner()).toThrow(`${CHECKPOINT_ENV.keyFile} names ${join(fx.dir, "missing.pem")}, which does not exist`);
    // The gate refuses and records why; the runner's start line and the schedule say so; /health raises it.
    expect(checkpointRefusal(db, "payment")).toMatch(/^audit_checkpoint_mismatch: .*the checkpoint configuration is broken: .*which does not exist.*no payment until/);
    expect((db.prepare("SELECT payload_json FROM audit_log WHERE event = 'audit.checkpoint_refused'").get() as { payload_json: string }).payload_json).toContain("\"op\":\"payment\"");
    expect(checkpointStatus(db)).toMatch(/^BROKEN: .*which does not exist$/);
    expect(checkpointTick(db, Date.now())).toMatchObject({ ok: false, reason: expect.stringContaining("which does not exist"), problems: [] });
    expect(writeCheckpoint(db)).toMatchObject({ ok: false, reason: expect.stringContaining("which does not exist") });
    expect(checkpointAlerts(db)).toEqual([expect.objectContaining({ code: "audit_checkpoint_config", severity: "critical" })]);
  });

  it("text that is not a PEM private key, and a key that is not Ed25519", () => {
    const bad = join(fx.dir, "bad.pem");
    writeFileSync(bad, "not a key", { mode: 0o600 });
    process.env[CHECKPOINT_ENV.keyFile] = bad;
    resetCheckpointMemory();
    expect(() => checkpointSigner()).toThrow("the checkpoint key is not a PEM private key");
    const ec = join(fx.dir, "ec.pem");
    writeFileSync(ec, generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
    process.env[CHECKPOINT_ENV.keyFile] = ec;
    expect(() => checkpointSigner()).toThrow("the checkpoint key is ec, not Ed25519");
  });

  it("a key given inline (PURSER_CHECKPOINT_KEY), with its newlines escaped as \\n, signs as the file would", () => {
    const pem = readFileSync(fx.key.file, "utf8");
    delete process.env[CHECKPOINT_ENV.keyFile];
    process.env[CHECKPOINT_ENV.key] = pem.replace(/\n/g, "\\n");
    resetCheckpointMemory();
    const s = checkpointSigner()!;
    expect(s).toMatchObject({ publicKey: fx.key.publicKey, keyId: keyIdOf(fx.key.publicKey) });
    expect(checkpointSigner()).toBe(s); // cached while the configuration is the same
    const db = openDb(":memory:");
    expect(checkpointStatus(db)).toBe(`signed with key ${s.keyId} to memory, after every money action and every 300 s`);
  });

  it("no key: off, and the runner's start line says so", () => {
    delete process.env[CHECKPOINT_ENV.keyFile];
    resetCheckpointMemory();
    const db = openDb(":memory:");
    expect(checkpointSigner()).toBeNull();
    expect(checkpointStatus(db)).toBe(`off (no ${CHECKPOINT_ENV.keyFile}): the audit log is hash-chained but not checkpointed`);
    expect(writeCheckpoint(db)).toEqual({ ok: false, reason: `no checkpoint key is configured (${CHECKPOINT_ENV.keyFile})`, problems: [] });
    expect(checkpointTick(db, Date.now())).toBeNull();
  });
});

describe("pinned keys, the schedule's interval and where a ledger file's checkpoints go", () => {
  beforeEach(() => { fx = useCheckpointKey(); });

  it("pinned keys alone, without a signer of this process, in any form, once each", () => {
    const other = rawPublicKey(generateKeyPairSync("ed25519").privateKey);
    process.env[CHECKPOINT_ENV.trust] = ` ${other}, ed25519:${other} ,,`;
    expect(trustedKeys(null)).toEqual([other]);
    expect(trustedKeys(checkpointSigner())).toEqual([fx.key.publicKey, other]);
  });

  it("the interval: at least a second, else the default", () => {
    process.env[CHECKPOINT_ENV.every] = "500";
    expect(checkpointEveryMs()).toBe(DEFAULT_EVERY_MS);
    process.env[CHECKPOINT_ENV.every] = "soon";
    expect(checkpointEveryMs()).toBe(DEFAULT_EVERY_MS);
    process.env[CHECKPOINT_ENV.every] = "2000";
    expect(checkpointEveryMs()).toBe(2000);
    const db = openDb(":memory:");
    expect(checkpointStatus(db)).toMatch(/after every money action and every 2 s$/);
  });

  it("beside a ledger file by default, and never into the ledger itself", () => {
    const file = join(fx.dir, "ledger.sqlite");
    const db = openDb(file);
    const store = checkpointStore(db);
    expect(store).toMatchObject({ path: `${file}.checkpoints.jsonl` });
    expect(store.read()).toBe("");
    audit(db, "support", MONEY, "R-1", { amount: "1.00", origin: null });
    expect(cpLines(readFileSync(`${file}.checkpoints.jsonl`, "utf8")).map((c) => c.entries)).toEqual([1]);
    expect(checkpointStatus(db)).toContain(`to ${file}.checkpoints.jsonl`);
    process.env[CHECKPOINT_ENV.file] = file;
    expect(() => checkpointStore(db)).toThrow(`${CHECKPOINT_ENV.file} is the ledger itself`);
    expect(checkpointRefusal(db, "policy change")).toMatch(/the checkpoint configuration is broken: PURSER_CHECKPOINT_FILE is the ledger itself.*no policy change until/);
    expect(checkpointAlerts(db)[0]).toMatchObject({ code: "audit_checkpoint_config", words: expect.stringContaining("is the ledger itself") });
    // A money row is still recorded: the checkpoint it cannot write is the gate's to report.
    audit(db, "support", MONEY, "R-2", { amount: "1.00", origin: null });
    expect(db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE subject = 'R-2'").get()).toEqual({ n: 1 });
    db.close();
  });
});

describe("writing a checkpoint", () => {
  beforeEach(() => { fx = useCheckpointKey(); });

  it("asked inside a transaction it waits for the commit; the next audit row or /health writes it then", async () => {
    const db = openDb(":memory:");
    audit(db, "system", "x.note", "first", {});
    const store = checkpointStore(db);
    db.transaction(() => {
      expect(writeCheckpoint(db)).toEqual({ ok: true, checkpoints: [], deferred: true });
      // A money row in the same transaction finds the checkpoint already waiting.
      audit(db, "support", MONEY, "R-1", { amount: "1.00", origin: null });
      audit(db, "support", MONEY, "R-2", { amount: "1.00", origin: null });
    })();
    await new Promise((r) => setImmediate(r));
    expect(cpLines(store.read()).at(-1)!.entries).toBe(1);
    // /health writes this process's waiting checkpoint first: it is no alarm.
    expect(checkpointAlerts(db)).toEqual([]);
    expect(cpLines(store.read()).at(-1)!.entries).toBe(3);
  });

  it("a checkpoint due while the transaction is still open waits; one due after the ledger closed is dropped", async () => {
    const db = openDb(":memory:");
    audit(db, "system", "x.note", "first", {});
    const store = checkpointStore(db);
    db.exec("BEGIN");
    audit(db, "support", MONEY, "R-1", { amount: "1.00", origin: null });
    await new Promise((r) => setImmediate(r)); // the flush finds the transaction still open
    expect(cpLines(store.read()).at(-1)!.entries).toBe(1);
    db.exec("COMMIT");
    expect(checkpointRefusal(db, "payment")).toBeNull();
    expect(cpLines(store.read()).at(-1)!.entries).toBe(2);

    const closed = openDb(":memory:");
    audit(closed, "system", "x.note", "first", {});
    closed.transaction(() => { audit(closed, "support", MONEY, "R-1", { amount: "1.00", origin: null }); })();
    const closedStore = checkpointStore(closed);
    const n = cpLines(closedStore.read()).length;
    closed.close();
    await new Promise((r) => setImmediate(r));
    expect(cpLines(closedStore.read())).toHaveLength(n);
  });

  it("refuses over a chain that does not verify, and the gate and /health say where it breaks", () => {
    const db = openDb(":memory:");
    for (let i = 0; i < 3; i++) audit(db, "system", "x.note", `n${i}`, { i });
    breakChain(db, 2);
    const w = writeCheckpoint(db);
    expect(w).toMatchObject({ ok: false, problems: [{ code: "chain_broken" }] });
    expect((w as { reason: string }).reason).toMatch(/^ledger_tampered: the audit log does not verify at row 2/);
    expect(checkpointRefusal(db, "payment")).toMatch(/^ledger_tampered: .*row 2/);
    const alerts = checkpointAlerts(db);
    expect(alerts[0]).toMatchObject({ code: "audit_checkpoint_mismatch", since: null, words: expect.stringContaining("ledger_tampered") });
  });

  it("init over checkpoints that exist is refused (in memory too); init over an empty ledger signs the genesis hash", () => {
    const empty = openDb(":memory:");
    const w = writeCheckpoint(empty, { init: true });
    expect(w).toMatchObject({ ok: true, checkpoints: [{ n: 1, entries: 0, head: GENESIS }] });
    expect(writeCheckpoint(empty, { init: true })).toEqual({ ok: false, reason: "checkpoints already exist; move that file aside first if the ledger was restored", problems: [] });
  });

  it("stops before a money row no one announced, keeps the rows of its own after it, and signs past it only when a person accepts the tail", () => {
    const db = openDb(":memory:");
    audit(db, "system", "x.note", "first", {});
    const forged = forgeAppend(db, MONEY);
    // Rows after the forged one, written by this process inside a transaction (not yet checkpointed).
    db.transaction(() => { audit(db, "system", "x.note", "mine", {}); })();
    const w = writeCheckpoint(db);
    expect(w).toMatchObject({ ok: true, checkpoints: [{ entries: forged.seq - 1 }] });
    expect(checkpointRefusal(db, "payment")).toMatch(/no signed intent announced \(first: row 2, refund\.paid\)/);
    const accepted = writeCheckpoint(db, { acceptTail: true });
    // Row 4 is the gate's own record of the refusal.
    expect(accepted).toMatchObject({ ok: true, checkpoints: [{ entries: 4 }] });
    expect(checkpointRefusal(db, "payment")).toBeNull();
  });

  it("a checkpoint file made with another key: untrusted, and this process's key is not the active one", () => {
    const keyFile = process.env[CHECKPOINT_ENV.keyFile];
    delete process.env[CHECKPOINT_ENV.keyFile];
    const db = openDb(":memory:");
    audit(db, "system", "x.note", "first", {}); // written with checkpoints off
    const other = devCheckpointKey(fx.dir, "other.pem");
    fx.useKey(other);
    resetCheckpointMemory(db);
    expect(writeCheckpoint(db, { init: true })).toMatchObject({ ok: true });
    process.env[CHECKPOINT_ENV.keyFile] = keyFile;
    resetCheckpointMemory(db);
    const r = checkpointRefusal(db, "key enrolment")!;
    expect(r).toContain(`no checkpoint is signed by this runner's key ${keyIdOf(fx.key.publicKey)} or a key in ${CHECKPOINT_ENV.trust}`);
    expect(r).toContain(`this process signs with key ${keyIdOf(fx.key.publicKey)}, but the checkpoints' active key is ${keyIdOf(other.publicKey)}`);
    expect(r).toMatch(/no key enrolment until a person has checked it/);
    // Trusting the other key leaves only the restart to do.
    process.env[CHECKPOINT_ENV.trust] = other.publicKey;
    resetCheckpointMemory(db);
    const again = checkpointRefusal(db, "payment")!;
    expect(again).not.toContain("no checkpoint is signed by this runner's key");
    expect(again).toContain("restart it with the current key");
  });

  it("a malformed first line is reported as it is, not as a missing checkpoint", () => {
    const keyFile = process.env[CHECKPOINT_ENV.keyFile];
    delete process.env[CHECKPOINT_ENV.keyFile];
    const db = openDb(":memory:");
    audit(db, "system", "x.note", "first", {}); // written with checkpoints off
    process.env[CHECKPOINT_ENV.keyFile] = keyFile;
    resetCheckpointMemory(db);
    checkpointStore(db).append("garbage\n");
    const r = checkpointRefusal(db, "payment")!;
    expect(r).toContain("a line after checkpoint 0: not JSON");
    expect(r).not.toContain("no checkpoint yet");
    // A money row after it is recorded, and no checkpoint is signed over the broken file.
    audit(db, "support", MONEY, "R-1", { amount: "1.00", origin: null });
    expect(cpLines(checkpointStore(db).read())).toEqual([]);
    expect(checkpointRefusal(db, "payment")).toContain("not JSON");
  });

  it("/health has nothing to say about checkpoints while they are off", () => {
    delete process.env[CHECKPOINT_ENV.keyFile];
    resetCheckpointMemory();
    expect(checkpointAlerts(openDb(":memory:"))).toEqual([]);
  });

  it("the gate inside a transaction checks, but leaves its checkpoint to the commit", () => {
    const db = openDb(":memory:");
    audit(db, "system", "x.note", "first", {});
    const store = checkpointStore(db);
    audit(db, "system", "x.note", "second", {});
    const n = cpLines(store.read()).length;
    db.transaction(() => { expect(checkpointRefusal(db, "payment")).toBeNull(); })();
    expect(cpLines(store.read())).toHaveLength(n);
    expect(checkpointRefusal(db, "payment")).toBeNull();
    expect(cpLines(store.read()).at(-1)!.entries).toBe(2);
  });
});

describe("signatures and intents that cannot even be read", () => {
  it("a checkpoint whose public key is not a key, or an intent whose is not, does not verify", () => {
    const key = generateKeyPairSync("ed25519").privateKey;
    const pub = rawPublicKey(key);
    const c = signCheckpoint({ v: CHECKPOINT_SCHEMA, n: 1, entries: 0, head: GENESIS, ts: new Date().toISOString(), key_id: keyIdOf(pub), public_key: pub, prev: GENESIS }, key);
    expect(signatureValid(c)).toBe(true);
    expect(signatureValid({ ...c, public_key: "!" })).toBe(false);
    const bad = { v: "purser.checkpoint-intent/v1", seq: 1, row_hash: "a".repeat(64), ts: c.ts, key_id: "x", public_key: "!", sig: "x" } as Intent;
    expect(walkCheckpoints([bad], [pub]).problem).toMatchObject({ code: "bad_signature", seq: 1 });
  });
});

describe("the chain check on a database that refuses reads of its schema (a Durable Object)", () => {
  /** A ledger whose schema version and sqlite_master cannot be read, as a Durable Object's SQLite answers. */
  function refusing(db: DB, message: string): DB {
    return new Proxy(db, {
      get(target, prop, receiver) {
        if (prop === "pragma") return () => { throw new Error(message); };
        if (prop === "prepare") return (sql: string) => { if (sql.includes("sqlite_master")) throw new Error(message); return target.prepare(sql); };
        const v = Reflect.get(target, prop, receiver) as unknown;
        return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(target) : v;
      },
    });
  }

  it("\"not authorized\": the whole chain is hashed on every check, and a change is still found", () => {
    const db = openDb(":memory:");
    for (let i = 0; i < 3; i++) audit(db, "system", "x.note", `n${i}`, { i });
    const dobj = refusing(db, "SQLITE_AUTH: not authorized");
    expect(auditChainRefusal(dobj)).toBeNull();
    expect(auditChainRefusal(dobj)).toBeNull();
    breakChain(db, 3);
    expect(auditChainRefusal(dobj)).toMatch(/^ledger_tampered: the audit log does not verify at row 3/);
  });

  it("any other error is not swallowed", () => {
    const db = openDb(":memory:");
    expect(() => auditChainRefusal(refusing(db, "disk I/O error"))).toThrow("disk I/O error");
  });
});
