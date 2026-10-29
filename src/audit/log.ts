// Append-only, hash-chained audit log (build plan 2.6).
// row_hash = SHA-256(prev_hash ‖ jcs(row without row_hash)). The database refuses UPDATE and DELETE.

import { jcs, type Json } from "@metalntwx/metal-pay/mandates";
import type { DB } from "../db/open.js";
import { redactJson, redactSecrets } from "../lib/redact.js";
import { sha256Hex } from "../lib/terms.js";

export type Actor =
  | "system" | "claude" | "sourcing" | "support" | "treasury" | "customer"
  | "human" | "owner-signer" | "awx-executor";

export const GENESIS = "0".repeat(64);

/** A stored row, as in the table and in audit.jsonl. */
export type AuditRowStored = Row;

interface Row {
  seq: number;
  ts: string;
  actor: string;
  event: string;
  subject: string | null;
  payload_json: string;
  prev_hash: string;
  row_hash: string;
}

function hashRow(r: Omit<Row, "row_hash">): string {
  const body = jcs({ seq: r.seq, ts: r.ts, actor: r.actor, event: r.event, subject: r.subject, payload: JSON.parse(r.payload_json) as Json });
  return sha256Hex(r.prev_hash + body);
}

export function audit(db: DB, actor: Actor, event: string, subject: string | null, payload: Json, now = new Date()): Row {
  const append = db.transaction(() => {
    const last = db.prepare("SELECT seq, row_hash FROM audit_log ORDER BY seq DESC LIMIT 1").get() as { seq: number; row_hash: string } | undefined;
    const row: Omit<Row, "row_hash"> = {
      seq: (last?.seq ?? 0) + 1,
      ts: now.toISOString(),
      actor,
      event,
      subject: subject === null ? null : redactSecrets(subject),
      // Round-trip through jcs so the stored text is exactly what was hashed. No credential is ever stored: the
      // log feeds the dashboard and the public relay (an error from viem, for one, quotes the RPC URL).
      payload_json: jcs(redactJson(payload)),
      prev_hash: last?.row_hash ?? GENESIS,
    };
    const full: Row = { ...row, row_hash: hashRow(row) };
    db.prepare(
      "INSERT INTO audit_log (seq, ts, actor, event, subject, payload_json, prev_hash, row_hash) VALUES (@seq, @ts, @actor, @event, @subject, @payload_json, @prev_hash, @row_hash)",
    ).run(full);
    return full;
  });
  return append.immediate();
}

export type ChainCheck = { ok: true; rows: number; head: string } | { ok: false; seq: number; reason: string };

/** Recomputes the whole chain from the genesis hash. */
export function verifyAuditChain(db: DB): ChainCheck {
  return verifyAuditRows(db.prepare("SELECT * FROM audit_log ORDER BY seq").all() as Row[]);
}

/** The same check over rows from anywhere, such as an exported audit.jsonl, with no database. */
export function verifyAuditRows(rows: Row[]): ChainCheck {
  let prev = GENESIS;
  let expectSeq = 1;
  for (const r of rows) {
    if (r.seq !== expectSeq) return { ok: false, seq: r.seq, reason: `gap: expected seq ${expectSeq}` };
    if (r.prev_hash !== prev) return { ok: false, seq: r.seq, reason: "prev_hash does not match the previous row" };
    if (hashRow(r) !== r.row_hash) return { ok: false, seq: r.seq, reason: "row_hash does not match the row" };
    prev = r.row_hash;
    expectSeq++;
  }
  return { ok: true, rows: rows.length, head: prev };
}

/**
 * A chain that verifies on its own can still have lost its last rows, or been rehashed from an edit onwards by
 * someone with write access. An anchor (a row's seq and hash, printed earlier in an audit report or a run log)
 * catches both: that row must still be there, with that hash.
 */
export function checkAnchor(rows: Row[], anchor: { seq: number; hash: string }): { ok: true } | { ok: false; reason: string } {
  const row = rows.find((r) => r.seq === anchor.seq);
  if (!row) return { ok: false, reason: `the log has ${rows.length} rows; the anchor is row ${anchor.seq}` };
  if (row.row_hash !== anchor.hash) return { ok: false, reason: `row ${anchor.seq} has hash ${row.row_hash.slice(0, 12)}…, the anchor says ${anchor.hash.slice(0, 12)}…` };
  return { ok: true };
}
