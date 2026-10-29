// The treasury agent's euro-bill work (scenario S3) against the Airwallex port.
// Seeding calibrates floors so the demo shows a shortfall whatever the sandbox starts with; planning
// converts only the shortfall, fee included, on a locked quote, and never below either floor.

import { randomUUID } from "node:crypto";
import type { AirwallexRail, Currency, Quote, SandboxSim } from "../airwallex/port.js";
import { audit } from "../audit/log.js";
import { EUR_FLOOR_CENTS, PROPOSAL_TTL_MS, QUOTE_SAFETY_MS, SWIFT_FEE_EUR_CENTS, TARGET_FREE_EUR_CENTS } from "../config/policy.js";
import type { DB } from "../db/open.js";
import { fromCents, toCents } from "../lib/money.js";
import { sha256Hex, TERMS_SCHEMA, type Terms } from "../lib/terms.js";
import { createProposal, nextProposalId, type ProposalRow } from "../policy/approvals.js";
import { checkQuoteAgainstFloor, planInvoice, proposalExpiry, type TreasuryState } from "../policy/treasury.js";
import { getSetting, setSetting } from "../world/settings.js";
import { checkInvoice, ibanSha, type Invoice } from "./invoice.js";

export const SEED_REFERENCE = "kit11-seed-funding";
export const SEED_USD_CENTS = 2_500_000;
/** The USD floor sits this far below the seeded balance. */
export const USD_HEADROOM_CENTS = 500_000;

export const LICENSOR = {
  name: "Lizenzhaus Beispiel GmbH",
  iban: "DE89370400440532013000",
  bic: "COBADEFFXXX",
  currency: "EUR" as const,
  countryCode: "DE" as const,
  address: { street: "Musterstrasse 12", city: "Berlin", postcode: "10115", countryCode: "DE" as const },
};

export async function snapshot(db: DB, rail: AirwallexRail, label: string) {
  const b = await rail.balances();
  db.prepare("INSERT INTO balance_snapshots (taken_at, label, json) VALUES (?, ?, ?)").run(new Date().toISOString(), label, JSON.stringify(b));
  return b;
}

/** Idempotent: seed USD once, calibrate floors and obligations, allowlist the licensor. */
export async function seedTreasury(db: DB, rail: AirwallexRail, sim: SandboxSim): Promise<TreasuryState> {
  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
  if ((await rail.findDepositsByReference(SEED_REFERENCE, since)).length === 0) {
    const d = await sim.simulateDeposit({ globalAccountId: await rail.usdGlobalAccountId(), amountCents: SEED_USD_CENTS, reference: SEED_REFERENCE, payerName: "Seed funding" });
    audit(db, "awx-executor", "treasury.seeded", d.id, { amount: fromCents(SEED_USD_CENTS), currency: "USD", reference: SEED_REFERENCE });
  }
  const b = await snapshot(db, rail, "seed");
  const usd = b.USD?.availableCents ?? 0;
  const eur = b.EUR?.availableCents ?? 0;
  if (getSetting(db, "usd_floor", "") === "") setSetting(db, "treasury", "usd_floor", fromCents(Math.max(0, usd - USD_HEADROOM_CENTS)));
  if (getSetting(db, "eur_floor", "") === "") setSetting(db, "treasury", "eur_floor", fromCents(EUR_FLOOR_CENTS));
  if (getSetting(db, "eur_obligations", "") === "") {
    setSetting(db, "treasury", "eur_obligations", fromCents(Math.max(0, eur - EUR_FLOOR_CENTS - TARGET_FREE_EUR_CENTS)));
  }

  let ben = await rail.findBeneficiaryByIban(LICENSOR.iban);
  ben ??= await rail.createBeneficiary(LICENSOR);
  db.prepare("INSERT OR IGNORE INTO beneficiaries (beneficiary_id, name, iban_last4, iban_sha256, bic, currency, method) VALUES (?, ?, ?, ?, ?, 'EUR', 'SWIFT')")
    .run(ben.id, LICENSOR.name, LICENSOR.iban.slice(-4), ibanSha(LICENSOR.iban), LICENSOR.bic);
  return treasuryState(db, b);
}

export function treasuryState(db: DB, b: Awaited<ReturnType<AirwallexRail["balances"]>>): TreasuryState {
  return {
    eurAvailableCents: b.EUR?.availableCents ?? 0,
    eurFloorCents: toCents(getSetting(db, "eur_floor", fromCents(EUR_FLOOR_CENTS))),
    eurObligationsCents: toCents(getSetting(db, "eur_obligations", "0.00")),
    usdAvailableCents: b.USD?.availableCents ?? 0,
    usdFloorCents: toCents(getSetting(db, "usd_floor", "0.00")),
  };
}

export interface InvoicePaymentTerms extends Terms {
  kind: "invoice_payment";
  invoice_no: string;
  vendor: string;
  amount: string;
  currency: "EUR";
  fee: string;
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

export type InvoiceOutcome =
  | { kind: "proposed"; proposal: ProposalRow; terms: InvoicePaymentTerms }
  | { kind: "escalated"; reason: string };

/**
 * Plans the payment of an invoice and puts it up for approval. Any reason not to pay (unknown or changed
 * bank details, a floor that would break) becomes an escalation with no money moved.
 */
export async function proposeInvoicePayment(db: DB, rail: AirwallexRail, inv: Invoice, invoiceText: string, now = new Date()): Promise<InvoiceOutcome> {
  const check = checkInvoice(db, inv);
  if (!check.ok) {
    audit(db, "treasury", "invoice.escalated", inv.invoice_no, { reason: check.reason }, now);
    return { kind: "escalated", reason: check.reason };
  }
  db.prepare("INSERT OR IGNORE INTO invoices (invoice_no, vendor, amount, currency, due_date, iban_sha256, bic, beneficiary_id, doc_sha256, extracted_json, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'RECEIVED')")
    .run(inv.invoice_no, inv.vendor, inv.amount, inv.currency, inv.due_date, ibanSha(inv.iban), inv.bic, check.beneficiaryId, sha256Hex(invoiceText), JSON.stringify(inv));

  const b = await snapshot(db, rail, `plan:${inv.invoice_no}`);
  const s = treasuryState(db, b);
  const plan = planInvoice(check.amountCents, s);
  let quote: Quote | null = null;
  let usdAfter = s.usdAvailableCents;
  if (plan.kind === "convert_shortfall") {
    quote = await rail.createQuote({ buyCurrency: "EUR", sellCurrency: "USD", buyAmountCents: plan.buyEurCents, validity: "MIN_15" });
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
  const expires = proposalExpiry(now.getTime(), PROPOSAL_TTL_MS, quote ? Date.parse(quote.validTo) : undefined, QUOTE_SAFETY_MS);
  const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
  const terms: InvoicePaymentTerms = {
    schema: TERMS_SCHEMA, kind: "invoice_payment", proposal_id: id, expires_at: iso(expires),
    invoice_no: inv.invoice_no, vendor: inv.vendor, amount: inv.amount, currency: "EUR", fee: fromCents(SWIFT_FEE_EUR_CENTS),
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
