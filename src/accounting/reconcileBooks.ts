// Reconciling Purser's books with the outside books (npm run reconcile-books, docs/reconcile-books.md). Per document,
// Purser's own figures (what the ledger feeds the outside books, src/erp/source.ts) are set next to what the outside
// books hold: net, VAT, gross, the amount paid and the state, to the cent. Each difference names both figures and the
// exact difference; a figure the outside books could not give is "not compared", never counted as equal.
//
// The comparison is one pure function (reconcileBooks). Reading the outside books is separate and read-only:
//   - a bookkeeping package (an ERP connector, src/erp): the document it holds for each invoice Purser sent, read back
//     when the connector can (readPurchaseInvoice), else only whether it is paid (pullPaymentStatus);
//   - T:0: its own balance sheet must balance in every period (balanceSheetCheck), Purser's entries in T:0 must equal
//     the ones built from Purser's books (compareOwnEntries), and each payment Purser made must be in T:0 with its
//     amount. T:0 holds journal entries, not invoices: net, VAT, gross and state are not compared there.
// The result is kept as one audit row (books.reconciled), which the payables server reads back.

import { audit } from "../audit/log.js";
import type { DB } from "../db/open.js";
import type { ErpConnector, RefResolver } from "../erp/connector.js";
import type { Payment, PurchaseInvoice, Vendor } from "../erp/model.js";
import { syncStatus, type SyncItem } from "../erp/sync.js";
import { fromCents } from "../lib/money.js";
import { redactSecrets } from "../lib/redact.js";
import type { T0MapTarget } from "../config/t0Map.js";
import type { Posting } from "./books.js";
import { balanceSheetCheck, buildEntries, compareOwnEntries, functionalCurrency, resolveAccounts, type T0Client, type T0JournalEntry, type T0Rate } from "./t0.js";

export const FIELDS = ["net", "vat", "gross", "paid", "state"] as const;
export type Field = (typeof FIELDS)[number];
export type DocState = "open" | "partly_paid" | "paid";

const FIELD_WORDS: Record<Field, string> = { net: "net", vat: "VAT", gross: "gross", paid: "paid", state: "state" };

/** One document as Purser's ledger holds it. */
export interface PurserDoc {
  /** The ledger's key of the invoice ("NUM · Supplier" for the payables inbox). */
  key: string;
  number: string;
  supplier: string;
  currency: string;
  net_cents: number;
  vat_cents: number;
  gross_cents: number;
  paid_cents: number;
  state: DocState;
  /** Purser's payments of it: Purser's request id and the amount. */
  payments: { id: string; cents: number }[];
}

/** One document as the outside books hold it; null where they could not say. */
export interface OutsideDoc {
  key: string;
  number?: string;
  supplier?: string;
  external_id?: string | null;
  currency?: string | null;
  net_cents: number | null;
  vat_cents: number | null;
  gross_cents: number | null;
  paid_cents: number | null;
  state: DocState | null;
  /** Why figures are missing (a read that failed), in words. */
  note?: string;
}

export interface FieldDifference {
  field: Field | "currency";
  ours: string;
  theirs: string;
  /** Purser's figure minus the outside books', in cents (amounts only). */
  diff_cents?: number;
}

export type DocOutcome = "equal" | "differs" | "missing outside" | "only outside";

export interface DocResult {
  key: string;
  number: string;
  supplier: string;
  currency: string;
  outcome: DocOutcome;
  differences: FieldDifference[];
  /** Figures these books hold that could not be read for this document: not compared, never equal. */
  not_compared: Field[];
  /** Purser's payments that the outside books do not show. */
  missing_payments: { id: string; cents: number }[];
  external_id: string | null;
  note?: string;
}

/** A check of the outside books as a whole (T:0's balance sheet); ok null when it could not be made. */
export interface BooksCheck { name: string; ok: boolean | null; detail: string }

export interface Reconciliation {
  books: string;
  verdict: "agree" | "differ" | "partly compared";
  /** The figures these books hold and that were set side by side. */
  compared: Field[];
  documents: number;
  counts: { equal: number; differs: number; missing_outside: number; only_outside: number; not_compared: number };
  results: DocResult[];
  checks: BooksCheck[];
  /** What this reconciliation cannot see, in words. */
  limits: string[];
}

/** Cents as 12.34, with a sign when negative. */
export const money = (c: number): string => (c < 0 ? `-${fromCents(-c)}` : fromCents(c));

