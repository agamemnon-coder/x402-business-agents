// Signed audit checkpoints (outside audit, finding 1.4): "a party able to write the SQLite database can append records
// after the last published anchor, or rewrite the chain and recompute it." Each attack below passes the hash chain's own
// check (verifyAuditChain, auditChainRefusal), and is caught by the checkpoints: by the offline verifier
// (npm run verify-audit) and by the gate before a payment, a loosening policy change and a key enrolment. No network;
// a dev key made per test, never a real one.
import { spawnSync } from "node:child_process";
import { appendFileSync, chmodSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { jcs, type Json } from "@metalntwx/metal-pay/mandates";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CHECKPOINT_SCHEMA, checkpointId, keyIdOf, parseCheckpoint, rawPublicKey, signCheckpoint, verifyCheckpointedLedger, type Checkpoint,
} from "../src/audit/checkpoint.js";
import { checkpointRefusal, checkpointTick, resetCheckpointMemory, writeCheckpoint } from "../src/audit/checkpointer.js";
import { AUDIT_GUARDS, auditChainRefusal } from "../src/audit/intact.js";
import { audit, verifyAuditChain, type AuditRowStored } from "../src/audit/log.js";
import { openDb, type DB } from "../src/db/open.js";
import { executePolicyChange, proposePolicyChange } from "../src/executors/policyChange.js";
import { sha256Hex } from "../src/lib/terms.js";
import { health } from "../src/ops/health.js";
import { confirmPasskey, fingerprintOf, openEnrolment } from "../src/passkey/ledger.js";
import { processAssertion, processRegistration } from "../src/passkey/process.js";
import { beginExecution } from "../src/policy/approvals.js";
import { reserveSpend } from "../src/policy/holds.js";
import { rotatePrincipalKey } from "../src/policy/principals.js";
import { frozen } from "../src/policy/rules.js";
import { FakeAuthenticator } from "../src/redteam/authenticator.js";
import { ORIGIN, RP, redTeamWorld } from "../src/redteam/world.js";
import { devCheckpointKey, useCheckpointKey, type CheckpointFixture } from "./support/checkpointKey.js";

const MONEY = "refund.paid"; // a money event (MONEY_EVENTS): a checkpoint follows it

// ---- the attacker's tools: someone with write access to the SQLite file, and to the checkpoint file -------------

function withoutGuards(db: DB, fn: () => void): void {
  const sqls = AUDIT_GUARDS.map((n) => (db.prepare("SELECT sql FROM sqlite_master WHERE name = ?").get(n) as { sql: string }).sql);
  for (const n of AUDIT_GUARDS) db.exec(`DROP TRIGGER ${n}`);
  try { fn(); } finally { for (const s of sqls) db.exec(s); }
}

const rowHash = (r: Omit<AuditRowStored, "row_hash">) =>
  sha256Hex(r.prev_hash + jcs({ seq: r.seq, ts: r.ts, actor: r.actor, event: r.event, subject: r.subject, payload: JSON.parse(r.payload_json) as Json }));

const rows = (db: DB) => db.prepare("SELECT * FROM audit_log ORDER BY seq").all() as AuditRowStored[];

/** Changes one row's payload and recomputes every hash from there on: the chain verifies again. */
function rewriteFrom(db: DB, seq: number, payload: Json): void {
  withoutGuards(db, () => {
    let prev: string | null = null;
    for (const r of rows(db)) {
      if (r.seq < seq) { prev = r.row_hash; continue; }
      const next = { ...r, payload_json: r.seq === seq ? jcs(payload) : r.payload_json, prev_hash: prev ?? r.prev_hash };
      const h = rowHash(next);
      db.prepare("UPDATE audit_log SET payload_json = ?, prev_hash = ?, row_hash = ? WHERE seq = ?").run(next.payload_json, next.prev_hash, h, r.seq);
      prev = h;
    }
  });
}

/** Cuts the log's tail: what is left still verifies. */
function truncate(db: DB, keep: number): void {
  withoutGuards(db, () => db.prepare("DELETE FROM audit_log WHERE seq > ?").run(keep));
}

