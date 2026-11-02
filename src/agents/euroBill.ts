// The treasury agent's euro-bill work (scenario S3) against the Airwallex port.
// Seeding calibrates floors so the demo shows a shortfall whatever the sandbox starts with; planning
// converts only the shortfall, fee included, on a locked quote, and never below either floor.

import { randomUUID } from "node:crypto";
import type { AirwallexRail, Currency, MarketRate, Quote, SandboxSim } from "../airwallex/port.js";
import { AirwallexAmbiguous, AirwallexError } from "../airwallex/client.js";
import { audit } from "../audit/log.js";
import { EUR_FLOOR_CENTS, INVOICE_PROPOSAL_TTL_MS, LICENSOR_NAME, QUOTE_SAFETY_MS, TARGET_FREE_EUR_CENTS, FX_QUOTE_MAX_MARKUP_BPS } from "../config/policy.js";
import type { DB } from "../db/open.js";
import { fromCents, toCents } from "../lib/money.js";
import { sha256Hex, TERMS_SCHEMA, type Terms } from "../lib/terms.js";
import { createProposal, nextProposalId, type ProposalRow } from "../policy/approvals.js";
import { checkQuoteAgainstFloor, feeReserveCents, feeReserveOverCap, planInvoice, SWIFT_FEE_RESERVE_CAP_CENTS, proposalExpiry, type TreasuryState } from "../policy/treasury.js";
import { getSetting, setSetting } from "../world/settings.js";
import type { FraudFinding } from "../policy/fraud.js";
import { checkInvoice, ibanSha, type Invoice } from "./invoice.js";
import { eurInFlightCents } from "../policy/available.js";
import { checkpoint } from "../policy/saga.js";

export const SEED_REFERENCE = "kit11-seed-funding";
export const SEED_USD_CENTS = 2_500_000;
/** The USD floor sits this far below the seeded balance. */
export const USD_HEADROOM_CENTS = 500_000;

export const MANUFACTURER = {
  name: "Bergtex Textil GmbH",
  iban: "DE89370400440532013000",
  bic: "COBADEFFXXX",
  currency: "EUR" as const,
  countryCode: "DE" as const,
  bankName: "Commerzbank",
  address: { street: "Textilweg 4", city: "Reutlingen", postcode: "72760", countryCode: "DE" as const },
};

/** Kit 11's licensor: Stockline's monthly data licence, invoiced in euros (LICENCE_FEE_EUR_CENTS in code). */
export const LICENSOR = {
  name: LICENSOR_NAME,
  iban: "DE02120300000000202051",
  bic: "BYLADEM1001",
  currency: "EUR" as const,
  countryCode: "DE" as const,
  bankName: "Deutsche Kreditbank",
  address: { street: "Datenallee 12", city: "Berlin", postcode: "10115", countryCode: "DE" as const },
};

export async function snapshot(db: DB, rail: AirwallexRail, label: string) {
  const b = await rail.balances();
  db.prepare("INSERT INTO balance_snapshots (taken_at, label, json) VALUES (?, ?, ?)").run(new Date().toISOString(), label, JSON.stringify(b));
  return b;
}

