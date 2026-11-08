// Stock for goods at weighted average cost (bookkeeping core, decision 6). Buying goods is a purchase invoice on the
// stock account (1700) plus a stock move; selling takes the average cost of what is on hand into cost of goods sold
// (8000). The last unit takes exactly what is left, so the value never drifts from the quantity. Selling more than is
// on hand is refused. Stock moves, like the ledger, are only ever added.

import type { DB } from "../db/open.js";
import { COST_OF_GOODS_SOLD, STOCK } from "./accounts.js";
import { LedgerRefused, postEntry, type Posted } from "./core.js";
import { purchaseInvoice } from "./documents.js";

export interface GoodsPurchase {
  sku: string;
  name: string;
  qty: number;
  net_cents: number;
  vat_code: string;
  supplier: string;
  doc_ref: string;
  doc_sha256?: string;
  date: string;
  due_date: string;
  currency: string;
  created_by: string;
}

function onHand(db: DB, sku: string): { qty: number; value: number } {
  return db.prepare("SELECT COALESCE(SUM(qty_delta), 0) AS qty, COALESCE(SUM(value_delta_cents), 0) AS value FROM stock_moves WHERE sku = ?").get(sku) as { qty: number; value: number };
}

export function buyGoods(db: DB, g: GoodsPurchase, now = new Date()): Posted {
  if (!Number.isInteger(g.qty) || g.qty <= 0) throw new LedgerRefused("a quantity is a whole number above zero");
  if (!Number.isInteger(g.net_cents) || g.net_cents <= 0) throw new LedgerRefused("goods are bought for an amount above zero");
  return db.transaction((): Posted => {
    const item = db.prepare("SELECT currency FROM stock_items WHERE sku = ?").get(g.sku) as { currency: string } | undefined;
    if (item && item.currency !== g.currency) throw new LedgerRefused(`${g.sku} is kept in ${item.currency}, not ${g.currency}`);
    if (!item) db.prepare("INSERT INTO stock_items (sku, name, currency) VALUES (?, ?, ?)").run(g.sku, g.name, g.currency);
    const posted = purchaseInvoice(db, {
      date: g.date, supplier: g.supplier, doc_ref: g.doc_ref, doc_sha256: g.doc_sha256, due_date: g.due_date, currency: g.currency, created_by: g.created_by,
      lines: [{ account: STOCK, net_cents: g.net_cents, vat_code: g.vat_code, memo: `${g.qty} x ${g.sku}` }],
    }, now);
    if (!posted.duplicate) db.prepare("INSERT INTO stock_moves (sku, qty_delta, value_delta_cents, entry_id, at) VALUES (?, ?, ?, ?, ?)").run(g.sku, g.qty, g.net_cents, posted.entry_id, now.toISOString());
    return posted;
  }).immediate();
}

export function sellGoods(db: DB, s: { sku: string; qty: number; date: string; doc_ref: string; created_by: string }, now = new Date()): Posted & { cost_cents: number } {
  if (!Number.isInteger(s.qty) || s.qty <= 0) throw new LedgerRefused("a quantity is a whole number above zero");
  return db.transaction(() => {
    const item = db.prepare("SELECT currency FROM stock_items WHERE sku = ?").get(s.sku) as { currency: string } | undefined;
    if (!item) throw new LedgerRefused(`no stock item ${s.sku}`);
    const key = `cogs:${s.sku}:${s.doc_ref}`;
    const had = db.prepare("SELECT e.entry_id, e.posting_date, l.debit_cents FROM ledger_entries e JOIN ledger_lines l ON l.entry_id = e.entry_id AND l.account = ? WHERE e.source_key = ?")
      .get(COST_OF_GOODS_SOLD, key) as { entry_id: number; posting_date: string; debit_cents: number } | undefined;
    if (had) return { entry_id: had.entry_id, posting_date: had.posting_date, duplicate: true, cost_cents: had.debit_cents };
    const h = onHand(db, s.sku);
    if (s.qty > h.qty) throw new LedgerRefused(`${s.qty} x ${s.sku} asked, ${h.qty} on hand`);
    const cost = s.qty === h.qty ? h.value : Math.round((h.value * s.qty) / h.qty);
    const posted = postEntry(db, {
      date: s.date, description: `Cost of ${s.qty} x ${s.sku} sold (${s.doc_ref})`, created_by: s.created_by, source_key: key, doc_ref: s.doc_ref,
      lines: [{ account: COST_OF_GOODS_SOLD, debit: cost, currency: item.currency, memo: `${s.qty} x ${s.sku} at average cost` }, { account: STOCK, credit: cost, currency: item.currency }],
    }, now);
    db.prepare("INSERT INTO stock_moves (sku, qty_delta, value_delta_cents, entry_id, at) VALUES (?, ?, ?, ?, ?)").run(s.sku, -s.qty, -cost, posted.entry_id, now.toISOString());
    return { ...posted, cost_cents: cost };
  }).immediate();
}

export function stockOnHand(db: DB): { sku: string; name: string; currency: string; qty: number; value_cents: number; average_cents: number }[] {
  return (db.prepare(`SELECT i.sku, i.name, i.currency, COALESCE(SUM(m.qty_delta), 0) AS qty, COALESCE(SUM(m.value_delta_cents), 0) AS value_cents
    FROM stock_items i LEFT JOIN stock_moves m ON m.sku = i.sku GROUP BY i.sku ORDER BY i.sku`).all() as { sku: string; name: string; currency: string; qty: number; value_cents: number }[])
    .map((r) => ({ ...r, average_cents: r.qty ? Math.round(r.value_cents / r.qty) : 0 }));
}
