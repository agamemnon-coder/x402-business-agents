// Data QA (npm run data-qa): every payment in a recorded ledger, compared one by one with the three other places that
// hold it. Airwallex (read-only GET by id: status, amount, currency), Metal (the transaction exists and succeeded,
// and carries the *USDZ transfer with the ledger's amount, payer and payee) and the Books (the double-entry postings
// for that ref, src/accounting/books.ts). Nothing is written anywhere but the report; nothing is fixed.
// The ledger is read up to one audit row (the recorded run ends at row 194), so later test runs on the same file are
// left out. Sources that are not configured are skipped with a note, never guessed.

import { doubleEntry, openingLines, type Posting } from "../accounting/books.js";
import { journal, type JournalLine } from "../accounting/gl.js";
import type { DB } from "../db/open.js";
import { baseUnitsToCents, centsToBaseUnits, fromCents, toCents } from "../lib/money.js";

export const KINDS = [
  "Airwallex transfer", "Airwallex conversion", "Airwallex deposit", "Airwallex card transaction",
  "Metal funding", "Metal sale", "Metal upstream purchase", "Metal refund", "Metal sweep", "Metal mandate",
] as const;
export type Kind = (typeof KINDS)[number];
export const SIDES = ["Airwallex", "Metal", "Books"] as const;
export type Side = (typeof SIDES)[number];

export interface Check { kind: Kind; id: string; side: Side; outcome: "match" | "difference" | "skipped"; detail: string }

/** One *USDZ (or other token) transfer a receipt carries. */
export interface ChainTransfer { token: string; from: string; to: string; value: bigint }
export interface ChainReceipt { status: "success" | "reverted"; block: number; from: string; transfers: ChainTransfer[] }

export interface QaSources {
  /** Airwallex read-only GET; absent when no sandbox keys are set. */
  awx?: (path: string, query?: Record<string, string>) => Promise<unknown>;
  awxMissing?: string;
  /** A Metal receipt, null if the chain has no such transaction; absent when no RPC is set. */
  receipt?: (tx: string) => Promise<ChainReceipt | null>;
  metalMissing?: string;
}

type AwxSpec =
  | { type: "transfer"; id: string; amount: string; currency: string; status: string; fee?: string }
  | { type: "conversion"; id: string; requestId: string; buy: string; buyCurrency: string; sell: string; sellCurrency: string; status: string }
  | { type: "deposit"; id: string; amount: string; currency: string; reference: string; since: string }
  | { type: "card"; id: string; cardId: string; amount: string; currency: string; approved: boolean; failure: string | null };
type ChainSpec = { tx: string | null; transfer?: { from: string; to: string; cents: number }; block?: number };
/** The journal lines the Books must hold for this ref; none when nothing moved (a refusal, a decline). */
type BooksSpec = { source: JournalLine["source"]; ref: string; lines: { amount: string; currency: string; proof: string }[] };

export interface Payment {
  kind: Kind;
  id: string;
  /** What the ledger says, in words. */
  ledger: string;
  /** Something about the ledger row itself that a person should look at (e.g. the audit row names another id). */
  note?: string;
  awx?: AwxSpec;
  chain?: ChainSpec;
  books?: BooksSpec;
}

const lower = (s: string) => s.toLowerCase();
const short = (s: string) => (s.length > 18 ? `${s.slice(0, 10)}…${s.slice(-4)}` : s);
const signed = (cents: number) => (cents < 0 ? `-${fromCents(-cents)}` : fromCents(cents));