const byKey = <T extends { key: string }>(a: T, b: T) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

export function stateOf(paidCents: number, grossCents: number): DocState {
  if (grossCents > 0 && paidCents >= grossCents) return "paid";
  return paidCents > 0 ? "partly_paid" : "open";
}

/**
 * Sets Purser's documents next to the outside books', by key. Pure: the same lists give the same result, in key order.
 * `compared` are the figures these books hold (all five by default); the others are left out for every document and
 * said once in `limits`.
 */
export function reconcileBooks(books: string, ours: PurserDoc[], theirs: OutsideDoc[], o: { compared?: readonly Field[]; checks?: BooksCheck[]; limits?: string[] } = {}): Reconciliation {
  const compared = FIELDS.filter((f) => (o.compared ?? FIELDS).includes(f));
  const outside = new Map<string, OutsideDoc>();
  const extra: OutsideDoc[] = [];
  for (const t of [...theirs].sort(byKey)) (outside.has(t.key) ? extra : (outside.set(t.key, t), [])).push(t);
  const results: DocResult[] = [];
  const known = new Set<string>();
  for (const d of [...ours].sort(byKey)) {
    known.add(d.key);
    const base = { key: d.key, number: d.number, supplier: d.supplier, currency: d.currency };
    const t = outside.get(d.key);
    if (!t) {
      results.push({ ...base, outcome: "missing outside", differences: [], not_compared: [], missing_payments: [...d.payments], external_id: null });
      continue;
    }
    const differences: FieldDifference[] = [];
    const notCompared: Field[] = [];
    if (t.currency && t.currency !== d.currency) differences.push({ field: "currency", ours: d.currency, theirs: t.currency });
    const amounts: Record<Exclude<Field, "state">, [number, number | null]> = {
      net: [d.net_cents, t.net_cents], vat: [d.vat_cents, t.vat_cents], gross: [d.gross_cents, t.gross_cents], paid: [d.paid_cents, t.paid_cents],
    };
    for (const f of compared) {
      if (f === "state") {
        if (t.state === null) notCompared.push(f);
        else if (t.state !== d.state) differences.push({ field: f, ours: d.state, theirs: t.state });
        continue;
      }
      const [a, b] = amounts[f];
      if (b === null) notCompared.push(f);
      else if (a !== b) differences.push({ field: f, ours: money(a), theirs: money(b), diff_cents: a - b });
    }
    // The payments the outside books lack: all of them when they show none, else the one that is exactly the gap.
    let missing: { id: string; cents: number }[] = [];
    if (compared.includes("paid") && t.paid_cents !== null && t.paid_cents < d.paid_cents) {
      const gap = d.paid_cents - t.paid_cents;
      const one = d.payments.filter((p) => p.cents === gap);
      missing = t.paid_cents === 0 ? [...d.payments] : one.length === 1 ? one : [];
    }
    results.push({
      ...base, outcome: differences.length ? "differs" : "equal", differences, not_compared: notCompared, missing_payments: missing, external_id: t.external_id ?? null,
      ...(t.note ? { note: t.note } : {}),
    });
  }
  for (const t of [...[...outside.values()].filter((x) => !known.has(x.key)), ...extra].sort(byKey)) {
    results.push({
      key: t.key, number: t.number ?? t.key, supplier: t.supplier ?? "", currency: t.currency ?? "", outcome: "only outside", differences: [], not_compared: [], missing_payments: [],
      external_id: t.external_id ?? null, ...(t.note ? { note: t.note } : {}),
    });
  }
  const n = (x: DocOutcome) => results.filter((r) => r.outcome === x).length;
  const counts = { equal: n("equal"), differs: n("differs"), missing_outside: n("missing outside"), only_outside: n("only outside"), not_compared: results.reduce((s, r) => s + r.not_compared.length, 0) };
  const checks = o.checks ?? [];
  const differ = counts.differs + counts.missing_outside + counts.only_outside > 0 || checks.some((c) => c.ok === false);
  const open = counts.not_compared > 0 || checks.some((c) => c.ok === null);
  return { books, verdict: differ ? "differ" : open ? "partly compared" : "agree", compared, documents: results.length, counts, results, checks, limits: o.limits ?? [] };
}

