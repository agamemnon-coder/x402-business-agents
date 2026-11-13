// The read API: everything the company's apps, its accountant and its ERP connectors ask for, as JSON. Reports are
// computed by the same functions the runner uses (src/ledger/reports.ts), over the cloud's copy of the ledger.

import { ageingFrom, balanceSheetFrom, isClosingKey, profitAndLossFrom, quarterRange, trialFrom, vatOverviewFrom, type PostedLine } from "../../src/ledger/reports.js";
import { totalsOf, type TxRow } from "../../src/money/registerShape.js";
import type { Cond, TenantDb, Where } from "./tenant.js";

export class BadRequest extends Error {}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const day = (v: string | null, what: string): string | null => {
  if (v === null || v === "") return null;
  if (!DAY.test(v)) throw new BadRequest(`${what} must be a day like 2026-11-30`);
  return v;
};

export interface Page<T> { items: T[]; next_cursor: string | null }

/** Cursor pagination over a sortable key: the cursor is the last key of the page before. */
export async function paged<T extends Record<string, unknown>>(db: TenantDb, table: Parameters<TenantDb["select"]>[0], key: string, where: Where, q: URLSearchParams, shape: (r: T) => unknown): Promise<Page<unknown>> {
  const limit = Math.max(1, Math.min(200, Number(q.get("limit") ?? 50) || 50));
  const cursor = q.get("cursor");
  const w: Where = { ...where, ...(cursor ? { [key]: { op: ">", v: cursor } as Cond } : {}) };
  const rows = await db.select<T>(table, w, { order: [key], limit: limit + 1 });
  const more = rows.length > limit;
  const items = rows.slice(0, limit);
  return { items: items.map(shape), next_cursor: more ? String(items[items.length - 1]![key]) : null };
}

const parse = (r: { body_json: string }) => JSON.parse(r.body_json) as Record<string, unknown>;

export async function listInvoices(db: TenantDb, q: URLSearchParams): Promise<Page<unknown>> {
  const where: Where = {};
  const status = q.get("status");
  if (status) {
    if (!/^[a-z_]{2,40}$/.test(status)) throw new BadRequest("status is a word like ready or paid");
    where.status = status;
  }
  const from = day(q.get("due_from"), "due_from");
  const to = day(q.get("due_to"), "due_to");
  // Two bounds on one column: filtered after the read, inside the page's own window.
  if (from) where.due_date = { op: ">=", v: from };
  const page = await paged<{ id: string; version: number; body_json: string; due_date: string }>(db, "invoices", "id", where, q, (r) => ({ ...parse(r), id: r.id, version: r.version }));
  if (to) page.items = page.items.filter((i) => String((i as { due_date?: string }).due_date ?? "") <= to);
  return page;
}

export async function oneInvoice(db: TenantDb, id: string): Promise<unknown | null> {
  const r = await db.one<{ id: string; version: number; body_json: string }>("invoices", { id });
  if (!r) return null;
  const history = await db.select<{ version: number; replaced_at: string }>("object_history", { kind: "invoice", id }, { order: ["version"] });
  return { ...parse(r), id: r.id, version: r.version, earlier_versions: history.map((h) => ({ version: h.version, replaced_at: h.replaced_at })) };
}

export async function invoiceDocument(db: TenantDb, id: string): Promise<{ blob_key: string; filename: string; mime: string } | null> {
  const inv = await db.one<{ doc_sha256: string }>("invoices", { id });
  if (!inv) return null;
  return db.one<{ blob_key: string; filename: string; mime: string }>("documents", { sha256: inv.doc_sha256 });
}

export async function listVendors(db: TenantDb, q: URLSearchParams): Promise<Page<unknown>> {
  return paged<{ id: string; version: number; body_json: string }>(db, "vendors", "id", {}, q, (r) => ({ ...parse(r), id: r.id, version: r.version }));
}

export async function listPayments(db: TenantDb, q: URLSearchParams): Promise<Page<unknown>> {
  return paged<{ id: string; version: number; body_json: string }>(db, "payments", "id", {}, q, (r) => ({ ...parse(r), id: r.id, version: r.version }));
}