/** Appends a correctly chained row by plain SQL, past Purser's code. */
function forgeAppend(db: DB, event: string, payload: Json): AuditRowStored {
  const last = db.prepare("SELECT seq, row_hash FROM audit_log ORDER BY seq DESC LIMIT 1").get() as { seq: number; row_hash: string };
  const r = { seq: last.seq + 1, ts: new Date().toISOString(), actor: "treasury", event, subject: "forged", payload_json: jcs(payload), prev_hash: last.row_hash };
  const full = { ...r, row_hash: rowHash(r) };
  db.prepare("INSERT INTO audit_log (seq, ts, actor, event, subject, payload_json, prev_hash, row_hash) VALUES (@seq, @ts, @actor, @event, @subject, @payload_json, @prev_hash, @row_hash)").run(full);
  return full;
}

const lines = (file: string) => readFileSync(file, "utf8").split("\n").filter(Boolean);
/** The checkpoint lines only (the file also holds each money row's signed intent). */
const cpLines = (file: string) => lines(file).filter((l) => !(parseCheckpoint(l) as { v: string }).v.includes("intent"));
const cps = (file: string) => cpLines(file).map((l) => parseCheckpoint(l) as Checkpoint);
const cpAt = (file: string, i: number) => cps(file).at(i)!;

/** The next checkpoint in the file's chain, signed with any key: what an attacker holding that key could append. */
function nextSignedBy(file: string, key: ReturnType<typeof devCheckpointKey>["key"], over: Partial<Checkpoint> = {}): Checkpoint {
  const latest = cpAt(file, -1);
  const pub = rawPublicKey(key);
  return signCheckpoint({ v: CHECKPOINT_SCHEMA, n: latest.n + 1, entries: latest.entries, head: latest.head, ts: new Date().toISOString(), key_id: keyIdOf(pub), public_key: pub, prev: checkpointId(latest), ...over }, key);
}

let fx: CheckpointFixture;
afterEach(() => fx?.restore());

/** A ledger with checkpoints in a file: three money rows, each followed by a checkpoint, and a scheduled one. */
function ledger(): DB {
  const db = openDb(":memory:");
  for (let i = 0; i < 3; i++) {
    audit(db, "system", "x.note", `n${i}`, { i });
    audit(db, "support", MONEY, `R-${i}`, { amount: "1.00", i, origin: null });
  }
  audit(db, "system", "x.note", "tail", { i: 9 });
  expect(writeCheckpoint(db)).toMatchObject({ ok: true });
  return db;
}

const verify = (db: DB, o: { trusted?: string[]; known?: string; maxTailAgeMs?: number; now?: Date } = {}) =>
  verifyCheckpointedLedger({ rows: rows(db), checkpoints: readFileSync(fx.file!, "utf8"), trusted: o.trusted ?? [fx.key.publicKey], known: o.known, maxTailAgeMs: o.maxTailAgeMs, now: o.now });

const codes = (r: { problems: { code: string }[] }) => r.problems.map((p) => p.code);

