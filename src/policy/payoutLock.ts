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
