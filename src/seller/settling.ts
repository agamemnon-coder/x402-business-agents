// A customer's mandate payment between Metal's block and the sale's row (night batch, 2 November 2026).
//
// The seller records a sale after the facilitator's settle answer, and the facilitator answers after the payment's
// block. In that second the chain already counts the payment under the customer's mandate and the ledger does not: in
// 2 of 10 live worlds the dashboard read the ledger just before the row, the chain just after, and showed 0.05–0.06 less
// spent than Metal with no reason given. So the payment is written down before the settle (SETTLING), closed in the
// same transaction as the sale's row (DONE), or when the facilitator says nothing moved (FAILED). A SETTLING row is
// shown as pending; one that stays SETTLING (a lost answer, a row that could not be written) is named by the chain
// check once it is older than a settle takes (src/metal/dashboardVsChain.ts), never passed as "on its way" for good.
//
// It records; it decides nothing: no limit reads it, and a payment is never refused or let through because of it. If
// it cannot be written the settle does not start (the customer is not charged), so a payment never moves unseen.

import type { DB } from "../db/open.js";

/** The ERC-3009 authorization the customer's x402 payment carries. */
export interface Authorization { from?: string; value?: string; nonce?: string }

/** A settlement's key: payer and nonce, as the facilitator's settlement id ends. */
export const settlementKey = (payer: string, nonce: string): string => `${payer.toLowerCase()}:${nonce.toLowerCase()}`;

/** The key of the payment an authorization carries; null without one (nothing to key). */
export const keyOf = (auth: Authorization | undefined): string | null => (auth?.from && auth.nonce ? settlementKey(auth.from, auth.nonce) : null);

/**
 * Before the facilitator settles: the payment is on its way. The same payment again (a retry after a refused settle,
 * or a replay) opens it again and counts one more settle waiting; one already recorded stays DONE.
 */
export function settlementStarted(db: DB, auth: Authorization | undefined, cents: number, now = new Date()): string | null {
  const key = keyOf(auth);
  if (!key) return null;
  const ts = now.toISOString();
  db.prepare(`INSERT INTO sale_settlements (key, payer, nonce, price_cents, status, inflight, started_at, updated_at) VALUES (?, ?, ?, ?, 'SETTLING', 1, ?, ?)
              ON CONFLICT (key) DO UPDATE SET inflight = sale_settlements.inflight + 1, updated_at = excluded.updated_at,
                status = CASE sale_settlements.status WHEN 'FAILED' THEN 'SETTLING' ELSE sale_settlements.status END,
                detail = CASE sale_settlements.status WHEN 'FAILED' THEN NULL ELSE sale_settlements.detail END,
                started_at = CASE sale_settlements.status WHEN 'FAILED' THEN excluded.started_at ELSE sale_settlements.started_at END`)
    .run(key, auth!.from!.toLowerCase(), auth!.nonce!.toLowerCase(), cents, ts, ts);
  return key;
}

/** Settled and recorded: call inside the sale row's transaction, so the ledger never counts it twice or not at all. */
export function settlementDone(db: DB, key: string | null, saleId: number, tx: string | null, now = new Date()): void {
  if (!key) return;
  db.prepare("UPDATE sale_settlements SET status = 'DONE', inflight = MAX(inflight - 1, 0), sale_id = ?, tx_hash = ?, detail = NULL, updated_at = ? WHERE key = ?").run(saleId, tx, now.toISOString(), key);
}

/**
 * Settled, but the answer was not the first for this payment: the first one recorded the sale, and this closes the
 * row against it. With no sale under the payment's settlement id the row stays SETTLING (the chain may count it while
 * no sale is recorded), with the reason, so the dashboard keeps showing it and the chain check names it.
 */
export function settlementRepeated(db: DB, key: string | null, now = new Date()): void {
  if (!key) return;
  const nonce = key.split(":").at(-1)!;
  const sale = db.prepare("SELECT sale_id, tx_hash FROM sales WHERE lower(settlement_id) LIKE ? ORDER BY sale_id LIMIT 1").get(`%:${nonce}`) as { sale_id: number; tx_hash: string | null } | undefined;
  if (sale) settlementDone(db, key, sale.sale_id, sale.tx_hash, now);
  else db.prepare("UPDATE sale_settlements SET inflight = MAX(inflight - 1, 0), detail = ?, updated_at = ? WHERE key = ? AND status = 'SETTLING'").run("the facilitator reported this payment settled by an earlier answer; no sale is recorded for it", now.toISOString(), key);
}

/**
 * The settle failed. When the facilitator's reason says nothing moved (the buyer side's own rule, nothingSettled) and
 * no other settle of the same payment is still waiting, the row is FAILED. Otherwise (a lost answer, an error with no
 * such reason, a replay still in flight) the payment may be on chain: the row stays SETTLING, with the reason.
 */
export function settlementFailed(db: DB, key: string | null, reason: string, nothingMoved: boolean, now = new Date()): void {
  if (!key) return;
  const ts = now.toISOString();
  db.prepare("UPDATE sale_settlements SET inflight = MAX(inflight - 1, 0), updated_at = ? WHERE key = ? AND status = 'SETTLING'").run(ts, key);
  if (nothingMoved) db.prepare("UPDATE sale_settlements SET status = 'FAILED', detail = ? WHERE key = ? AND status = 'SETTLING' AND inflight = 0").run(reason.slice(0, 300), key);
  else db.prepare("UPDATE sale_settlements SET detail = ? WHERE key = ? AND status = 'SETTLING'").run(`outcome unknown, it may have settled: ${reason}`.slice(0, 300), key);
}