/** Every payment the ledger holds up to audit row `upto`. */
export function ledgerPayments(db: DB, upto: number): Payment[] {
  const rows = db.prepare("SELECT seq, ts, event, subject, payload_json FROM audit_log WHERE seq <= ? ORDER BY seq").all(upto) as
    { seq: number; ts: string; event: string; subject: string | null; payload_json: string }[];
  const cutoff = rows.reduce((m, r) => (r.ts > m ? r.ts : m), "");
  const subjects = (prefix: string) => new Set(rows.filter((r) => r.event.startsWith(prefix)).map((r) => r.subject ?? ""));
  const payload = (r: { payload_json: string }) => JSON.parse(r.payload_json) as Record<string, unknown>;
  const accounts = new Map((db.prepare("SELECT role, address FROM metal_accounts").all() as { role: string; address: string }[]).map((a) => [a.role, a.address]));
  const business = accounts.get("business") ?? "";
  const out: Payment[] = [];

  // Airwallex: the SWIFT transfer (and its fee), the conversion, the deposit that books the sweep, the card charges.
  const transfers = subjects("transfer.");
  for (const t of db.prepare("SELECT transfer_id, request_id, invoice_no, amount, currency, fee_actual, status FROM transfers ORDER BY updated_at").all() as
    { transfer_id: string | null; request_id: string; invoice_no: string; amount: string; currency: string; fee_actual: string | null; status: string }[]) {
    if (!t.transfer_id || !transfers.has(t.transfer_id)) continue;
    const fee = /^([A-Z]{3}) (\d+\.\d{2})$/.exec(t.fee_actual ?? "");
    out.push({
      kind: "Airwallex transfer", id: t.transfer_id, ledger: `${t.currency} ${t.amount} for invoice ${t.invoice_no}, ${t.status}${fee ? `, fee ${fee[1]} ${fee[2]}` : ""}`,
      awx: { type: "transfer", id: t.transfer_id, amount: t.amount, currency: t.currency, status: t.status, ...(fee ? { fee: `${fee[1]} ${fee[2]}` } : {}) },
      books: { source: "transfer", ref: t.request_id, lines: [{ amount: `-${t.amount}`, currency: t.currency, proof: t.transfer_id }, ...(fee ? [{ amount: `-${fee[2]}`, currency: fee[1]!, proof: t.transfer_id }] : [])] },
    });
  }
  const conversions = subjects("fx.converted");
  for (const c of db.prepare("SELECT c.conversion_id, c.request_id, c.buy_amount, c.sell_amount, c.status, q.pair FROM fx_conversions c JOIN fx_quotes q ON q.quote_id = c.quote_id").all() as
    { conversion_id: string; request_id: string; buy_amount: string; sell_amount: string | null; status: string; pair: string }[]) {
    if (!conversions.has(c.conversion_id)) continue;
    const [sell, buy] = c.pair.split("/") as [string, string];
    out.push({
      kind: "Airwallex conversion", id: c.conversion_id, ledger: `${sell} ${c.sell_amount ?? "?"} → ${buy} ${c.buy_amount}, ${c.status}`,
      awx: { type: "conversion", id: c.conversion_id, requestId: c.request_id, buy: c.buy_amount, buyCurrency: buy, sell: c.sell_amount ?? "", sellCurrency: sell, status: c.status },
      books: { source: "fx", ref: c.conversion_id, lines: [...(c.sell_amount ? [{ amount: `-${c.sell_amount}`, currency: sell, proof: c.conversion_id }] : []), { amount: c.buy_amount, currency: buy, proof: c.conversion_id }] },
    });
  }
  const deposits = new Set(rows.filter((r) => r.event === "credit.deposited").map((r) => String(payload(r).deposit_id ?? "")));
  for (const c of db.prepare("SELECT tx_hash, from_address, to_address, amount_base_units, block, awx_deposit_id, awx_reference, created_at FROM chain_credits WHERE awx_deposit_id IS NOT NULL").all() as
    { tx_hash: string; from_address: string; to_address: string; amount_base_units: string; block: number; awx_deposit_id: string; awx_reference: string; created_at: string }[]) {
    if (!deposits.has(c.awx_deposit_id)) continue;
    const cents = baseUnitsToCents(BigInt(c.amount_base_units));
    out.push({
      kind: "Airwallex deposit", id: c.awx_deposit_id, ledger: `USD ${fromCents(cents)} booked for Metal tx ${short(c.tx_hash)} (block ${c.block})`,
      awx: { type: "deposit", id: c.awx_deposit_id, amount: fromCents(cents), currency: "USD", reference: c.awx_reference, since: new Date(Date.parse(c.created_at) - 24 * 3600_000).toISOString() },
      chain: { tx: c.tx_hash, transfer: { from: c.from_address, to: c.to_address, cents }, block: c.block },
      books: { source: "credit", ref: c.awx_deposit_id, lines: [{ amount: fromCents(cents), currency: "USD", proof: c.tx_hash }] },
    });
  }
  const cardEvents = rows.filter((r) => r.event === "card.charge_approved" || r.event === "card.charge_declined");
  for (const c of db.prepare("SELECT transaction_id, card_id, agent, merchant, amount_cents, currency, status, approved, failure_reason, occurred_at FROM card_transactions ORDER BY occurred_at").all() as
    { transaction_id: string; card_id: string; agent: string; merchant: string; amount_cents: number; currency: string; status: string; approved: number; failure_reason: string | null; occurred_at: string }[]) {
    const named = cardEvents.some((r) => r.subject === c.transaction_id);
    if (!named && c.occurred_at > cutoff) continue;
    const amount = fromCents(c.amount_cents);
    // An audit row for the same charge under another id (Airwallex's legacy transaction_id).
    const other = named ? undefined : cardEvents.find((r) => { const p = payload(r); return p.amount === amount && p.agent === c.agent && (r.event === "card.charge_approved") === (c.approved === 1); });
    out.push({
      kind: "Airwallex card transaction", id: c.transaction_id,
      ledger: `${c.currency} ${amount} at ${c.merchant} (${c.agent}), ${c.approved ? "approved" : `declined ${c.failure_reason ?? ""}`.trim()}`,
      ...(named ? {} : { note: other ? `the audit row (seq ${other.seq}) names this charge ${other.subject ?? "?"}, not the ledger's id` : "no audit row names this charge" }),
      awx: { type: "card", id: c.transaction_id, cardId: c.card_id, amount, currency: c.currency, approved: c.approved === 1, failure: c.failure_reason },
      books: { source: "card", ref: c.transaction_id, lines: c.approved ? [{ amount: `-${amount}`, currency: c.currency, proof: c.transaction_id }] : [] },
    });
  }

  // Metal: the owner's funding, sales, supplier purchases, refunds, the sweep, and each mandate bind or replace.
  for (const r of rows.filter((x) => x.event === "business.funded")) {
    const p = payload(r) as { amount?: string; tx?: string };
    if (!p.tx || !p.amount) continue;
    out.push({
      kind: "Metal funding", id: p.tx, ledger: `${p.amount} *USDZ from the owner to the business account`,
      chain: { tx: p.tx, transfer: { from: accounts.get("owner") ?? "", to: r.subject ?? business, cents: toCents(p.amount) } },
      books: { source: "opening", ref: "funding", lines: [{ amount: p.amount, currency: "USDZ", proof: p.tx }] },
    });
  }
  const sold = subjects("sale.");
  for (const s of db.prepare("SELECT sale_id, price_cents, payer, tx_hash, status, scheme FROM sales WHERE status = 'DELIVERED' ORDER BY sale_id").all() as
    { sale_id: number; price_cents: number; payer: string; tx_hash: string | null; status: string; scheme: string }[]) {
    if (!sold.has(String(s.sale_id))) continue;
    const clearing = s.scheme === "bajillion";
    out.push({
      kind: "Metal sale", id: String(s.sale_id), ledger: `${fromCents(s.price_cents)} *USDZ from ${short(s.payer)}, ${s.status}${clearing ? " (clearing receipt)" : ""}`,
      ...(clearing ? {} : { chain: { tx: s.tx_hash, transfer: { from: s.payer, to: business, cents: s.price_cents } } }),
      books: { source: "sale", ref: String(s.sale_id), lines: [{ amount: fromCents(s.price_cents), currency: "USDZ", proof: clearing ? "" : (s.tx_hash ?? "") }] },
    });
  }
  const bought = subjects("upstream.");
  for (const u of db.prepare("SELECT id, price_cents, tx_hash, outcome, refusal_reason FROM upstream_purchases ORDER BY id").all() as
    { id: number; price_cents: number; tx_hash: string | null; outcome: string; refusal_reason: string | null }[]) {
    if (!bought.has(String(u.id))) continue;
    const paid = u.outcome === "PAID";
    out.push({
      kind: "Metal upstream purchase", id: String(u.id), ledger: `${fromCents(u.price_cents)} *USDZ to the supplier, ${u.outcome}${u.refusal_reason ? ` (${u.refusal_reason})` : ""}`,
      chain: paid ? { tx: u.tx_hash, transfer: { from: business, to: accounts.get("supplier") ?? "", cents: u.price_cents } } : { tx: u.tx_hash },
      books: { source: "upstream", ref: String(u.id), lines: paid ? [{ amount: `-${fromCents(u.price_cents)}`, currency: "USDZ", proof: u.tx_hash ?? "" }] : [] },
    });
  }
  const refunded = subjects("refund.");
  for (const r of db.prepare("SELECT refund_id, sale_id, payment_id, amount_cents, to_address, outcome, tx_hash FROM refunds ORDER BY refund_id").all() as
    { refund_id: number; sale_id: number; payment_id: string; amount_cents: number; to_address: string; outcome: string; tx_hash: string | null }[]) {
    if (!refunded.has(String(r.sale_id))) continue;
    const paid = r.outcome === "PAID";
    out.push({
      kind: "Metal refund", id: r.payment_id, ledger: `${fromCents(r.amount_cents)} *USDZ back to ${short(r.to_address)} for sale ${r.sale_id}, ${r.outcome}`,
      chain: paid ? { tx: r.tx_hash, transfer: { from: business, to: r.to_address, cents: r.amount_cents } } : { tx: r.tx_hash },
      books: { source: "refund", ref: String(r.refund_id), lines: paid ? [{ amount: `-${fromCents(r.amount_cents)}`, currency: "USDZ", proof: r.tx_hash ?? "" }] : [] },
    });
  }
  const swept = subjects("sweep.");
  for (const s of db.prepare("SELECT payment_id, amount_cents, tx_hash, outcome FROM sweeps ORDER BY created_at").all() as
    { payment_id: string; amount_cents: number; tx_hash: string | null; outcome: string }[]) {
    if (!swept.has(s.payment_id)) continue;
    const paid = s.outcome === "PAID";
    out.push({
      kind: "Metal sweep", id: s.payment_id, ledger: `${fromCents(s.amount_cents)} *USDZ to the sweep wallet, ${s.outcome}`,
      chain: paid ? { tx: s.tx_hash, transfer: { from: business, to: accounts.get("sweep") ?? "", cents: s.amount_cents } } : { tx: s.tx_hash },
      books: { source: "sweep", ref: s.payment_id, lines: paid ? [{ amount: `-${fromCents(s.amount_cents)}`, currency: "USDZ", proof: s.tx_hash ?? "" }] : [] },
    });
  }
  for (const r of rows.filter((x) => x.event === "mandate.bound" || x.event === "mandate.replaced")) {
    const p = payload(r) as { tx?: string; cap?: string; budget?: string; proposal_id?: string };
    if (!p.tx) continue;
    out.push({ kind: "Metal mandate", id: p.tx, ledger: `${r.subject ?? "?"} ${r.event === "mandate.bound" ? "bound" : `replaced (${p.proposal_id ?? "?"})`}: cap ${p.cap ?? "?"}, budget ${p.budget ?? "?"}`, chain: { tx: p.tx } });
  }
  return out;
}

