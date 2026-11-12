// The two hash chains the runner keeps, recomputed in the cloud on every push with the runner's own formulas:
//   audit row:    row_hash   = SHA-256(prev_hash ‖ jcs({seq, ts, actor, event, subject, payload}))   (src/audit/log.ts)
//   ledger entry: entry_hash = SHA-256(prev_hash ‖ jcs(entry without prev_hash and entry_hash))       (src/ledger/core.ts)
// test/cloud-sync.test.ts holds both to rows the runner itself wrote, so the formulas cannot drift apart.

import { jcs, type Json } from "@metalntwx/metal-pay/mandates";
import { sha256Hex } from "./crypto.js";

export const GENESIS = "0".repeat(64);

export interface AuditRowIn { seq: number; ts: string; actor: string; event: string; subject: string | null; payload_json: string; prev_hash: string; row_hash: string }

export async function auditRowHash(r: AuditRowIn): Promise<string> {
  return sha256Hex(r.prev_hash + jcs({ seq: r.seq, ts: r.ts, actor: r.actor, event: r.event, subject: r.subject, payload: JSON.parse(r.payload_json) as Json }));
}

export interface LedgerLineIn {
  line_no: number; account: string; debit_cents: number; credit_cents: number; currency: string; cost_centre: string | null;
  vat_code: string | null; vat_cents: number | null; party: string | null; due_date: string | null; doc_ref: string | null; memo: string | null;
}
export interface LedgerEntryIn {
  entry_id: number; posting_date: string; doc_date: string; description: string; source_key: string | null; doc_ref: string | null; doc_sha256: string | null;
  created_by: string; reverses: number | null; created_at: string; prev_hash: string; entry_hash: string; lines: LedgerLineIn[];
}

export async function ledgerEntryHash(e: LedgerEntryIn): Promise<string> {
  const body: Partial<LedgerEntryIn> = { ...e };
  delete body.prev_hash;
  delete body.entry_hash;
  return sha256Hex(e.prev_hash + jcs(body as unknown as Json));
}

/** A run of links continuing a chain: sequence numbers one after another from `from`, each linked to the one before. */
export async function continues<T extends { prev_hash: string }>(rows: T[], head: { n: number; hash: string }, n: (r: T) => number, own: (r: T) => string, recompute: (r: T) => Promise<string>): Promise<string | null> {
  let expectN = head.n + 1;
  let prev = head.hash;
  for (const r of rows) {
    if (n(r) !== expectN) return `expected number ${expectN}, got ${n(r)}`;
    if (r.prev_hash !== prev) return `number ${n(r)} does not link to the one before it`;
    if ((await recompute(r)) !== own(r)) return `number ${n(r)}'s hash does not match its content`;
    prev = own(r);
    expectN += 1;
  }
  return null;
}
