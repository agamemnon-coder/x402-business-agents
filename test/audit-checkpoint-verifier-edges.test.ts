// The checkpoint verifier's refusals, one by one (src/audit/checkpoint.ts): every malformed field of a checkpoint or of a
// money row's intent is named, a chain of checkpoints that skips, forks, rolls back or is signed by a stranger stops at
// that line, and the ledger checks find rows that are gone, a broken tail, a tail left uncovered too long, and a file
// cut back against a copy kept earlier. Pure functions over text and rows: no key from the environment, no file.
import { createSecretKey, generateKeyPairSync, type KeyObject } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  BACKDATE_SKEW_MS, CHECKPOINT_SCHEMA, checkKnown, checkLedger, checkpointId, INTENT_SCHEMA, intentKey, keyIdOf, normalisePublicKey, parseCheckpoint,
  rawPublicKey, rowsView, signCheckpoint, signIntent, splitCheckpointFile, verifyCheckpointedLedger, walkCheckpoints,
  type Checkpoint, type CheckpointBody, type Intent,
} from "../src/audit/checkpoint.js";
import { audit, GENESIS, type AuditRowStored } from "../src/audit/log.js";
import { openDb } from "../src/db/open.js";

const T = "2026-11-20T10:00:00.000Z";
const ed = () => generateKeyPairSync("ed25519").privateKey;
const A = ed();
const B = ed();
const pubA = rawPublicKey(A);
const pubB = rawPublicKey(B);

/** A ledger of `n` rows (the last one a money row when `money`), as audit() writes them. */
function rowsOf(n: number, money = false): AuditRowStored[] {
  const db = openDb(":memory:");
  for (let i = 1; i <= n; i++) audit(db, "system", money && i === n ? "refund.paid" : "x.note", `r${i}`, { i, origin: null }, new Date(T));
  return db.prepare("SELECT * FROM audit_log ORDER BY seq").all() as AuditRowStored[];
}

function cp(key: KeyObject, over: Partial<CheckpointBody> & Pick<CheckpointBody, "n" | "entries" | "head" | "prev">): Checkpoint {
  const pub = rawPublicKey(key);
  return signCheckpoint({ v: CHECKPOINT_SCHEMA, ts: T, key_id: keyIdOf(pub), public_key: pub, ...over }, key);
}
function intent(key: KeyObject, seq: number, rowHash: string): Intent {
  const pub = rawPublicKey(key);
  return signIntent({ v: INTENT_SCHEMA, seq, row_hash: rowHash, ts: T, key_id: keyIdOf(pub), public_key: pub }, key);
}
const line = (x: object) => JSON.stringify(x);

describe("keys: raw Ed25519 public keys only", () => {
  it("takes a public key object as it is, and refuses a key of another type", () => {
    const { publicKey } = generateKeyPairSync("ed25519");
    expect(rawPublicKey(publicKey)).toBe(rawPublicKey(publicKey));
    expect(() => rawPublicKey(generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey)).toThrow("a checkpoint key is Ed25519, not ec");
    expect(() => rawPublicKey(createSecretKey(Buffer.alloc(32)))).toThrow("a checkpoint key is Ed25519, not unknown");
  });

  it("reads a pinned key as PEM, standard base64, or base64url with an ed25519: prefix, and refuses a wrong length", () => {
    const { publicKey } = generateKeyPairSync("ed25519");
    const raw = rawPublicKey(publicKey);
    expect(normalisePublicKey(publicKey.export({ type: "spki", format: "pem" }) as string)).toBe(raw);
    expect(normalisePublicKey(` ${Buffer.from(raw, "base64url").toString("base64")} `)).toBe(raw);
    expect(normalisePublicKey(`ed25519:${raw}`)).toBe(raw);
    expect(() => normalisePublicKey("AAAA")).toThrow("a checkpoint public key is 32 bytes, base64url; got 3 bytes");
  });
});

