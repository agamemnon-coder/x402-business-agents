// Paying a supplier in the invoice's own currency (supplier_payment). Planned from the balances Airwallex holds: the
// invoice and the fee reserve for the method come out of that currency's free balance; if it is short, only the
// shortfall is bought from the funding currency the CFO policy names, on a locked quote checked against the market's
// rate and the funding currency's own floor. Nothing moves here: the plan becomes terms the CFO signs with Face ID, and
// src/executors/supplierPayment.ts carries them out. The Kit 11 invoice_payment path (src/agents/euroBill.ts) is not
// changed by this file.

import { randomUUID } from "node:crypto";
import type { AnyQuote, Balance, MarketRate, PayoutRail } from "../airwallex/port.js";
import { AirwallexAmbiguous, AirwallexError } from "../airwallex/client.js";
import { audit } from "../audit/log.js";
import { FX_QUOTE_MAX_MARKUP_BPS, INVOICE_PROPOSAL_TTL_MS, QUOTE_SAFETY_MS, SWIFT_FEE_MAX_EUR_CENTS } from "../config/policy.js";
import type { DB } from "../db/open.js";
import { fromCents, toCents } from "../lib/money.js";
import { sha256Hex, TERMS_SCHEMA, type Terms } from "../lib/terms.js";
import { invoiceAlreadyHandled, PROPOSAL_ID_PENDING } from "../agents/euroBill.js";
import { createProposal, ProposalRefused, type ProposalRow } from "../policy/approvals.js";
import { counterpartyAllowed, frozen } from "../policy/rules.js";
import { proposalExpiry } from "../policy/treasury.js";
import { getSetting } from "../world/settings.js";
import type { Method } from "./routes.js";

export interface SupplierPaymentTerms extends Terms {
  kind: "supplier_payment";
  invoice_no: string;
  vendor: string;
  amount: string;
  currency: string;
  method: Method;
  clearing: string | null;
  beneficiary_id: string;
  beneficiary_name: string;
  /** The supplier's account as the CFO sees it (masked). */
  account: string;
  /** What is held back for Airwallex's fee on this method, in the invoice currency. */
  fee_reserve: string;
  reference: string;
  reason: string;
  transfer_request_id: string;
  conversion: null | {
    request_id: string;
    quote_id: string;
    client_rate: string;
    valid_to: string;
    buy_currency: string;
    buy_amount: string;
    sell_currency: string;
    sell_amount: string;
  };
  balances_before: Record<string, string>;
  floors: Record<string, string>;
  evidence: { type: string; ref: string; sha256: string }[];
}

export type SupplierPaymentOutcome =
  | { kind: "proposed"; proposal: ProposalRow; terms: SupplierPaymentTerms }
  | { kind: "escalated"; reason: string };

/** The supplier's account on file for this payment: added through payee_add (a route recorded with it). */
export interface PayoutBeneficiaryRow { beneficiary_id: string; name: string; currency: string; method: string; details_json: string; status: string }
export interface PayoutDetails { country: string; method: Method; clearing: string | null; account: string; account_key_sha256: string }

export function payoutBeneficiary(db: DB, vendor: string): (PayoutBeneficiaryRow & { details: PayoutDetails }) | null {
  const r = db.prepare("SELECT beneficiary_id, name, currency, method, details_json, status FROM beneficiaries WHERE name = ? AND status = 'ACTIVE' AND details_json IS NOT NULL ORDER BY rowid DESC").get(vendor.trim()) as PayoutBeneficiaryRow | undefined;
  return r ? { ...r, details: JSON.parse(r.details_json) as PayoutDetails } : null;
}

/** The currency a shortfall is bought with (CFO policy `payout.funding_currency`; EUR for a Dutch company by default). */
export function fundingCurrency(db: DB): string {
  return getSetting(db, "payout.funding_currency", "EUR");
}

/** A currency's reserve floor: EUR and USD keep the Kit 11 settings; any other is `floor.<CUR>`, 0.00 until set. */
export function floorCents(db: DB, currency: string): number {
  if (currency === "EUR") return toCents(getSetting(db, "eur_floor", "0.00"));
  if (currency === "USD") return toCents(getSetting(db, "usd_floor", "0.00"));
  return toCents(getSetting(db, `floor.${currency}`, "0.00"));
}

/** EUR already committed to other bills (Kit 11's treasury setting); no other currency carries commitments yet. */
function commitmentsCents(db: DB, currency: string): number {
  return currency === "EUR" ? toCents(getSetting(db, "eur_obligations", "0.00")) : 0;
}

/**
 * The fee reserve per method and currency (`fee_reserve.<METHOD>.<CUR>`). The defaults are safety margins, not
 * Airwallex's prices (it does not quote a payout fee in advance): SWIFT as the Kit 11 EUR ceiling and an equivalent
 * elsewhere, LOCAL none. To confirm against the sandbox's recorded fees before going live.
 */
