// One Face ID for many payments (Max, 9 November): a batch is a proposal whose terms are the canonical list of each
// payment's own exact terms, each with its own hash, plus the count and the total per currency (Purser's fees included). The CFO signs the
// batch's hash once. Every line stays its own proposal: its own hash, approval record, checks at execution and
// idempotent payout (src/executors/paymentBatch.ts runs them one by one). Taking a line out supersedes the batch and
// files a new one of the rest, with a new hash, so nothing is ever approved that the CFO did not see in the list.

import { audit, type Actor } from "../audit/log.js";
import type { DB } from "../db/open.js";
import { fromCents, toCents } from "../lib/money.js";
import { canonicalTerms, sha256Hex, termsHash, TERMS_SCHEMA, type Terms } from "../lib/terms.js";
import { createProposal, type ProposalRow } from "./approvals.js";
import { BATCH_KIND, BATCH_MAX_LINES, BATCHABLE, batchesOf, batchLinesOf, openBatchOf, type BatchLine, type BatchTerms } from "./batchLines.js";

export { BATCH_KIND, BATCH_MAX_LINES, BATCHABLE, batchesOf, batchLinesOf, openBatchOf, verifyBatch, type BatchLine, type BatchTerms } from "./batchLines.js";

interface Row { proposal_id: string; kind: string; status: string; terms_json: string; terms_sha256: string; expires_at: string }

const row = (db: DB, id: string) => db.prepare("SELECT proposal_id, kind, status, terms_json, terms_sha256, expires_at FROM proposals WHERE proposal_id = ?").get(id) as Row | undefined;

/** Why this payment cannot go in a new batch now, or null. */
function lineRefusal(db: DB, id: string, now: Date): string | null {
  const p = row(db, id);
  if (!p) return `no proposal ${id}`;
  if (!BATCHABLE.has(p.kind)) return `${id} is a ${p.kind}; a batch holds invoice and supplier payments only`;
  if (p.status !== "PENDING_APPROVAL") return `${id} is ${p.status}, not waiting for approval`;
  if (Date.parse(p.expires_at) <= now.getTime()) return `${id} ran out at ${p.expires_at}`;
  if (termsHash(JSON.parse(p.terms_json) as Terms) !== p.terms_sha256) return `${id}'s stored terms no longer match their hash`;
  const open = openBatchOf(db, id);
  if (open) return `${id} is already in waiting batch ${open}`;
  return null;
}

/** The batch's terms over these payments: lines sorted by proposal id, the count and each currency's total. */
function batchTermsOf(db: DB, ids: string[]): BatchTerms {
  const lines: BatchLine[] = [...ids].sort().map((id) => {
    const p = row(db, id)!;
    return { proposal_id: p.proposal_id, kind: p.kind, terms_sha256: p.terms_sha256, terms: JSON.parse(p.terms_json) as Terms };
  });
  const totals: Record<string, number> = {};
  for (const l of lines) {
    const t = l.terms as { amount?: unknown; currency?: unknown; platform_fee?: { amount?: unknown; currency?: unknown } };
    if (typeof t.amount !== "string" || typeof t.currency !== "string") throw new Error(`${l.proposal_id} has no amount and currency`);
    // What the line takes from that balance as signed: its amount and Purser's fee (red team 6: the total hid the fee).
    const fee = t.platform_fee ? t.platform_fee.amount : "0.00";
    if (typeof fee !== "string" || (t.platform_fee && t.platform_fee.currency !== t.currency)) throw new Error(`${l.proposal_id} has a Purser fee in another currency or without an amount`);
    totals[t.currency] = (totals[t.currency] ?? 0) + toCents(t.amount) + toCents(fee);
  }
  const expires = lines.map((l) => l.terms.expires_at).sort()[0]!;
  return {
    schema: TERMS_SCHEMA, kind: BATCH_KIND, proposal_id: "P-PENDING", expires_at: expires,
    count: String(lines.length),
    totals: Object.fromEntries(Object.keys(totals).sort().map((c) => [c, fromCents(totals[c]!)])),
    test_money: lines.some((l) => (l.terms as { test_money?: unknown }).test_money === true),
    lines,
  };
}

/**
 * Files a batch over these waiting payments. Every line must wait for approval, be a payment a batch may hold, have
 * terms that still hash to their hash and be in no other waiting batch; at least one, at most BATCH_MAX_LINES.
 */
export function createBatch(db: DB, ids: string[], createdBy: Actor, now = new Date()): ProposalRow {
  const unique = [...new Set(ids)];
  if (unique.length !== ids.length) throw new Error("a payment is in the list twice");
  if (unique.length === 0) throw new Error("a batch holds at least one payment");
  if (unique.length > BATCH_MAX_LINES) throw new Error(`a batch holds at most ${BATCH_MAX_LINES} payments; this list has ${unique.length}`);
  for (const id of unique) {
    const why = lineRefusal(db, id, now);
    if (why) throw new Error(why);
  }
  const terms = batchTermsOf(db, unique);
  const batch = createProposal(db, {
    terms, createdBy, assignId: true,
    // Again inside the write lock: no line may have changed or joined another batch since the list was read.
    guard: (tx) => {
      for (const l of terms.lines) {
        const why = lineRefusal(tx, l.proposal_id, now);
        if (why) return why;
        if (row(tx, l.proposal_id)!.terms_sha256 !== l.terms_sha256) return `${l.proposal_id} changed while the batch was made`;
      }
      return null;
    },
  }, now);
  const insert = db.prepare("INSERT INTO batch_lines (batch_id, proposal_id, position, terms_sha256) VALUES (?, ?, ?, ?)");
  db.transaction(() => terms.lines.forEach((l, i) => insert.run(batch.proposal_id, l.proposal_id, i, l.terms_sha256)))();
  audit(db, createdBy, "batch.filed", batch.proposal_id, { terms_sha256: batch.terms_sha256, count: terms.count, totals: terms.totals, lines: terms.lines.map((l) => ({ proposal_id: l.proposal_id, terms_sha256: l.terms_sha256 })) }, now);
  return batch;
}