describe("a line of the checkpoint file: each malformed field is named", () => {
  const good = cp(A, { n: 1, entries: 0, head: GENESIS, prev: GENESIS });
  const goodIntent = intent(A, 1, "a".repeat(64));
  const with_ = (o: object, patch: Record<string, unknown>) => parseCheckpoint(line({ ...o, ...patch }));

  it("refuses what is not a JSON object", () => {
    expect(parseCheckpoint("{")).toBe("not JSON");
    expect(parseCheckpoint("[]")).toBe("not an object");
    expect(parseCheckpoint("null")).toBe("not an object");
    expect(parseCheckpoint("7")).toBe("not an object");
  });

  it("names each bad field of an intent", () => {
    expect(parseCheckpoint(line(goodIntent))).toEqual(goodIntent);
    expect(with_(goodIntent, { extra: 1, more: 2 })).toBe("unknown field(s) extra, more");
    expect(with_(goodIntent, { seq: 0 })).toBe("seq is not a positive integer");
    expect(with_(goodIntent, { seq: 1.5 })).toBe("seq is not a positive integer");
    expect(with_(goodIntent, { row_hash: "A".repeat(64) })).toBe("row_hash is not a SHA-256 hex digest");
    expect(with_(goodIntent, { row_hash: 1 })).toBe("row_hash is not a SHA-256 hex digest");
    expect(with_(goodIntent, { ts: "yesterday" })).toBe("ts is not a time");
    expect(with_(goodIntent, { ts: 5 })).toBe("ts is not a time");
    expect(with_(goodIntent, { public_key: "short" })).toBe("public_key is not a raw Ed25519 key");
    expect(with_(goodIntent, { key_id: keyIdOf(pubB) })).toBe("key_id does not match public_key");
    expect(with_(goodIntent, { sig: "x" })).toBe("sig is not an Ed25519 signature");
  });

  it("names each bad field of a checkpoint", () => {
    expect(parseCheckpoint(line(good))).toEqual(good);
    expect(with_(good, { note: "hi" })).toBe("unknown field(s) note");
    expect(with_(good, { v: "purser.checkpoint/v0" })).toBe(`schema is not ${CHECKPOINT_SCHEMA}`);
    expect(with_(good, { n: 0 })).toBe("n is not a positive integer");
    expect(with_(good, { entries: -1 })).toBe("entries is not a count");
    expect(with_(good, { entries: "3" })).toBe("entries is not a count");
    expect(with_(good, { head: "z".repeat(64) })).toBe("head is not a SHA-256 hex digest");
    expect(with_(good, { prev: null })).toBe("prev is not a SHA-256 hex digest");
    expect(with_(good, { ts: "not a date" })).toBe("ts is not a time");
    expect(with_(good, { public_key: 42 })).toBe("public_key is not a raw Ed25519 key");
    expect(with_(good, { key_id: "ABC" })).toBe("key_id does not match public_key");
    expect(with_(good, { key_id: keyIdOf(pubB) })).toBe("key_id does not match public_key");
    expect(with_(good, { sig: 7 })).toBe("sig is not an Ed25519 signature");
  });

  it("refuses a rotation that is not {key_id, public_key}, or that names the key signing it", () => {
    const rot = { key_id: keyIdOf(pubB), public_key: pubB };
    expect(with_(good, { rotate_to: rot })).toMatchObject({ rotate_to: rot });
    expect(with_(good, { rotate_to: null })).toBe("rotate_to is not {key_id, public_key}");
    expect(with_(good, { rotate_to: "B" })).toBe("rotate_to is not {key_id, public_key}");
    expect(with_(good, { rotate_to: { key_id: keyIdOf(pubB), public_key: "nope" } })).toBe("rotate_to is not {key_id, public_key}");
    expect(with_(good, { rotate_to: { key_id: keyIdOf(pubA), public_key: pubB } })).toBe("rotate_to is not {key_id, public_key}");
    expect(with_(good, { rotate_to: { ...rot, extra: 1 } })).toBe("rotate_to is not {key_id, public_key}");
    expect(with_(good, { rotate_to: { key_id: keyIdOf(pubA), public_key: pubA } })).toBe("rotate_to names the key that signs it");
  });
});

