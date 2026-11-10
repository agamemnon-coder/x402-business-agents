// T:0 (a hackathon sponsor) as Purser's general ledger: the double-entry books (src/accounting/books.ts) posted as
// manual journal entries through T:0's customer API (OpenAPI 1.7.0, docs.t0.ai), and T:0's P&L compared back with our
// trial balance, account by account. The API cannot create accounts: Max builds the chart in T:0 with
// account_number = our code (src/config/gl.ts), and we look up each account's external_id at run time.
// Plain fetch, no SDK. The key is only ever sent as the bearer token; it is never logged or put in an error.

import type { DB } from "../db/open.js";
import { createHash } from "node:crypto";
import { CHART } from "../config/gl.js";
import type { T0MapTarget } from "../config/t0Map.js";
import type { Posting, TrialRow } from "./books.js";

export const T0_BASE_URL = "https://api.t0.ai";

// ---- API shapes (only the fields we use or show) ----

export interface T0Entity { external_id: string; name: string; country?: string | null }

export type T0AccountType =
  | "bank" | "accounts_receivable" | "prepaid_expenses" | "other_current_assets" | "unbilled_receivable" | "right_of_use_assets" | "deposits" | "fixed_assets"
  | "other_assets" | "accounts_payable" | "credit_card" | "accrued_expenses" | "deferred_revenue" | "other_current_liabilities" | "lease_liabilities"
  | "long_term_liabilities" | "equity" | "retained_earnings" | "income" | "other_income" | "cost_of_goods_sold" | "expenses" | "other_expense";

export interface T0GlAccount {
  external_id: string;
  account_number?: string | null;
  name: string;
  account_type: string;
  is_active: boolean;
  is_postable: boolean;
  parent_external_id?: string | null;
  currency?: string | null;
}

export interface T0JournalLineRequest {
  gl_account_id: string;
  line_type: "debit" | "credit";
  amount_atoms: number;
  transaction_amount_atoms?: number;
  memo?: string;
}

export interface T0JournalEntryRequest {
  entry_date: string;
  currency: string;
  transaction_currency?: string;
  memo?: string;
  manual_entry_reason?: string;
  is_adjusting?: boolean;
  je_number?: string;
  lines: T0JournalLineRequest[];
}

export interface T0JournalEntry {
  id: string;
  je_number: string | null;
  entry_date: string;
  memo: string | null;
  source: string;
  currency: string;
  transaction_currency: string | null;
  atoms_per_unit: number;
  total_debit_atoms: number;
  total_credit_atoms: number;
  status: string;
  lines: { id: string; account_id: string; account_number: string | null; account_name: string; account_type: string; line_type: "debit" | "credit"; amount_atoms: number; transaction_amount_atoms: number | null; memo: string | null }[];
}

export type T0Source = "manual" | "correction" | "closing_entry" | "leapfin_import" | "quickbooks" | "xero" | "puzzle" | "intercompany" | "intercompany_elimination";

export interface T0ReportQuery { start_date: string; end_date: string; period_type?: "monthly" | "quarterly" | "yearly" }

/** A period id to atoms; null means no data for that period (not zero). */
export type T0Balances = Record<string, number | null>;

export interface T0ReportAccount {
  account_id: string;
  account_number?: string | null;
  name: string;
  is_postable: boolean;
  account_kind?: string;
  balances: T0Balances;
  own_balances?: T0Balances;
  children?: T0ReportAccount[];
}

interface T0ReportHead {
  periods: { id: string; label: string; start_date: string; end_date: string }[];
  reporting_currency: string;
  reporting_currency_source?: "functional" | "default_fallback";
  amount_unit?: "atoms";
  atoms_per_unit: number;
}

export interface T0ProfitLoss extends T0ReportHead {
  sections: { key: string; label: string; is_computed?: boolean; balances: T0Balances; children?: T0ReportAccount[] }[];
}

export interface T0BalanceSheet extends T0ReportHead {
  sections: { account_type: string; label: string; balances: T0Balances; children?: T0ReportAccount[] }[];
}