describe("checkpoints are written after every money action and on the schedule, signed with a key outside the ledger", () => {
  beforeEach(() => { fx = useCheckpointKey({ file: true }); });

  it("checkpoints a money row at once, a ledger that verifies passes, and the key is in no table", () => {
    const db = ledger();
    // The ledger's genesis checkpoint at its first row, one after each money row, one by the schedule's write; and
    // before each money row was committed, its signed intent.
    expect(cps(fx.file!).map((c) => c.entries)).toEqual([1, 2, 4, 6, 7]);
    expect(lines(fx.file!).filter((l) => l.includes("checkpoint-intent")).map((l) => (JSON.parse(l) as { seq: number }).seq)).toEqual([2, 4, 6]);
    const r = verify(db);
    expect(r).toMatchObject({ ok: true, checkpoints: 5, rows: 7, keys: [keyIdOf(fx.key.publicKey)] });
    expect(r.latest).toMatchObject({ n: 5, entries: 7, head: rows(db)[6]!.row_hash, key_id: keyIdOf(fx.key.publicKey) });
    // Nothing of the private key reaches the ledger: no table holds its PEM body.
    const pemBody = readFileSync(fx.key.file, "utf8").split("\n")[1]!;
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((t) => t.name);
    for (const t of tables) expect(JSON.stringify(db.prepare(`SELECT * FROM "${t}"`).all())).not.toContain(pemBody);
  });

  it("a money row written inside a transaction is checkpointed once it has committed, before the next gate", () => {
    const db = ledger();
    db.transaction(() => { audit(db, "support", MONEY, "R-tx", { amount: "2.00", origin: null }); })();
    expect(cps(fx.file!)).toHaveLength(5);
    expect(checkpointRefusal(db, "payment")).toBeNull();
    expect(cpAt(fx.file!, -1).entries).toBe(8);
  });

  it("another process's money row is checkpointed by that process, even when it exits at once after a transaction", () => {
    const dbFile = join(fx.dir, "shared.sqlite");
    const db = openDb(dbFile);
    audit(db, "support", MONEY, "R-0", { amount: "1.00", origin: null });
    const kid = spawnSync(process.execPath, ["--import", "tsx", resolve(import.meta.dirname, "support/checkpointExitWorker.ts"), dbFile], { encoding: "utf8", env: process.env, timeout: 60_000 });
    expect(kid.status).toBe(0);
    expect(cpAt(fx.file!, -1).entries).toBe(2);
    expect(checkpointRefusal(db, "payment")).toBeNull();
    db.close();
  }, 60_000);

  it("a process killed (SIGKILL) after committing a money row, before its checkpoint: the row's signed intent vouches for it", () => {
    const dbFile = join(fx.dir, "killed.sqlite");
    const db = openDb(dbFile);
    audit(db, "support", MONEY, "R-0", { amount: "1.00", origin: null });
    const kid = spawnSync(process.execPath, ["--import", "tsx", resolve(import.meta.dirname, "support/checkpointExitWorker.ts"), dbFile, "kill"], { encoding: "utf8", env: process.env, timeout: 60_000 });
    expect(kid.signal).toBe("SIGKILL");
    expect(cpAt(fx.file!, -1).entries).toBe(1); // no checkpoint covers row 2
    expect(checkpointRefusal(db, "payment")).toBeNull(); // its intent does, and the gate's checkpoint now covers it
    expect(cpAt(fx.file!, -1).entries).toBe(2);
    // A money row appended by plain SQL has no intent: refused.
    forgeAppend(db, MONEY, { amount: "500.00", origin: null });
    expect(checkpointRefusal(db, "payment")).toMatch(/no signed intent announced/);
    db.close();
  }, 60_000);

  it("the schedule writes one checkpoint per interval, and none while it is not due", () => {
    const db = ledger();
    const t0 = Date.now() + 10 * 60_000;
    expect(checkpointTick(db, t0)).toMatchObject({ ok: true });
    expect(checkpointTick(db, t0 + 1000)).toBeNull();
    expect(checkpointTick(db, t0 + 5 * 60_000)).toMatchObject({ ok: true });
    expect(cps(fx.file!)).toHaveLength(7);
  });

  it("refuses a key file others can read, and says so on /health", () => {
    const db = ledger();
    chmodSync(fx.key.file, 0o644);
    resetCheckpointMemory();
    expect(checkpointRefusal(db, "payment")).toMatch(/^audit_checkpoint_mismatch: .*can be read by others/);
    expect(health(db).alerts.find((a) => a.code === "audit_checkpoint_config")).toMatchObject({ severity: "critical" });
  });
});