describe("the walk over the checkpoint file stops at the first line that cannot be trusted", () => {
  const rows = rowsOf(3);
  const c1 = cp(A, { n: 1, entries: 1, head: rows[0]!.row_hash, prev: GENESIS });

  it("a malformed line", () => {
    const w = walkCheckpoints([c1, "not JSON"], [pubA]);
    expect(w.problem).toEqual({ code: "malformed", n: 2, detail: "a line after checkpoint 1: not JSON" });
    expect(w.good).toEqual([c1]);
  });

  it("an intent whose signature does not verify", () => {
    const forged = { ...intent(A, 2, rows[1]!.row_hash), row_hash: rows[2]!.row_hash };
    expect(walkCheckpoints([c1, forged], [pubA]).problem).toMatchObject({ code: "bad_signature", seq: 2, detail: expect.stringContaining("the line was forged or changed") });
  });

  it("an intent signed by a key rotated out, or by a key no checkpoint introduced", () => {
    const rot = cp(A, { n: 1, entries: 1, head: rows[0]!.row_hash, prev: GENESIS, rotate_to: { key_id: keyIdOf(pubB), public_key: pubB } });
    const w1 = walkCheckpoints([rot, intent(A, 2, rows[1]!.row_hash)], [pubA]);
    expect(w1.problem).toMatchObject({ code: "rotated_out_key", seq: 2, detail: `the intent for row 2 is signed by key ${keyIdOf(pubA)}, rotated out earlier` });
    const w2 = walkCheckpoints([c1, intent(B, 2, rows[1]!.row_hash)], [pubA]);
    expect(w2.problem).toMatchObject({ code: "unknown_key", seq: 2, detail: `the intent for row 2 is signed by key ${keyIdOf(pubB)}, which no checkpoint introduced` });
    // The rotated-to key's intent is the one that counts.
    const w3 = walkCheckpoints([rot, intent(B, 2, rows[1]!.row_hash)], [pubA]);
    expect(w3).toMatchObject({ problem: null, intents: [intentKey(2, rows[1]!.row_hash)] });
  });

  it("a checkpoint that skips one, or does not link to the one before", () => {
    const skip = cp(A, { n: 3, entries: 2, head: rows[1]!.row_hash, prev: checkpointId(c1) });
    expect(walkCheckpoints([c1, skip], [pubA]).problem).toMatchObject({ code: "broken_link", n: 3, detail: "checkpoint 3 follows checkpoint 1: a checkpoint is missing" });
    const fork = cp(A, { n: 2, entries: 2, head: rows[1]!.row_hash, prev: "f".repeat(64) });
    expect(walkCheckpoints([c1, fork], [pubA]).problem).toMatchObject({ code: "broken_link", n: 2, detail: `checkpoint 2 does not link to checkpoint 1 (prev ${"f".repeat(12)}…)` });
  });

  it("a later checkpoint that covers fewer rows (rollback)", () => {
    const c2 = cp(A, { n: 1, entries: 2, head: rows[1]!.row_hash, prev: GENESIS });
    const back = cp(A, { n: 2, entries: 1, head: rows[0]!.row_hash, prev: checkpointId(c2) });
    expect(walkCheckpoints([c2, back], [pubA]).problem).toEqual({ code: "rollback", n: 2, detail: "checkpoint 2 covers 1 rows; checkpoint 1 already covered 2" });
  });

  it("a checkpoint over no rows whose head is not the genesis hash", () => {
    const odd = cp(A, { n: 1, entries: 0, head: rows[0]!.row_hash, prev: GENESIS });
    expect(walkCheckpoints([odd], [pubA]).problem).toEqual({ code: "malformed", n: 1, detail: "checkpoint 1 covers no rows but its head is not the genesis hash" });
  });

  it("an intent before the first checkpoint signed by another key than the first checkpoint's", () => {
    const w = walkCheckpoints([intent(B, 1, rows[0]!.row_hash), c1], [pubA]);
    expect(w.problem).toEqual({ code: "unknown_key", detail: `an intent before the first checkpoint is signed by key ${keyIdOf(pubB)}, not the first checkpoint's ${keyIdOf(pubA)}` });
    // By the first checkpoint's own key, it counts.
    expect(walkCheckpoints([intent(A, 1, rows[0]!.row_hash), c1], [pubA])).toMatchObject({ problem: null, intents: [intentKey(1, rows[0]!.row_hash)] });
  });
});

describe("the file's lines, and a copy kept earlier", () => {
  it("keeps a last line cut off without its newline, so it is reported, not skipped", () => {
    expect(splitCheckpointFile("a\nb")).toEqual(["a", "b"]);
    expect(splitCheckpointFile("a\nb\n")).toEqual(["a", "b"]);
    expect(splitCheckpointFile("a\n\nb\n")).toEqual(["a", "", "b"]);
  });

  it("a checkpoint replaced under the same number is a replay", () => {
    expect(checkKnown(["id1", "id2"], [{ n: 2, id: "other" }])).toEqual({ code: "replay", n: 2, detail: "checkpoint 2 is not the one seen before: the file was replaced" });
    expect(checkKnown(["id1", "id2"], [{ n: 1, id: "id1" }, { n: 2, id: "id2" }])).toBeNull();
  });
});

