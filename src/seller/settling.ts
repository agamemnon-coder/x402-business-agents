// A customer's mandate payment between Metal's block and the sale's row (night batch, 2 November 2026).
//
// The seller records a sale after the facilitator's settle answer, and the facilitator answers after the payment's
// block. In that second the chain already counts the payment under the customer's mandate and the ledger does not: in
// 2 of 10 live worlds the dashboard read the ledger just before the row, the chain just after, and showed 0.05–0.06 less
// spent than Metal with no reason given. So the payment is written down before the settle (SETTLING), closed in the
// same transaction as the sale's row (DONE), or when the settle fails (FAILED). A SETTLING row is shown as pending.
//
// It records; it decides nothing: no limit reads it, and a payment is never refused or let through because of it. If
// it cannot be written the settle does not start (the customer is not charged), so a payment never moves unseen.

import type { DB } from "../db/open.js";

/** The ERC-3009 authorization the customer's x402 payment carries. */
export interface Authorization { from?: string; value?: string; nonce?: string }

/** A settlement's key: payer and nonce, as the facilitator's settlement id ends. */
export const settlementKey = (payer: string, nonce: string): string => `${payer.toLowerCase()}:${nonce.toLowerCase()}`;

/** The nonce a facilitator settlement id ends with ("eip155:63825:eip3009:<token>:<from>:<nonce>"). */
export function nonceOfSettlementId(id: string | null | undefined): string | null {
  const last = id?.split(":").at(-1) ?? "";
  return /^0x[0-9a-fA-F]{64}$/.test(last) ? last.toLowerCase() : null;
}

const has = (db: DB): boolean => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'sale_settlements'").get();

/**
 * Before the facilitator settles: the payment is on its way. The same payment again (a retry after a failed settle)
 * opens again; one already recorded stays DONE. Null when the payment carries no authorization (nothing to key).
 */
export function settlementStarted(db: DB, auth: Authorization | undefined, cents: number, now = new Date()): string | null {
  if (!auth?.from || !auth.nonce) return null;
  const key = settlementKey(auth.from, auth.nonce);
  const ts = now.toISOString();
  db.prepare(`INSERT INTO sale_settlements (key, payer, nonce, price_cents, status, started_at, updated_at) VALUES (?, ?, ?, ?, 'SETTLING', ?, ?)
              ON CONFLICT (key) DO UPDATE SET status = 'SETTLING', detail = NULL, started_at = excluded.started_at, updated_at = excluded.updated_at
              WHERE sale_settlements.status = 'FAILED'`).run(key, auth.from.toLowerCase(), auth.nonce.toLowerCase(), cents, ts, ts);
  return key;
}

/** Settled and recorded: call inside the sale row's transaction, so the ledger never counts it twice or not at all. */
export function settlementDone(db: DB, key: string | null, saleId: number, tx: string | null, now = new Date()): void {
  if (!key || !has(db)) return;
  db.prepare("UPDATE sale_settlements SET status = 'DONE', sale_id = ?, tx_hash = ?, detail = NULL, updated_at = ? WHERE key = ?").run(saleId, tx, now.toISOString(), key);
}

/**
 * Settled, but the answer was not the first for this payment: the first one recorded the sale, and this closes the
 * row against it. With no sale under the payment's settlement id the row stays SETTLING (the chain may count it while
 * no sale is recorded), with the reason, so the dashboard keeps showing it as pending rather than lose it.
 */
export function settlementRepeated(db: DB, key: string | null, now = new Date()): void {
  if (!key || !has(db)) return;
  const nonce = key.split(":").at(-1)!;
  const sale = db.prepare("SELECT sale_id, tx_hash FROM sales WHERE lower(settlement_id) LIKE ? ORDER BY sale_id LIMIT 1").get(`%:${nonce}`) as { sale_id: number; tx_hash: string | null } | undefined;
  if (sale) settlementDone(db, key, sale.sale_id, sale.tx_hash, now);
  else db.prepare("UPDATE sale_settlements SET detail = ?, updated_at = ? WHERE key = ? AND status = 'SETTLING'").run("the facilitator reported this payment settled by an earlier answer; no sale is recorded for it", now.toISOString(), key);
}

/**
 * The settle failed. When the facilitator's reason says nothing moved (the buyer side's own rule, nothingSettled), the
 * row is FAILED. Otherwise (a lost answer, an error with no such reason) the payment may be on chain: the row stays
 * SETTLING with the reason, and keeps showing as pending until the chain check or a person resolves it.
 */
export function settlementFailed(db: DB, key: string | null, reason: string, nothingMoved: boolean, now = new Date()): void {
  if (!key || !has(db)) return;
  if (nothingMoved) db.prepare("UPDATE sale_settlements SET status = 'FAILED', detail = ?, updated_at = ? WHERE key = ? AND status = 'SETTLING'").run(reason.slice(0, 300), now.toISOString(), key);
  else db.prepare("UPDATE sale_settlements SET detail = ?, updated_at = ? WHERE key = ? AND status = 'SETTLING'").run(`outcome unknown, it may have settled: ${reason}`.slice(0, 300), now.toISOString(), key);
}
