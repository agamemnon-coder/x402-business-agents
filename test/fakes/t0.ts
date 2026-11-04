// An in-memory T:0 accounting API (OpenAPI 1.7.0, docs.t0.ai) behind a fetch function, for test/t0.test.ts. It keeps
// the documented rules we rely on: a bearer key (401 CAPI11), X-Idempotency-Key required (400 CAPI34) and refused for
// an hour after use (409 CAPI34), then forgotten; balanced entries in the functional currency and, for a foreign one,
// in the transaction currency too (400 CAPI33); no extra fields (422); postable, active accounts only; GL accounts by
// page number, journal entries by cursor; reports built from the ledger at request time, at most 5 years (400 CAPI69).
// The P&L sign (income and expenses both positive in their normal direction) is our assumption: the docs do not say.

export interface FakeAccount {
  external_id: string;
  account_number: string | null;
  name: string;
  account_type: string;
  is_active: boolean;
  is_postable: boolean;
  parent_external_id?: string | null;
  currency?: string | null;
}

interface Line { gl_account_id: string; line_type: "debit" | "credit"; amount_atoms: number; transaction_amount_atoms?: number | null; memo?: string | null }
interface Stored {
  id: string; je_number: string; entry_date: string; memo: string | null; source: string; currency: string; transaction_currency: string | null; lines: Line[]; created_at: number;
}

const HOUR = 3_600_000;
const ENTRY_FIELDS = new Set(["entry_date", "memo", "currency", "transaction_currency", "manual_entry_reason", "is_adjusting", "je_number", "lines"]);
const LINE_FIELDS = new Set(["gl_account_id", "line_type", "amount_atoms", "transaction_amount_atoms", "memo", "counterparty_type", "counterparty_external_id"]);
const ASSETS = new Set(["bank", "accounts_receivable", "prepaid_expenses", "other_current_assets", "unbilled_receivable", "right_of_use_assets", "deposits", "fixed_assets", "other_assets"]);
const LIABILITIES = new Set(["accounts_payable", "credit_card", "accrued_expenses", "deferred_revenue", "other_current_liabilities", "lease_liabilities", "long_term_liabilities"]);

/** The chart Max would create in T:0: one account per code in our CHART, account_number = our code. */
export function chartAccounts(codes: string[], typeOf: (code: string) => string): FakeAccount[] {
  return codes.map((c) => ({ external_id: `gl_${c}`, account_number: c, name: `Account ${c}`, account_type: typeOf(c), is_active: true, is_postable: true, parent_external_id: null, currency: null }));
}

export class FakeT0 {
  key = "t0-test-key";
  functional = "EUR";
  atomsPerUnit = 100;
  now = Date.parse("2026-10-31T09:00:00Z");
  accounts: FakeAccount[];
  entries: Stored[] = [];
  /** Answers served before routing, in order: a 409 CAPI73 while T:0 rebuilds, a 500, and so on. */
  forced: { status: number; body: unknown }[] = [];
  /** When true, the journal entry list comes back empty (as if T:0 had not indexed the entries yet). */
  hideEntries = false;
  calls: { method: string; path: string; query: URLSearchParams; headers: Headers; body: unknown }[] = [];
  private idem = new Map<string, number>();
  private seq = 0;

  constructor(accounts: FakeAccount[]) {
    this.accounts = accounts;
  }

  posts(): number {
    return this.calls.filter((c) => c.method === "POST").length;
  }