/** What a passkey signs to take a line out of a waiting batch: bound to the batch's hash and the line's id. */
export function batchRemovalSha256(batchSha256: string, lineId: string): string {
  if (!/^[0-9a-f]{64}$/.test(batchSha256)) throw new Error("a terms hash is 64 lowercase hex characters");
  if (!/^P-\d{4,}$/.test(lineId)) throw new Error("a line is a proposal id like P-0012");
  return sha256Hex(`kit11 batch-remove v1 ${batchSha256} ${lineId}`);
}

/**
 * Takes a line out of a waiting batch (the CFO, on the phone, before signing): the batch is superseded, the line's own
 * proposal is superseded too (its invoice is ready to pay again, on its own or in a later batch), and a new batch of the
 * other lines is filed, with a new hash. Returns the new batch, or null when no line is left.
 */
export function removeBatchLine(db: DB, batchId: string, lineId: string, by: string, now = new Date()): ProposalRow | null {
  const rest = db.transaction((): string[] => {
    const b = row(db, batchId);
    if (!b || b.kind !== BATCH_KIND) throw new Error(`${batchId} is not a batch`);
    if (b.status !== "PENDING_APPROVAL") throw new Error(`${batchId} is ${b.status}, not waiting for approval`);
    const lines = batchLinesOf(db, batchId).map((l) => l.proposal_id);
    if (!lines.includes(lineId)) throw new Error(`${lineId} is not in batch ${batchId}`);
    const sup = db.prepare("UPDATE proposals SET status = 'SUPERSEDED' WHERE proposal_id = ? AND status = 'PENDING_APPROVAL'");
    if (sup.run(batchId).changes !== 1) throw new Error(`${batchId} is no longer waiting`);
    audit(db, "human", "proposal.superseded", batchId, { reason: `${by} took ${lineId} out of the batch`, terms_sha256: b.terms_sha256 }, now);
    if (sup.run(lineId).changes === 1) audit(db, "human", "proposal.superseded", lineId, { reason: `taken out of batch ${batchId} by ${by}; it can be filed again` }, now);
    return lines.filter((id) => id !== lineId);
  }).immediate();
  const waiting = rest.filter((id) => lineRefusal(db, id, now) === null);
  return waiting.length ? createBatch(db, waiting, "treasury", now) : null;
}

/** The proof that one payment was in a signed batch: both canonical texts, so anyone can recompute the two hashes. */
export interface BatchInclusion { batch_id: string; batch_sha256: string; batch_canonical: string; line_id: string; line_sha256: string; line_canonical: string; approved: boolean }

/** The newest batch this payment was in, with what is needed to check it offline; null when it was never batched. */
export function batchInclusion(db: DB, lineId: string): BatchInclusion | null {
  const b = batchesOf(db, lineId)[0];
  const line = row(db, lineId);
  if (!b || !line) return null;
  const batch = row(db, b.batch_id)!;
  const approved = !!db.prepare("SELECT 1 FROM approvals WHERE proposal_id = ? AND decision = 'APPROVED'").get(b.batch_id);
  return {
    batch_id: b.batch_id, batch_sha256: batch.terms_sha256, batch_canonical: canonicalTerms(JSON.parse(batch.terms_json) as Terms),
    line_id: lineId, line_sha256: line.terms_sha256, line_canonical: canonicalTerms(JSON.parse(line.terms_json) as Terms), approved,
  };
}

/** Checks a proof with nothing but the two texts: both hash to what they claim, and the batch lists exactly that line. */
export function verifyBatchInclusion(p: BatchInclusion): { ok: true } | { ok: false; reason: string } {
  if (sha256Hex(p.batch_canonical) !== p.batch_sha256) return { ok: false, reason: "the batch text does not hash to the signed batch hash" };
  if (sha256Hex(p.line_canonical) !== p.line_sha256) return { ok: false, reason: "the payment text does not hash to its hash" };
  const batch = JSON.parse(p.batch_canonical) as BatchTerms;
  if (batch.kind !== BATCH_KIND) return { ok: false, reason: "not a payment batch" };
  const listed = batch.lines.find((l) => l.proposal_id === p.line_id);
  if (!listed || listed.terms_sha256 !== p.line_sha256) return { ok: false, reason: "the batch does not list this payment with this hash" };
  if (canonicalTerms(listed.terms) !== p.line_canonical) return { ok: false, reason: "the batch lists other terms for this payment" };
  return { ok: true };
}