export interface T0CashFlow extends T0ReportHead {
  sections: { key: string; label: string; is_subtotal?: boolean; balances: T0Balances; accounts?: unknown[] }[];
}

export interface BalanceSheetPeriodCheck { period: string; assets: number; liabilities: number; equity: number; difference: number; balances: boolean; noData: boolean }

/** T:0's own balance sheet must balance: assets = liabilities + equity in every period. A period with no data is reported
 *  as not checkable, never as balanced. Amounts are in reporting-currency units. */
export function balanceSheetCheck(bs: T0BalanceSheet): BalanceSheetPeriodCheck[] {
  const section = (type: string) => {
    const s = bs.sections.find((x) => x.account_type.toLowerCase().startsWith(type));
    if (!s) throw new Error(`T:0 balance sheet has no ${type} section`);
    return s;
  };
  const assets = section("asset"), liabilities = section("liabilit"), equity = section("equity");
  const unit = bs.atoms_per_unit || 1;
  return bs.periods.map((p) => {
    const a = assets.balances[p.id], l = liabilities.balances[p.id], e = equity.balances[p.id];
    const noData = a == null && l == null && e == null;
    const diffAtoms = (a ?? 0) - (l ?? 0) - (e ?? 0);
    return { period: p.label, assets: (a ?? 0) / unit, liabilities: (l ?? 0) / unit, equity: (e ?? 0) / unit, difference: diffAtoms / unit, balances: !noData && diffAtoms === 0, noData };
  });
}

/** The cash flow statement's computed net change in cash per period (the last subtotal section), in units. */
export function cashFlowNetChange(cf: T0CashFlow): { period: string; netChange: number | null }[] {
  const subtotals = cf.sections.filter((s) => s.is_subtotal);
  const net = subtotals.find((s) => /net/i.test(s.key) || /net/i.test(s.label)) ?? subtotals[subtotals.length - 1];
  const unit = cf.atoms_per_unit || 1;
  return cf.periods.map((p) => ({ period: p.label, netChange: net?.balances[p.id] == null ? null : (net.balances[p.id] as number) / unit }));
}

// ---- Client ----

export class T0Error extends Error {
  readonly status: number;
  /** T:0's error_code (CAPI11, CAPI33, ...), or HTTP_<status> when the body has none. */
  readonly code: string;
  readonly detail: unknown;
  /** CAPI73 (accounting data being rebuilt) and 5xx: worth one more try. */
  readonly retryable: boolean;

  constructor(status: number, code: string, detail: unknown, message: string) {
    super(message);
    this.name = "T0Error";
    this.status = status;
    this.code = code;
    this.detail = detail;
    this.retryable = code === "CAPI73" || status >= 500;
  }
}

export interface T0ClientOptions {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  /** The entity's external_id; optional with an API key (one key is one entity). */
  entity?: string;
  retryDelayMs?: number;
  timeoutMs?: number;
}

type Query = Record<string, string | number | boolean | string[] | undefined>;

export class T0Client {
  readonly #apiKey: string;
  readonly #baseUrl: string;
  readonly #fetch: typeof fetch;
  readonly #entity: string | undefined;
  readonly #retryDelayMs: number;
  readonly #timeoutMs: number;

  constructor(o: T0ClientOptions) {
    if (!o.apiKey) throw new Error("T0Client needs an API key");
    this.#apiKey = o.apiKey;
    this.#baseUrl = (o.baseUrl ?? T0_BASE_URL).replace(/\/+$/, "");
    this.#fetch = o.fetch ?? globalThis.fetch;
    this.#entity = o.entity;
    this.#retryDelayMs = o.retryDelayMs ?? 2000;
    this.#timeoutMs = o.timeoutMs ?? 30_000;
  }

