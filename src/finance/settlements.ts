// Customer payments left "being settled" (review of dashboard-chain, 2 November). The seller writes a payment down
// before Metal's facilitator settles it and closes it when the sale is recorded or the settle is refused
// (src/seller/settling.ts). A crash between the settle and the sale's row, or a lost answer, leaves the row SETTLING:
// shown as pending for good, and if the payment did move, the customer was charged with no sale in the ledger.
//
// This resolves each row older than a settle can take, from what the ledger and the facilitator know, read-only towards
// both outside systems:
//   - its sale is recorded after all (the row could not be closed): DONE;
//   - the facilitator's list of what settled to Northwind has it: CHARGED. The customer paid and the ledger holds no
//     delivery for it. Whether the stock check reached the customer cannot be known from here (a crash before the answer
//     went out: not served; an answer the facilitator repeated: perhaps served), so it is not written as a sale. It counts
//     as paid under the customer's mandate, as on chain, and it goes to the CFO as owed back unless a person finds it was
//     delivered: an alarm (reconcile.difference) and a line on the dashboard. Nothing is refunded automatically.
//   - the facilitator has no such settlement: FAILED, nothing moved (the chain check would name it if it had).
// Each outcome is an audit row (sale.settlement_resolved). No limit reads any of this.

import { audit } from "../audit/log.js";
import type { DB } from "../db/open.js";
import { fromCents } from "../lib/money.js";
import { redactSecrets } from "../lib/redact.js";

/** A row SETTLING for longer than this is looked up (a settle takes seconds; the chain check allows 5 minutes). */
export const RESOLVE_AFTER_MS = 10 * 60_000;

/** The facilitator's settlement of a payment to `payTo` with this nonce, settled since `sinceMs`; undefined when none. */
export type SettlementLookup = (payTo: string, nonce: string, sinceMs: number) => Promise<{ transaction: string; amount: string } | undefined>;

export type ResolvedSettlement = { key: string; outcome: "DONE" | "CHARGED" | "FAILED"; cents: number; tx: string | null; sale_id: number | null };

export interface SettlementResolution { resolved: ResolvedSettlement[]; open: number; skipped: string | null }

const has = (db: DB) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'sale_settlements'").get();

/** Whole cents of a settled amount (base units, 18 decimals); null when it is not a whole number of cents. */
function cents(amount: string): number | null {
  try {
    const u = BigInt(amount);
    return u > 0n && u % 10n ** 16n === 0n ? Number(u / 10n ** 16n) : null;
  } catch {
    return null;
  }
}

export async function resolveSettlements(db: DB, lookup: SettlementLookup | undefined, now = new Date()): Promise<SettlementResolution> {
  if (!has(db)) return { resolved: [], open: 0, skipped: null };
  const cutoff = new Date(now.getTime() - RESOLVE_AFTER_MS).toISOString();
  const rows = db.prepare("SELECT key, nonce, price_cents, started_at FROM sale_settlements WHERE status = 'SETTLING' AND started_at <= ? ORDER BY started_at").all(cutoff) as { key: string; nonce: string; price_cents: number; started_at: string }[];
  const business = (db.prepare("SELECT address FROM metal_accounts WHERE role = 'business'").get() as { address: string } | undefined)?.address ?? null;
  const resolved: ResolvedSettlement[] = [];
  let open = 0;
  let skipped: string | null = null;
  const ts = now.toISOString();
  const close = (r: (typeof rows)[number], outcome: ResolvedSettlement["outcome"], c: number, tx: string | null, saleId: number | null, detail: string) => {
    db.transaction(() => {
      const n = db.prepare("UPDATE sale_settlements SET status = ?, price_cents = ?, tx_hash = ?, sale_id = ?, detail = ?, updated_at = ? WHERE key = ? AND status = 'SETTLING'")
        .run(outcome, c, tx, saleId, detail.slice(0, 300), ts, r.key).changes;
      if (n !== 1) return;
      audit(db, "system", "sale.settlement_resolved", r.key, { outcome, amount: fromCents(c), tx, sale_id: saleId, since: r.started_at, detail }, now);
      if (outcome === "CHARGED") {
        audit(db, "system", "reconcile.difference", r.key, { area: "metal", ref: r.key, ledger: `no sale for a customer payment of ${fromCents(c)} USDZ settling since ${r.started_at}`, outside: `the facilitator settled it in ${tx ?? "an unknown transaction"}: the customer was charged with no delivery recorded; owed back unless a person finds it was delivered` }, now);
      }
      resolved.push({ key: r.key, outcome, cents: c, tx, sale_id: saleId });
    }).immediate();
  };
  for (const r of rows) {
    // The sale is recorded after all: its row was written, closing the settlement was not.
    const sale = db.prepare("SELECT sale_id, tx_hash FROM sales WHERE status = 'DELIVERED' AND lower(settlement_id) LIKE ? ORDER BY sale_id LIMIT 1").get(`%:${r.nonce.toLowerCase()}`) as { sale_id: number; tx_hash: string | null } | undefined;
    if (sale) {
      close(r, "DONE", r.price_cents, sale.tx_hash, sale.sale_id, "its sale is recorded; the settlement row was closed by the reconciliation");
      continue;
    }
    if (!lookup || !business) {
      skipped = !lookup ? "settlements left open (no facilitator look-up configured)" : "settlements left open (the ledger does not know the business account)";
      open++;
      continue;
    }
    let found: Awaited<ReturnType<SettlementLookup>>;
    try {
      found = await lookup(business, r.nonce, Date.parse(r.started_at) - RESOLVE_AFTER_MS);
    } catch (e) {
      skipped = `settlements left open (the facilitator could not be asked: ${redactSecrets((e as Error).message.split("\n")[0]!).slice(0, 120)})`;
      open++;
      continue;
    }
    if (found) {
      close(r, "CHARGED", cents(found.amount) ?? r.price_cents, found.transaction.toLowerCase(), null,
        `settled at the facilitator in ${found.transaction}, with no sale recorded: charged, no delivery recorded; owed back unless a person finds it was delivered`);
    } else {
      close(r, "FAILED", r.price_cents, null, null, `the facilitator has no settlement for it ${Math.round((now.getTime() - Date.parse(r.started_at)) / 60_000)} min after its settle began: nothing moved`);
    }
  }
  return { resolved, open, skipped };
}