// ---- Airwallex ----

type Obj = Record<string, unknown>;
const str = (v: unknown) => (v === undefined || v === null ? "" : String(v));
/** An Airwallex amount as two decimals; card amounts are signed from the card's side, so the sign is dropped. */
function amount(v: unknown): string {
  const n = typeof v === "number" ? v : Number(str(v));
  if (!Number.isFinite(n)) return str(v);
  return fromCents(Math.round(Math.abs(n) * 100));
}
const diffs = (pairs: [string, string, string][]) => pairs.filter(([, got, want]) => got !== want).map(([k, got, want]) => `${k}: Airwallex ${got || "(none)"}, ledger ${want || "(none)"}`);

async function firstOk(tries: (() => Promise<Obj | undefined>)[]): Promise<Obj | undefined> {
  // A lookup that answered "none" is an answer; only when every lookup failed is Airwallex's view unknown.
  let last: unknown;
  let answered = false;
  for (const t of tries) {
    try {
      const r = await t();
      if (r) return r;
      answered = true;
    } catch (e) {
      last = e;
    }
  }
  if (!answered && last) throw last;
  return undefined;
}

async function listFind(get: NonNullable<QaSources["awx"]>, path: string, query: Record<string, string>, match: (x: Obj) => boolean): Promise<Obj | undefined> {
  for (let page = 0; page < 20; page++) {
    const r = (await get(path, { ...query, page_num: String(page), page_size: "100" })) as { items?: Obj[]; has_more?: boolean };
    const hit = (r.items ?? []).find(match);
    if (hit || !r.has_more) return hit;
  }
  return undefined;
}