export async function ledgerEntries(db: TenantDb, q: URLSearchParams): Promise<Page<unknown>> {
  const from = day(q.get("from"), "from");
  const to = day(q.get("to"), "to");
  const limit = Math.max(1, Math.min(200, Number(q.get("limit") ?? 50) || 50));
  // The date bounds are in the query (red team round 4: filtered after a 1,000-entry window, a window with nothing in
  // range ended the list early with no cursor, and later entries were never returned).
  const cursor = Number(q.get("cursor") ?? 0) || 0;
  const where: Where = { entry_id: { op: ">", v: cursor } };
  const rows = await db.select<{ entry_id: number; posting_date: string; entry_json: string }>("ledger_entries", where, { order: ["entry_id"], limit: 1000 });
  const fit: typeof rows = [];
  let last = cursor;
  for (let page = rows; ;) {
    for (const r of page) { last = r.entry_id; if ((!from || r.posting_date >= from) && (!to || r.posting_date <= to)) { fit.push(r); if (fit.length > limit) break; } }
    if (fit.length > limit || page.length < 1000) break;
    page = await db.select<{ entry_id: number; posting_date: string; entry_json: string }>("ledger_entries", { entry_id: { op: ">", v: last } }, { order: ["entry_id"], limit: 1000 });
  }
  const items = fit.slice(0, limit);
  const more = fit.length > limit;
  return { items: items.map((r) => JSON.parse(r.entry_json) as unknown), next_cursor: more ? String(items[items.length - 1]!.entry_id) : null };
}

async function lines(db: TenantDb): Promise<PostedLine[]> {
  const all = await db.select<PostedLine & { entry_id: number }>("ledger_lines", {}, { order: ["entry_id", "line_no"] });
  // A year close's lines are marked as the runner marks them, so P&L and VAT leave them out here too.
  const entries = await db.select<{ entry_id: number; entry_json: string }>("ledger_entries", {}, { order: ["entry_id"] });
  const closing = new Set(entries.filter((e) => isClosingKey((JSON.parse(e.entry_json) as { source_key?: string | null }).source_key)).map((e) => e.entry_id));
  return all.map((l) => ({ ...l, closing: closing.has(l.entry_id) }));
}

export async function report(db: TenantDb, name: string, q: URLSearchParams, now: Date = new Date()): Promise<unknown> {
  const all = await lines(db);
  const today = now.toISOString().slice(0, 10);
  switch (name) {
    case "trial": return { to: day(q.get("to"), "to") ?? today, rows: trialFrom(all, day(q.get("to"), "to") ?? undefined) };
    case "pnl": {
      const from = day(q.get("from"), "from") ?? `${today.slice(0, 4)}-01-01`;
      const to = day(q.get("to"), "to") ?? today;
      return { from, to, by_currency: profitAndLossFrom(all, { from, to }) };
    }
    case "balance": { const to = day(q.get("to"), "to") ?? today; return { to, by_currency: balanceSheetFrom(all, to) }; }
    case "vat": {
      const quarter = q.get("quarter") ?? "";
      try { quarterRange(quarter); } catch (e) { throw new BadRequest((e as Error).message); }
      return vatOverviewFrom(all, quarter);
    }
    case "payables": return ageingFrom(all, "payables", day(q.get("as_of"), "as_of") ?? today);
    case "receivables": return ageingFrom(all, "receivables", day(q.get("as_of"), "as_of") ?? today);
    default: throw new BadRequest(`no report ${name}`);
  }
}

