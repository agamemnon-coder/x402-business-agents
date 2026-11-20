// What someone with write access to the ledger file and the checkpoint file can do (outside audit 1.4): the attacks the
// signed audit checkpoints must catch, each of which still passes the hash chain's own check. Used by the checkpoint
// drill (src/e2e/checkpointDrill.ts) on copies of a runner's ledger; test/audit-checkpoints.test.ts has the same tools.
// They write past Purser's code, by plain SQL with the append-only triggers dropped and put back, as an attacker would.
import type { KeyObject } from "node:crypto";
import { readFileSync } from "node:fs";
import { jcs, type Json } from "@metalntwx/metal-pay/mandates";
import { CHECKPOINT_SCHEMA, checkpointId, keyIdOf, parseCheckpoint, rawPublicKey, signCheckpoint, type Checkpoint } from "../audit/checkpoint.js";
import { AUDIT_GUARDS } from "../audit/intact.js";
import type { AuditRowStored } from "../audit/log.js";
import type { DB } from "../db/open.js";
import { sha256Hex } from "../lib/terms.js";

/** Runs `fn` with the audit log's append-only triggers dropped, and puts them back. */
export function withoutGuards(db: DB, fn: () => void): void {
  const sqls = AUDIT_GUARDS.map((n) => (db.prepare("SELECT sql FROM sqlite_master WHERE name = ?").get(n) as { sql: string }).sql);
  for (const n of AUDIT_GUARDS) db.exec(`DROP TRIGGER ${n}`);
  try { fn(); } finally { for (const s of sqls) db.exec(s); }
}

export const rowHash = (r: Omit<AuditRowStored, "row_hash">) =>
  sha256Hex(r.prev_hash + jcs({ seq: r.seq, ts: r.ts, actor: r.actor, event: r.event, subject: r.subject, payload: JSON.parse(r.payload_json) as Json }));

export const auditRows = (db: DB) => db.prepare("SELECT * FROM audit_log ORDER BY seq").all() as AuditRowStored[];

/** Changes one row's payload and recomputes every hash from there on: the chain verifies again. */
export function rewriteFrom(db: DB, seq: number, payload: Json): void {
  withoutGuards(db, () => {
    let prev: string | null = null;
    for (const r of auditRows(db)) {
      if (r.seq < seq) { prev = r.row_hash; continue; }
      const next = { ...r, payload_json: r.seq === seq ? jcs(payload) : r.payload_json, prev_hash: prev ?? r.prev_hash };
      const h = rowHash(next);
      db.prepare("UPDATE audit_log SET payload_json = ?, prev_hash = ?, row_hash = ? WHERE seq = ?").run(next.payload_json, next.prev_hash, h, r.seq);
      prev = h;
    }
  });
}

/** Cuts the log's tail after row `keep`: what is left still verifies. */
export function truncateAfter(db: DB, keep: number): void {
  withoutGuards(db, () => db.prepare("DELETE FROM audit_log WHERE seq > ?").run(keep));
}

/** Appends a correctly chained row by plain SQL, past Purser's code. */
export function forgeAppend(db: DB, event: string, payload: Json, ts = new Date().toISOString()): AuditRowStored {
  const last = db.prepare("SELECT seq, row_hash FROM audit_log ORDER BY seq DESC LIMIT 1").get() as { seq: number; row_hash: string };
  const r = { seq: last.seq + 1, ts, actor: "treasury", event, subject: "forged", payload_json: jcs(payload), prev_hash: last.row_hash };
  const full = { ...r, row_hash: rowHash(r) };
  db.prepare("INSERT INTO audit_log (seq, ts, actor, event, subject, payload_json, prev_hash, row_hash) VALUES (@seq, @ts, @actor, @event, @subject, @payload_json, @prev_hash, @row_hash)").run(full);
  return full;
}

const lines = (file: string) => readFileSync(file, "utf8").split("\n").filter(Boolean);
/** The checkpoint lines of a checkpoint file (it also holds each money row's signed intent). */
export const checkpointLines = (file: string) => lines(file).filter((l) => !(parseCheckpoint(l) as { v: string }).v.includes("intent"));

/** The next checkpoint in the file's chain over `entries`/`head`, signed with any key: what a key's holder could append. */
export function nextSignedBy(file: string, key: KeyObject, over: Partial<Checkpoint> = {}): Checkpoint {
  const latest = parseCheckpoint(checkpointLines(file).at(-1)!) as Checkpoint;
  const pub = rawPublicKey(key);
  return signCheckpoint({ v: CHECKPOINT_SCHEMA, n: latest.n + 1, entries: latest.entries, head: latest.head, ts: new Date().toISOString(), key_id: keyIdOf(pub), public_key: pub, prev: checkpointId(latest), ...over }, key);
}