/** The reconciliation in lines a CFO reads: the verdict, then each document that is not equal, the checks, the limits. */
export function reconciliationLines(r: Reconciliation): string[] {
  const fields = r.compared.map((f) => FIELD_WORDS[f]).join(", ");
  const out: string[] = [];
  if (r.verdict === "agree") out.push(`Purser and ${r.books} agree: ${r.documents} document(s), compared on ${fields || "nothing"}.`);
  else if (r.verdict === "differ") out.push(`Purser and ${r.books} differ: ${r.counts.differs} document(s) with a difference, ${r.counts.missing_outside} missing in ${r.books}, ${r.counts.only_outside} only in ${r.books}.`);
  else out.push(`Purser and ${r.books}: no difference found, but not everything could be compared (${r.counts.not_compared} figure(s)).`);
  for (const d of r.results) {
    const name = `${d.number}${d.supplier ? `, ${d.supplier}` : ""}`;
    if (d.outcome === "missing outside") out.push(`  ${name}: not in ${r.books}`);
    if (d.outcome === "only outside") out.push(`  ${name}: only in ${r.books}${d.external_id ? ` (${d.external_id})` : ""}`);
    for (const x of d.differences) out.push(`  ${name}: ${x.field === "currency" ? "currency" : FIELD_WORDS[x.field]}: Purser ${x.ours}, ${r.books} ${x.theirs}${x.diff_cents !== undefined ? ` (difference ${money(x.diff_cents)})` : ""}`);
    for (const p of d.missing_payments) out.push(`  ${name}: payment ${p.id} of ${d.currency} ${money(p.cents)} is not in ${r.books}`);
    if (d.not_compared.length) out.push(`  ${name}: not compared: ${d.not_compared.map((f) => FIELD_WORDS[f]).join(", ")}${d.note ? ` (${d.note})` : ""}`);
  }
  for (const c of r.checks) out.push(`Check: ${c.name}: ${c.ok === null ? "could not be made" : c.ok ? "yes" : "no"}${c.detail ? ` (${c.detail})` : ""}`);
  for (const l of r.limits) out.push(`Not compared here: ${l}`);
  return out;
}

// ---- Purser's side ----

/** Purser's documents from what the ledger feeds the outside books: each invoice with its payments in its currency. */
export function purserDocs(items: SyncItem[]): PurserDoc[] {
  const vendors = new Map(items.filter((i) => i.kind === "vendor").map((i) => [i.object.id, (i.object as Vendor).name]));
  const paid = new Map<string, { id: string; cents: number; currency: string }[]>();
  for (const i of items) {
    if (i.kind !== "payment") continue;
    const p = i.object as Payment;
    paid.set(p.invoiceId, [...(paid.get(p.invoiceId) ?? []), { id: p.id, cents: p.amountCents, currency: p.currency }]);
  }
  return items.filter((i) => i.kind === "invoice").map((i) => {
    const inv = i.object as PurchaseInvoice;
    const payments = (paid.get(inv.id) ?? []).filter((p) => p.currency === inv.currency).map(({ id, cents }) => ({ id, cents }));
    const paidCents = payments.reduce((s, p) => s + p.cents, 0);
    return {
      key: inv.id, number: inv.number, supplier: vendors.get(inv.vendorId) ?? "", currency: inv.currency,
      net_cents: inv.totals.netCents, vat_cents: inv.totals.vatCents, gross_cents: inv.totals.grossCents, paid_cents: paidCents, state: stateOf(paidCents, inv.totals.grossCents), payments,
    };
  }).sort(byKey);
}

// ---- A bookkeeping package (ERP connector) ----

/** A purchase invoice as a connector reads it back (src/erp/moneybird.ts readPurchaseInvoice has this shape). */
export interface ReadBackDocument { netCents: number | null; grossCents: number | null; state: string; payments: { cents: number | null }[] }
export type ReadsBack = { readPurchaseInvoice?(externalId: string): Promise<ReadBackDocument> };

/**
 * A failure's words with no credential in them: the runner's known secrets, the values of `secrets` (the outside
 * books' own settings), and any key, token, secret or password in a URL's query.
 */
export function scrub(text: string, secrets: (string | undefined)[] = []): string {
  let out = redactSecrets(text);
  for (const v of secrets) if (v && v.length >= 8) out = out.split(v).join("[redacted]");
  return out.replace(/([?&][^=\s&]*(?:key|token|secret|password)[^=\s&]*=)[^&\s]+/gi, "$1[redacted]").replace(/\s+/g, " ");
}

