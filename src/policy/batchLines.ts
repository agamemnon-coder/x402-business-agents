// A payment batch's lines, read and checked (no dependency on approvals.ts, which calls these from decide()). A batch is
// a proposal of kind payment_batch; its signed terms list each line's own payment proposal, that proposal's exact terms
// and their hash. The CFO signs the batch's hash once; each line keeps its own hash, approval and executor.

import type { DB } from "../db/open.js";
import { termsHash, type Terms } from "../lib/terms.js";

export const BATCH_KIND = "payment_batch";
/** The most lines one batch may hold: the phone lists every line, and the CFO should be able to read them all. */
export const BATCH_MAX_LINES = 50;
/** The payments a batch may hold. */
export const BATCHABLE = new Set(["invoice_payment", "supplier_payment"]);

export type BatchLine = { proposal_id: string; kind: string; terms_sha256: string; terms: Terms } & { [k: string]: Terms | string };
export interface BatchTerms extends Terms { count: string; totals: Record<string, string>; lines: BatchLine[] }

interface Row { proposal_id: string; kind: string; status: string; terms_json: string; terms_sha256: string; expires_at: string }

/** The lines of a batch, in their signed order. */
export function batchLinesOf(db: DB, batchId: string): { proposal_id: string; terms_sha256: string; position: number }[] {
  return db.prepare("SELECT proposal_id, terms_sha256, position FROM batch_lines WHERE batch_id = ? ORDER BY position").all(batchId) as { proposal_id: string; terms_sha256: string; position: number }[];
}

/** The waiting batch a payment is in, or null. A line is approved or rejected only with its batch while it waits. */
export function openBatchOf(db: DB, proposalId: string): string | null {
  const r = db.prepare(`SELECT b.batch_id FROM batch_lines b JOIN proposals p ON p.proposal_id = b.batch_id
    WHERE b.proposal_id = ? AND p.status = 'PENDING_APPROVAL' ORDER BY b.batch_id DESC LIMIT 1`).get(proposalId) as { batch_id: string } | undefined;
  return r?.batch_id ?? null;
}

/** Every batch a payment was ever in (newest first), for the invoice page and the proof. */
export function batchesOf(db: DB, proposalId: string): { batch_id: string; status: string }[] {
  return db.prepare(`SELECT b.batch_id, p.status FROM batch_lines b JOIN proposals p ON p.proposal_id = b.batch_id
    WHERE b.proposal_id = ? ORDER BY p.created_at DESC, b.batch_id DESC`).all(proposalId) as { batch_id: string; status: string }[];
}

/**
 * Checks, before a batch is approved, that what the CFO signed is exactly what will run: the batch's stored terms still
 * hash to its hash; its lines are the rows filed with it, in order; each line's embedded terms hash to the line's hash;
 * and each line's own proposal still has those terms (stored terms that hash to them), waits for approval and has not
 * run out. Throws on the first difference: one changed line refuses the whole batch.
 */
export function verifyBatch(db: DB, batch: Row, now: Date): BatchTerms {
  const t = JSON.parse(batch.terms_json) as BatchTerms;
  if (termsHash(t) !== batch.terms_sha256) throw new Error(`${batch.proposal_id}: the batch's stored terms no longer match their hash`);
  const filed = batchLinesOf(db, batch.proposal_id);
  if (!Array.isArray(t.lines) || t.lines.length !== filed.length || t.count !== String(filed.length)) throw new Error(`${batch.proposal_id}: its lines no longer match the batch filed`);
  t.lines.forEach((l, i) => {
    const f = filed[i]!;
    if (l.proposal_id !== f.proposal_id || l.terms_sha256 !== f.terms_sha256) throw new Error(`${batch.proposal_id}: line ${i + 1} no longer matches the batch filed`);
    if (termsHash(l.terms) !== l.terms_sha256) throw new Error(`${batch.proposal_id}: line ${l.proposal_id}'s terms no longer match their hash`);
    const p = db.prepare("SELECT proposal_id, kind, status, terms_json, terms_sha256, expires_at FROM proposals WHERE proposal_id = ?").get(l.proposal_id) as Row | undefined;
    if (!p) throw new Error(`${batch.proposal_id}: line ${l.proposal_id} is gone`);
    if (p.terms_sha256 !== l.terms_sha256 || termsHash(JSON.parse(p.terms_json) as Terms) !== l.terms_sha256) throw new Error(`${batch.proposal_id}: line ${l.proposal_id}'s stored terms no longer match the terms signed in the batch`);
    if (!BATCHABLE.has(p.kind) || p.kind !== l.kind) throw new Error(`${batch.proposal_id}: line ${l.proposal_id} is not a payment a batch may hold`);
    if (p.status !== "PENDING_APPROVAL") throw new Error(`${batch.proposal_id}: line ${l.proposal_id} is ${p.status}, not waiting for approval`);
    if (Date.parse(p.expires_at) <= now.getTime()) throw new Error(`${batch.proposal_id}: line ${l.proposal_id} ran out at ${p.expires_at}`);
  });
  return t;
}