const SWIFT_RESERVE_DEFAULT: Record<string, number> = { EUR: SWIFT_FEE_MAX_EUR_CENTS, USD: 2500, GBP: 2000, CHF: 2500, CNY: 20_000, TRY: 100_000 };
export function feeReserveFor(db: DB, method: Method, currency: string): number {
  const fallback = method === "SWIFT" ? SWIFT_RESERVE_DEFAULT[currency] ?? 2500 : 0;
  return toCents(getSetting(db, `fee_reserve.${method}.${currency}`, fromCents(fallback)));
}

/** Payouts written in this currency but not yet at Airwallex: spoken for, though not yet out of its available balance. */
export function inFlightCents(db: DB, currency: string, exceptRequestId?: string): number {
  const rows = db.prepare("SELECT amount, fee_estimate FROM transfers WHERE status = 'SUBMITTING' AND currency = ? AND request_id <> ?").all(currency, exceptRequestId ?? "") as { amount: string; fee_estimate: string }[];
  return rows.reduce((s, r) => s + toCents(r.amount) + toCents(r.fee_estimate), 0);
}

/** What this currency can still pay: available, less its floor, commitments and payouts under way. */
export function freeCents(db: DB, balances: Record<string, Balance>, currency: string, exceptRequestId?: string): number {
  return (balances[currency]?.availableCents ?? 0) - floorCents(db, currency) - commitmentsCents(db, currency) - inFlightCents(db, currency, exceptRequestId);
}

export interface SupplierInvoice {
  /** The payment ledger's number (src/ap/ledgerKey.ts: the supplier's number with its name). */
  invoice_no: string;
  vendor: string;
  amount: string;
  currency: string;
  due_date: string;
  reference: string;
  reason?: string;
}

