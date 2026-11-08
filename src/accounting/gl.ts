// The GL journal (E4): one line per movement of money, each with a GL account, a cost centre, the bank account it
// moved through, its proof (a transaction hash, a clearing receipt or an Airwallex id) and the approval behind it.
// Only money that moved is booked: refused purchases, declined card charges, aborted sales and refused sweeps are not.
// The coding comes from src/config/gl.ts; `rule` says which mapping chose each account, so a bookkeeper can check it.

import { AP_CHART, bankAccountFor, CHART, COST_CENTRE_NAMES, COST_CENTRES, MCC_GL, VENDOR_GL } from "../config/gl.js";
import { bookable } from "../ap/books.js";
import { ledgerInvoiceNo } from "../ap/ledgerKey.js";
import { apInvoices } from "../ap/store.js";
import type { DB } from "../db/open.js";
import { baseUnitsToCents, fromCents, toCents } from "../lib/money.js";

export interface JournalLine {
  date: string;
  source: "sale" | "upstream" | "refund" | "card" | "transfer" | "fx" | "sweep" | "credit" | "clearing" | "opening" | "receipt";
  ref: string;
  description: string;
  counterparty: string;
  agent: string;
  cost_centre: string;
  gl_account: string;
  gl_name: string;
  bank_account: string;
  /** Signed, two decimals: positive is money in, negative is money out of `bank_account`. */
  amount: string;
  currency: string;
  proof: string;
  approval: string;
  rule: string;
}

/**
 * The payment-ledger numbers ("NUM · Supplier") of the payables-inbox invoices the books hold (bookable, not credit
 * notes): their accrual is posted by the ledger feed (src/ledger/feed.ts), so their payouts settle 2100.
 */
export function accruedInboxKeys(db: DB): string[] {
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'ap_invoices'").get()) return [];
  return apInvoices(db).filter((i) => i.doc_kind !== "credit_note" && bookable(i)).map((i) => ledgerInvoiceNo(i.invoice_no, i.vendor));
}

const signed = (cents: number) => (cents < 0 ? `-${fromCents(-cents)}` : fromCents(cents));