  async listEntities(): Promise<T0Entity[]> {
    return (await this.#request<{ data: T0Entity[] }>("GET", "/v1/entities")).data;
  }

  /** The whole chart (or only active, postable accounts), every page. */
  async listGlAccounts(o: { postable?: boolean } = {}): Promise<T0GlAccount[]> {
    const out: T0GlAccount[] = [];
    for (let page = 1; page <= 10_000; page++) {
      const r = await this.#request<{ data: T0GlAccount[]; total_objects: number }>("GET", "/v1/gl-accounts", { postable: o.postable, page_number: page, page_size: 100 });
      out.push(...r.data);
      if (!r.data.length || out.length >= r.total_objects) break;
    }
    return out;
  }

  /** Posts one manual entry. The key makes a repeat within the hour a 409 CAPI34 instead of a second entry. */
  async postJournalEntry(req: T0JournalEntryRequest, idempotencyKey: string): Promise<T0JournalEntry> {
    if (!idempotencyKey || idempotencyKey.length > 128) throw new Error("postJournalEntry needs an idempotency key of 1 to 128 characters");
    return this.#request<T0JournalEntry>("POST", "/v1/journal-entries", {}, req, { "x-idempotency-key": idempotencyKey });
  }

  async getJournalEntry(id: string): Promise<T0JournalEntry> {
    return this.#request<T0JournalEntry>("GET", `/v1/journal-entries/${encodeURIComponent(id)}`);
  }

  /** Every matching entry, following next_cursor until it is null. */
  async *listJournalEntries(q: { dateFrom?: string; dateTo?: string; source?: T0Source[]; glAccountIds?: string[] }): AsyncIterable<T0JournalEntry> {
    let cursor: string | undefined;
    const seen = new Set<string>();
    for (;;) {
      const r = await this.#request<{ data: T0JournalEntry[]; next_cursor: string | null }>("GET", "/v1/journal-entries", {
        date_from: q.dateFrom, date_to: q.dateTo, source: q.source, gl_account_ids: q.glAccountIds, limit: 100, cursor,
      });
      yield* r.data;
      if (!r.next_cursor) return;
      if (seen.has(r.next_cursor)) throw new Error("T:0 returned the same journal entry cursor twice");
      seen.add(r.next_cursor);
      cursor = r.next_cursor;
    }
  }

  async profitLoss(q: T0ReportQuery): Promise<T0ProfitLoss> {
    return this.#request<T0ProfitLoss>("GET", "/v1/reports/profit-loss", { ...q });
  }

  async balanceSheet(q: T0ReportQuery): Promise<T0BalanceSheet> {
    return this.#request<T0BalanceSheet>("GET", "/v1/reports/balance-sheet", { ...q });
  }

  async cashFlow(q: T0ReportQuery): Promise<T0CashFlow> {
    return this.#request<T0CashFlow>("GET", "/v1/reports/cash-flow", { ...q });
  }

  async #request<T>(method: "GET" | "POST", path: string, query: Query = {}, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
    const url = new URL(this.#baseUrl + path);
    for (const [k, v] of Object.entries({ ...query, entity: this.#entity })) {
      if (v === undefined) continue;
      if (Array.isArray(v)) for (const item of v) url.searchParams.append(k, item); // T:0 arrays: repeat the key
      else url.searchParams.set(k, String(v));
    }
    for (let attempt = 0; ; attempt++) {
      const res = await this.#fetch(url.toString(), {
        method,
        headers: { authorization: `Bearer ${this.#apiKey}`, accept: "application/json", ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
      const text = await res.text();
      let parsed: unknown;
      try { parsed = text ? JSON.parse(text) : undefined; } catch { parsed = text; }
      if (res.ok) return parsed as T;
      const err = toError(res.status, parsed, method, path);
      if (err.retryable && attempt === 0) {
        if (this.#retryDelayMs > 0) await new Promise((r) => setTimeout(r, this.#retryDelayMs));
        continue;
      }
      throw err;
    }
  }
}

function toError(status: number, body: unknown, method: string, path: string): T0Error {
  const b = (body && typeof body === "object" ? body : {}) as { error_code?: unknown; detail?: unknown; public_message?: unknown };
  const code = typeof b.error_code === "string" ? b.error_code : status === 422 ? "CAPI35" : `HTTP_${status}`;
  const detail = b.detail ?? (typeof body === "string" ? body.slice(0, 500) : undefined);
  const said = typeof b.public_message === "string" ? b.public_message : typeof b.detail === "string" ? b.detail : "";
  return new T0Error(status, code, detail, `T:0 ${method} ${path}: ${status} ${code}${said ? ` (${said.slice(0, 300)})` : ""}`);
}

/** The entity's functional currency and its atoms per unit, read from a P&L (no endpoint returns it directly). */
export async function functionalCurrency(client: Pick<T0Client, "profitLoss">, today = new Date().toISOString().slice(0, 10)): Promise<{ currency: string; atomsPerUnit: number }> {
  const r = await client.profitLoss({ start_date: today, end_date: today, period_type: "monthly" });
  if (r.reporting_currency_source !== "functional") throw new Error(`T:0 has no functional currency set for this entity (it reports in ${r.reporting_currency} by default): set it in T:0 first`);
  return { currency: r.reporting_currency.toUpperCase(), atomsPerUnit: r.atoms_per_unit };
}

// ---- Our chart in T:0 ----

/** The T:0 account type for each code in our chart: what Max picks when he creates the account. */
export function t0AccountType(code: string): T0AccountType | undefined {
  if (/^12\d\d$/.test(code)) return "bank";
  if (/^1[3-9]\d\d$/.test(code)) return "other_current_assets";
  if (/^2\d{3}$/.test(code)) return "other_current_liabilities";
  if (/^3\d{3}$/.test(code)) return "equity";
  if (/^4\d{3}$/.test(code)) return "income"; // 4100 refunds is a contra account: income with a debit balance
  if (/^5\d{3}$/.test(code) || code === "6200") return "cost_of_goods_sold"; // 6200 goods from the manufacturer: our call
  if (/^6\d{3}$/.test(code)) return "expenses";
  return undefined;
}

export const T0_ACCOUNT_TYPES: Record<string, T0AccountType | undefined> = Object.fromEntries(Object.keys(CHART).map((c) => [c, t0AccountType(c)]));

/**
 * Our code to T:0's external_id, by account_number. Throws, naming every code at once, when an account is missing,
 * inactive or not postable; a different account type than we expect is only a warning.
 */
export function resolveAccounts(
  accounts: T0GlAccount[], codes: Iterable<string>, o: { fallback?: Record<string, T0MapTarget> } = {},
): { map: Map<string, string>; warnings: string[]; /** our code to the T:0 account_number it landed on */ numbers: Map<string, string>; /** memo prefix for lines on a shared account */ labels: Map<string, string> } {
  const map = new Map<string, string>(), numbers = new Map<string, string>(), labels = new Map<string, string>();
  const missing: string[] = [], unpostable: string[] = [], ambiguous: string[] = [], warnings: string[] = [];
  for (const code of [...new Set(codes)].sort()) {
    const same = accounts.filter((a) => a.account_number === code);
    const usable = same.filter((a) => a.is_active && a.is_postable);
    if (!same.length && o.fallback?.[code]) {
      const t = o.fallback[code]!;
      const hit = accounts.filter((a) => a.account_number === t.number && a.is_active && a.is_postable);
      if (hit.length !== 1) { missing.push(`${code} (mapped to ${t.number}, which is not exactly one active postable account)`); continue; }
      map.set(code, hit[0]!.external_id);
      numbers.set(code, t.number);
      labels.set(code, `Purser ${code} ${CHART[code] ?? ""}`.trim());
      continue;
    }
    if (!same.length) missing.push(code);
    else if (!usable.length) unpostable.push(code);
    else if (usable.length > 1) ambiguous.push(code);
    else {
      const a = usable[0]!;
      map.set(code, a.external_id);
      numbers.set(code, code);
      const want = t0AccountType(code);
      if (want && a.account_type !== want) warnings.push(`${code} is ${a.account_type} in T:0; we expected ${want}`);
      if (a.currency) warnings.push(`${code} is denominated in ${a.currency} in T:0: lines in another currency will be refused`);
    }
  }
  const bad = [...missing, ...unpostable, ...ambiguous].sort();
  if (bad.length) {
    const parts = [missing.length && `missing: ${missing.join(", ")}`, unpostable.length && `not postable or inactive: ${unpostable.join(", ")}`, ambiguous.length && `more than one postable account: ${ambiguous.join(", ")}`].filter(Boolean);
    throw new Error(`T:0 has no usable account for ${bad.join(", ")} (${parts.join("; ")}). Create them in T:0 with account_number = our code (docs/t0.md).`);
  }
  return { map, warnings, numbers, labels };
}

// ---- Building entries ----

/** Units of the functional currency for one unit of `currency` on `date` (YYYY-MM-DD); undefined when unknown. */
export type T0Rate = (date: string, currency: string) => number | undefined;

export interface T0Entry {
  /** From the entry's content (kind, ref, date, accounts, amounts), so it survives Purser renumbering its entries. */
  stableId: string;
  jeNumber: string;
  idempotencyKey: string;
  request: T0JournalEntryRequest;
  /** Our account code for each line, in line order. */
  accounts: string[];
  atomsPerUnit: number;
}

export const TEST_USD_TAG = "[test USD, Metal testnet]";
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** JSON with keys sorted at every level, so the same payload always hashes the same. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, x]) => `${JSON.stringify(k)}:${canonical(x)}`).join(",")}}`;
  }
  return JSON.stringify(v);
}

const t0Currency = (cur: string) => (cur === "USDZ" ? "USD" : cur);
const memoOf = (s: string) => (s.length > 1000 ? s.slice(0, 999) + "…" : s);

/** Purser's postings grouped by journal entry, in first-seen order. */
function groups(postings: Posting[]): Posting[][] {
  const by = new Map<string, Posting[]>();
  for (const p of postings) {
    const g = by.get(p.entry);
    if (g) g.push(p);
    else by.set(p.entry, [p]);
  }
  return [...by.values()];
}

/**
 * One T:0 journal entry per Purser journal entry. Amounts go in the functional currency (amount_atoms, converted at
 * `rate`), with the original amount as transaction_amount_atoms when the currency differs. *USDZ is posted as USD and
 * tagged as test money in the memo. Every unmapped account and every missing rate is listed in one error, before
 * anything is posted.
 */
export function buildEntries(postings: Posting[], accountMap: ReadonlyMap<string, string>, functionalCurrency: string, rate: T0Rate, o: { atomsPerUnit?: number; /** our code to a memo prefix, for accounts that share a T:0 account */ labels?: ReadonlyMap<string, string> } = {}): T0Entry[] {
  const functional = functionalCurrency.toUpperCase();
  const atomsPerUnit = o.atomsPerUnit ?? 100;
  const gs = groups(postings);
  const unmapped = [...new Set(postings.map((p) => p.account).filter((a) => !accountMap.has(a)))].sort();
  if (unmapped.length) throw new Error(`no T:0 account for ${unmapped.join(", ")}`);
  const noRate = new Set<string>(), problems: string[] = [];
  const out: T0Entry[] = [];
  const seen = new Map<string, number>();
  for (const g of gs) {
    const first = g[0]!;
    const date = first.date.slice(0, 10);
    const cur = t0Currency(first.currency);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { problems.push(`entry ${first.entry} has no date`); continue; }
    if (!/^[A-Z]{3}$/.test(cur) || g.some((p) => t0Currency(p.currency) !== cur)) { problems.push(`entry ${first.entry} has currency ${g.map((p) => p.currency).join("/")}`); continue; }
    const foreign = cur !== functional;
    const r = foreign ? rate(date, cur) : 1;
    if (r === undefined || !Number.isFinite(r) || r <= 0) { noRate.add(`${cur} on ${date}`); continue; }

    const lines = g.map((p) => {
      const cents = p.debit_cents || p.credit_cents;
      return { p, cents, debit: p.debit_cents > 0, atoms: Math.round((cents * r * atomsPerUnit) / 100) };
    });
    // Rounding each line on its own can leave a debit/credit gap of an atom: the largest line on the short side takes it.
    const gap = lines.reduce((s, l) => s + (l.debit ? l.atoms : -l.atoms), 0);
    if (gap !== 0) {
      const short = lines.filter((l) => l.debit === gap < 0).sort((a, b) => b.atoms - a.atoms)[0];
      if (short) short.atoms += Math.abs(gap);
    }
    if (lines.some((l) => l.cents <= 0 || l.atoms <= 0)) { problems.push(`entry ${first.entry} has a line that is zero in ${functional}`); continue; }

    const content = `${first.entry.startsWith("O-") ? "opening" : "journal"}|${first.ref}|${first.date}|${g.map((p) => `${p.account}:${p.debit_cents}:${p.credit_cents}:${p.currency}`).join(",")}`;
    const n = (seen.get(content) ?? 0) + 1;
    seen.set(content, n);
    const stableId = n === 1 ? content : `${content}#${n}`;
    const jeNumber = `PUR-${sha256(stableId).slice(0, 24)}`;
    const memo = first.currency === "USDZ" ? `${first.description} ${TEST_USD_TAG}` : first.description;
    const request: T0JournalEntryRequest = {
      entry_date: date, currency: functional, ...(foreign ? { transaction_currency: cur } : {}), memo: memoOf(memo), je_number: jeNumber,
      lines: lines.map((l) => {
        const lineMemo = [o.labels?.get(l.p.account), l.p.cost_centre && `cost centre ${l.p.cost_centre}`, l.p.proof && `proof ${l.p.proof}`].filter(Boolean).join("; ");
        return {
          gl_account_id: accountMap.get(l.p.account)!, line_type: l.debit ? "debit" as const : "credit" as const, amount_atoms: l.atoms,
          ...(foreign ? { transaction_amount_atoms: l.cents } : {}), ...(lineMemo ? { memo: memoOf(lineMemo) } : {}),
        };
      }),
    };
    out.push({ stableId, jeNumber, idempotencyKey: sha256(stableId + canonical(request)), request, accounts: g.map((p) => p.account), atomsPerUnit });
  }
  if (noRate.size) problems.unshift(`no rate to ${functional} for ${[...noRate].sort().join(", ")}`);
  if (problems.length) throw new Error(`cannot post to T:0: ${problems.join("; ")}`);
  return out;
}