/** The package's own words for a purchase invoice's state, as Purser's three. */
function outsideState(word: string, paidCents: number | null): DocState | null {
  if (word === "paid") return "paid";
  if (["new", "open", "late", "pending_payment", "unpaid"].includes(word)) return paidCents === null ? "open" : paidCents > 0 ? "partly_paid" : "open";
  return null;
}

/**
 * Reads the package's document for each invoice Purser feeds it: by the id the sync recorded, else by a look-up
 * (findExisting). Read-only. A read that fails leaves that document's figures not compared, with the reason.
 */
export async function readConnector(db: DB, c: ErpConnector & ReadsBack, items: SyncItem[], o: { secrets?: (string | undefined)[] } = {}): Promise<{ docs: OutsideDoc[]; compared: Field[]; limits: string[] }> {
  const rows = syncStatus(db, c.name);
  const sent = (kind: string, id: string) => {
    const r = rows.find((x) => x.kind === kind && x.object_id === id);
    return r && r.external_id && (r.status === "synced" || r.status === "needs_correction") ? r.external_id : null;
  };
  const refs: RefResolver = { vendor: (id) => sent("vendor", id), invoice: (id) => sent("invoice", id) };
  const readBack = typeof c.readPurchaseInvoice === "function";
  const docs: OutsideDoc[] = [];
  for (const it of items.filter((i) => i.kind === "invoice")) {
    const inv = it.object as PurchaseInvoice;
    let ext = sent("invoice", inv.id);
    try {
      ext ??= await c.findExisting("invoice", inv, refs);
      if (!ext) continue;
      if (readBack) {
        const d = await c.readPurchaseInvoice!(ext);
        const paidCents = d.payments.some((p) => p.cents === null) ? null : d.payments.reduce((s, p) => s + (p.cents ?? 0), 0);
        docs.push({
          key: inv.id, external_id: ext, net_cents: d.netCents, gross_cents: d.grossCents, vat_cents: d.netCents === null || d.grossCents === null ? null : d.grossCents - d.netCents,
          paid_cents: paidCents, state: outsideState(d.state, paidCents),
        });
      } else {
        const s = await c.pullPaymentStatus(inv, ext, refs);
        docs.push({ key: inv.id, external_id: ext, net_cents: null, vat_cents: null, gross_cents: null, paid_cents: null, state: s === "paid" ? "paid" : s === "partial" ? "partly_paid" : s === "unpaid" ? "open" : null });
      }
    } catch (e) {
      docs.push({ key: inv.id, external_id: ext, net_cents: null, vat_cents: null, gross_cents: null, paid_cents: null, state: null, note: `could not be read: ${scrub((e as Error)?.message ?? String(e), o.secrets).slice(0, 200)}` });
    }
  }
  const limits = [`a document only in ${c.name} is not found: the connector cannot list what it holds`];
  if (!readBack) limits.unshift(`${c.name} cannot read an invoice back here: net, VAT, gross and the amount paid are not compared, only whether it is paid`);
  return { docs, compared: readBack ? [...FIELDS] : ["state"], limits };
}

// ---- T:0 ----

export type T0Reader = Pick<T0Client, "listGlAccounts" | "profitLoss" | "listJournalEntries" | "balanceSheet">;

/** The cents of a T:0 entry's debit side, in the original currency (transaction amounts for a foreign entry). */
function debitCents(je: T0JournalEntry): number {
  const debit = je.lines.filter((l) => l.line_type === "debit");
  if (je.transaction_currency && je.transaction_currency !== je.currency) return debit.reduce((s, l) => s + (l.transaction_amount_atoms ?? 0), 0);
  return Math.round((debit.reduce((s, l) => s + l.amount_atoms, 0) * 100) / (je.atoms_per_unit || 100));
}

/**
 * T:0's side: for each of Purser's documents, the payments T:0 holds (each payment's entry is found by the je_number
 * Purser gives it, src/accounting/t0.ts buildEntries), T:0's balance sheet per month, and Purser's entries in T:0
 * against the ones built from Purser's books. Read-only.
 */