/** The payables picture from the cloud's invoices: open per currency, due soon, overdue, blocked, spend per supplier. */
export async function insights(db: TenantDb, now: Date): Promise<unknown> {
  const rows = (await db.select<{ body_json: string; status: string; currency: string; total: string; due_date: string; vendor: string; updated_at: string }>("invoices", {}, { order: ["id"] }));
  const today = now.toISOString().slice(0, 10);
  const plus = (d: number) => new Date(now.getTime() + d * 86_400_000).toISOString().slice(0, 10);
  const cents = (t: string) => (/^\d+\.\d{2}$/.test(t) ? Math.round(Number(t) * 100) : 0);
  // A credit note is never open to pay: it is set against the same supplier's open invoices in its currency (down to
  // zero), shown as its own line (src/ap/credits.ts does the same on the runner).
  const isCredit = (r: (typeof rows)[number]) => (JSON.parse(r.body_json) as { doc_kind?: string }).doc_kind === "credit_note";
  // Only a credit note a person accepted on the runner counts (red team round 4: an unverified one zeroed what was open).
  const accepted = (r: (typeof rows)[number]) => !!(JSON.parse(r.body_json) as { credit_accepted_at?: unknown }).credit_accepted_at;
  const open = rows.filter((r) => !isCredit(r) && !["paid", "rejected", "blocked"].includes(r.status));
  const sum = (rs: typeof rows) => rs.reduce<Record<string, number>>((m, r) => ({ ...m, [r.currency]: (m[r.currency] ?? 0) + cents(r.total) }), {});
  const owed = new Map<string, number>();
  for (const r of open) owed.set(`${r.vendor.toLowerCase()}|${r.currency}`, (owed.get(`${r.vendor.toLowerCase()}|${r.currency}`) ?? 0) + cents(r.total));
  const credit = new Map<string, number>();
  for (const r of rows.filter((x) => isCredit(x) && accepted(x) && !["rejected", "blocked"].includes(x.status))) credit.set(`${r.vendor.toLowerCase()}|${r.currency}`, (credit.get(`${r.vendor.toLowerCase()}|${r.currency}`) ?? 0) + cents(r.total));
  const credits: Record<string, number> = {};
  for (const [k, c] of credit) { const used = Math.min(c, owed.get(k) ?? 0); const cur = k.slice(k.lastIndexOf("|") + 1); if (used > 0) credits[cur] = (credits[cur] ?? 0) + used; }
  const openNet = Object.fromEntries(Object.entries(sum(open)).map(([cur, v]) => [cur, v - (credits[cur] ?? 0)]));
  const blocked: Record<string, number> = {};
  for (const r of rows.filter((x) => x.status === "blocked")) {
    const findings = (JSON.parse(r.body_json) as { findings?: { code: string; level: string }[] }).findings ?? [];
    for (const f of findings.filter((x) => x.level === "block")) blocked[f.code] = (blocked[f.code] ?? 0) + 1;
  }
  const since = plus(-90);
  const spend: Record<string, Record<string, number>> = {};
  for (const r of rows.filter((x) => x.status === "paid" && x.updated_at.slice(0, 10) >= since)) {
    const v = (spend[r.vendor] ??= {});
    v[r.currency] = (v[r.currency] ?? 0) + cents(r.total);
  }
  return {
    as_of: today,
    open_cents: sum(open),
    credits_cents: credits,
    open_net_cents: openNet,
    due_7_days_cents: sum(open.filter((r) => r.due_date >= today && r.due_date <= plus(7))),
    due_30_days_cents: sum(open.filter((r) => r.due_date >= today && r.due_date <= plus(30))),
    overdue_cents: sum(open.filter((r) => r.due_date && r.due_date < today)),
    waiting: { for_cfo: rows.filter((r) => r.status === "waiting_cfo").length, for_supplier_check: rows.filter((r) => r.status === "needs_vendor").length, for_a_person: rows.filter((r) => r.status === "needs_review").length },
    blocked_by_reason: blocked,
    spend_90_days_cents: spend,
  };
}

// The transactions register (src/money/register.ts), as the runner last pushed it: newest first, filtered, paged.
const RAIL = /^[a-z_]{2,40}$/;
const REC = new Set(["matched", "missing_booking", "missing_rail_record", "amount_mismatch", "not_applicable"]);