// ---- Pushing ----

export interface T0PushResult {
  posted: { je_number: string; id: string; stable_id: string }[];
  skipped: { je_number: string; reason: "in T:0" | "posted before" | "idempotency key already used" }[];
}

/**
 * Posts the entries T:0 does not have yet. First lists T:0's manual entries over the entries' dates (its keys last an
 * hour; our je_numbers last), then skips those and the ones in `alreadyPosted`; a 409 CAPI34 counts as posted.
 * `onPosted` runs after each post, so a caller can record it at once. Stops at the first other error.
 */
export async function pushBooks(
  client: Pick<T0Client, "listJournalEntries" | "postJournalEntry">, entries: T0Entry[], alreadyPosted: ReadonlySet<string>,
  onPosted?: (p: T0PushResult["posted"][number], entry: T0Entry) => void,
): Promise<T0PushResult> {
  const result: T0PushResult = { posted: [], skipped: [] };
  if (!entries.length) return result;
  const dates = entries.map((e) => e.request.entry_date).sort();
  const inT0 = new Set<string>();
  for await (const je of client.listJournalEntries({ dateFrom: dates[0], dateTo: dates.at(-1), source: ["manual"] })) { if (je.je_number) inT0.add(je.je_number); }
  for (const e of entries) {
    if (inT0.has(e.jeNumber)) { result.skipped.push({ je_number: e.jeNumber, reason: "in T:0" }); continue; }
    if (alreadyPosted.has(e.jeNumber)) { result.skipped.push({ je_number: e.jeNumber, reason: "posted before" }); continue; }
    try {
      const je = await client.postJournalEntry(e.request, e.idempotencyKey);
      const p = { je_number: e.jeNumber, id: je.id, stable_id: e.stableId };
      result.posted.push(p);
      onPosted?.(p, e);
    } catch (err) {
      if (err instanceof T0Error && err.status === 409 && err.code === "CAPI34") { result.skipped.push({ je_number: e.jeNumber, reason: "idempotency key already used" }); continue; }
      throw err;
    }
  }
  return result;
}

