// T:0 at every payment (21 Nov, the owner: "when an agent's payment settles it is booked at once in T:0"). One T:0
// journal entry per settled payment, the moment it settles, on whichever rail it moved (an Airwallex transfer, an Alta
// transfer on testnet, a Visa card on Airwallex Issuing): Purser's own ledger lines for that payment, with the GL
// account, the cost centre, the agent who paid and the hash of the terms it paid under in every line's memo. Then a
// reconcile check sets each T:0 entry, read back from T:0, against the rail's own record, read back from the rail.
//
// - One entry per payment: its je_number is PURPAY- and a hash of the payment (id, rail reference, lines), so a
//   payment is never booked twice. PURPAY- keeps these apart from the whole-books push (PUR-, src/accounting/t0.ts):
//   with T0_PAYMENTS=on the runner books payments here and does not run that push as well (src/accounting/t0Sink.ts).
// - Idempotent three ways: the ledger's t0_payment_bookings table, T:0's own list of manual entries that day, and the
//   idempotency key (a replay within T:0's hour is a 409 CAPI34, then found in T:0's list).
// - Never in the way of a payment: the runner calls this after the payment is final; a failure is logged and the
//   next money action tries again.
// - The key is T0_API_KEY from the environment only; it is never logged or put in a record.

import { createHash } from "node:crypto";
import type { DB } from "../db/open.js";
import { audit } from "../audit/log.js";
import { CHART } from "../config/gl.js";
import { T0_SANDBOX_MAP, type T0MapTarget } from "../config/t0Map.js";
import { transactionRegister } from "../money/register.js";
import { T0Error, resolveAccounts, type T0Client, type T0JournalEntry, type T0JournalEntryRequest, type T0Rate } from "./t0.js";

/** The rails a payment settles on, as the transactions register names them. */
export type PaymentRail = "airwallex_transfer" | "metal" | "airwallex_card" | "airwallex_airi";
export const PAYMENT_RAILS: readonly PaymentRail[] = ["airwallex_transfer", "metal", "airwallex_card", "airwallex_airi"];
export const PAYMENT_RAIL_WORDS: Record<PaymentRail, string> = {
  airwallex_transfer: "Airwallex transfer (sandbox)",
  metal: "Alta transfer (testnet)",
  airwallex_card: "Visa card on Airwallex Issuing (sandbox)",
  airwallex_airi: "Visa credential via Airi (sandbox)",
};

/** One line of Purser's ledger for the payment. */
export interface PaymentLine { account: string; debit_cents: number; credit_cents: number; cost_centre: string | null }

/** A payment that has settled on its rail, with the ledger lines that book it. */
export interface SettledPayment {
  /** The transactions register's id (or the run's own id for a payment made outside a runner). */
  id: string;
  at: string;
  rail: PaymentRail;
  /** The rail's own id: Airwallex transfer id, Alta transaction hash, Airwallex card transaction id. */
  rail_ref: string;
  amount: string;
  currency: string;
  agent: string | null;
  terms_sha256: string | null;
  counterparty: string;
  description: string;
  lines: PaymentLine[];
}

/** What T:0 holds for one payment, and how it got there. */
export interface T0Booking {
  payment_id: string;
  je_number: string;
  t0_id: string;
  booked_at: string;
  entry_date: string;
  rail: PaymentRail;
  rail_ref: string;
  amount: string;
  currency: string;
  agent: string | null;
  terms_sha256: string | null;
  counterparty: string;
  /** The account the payment is charged to (its debit line that is not a bank), our code and T:0's number. */
  gl_account: string;
  gl_name: string;
  t0_account: string;
  cost_centre: string | null;
  /** The amount in T:0's functional currency, and the rate used (1 when the currency is the functional one). */
  functional: { currency: string; amount: string; rate: number };
}

