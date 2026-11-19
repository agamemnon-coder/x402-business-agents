// Money in, per Global Account (sandbox only, test money; docs: api/core_resources/global_accounts, read 19 November
// 2026). The account's own statement says what arrived on it; the receivables agent (src/agents/receivables.ts) matches
// each arrival to an open invoice by the reference the payer gave, exactly as it matches a deposit.
//   GET  /api/v1/global_accounts/{id}/transactions  from_created_at / to_created_at, page_num, page_size
//   GET  /api/v1/global_accounts/{id}                one account: status, currency
//   POST /api/v1/global_accounts/{id}/close          closes an account Purser opened and does not use (it must be
//                                                    one the caller names; Purser's working accounts are refused)
// The statement is read only; the close is the one write, and only for an account named on purpose.

import type { Airwallex } from "./client.js";
import { signedCents } from "../finance/awxReconcile.js";
import type { Deposit as Receipt } from "../agents/receivables.js";

export interface GaTransaction { id: string; type: string; status: string; currency: string; amountCents: number; feeCents: number; payer: string | null; description: string; createdAt: string | null }
type RawGaTx = { id: string; type?: string; status?: string; currency?: string; amount?: number | string; fee_amount?: number | string | null; payer_name?: string | null; description?: string | null; create_time?: string | null; created_at?: string | null };

export function toGaTransaction(r: RawGaTx): GaTransaction {
  return {
    id: r.id, type: r.type ?? "", status: r.status ?? "", currency: (r.currency ?? "").toUpperCase(), amountCents: signedCents(r.amount ?? 0), feeCents: signedCents(r.fee_amount ?? 0),
    payer: r.payer_name ?? null, description: (r.description ?? "").slice(0, 200), createdAt: r.create_time ?? r.created_at ?? null,
  };
}

const MAX_PAGES = 5;

/** Every transaction on one Global Account created in [from, to], all pages. */
export async function listGlobalAccountTransactions(api: Pick<Airwallex, "call">, globalAccountId: string, w: { from: string; to: string }): Promise<GaTransaction[]> {
  if (!(Date.parse(w.to) >= Date.parse(w.from))) throw new Error(`a window needs from ≤ to; ${w.from} … ${w.to} is not`);
  const out: GaTransaction[] = [];
  for (let page = 0; ; page++) {
    if (page >= MAX_PAGES) throw new Error(`more than ${MAX_PAGES} pages of transactions on ${globalAccountId}; narrow the window`);
    const r = await api.call<{ items?: RawGaTx[]; has_more?: boolean }>("GET", `/global_accounts/${encodeURIComponent(globalAccountId)}/transactions`, undefined, {
      from_created_at: w.from, to_created_at: w.to, page_num: String(page), page_size: "100",
    });
    if (!r || !Array.isArray(r.items)) throw new Error("Airwallex's Global Account transactions came without items");
    out.push(...r.items.map(toGaTransaction));
    if (typeof r.has_more !== "boolean" && r.items.length >= 100) throw new Error("a full page of Global Account transactions without has_more; nothing is concluded");
    if (r.has_more !== true) return out;
  }
}

/**
 * The arrival that is this deposit: same currency and amount, credited, and the deposit's reference or payer in its
 * description or payer name. Exactly one must fit; none or several is no match (never a guess).
 */
export function findArrival(txs: readonly GaTransaction[], d: { currency: string; amountCents: number; reference: string; payer: string }): { tx: GaTransaction | null; why: string } {
  const fits = txs.filter((t) => t.currency === d.currency && t.amountCents === d.amountCents && (t.description.includes(d.reference) || t.payer === d.payer));
  if (fits.length === 1) return { tx: fits[0]!, why: "one arrival with this amount, currency and the payer's reference or name" };
  return { tx: null, why: fits.length ? `${fits.length} arrivals fit; none is chosen` : "no arrival with this amount and currency names this payer or reference" };
}

/** An arrival as a receipt for the receivables agent: the reference is what the payer gave (the description, or the deposit's). */
export function receiptOf(globalAccountId: string, t: GaTransaction, reference: string | null): Receipt {
  return { deposit_id: t.id, global_account_id: globalAccountId, currency: t.currency, amount_cents: t.amountCents, reference: reference ?? t.description, payer: t.payer, received_at: t.createdAt ?? new Date().toISOString() };
}

export interface GlobalAccount { id: string; status: string; currencies: string[] }
type RawGa = { id: string; status?: string; supported_features?: { currency?: string }[]; required_features?: { currency?: string }[] };
const toGa = (r: RawGa): GlobalAccount => ({ id: r.id, status: r.status ?? "", currencies: [...new Set([...(r.required_features ?? []), ...(r.supported_features ?? [])].map((f) => (f.currency ?? "").toUpperCase()).filter(Boolean))].sort() });

export async function getGlobalAccount(api: Pick<Airwallex, "call">, id: string): Promise<GlobalAccount> {
  return toGa(await api.call<RawGa>("GET", `/global_accounts/${encodeURIComponent(id)}`));
}

/**
 * Closes one Global Account Purser opened and does not use. Refuses an account in `keep` (the ones money arrives on)
 * and one that is not ACTIVE; reads it back after, and returns what Airwallex then says.
 */
export async function closeUnusedGlobalAccount(api: Pick<Airwallex, "call">, id: string, keep: readonly string[]): Promise<{ before: GlobalAccount; after: GlobalAccount }> {
  if (keep.includes(id)) throw new Error(`${id} is one of the accounts money arrives on; it is not closed`);
  const before = await getGlobalAccount(api, id);
  if (before.status !== "ACTIVE") throw new Error(`${id} is ${before.status}, not ACTIVE; nothing was closed`);
  await api.call("POST", `/global_accounts/${encodeURIComponent(id)}/close`, {});
  return { before, after: await getGlobalAccount(api, id) };
}