/** Differences between Airwallex's record and the ledger's, or null when Airwallex has no such record. */
export async function airwallexDiffs(get: NonNullable<QaSources["awx"]>, s: AwxSpec): Promise<{ found: false } | { found: true; diffs: string[]; said: string }> {
  if (s.type === "transfer") {
    const x = await firstOk([() => get(`/transfers/${encodeURIComponent(s.id)}`) as Promise<Obj>]);
    if (!x) return { found: false };
    const fee = x.fee_amount != null ? `${str(x.fee_currency)} ${amount(x.fee_amount)}` : "";
    return {
      found: true, said: `${str(x.transfer_currency)} ${amount(x.transfer_amount)}, ${str(x.status)}${fee ? `, fee ${fee}` : ""}`,
      diffs: diffs([["status", str(x.status), s.status], ["amount", amount(x.transfer_amount), s.amount], ["currency", str(x.transfer_currency), s.currency], ...(s.fee && fee ? [["fee", fee, s.fee] as [string, string, string]] : [])]),
    };
  }
  if (s.type === "conversion") {
    const x = await firstOk([
      () => get(`/fx/conversions/${encodeURIComponent(s.id)}`) as Promise<Obj>,
      () => listFind(get, "/fx/conversions", { request_id: s.requestId }, (c) => c.conversion_id === s.id || c.request_id === s.requestId),
    ]);
    if (!x) return { found: false };
    return {
      found: true, said: `${str(x.sell_currency)} ${amount(x.sell_amount)} → ${str(x.buy_currency)} ${amount(x.buy_amount)}, ${str(x.status)}`,
      diffs: diffs([
        ["status", str(x.status), s.status], ["buy amount", amount(x.buy_amount), s.buy], ["buy currency", str(x.buy_currency), s.buyCurrency],
        ["sell amount", amount(x.sell_amount), s.sell], ["sell currency", str(x.sell_currency), s.sellCurrency],
      ]),
    };
  }
  if (s.type === "deposit") {
    const x = await firstOk([
      () => get(`/deposits/${encodeURIComponent(s.id)}`) as Promise<Obj>,
      () => listFind(get, "/deposits", { from_created_at: s.since }, (d) => d.id === s.id),
    ]);
    if (!x) return { found: false };
    return {
      found: true, said: `${str(x.currency)} ${amount(x.amount)}, ${str(x.status)}, reference ${short(str(x.reference))}`,
      diffs: diffs([["status", str(x.status), "SETTLED"], ["amount", amount(x.amount), s.amount], ["currency", str(x.currency), s.currency], ["reference", lower(str(x.reference)), lower(s.reference)]]),
    };
  }
  const ids = (t: Obj) => [t.card_transaction_id, t.transaction_id, (t.card_transaction_data as Obj | undefined)?.card_transaction_id].map(str);
  const x = await firstOk([
    () => get(`/issuing/transactions/${encodeURIComponent(s.id)}`) as Promise<Obj>,
    () => listFind(get, "/issuing/transactions", { card_id: s.cardId }, (t) => ids(t).includes(s.id)),
  ]);
  if (!x) return { found: false };
  const status = str(x.status ?? x.process_result);
  const approved = ["APPROVED", "PENDING", "CLEARED", "SETTLED"].includes(status);
  return {
    found: true, said: `${str(x.transaction_currency)} ${amount(x.transaction_amount)}, ${status}${x.failure_reason ? ` ${str(x.failure_reason)}` : ""}`,
    diffs: diffs([
      ["result", approved ? "approved" : "declined", s.approved ? "approved" : "declined"], ["amount", amount(x.transaction_amount), s.amount],
      ["currency", str(x.transaction_currency), s.currency], ["failure reason", str(x.failure_reason), s.failure ?? ""],
    ]),
  };
}