/** Our codes without an account of their own number in the shared sandbox entity: the books push's map, and AP. */
export const PAYMENT_MAP: Record<string, T0MapTarget> = {
  ...T0_SANDBOX_MAP,
  "2100": { number: "21110", name: "A/P - Vendors", note: "accounts payable: a supplier invoice paid" },
};

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const isBank = (code: string) => /^12\d\d$/.test(code);
const t0Currency = (cur: string) => (cur === "USDZ" ? "USD" : cur);
const fromCents = (c: number) => `${c < 0 ? "-" : ""}${Math.floor(Math.abs(c) / 100)}.${String(Math.abs(c) % 100).padStart(2, "0")}`;
const toCents = (amount: string) => {
  const m = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(amount.trim());
  if (!m) throw new Error(`not an amount: ${amount.slice(0, 20)}`);
  const c = Number(m[2]) * 100 + Number((m[3] ?? "0").padEnd(2, "0"));
  return m[1] ? -c : c;
};
const memoOf = (s: string) => (s.length > 1000 ? `${s.slice(0, 999)}…` : s);

/** JSON with keys sorted at every level (the same payload always hashes the same). */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, x]) => `${JSON.stringify(k)}:${canonical(x)}`).join(",")}}`;
  return JSON.stringify(v);
}

/** Why a payment cannot be booked as it stands, or null. */
export function paymentProblem(p: SettledPayment): string | null {
  if (!PAYMENT_RAILS.includes(p.rail)) return `rail ${String(p.rail)} is not a payment rail`;
  if (!p.rail_ref) return "no rail reference";
  if (!/^\d{4}-\d{2}-\d{2}/.test(p.at)) return "no date";
  if (!p.lines.length) return "no ledger lines";
  const dr = p.lines.reduce((n, l) => n + l.debit_cents, 0), cr = p.lines.reduce((n, l) => n + l.credit_cents, 0);
  if (dr !== cr) return `lines do not balance (${dr} debit, ${cr} credit)`;
  if (p.lines.some((l) => (l.debit_cents > 0) === (l.credit_cents > 0) || l.debit_cents < 0 || l.credit_cents < 0)) return "a line is not one debit or one credit";
  let amount: number;
  try { amount = Math.abs(toCents(p.amount)); } catch { return "amount is not an amount"; }
  if (dr !== amount) return `lines (${fromCents(dr)}) are not the payment's amount (${p.amount})`;
  if (!p.lines.some((l) => l.credit_cents > 0 && isBank(l.account))) return "no bank account is credited";
  if (p.terms_sha256 !== null && !/^[0-9a-f]{64}$/.test(p.terms_sha256)) return "terms hash is not a SHA-256";
  return null;
}

/** The account a payment is charged to: its largest debit line that is not a bank account. */
export function chargedAccount(p: SettledPayment): PaymentLine {
  const d = p.lines.filter((l) => l.debit_cents > 0 && !isBank(l.account)).sort((a, b) => b.debit_cents - a.debit_cents)[0];
  if (!d) throw new Error(`payment ${p.id} has no debit line outside the bank accounts`);
  return d;
}

/** The memo every line of the payment's entry carries: what a reader of T:0 needs to find it in Purser. */
export function paymentMemo(p: SettledPayment, line?: PaymentLine): string {
  const gl = line ?? chargedAccount(p);
  return memoOf([
    `Purser payment ${p.id}`,
    `GL ${gl.account} ${CHART[gl.account] ?? ""}`.trim(),
    `cost centre ${gl.cost_centre ?? "none"}`,
    `agent ${p.agent ?? "none"}`,
    `terms sha256 ${p.terms_sha256 ?? "none (no signed terms)"}`,
    `${PAYMENT_RAIL_WORDS[p.rail]} ${p.rail_ref}`,
    p.currency === "USDZ" ? "[test USD, Alta testnet]" : "[test money]",
  ].join(" | "));
}

export interface T0PaymentContext {
  /** Our code to T:0's external_id and account number. */
  accounts: ReadonlyMap<string, { id: string; number: string }>;
  functional: string;
  atomsPerUnit: number;
  rate: T0Rate;
}

export interface T0PaymentEntry { jeNumber: string; idempotencyKey: string; request: T0JournalEntryRequest; rate: number; functionalCents: number }

