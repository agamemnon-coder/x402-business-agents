// Money received: deposits to the company's Airwallex Global Accounts (docs, read 13 November 2026:
// global-treasury/receive-funds/receive-bank-transfers-to-global-accounts/retrieve-your-deposits; GET /api/v1/deposits
// with from_created_at / to_created_at, page_num, page_size; a window of at most 31 days).
//
// Purser reads them and nothing else: it never creates, returns or moves a deposit. Each deposit it sees is recorded in
// its ledger once (awx_deposit.seen; a later status is recorded as awx_deposit.status), and a SETTLED one becomes a
// "deposit" movement that the ledger reconciliation (src/finance/awxFinancialTx.ts) checks against Airwallex's own
// financial transactions, to the cent. Incoming money needs no CFO approval; nothing here pays anything.
//
// Sandbox: POST /api/v1/simulation/deposit/create makes a test deposit to a global account (docs: developer-tools/
// sandbox-environment/deposits/simulate-deposits-to-your-global-account); used only by the live sandbox run.

import { audit } from "../audit/log.js";
import type { DB } from "../db/open.js";
import { signedCents } from "../finance/awxFinancialTx.js";
import type { Airwallex } from "./client.js";

export interface Deposit {
  id: string;
  globalAccountId: string | null;
  currency: string;
  amountCents: number;
  status: string;
  payer: string | null;
  reference: string | null;
  createdAt: string | null;
}

interface RawDeposit { id: string; global_account_id?: string | null; currency?: string; amount?: number | string; status?: string; payer_name?: string | null; payer?: { name?: string } | null; reference?: string | null; created_at?: string | null }

export function toDeposit(r: RawDeposit): Deposit {
  return {
    id: r.id, globalAccountId: r.global_account_id ?? null, currency: (r.currency ?? "").toUpperCase(), amountCents: signedCents(r.amount ?? 0),
    status: r.status ?? "", payer: r.payer_name ?? r.payer?.name ?? null, reference: r.reference ?? null, createdAt: r.created_at ?? null,
  };
}

/** The longest window the docs allow in one listing. */
export const MAX_WINDOW_MS = 31 * 24 * 3600_000;
const MAX_PAGES = 5;

/** Every deposit created in [from, to] (at most 31 days), all pages. */
export async function listDeposits(api: Pick<Airwallex, "call">, w: { from: string; to: string }): Promise<Deposit[]> {
  const span = Date.parse(w.to) - Date.parse(w.from);
  if (!(span >= 0) || span > MAX_WINDOW_MS) throw new Error(`a deposit window is 0 to 31 days; ${w.from} … ${w.to} is not`);
  const out: Deposit[] = [];
  for (let page = 0; ; page++) {
    if (page >= MAX_PAGES) throw new Error(`more than ${MAX_PAGES} pages of deposits in ${w.from} … ${w.to}; narrow the window`);
    const r = await api.call<{ items?: RawDeposit[]; has_more?: boolean }>("GET", "/deposits", undefined, { from_created_at: w.from, to_created_at: w.to, page_num: String(page), page_size: "100" });
    if (!r || !Array.isArray(r.items)) throw new Error("Airwallex's deposits came without items");
    out.push(...r.items.map(toDeposit));
    if (typeof r.has_more !== "boolean" && r.items.length >= 100) throw new Error("Airwallex's deposits came as a full page without has_more; nothing is concluded");
    if (r.has_more !== true) return out;
  }
}

/** Records each deposit once, and each change of its status; returns the ones new to the ledger. Reads nothing itself. */
export function recordDeposits(db: DB, deposits: Deposit[], now = new Date()): Deposit[] {
  const fresh: Deposit[] = [];
  for (const d of deposits) {
    const last = db.prepare("SELECT json_extract(payload_json, '$.status') AS status FROM audit_log WHERE event IN ('awx_deposit.seen', 'awx_deposit.status') AND subject = ? ORDER BY seq DESC LIMIT 1").get(d.id) as { status: string } | undefined;
    const payload = { global_account_id: d.globalAccountId, currency: d.currency, amount_cents: d.amountCents, status: d.status, payer: d.payer, reference: d.reference, created_at: d.createdAt };
    if (!last) { audit(db, "system", "awx_deposit.seen", d.id, payload, now); fresh.push(d); }
    else if (last.status !== d.status) audit(db, "system", "awx_deposit.status", d.id, { ...payload, was: last.status }, now);
  }
  return fresh;
}

/** The SETTLED deposits in the ledger, as the reconciliation's "deposit" movements (latest status per deposit). */
export function settledDeposits(db: DB): { id: string; currency: string; amountCents: number; label: string }[] {
  const rows = db.prepare(`SELECT subject, payload_json FROM audit_log a WHERE event IN ('awx_deposit.seen', 'awx_deposit.status')
    AND seq = (SELECT MAX(seq) FROM audit_log b WHERE b.subject = a.subject AND b.event IN ('awx_deposit.seen', 'awx_deposit.status')) ORDER BY seq`).all() as { subject: string; payload_json: string }[];
  return rows.map((r) => ({ id: r.subject, p: JSON.parse(r.payload_json) as { currency: string; amount_cents: number; status: string; payer: string | null; reference: string | null } }))
    .filter((r) => r.p.status === "SETTLED")
    .map((r) => ({ id: r.id, currency: r.p.currency, amountCents: r.p.amount_cents, label: `deposit${r.p.payer ? ` from ${r.p.payer}` : ""}${r.p.reference ? ` (${r.p.reference})` : ""}` }));
}

/** Reads the last `days` of deposits (≤ 31) and records them: what the hourly reconciliation runs before it compares. */
export async function pullDeposits(db: DB, list: (w: { from: string; to: string }) => Promise<Deposit[]>, now = new Date(), days = 7): Promise<{ read: number; fresh: number }> {
  const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, "+0000");
  const all = await list({ from: iso(new Date(now.getTime() - Math.min(days, 31) * 24 * 3600_000)), to: iso(now) });
  return { read: all.length, fresh: recordDeposits(db, all, now).length };
}

/** Sandbox only: a test deposit to a global account (the client refuses any host but the sandbox). */
export async function simulateDeposit(api: Pick<Airwallex, "call">, a: { globalAccountId: string; amount: string; payer: string; reference: string }): Promise<Deposit> {
  const r = await api.call<RawDeposit>("POST", "/simulation/deposit/create", { global_account_id: a.globalAccountId, amount: Number(a.amount), payer_name: a.payer, payer_bankname: "Sandbox Test Bank", payer_country: "DE", reference: a.reference, status: "SETTLED" });
  if (!r?.id) throw new Error("the sandbox answered no deposit id");
  return toDeposit(r);
}