// ---- Metal ----

export function chainDiffs(r: ChainReceipt | null, s: ChainSpec, usdz: string): { diffs: string[]; said: string } {
  if (!r) return { diffs: ["no such transaction on chain"], said: "not found" };
  const out: string[] = [];
  if (r.status !== "success") out.push("the transaction reverted on chain");
  if (s.block !== undefined && r.block !== s.block) out.push(`block: chain ${r.block}, ledger ${s.block}`);
  const moves = r.transfers.filter((t) => lower(t.token) === lower(usdz));
  let said = `${r.status} in block ${r.block}`;
  if (s.transfer) {
    const want = centsToBaseUnits(s.transfer.cents);
    const exact = moves.find((t) => lower(t.from) === lower(s.transfer!.from) && lower(t.to) === lower(s.transfer!.to) && t.value === want);
    if (exact) said += `, ${fromCents(s.transfer.cents)} *USDZ ${short(exact.from)} → ${short(exact.to)}`;
    else {
      const seen = moves.map((t) => `${t.value % 10n ** 16n === 0n ? fromCents(baseUnitsToCents(t.value)) : String(t.value)} ${short(t.from)} → ${short(t.to)}`).join("; ");
      out.push(`no *USDZ transfer of ${fromCents(s.transfer.cents)} ${short(s.transfer.from)} → ${short(s.transfer.to)}; the receipt has ${seen || "no *USDZ transfer"}`);
    }
  }
  return { diffs: out, said };
}