/** The je_numbers this ledger has posted to T:0 (the t0_postings table, made here when missing). */
export function t0Posted(db: DB): Set<string> {
  db.exec("CREATE TABLE IF NOT EXISTS t0_postings (je_number TEXT PRIMARY KEY, stable_id TEXT NOT NULL, t0_id TEXT NOT NULL, idempotency_key TEXT NOT NULL, posted_at TEXT NOT NULL)");
  return new Set((db.prepare("SELECT je_number FROM t0_postings").all() as { je_number: string }[]).map((r) => r.je_number));
}

/** Records one posted entry, so a later push skips it (t0Posted must have run on this ledger). */
export function recordT0Posting(db: DB, p: T0PushResult["posted"][number], e: T0Entry, now = new Date()): void {
  db.prepare("INSERT OR REPLACE INTO t0_postings (je_number, stable_id, t0_id, idempotency_key, posted_at) VALUES (?, ?, ?, ?, ?)").run(p.je_number, p.stable_id, p.id, e.idempotencyKey, now.toISOString());
}

// ---- Comparing ----

/** Our trial balance in the functional currency, from the entries as built (cents of the functional currency). */
export function trialInFunctional(entries: T0Entry[]): TrialRow[] {
  const rows = new Map<string, TrialRow>();
  for (const e of entries) {
    e.request.lines.forEach((l, i) => {
      const account = e.accounts[i]!;
      const cents = Math.round((l.amount_atoms * 100) / e.atomsPerUnit);
      const r = rows.get(account) ?? { account, name: CHART[account] ?? "", currency: e.request.currency, debit_cents: 0, credit_cents: 0, balance_cents: 0 };
      if (l.line_type === "debit") r.debit_cents += cents;
      else r.credit_cents += cents;
      r.balance_cents = r.debit_cents - r.credit_cents;
      rows.set(account, r);
    });
  }
  return [...rows.values()].sort((a, b) => a.account.localeCompare(b.account));
}