  readonly fetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const method = (init.method ?? "GET").toUpperCase();
    const headers = new Headers(init.headers);
    const body: unknown = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
    this.calls.push({ method, path: url.pathname, query: url.searchParams, headers, body });
    if (headers.get("authorization") !== `Bearer ${this.key}`) return this.error(401, "CAPI11", "Missing or invalid bearer API key");
    const forced = this.forced.shift();
    if (forced) return json(forced.status, forced.body);
    const q = url.searchParams;
    if (method === "GET" && url.pathname === "/v1/entities") return json(200, { data: [{ external_id: "ent_1", name: "Northwind Outdoor", country: "NL" }] });
    if (method === "GET" && url.pathname === "/v1/gl-accounts") return this.glAccounts(q);
    if (method === "POST" && url.pathname === "/v1/journal-entries") return this.post(headers, body);
    if (method === "GET" && url.pathname === "/v1/journal-entries") return this.list(q);
    if (method === "GET" && url.pathname === "/v1/reports/profit-loss") return this.report(q, "pl");
    if (method === "GET" && url.pathname === "/v1/reports/balance-sheet") return this.report(q, "bs");
    return this.error(404, "CAPI13", "Not found");
  }) as typeof fetch;

  private error(status: number, code: string, detail: string) {
    return json(status, { error_code: code, detail, timestamp: new Date(this.now).toISOString(), standard_error_code: String(status), public_message: detail });
  }

  private glAccounts(q: URLSearchParams) {
    const page = Number(q.get("page_number") ?? 1);
    const size = Number(q.get("page_size") ?? 100);
    if (size > 100 || size < 1 || page < 1) return json(422, { detail: [{ type: "value_error", loc: ["query", "page_size"], msg: "bad page" }], public_message: "Validation error", error_code: "CAPI35" });
    const all = q.get("postable") === "true" ? this.accounts.filter((a) => a.is_active && a.is_postable) : this.accounts;
    return json(200, { data: all.slice((page - 1) * size, page * size), page_number: page, page_size: size, total_objects: all.length });
  }

  private post(headers: Headers, body: unknown) {
    const key = headers.get("x-idempotency-key");
    if (!key) return this.error(400, "CAPI34", "Missing X-Idempotency-Key");
    if (key.length > 128) return json(422, { detail: [{ type: "string_too_long", loc: ["header", "X-Idempotency-Key"], msg: "too long" }], public_message: "Validation error", error_code: "CAPI35" });
    const seen = this.idem.get(key);
    if (seen !== undefined && this.now - seen < HOUR) return this.error(409, "CAPI34", "X-Idempotency-Key was already processed within the last hour");
    const req = body as Record<string, unknown>;
    const extra = Object.keys(req).filter((k) => !ENTRY_FIELDS.has(k));
    const lines = (Array.isArray(req.lines) ? req.lines : []) as (Line & Record<string, unknown>)[];
    const lineExtra = lines.flatMap((l) => Object.keys(l).filter((k) => !LINE_FIELDS.has(k)));
    if (extra.length || lineExtra.length || typeof req.entry_date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(req.entry_date) || lines.length < 2 || typeof req.currency !== "string" || !/^[A-Za-z]{3}$/.test(req.currency)) {
      return json(422, { detail: [{ type: "extra_forbidden", loc: ["body", ...extra, ...lineExtra], msg: "Validation error" }], public_message: "Validation error", error_code: "CAPI35" });
    }
    if (typeof req.je_number === "string" && (req.je_number.length < 1 || req.je_number.length > 64)) return json(422, { detail: [], public_message: "je_number", error_code: "CAPI35" });
    const txCur = typeof req.transaction_currency === "string" ? req.transaction_currency : null;
    if (txCur !== null && !/^[A-Za-z]{3}$/.test(txCur)) return json(422, { detail: [], public_message: "transaction_currency", error_code: "CAPI35" });
    if (req.currency !== this.functional) return this.error(400, "CAPI33", `currency ${req.currency} does not match the entity's functional currency ${this.functional}`);
    const foreign = txCur !== null && txCur !== req.currency;
    let dr = 0, cr = 0, tdr = 0, tcr = 0;
    for (const l of lines) {
      const acct = this.accounts.find((a) => a.external_id === l.gl_account_id);
      if (!acct || !acct.is_active || !acct.is_postable) return this.error(400, "CAPI33", `unknown, inactive or unpostable GL account ${l.gl_account_id}`);
      if (acct.currency && acct.currency !== (txCur ?? req.currency)) return this.error(400, "CAPI33", `line currency conflicts with account ${acct.external_id} denominated in ${acct.currency}`);
      if (!Number.isInteger(l.amount_atoms) || l.amount_atoms <= 0) return json(422, { detail: [], public_message: "amount_atoms", error_code: "CAPI35" });
      const hasTx = l.transaction_amount_atoms !== undefined && l.transaction_amount_atoms !== null;
      if (foreign && !hasTx) return this.error(400, "CAPI33", "a foreign entry needs transaction_amount_atoms on every line");
      if (!foreign && hasTx) return this.error(400, "CAPI33", "a functional entry cannot carry transaction_amount_atoms");
      if (l.line_type === "debit") { dr += l.amount_atoms; tdr += l.transaction_amount_atoms ?? 0; } else { cr += l.amount_atoms; tcr += l.transaction_amount_atoms ?? 0; }
    }
    if (dr !== cr || tdr !== tcr) return this.error(400, "CAPI33", "debits do not equal credits");
    const stored: Stored = {
      id: `je_${++this.seq}`, je_number: typeof req.je_number === "string" ? req.je_number : `JE-${this.seq}`, entry_date: req.entry_date, memo: typeof req.memo === "string" ? req.memo : null,
      source: "manual", currency: req.currency, transaction_currency: foreign ? txCur : null, lines: lines.map((l) => ({ ...l })), created_at: this.now,
    };
    this.entries.push(stored);
    this.idem.set(key, this.now);
    return json(201, this.view(stored));
  }

  private view(e: Stored) {
    const lines = e.lines.map((l, i) => {
      const a = this.accounts.find((x) => x.external_id === l.gl_account_id)!;
      return { id: `${e.id}_l${i}`, account_id: a.external_id, account_number: a.account_number, account_name: a.name, account_type: a.account_type, line_type: l.line_type, amount_atoms: l.amount_atoms, transaction_amount_atoms: l.transaction_amount_atoms ?? null, memo: l.memo ?? null };
    });
    const sum = (t: string, k: "amount_atoms" | "transaction_amount_atoms") => lines.filter((l) => l.line_type === t).reduce((s, l) => s + (l[k] ?? 0), 0);
    return {
      id: e.id, je_number: e.je_number, entry_date: e.entry_date, memo: e.memo, source: e.source, currency: e.currency, transaction_currency: e.transaction_currency, atoms_per_unit: this.atomsPerUnit,
      total_debit_atoms: sum("debit", "amount_atoms"), total_credit_atoms: sum("credit", "amount_atoms"),
      total_transaction_debit_atoms: sum("debit", "transaction_amount_atoms"), total_transaction_credit_atoms: sum("credit", "transaction_amount_atoms"), status: "editable", lines,
    };
  }

  private list(q: URLSearchParams) {
    const limit = Number(q.get("limit") ?? 50);
    if (limit < 1 || limit > 100) return json(422, { detail: [], public_message: "limit", error_code: "CAPI35" });
    const from = q.get("date_from"), to = q.get("date_to"), sources = q.getAll("source");
    const all = (this.hideEntries ? [] : this.entries)
      .filter((e) => (!from || e.entry_date >= from) && (!to || e.entry_date <= to) && (!sources.length || sources.includes(e.source)))
      .sort((a, b) => b.entry_date.localeCompare(a.entry_date) || b.created_at - a.created_at);
    const cursor = q.get("cursor");
    const start = cursor ? Number(Buffer.from(cursor, "base64url").toString()) : 0;
    if (!Number.isInteger(start) || start < 0) return this.error(400, "CAPI65", "A cursor that does not match the request");
    const page = all.slice(start, start + limit);
    const next = start + limit < all.length ? Buffer.from(String(start + limit)).toString("base64url") : null;
    return json(200, { data: page.map((e) => this.view(e)), next_cursor: next, ...(q.get("include_total") === "true" ? { total: all.length } : {}) });
  }

  private report(q: URLSearchParams, kind: "pl" | "bs") {
    const start = q.get("start_date"), end = q.get("end_date");
    if (!start || !end) return json(422, { detail: [], public_message: "start_date and end_date are required", error_code: "CAPI35" });
    const limit = new Date(`${start}T00:00:00Z`);
    limit.setUTCFullYear(limit.getUTCFullYear() + 5);
    if (Date.parse(`${end}T00:00:00Z`) >= limit.getTime()) return this.error(400, "CAPI69", "The window spans more than 5 years");
    const periods = periodColumns(start, end, q.get("period_type") ?? "monthly");
    const lines = this.entries.flatMap((e) => e.lines.map((l) => ({ ...l, date: e.entry_date })));
    const amount = (a: FakeAccount, p: { start_date: string; end_date: string }, normalDebit: boolean): number | null => {
      const mine = lines.filter((l) => l.gl_account_id === a.external_id && l.date <= p.end_date && (kind === "bs" || l.date >= p.start_date));
      if (!mine.length) return null;
      const net = mine.reduce((s, l) => s + (l.line_type === "debit" ? l.amount_atoms : -l.amount_atoms), 0);
      return normalDebit ? net : -net;
    };
    const node = (a: FakeAccount, normalDebit: boolean): Record<string, unknown> => {
      const kids = this.accounts.filter((c) => c.parent_external_id === a.external_id).map((c) => node(c, normalDebit));
      const balances: Record<string, number | null> = {};
      for (const p of periods) {
        const own = amount(a, p, normalDebit);
        const sub = kids.map((k) => (k.balances as Record<string, number | null>)[p.id] ?? null).filter((v): v is number => v !== null);
        balances[p.id] = own === null && !sub.length ? null : (own ?? 0) + sub.reduce((s, v) => s + v, 0);
      }
      return { account_id: a.external_id, account_number: a.account_number, name: a.name, is_postable: a.is_postable, account_kind: "regular", balances, children: kids };
    };
    const section = (key: string, label: string, types: Set<string>, normalDebit: boolean) => {
      const top = this.accounts.filter((a) => types.has(a.account_type) && !a.parent_external_id).map((a) => node(a, normalDebit));
      const balances: Record<string, number | null> = {};
      for (const p of periods) {
        const vals = top.map((t) => (t.balances as Record<string, number | null>)[p.id] ?? null).filter((v): v is number => v !== null);
        balances[p.id] = vals.length ? vals.reduce((s, v) => s + v, 0) : null;
      }
      return { key, label, is_computed: false, balances, children: top };
    };
    const head = { periods, reporting_currency: this.functional, reporting_currency_source: "functional", amount_unit: "atoms", atoms_per_unit: this.atomsPerUnit };
    if (kind === "bs") {
      const s = [section("asset", "Assets", ASSETS, true), section("liability", "Liabilities", LIABILITIES, false), section("equity", "Equity", new Set(["equity", "retained_earnings"]), false)];
      return json(200, { ...head, sections: s.map(({ key, ...rest }) => ({ account_type: key, ...rest })) });
    }
    const revenue = section("revenue", "Revenue", new Set(["income"]), false);
    const cogs = section("cost_of_goods_sold", "Cost of goods sold", new Set(["cost_of_goods_sold"]), true);
    const opex = section("operating_expenses", "Operating expenses", new Set(["expenses"]), true);
    const computed = (key: string, label: string, f: (id: string) => number) => ({ key, label, is_computed: true, balances: Object.fromEntries(periods.map((p) => [p.id, f(p.id)])), children: [] });
    const v = (s: { balances: Record<string, number | null> }, id: string) => s.balances[id] ?? 0;
    return json(200, {
      ...head,
      sections: [revenue, cogs, computed("gross_profit", "Gross profit", (id) => v(revenue, id) - v(cogs, id)), opex, computed("net_income", "Net income", (id) => v(revenue, id) - v(cogs, id) - v(opex, id))],
    });
  }
}

function periodColumns(start: string, end: string, type: string) {
  const out: { id: string; label: string; start_date: string; end_date: string }[] = [];
  let y = Number(start.slice(0, 4)), m = Number(start.slice(5, 7));
  const step = type === "yearly" ? 12 : type === "quarterly" ? 3 : 1;
  if (type === "yearly") m = 1;
  if (type === "quarterly") m = Math.floor((m - 1) / 3) * 3 + 1;
  for (;;) {
    const s = `${y}-${String(m).padStart(2, "0")}-01`;
    if (s > end) break;
    const ny = m + step > 12 ? y + 1 : y, nm = ((m + step - 1) % 12) + 1;
    const e = new Date(Date.UTC(ny, nm - 1, 1) - 86_400_000).toISOString().slice(0, 10);
    const id = type === "yearly" ? String(y) : type === "quarterly" ? `${y}-Q${(m + 2) / 3}` : s.slice(0, 7);
    out.push({ id, label: id, start_date: s < start ? start : s, end_date: e > end ? end : e });
    y = ny; m = nm;
  }
  return out;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
