// The transactions register: one read-only list of every money movement Purser knows, on every rail, derived from the
// tables those movements are recorded in (no second record of its own). Each row says what moved (or was tried and did
// not move), where, for whom, under whose approval, how it is booked and how it proves itself, and whether its booking
// and its rail record agree.
//
// Rails: Airwallex transfers (supplier and Kit 11 invoice payouts, any currency, with their fee), Airwallex FX (both
// legs of a conversion), Airwallex cards (charges and declines), Airwallex Airi purchases, payments into the Global
// Accounts, and Metal (data sales, purchases from the warehouse API, refunds, sweeps to Airwallex and their credit,
// clearing withdrawals). A refused, declined, failed or aborted attempt is listed with moved = false and never counts.
//
// Reconciliation per row against the stored ledger's postings by the ledger feed (src/ledger/feed.ts):
//   matched              money moved, it is booked, and the booking's bank lines equal the amount (and fee)
//   missing_booking      money moved and nothing in the ledger books it (the ledger not synced yet, or a rail it does not book)
//   missing_rail_record  money is recorded as moved but carries no proof from the rail (no Airwallex id, no transaction hash)
//   amount_mismatch      the booking's bank lines differ from the amount, or something is booked although nothing moved
//   not_applicable       nothing moved and nothing is booked

import { ledgerInvoiceNo } from "../ap/ledgerKey.js";
import { apInvoices } from "../ap/store.js";
import { bankAccountFor } from "../config/gl.js";
import type { DB } from "../db/open.js";
import { FEED_ACTOR } from "../ledger/feed.js";
import { baseUnitsToCents, fromCents, toCents } from "../lib/money.js";

import { RAIL_LABELS, RECONCILIATION_WORDS, totalsOf, type Reconciliation, type Register, type TxRow } from "./registerShape.js";

export * from "./registerShape.js";

const has = (db: DB, table: string) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
const cols = (db: DB, table: string) => new Set((db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name));
const short = (s: string | null | undefined, n = 12) => (s ? (s.length > n + 2 ? `${s.slice(0, n)}…` : s) : "");
const words = (s: string) => s.toLowerCase().replace(/_/g, " ");

// IN_APPROVAL: Airwallex's own approval workflow holds the payout until an approver in Airwallex's web app approves it.
const TRANSFER_WORDS: Record<string, string> = { IN_APPROVAL: "waiting for Airwallex approval", SCHEDULED: "approved at Airwallex, scheduled", SUBMITTING: "being sent", SENT: "sent", PAID: "paid", FAILED: "failed", CANCELLED: "cancelled", REFUSED: "refused" };

interface Draft extends Omit<TxRow, "rail_label" | "booking" | "reconciliation" | "reconciliation_words" | "flags" | "approval" | "flow"> {
  /** For a movement between own accounts: out of the account it left. */
  leaves?: boolean;
  /** Committed at the rail but not settled yet (an FX conversion still SCHEDULED): flagged not_settled. */
  pending?: boolean;
  approval: Omit<TxRow["approval"], "decision" | "method" | "approved_at"> & { sha: string | null };
  /** The ledger feed's key prefix for this movement's postings, and what its bank lines should sum to in its currency. */
  book: { prefix: string; expectCents: number } | null;
}

interface FeedEntry { entry_id: number; base: string; lines: { account: string; debit: number; credit: number; currency: string }[] }