/** Idempotent: seed USD once, calibrate floors and obligations, allowlist the manufacturer. */
export async function seedTreasury(db: DB, rail: AirwallexRail, sim: SandboxSim): Promise<TreasuryState> {
  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
  if ((await rail.findDepositsByReference(SEED_REFERENCE, since)).length === 0) {
    const d = await sim.simulateDeposit({ globalAccountId: await rail.usdGlobalAccountId(), amountCents: SEED_USD_CENTS, reference: SEED_REFERENCE, payerName: "Seed funding" });
    audit(db, "awx-executor", "treasury.seeded", d.id, { amount: fromCents(SEED_USD_CENTS), currency: "USD", reference: SEED_REFERENCE, origin: { actor: "code", rule: "seed the sandbox treasury with test money (once per world)", agent: "treasury" } });
  }
  const b = await snapshot(db, rail, "seed");
  const usd = b.USD?.availableCents ?? 0;
  const eur = b.EUR?.availableCents ?? 0;
  if (getSetting(db, "usd_floor", "") === "") setSetting(db, "treasury", "usd_floor", fromCents(Math.max(0, usd - USD_HEADROOM_CENTS)));
  if (getSetting(db, "eur_floor", "") === "") setSetting(db, "treasury", "eur_floor", fromCents(EUR_FLOOR_CENTS));
  if (getSetting(db, "eur_obligations", "") === "") {
    setSetting(db, "treasury", "eur_obligations", fromCents(Math.max(0, eur - EUR_FLOOR_CENTS - TARGET_FREE_EUR_CENTS)));
  }

  // The allowlisted payees: the manufacturer and Kit 11's licensor, each created once at Airwallex.
  for (const payee of [MANUFACTURER, LICENSOR]) {
    let ben = await rail.findBeneficiaryByIban(payee.iban);
    ben ??= await rail.createBeneficiary(payee);
    db.prepare("INSERT OR IGNORE INTO beneficiaries (beneficiary_id, name, iban_last4, iban_sha256, bic, currency, method) VALUES (?, ?, ?, ?, ?, 'EUR', 'SWIFT')")
      .run(ben.id, payee.name, payee.iban.slice(-4), ibanSha(payee.iban), payee.bic);
  }
  return treasuryState(db, b);
}

export function treasuryState(db: DB, b: Awaited<ReturnType<AirwallexRail["balances"]>>): TreasuryState {
  return {
    eurAvailableCents: b.EUR?.availableCents ?? 0,
    eurFloorCents: toCents(getSetting(db, "eur_floor", fromCents(EUR_FLOOR_CENTS))),
    eurObligationsCents: toCents(getSetting(db, "eur_obligations", "0.00")),
    usdAvailableCents: b.USD?.availableCents ?? 0,
    usdFloorCents: toCents(getSetting(db, "usd_floor", "0.00")),
    eurInFlightCents: eurInFlightCents(db),
  };
}

export interface InvoicePaymentTerms extends Terms {
  kind: "invoice_payment";
  invoice_no: string;
  vendor: string;
  amount: string;
  currency: "EUR";
  /** The most the SWIFT fee may be; the real fee is read from the transfer and recorded. */
  fee_max: string;
  beneficiary_id: string;
  beneficiary_name: string;
  iban_last4: string;
  bic: string;
  method: "SWIFT";
  reference: string;
  reason: string;
  transfer_request_id: string;
  conversion: null | {
    request_id: string;
    quote_id: string;
    client_rate: string;
    valid_to: string;
    buy_currency: Currency;
    buy_amount: string;
    sell_currency: Currency;
    sell_amount: string;
  };
  balances_before: { eur_available: string; usd_available: string };
  floors: { eur_floor: string; eur_obligations: string; usd_floor: string };
  after: { eur_free: string; usd_available: string };
  evidence: { type: string; ref: string; sha256: string }[];
}

/**
 * Why this invoice may not get another payment proposal, or null. A payout counts unless it was cancelled (the same
 * rule as the one_live_transfer_per_invoice index); a proposal counts while it can still be approved or is running.
 */
export function invoiceAlreadyHandled(db: DB, invoiceNo: string, now = new Date()): string | null {
  // The same invoice with a cosmetically different number ("btx-dup ", another dash) is still the same invoice.
  const key = invoiceKey(invoiceNo);
  const t = (db.prepare("SELECT invoice_no, status FROM transfers WHERE status <> 'CANCELLED' ORDER BY updated_at DESC").all() as { invoice_no: string; status: string }[])
    .find((r) => invoiceKey(r.invoice_no) === key);
  if (t) return t.status === "PAID" ? `invoice ${t.invoice_no} is already paid` : `invoice ${t.invoice_no} already has a payout (${t.status})`;
  const p = (db.prepare(`SELECT proposal_id, json_extract(terms_json, '$.invoice_no') AS invoice_no FROM proposals WHERE kind = 'invoice_payment'
    AND (status IN ('APPROVED', 'EXECUTING') OR (status = 'PENDING_APPROVAL' AND expires_at > ?)) ORDER BY created_at DESC`)
    .all(now.toISOString()) as { proposal_id: string; invoice_no: string | null }[]).find((r) => invoiceKey(r.invoice_no ?? "") === key);
  return p ? `invoice ${p.invoice_no} already waits for approval as ${p.proposal_id}` : null;
}