export interface T0ComparisonRow { account: string; name: string; ours_atoms: number; t0_atoms: number; diff_atoms: number }
export interface T0Comparison {
  /** True only when every P&L account agrees to the atom: then, and only then, "matches our Books line by line". */
  matches: boolean;
  currency: string;
  rows: T0ComparisonRow[];
  differences: T0ComparisonRow[];
}

const isPl = (code: string) => /^[4-9]/.test(code);
const creditNormal = (code: string) => {
  const t = t0AccountType(code);
  return t ? t === "income" || t === "other_income" : code.startsWith("4");
};

/**
 * Our trial balance against T:0's P&L, per account (by account_number), summed over the report's periods. Our rows
 * must be in the report's currency (*USDZ counts as USD); convert others with trialInFunctional first. We assume
 * T:0 shows income and expenses positive in their normal direction (a refund, debit to income, shows negative).
 */
export function compareReports(rows: TrialRow[], pl: T0ProfitLoss): T0Comparison {
  const currency = pl.reporting_currency.toUpperCase();
  const ours = new Map<string, { name: string; cents: number }>();
  for (const r of rows) {
    if (!isPl(r.account)) continue;
    if (t0Currency(r.currency) !== currency) throw new Error(`trial row ${r.account} is in ${r.currency} but the T:0 report is in ${currency}: convert with trialInFunctional first`);
    const o = ours.get(r.account) ?? { name: r.name, cents: 0 };
    o.cents += creditNormal(r.account) ? -r.balance_cents : r.balance_cents;
    ours.set(r.account, o);
  }
  const theirs = new Map<string, { name: string; atoms: number }>();
  const sum = (b: T0Balances | undefined) => Object.values(b ?? {}).reduce<number>((s, v) => s + (v ?? 0), 0);
  const add = (key: string, name: string, atoms: number) => {
    const t = theirs.get(key) ?? { name, atoms: 0 };
    t.atoms += atoms;
    theirs.set(key, t);
  };
  const walk = (a: T0ReportAccount) => {
    const key = a.account_number ?? a.account_id;
    if (a.children?.length) {
      if (a.own_balances) add(key, a.name, sum(a.own_balances));
      a.children.forEach(walk);
    } else add(key, a.name, sum(a.balances));
  };
  for (const s of pl.sections) if (!s.is_computed) (s.children ?? []).forEach(walk);

  const out: T0ComparisonRow[] = [];
  for (const account of [...new Set([...ours.keys(), ...theirs.keys()])].sort()) {
    const o = ours.get(account), t = theirs.get(account);
    const oursAtoms = o ? Math.round((o.cents * pl.atoms_per_unit) / 100) : 0;
    const t0Atoms = t?.atoms ?? 0;
    if (!o && t0Atoms === 0) continue;
    out.push({ account, name: o?.name || t?.name || "", ours_atoms: oursAtoms, t0_atoms: t0Atoms, diff_atoms: oursAtoms - t0Atoms });
  }
  const differences = out.filter((r) => r.diff_atoms !== 0);
  return { matches: differences.length === 0, currency, rows: out, differences };
}