/** The one T:0 entry for a payment: its ledger lines, in the functional currency, the original amount beside it. */
export function paymentEntry(p: SettledPayment, ctx: T0PaymentContext): T0PaymentEntry {
  const problem = paymentProblem(p);
  if (problem) throw new Error(`payment ${p.id} cannot be booked: ${problem}`);
  const missing = [...new Set(p.lines.map((l) => l.account).filter((a) => !ctx.accounts.has(a)))].sort();
  if (missing.length) throw new Error(`no T:0 account for ${missing.join(", ")}`);
  const date = p.at.slice(0, 10);
  const cur = t0Currency(p.currency);
  const functional = ctx.functional.toUpperCase();
  const foreign = cur !== functional;
  const rate = foreign ? ctx.rate(date, cur) : 1;
  if (rate === undefined || !Number.isFinite(rate) || rate <= 0) throw new Error(`no rate to ${functional} for ${cur} on ${date}`);
  const lines = p.lines.map((l) => {
    const cents = l.debit_cents || l.credit_cents;
    return { l, cents, debit: l.debit_cents > 0, atoms: Math.round((cents * rate * ctx.atomsPerUnit) / 100) };
  });
  // Rounding each line alone can leave an atom between debits and credits: the largest line on the short side takes it.
  const gap = lines.reduce((s, x) => s + (x.debit ? x.atoms : -x.atoms), 0);
  if (gap !== 0) {
    const short = lines.filter((x) => x.debit === gap < 0).sort((a, b) => b.atoms - a.atoms)[0];
    if (short) short.atoms += Math.abs(gap);
  }
  if (lines.some((x) => x.atoms <= 0)) throw new Error(`payment ${p.id} has a line that is zero in ${functional}`);
  const stable = `payment|${p.id}|${p.rail}|${p.rail_ref}|${p.lines.map((l) => `${l.account}:${l.debit_cents}:${l.credit_cents}`).join(",")}`;
  const jeNumber = `PURPAY-${sha256(stable).slice(0, 24)}`;
  const request: T0JournalEntryRequest = {
    entry_date: date, currency: functional, ...(foreign ? { transaction_currency: cur } : {}), je_number: jeNumber,
    memo: memoOf(`${p.description} | ${paymentMemo(p)}`),
    manual_entry_reason: "Purser: a payment booked the moment it settled on its rail",
    lines: lines.map((x) => ({
      gl_account_id: ctx.accounts.get(x.l.account)!.id, line_type: x.debit ? "debit" as const : "credit" as const, amount_atoms: x.atoms,
      ...(foreign ? { transaction_amount_atoms: x.cents } : {}),
      memo: memoOf(`Purser ${x.l.account} ${CHART[x.l.account] ?? ""}`.trim() + ` | ${paymentMemo(p, x.l.debit_cents > 0 && !isBank(x.l.account) ? x.l : undefined)}`),
    })),
  };
  const functionalAtoms = lines.filter((x) => x.debit).reduce((n, x) => n + x.atoms, 0);
  return { jeNumber, idempotencyKey: sha256(jeNumber + canonical(request)), request, rate, functionalCents: Math.round((functionalAtoms * 100) / ctx.atomsPerUnit) };
}

// ---- The ledger's record of what was booked ----

const TABLE = "CREATE TABLE IF NOT EXISTS t0_payment_bookings (payment_id TEXT PRIMARY KEY, je_number TEXT NOT NULL UNIQUE, t0_id TEXT NOT NULL, booked_at TEXT NOT NULL, booking_json TEXT NOT NULL)";

export function bookedPayments(db: DB): T0Booking[] {
  db.exec(TABLE);
  // In the order booked: by time, then by insertion (two bookings in the same millisecond keep the order they were made in).
  return (db.prepare("SELECT booking_json FROM t0_payment_bookings ORDER BY booked_at, rowid").all() as { booking_json: string }[]).map((r) => JSON.parse(r.booking_json) as T0Booking);
}

function bookedOne(db: DB, paymentId: string): T0Booking | null {
  db.exec(TABLE);
  const r = db.prepare("SELECT booking_json FROM t0_payment_bookings WHERE payment_id = ?").get(paymentId) as { booking_json: string } | undefined;
  return r ? (JSON.parse(r.booking_json) as T0Booking) : null;
}

