// One lock and one ledger of money spoken for, for every executor that pays out over Airwallex (Kit 11's invoice
// payments and the supplier payments). A payment reads Airwallex's balances, judges its floor against them and what
// other payments already hold, and holds its own money, all under the lock; so two payments executed at the same time,
// by either executor, never both count the same free money (red team round 3: two Kit 11 payments, or one of each,
// in parallel both broke the EUR floor). In this process: the runner executes the approvals.

import type { DB } from "../db/open.js";

let queue: Promise<unknown> = Promise.resolve();

/** Runs `fn` when every earlier payout step under the lock is done; the next waits for it. */
export function exclusive<T>(fn: () => Promise<T> | T): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.then(() => undefined, () => undefined);
  return run;
}

/** Holds money for a payment being executed (a conversion on its way, a payout not yet written), under its own key. */
export function holdPayout(db: DB, proposalId: string, key: string, currency: string, cents: number): void {
  db.prepare("INSERT INTO payout_reservations (key, proposal_id, currency, cents, status, updated_at) VALUES (?, ?, ?, ?, 'HELD', ?) ON CONFLICT(key) DO UPDATE SET currency = excluded.currency, cents = excluded.cents, status = 'HELD', updated_at = excluded.updated_at")
    .run(key, proposalId, currency, Math.max(0, cents), new Date().toISOString());
}

/** Lets a hold go: the money is now counted elsewhere (a conversion recorded, a payout row written) or never moved. */
export function releasePayout(db: DB, key: string): void {
  db.prepare("UPDATE payout_reservations SET status = 'RELEASED', updated_at = ? WHERE key = ? AND status = 'HELD'").run(new Date().toISOString(), key);
}

/** What executing payments hold in this currency (one payment's own holds can be left out). */
export function heldPayoutCents(db: DB, currency: string, exceptProposalId?: string): number {
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'payout_reservations'").get()) return 0;
  return (db.prepare("SELECT COALESCE(SUM(cents), 0) AS c FROM payout_reservations WHERE status = 'HELD' AND currency = ? AND proposal_id <> ?").get(currency, exceptProposalId ?? "") as { c: number }).c;
}

/**
 * Purser's fees this currency still owes: a fee goes with its payout (application_fee_options), so from the moment the
 * payout is written until Airwallex has it (the row still SUBMITTING) the fee stays spoken for, like the payout itself;
 * once Airwallex has the payout, both have left the available balance it reports. One payment's own fee can be left out.
 */
export function owedPlatformFeeCents(db: DB, currency: string, exceptProposalId?: string): number {
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'platform_fees'").get()) return 0;
  const rows = db.prepare(`SELECT f.amount FROM platform_fees f JOIN transfers t ON t.request_id = f.payout_request_id
    WHERE f.currency = ? AND f.proposal_id <> ? AND f.status = 'DUE' AND t.status = 'SUBMITTING'`)
    .all(currency, exceptProposalId ?? "") as { amount: string }[];
  return rows.reduce((s, r) => s + Math.round(Number(r.amount) * 100), 0);
}