/** The feed's postings still standing, each with its key without version (@vN) or repeat (#N) suffix. */
function feedEntries(db: DB): FeedEntry[] {
  if (!has(db, "ledger_entries")) return [];
  const rows = db.prepare(`SELECT e.entry_id, e.source_key FROM ledger_entries e WHERE e.created_by = ? AND e.reverses IS NULL AND e.source_key IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM ledger_entries r WHERE r.reverses = e.entry_id) ORDER BY e.entry_id`).all(FEED_ACTOR) as { entry_id: number; source_key: string }[];
  const lines = db.prepare("SELECT account, debit_cents AS debit, credit_cents AS credit, currency FROM ledger_lines WHERE entry_id = ?");
  return rows.map((r) => ({ entry_id: r.entry_id, base: r.source_key.replace(/@v\d+$/, "").replace(/#\d+$/, ""), lines: lines.all(r.entry_id) as FeedEntry["lines"] }));
}

const isBank = (account: string) => /^12\d\d$/.test(account);

/** Every money movement Purser knows, newest first, with totals per currency and the checks a person should see. */
export function transactionRegister(db: DB): Register {
  const drafts: Draft[] = [];
  const approvalOf = db.prepare("SELECT p.proposal_id, a.decision, a.method, a.created_at FROM proposals p LEFT JOIN approvals a ON a.proposal_id = p.proposal_id AND a.approved_sha256 = p.terms_sha256 WHERE p.terms_sha256 = ?");
  const approvalById = db.prepare("SELECT p.proposal_id, p.terms_sha256, a.decision, a.method, a.created_at FROM proposals p LEFT JOIN approvals a ON a.proposal_id = p.proposal_id WHERE p.proposal_id = ?");

  // The payables inbox's invoices, by their payment-ledger number.
  const inbox = new Map<string, { id: string; invoice_no: string; vendor: string; doc: string }>();
  for (const i of has(db, "ap_invoices") ? apInvoices(db) : []) {
    const key = ledgerInvoiceNo(i.invoice_no, i.vendor);
    // A copy of an invoice that is sent again stays in the inbox under the same number, blocked as a duplicate: the
    // payout belongs to the one that was put up for payment, never to the copy that was not.
    if (inbox.has(key) && !i.proposal_id) continue;
    inbox.set(key, { id: i.id, invoice_no: i.invoice_no, vendor: i.vendor, doc: `/api/payables/invoices/${i.id}/document` });
  }

  // Airwallex transfers: supplier and Kit 11 invoice payouts, with the fee Airwallex charged.
  for (const t of db.prepare(`SELECT t.request_id, t.transfer_id, t.invoice_no, t.amount, t.currency, t.fee_actual, t.status, t.failure_reason, t.approval_sha256, t.updated_at,
      i.vendor, b.iban_last4 FROM transfers t LEFT JOIN invoices i ON i.invoice_no = t.invoice_no LEFT JOIN beneficiaries b ON b.beneficiary_id = i.beneficiary_id ORDER BY t.updated_at`).all() as
    { request_id: string; transfer_id: string | null; invoice_no: string; amount: string; currency: string; fee_actual: string | null; status: string; failure_reason: string | null; approval_sha256: string; updated_at: string; vendor: string | null; iban_last4: string | null }[]) {
    const moved = t.status === "SENT" || t.status === "PAID";
    const fee = /^([A-Z]{3}) (\d+\.\d{2})$/.exec(t.fee_actual ?? "");
    const ap = inbox.get(t.invoice_no);
    const feeSame = fee && fee[1] === t.currency ? toCents(fee[2]!) : 0;
    drafts.push({
      id: `transfer:${t.request_id}`, at: t.updated_at, direction: "out", rail: "airwallex_transfer",
      description: `Invoice ${ap?.invoice_no ?? t.invoice_no}`, counterparty: ap?.vendor ?? t.vendor ?? "", counterparty_account: t.iban_last4 ? `…${t.iban_last4}` : null,
      amount: t.amount, currency: t.currency, eur_equivalent: t.currency === "EUR" ? t.amount : null,
      fee: fee ? { amount: fee[2]!, currency: fee[1]! } : null, moved, status: t.status,
      status_words: (TRANSFER_WORDS[t.status] ?? words(t.status)) + (t.failure_reason && !moved ? `: ${t.failure_reason}` : ""),
      invoice: { ap_id: ap?.id ?? null, supplier_no: ap?.invoice_no ?? t.invoice_no, vendor: ap?.vendor ?? t.vendor ?? "", document: ap?.doc ?? null },
      approval: { required: true, authority: "the CFO's approval of the exact terms", proposal_id: null, terms_sha256: t.approval_sha256, sha: t.approval_sha256 },
      proof: t.transfer_id, book: { prefix: `transfer|${t.request_id}|`, expectCents: -(toCents(t.amount) + feeSame) },
    });
  }

  // Purser as an Airwallex platform: Purser's fee per paid payout, taken from the company's account (docs/airwallex-platform.md).
  if (has(db, "platform_fees")) for (const f of db.prepare("SELECT request_id, proposal_id, amount, currency, fee_transfer_id, status, approval_sha256, updated_at FROM platform_fees ORDER BY updated_at").all() as
    { request_id: string; proposal_id: string; amount: string; currency: string; fee_transfer_id: string | null; status: string; approval_sha256: string; updated_at: string }[]) {
    const moved = f.status === "SETTLED";
    drafts.push({
      id: `platform_fee:${f.request_id}`, at: f.updated_at, direction: "out", rail: "airwallex_transfer", description: "Purser platform fee", counterparty: "Purser", counterparty_account: null,
      amount: f.amount, currency: f.currency, eur_equivalent: f.currency === "EUR" ? f.amount : null, fee: null, moved, status: f.status,
      status_words: moved ? "taken" : f.status === "NOT_TAKEN" ? "not taken (fee switched off)" : words(f.status),
      invoice: null,
      approval: { required: true, authority: "the CFO's approval of the exact terms (the fee is in them)", proposal_id: f.proposal_id, terms_sha256: f.approval_sha256, sha: f.approval_sha256 },
      proof: f.fee_transfer_id, book: { prefix: `platform_fee|${f.request_id}|`, expectCents: -toCents(f.amount) },
    });
  }

  // Airwallex FX: each conversion's two legs.
  for (const f of db.prepare("SELECT c.conversion_id, c.buy_amount, c.sell_amount, c.status, c.approval_sha256, q.pair, q.valid_from FROM fx_conversions c JOIN fx_quotes q ON q.quote_id = c.quote_id ORDER BY q.valid_from").all() as
    { conversion_id: string; buy_amount: string; sell_amount: string | null; status: string; approval_sha256: string; pair: string; valid_from: string }[]) {
    const [sell, buy] = f.pair.split("/") as [string, string];
    // Committed once Airwallex has it: SETTLED, or SCHEDULED and settling (red team round 4: a SCHEDULED one showed as not
    // moved while the payout it funded had gone); flagged until its settled event comes in. Cancelled or failed: nothing moved.
    const moved = f.status !== "CANCELLED" && f.status !== "FAILED";
    const pending = moved && f.status !== "SETTLED";
    const eurSide = sell === "EUR" ? f.sell_amount : buy === "EUR" ? f.buy_amount : null;
    const leg = (side: "sell" | "buy"): Draft => {
      const cur = side === "sell" ? sell : buy;
      const amt = side === "sell" ? f.sell_amount ?? "0.00" : f.buy_amount;
      return {
        id: `fx:${f.conversion_id}:${side}`, at: f.valid_from, direction: "internal", leaves: side === "sell", rail: "airwallex_fx",
        description: `Convert ${sell} to ${buy} (${side === "sell" ? "sold" : "bought"})`, counterparty: "Airwallex", counterparty_account: null,
        amount: amt, currency: cur, eur_equivalent: eurSide, fee: null, moved, pending, status: f.status, status_words: pending ? "converting, not settled yet" : moved ? "converted" : words(f.status),
        invoice: null, approval: { required: true, authority: "the CFO's approval of the exact terms", proposal_id: null, terms_sha256: f.approval_sha256, sha: f.approval_sha256 },
        proof: f.conversion_id, book: { prefix: `fx|${f.conversion_id}|1590|${bankAccountFor(cur)}|${cur}`, expectCents: (side === "sell" ? -1 : 1) * toCents(amt) },
      };
    };
    if (f.sell_amount) drafts.push(leg("sell"));
    drafts.push(leg("buy"));
  }

  // Airwallex cards: charges, and the declines Airwallex itself made (never counted as money moved).
  if (has(db, "card_transactions")) {
    for (const c of db.prepare("SELECT transaction_id, card_id, agent, merchant, amount_cents, currency, status, approved, failure_reason, purpose, occurred_at FROM card_transactions ORDER BY occurred_at, transaction_id").all() as
      { transaction_id: string; card_id: string; agent: string; merchant: string; amount_cents: number; currency: string; status: string; approved: number; failure_reason: string | null; purpose: string | null; occurred_at: string }[]) {
      const moved = c.approved === 1;
      drafts.push({
        id: `card:${c.transaction_id}`, at: c.occurred_at, direction: "out", rail: "airwallex_card", description: c.purpose ?? `Card: ${c.merchant}`,
        counterparty: c.merchant, counterparty_account: null, amount: fromCents(c.amount_cents), currency: c.currency, eur_equivalent: c.currency === "EUR" ? fromCents(c.amount_cents) : null,
        fee: null, moved, status: c.status, status_words: moved ? "paid" : `declined by Airwallex${c.failure_reason ? `: ${c.failure_reason}` : ""}`, invoice: null,
        approval: { required: false, authority: `the ${c.agent} agent's card limits, set by the CFO's policy`, proposal_id: null, terms_sha256: null, sha: null },
        proof: c.transaction_id, book: { prefix: `card|${c.card_id}|${c.occurred_at}|${c.amount_cents}|`, expectCents: moved ? -c.amount_cents : 0 },
      });
    }
  }

  // Airwallex Airi: an agent's purchase with a single-use card credential.
  if (has(db, "airi_purchases")) {
    for (const a of db.prepare("SELECT action_id, agent, proposal_id, terms_json, cents, status, outcome, mandate_id, checkout_ref, updated_at FROM airi_purchases ORDER BY updated_at").all() as
      { action_id: string; agent: string; proposal_id: string | null; terms_json: string; cents: number; status: string; outcome: string | null; mandate_id: string | null; checkout_ref: string | null; updated_at: string }[]) {
      const terms = JSON.parse(a.terms_json) as { currency?: string; merchant?: { name?: string } };
      const moved = a.status === "SETTLED";
      const cur = terms.currency ?? "EUR";
      drafts.push({
        id: `airi:${a.action_id}`, at: a.updated_at, direction: "out", rail: "airwallex_airi", description: `Airi purchase by the ${a.agent} agent`,
        counterparty: terms.merchant?.name ?? "", counterparty_account: null, amount: fromCents(a.cents), currency: cur, eur_equivalent: cur === "EUR" ? fromCents(a.cents) : null,
        fee: null, moved, status: a.status, status_words: moved ? "paid" : a.status === "RELEASED" ? "released, nothing paid" : words(a.status), invoice: null,
        approval: a.proposal_id
          ? { required: true, authority: "the CFO's approval of the exact terms", proposal_id: a.proposal_id, terms_sha256: null, sha: null }
          : { required: false, authority: `within the ${a.agent} agent's Airi limit, set by the CFO's policy`, proposal_id: null, terms_sha256: null, sha: null },
        proof: a.checkout_ref ?? a.mandate_id, book: { prefix: `airi|${a.action_id}|`, expectCents: moved ? -a.cents : 0 },
      });
    }
  }

  // Payments into the Global Accounts.
  if (has(db, "receipts")) {
    for (const r of db.prepare("SELECT deposit_id, currency, amount_cents, payer, invoice_no, outcome, received_at FROM receipts ORDER BY received_at, deposit_id").all() as
      { deposit_id: string; currency: string; amount_cents: number; payer: string | null; invoice_no: string | null; outcome: string; received_at: string }[]) {
      drafts.push({
        id: `receipt:${r.deposit_id}`, at: r.received_at, direction: "in", rail: "airwallex_receipt", description: r.invoice_no ? `Payment of invoice ${r.invoice_no}` : "Payment with no matching invoice",
        counterparty: r.payer ?? "", counterparty_account: null, amount: fromCents(r.amount_cents), currency: r.currency, eur_equivalent: r.currency === "EUR" ? fromCents(r.amount_cents) : null,
        fee: null, moved: true, status: r.outcome, status_words: `received, ${words(r.outcome)}`,
        invoice: r.invoice_no ? { ap_id: null, supplier_no: r.invoice_no, vendor: r.payer ?? "", document: null } : null,
        approval: { required: false, authority: "money in: no approval needed", proposal_id: null, terms_sha256: null, sha: null },
        proof: r.deposit_id, book: { prefix: `receipt|${r.deposit_id}|`, expectCents: r.amount_cents },
      });
    }
  }

  // Metal: data sales (in), purchases from the warehouse API (out), refunds, sweeps to Airwallex and their credit.
  const usdz = (cents: number) => fromCents(cents);
  for (const s of db.prepare("SELECT sale_id, price_cents, payer, tx_hash, status, created_at, scheme, clearing_json FROM sales ORDER BY sale_id").all() as
    { sale_id: number; price_cents: number; payer: string; tx_hash: string | null; status: string; created_at: string; scheme: string; clearing_json: string | null }[]) {
    const clearing = s.scheme === "bajillion";
    const receipt = clearing && s.clearing_json ? (JSON.parse(s.clearing_json) as { paid?: { invoice?: { id?: string } } }).paid?.invoice?.id ?? null : null;
    const moved = s.status === "DELIVERED";
    drafts.push({
      id: `sale:${s.sale_id}`, at: s.created_at, direction: "in", rail: clearing ? "metal_clearing" : "metal", description: `Stock check sold to a retailer (${s.sale_id})`,
      counterparty: short(s.payer), counterparty_account: null, amount: usdz(s.price_cents), currency: "USDZ", eur_equivalent: null, fee: null, moved, status: s.status,
      status_words: moved ? "received" : s.status === "ABORTED_NO_CHARGE" ? "aborted, not charged" : "settlement failed, not charged", invoice: null,
      approval: { required: false, authority: "money in: the buyer's own mandate", proposal_id: null, terms_sha256: null, sha: null },
      proof: clearing ? receipt : s.tx_hash, book: { prefix: `sale|${s.sale_id}|`, expectCents: moved ? s.price_cents : 0 },
    });
  }
  const upCols = cols(db, "upstream_purchases");
  for (const u of db.prepare(`SELECT id, price_cents, tx_hash, outcome, refusal_reason, created_at${upCols.has("supplier") ? ", supplier" : ", NULL AS supplier"} FROM upstream_purchases ORDER BY id`).all() as
    { id: number; price_cents: number; tx_hash: string | null; outcome: string; refusal_reason: string | null; created_at: string; supplier: string | null }[]) {
    const moved = u.outcome === "PAID";
    drafts.push({
      id: `upstream:${u.id}`, at: u.created_at, direction: "out", rail: "metal", description: `Stock check bought from the warehouse API (${u.id})`,
      counterparty: u.supplier ?? "warehouse API", counterparty_account: null, amount: usdz(u.price_cents), currency: "USDZ", eur_equivalent: null, fee: null, moved, status: u.outcome,
      status_words: moved ? "paid" : u.outcome === "REFUSED" ? `refused${u.refusal_reason ? `: ${u.refusal_reason}` : ""}` : "in doubt: not counted until the chain says", invoice: null,
      approval: { required: false, authority: "the sourcing agent's Metal mandate, set by the CFO's policy", proposal_id: null, terms_sha256: null, sha: null },
      proof: u.tx_hash, book: { prefix: `upstream|${u.id}|`, expectCents: moved ? -u.price_cents : 0 },
    });
  }
  for (const r of db.prepare("SELECT r.refund_id, r.sale_id, r.amount_cents, r.to_address, r.outcome, r.refusal_reason, r.tx_hash, r.proposal_id, s.created_at FROM refunds r JOIN sales s ON s.sale_id = r.sale_id ORDER BY r.refund_id").all() as
    { refund_id: number; sale_id: number; amount_cents: number; to_address: string; outcome: string; refusal_reason: string | null; tx_hash: string | null; proposal_id: string | null; created_at: string }[]) {
    const moved = r.outcome === "PAID";
    const at = (db.prepare("SELECT ts FROM audit_log WHERE event IN ('refund.paid', 'refund.refused') AND subject = ? ORDER BY seq DESC LIMIT 1").get(String(r.sale_id)) as { ts: string } | undefined)?.ts ?? r.created_at;
    drafts.push({
      id: `refund:${r.refund_id}`, at, direction: "out", rail: "metal", description: `Refund of query ${r.sale_id}`, counterparty: short(r.to_address), counterparty_account: null,
      amount: usdz(r.amount_cents), currency: "USDZ", eur_equivalent: null, fee: null, moved, status: r.outcome,
      status_words: moved ? "refunded" : r.outcome === "REFUSED" ? `refused${r.refusal_reason ? `: ${r.refusal_reason}` : ""}` : words(r.outcome), invoice: null,
      approval: r.proposal_id
        ? { required: true, authority: "the CFO's approval of the exact terms", proposal_id: r.proposal_id, terms_sha256: null, sha: null }
        : { required: false, authority: "the support agent's refund rule, set by the CFO's policy", proposal_id: null, terms_sha256: null, sha: null },
      proof: r.tx_hash, book: { prefix: `refund|${r.refund_id}|`, expectCents: moved ? -r.amount_cents : 0 },
    });
  }
  for (const s of db.prepare("SELECT payment_id, amount_cents, tx_hash, outcome, created_at FROM sweeps ORDER BY created_at").all() as
    { payment_id: string; amount_cents: number; tx_hash: string | null; outcome: string; created_at: string }[]) {
    const moved = s.outcome === "PAID";
    drafts.push({
      id: `sweep:${s.payment_id}`, at: s.created_at, direction: "internal", leaves: true, rail: "metal", description: "Sweep earnings from Metal to Airwallex", counterparty: "own account",
      counterparty_account: null, amount: usdz(s.amount_cents), currency: "USDZ", eur_equivalent: null, fee: null, moved, status: s.outcome, status_words: moved ? "sent to Airwallex" : words(s.outcome),
      invoice: null, approval: { required: false, authority: "own accounts: the treasury agent's sweep rule", proposal_id: null, terms_sha256: null, sha: null },
      proof: s.tx_hash, book: { prefix: `sweep|${s.payment_id}|`, expectCents: moved ? -s.amount_cents : 0 },
    });
  }
  for (const c of db.prepare("SELECT event_key, awx_deposit_id, amount_base_units, tx_hash, created_at FROM chain_credits ORDER BY created_at").all() as
    { event_key: string; awx_deposit_id: string | null; amount_base_units: string; tx_hash: string; created_at: string }[]) {
    const cents = baseUnitsToCents(BigInt(c.amount_base_units));
    const moved = c.awx_deposit_id !== null;
    drafts.push({
      id: `credit:${c.event_key}`, at: c.created_at, direction: "internal", rail: "airwallex_receipt", description: "Sweep credited at Airwallex (1 USDZ = 1 USD)", counterparty: "own account",
      counterparty_account: null, amount: fromCents(cents), currency: "USD", eur_equivalent: null, fee: null, moved, status: moved ? "CREDITED" : "SEEN_ON_CHAIN",
      status_words: moved ? "credited" : "seen on chain, not yet credited", invoice: null,
      approval: { required: false, authority: "own accounts: the treasury agent's sweep rule", proposal_id: null, terms_sha256: null, sha: null },
      proof: c.awx_deposit_id ?? c.tx_hash, book: moved ? { prefix: `credit|${c.awx_deposit_id}|`, expectCents: cents } : { prefix: `credit|${c.event_key}|`, expectCents: 0 },
    });
  }
  for (const w of db.prepare("SELECT id, units, tx, detail, created_at FROM clearing_ops WHERE party = 'seller' AND kind = 'withdraw' ORDER BY id").all() as
    { id: number; units: string; tx: string | null; detail: string | null; created_at: string }[]) {
    const cents = baseUnitsToCents(BigInt(w.units));
    const moved = w.detail === null && w.tx !== null;
    const leg = (from: "1220" | "1210"): Draft => ({
      id: `clearing:${w.id}:${from === "1220" ? "out" : "in"}`, at: w.created_at, direction: "internal", leaves: from === "1220", rail: "metal_clearing",
      description: from === "1220" ? "Clearing earnings withdrawn (out of clearing)" : "Clearing earnings withdrawn (into the wallet)", counterparty: "own account", counterparty_account: null,
      amount: fromCents(cents), currency: "USDZ", eur_equivalent: null, fee: null, moved, status: moved ? "WITHDRAWN" : "FAILED", status_words: moved ? "withdrawn" : `failed${w.detail ? `: ${w.detail}` : ""}`,
      invoice: null, approval: { required: false, authority: "own accounts: the treasury agent's clearing rule", proposal_id: null, terms_sha256: null, sha: null },
      proof: w.tx, book: { prefix: `clearing|${w.id}|1590|${from}|USDZ`, expectCents: moved ? (from === "1220" ? -cents : cents) : 0 },
    });
    drafts.push(leg("1220"), leg("1210"));
  }

  // Bookings: the feed's postings for each movement, and its bank lines in the movement's currency.
  const feed = feedEntries(db);
  const used = new Set<number>();
  const rows: TxRow[] = drafts.map((d) => {
    const a = d.approval.proposal_id
      ? (approvalById.get(d.approval.proposal_id) as { proposal_id: string; terms_sha256: string; decision: string | null; method: string | null; created_at: string | null } | undefined)
      : d.approval.sha ? (approvalOf.get(d.approval.sha) as { proposal_id: string; decision: string | null; method: string | null; created_at: string | null } | undefined) : undefined;
    const approval: TxRow["approval"] = {
      required: d.approval.required, authority: d.approval.authority, proposal_id: a?.proposal_id ?? d.approval.proposal_id,
      decision: a?.decision ?? null, method: a?.method ?? null, approved_at: a?.created_at ?? null,
      terms_sha256: d.approval.terms_sha256 ?? ((a as { terms_sha256?: string } | undefined)?.terms_sha256 ?? null),
    };
    const entries = d.book ? feed.filter((e) => e.base.startsWith(d.book!.prefix)) : [];
    for (const e of entries) used.add(e.entry_id);
    const bookedCents = entries.reduce((n, e) => n + e.lines.filter((l) => isBank(l.account) && l.currency === d.currency).reduce((k, l) => k + l.debit - l.credit, 0), 0);
    const booking: TxRow["booking"] = {
      entry_ids: entries.map((e) => e.entry_id),
      accounts: [...new Set(entries.flatMap((e) => e.lines.map((l) => l.account)))].sort(),
      booked: entries.length ? (bookedCents < 0 ? `-${fromCents(-bookedCents)}` : fromCents(bookedCents)) : null,
    };
    const flags: string[] = [];
    let rec: Reconciliation;
    if (!d.moved) {
      rec = entries.length && bookedCents !== 0 ? "amount_mismatch" : "not_applicable";
      if (rec === "amount_mismatch") flags.push("booked_not_moved");
    } else {
      if (!d.proof) flags.push("no_proof");
      if (!entries.length) flags.push("no_booking");
      else if (bookedCents !== (d.book?.expectCents ?? 0)) flags.push("amount_mismatch");
      if (d.approval.required && approval.decision !== "APPROVED") flags.push("no_approval");
      if (d.pending) flags.push("not_settled");
      rec = flags.includes("amount_mismatch") ? "amount_mismatch" : flags.includes("no_booking") ? "missing_booking" : flags.includes("no_proof") ? "missing_rail_record" : "matched";
    }
    const { book: _book, approval: _a, leaves, pending: _p, ...rest } = d;
    const flow: TxRow["flow"] = d.direction === "internal" ? (leaves ? "out" : "in") : d.direction;
    return { ...rest, flow, rail_label: RAIL_LABELS[d.rail], approval, booking, reconciliation: rec, reconciliation_words: RECONCILIATION_WORDS[rec], flags };
  }).sort((x, y) => {
    // Newest first, by the same key the cloud pages by, compared as the database does (code units, not locale).
    const a = `${x.at}|${x.id}`, b = `${y.at}|${y.id}`;
    return a < b ? 1 : a > b ? -1 : 0;
  });

  const totals = totalsOf(rows);

  const ids = (f: string) => rows.filter((r) => r.flags.includes(f)).map((r) => r.id);
  // The feed's postings for rails this register lists, that no movement claims: opening balances and the inbox's
  // accruals are bookings of their own, not movements.
  const listed = /^(transfer|platform_fee|fx|card|airi|receipt|sale|upstream|refund|sweep|credit|clearing)\|/;
  return {
    rows, totals,
    check: {
      rows: rows.length, moved: rows.filter((r) => r.moved).length, unreconciled: rows.filter((r) => r.moved && r.reconciliation !== "matched").length,
      without_approval: ids("no_approval"), without_booking: ids("no_booking"), without_proof: ids("no_proof"), amount_mismatch: [...ids("amount_mismatch"), ...ids("booked_not_moved")],
      bookings_without_movement: feed.filter((e) => listed.test(e.base) && !used.has(e.entry_id)).map((e) => e.entry_id),
    },
  };
}