// ---- Booking ----

export type BookOutcome = { status: "booked" | "found in T:0" | "booked before"; booking: T0Booking };

/**
 * Books one settled payment in T:0, once. Records it in the ledger (t0_payment_bookings) and in the audit log
 * (t0.booked: the T:0 id, the GL account, cost centre, agent and terms hash), which the cloud shows as "booked in T:0".
 */
export async function bookPayment(
  db: DB, client: Pick<T0Client, "postJournalEntry" | "listJournalEntries">, p: SettledPayment, ctx: T0PaymentContext, now?: Date,
): Promise<BookOutcome> {
  const before = bookedOne(db, p.id);
  if (before) return { status: "booked before", booking: before };
  const e = paymentEntry(p, ctx);
  const find = async (): Promise<T0JournalEntry | null> => {
    for await (const je of client.listJournalEntries({ dateFrom: e.request.entry_date, dateTo: e.request.entry_date, source: ["manual"] })) if (je.je_number === e.jeNumber) return je;
    return null;
  };
  let status: BookOutcome["status"] = "booked";
  let je = await find();
  if (je) status = "found in T:0";
  else {
    try {
      je = await client.postJournalEntry(e.request, e.idempotencyKey);
    } catch (err) {
      if (!(err instanceof T0Error && err.status === 409 && err.code === "CAPI34")) throw err;
      je = await find();
      if (!je) throw new Error(`T:0 says payment ${p.id}'s entry ${e.jeNumber} was posted, but does not list it`, { cause: err });
      status = "found in T:0";
    }
  }
  const gl = chargedAccount(p);
  // When T:0 holds it: after its answer, not before the call.
  const at = now ?? new Date();
  const booking: T0Booking = {
    payment_id: p.id, je_number: e.jeNumber, t0_id: je.id, booked_at: at.toISOString(), entry_date: e.request.entry_date,
    rail: p.rail, rail_ref: p.rail_ref, amount: p.amount, currency: p.currency, agent: p.agent, terms_sha256: p.terms_sha256, counterparty: p.counterparty,
    gl_account: gl.account, gl_name: CHART[gl.account] ?? "", t0_account: ctx.accounts.get(gl.account)!.number, cost_centre: gl.cost_centre,
    functional: { currency: e.request.currency, amount: fromCents(e.functionalCents), rate: e.rate },
  };
  db.exec(TABLE);
  db.prepare("INSERT OR IGNORE INTO t0_payment_bookings (payment_id, je_number, t0_id, booked_at, booking_json) VALUES (?, ?, ?, ?, ?)").run(p.id, e.jeNumber, je.id, booking.booked_at, JSON.stringify(booking));
  audit(db, "books", "t0.booked", p.id, { ...booking, how: status } as never, at);
  return { status, booking };
}

/** T:0's accounts for our codes (the sandbox entity's map for codes it lacks), and its functional currency. */
export async function paymentContext(client: Pick<T0Client, "listGlAccounts" | "profitLoss">, codes: Iterable<string>, rate: T0Rate, o: { sandboxMap?: boolean; today?: string } = {}): Promise<T0PaymentContext> {
  const day = o.today ?? new Date().toISOString().slice(0, 10);
  const pl = await client.profitLoss({ start_date: day, end_date: day, period_type: "monthly" });
  if (pl.reporting_currency_source !== "functional") throw new Error(`T:0 has no functional currency set for this entity (it reports in ${pl.reporting_currency} by default)`);
  const r = resolveAccounts(await client.listGlAccounts(), codes, { fallback: o.sandboxMap ? PAYMENT_MAP : undefined });
  const accounts = new Map<string, { id: string; number: string }>();
  for (const [code, id] of r.map) accounts.set(code, { id, number: r.numbers.get(code) ?? code });
  return { accounts, functional: pl.reporting_currency.toUpperCase(), atomsPerUnit: pl.atoms_per_unit, rate };
}

// ---- From the runner's own records ----