// ---- Books ----

export interface BooksIndex { lines: { line: JournalLine; postings: Posting[] }[] }

export function booksIndex(db: DB): BooksIndex {
  const moved = journal(db);
  const all = [...openingLines(db, moved), ...moved];
  const postings = doubleEntry(all);
  const byEntry = new Map<string, Posting[]>();
  for (const p of postings) byEntry.set(p.entry, [...(byEntry.get(p.entry) ?? []), p]);
  // doubleEntry names entry i of its input O-/J-(i+1); a zero line has no entry.
  return { lines: all.map((line, i) => ({ line, postings: byEntry.get(`${line.source === "opening" ? "O" : "J"}-${String(i + 1).padStart(line.source === "opening" ? 3 : 5, "0")}`) ?? [] })) };
}

export function booksDiffs(index: BooksIndex, s: BooksSpec): { diffs: string[]; said: string } {
  const mine = index.lines.filter((l) => l.line.source === s.source && l.line.ref === s.ref);
  const out: string[] = [];
  const got = mine.map((l) => `${l.line.amount} ${l.line.currency}`);
  const want = s.lines.map((l) => `${l.amount} ${l.currency}`);
  if ([...got].sort().join(" | ") !== [...want].sort().join(" | ")) out.push(want.length ? `postings: books ${got.join(" + ") || "(none)"}, ledger ${want.join(" + ")}` : `booked although nothing moved: ${got.join(" + ")}`);
  for (const l of mine) {
    const debit = l.postings.reduce((a, p) => a + p.debit_cents, 0);
    const credit = l.postings.reduce((a, p) => a + p.credit_cents, 0);
    const c = toCents(l.line.amount.replace(/^-/, ""));
    if (l.postings.length !== 2 || debit !== c || credit !== c) out.push(`${l.line.description}: ${l.postings.length} postings, debit ${signed(debit)}, credit ${signed(credit)} for ${l.line.amount}`);
    const proof = s.lines.find((w) => w.amount === l.line.amount && w.currency === l.line.currency)?.proof;
    if (proof !== undefined && proof !== "" && lower(l.line.proof) !== lower(proof)) out.push(`${l.line.description}: proof ${short(l.line.proof) || "(none)"}, ledger ${short(proof)}`);
  }
  const accounts = [...new Set(mine.flatMap((l) => l.postings.map((p) => p.account)))].join(", ");
  return { diffs: out, said: mine.length ? `${got.join(" + ")} (accounts ${accounts})` : "not booked, as nothing moved" };
}