/** An invoice number as a duplicate check compares it: Unicode-normalised, upper case, any dash as "-", no spaces around it. */
export function invoiceKey(invoiceNo: string): string {
  return invoiceNo.normalize("NFKC").toUpperCase().replace(/\s*[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D-]\s*/g, "-").replace(/\s+/g, "");
}

export type InvoiceOutcome =
  | { kind: "proposed"; proposal: ProposalRow; terms: InvoicePaymentTerms }
  | { kind: "escalated"; reason: string; fraud?: FraudFinding };

/**
 * Plans the payment of an invoice and puts it up for approval. Any reason not to pay (unknown or changed
 * bank details, a floor that would break) becomes an escalation with no money moved.
 */
export async function proposeInvoicePayment(
  db: DB, rail: AirwallexRail, inv: Invoice, invoiceText: string, now = new Date(),
  quoteValidity: "MIN_1" | "MIN_15" = "MIN_15",
): Promise<InvoiceOutcome> {
  const check = checkInvoice(db, inv, invoiceText);
  if (!check.ok) {
    // Blocked before any Airwallex call: no balance read, no quote, no proposal.
    if (check.fraud?.suspicious) {
      audit(db, "treasury", "invoice.fraud_suspected", inv.invoice_no, {
        reason: check.reason, vendor: inv.vendor, amount: inv.amount, currency: inv.currency, iban_last4: inv.iban.replace(/\s+/g, "").slice(-4), bic: inv.bic,
        doc_sha256: sha256Hex(invoiceText), signals: check.fraud.signals.map((s) => ({ code: s.code, blocks: s.blocks, detail: s.detail })),
      }, now);
    } else {
      audit(db, "treasury", "invoice.escalated", inv.invoice_no, { reason: check.reason }, now);
    }
    return { kind: "escalated", reason: check.reason, ...(check.fraud ? { fraud: check.fraud } : {}) };
  }
  // A second copy of an invoice (a reminder, a resend) is never paid twice: not after a payout, not while one waits.
  const dup = invoiceAlreadyHandled(db, inv.invoice_no, now);
  if (dup) {
    const reason = `${dup}; a second copy is not paid again. Options: check with ${check.name} whether this is a reminder, or reject the open proposal first if this copy replaces it`;
    audit(db, "treasury", "invoice.escalated", inv.invoice_no, { reason }, now);
    return { kind: "escalated", reason };
  }
  // An earlier payout of this invoice closed with no transfer id (refused at its first create, or closed by the CFO's
  // --close-unsent): before it is planned again, Airwallex is asked by that request_id (re-review, 2 November). A
  // transfer there means money may have left: no plan, an alarm. No answer: no plan either, until Airwallex answers.
  const closed = (db.prepare("SELECT request_id, invoice_no FROM transfers WHERE status = 'CANCELLED' AND transfer_id IS NULL").all() as { request_id: string; invoice_no: string }[])
    .filter((r) => invoiceKey(r.invoice_no) === invoiceKey(inv.invoice_no));
  for (const c of closed) {
    let held: Awaited<ReturnType<AirwallexRail["findTransferByRequestIdStrict"]>>;
    try {
      // Strict: a list that ignored the filter is an error here, never "nothing" (else the invoice could be paid twice).
      held = await rail.findTransferByRequestIdStrict(c.request_id);
    } catch (e) {
      const reason = `Airwallex could not be asked whether the closed payout ${c.request_id} of invoice ${c.invoice_no} exists after all (${(e as Error).message}); nothing is planned until it answers`;
      audit(db, "treasury", "invoice.escalated", inv.invoice_no, { reason }, now);
      return { kind: "escalated", reason };
    }
    if (held) {
      audit(db, "treasury", "transfer.found_after_close", held.id, { request_id: c.request_id, invoice_no: c.invoice_no, status: held.status, amount: `${held.currency} ${fromCents(held.amountCents)}` }, now);
      const reason = `Airwallex holds transfer ${held.id} (${held.currency} ${fromCents(held.amountCents)}, ${held.status}) under the payout ${c.request_id} that the ledger closed for invoice ${c.invoice_no}; it is not planned again. A person checks it now (npm run reconcile)`;
      audit(db, "treasury", "invoice.escalated", inv.invoice_no, { reason }, now);
      return { kind: "escalated", reason };
    }
  }
  db.prepare("INSERT OR IGNORE INTO invoices (invoice_no, vendor, amount, currency, due_date, iban_sha256, bic, beneficiary_id, doc_sha256, extracted_json, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'RECEIVED')")
    .run(inv.invoice_no, inv.vendor, inv.amount, inv.currency, inv.due_date, ibanSha(inv.iban), inv.bic, check.beneficiaryId, sha256Hex(invoiceText), JSON.stringify(inv));

  const b = await snapshot(db, rail, `plan:${inv.invoice_no}`);
  const s = treasuryState(db, b);
  // Max, 2 November: the fee reserve follows what Airwallex really charged, plus a buffer, never under the ceiling.
  const fees = measuredSwiftFeesCents(db);
  if (feeReserveOverCap(fees)) {
    const reason = `a SWIFT fee of EUR ${fromCents(Math.max(...fees))} is on record, far above the usual; a person checks it before the reserve for the next fee is set (it would be over EUR ${fromCents(SWIFT_FEE_RESERVE_CAP_CENTS)})`;
    audit(db, "treasury", "invoice.escalated", inv.invoice_no, { reason }, now);
    return { kind: "escalated", reason };
  }
  const feeReserve = feeReserveCents(fees);
  const plan = planInvoice(check.amountCents, s, feeReserve);
  if (plan.kind === "underfunded") {
    const reason = `EUR is already ${fromCents(-plan.freeEurCents)} below its floor plus commitments (available ${fromCents(s.eurAvailableCents)}, floor ${fromCents(s.eurFloorCents)}, committed ${fromCents(s.eurObligationsCents)}); options: restore the EUR reserve first, review the commitments, or pay later`;
    audit(db, "treasury", "invoice.escalated", inv.invoice_no, { reason }, now);
    return { kind: "escalated", reason };
  }
  let quote: Quote | null = null;
  let usdAfter = s.usdAvailableCents;
  if (plan.kind === "convert_shortfall") {
    // The market's current rate first: context for judging the binding quote, which is what the CFO approves.
    // A rate or quote Airwallex refuses (unconfigured_client_fee on a newly activated account, forbidden before it is
    // ACTIVE, a lost answer: a quote moves nothing) is an escalation with nothing moved, not a crash (contract tests).
    let market: MarketRate;
    try {
      market = await rail.currentRate({ buyCurrency: "EUR", sellCurrency: "USD", buyAmountCents: plan.buyEurCents });
      quote = await rail.createQuote({ buyCurrency: "EUR", sellCurrency: "USD", buyAmountCents: plan.buyEurCents, validity: quoteValidity });
    } catch (e) {
      if (!(e instanceof AirwallexError) && !(e instanceof AirwallexAmbiguous)) throw e;
      const what = e instanceof AirwallexError ? `${e.status} ${e.code ?? "no code"}` : "no answer";
      const reason = `Airwallex refused the FX rate or quote (${what} on ${e.path}); nothing was converted or paid. Options: try again in a few minutes (a newly activated account answers unconfigured_client_fee at first), pay from EUR on the due date, or pay later`;
      audit(db, "treasury", "invoice.escalated", inv.invoice_no, { reason }, now);
      return { kind: "escalated", reason };
    }
    await checkpoint("quote:after");
    const markupBps = Math.round(((quote.sellAmountCents - market.sellAmountCents) / market.sellAmountCents) * 10_000);
    audit(db, "treasury", "fx.rate_checked", inv.invoice_no, {
      pair: "USD/EUR", buy: `EUR ${fromCents(plan.buyEurCents)}`, market_rate: market.rate, market_cost: `USD ${fromCents(market.sellAmountCents)}`,
      quote_id: quote.quoteId, quote_rate: quote.clientRate, quote_cost: `USD ${fromCents(quote.sellAmountCents)}`, markup_bps: markupBps,
    }, now);
    if (markupBps > FX_QUOTE_MAX_MARKUP_BPS) {
      const reason = `the locked quote costs USD ${fromCents(quote.sellAmountCents)}, ${(markupBps / 100).toFixed(2)}% above the market's current rate (USD ${fromCents(market.sellAmountCents)}); options: ask for a new quote later, pay in EUR on the due date, or approve the dearer quote as an exception`;
      audit(db, "treasury", "invoice.escalated", inv.invoice_no, { reason, quote_id: quote.quoteId }, now);
      return { kind: "escalated", reason };
    }
    const floor = checkQuoteAgainstFloor(quote.sellAmountCents, s);
    if (!floor.ok) {
      audit(db, "treasury", "invoice.escalated", inv.invoice_no, { reason: floor.reason, quote_id: quote.quoteId }, now);
      return { kind: "escalated", reason: `${floor.reason}; options: pay on the due date, ask for a floor exception, or pay later` };
    }
    usdAfter = floor.usdAfterCents;
    db.prepare("INSERT OR IGNORE INTO fx_quotes (quote_id, pair, buy_amount, sell_amount, client_rate, valid_from, valid_to) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(quote.quoteId, "USD/EUR", fromCents(quote.buyAmountCents), fromCents(quote.sellAmountCents), quote.clientRate, quote.validFrom, quote.validTo);
  }

  const id = nextProposalId(db);
  const expires = proposalExpiry(now.getTime(), INVOICE_PROPOSAL_TTL_MS, quote ? Date.parse(quote.validTo) : undefined, QUOTE_SAFETY_MS);
  const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
  const terms: InvoicePaymentTerms = {
    schema: TERMS_SCHEMA, kind: "invoice_payment", proposal_id: id, expires_at: iso(expires),
    invoice_no: inv.invoice_no, vendor: inv.vendor, amount: inv.amount, currency: "EUR", fee_max: fromCents(feeReserve),
    beneficiary_id: check.beneficiaryId, beneficiary_name: check.name, iban_last4: check.ibanLast4, bic: check.bic, method: "SWIFT",
    reference: inv.reference, reason: "professional_business_services", transfer_request_id: randomUUID(),
    conversion: quote && {
      request_id: randomUUID(), quote_id: quote.quoteId, client_rate: quote.clientRate, valid_to: quote.validTo,
      buy_currency: "EUR", buy_amount: fromCents(quote.buyAmountCents), sell_currency: "USD", sell_amount: fromCents(quote.sellAmountCents),
    },
    balances_before: { eur_available: fromCents(s.eurAvailableCents), usd_available: fromCents(s.usdAvailableCents) },
    floors: { eur_floor: fromCents(s.eurFloorCents), eur_obligations: fromCents(s.eurObligationsCents), usd_floor: fromCents(s.usdFloorCents) },
    after: { eur_free: fromCents(Math.max(0, plan.freeEurCents + (quote?.buyAmountCents ?? 0) - plan.needEurCents)), usd_available: fromCents(usdAfter) },
    evidence: [{ type: "invoice", ref: inv.invoice_no, sha256: sha256Hex(invoiceText) }],
  };
  const proposal = createProposal(db, { terms, createdBy: "treasury", evidence: terms.evidence }, now);
  return { kind: "proposed", proposal, terms };
}

/** The SWIFT fees Airwallex really charged, from the ledger (EUR only; a transfer without a recorded fee is skipped). */
export function measuredSwiftFeesCents(db: DB): number[] {
  // Only PAID transfers (review: a failed one's fee says less about the next), and a malformed row is skipped, not fatal.
  return (db.prepare("SELECT fee_actual FROM transfers WHERE method = 'SWIFT' AND status = 'PAID' AND fee_actual LIKE 'EUR %'").all() as { fee_actual: string }[])
    .flatMap((r) => { try { return [toCents(r.fee_actual.slice(4))]; } catch { return []; } });
}