export function journal(db: DB): JournalLine[] {
  const lines: JournalLine[] = [];
  const accruedInbox = new Set(accruedInboxKeys(db));
  const add = (l: Omit<JournalLine, "gl_name" | "cost_centre" | "amount"> & { cents: number }) => {
    const { cents, ...rest } = l;
    lines.push({ ...rest, amount: signed(cents), cost_centre: COST_CENTRES[l.agent] ?? (l.agent.startsWith("ext:") ? "CC400" : l.agent.startsWith("task:") ? "CC500" : ""), gl_name: CHART[l.gl_account] ?? AP_CHART[l.gl_account] ?? "" });
  };
  const proposalOf = (sha: string | null) =>
    sha ? ((db.prepare("SELECT proposal_id FROM proposals WHERE terms_sha256 = ?").get(sha) as { proposal_id: string } | undefined)?.proposal_id ?? "") : "";

  for (const s of db.prepare("SELECT sale_id, price_cents, payer, tx_hash, created_at, scheme, clearing_json FROM sales WHERE status = 'DELIVERED' ORDER BY sale_id").all() as
    { sale_id: number; price_cents: number; payer: string; tx_hash: string | null; created_at: string; scheme: string; clearing_json: string | null }[]) {
    const clearing = s.scheme === "bajillion";
    const receipt = clearing && s.clearing_json ? (JSON.parse(s.clearing_json) as { paid?: { invoice?: { id?: string } } }).paid?.invoice?.id : undefined;
    add({
      date: s.created_at, source: "sale", ref: String(s.sale_id), description: `Stock check sold to a retailer ${s.sale_id}${clearing ? " (prepaid, Metal clearing)" : ""}`,
      counterparty: s.payer, agent: "sourcing", gl_account: "4000", bank_account: clearing ? "1220" : "1210", cents: s.price_cents, currency: "USDZ",
      proof: (clearing ? receipt : s.tx_hash) ?? "", approval: "", rule: "data sale: revenue",
    });
  }
  for (const u of db.prepare("SELECT id, price_cents, tx_hash, created_at FROM upstream_purchases WHERE outcome = 'PAID' ORDER BY id").all() as
    { id: number; price_cents: number; tx_hash: string | null; created_at: string }[]) {
    add({
      date: u.created_at, source: "upstream", ref: String(u.id), description: `Stock check bought from the warehouse API (${u.id})`, counterparty: "warehouse API",
      agent: "sourcing", gl_account: "5000", bank_account: "1210", cents: -u.price_cents, currency: "USDZ", proof: u.tx_hash ?? "", approval: "", rule: "upstream purchase: cost of data",
    });
  }
  for (const r of db.prepare("SELECT r.refund_id, r.sale_id, r.amount_cents, r.to_address, r.tx_hash, r.proposal_id, s.created_at FROM refunds r JOIN sales s ON s.sale_id = r.sale_id WHERE r.outcome = 'PAID' ORDER BY r.refund_id").all() as
    { refund_id: number; sale_id: number; amount_cents: number; to_address: string; tx_hash: string | null; proposal_id: string | null; created_at: string }[]) {
    const at = (db.prepare("SELECT ts FROM audit_log WHERE event = 'refund.paid' AND subject = ? ORDER BY seq DESC LIMIT 1").get(String(r.sale_id)) as { ts: string } | undefined)?.ts ?? r.created_at;
    add({
      date: at, source: "refund", ref: String(r.refund_id), description: `Refund of query ${r.sale_id}`, counterparty: r.to_address, agent: "support",
      gl_account: "4100", bank_account: "1210", cents: -r.amount_cents, currency: "USDZ", proof: r.tx_hash ?? "", approval: r.proposal_id ?? "", rule: "refund: reduces revenue",
    });
  }
  for (const c of db.prepare("SELECT transaction_id, agent, merchant, mcc, amount_cents, currency, occurred_at, purpose FROM card_transactions WHERE approved = 1 ORDER BY occurred_at, transaction_id").all() as
    { transaction_id: string; agent: string; merchant: string; mcc: string | null; amount_cents: number; currency: string; occurred_at: string; purpose: string | null }[]) {
    const gl = (c.mcc && MCC_GL[c.mcc]) || "6100";
    add({
      date: c.occurred_at, source: "card", ref: c.transaction_id, description: c.purpose ?? `Card: ${c.merchant}`, counterparty: c.merchant, agent: c.agent,
      gl_account: gl, bank_account: "1200", cents: -c.amount_cents, currency: c.currency, proof: c.transaction_id, approval: "",
      rule: c.mcc && MCC_GL[c.mcc] ? `card, merchant category ${c.mcc}` : "card, default",
    });
  }
  for (const t of db.prepare("SELECT t.request_id, t.transfer_id, t.invoice_no, t.amount, t.currency, t.fee_actual, t.approval_sha256, t.updated_at, i.vendor FROM transfers t JOIN invoices i ON i.invoice_no = t.invoice_no WHERE t.status IN ('SENT', 'PAID') ORDER BY t.updated_at").all() as
    { request_id: string; transfer_id: string | null; invoice_no: string; amount: string; currency: string; fee_actual: string | null; approval_sha256: string; updated_at: string; vendor: string }[]) {
    // A payables-inbox invoice the books hold was accrued on receipt (expense and input VAT against 2100, posted by the
    // ledger feed): its payout settles that payable, so the expense is never booked twice.
    const accrued = accruedInbox.has(t.invoice_no);
    const gl = accrued ? "2100" : VENDOR_GL[t.vendor] ?? "6900";
    const approval = proposalOf(t.approval_sha256);
    add({
      date: t.updated_at, source: "transfer", ref: t.request_id, description: `Invoice ${t.invoice_no}`, counterparty: t.vendor, agent: "treasury",
      gl_account: gl, bank_account: bankAccountFor(t.currency), cents: -toCents(t.amount), currency: t.currency, proof: t.transfer_id ?? "", approval,
      rule: accrued ? "supplier invoice paid: settles the payable booked on receipt" : VENDOR_GL[t.vendor] ? `supplier invoice, vendor ${t.vendor}` : "supplier invoice, default",
    });
    const fee = /^([A-Z]{3}) (\d+\.\d{2})$/.exec(t.fee_actual ?? "");
    if (fee) {
      add({
        date: t.updated_at, source: "transfer", ref: t.request_id, description: `Transfer fee, invoice ${t.invoice_no}`, counterparty: "Airwallex", agent: "treasury",
        gl_account: "6800", bank_account: bankAccountFor(fee[1]!), cents: -toCents(fee[2]!), currency: fee[1]!, proof: t.transfer_id ?? "", approval, rule: "transfer fee",
      });
    }
  }
  for (const f of db.prepare("SELECT c.conversion_id, c.buy_amount, c.sell_amount, c.approval_sha256, q.pair, q.valid_from FROM fx_conversions c JOIN fx_quotes q ON q.quote_id = c.quote_id WHERE c.status = 'SETTLED' ORDER BY q.valid_from").all() as
    { conversion_id: string; buy_amount: string; sell_amount: string | null; approval_sha256: string; pair: string; valid_from: string }[]) {
    const [sell, buy] = f.pair.split("/") as [string, string];
    const approval = proposalOf(f.approval_sha256);
    const bank = bankAccountFor;
    const common = { date: f.valid_from, source: "fx" as const, ref: f.conversion_id, counterparty: "Airwallex", agent: "treasury", gl_account: "1590", proof: f.conversion_id, approval, rule: "currency conversion: own accounts" };
    if (f.sell_amount) add({ ...common, description: `Convert ${sell} to ${buy}`, bank_account: bank(sell), cents: -toCents(f.sell_amount), currency: sell });
    add({ ...common, description: `Convert ${sell} to ${buy}`, bank_account: bank(buy), cents: toCents(f.buy_amount), currency: buy });
  }
  for (const s of db.prepare("SELECT payment_id, amount_cents, tx_hash, created_at FROM sweeps WHERE outcome = 'PAID' ORDER BY created_at").all() as
    { payment_id: string; amount_cents: number; tx_hash: string | null; created_at: string }[]) {
    add({
      date: s.created_at, source: "sweep", ref: s.payment_id, description: "Sweep earnings from Metal to Airwallex", counterparty: "own account", agent: "treasury",
      gl_account: "1590", bank_account: "1210", cents: -s.amount_cents, currency: "USDZ", proof: s.tx_hash ?? "", approval: "", rule: "sweep: own accounts",
    });
  }
  for (const c of db.prepare("SELECT awx_deposit_id, amount_base_units, tx_hash, created_at FROM chain_credits WHERE awx_deposit_id IS NOT NULL ORDER BY created_at").all() as
    { awx_deposit_id: string; amount_base_units: string; tx_hash: string; created_at: string }[]) {
    add({
      date: c.created_at, source: "credit", ref: c.awx_deposit_id, description: "Sweep credited at Airwallex (1 *USDZ = 1 USD)", counterparty: "own account", agent: "treasury",
      gl_account: "1590", bank_account: "1201", cents: baseUnitsToCents(BigInt(c.amount_base_units)), currency: "USD", proof: c.tx_hash, approval: "", rule: "sweep: own accounts",
    });
  }
  for (const w of db.prepare("SELECT id, units, tx, created_at FROM clearing_ops WHERE party = 'seller' AND kind = 'withdraw' AND detail IS NULL AND tx IS NOT NULL ORDER BY id").all() as
    { id: number; units: string; tx: string; created_at: string }[]) {
    const cents = baseUnitsToCents(BigInt(w.units));
    const common = { date: w.created_at, source: "clearing" as const, ref: String(w.id), description: "Clearing earnings withdrawn", counterparty: "own account", agent: "treasury", gl_account: "1590", currency: "USDZ", proof: w.tx, approval: "", rule: "clearing withdrawal: own accounts" };
    add({ ...common, bank_account: "1220", cents: -cents });
    add({ ...common, bank_account: "1210", cents });
  }

  // Stable sort: lines of one payment (an invoice and its fee, both legs of a conversion) stay together, in order.
  // Retailers' payments into the Global Accounts (src/agents/receivables.ts): the part applied to an invoice is
  // wholesale revenue; an overpayment's excess, a payment in the wrong currency and one with no invoice wait in suspense.
  const hasReceipts = !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'receipts'").get();
  for (const r of hasReceipts ? db.prepare("SELECT deposit_id, currency, amount_cents, applied_cents, payer, invoice_no, outcome, received_at FROM receipts ORDER BY received_at, deposit_id").all() as
    { deposit_id: string; currency: string; amount_cents: number; applied_cents: number; payer: string | null; invoice_no: string | null; outcome: string; received_at: string }[] : []) {
    const bank = r.currency === "EUR" ? "1200" : r.currency === "GBP" ? "1202" : "1201";
    const common = { date: r.received_at, source: "receipt" as const, ref: r.deposit_id, counterparty: r.payer ?? "", agent: "treasury", bank_account: bank, currency: r.currency, proof: r.deposit_id, approval: "" };
    if (r.applied_cents > 0) add({ ...common, description: `Payment of invoice ${r.invoice_no}`, gl_account: "4200", cents: r.applied_cents, rule: "retailer payment: matched to its invoice" });
    if (r.amount_cents > r.applied_cents) add({ ...common, description: r.invoice_no ? `Overpayment of invoice ${r.invoice_no}` : "Payment with no matching invoice", gl_account: "2900", cents: r.amount_cents - r.applied_cents, rule: `retailer payment: ${r.outcome.toLowerCase().replace("_", " ")}, held in suspense` });
  }
  return lines.map((l, i) => [l, i] as const).sort((a, b) => a[0].date.localeCompare(b[0].date) || a[1] - b[1]).map(([l]) => l);
}

const COLUMNS: (keyof JournalLine)[] = ["date", "source", "ref", "description", "counterparty", "agent", "cost_centre", "gl_account", "gl_name", "bank_account", "amount", "currency", "proof", "approval", "rule"];

/** A text cell that a spreadsheet would read as a formula gets a leading apostrophe; the amount column stays a number. */
function cell(key: keyof JournalLine, v: string): string {
  const safe = key !== "amount" && /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/**
 * The journal as CSV. `extra` adds columns after the standard ones, each a text value per line (the month-end pack adds
 * the approval hash behind a line's proposal); the standard columns and their order never change.
 */
export function journalCsv(lines: JournalLine[], extra: { name: string; value: (l: JournalLine) => string }[] = []): string {
  const head = [...COLUMNS, ...extra.map((e) => e.name)].join(",");
  const row = (l: JournalLine) => [...COLUMNS.map((k) => cell(k, l[k])), ...extra.map((e) => cell("ref", e.value(l)))].join(",");
  return [head, ...lines.map(row)].join("\r\n") + "\r\n";
}

export function journalJson(lines: JournalLine[]): string {
  return JSON.stringify({ chart: CHART, cost_centres: COST_CENTRE_NAMES, lines }, null, 2) + "\n";
}