// ---- Run ----

async function pool<T, R>(items: T[], size: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array<R>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    for (let i = next++; i < items.length; i = next++) out[i] = await fn(items[i]!);
  }));
  return out;
}

export async function runDataQa(db: DB, payments: Payment[], src: QaSources, opts: { usdz: string; scrub?: (s: string) => string; concurrency?: number }): Promise<Check[]> {
  const scrub = opts.scrub ?? ((s: string) => s);
  const index = booksIndex(db);
  const checks: Check[][] = await pool(payments, opts.concurrency ?? 6, async (p) => {
    const out: Check[] = [];
    const add = (side: Side, outcome: Check["outcome"], detail: string) => out.push({ kind: p.kind, id: p.id, side, outcome, detail: scrub(detail) });
    const failed = (e: unknown) => (e instanceof Error ? `${e.name === "Error" ? "" : `${e.name}: `}${e.message}` : String(e)).split("\n")[0]!.slice(0, 200);

    if (p.awx) {
      if (!src.awx) add("Airwallex", "skipped", src.awxMissing ?? "no Airwallex credentials");
      else {
        try {
          const r = await airwallexDiffs(src.awx, p.awx);
          if (!r.found) add("Airwallex", "difference", "Airwallex has no record with this id");
          else add("Airwallex", r.diffs.length ? "difference" : "match", r.diffs.length ? r.diffs.join("; ") : r.said);
        } catch (e) {
          add("Airwallex", "skipped", `Airwallex did not answer: ${failed(e)}`);
        }
      }
    }
    if (p.chain) {
      if (!p.chain.tx) {
        // A refused purchase or refund moved nothing: there must be no transaction.
        if (p.chain.transfer) add("Metal", "difference", "the ledger calls it paid but holds no transaction hash");
        else add("Metal", "match", "refused before any transaction, as the ledger says");
      } else if (!src.receipt) add("Metal", "skipped", src.metalMissing ?? "no Metal RPC");
      else {
        try {
          const r = chainDiffs(await src.receipt(p.chain.tx), p.chain, opts.usdz);
          add("Metal", r.diffs.length ? "difference" : "match", r.diffs.length ? r.diffs.join("; ") : r.said);
        } catch (e) {
          add("Metal", "skipped", `the RPC did not answer: ${failed(e)}`);
        }
      }
    }
    if (p.books) {
      const r = booksDiffs(index, p.books);
      add("Books", r.diffs.length ? "difference" : "match", r.diffs.length ? r.diffs.join("; ") : r.said);
    }
    return out;
  });
  return checks.flat();
}

// ---- Report ----

export interface ReportHead { ledger: string; upto: number; rows: number; anchor: string; generatedAt: string; airwallex: string; metal: string }