function txWhere(q: URLSearchParams): { where: Where; to: string | null } {
  const where: Where = {};
  const rail = q.get("rail");
  if (rail) { if (!RAIL.test(rail)) throw new BadRequest("rail is a word like airwallex_transfer or metal"); where.rail = rail; }
  const cur = q.get("currency");
  if (cur) { if (!/^[A-Z]{3,4}$/.test(cur)) throw new BadRequest("currency is a code like EUR"); where.currency = cur; }
  const rec = q.get("reconciliation");
  if (rec) { if (!REC.has(rec)) throw new BadRequest("reconciliation is matched, missing_booking, missing_rail_record, amount_mismatch or not_applicable"); where.reconciliation = rec; }
  const moved = q.get("moved");
  if (moved) { if (!["true", "false"].includes(moved)) throw new BadRequest("moved is true or false"); where.moved = moved === "true" ? 1 : 0; }
  const from = day(q.get("from"), "from");
  if (from) where.at = { op: ">=", v: from };
  return { where, to: day(q.get("to"), "to") };
}

/** The columns the cloud validated and indexes; they win over anything in the stored body (red team round 4). */
interface TxColumns { id: string; at: string; rail: string; direction: string; currency: string; moved: number; reconciliation: string }
const columns = (r: TxColumns) => ({ id: r.id, at: r.at, rail: r.rail, direction: r.direction, currency: r.currency, moved: !!r.moved, reconciliation: r.reconciliation });

/** One page, newest first: the cursor is the last row's sort key; a "to" bound is applied while the page fills. */
export async function listTransactions(db: TenantDb, q: URLSearchParams): Promise<Page<unknown>> {
  const limit = Math.max(1, Math.min(200, Number(q.get("limit") ?? 50) || 50));
  const { where, to } = txWhere(q);
  const items: { sort_key: string; body: unknown }[] = [];
  let cursor = q.get("cursor");
  for (;;) {
    const rows = await db.select<TxColumns & { sort_key: string; version: number; body_json: string }>("transactions", { ...where, ...(cursor ? { sort_key: { op: "<", v: cursor } as Cond } : {}) }, { order: ["sort_key"], desc: true, limit: 500 });
    for (const r of rows) {
      if (to && r.at.slice(0, 10) > to) continue;
      items.push({ sort_key: r.sort_key, body: { ...parse(r), ...columns(r), version: r.version } });
      if (items.length > limit) break;
    }
    if (items.length > limit || rows.length < 500) break;
    cursor = rows[rows.length - 1]!.sort_key;
  }
  const more = items.length > limit;
  const page = items.slice(0, limit);
  return { items: page.map((x) => x.body), next_cursor: more ? page[page.length - 1]!.sort_key : null };
}

export async function oneTransaction(db: TenantDb, id: string): Promise<unknown | null> {
  const r = await db.one<TxColumns & { version: number; body_json: string }>("transactions", { id });
  if (!r) return null;
  const history = await db.select<{ version: number; replaced_at: string }>("object_history", { kind: "transaction", id }, { order: ["version"] });
  return { ...parse(r), ...columns(r), version: r.version, earlier_versions: history.map((h) => ({ version: h.version, replaced_at: h.replaced_at })) };
}

/** Every row the filters let through, newest first (for the export and the summary). */
export async function allTransactions(db: TenantDb, q: URLSearchParams): Promise<TxRow[]> {
  const out: TxRow[] = [];
  const p = new URLSearchParams(q);
  p.set("limit", "200");
  p.delete("cursor");
  for (;;) {
    const page = await listTransactions(db, p);
    out.push(...(page.items as TxRow[]));
    if (!page.next_cursor) return out;
    p.set("cursor", page.next_cursor);
  }
}

/** Totals per currency (money that moved only) and the checks, over the filtered rows. */
export async function transactionSummary(db: TenantDb, q: URLSearchParams): Promise<unknown> {
  const rows = await allTransactions(db, q);
  const ids = (f: string) => rows.filter((r) => r.flags.includes(f)).map((r) => r.id);
  return {
    totals: totalsOf(rows),
    check: { rows: rows.length, moved: rows.filter((r) => r.moved).length, unreconciled: rows.filter((r) => r.moved && r.reconciliation !== "matched").length,
      without_approval: ids("no_approval"), without_booking: ids("no_booking"), without_proof: ids("no_proof"), amount_mismatch: [...ids("amount_mismatch"), ...ids("booked_not_moved")] },
  };
}