/** Plans the payment and files it for the CFO's Face ID; any reason not to pay is an escalation with nothing moved. */
export async function proposeSupplierPayment(db: DB, rail: PayoutRail, inv: SupplierInvoice, documentText: string, now = new Date()): Promise<SupplierPaymentOutcome> {
  const escalate = (reason: string, extra: Record<string, string> = {}): SupplierPaymentOutcome => {
    audit(db, "treasury", "invoice.escalated", inv.invoice_no, { reason, ...extra }, now);
    return { kind: "escalated", reason };
  };
  const ben = payoutBeneficiary(db, inv.vendor);
  if (!ben) return escalate(`${inv.vendor} has no account on file to pay in ${inv.currency}; it is added through a verified new-supplier request first`);
  if (ben.currency !== inv.currency) return escalate(`${inv.vendor}'s account on file receives ${ben.currency}, but the invoice is in ${inv.currency}: a person checks which account to pay`);
  if (!counterpartyAllowed(db, ben.name)) return escalate(`${ben.name} is blocked by the CFO policy`);
  if (frozen(db)) return escalate("the CFO pulled the emergency stop");
  const dup = invoiceAlreadyHandled(db, inv.invoice_no, now);
  if (dup) return escalate(`${dup}; a second copy is not paid again`);

  const amount = toCents(inv.amount);
  if (!Number.isSafeInteger(amount) || amount <= 0) return escalate(`the amount ${inv.amount} is not a payable amount`);
  const method = ben.details.method;
  const reserve = feeReserveFor(db, method, inv.currency);
  db.prepare("INSERT OR IGNORE INTO invoices (invoice_no, vendor, amount, currency, due_date, iban_sha256, bic, beneficiary_id, doc_sha256, extracted_json, status) VALUES (?, ?, ?, ?, ?, ?, '', ?, ?, ?, 'RECEIVED')")
    .run(inv.invoice_no, inv.vendor, inv.amount, inv.currency, inv.due_date, ben.details.account_key_sha256, ben.beneficiary_id, sha256Hex(documentText), JSON.stringify(inv));

  let balances: Record<string, Balance>;
  try {
    balances = await rail.balancesAll();
  } catch (e) {
    return escalate(`Airwallex's balances could not be read (${(e as Error).message}); nothing is planned without them`);
  }
  db.prepare("INSERT INTO balance_snapshots (taken_at, label, json) VALUES (?, ?, ?)").run(now.toISOString(), `plan:${inv.invoice_no}`, JSON.stringify(balances));
  const cur = inv.currency;
  const need = amount + reserve;
  const free = freeCents(db, balances, cur);
  const funding = fundingCurrency(db);
  if (free < 0) return escalate(`${cur} is already ${fromCents(-free)} below its floor and payouts under way; restore the ${cur} reserve first, or pay later`);

  let quote: AnyQuote | null = null;
  if (free < need) {
    if (funding === cur) return escalate(`${cur} ${fromCents(need)} is needed (fee reserve included) and ${fromCents(free)} is free; the funding currency is ${cur} itself, so nothing can be converted. Add funds, or pay later`);
    const buy = need - free;
    let market: MarketRate;
    try {
      market = await rail.currentRateAny({ buyCurrency: cur, sellCurrency: funding, buyAmountCents: buy });
      quote = await rail.createQuoteAny({ buyCurrency: cur, sellCurrency: funding, buyAmountCents: buy, validity: "MIN_15" });
    } catch (e) {
      if (!(e instanceof AirwallexError) && !(e instanceof AirwallexAmbiguous) && !(e as { code?: string }).code) throw e;
      return escalate(`Airwallex refused the ${funding} to ${cur} rate or quote (${(e as Error).message}); nothing was converted or paid`);
    }
    const markupBps = Math.round(((quote.sellAmountCents - market.sellAmountCents) / market.sellAmountCents) * 10_000);
    audit(db, "treasury", "fx.rate_checked", inv.invoice_no, {
      pair: `${funding}/${cur}`, buy: `${cur} ${fromCents(buy)}`, market_rate: market.rate, market_cost: `${funding} ${fromCents(market.sellAmountCents)}`,
      quote_id: quote.quoteId, quote_rate: quote.clientRate, quote_cost: `${funding} ${fromCents(quote.sellAmountCents)}`, markup_bps: markupBps,
    }, now);
    if (markupBps > FX_QUOTE_MAX_MARKUP_BPS) {
      return escalate(`the locked quote costs ${funding} ${fromCents(quote.sellAmountCents)}, ${(markupBps / 100).toFixed(2)}% above the market's current rate (${funding} ${fromCents(market.sellAmountCents)}); options: ask for a new quote later, or approve the dearer quote as an exception`, { quote_id: quote.quoteId });
    }
    const fundingFree = freeCents(db, balances, funding);
    if (fundingFree - quote.sellAmountCents < 0) {
      return escalate(`buying ${cur} ${fromCents(buy)} costs ${funding} ${fromCents(quote.sellAmountCents)}, and ${funding} has ${fromCents(Math.max(0, fundingFree))} free above its floor and commitments; options: add ${funding}, lower its floor with Face ID, or pay later`, { quote_id: quote.quoteId });
    }
    db.prepare("INSERT OR IGNORE INTO fx_quotes (quote_id, pair, buy_amount, sell_amount, client_rate, valid_from, valid_to) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(quote.quoteId, `${funding}/${cur}`, fromCents(quote.buyAmountCents), fromCents(quote.sellAmountCents), quote.clientRate, quote.validFrom, quote.validTo);
  }

  const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
  const expires = proposalExpiry(now.getTime(), INVOICE_PROPOSAL_TTL_MS, quote ? Date.parse(quote.validTo) : undefined, QUOTE_SAFETY_MS);
  const touched = [...new Set([cur, ...(quote ? [funding] : [])])];
  const terms: SupplierPaymentTerms = {
    schema: TERMS_SCHEMA, kind: "supplier_payment", proposal_id: PROPOSAL_ID_PENDING, expires_at: iso(expires),
    invoice_no: inv.invoice_no, vendor: inv.vendor, amount: fromCents(amount), currency: cur, method, clearing: ben.details.clearing,
    beneficiary_id: ben.beneficiary_id, beneficiary_name: ben.name, account: ben.details.account, fee_reserve: fromCents(reserve),
    reference: inv.reference, reason: inv.reason ?? "goods_purchased", transfer_request_id: randomUUID(),
    conversion: quote && {
      request_id: randomUUID(), quote_id: quote.quoteId, client_rate: quote.clientRate, valid_to: quote.validTo,
      buy_currency: quote.buyCurrency, buy_amount: fromCents(quote.buyAmountCents), sell_currency: quote.sellCurrency, sell_amount: fromCents(quote.sellAmountCents),
    },
    balances_before: Object.fromEntries(touched.map((c) => [c, fromCents(balances[c]?.availableCents ?? 0)])),
    floors: Object.fromEntries(touched.map((c) => [c, fromCents(floorCents(db, c))])),
    evidence: [{ type: "invoice", ref: inv.invoice_no, sha256: sha256Hex(documentText) }],
  };
  let proposal: ProposalRow;
  try {
    proposal = createProposal(db, { terms, createdBy: "treasury", evidence: terms.evidence, guard: (tx) => invoiceAlreadyHandled(tx, inv.invoice_no, now), assignId: true }, now);
  } catch (e) {
    if (!(e instanceof ProposalRefused)) throw e;
    return escalate(`${e.reason}; a second copy is not paid again (another plan was filed while this one was being prepared)`);
  }
  return { kind: "proposed", proposal, terms: { ...terms, proposal_id: proposal.proposal_id } };
}