const RAIL_OF: Record<string, PaymentRail | undefined> = { airwallex_transfer: "airwallex_transfer", metal: "metal", airwallex_card: "airwallex_card", airwallex_airi: "airwallex_airi" };
const agentIn = (s: string) => /\bthe (sourcing|support|treasury|checker|payer) agent\b/i.exec(s)?.[1]?.toLowerCase() ?? null;

/** Every outgoing payment the register shows as moved on a payment rail and booked in Purser's ledger, oldest first. */
export function settledFromRegister(db: DB): SettledPayment[] {
  const out: SettledPayment[] = [];
  const linesOf = db.prepare("SELECT account, debit_cents, credit_cents, cost_centre FROM ledger_lines WHERE entry_id = ? ORDER BY line_no");
  for (const t of transactionRegister(db).rows) {
    const rail = RAIL_OF[t.rail];
    if (!rail || t.direction !== "out" || !t.moved || !t.booking.entry_ids.length || !t.proof) continue;
    const lines = t.booking.entry_ids.flatMap((id) => linesOf.all(id) as PaymentLine[]);
    out.push({
      id: t.id, at: t.at, rail, rail_ref: t.proof, amount: t.amount.replace(/^-/, ""), currency: t.currency,
      agent: agentIn(`${t.approval.authority} ${t.description}`), terms_sha256: t.approval.terms_sha256,
      counterparty: t.counterparty, description: t.description, lines,
    });
  }
  return out.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
}

export interface BookAllResult { booked: T0Booking[]; skipped: { payment_id: string; why: string }[] }

/** Books every settled payment T:0 does not hold yet. A payment that cannot be booked is skipped with why; others go on. */
export async function bookSettledPayments(
  db: DB, client: Pick<T0Client, "postJournalEntry" | "listJournalEntries" | "listGlAccounts" | "profitLoss">, rate: T0Rate,
  o: { sandboxMap?: boolean; payments?: SettledPayment[]; now?: () => Date } = {},
): Promise<BookAllResult> {
  const done = new Set(bookedPayments(db).map((b) => b.payment_id));
  const todo = (o.payments ?? settledFromRegister(db)).filter((p) => !done.has(p.id));
  const result: BookAllResult = { booked: [], skipped: [] };
  if (!todo.length) return result;
  const ok = todo.filter((p) => { const why = paymentProblem(p); if (why) result.skipped.push({ payment_id: p.id, why }); return !why; });
  if (!ok.length) return result;
  const ctx = await paymentContext(client, ok.flatMap((p) => p.lines.map((l) => l.account)), rate, { sandboxMap: o.sandboxMap });
  for (const p of ok) {
    try {
      result.booked.push((await bookPayment(db, client, p, ctx, o.now?.())).booking);
    } catch (e) {
      if (e instanceof T0Error && e.code !== "CAPI35") throw e; // T:0 itself failing stops the run; a later run goes on
      result.skipped.push({ payment_id: p.id, why: (e as Error).message.slice(0, 200) });
    }
  }
  return result;
}

// ---- The reconcile check: T:0 against the rail ----

/** A rail's own record of a payment, read back from the rail. */
export interface RailReading { status: string; settled: boolean; amount: string; currency: string; ref: string; at?: string | null }
export interface ReconCheck { name: string; ok: boolean; detail: string }
export interface ReconRow { payment_id: string; rail: PaymentRail; rail_ref: string; je_number: string; t0_id: string; ok: boolean; checks: ReconCheck[]; t0: { found: boolean; status: string | null; amount: string | null; currency: string | null }; rail_read: RailReading | null }
export interface ReconResult { at: string; ok: boolean; rows: ReconRow[] }

/** The amount T:0 holds for the entry in the payment's own currency (the original amount, or the functional one). */
function t0Amount(je: T0JournalEntry): { amount: string; currency: string } {
  const debits = je.lines.filter((l) => l.line_type === "debit");
  if (je.transaction_currency && je.transaction_currency !== je.currency) return { amount: fromCents(debits.reduce((n, l) => n + (l.transaction_amount_atoms ?? 0), 0)), currency: je.transaction_currency };
  return { amount: fromCents(Math.round((debits.reduce((n, l) => n + l.amount_atoms, 0) * 100) / (je.atoms_per_unit || 100))), currency: je.currency };
}