export async function readT0(client: T0Reader, postings: Posting[], ours: PurserDoc[], o: { rate: T0Rate; fallback?: Record<string, T0MapTarget> }): Promise<{ docs: OutsideDoc[]; compared: Field[]; checks: BooksCheck[]; limits: string[] }> {
  const limits = ["T:0 holds journal entries, not invoices: net, VAT, gross and state are not compared there, only the amount paid"];
  const dates = postings.map((p) => p.date.slice(0, 10)).sort();
  if (!dates.length) return { docs: ours.map((d) => ({ key: d.key, net_cents: null, vat_cents: null, gross_cents: null, paid_cents: 0, state: null })), compared: ["paid"], checks: [], limits };
  const from = dates[0]!, to = dates.at(-1)!;
  const { currency, atomsPerUnit } = await functionalCurrency(client);
  const { map, numbers, labels } = resolveAccounts(await client.listGlAccounts(), postings.map((p) => p.account), o.fallback ? { fallback: o.fallback } : {});
  const entries = buildEntries(postings, map, currency, o.rate, { atomsPerUnit, labels });
  const held: T0JournalEntry[] = [];
  for await (const je of client.listJournalEntries({ dateFrom: from, dateTo: to, source: ["manual"] })) held.push(je);
  const inT0 = new Map(held.filter((e) => e.je_number).map((e) => [e.je_number!, e]));
  // A payment's own entry: the GL journal names it "Invoice <key>" under the payment's request id (src/accounting/gl.ts).
  const entryOf = new Map(entries.filter((e) => e.request.memo?.startsWith("Invoice ")).map((e) => [e.stableId.split("|")[1] ?? "", e]));
  const docs: OutsideDoc[] = ours.map((d) => {
    let paid = 0;
    for (const p of d.payments) {
      const je = entryOf.get(p.id);
      const there = je ? inT0.get(je.jeNumber) : undefined;
      if (there) paid += debitCents(there);
    }
    return { key: d.key, net_cents: null, vat_cents: null, gross_cents: null, paid_cents: paid, state: null };
  });
  const checks: BooksCheck[] = [];
  const sheet = balanceSheetCheck(await client.balanceSheet({ start_date: `${from.slice(0, 7)}-01`, end_date: to, period_type: "monthly" }));
  const withData = sheet.filter((p) => !p.noData);
  const off = withData.filter((p) => !p.balances);
  checks.push({
    name: "T:0's balance sheet balances in every month", ok: withData.length === 0 ? null : off.length === 0,
    detail: withData.length === 0 ? "T:0 has no figures for these months" : off.length ? off.map((p) => `${p.period}: assets minus liabilities and equity is ${p.difference.toFixed(2)} ${currency}`).join("; ") : `${withData.length} month(s)`,
  });
  const own = compareOwnEntries(entries, numbers, held);
  checks.push({
    name: "Purser's entries in T:0 equal Purser's books", ok: own.matches,
    detail: `${own.entries_ours} built from Purser's books, ${own.entries_in_t0} in T:0${own.differences.length ? `; ${own.differences.length} account(s) differ: ${own.differences.map((r) => `${r.account} by ${(r.diff_atoms / atomsPerUnit).toFixed(2)} ${currency}`).join(", ")}` : ""}`,
  });
  return { docs, compared: ["paid"], checks, limits };
}

// ---- Keeping the result ----

/** Keeps the reconciliation as one audit row: the verdict, the counts, the checks, the first 50 differences. */
export function recordReconciliation(db: DB, r: Reconciliation, now = new Date()): void {
  const differences = r.results.filter((d) => d.outcome !== "equal" || d.not_compared.length).slice(0, 50).map((d) => ({
    key: d.key, outcome: d.outcome, ...(d.differences.length ? { differences: d.differences } : {}), ...(d.missing_payments.length ? { missing_payments: d.missing_payments } : {}),
    ...(d.not_compared.length ? { not_compared: d.not_compared } : {}), ...(d.note ? { note: d.note } : {}),
  }));
  audit(db, "system", "books.reconciled", r.books, { books: r.books, verdict: r.verdict, compared: r.compared, documents: r.documents, counts: r.counts, checks: r.checks.map((c) => ({ ...c })), limits: r.limits, differences } as never, now);
}

/** The latest reconciliation with each outside book, as kept. */
export function latestReconciliations(db: DB): { books: string; at: string; result: Record<string, unknown> }[] {
  const rows = db.prepare(`SELECT subject, ts, payload_json FROM audit_log WHERE seq IN (SELECT MAX(seq) FROM audit_log WHERE event = 'books.reconciled' GROUP BY subject) ORDER BY subject`)
    .all() as { subject: string; ts: string; payload_json: string }[];
  return rows.map((r) => ({ books: r.subject, at: r.ts, result: JSON.parse(r.payload_json) as Record<string, unknown> }));
}