describe("the ledger against its checkpoints", () => {
  it("nothing to check without a checkpoint; a row that is gone below the latest is truncation", () => {
    const rows = rowsOf(3);
    expect(checkLedger(rowsView(rows), [])).toEqual([]);
    expect(rowsView(rows).rowHash(9)).toBeNull();
    const c1 = cp(A, { n: 1, entries: 2, head: rows[1]!.row_hash, prev: GENESIS });
    const holed = rows.filter((r) => r.seq !== 2);
    expect(checkLedger(rowsView(holed), [c1])).toEqual([{ code: "truncated", n: 1, seq: 2, detail: "row 2, which checkpoint 1 covers, is gone" }]);
  });

  it("a genesis checkpoint over no rows pins nothing but the start, and a broken tail after it is found", () => {
    const rows = rowsOf(3);
    const c0 = cp(A, { n: 1, entries: 0, head: GENESIS, prev: GENESIS });
    expect(checkLedger(rowsView(rows), [c0])).toEqual([]);
    const broken = rows.map((r) => (r.seq === 2 ? { ...r, prev_hash: "e".repeat(64) } : r));
    expect(checkLedger(rowsView(broken), [c0])).toEqual([{ code: "chain_broken", seq: 2, detail: "row 2 after checkpoint 1: prev_hash does not match the previous row" }]);
  });

  it("a tail left uncovered longer than the schedule allows is stale; within it, it is not", () => {
    const rows = rowsOf(3);
    const c1 = cp(A, { n: 1, entries: 1, head: rows[0]!.row_hash, prev: GENESIS });
    const later = new Date(Date.parse(T) + 10 * 60_000);
    expect(checkLedger(rowsView(rows), [c1], { maxTailAgeMs: 5 * 60_000, now: later })).toEqual([
      { code: "stale_tail", n: 1, seq: 2, detail: `row 2 (${T}) has gone uncovered longer than the checkpoint schedule allows: the checkpoints stopped, or it was appended past them` },
    ]);
    expect(checkLedger(rowsView(rows), [c1], { maxTailAgeMs: 60 * 60_000, now: later })).toEqual([]);
    // Without a clock given, the check uses the time now: rows from T are long uncovered.
    expect(checkLedger(rowsView(rows), [c1], { maxTailAgeMs: BACKDATE_SKEW_MS }).map((p) => p.code)).toEqual(["stale_tail"]);
  });
});

describe("the whole offline check", () => {
  it("a chain that does not verify, and a file with no checkpoint", () => {
    const rows = rowsOf(2).map((r) => (r.seq === 2 ? { ...r, subject: "changed" } : r));
    const r = verifyCheckpointedLedger({ rows, checkpoints: "", trusted: [pubA] });
    expect(r.ok).toBe(false);
    expect(r.problems.map((p) => p.code)).toEqual(["chain_broken", "no_checkpoint"]);
    expect(r.problems[0]).toEqual({ code: "chain_broken", seq: 2, detail: "row 2: row_hash does not match the row" });
    expect(r).toMatchObject({ latest: null, checkpoints: 0, rows: 2, keys: [] });
  });

  it("no pinned key at all: untrusted, and says none is pinned", () => {
    const rows = rowsOf(1);
    const c1 = cp(A, { n: 1, entries: 1, head: rows[0]!.row_hash, prev: GENESIS });
    const r = verifyCheckpointedLedger({ rows, checkpoints: `${line(c1)}\n`, trusted: [] });
    expect(r.problems).toEqual([{ code: "untrusted", detail: `no checkpoint is signed by a pinned key (signed by ${keyIdOf(pubA)}; pinned none)` }]);
  });

  it("a copy kept earlier that is still a prefix passes; the file with a money row announced by an intent passes too", () => {
    const rows = rowsOf(2, true);
    const c1 = cp(A, { n: 1, entries: 1, head: rows[0]!.row_hash, prev: GENESIS });
    const text = `${line(c1)}\n${line(intent(A, 2, rows[1]!.row_hash))}\n`;
    const r = verifyCheckpointedLedger({ rows, checkpoints: text, trusted: [pubA], known: `${line(c1)}\nnot json\n` });
    expect(r).toMatchObject({ ok: true, problems: [], checkpoints: 1, rows: 2, keys: [keyIdOf(pubA)] });
    // Without the intent the money row after the checkpoint is a forged append.
    expect(verifyCheckpointedLedger({ rows, checkpoints: `${line(c1)}\n`, trusted: [pubA] }).problems.map((p) => p.code)).toEqual(["uncovered_money"]);
  });
});