export function renderReport(payments: Payment[], checks: Check[], h: ReportHead): string {
  const kinds = KINDS.filter((k) => payments.some((p) => p.kind === k));
  const count = (f: (c: Check) => boolean) => checks.filter(f).length;
  const cell = (k: Kind, s: Side) => {
    const mine = checks.filter((c) => c.kind === k && c.side === s);
    if (!mine.length) return "n/a";
    const m = mine.filter((c) => c.outcome === "match").length;
    const d = mine.filter((c) => c.outcome === "difference").length;
    const sk = mine.filter((c) => c.outcome === "skipped").length;
    return [`${m}/${mine.length} match`, d ? `**${d} diff**` : "", sk ? `${sk} skipped` : ""].filter(Boolean).join(", ");
  };
  const lines: string[] = [
    "# Data QA: the recorded ledger against Airwallex, Metal and the Books",
    "",
    `Made by \`npm run data-qa\` (\`src/cli/dataQa.ts\`) on ${h.generatedAt}. Every payment in the ledger \`${h.ledger}\` up to audit row ${h.upto}`,
    `(${h.rows} rows read; ${h.anchor}) is compared with Airwallex (read-only GET by id: status, amount, currency), with`,
    "Metal testnet (the transaction exists and succeeded and carries the *USDZ transfer with the ledger's amount, payer and",
    "payee) and with the Books (`src/accounting/books.ts`: the double-entry postings for that ref). Nothing was created,",
    "moved or approved, and nothing was fixed.",
    "",
    `- **Airwallex:** ${h.airwallex}`,
    `- **Metal:** ${h.metal}`,
    "",
    "## Summary",
    "",
    "A check is one payment on one side. Mandate binds and replaces move no money, so they have no Books side; a refused",
    "purchase and a declined card charge must have no transaction and no posting.",
    "",
    "| Kind | Payments | Checks | Matched | Differences | Skipped |",
    "|---|---:|---:|---:|---:|---:|",
    ...kinds.map((k) => `| ${k} | ${payments.filter((p) => p.kind === k).length} | ${count((c) => c.kind === k)} | ${count((c) => c.kind === k && c.outcome === "match")} | ${count((c) => c.kind === k && c.outcome === "difference")} | ${count((c) => c.kind === k && c.outcome === "skipped")} |`),
    `| **All** | **${payments.length}** | **${checks.length}** | **${count((c) => c.outcome === "match")}** | **${count((c) => c.outcome === "difference")}** | **${count((c) => c.outcome === "skipped")}** |`,
    "",
    "### Per side",
    "",
    "| Kind | Airwallex | Metal | Books |",
    "|---|---|---|---|",
    ...kinds.map((k) => `| ${k} | ${cell(k, "Airwallex")} | ${cell(k, "Metal")} | ${cell(k, "Books")} |`),
    "",
    "## Differences",
    "",
  ];
  const differences = checks.filter((c) => c.outcome === "difference");
  if (!differences.length) lines.push("None.");
  for (const c of differences) {
    const p = payments.find((x) => x.kind === c.kind && x.id === c.id);
    lines.push(`- **${c.kind} \`${c.id}\`** (${c.side}): ${c.detail}. Ledger: ${p?.ledger ?? "?"}.`);
  }
  const notes = payments.filter((p) => p.note);
  lines.push("", "## Notes on the ledger", "");
  if (!notes.length) lines.push("None.");
  for (const p of notes) lines.push(`- **${p.kind} \`${p.id}\`**: ${p.note}.`);
  const skipped = checks.filter((c) => c.outcome === "skipped");
  lines.push("", "## Skipped", "");
  if (!skipped.length) lines.push("None.");
  else {
    const reasons = new Map<string, Check[]>();
    for (const c of skipped) reasons.set(`${c.side}: ${c.detail}`, [...(reasons.get(`${c.side}: ${c.detail}`) ?? []), c]);
    for (const [reason, cs] of reasons) lines.push(`- ${reason} (${cs.length}: ${[...new Set(cs.map((c) => c.kind))].join(", ")})`);
  }
  lines.push("", "## What each side answered for the Airwallex payments", "");
  for (const p of payments.filter((x) => x.kind.startsWith("Airwallex"))) {
    const said = checks.filter((c) => c.kind === p.kind && c.id === p.id).map((c) => `${c.side}: ${c.detail}`).join("; ");
    lines.push(`- **${p.kind} \`${p.id}\`**: ledger ${p.ledger}. ${said}.`);
  }
  lines.push("", "## Every payment checked", "", "| Kind | Id | Ledger | Airwallex | Metal | Books |", "|---|---|---|---|---|---|");
  const mark = (p: Payment, s: Side) => {
    const c = checks.find((x) => x.kind === p.kind && x.id === p.id && x.side === s);
    return c ? (c.outcome === "match" ? "match" : c.outcome === "difference" ? "**difference**" : "skipped") : "n/a";
  };
  for (const p of payments) lines.push(`| ${p.kind} | \`${short(p.id)}\` | ${p.ledger.replace(/\|/g, "/")} | ${mark(p, "Airwallex")} | ${mark(p, "Metal")} | ${mark(p, "Books")} |`);
  return lines.join("\n") + "\n";
}