/** One booking against T:0's entry (read back) and the rail's record (read back). */
export function reconcileOne(b: T0Booking, je: T0JournalEntry | null, rail: RailReading | null): ReconRow {
  const checks: ReconCheck[] = [];
  const add = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });
  const cur = t0Currency(b.currency);
  const t0 = je ? t0Amount(je) : null;
  add("t0_entry_read_back", !!je && je.id === b.t0_id && je.je_number === b.je_number, je ? `T:0 ${je.id} ${je.je_number ?? "(no je_number)"}` : "T:0 does not return the entry");
  if (je) {
    add("t0_balanced", je.total_debit_atoms === je.total_credit_atoms && je.total_debit_atoms > 0, `debit ${je.total_debit_atoms}, credit ${je.total_credit_atoms} atoms`);
    add("t0_amount_is_payment", !!t0 && t0.currency === cur && t0.amount === b.amount, `T:0 ${t0?.currency} ${t0?.amount}, payment ${b.currency} ${b.amount}`);
    const memos = [je.memo ?? "", ...je.lines.map((l) => l.memo ?? "")].join(" ");
    add("t0_memo_names_payment", memos.includes(`Purser payment ${b.payment_id}`) && (b.terms_sha256 === null || memos.includes(b.terms_sha256)) && memos.includes(`agent ${b.agent ?? "none"}`), "the memo carries the payment id, its agent and its terms hash");
  }
  add("rail_read_back", !!rail && rail.ref === b.rail_ref, rail ? `${PAYMENT_RAIL_WORDS[b.rail]} ${rail.ref}: ${rail.status}` : "the rail does not return the payment");
  if (rail) {
    add("rail_settled", rail.settled, `status ${rail.status}`);
    add("rail_amount_is_t0", t0Currency(rail.currency) === cur && rail.amount === b.amount && (!t0 || (t0.amount === rail.amount && t0.currency === t0Currency(rail.currency))), `rail ${rail.currency} ${rail.amount}, T:0 ${t0 ? `${t0.currency} ${t0.amount}` : "none"}`);
  }
  return { payment_id: b.payment_id, rail: b.rail, rail_ref: b.rail_ref, je_number: b.je_number, t0_id: b.t0_id, ok: checks.every((c) => c.ok), checks,
    t0: { found: !!je, status: je?.status ?? null, amount: t0?.amount ?? null, currency: t0?.currency ?? null }, rail_read: rail };
}

/** Every booking against T:0 and its rail, each read back now. Recorded in the audit log as t0.reconciled. */
export async function reconcileBookings(
  db: DB, client: Pick<T0Client, "getJournalEntry">, readRail: (b: T0Booking) => Promise<RailReading | null>, o: { bookings?: T0Booking[]; now?: Date } = {},
): Promise<ReconResult> {
  const rows: ReconRow[] = [];
  for (const b of o.bookings ?? bookedPayments(db)) {
    let je: T0JournalEntry | null = null;
    try { je = await client.getJournalEntry(b.t0_id); } catch (e) { if (!(e instanceof T0Error && e.status === 404)) throw e; }
    // A rail that cannot answer is "no record from the rail": the check then fails, it does not stop.
    const rail = await readRail(b).catch((): RailReading | null => null);
    rows.push(reconcileOne(b, je, rail));
  }
  const at = (o.now ?? new Date()).toISOString();
  const result = { at, ok: rows.length > 0 && rows.every((r) => r.ok), rows };
  audit(db, "books", "t0.reconciled", null, { at, ok: result.ok, rows: rows.map((r) => ({ payment_id: r.payment_id, rail: r.rail, rail_ref: r.rail_ref, je_number: r.je_number, t0_id: r.t0_id, ok: r.ok, failed: r.checks.filter((c) => !c.ok).map((c) => c.name), t0_amount: r.t0.amount, t0_currency: r.t0.currency, rail_status: r.rail_read?.status ?? null, rail_amount: r.rail_read?.amount ?? null })) } as never, o.now);
  return result;
}