// ---- Comparing only our own entries (a shared T:0 entity holds other people's books too) ----

export interface T0OwnRow { account: string; ours_atoms: number; t0_atoms: number; diff_atoms: number; ours_codes: string[] }
export interface T0OwnComparison { matches: boolean; currency: string; entries_in_t0: number; entries_ours: number; foreign_entries: number; rows: T0OwnRow[]; differences: T0OwnRow[] }

/**
 * Our entries as T:0 holds them against what we built, per T:0 account number. Only T:0 entries whose je_number starts
 * with `PUR-` count; everything else in the entity is ignored. Both sides are net debit minus credit in atoms, our side
 * rolled up by `numbers` (our code to the T:0 account number). Matches only when every account agrees to the atom
 * and the same je_numbers are on both sides.
 */
export function compareOwnEntries(ours: T0Entry[], numbers: ReadonlyMap<string, string>, inT0: T0JournalEntry[]): T0OwnComparison {
  const mine = inT0.filter((e) => e.je_number?.startsWith("PUR-"));
  const o = new Map<string, { atoms: number; codes: Set<string> }>(), t = new Map<string, number>();
  for (const e of ours) {
    e.request.lines.forEach((l, i) => {
      const code = e.accounts[i]!, key = numbers.get(code) ?? code;
      const r = o.get(key) ?? { atoms: 0, codes: new Set<string>() };
      r.atoms += l.line_type === "debit" ? l.amount_atoms : -l.amount_atoms;
      r.codes.add(code);
      o.set(key, r);
    });
  }
  for (const e of mine) for (const l of e.lines) {
    const key = l.account_number ?? l.account_id;
    t.set(key, (t.get(key) ?? 0) + (l.line_type === "debit" ? l.amount_atoms : -l.amount_atoms));
  }
  const rows: T0OwnRow[] = [...new Set([...o.keys(), ...t.keys()])].sort().map((account) => {
    const a = o.get(account)?.atoms ?? 0, b = t.get(account) ?? 0;
    return { account, ours_atoms: a, t0_atoms: b, diff_atoms: a - b, ours_codes: [...(o.get(account)?.codes ?? [])].sort() };
  });
  const wanted = new Set(ours.map((e) => e.jeNumber)), have = new Set(mine.map((e) => e.je_number));
  const sameSet = wanted.size === have.size && [...wanted].every((j) => have.has(j));
  const differences = rows.filter((r) => r.diff_atoms !== 0);
  return {
    matches: differences.length === 0 && sameSet, currency: mine[0]?.currency ?? ours[0]?.request.currency ?? "", entries_in_t0: mine.length,
    entries_ours: ours.length, foreign_entries: inT0.length - mine.length, rows, differences,
  };
}