describe("the verifier (npm run verify-audit) finds each attack the hash chain alone misses", () => {
  beforeEach(() => { fx = useCheckpointKey({ file: true }); });

  it("truncation: rows cut off the end", () => {
    const db = ledger();
    truncate(db, 5);
    expect(verifyAuditChain(db)).toMatchObject({ ok: true, rows: 5 }); // the chain alone: fine
    expect(codes(verify(db))).toEqual(["truncated"]);
  });

  it("a full-chain rewrite: a row changed and every hash after it recomputed", () => {
    const db = ledger();
    rewriteFrom(db, 2, { amount: "1000.00", i: 0, origin: null });
    expect(verifyAuditChain(db)).toMatchObject({ ok: true, rows: 7 });
    const r = verify(db);
    expect(codes(r)).toEqual(["rewritten"]);
    expect(r.problems[0]!.detail).toMatch(/row 2 has hash .* checkpoint 2 signed/);
  });

  it("replay: an old checkpoint appended again as the latest", () => {
    const db = ledger();
    appendFileSync(fx.file!, `${cpLines(fx.file!)[1]}\n`);
    expect(codes(verify(db))).toEqual(["replay"]);
  });

  it("replay: the file cut back to an old checkpoint, found against a copy kept earlier", () => {
    const db = ledger();
    const copy = readFileSync(fx.file!, "utf8");
    writeFileSync(fx.file!, `${cpLines(fx.file!)[0]}\n`);
    truncate(db, 1); // and the ledger rewound to what that checkpoint covers
    expect(verify(db).ok).toBe(true); // on its own, the cut-back file and ledger agree
    expect(codes(verify(db, { known: copy }))).toEqual(["replay"]);
  });

  it("a forged append: a money row added after the latest checkpoint", () => {
    const db = ledger();
    forgeAppend(db, MONEY, { amount: "500.00", origin: null });
    expect(verifyAuditChain(db)).toMatchObject({ ok: true, rows: 8 });
    expect(codes(verify(db))).toEqual(["uncovered_money"]);
  });

  it("a forged append: a checkpoint line changed to cover forged rows", () => {
    const db = ledger();
    const forged = forgeAppend(db, MONEY, { amount: "500.00", origin: null });
    const last = cpAt(fx.file!, -1);
    const all = lines(fx.file!);
    expect(parseCheckpoint(all.at(-1)!)).toEqual(last);
    all[all.length - 1] = JSON.stringify({ ...last, entries: forged.seq, head: forged.row_hash });
    writeFileSync(fx.file!, `${all.join("\n")}\n`);
    expect(codes(verify(db))).toEqual(["bad_signature", "uncovered_money"]);
  });

  it("a checkpoint signed by an unknown key", () => {
    const db = ledger();
    const stranger = devCheckpointKey(fx.dir, "stranger.pem");
    forgeAppend(db, "x.note", { forged: true });
    appendFileSync(fx.file!, `${JSON.stringify(nextSignedBy(fx.file!, stranger.key, { entries: 8, head: rows(db)[7]!.row_hash }))}\n`);
    expect(codes(verify(db))).toEqual(["unknown_key"]);
  });

  it("a whole checkpoint file made with an attacker's key is trusted by no one", () => {
    const db = ledger();
    rewriteFrom(db, 2, { amount: "1000.00", i: 0, origin: null });
    const attacker = devCheckpointKey(fx.dir, "attacker.pem");
    const pub = rawPublicKey(attacker.key);
    const last = rows(db).at(-1)!;
    writeFileSync(fx.file!, `${JSON.stringify(signCheckpoint({ v: CHECKPOINT_SCHEMA, n: 1, entries: last.seq, head: last.row_hash, ts: new Date().toISOString(), key_id: keyIdOf(pub), public_key: pub, prev: "0".repeat(64) }, attacker.key))}\n`);
    expect(codes(verify(db))).toEqual(["untrusted"]);
    expect(verify(db, { trusted: [pub] }).ok).toBe(true); // only someone who pinned the attacker's key would accept it
  });

  it("key rotation: the new key is introduced by a checkpoint signed with the old one; the old one then signs nothing", () => {
    const db = ledger();
    const next = devCheckpointKey(fx.dir, "next.pem");
    expect(writeCheckpoint(db, { rotateTo: next.key })).toMatchObject({ ok: true, checkpoints: [{ key_id: keyIdOf(fx.key.publicKey), rotate_to: { key_id: keyIdOf(next.publicKey) } }, { key_id: keyIdOf(next.publicKey) }] });
    // The runner restarts with the new key; money moves on and is checkpointed with it.
    fx.useKey(next);
    audit(db, "support", MONEY, "R-new", { amount: "1.00", origin: null });
    expect(cpAt(fx.file!, -1)).toMatchObject({ key_id: keyIdOf(next.publicKey), entries: 8 });
    // An auditor who pinned the first key follows the rotation; one who pinned only the new key accepts the history.
    expect(verify(db, { trusted: [fx.key.publicKey] }).ok).toBe(true);
    expect(verify(db, { trusted: [next.publicKey] }).ok).toBe(true);
    // The old key, rotated out (say it leaked), signs a checkpoint over a forged row: refused.
    forgeAppend(db, "x.note", { forged: true });
    appendFileSync(fx.file!, `${JSON.stringify(nextSignedBy(fx.file!, fx.key.key, { entries: 9, head: rows(db)[8]!.row_hash }))}\n`);
    expect(codes(verify(db, { trusted: [fx.key.publicKey] }))).toEqual(["rotated_out_key"]);
  });

  it("with real clocks: a row backdated before the checkpoint that skips it, or left uncovered past the schedule", () => {
    const db = ledger();
    const latest = cpAt(fx.file!, -1);
    const back = forgeAppend(db, "x.note", { forged: true });
    withoutGuards(db, () => {
      const ts = new Date(Date.parse(latest.ts) - 3_600_000).toISOString();
      db.prepare("UPDATE audit_log SET ts = ?, row_hash = ? WHERE seq = ?").run(ts, rowHash({ ...back, ts }), back.seq);
    });
    expect(verify(db).ok).toBe(true); // a non-money row: only the clocks can tell
    expect(codes(verify(db, { maxTailAgeMs: 15 * 60_000 }))).toEqual(["stale_tail"]);
  });

  it("the npm run verify-audit command exits 0 on a ledger that matches and 1 on a rewrite", () => {
    const dbFile = join(fx.dir, "ledger.sqlite");
    process.env.KIT11_DB = dbFile;
    try {
      const db = openDb(dbFile);
      for (let i = 0; i < 2; i++) audit(db, "support", MONEY, `R-${i}`, { amount: "1.00", origin: null });
      const run = () => spawnSync(process.execPath, ["--import", "tsx", resolve(import.meta.dirname, "../src/cli/verifyAudit.ts")], { encoding: "utf8", env: process.env, timeout: 60_000 });
      const ok = run();
      expect(ok.stdout).toMatch(/^ok +2 audit rows, 2 checkpoint\(s\)/);
      expect(ok.status).toBe(0);
      rewriteFrom(db, 1, { amount: "900.00", origin: null });
      db.close();
      const bad = run();
      expect(bad.stdout).toMatch(/FAIL {2}rewritten {2}row 1 has hash/);
      expect(bad.status).toBe(1);
    } finally {
      delete process.env.KIT11_DB;
    }
  }, 60_000);
});

