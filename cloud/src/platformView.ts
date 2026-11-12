// The platform operator's view of the companies on Purser Cloud (GET /v1/admin/companies, the platform admin only): per
// company its Airwallex account as Airwallex's webhooks reported it, the supplier payouts that moved, the payouts still
// waiting, and Purser's platform fees that were taken. Everything comes from the rows the companies' runners pushed
// (the transactions register) and the awx_accounts table; nothing is estimated. Never a key, never an account number.
import type { Sql } from "./store.js";

type Totals = Record<string, string>;
export interface CompanyRow {
  slug: string; name: string; created_at: string; closed: boolean;
  airwallex: { account_id: string | null; status: string } | null;
  payouts: { count: number; totals: Totals };
  waiting: number;
  fees: Totals;
  last_push: string | null;
}

const cents = (s: unknown): number => { const m = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(String(s ?? "")); if (!m) return 0; const v = Number(m[2]) * 100 + Number((m[3] ?? "").padEnd(2, "0")); return m[1] ? -v : v; };
const fmt = (c: number): string => `${c < 0 ? "-" : ""}${Math.floor(Math.abs(c) / 100)}.${String(Math.abs(c) % 100).padStart(2, "0")}`;
const add = (m: Map<string, number>, cur: string, c: number) => m.set(cur, (m.get(cur) ?? 0) + c);
const out = (m: Map<string, number>): Totals => Object.fromEntries([...m].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, fmt(v)]));

export async function platformCompanies(sql: Sql): Promise<{ companies: CompanyRow[]; totals: { companies: number; active_accounts: number; payouts: Totals; fees: Totals } }> {
  const tenants = await sql.all<{ id: string; slug: string; name: string; created_at: string; closed_at: string | null }>("SELECT id, slug, name, created_at, closed_at FROM tenants ORDER BY name, slug");
  const accounts = new Map((await sql.all<{ tenant_id: string; account_id: string | null; status: string }>("SELECT tenant_id, account_id, status FROM awx_accounts WHERE id = 'main'")).map((a) => [a.tenant_id, a]));
  const pushes = new Map((await sql.all<{ tenant_id: string; at: string }>("SELECT tenant_id, MAX(at) AS at FROM push_log GROUP BY tenant_id")).map((p) => [p.tenant_id, p.at]));
  const rows = await sql.all<{ tenant_id: string; id: string; currency: string; moved: number; body_json: string }>(
    "SELECT tenant_id, id, currency, moved, body_json FROM transactions WHERE rail = 'airwallex_transfer' AND direction = 'out'");
  const per = new Map<string, { payouts: Map<string, number>; count: number; waiting: number; fees: Map<string, number> }>();
  const all = { payouts: new Map<string, number>(), fees: new Map<string, number>() };
  for (const r of rows) {
    const p = per.get(r.tenant_id) ?? { payouts: new Map(), count: 0, waiting: 0, fees: new Map() };
    per.set(r.tenant_id, p);
    let amount = "0";
    try { amount = String((JSON.parse(r.body_json) as { amount?: unknown }).amount ?? "0"); } catch { /* a row the cloud accepted is JSON; skip if not */ }
    const c = cents(amount);
    if (r.id.startsWith("platform_fee:")) { if (r.moved) { add(p.fees, r.currency, c); add(all.fees, r.currency, c); } continue; }
    if (r.moved) { p.count++; add(p.payouts, r.currency, c); add(all.payouts, r.currency, c); } else p.waiting++;
  }
  const companies = tenants.map((t): CompanyRow => {
    const a = accounts.get(t.id); const p = per.get(t.id);
    return { slug: t.slug, name: t.name, created_at: t.created_at, closed: !!t.closed_at,
      airwallex: a ? { account_id: a.account_id, status: a.status } : null,
      payouts: { count: p?.count ?? 0, totals: p ? out(p.payouts) : {} }, waiting: p?.waiting ?? 0, fees: p ? out(p.fees) : {}, last_push: pushes.get(t.id) ?? null };
  });
  return { companies, totals: { companies: companies.length, active_accounts: companies.filter((x) => x.airwallex?.status === "active").length, payouts: out(all.payouts), fees: out(all.fees) } };
}