describe("before a payment, a loosening policy change or a key enrolment, the runner checks the ledger against the latest checkpoint", () => {
  it("without a checkpoint key, a full-chain rewrite still lets money move: the hole this closes", async () => {
    fx = useCheckpointKey();
    delete process.env.PURSER_CHECKPOINT_KEY_FILE; // switched off (fx.restore puts back what was there)
    const w = await redTeamWorld();
    rewriteFrom(w.db, 3, {});
    expect(auditChainRefusal(w.db)).toBeNull();
    expect(reserveSpend(w.db, { agent: "sourcing", rail: "metal", cents: 3, ref: "off", now: w.now(), payee: "supplier" })).toBeNull();
  });

  it("with a test key configured, the flows run as before: an enrolment, an agent's spend, an approved payment, a policy change", async () => {
    fx = useCheckpointKey();
    const w = await redTeamWorld(); // enrols the CFO's passkey and onboards an outside agent: both checked
    const p = w.propose();
    await processAssertion(w.db, w.cfoApproval(p.id, p.hash), w.now());
    expect(reserveSpend(w.db, { agent: "sourcing", rail: "metal", cents: 3, ref: "ok", now: w.now(), payee: "supplier" })).toBeNull();
    expect(() => beginExecution(w.db, p.id, () => {}, w.now())).not.toThrow();
    const stop = proposePolicyChange(w.db, { changes: [{ key: "freeze", to: "on" }], reason: "drill" }, "human", w.now());
    await processAssertion(w.db, w.cfoApproval(stop.proposal_id, stop.terms_sha256), w.now());
    executePolicyChange(w.db, stop.proposal_id, w.now());
    const lift = proposePolicyChange(w.db, { changes: [{ key: "freeze", to: "off" }], reason: "drill over" }, "human", w.now());
    await processAssertion(w.db, w.cfoApproval(lift.proposal_id, lift.terms_sha256), w.now());
    executePolicyChange(w.db, lift.proposal_id, w.now());
    expect(frozen(w.db)).toBe(false);
    expect(rotatePrincipalKey(w.db, "sourcing", "max", w.now()).version).toBeGreaterThan(0);
    expect(health(w.db, w.now()).alerts.filter((a) => a.code.startsWith("audit_checkpoint"))).toEqual([]);
    expect(w.db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE event = 'audit.checkpoint_refused'").get()).toEqual({ n: 0 });
  });

  it("a full-chain rewrite is refused before money moves, a loosening policy change and a key enrolment; the emergency stop still runs; /health raises the critical alarm", async () => {
    fx = useCheckpointKey();
    const w = await redTeamWorld();
    const p = w.propose();
    await processAssertion(w.db, w.cfoApproval(p.id, p.hash), w.now());
    // The stop is approved while all is well; the lift too, to be carried out later.
    const stop = proposePolicyChange(w.db, { changes: [{ key: "freeze", to: "on" }], reason: "incident" }, "human", w.now());
    await processAssertion(w.db, w.cfoApproval(stop.proposal_id, stop.terms_sha256), w.now());
    expect(reserveSpend(w.db, { agent: "sourcing", rail: "metal", cents: 3, ref: "before", now: w.now(), payee: "supplier" })).toBeNull();

    rewriteFrom(w.db, 3, {});
    expect(auditChainRefusal(w.db)).toBeNull(); // the chain alone: fine

    expect(reserveSpend(w.db, { agent: "sourcing", rail: "metal", cents: 3, ref: "after", now: w.now(), payee: "supplier" })).toMatch(/^audit_checkpoint_mismatch: .*rewritten|^audit_checkpoint_mismatch: .*row \d+ has hash/);
    expect(() => beginExecution(w.db, p.id, () => {}, w.now())).toThrow(/audit_checkpoint_mismatch/);
    expect(w.db.prepare("SELECT status FROM proposals WHERE proposal_id = ?").get(p.id)).toEqual({ status: "APPROVED" });
    expect(() => rotatePrincipalKey(w.db, "sourcing", "max", w.now())).toThrow(/audit_checkpoint_mismatch: .*no key enrolment/);
    // A second person's passkey: refused at the moment it would be pinned.
    const second = new FakeAuthenticator();
    const { window, code } = openEnrolment(w.db, { rpId: RP, origin: ORIGIN, addPerson: "controller" }, w.now());
    const reg = await processRegistration(w.db, w.item("registration", { code, credential: second.register({ challenge: window.challenge, origin: ORIGIN, rpId: RP }) }), { label: "controller" }, w.now());
    if (reg.status === "pending") expect(() => confirmPasskey(w.db, fingerprintOf(second.spkiSha256), w.now())).toThrow(/audit_checkpoint_mismatch/);
    else expect(reg.message).toMatch(/audit_checkpoint_mismatch/);
    expect(w.db.prepare("SELECT COUNT(*) AS n FROM passkeys WHERE status = 'ACTIVE'").get()).toEqual({ n: 1 });
    // The emergency stop moves no money and tightens: it still runs. Lifting it loosens: refused.
    executePolicyChange(w.db, stop.proposal_id, w.now());
    expect(frozen(w.db)).toBe(true);
    const lift = proposePolicyChange(w.db, { changes: [{ key: "freeze", to: "off" }], reason: "all clear?" }, "human", w.now());
    await processAssertion(w.db, w.cfoApproval(lift.proposal_id, lift.terms_sha256), w.now());
    expect(() => executePolicyChange(w.db, lift.proposal_id, w.now())).toThrow(/audit_checkpoint_mismatch: .*no policy change/);
    expect(frozen(w.db)).toBe(true);

    const alarm = health(w.db, w.now()).alerts.filter((a) => a.code.startsWith("audit_checkpoint"));
    expect(alarm.map((a) => [a.code, a.severity])).toEqual([["audit_checkpoint_mismatch", "critical"], ["audit_checkpoint_refused", "critical"]]);
    expect((w.db.prepare("SELECT payload_json FROM audit_log WHERE event = 'audit.checkpoint_refused'").all() as { payload_json: string }[]).map((r) => (JSON.parse(r.payload_json) as { op: string }).op))
      .toEqual(expect.arrayContaining(["payment", "key enrolment", "policy change"]));
    // And no checkpoint is ever signed over it.
    expect(writeCheckpoint(w.db)).toMatchObject({ ok: false });
  });

  it("truncation is refused before money moves", async () => {
    fx = useCheckpointKey();
    const w = await redTeamWorld();
    audit(w.db, "support", MONEY, "R-1", { amount: "1.00", origin: null }); // checkpointed
    const n = rows(w.db).length;
    truncate(w.db, n - 2);
    expect(auditChainRefusal(w.db)).toBeNull();
    expect(reserveSpend(w.db, { agent: "sourcing", rail: "metal", cents: 3, ref: "t", now: w.now(), payee: "supplier" })).toMatch(/^audit_checkpoint_mismatch: .*rows were cut off the end/);
  });

  it("a forged money row appended after the latest checkpoint is refused before money moves", async () => {
    fx = useCheckpointKey();
    const w = await redTeamWorld();
    forgeAppend(w.db, MONEY, { amount: "500.00", origin: null });
    expect(auditChainRefusal(w.db)).toBeNull();
    expect(reserveSpend(w.db, { agent: "sourcing", rail: "metal", cents: 3, ref: "f", now: w.now(), payee: "supplier" })).toMatch(/^audit_checkpoint_mismatch: .*money row\(s\) after checkpoint/);
  });

  it("a checkpoint signed by an unknown key, or by a rotated-out one, is refused before money moves", async () => {
    fx = useCheckpointKey({ file: true });
    const w = await redTeamWorld();
    audit(w.db, "support", MONEY, "R-1", { amount: "1.00", origin: null });
    const stranger = devCheckpointKey(fx.dir, "stranger.pem");
    appendFileSync(fx.file!, `${JSON.stringify(nextSignedBy(fx.file!, stranger.key))}\n`);
    expect(reserveSpend(w.db, { agent: "sourcing", rail: "metal", cents: 3, ref: "u", now: w.now(), payee: "supplier" })).toMatch(/^audit_checkpoint_mismatch: .*which no checkpoint introduced/);

    const all = lines(fx.file!);
    writeFileSync(fx.file!, `${all.slice(0, -1).join("\n")}\n`); // the stranger's line removed again
    resetCheckpointMemory();
    const next = devCheckpointKey(fx.dir, "next.pem");
    expect(writeCheckpoint(w.db, { rotateTo: next.key })).toMatchObject({ ok: true });
    fx.useKey(next);
    expect(reserveSpend(w.db, { agent: "sourcing", rail: "metal", cents: 3, ref: "r1", now: w.now(), payee: "supplier" })).toBeNull();
    appendFileSync(fx.file!, `${JSON.stringify(nextSignedBy(fx.file!, fx.key.key))}\n`);
    expect(reserveSpend(w.db, { agent: "sourcing", rail: "metal", cents: 3, ref: "r2", now: w.now(), payee: "supplier" })).toMatch(/^audit_checkpoint_mismatch: .*rotated out earlier/);
  });

  it("replay: the checkpoint file cut back to an old checkpoint is refused, by the running process and by a fresh one", async () => {
    fx = useCheckpointKey({ file: true });
    const w = await redTeamWorld();
    audit(w.db, "support", MONEY, "R-1", { amount: "1.00", origin: null });
    audit(w.db, "support", MONEY, "R-2", { amount: "1.00", origin: null });
    expect(reserveSpend(w.db, { agent: "sourcing", rail: "metal", cents: 3, ref: "a", now: w.now(), payee: "supplier" })).toBeNull();
    writeFileSync(fx.file!, `${cpLines(fx.file!)[0]}\n`);
    expect(reserveSpend(w.db, { agent: "sourcing", rail: "metal", cents: 3, ref: "b", now: w.now(), payee: "supplier" })).toMatch(/^audit_checkpoint_mismatch: .*cut back to an old checkpoint/);
    // A fresh process remembers nothing, but the money rows the removed checkpoints covered are uncovered now.
    resetCheckpointMemory(w.db);
    expect(reserveSpend(w.db, { agent: "sourcing", rail: "metal", cents: 3, ref: "c", now: w.now(), payee: "supplier" })).toMatch(/^audit_checkpoint_mismatch: .*money row\(s\) after checkpoint 1/);
  });

  it("a fresh process on a ledger it did not write, with no checkpoint yet, refuses until a person starts them (npm run verify-audit -- init)", async () => {
    fx = useCheckpointKey({ file: true });
    const off = { ...process.env };
    delete process.env.PURSER_CHECKPOINT_KEY_FILE;
    const w = await redTeamWorld(); // written with checkpoints off
    process.env.PURSER_CHECKPOINT_KEY_FILE = off.PURSER_CHECKPOINT_KEY_FILE;
    resetCheckpointMemory(w.db);
    expect(reserveSpend(w.db, { agent: "sourcing", rail: "metal", cents: 3, ref: "i", now: w.now(), payee: "supplier" })).toMatch(/^audit_checkpoint_mismatch: .*no checkpoint yet for this ledger/);
    expect(writeCheckpoint(w.db, { init: true })).toMatchObject({ ok: true });
    expect(reserveSpend(w.db, { agent: "sourcing", rail: "metal", cents: 3, ref: "j", now: w.now(), payee: "supplier" })).toBeNull();
    expect(writeCheckpoint(w.db, { init: true })).toMatchObject({ ok: false, reason: expect.stringMatching(/already exist/) });
  });

});
