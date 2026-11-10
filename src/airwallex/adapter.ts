// The Airwallex sandbox REST adapter behind the port. Field names and types follow the API reference
// (docs pages read 2026-10-29): some request amounts are numbers (quotes, deposit simulation), others
// strings (conversions, transfers); responses are numbers in major units. We convert to integer cents
// at this boundary and nowhere else.

import { randomUUID } from "node:crypto";
import { Airwallex, fromEnv } from "./client.js";
import type { AirwallexRail, AnyQuote, Balance, Beneficiary, Conversion, Currency, Deposit, NewBeneficiary, NewPayoutBeneficiary, NewPayoutTransfer, NewTransfer, PayoutRail, ApplicationFee, Quote, SandboxSim, Transfer, MarketRate } from "./port.js";
import { fromCents } from "../lib/money.js";

/** Major units (number or numeric string) -> integer cents. Refuses negatives and anything finer than a cent. */
export function cents(v: unknown): number {
  const s = typeof v === "number" ? v.toFixed(6) : String(v ?? "").trim();
  const m = /^(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) throw new Error(`not a non-negative amount: ${JSON.stringify(v)}`);
  const frac = (m[2] ?? "").padEnd(6, "0");
  if (/[1-9]/.test(frac.slice(2))) throw new Error(`amount finer than a cent: ${s}`);
  return Number(m[1]) * 100 + Number(frac.slice(0, 2));
}

const asNumber = (c: number) => Number(fromCents(c));

interface AwxTransfer {
  id: string;
  request_id: string;
  status: string;
  transfer_amount: number | string;
  transfer_currency: string;
  failure?: { code?: string; message?: string; details?: { type?: string } } | null;
  failure_type?: string | null;
  failure_reason?: string | null;
  fee_amount?: number | string | null;
  fee_currency?: string | null;
  beneficiary_id?: string | null;
  application_fees?: { amount?: number | string; currency?: string; source_type?: string }[] | null;
}

/** The TRANSFER application fees Airwallex reports on a payout, in one currency; null when there are none. */
function applicationFeeOf(t: AwxTransfer): { cents: number; currency: string } | null {
  const fees = (t.application_fees ?? []).filter((f) => f.source_type === "TRANSFER" && f.amount != null && typeof f.currency === "string");
  if (!fees.length || new Set(fees.map((f) => f.currency)).size !== 1) return null;
  return { cents: fees.reduce((s, f) => s + cents(f.amount!), 0), currency: fees[0]!.currency! };
}

/** Purser's fee as Airwallex's application_fee_options: one FIXED fee on the transfer, in its currency. */
function feeOptions(f: ApplicationFee | undefined): { application_fee_options?: { source_type: "TRANSFER"; type: "FIXED"; amount: string; currency: string }[] } {
  if (!f) return {};
  if (!Number.isSafeInteger(f.amountCents) || f.amountCents <= 0) throw new Error("an application fee is a whole number of cents above zero");
  return { application_fee_options: [{ source_type: "TRANSFER", type: "FIXED", amount: fromCents(f.amountCents), currency: f.currency }] };
}

function toTransfer(t: AwxTransfer): Transfer {
  return {
    id: t.id,
    requestId: t.request_id,
    status: t.status,
    amountCents: cents(t.transfer_amount),
    currency: t.transfer_currency as Currency,
    // The create/retrieve schema nests failure details; the simulation schema has them flat.
    failureType: t.failure_type ?? t.failure?.details?.type ?? t.failure?.code ?? null,
    failureReason: t.failure_reason ?? t.failure?.message ?? null,
    fee: t.fee_amount != null && t.fee_currency ? { cents: cents(t.fee_amount), currency: t.fee_currency } : null,
    beneficiaryId: t.beneficiary_id ?? null,
    applicationFee: applicationFeeOf(t),
  };
}

/**
 * The one item of a GET /transfers?request_id=… answer, or undefined for an empty list. Throws when the list was not
 * filtered by the request_id (another request_id in it, or more pages) or holds two: never read as "nothing".
 */
export function onlyRequestId<T extends { request_id?: unknown }>(r: { items?: T[]; has_more?: unknown } | null | undefined, requestId: string): T | undefined {
  if (!r || !Array.isArray(r.items)) throw new Error("Airwallex's transfer list came without items");
  if (r.has_more === true || r.items.some((x) => x.request_id !== requestId)) throw new Error("Airwallex's transfer list was not filtered by the request_id");
  if (r.items.length > 1) throw new Error(`Airwallex lists more than one transfer under request_id ${requestId}`);
  return r.items[0];
}

export class AirwallexRest implements AirwallexRail, SandboxSim, PayoutRail {
  private usdAccount: string | undefined;

  constructor(private readonly api: Airwallex) {}

  /** The connected account this rail acts for (x-on-behalf-of), or null for the company's own account. */
  get payingAccount(): string | null { return this.api.onBehalfOf; }

  async balances(): Promise<Partial<Record<Currency, Balance>>> {
    const rows = await this.api.call<{ currency: string; available_amount?: number; pending_amount?: number; reserved_amount?: number; account_type?: string }[]>(
      "GET", "/balances/current", undefined, { account_type: "cash" },
    );
    const out: Partial<Record<Currency, Balance>> = {};
    for (const r of rows) {
      if (r.currency !== "USD" && r.currency !== "EUR") continue;
      out[r.currency] = { availableCents: cents(r.available_amount ?? 0), pendingCents: cents(r.pending_amount ?? 0), reservedCents: cents(r.reserved_amount ?? 0) };
    }
    return out;
  }

  async usdGlobalAccountId(): Promise<string> {
    if (this.usdAccount) return this.usdAccount;
    type GA = { id: string; status: string; supported_features?: { currency: string; type?: string }[]; required_features?: { currency: string }[] };
    const list = await this.api.call<{ items: GA[] }>("GET", "/global_accounts", undefined, { status: "ACTIVE", page_size: "100" });
    const usd = list.items.find((g) => g.status === "ACTIVE" && [...(g.supported_features ?? []), ...(g.required_features ?? [])].some((f) => f.currency === "USD"));
    if (usd) return (this.usdAccount = usd.id);
    const created = await this.api.call<GA>("POST", "/global_accounts/create", {
      request_id: randomUUID(), country_code: "US", nick_name: "Northwind USD", required_features: [{ currency: "USD", transfer_method: "LOCAL" }],
    });
    return (this.usdAccount = created.id);
  }

  async findDepositsByReference(reference: string, since: string): Promise<Deposit[]> {
    const found: Deposit[] = [];
    for (let page = 0; ; page++) {
      const r = await this.api.call<{ has_more: boolean; items: { id: string; amount: number; currency: string; reference?: string | null; status: string }[] }>(
        "GET", "/deposits", undefined, { from_created_at: since, page_num: String(page), page_size: "100" },
      );
      for (const d of r.items) {
        if (d.reference === reference) found.push({ id: d.id, amountCents: cents(d.amount), currency: d.currency, reference: d.reference ?? null, status: d.status });
      }
      if (!r.has_more) return found;
    }
  }

  async simulateDeposit(a: { globalAccountId: string; amountCents: number; reference: string; payerName: string }): Promise<Deposit> {
    const d = await this.api.call<{ id: string; amount: number; currency: string; reference?: string; status: string }>("POST", "/simulation/deposit/create", {
      global_account_id: a.globalAccountId, amount: asNumber(a.amountCents), reference: a.reference, payer_name: a.payerName, status: "SETTLED",
    });
    return { id: d.id, amountCents: cents(d.amount), currency: d.currency, reference: d.reference ?? a.reference, status: d.status };
  }

  async currentRate(a: { buyCurrency: Currency; sellCurrency: Currency; buyAmountCents: number }): Promise<MarketRate> {
    const r = await this.api.call<{ rate: number | string; created_at?: string; rate_details?: { level: string; rate: number; sell_amount: number }[] }>(
      "GET", "/fx/rates/current", undefined, { buy_currency: a.buyCurrency, sell_currency: a.sellCurrency, buy_amount: fromCents(a.buyAmountCents) },
    );
    // The CLIENT level is what this account would pay; the AWX level is Airwallex's own.
    const client = r.rate_details?.find((d) => d.level === "CLIENT");
    if (!client) throw new Error("Airwallex's current rate came without the client level");
    return { rate: String(client.rate), sellAmountCents: Math.round(client.sell_amount * 100), at: r.created_at ? new Date(r.created_at.replace(/\+0000$/, "Z")).toISOString() : new Date().toISOString() };
  }

  async createQuote(a: { buyCurrency: Currency; sellCurrency: Currency; buyAmountCents: number; validity: "MIN_1" | "MIN_15" | "MIN_30" | "HR_1" }): Promise<Quote> {
    const q = await this.api.call<{ quote_id: string; buy_amount: number; sell_amount: number; client_rate: number | string; valid_from_at: string; valid_to_at: string }>(
      "POST", "/fx/quotes/create", { buy_currency: a.buyCurrency, sell_currency: a.sellCurrency, buy_amount: asNumber(a.buyAmountCents), validity: a.validity },
    );
    return {
      quoteId: q.quote_id, buyCurrency: a.buyCurrency, sellCurrency: a.sellCurrency,
      buyAmountCents: cents(q.buy_amount), sellAmountCents: cents(q.sell_amount), clientRate: String(q.client_rate),
      validFrom: new Date(q.valid_from_at).toISOString(), validTo: new Date(q.valid_to_at).toISOString(),
    };
  }

  async createConversion(a: { requestId: string; quote: Quote; approvalSha256: string }): Promise<Conversion> {
    const c = await this.api.call<{ conversion_id: string; request_id: string; status: string; buy_amount: number | string; sell_amount: number | string; quote_id?: string }>(
      "POST", "/fx/conversions/create", {
        request_id: a.requestId, quote_id: a.quote.quoteId, buy_currency: a.quote.buyCurrency, sell_currency: a.quote.sellCurrency,
        buy_amount: fromCents(a.quote.buyAmountCents), metadata: { approval_sha256: a.approvalSha256 },
      },
    );
    return { conversionId: c.conversion_id, requestId: c.request_id, quoteId: c.quote_id ?? a.quote.quoteId, status: c.status, buyAmountCents: cents(c.buy_amount), sellAmountCents: cents(c.sell_amount) };
  }

  async findConversionByRequestId(requestId: string): Promise<Conversion | undefined> {
    type C = { conversion_id: string; request_id: string; status: string; buy_amount: number | string; sell_amount: number | string; quote_id?: string };
    // Newest first; the request_id is checked here too, in case the list ignores the filter.
    for (let page = 0; page < 5; page++) {
      const r = await this.api.call<{ has_more?: boolean; items: C[] }>("GET", "/fx/conversions", undefined, { request_id: requestId, page_num: String(page), page_size: "100" });
      const c = r.items.find((x) => x.request_id === requestId);
      if (c) return { conversionId: c.conversion_id, requestId: c.request_id, quoteId: c.quote_id ?? "", status: c.status, buyAmountCents: cents(c.buy_amount), sellAmountCents: cents(c.sell_amount) };
      if (!r.has_more) return undefined;
    }
    return undefined;
  }

  async findBeneficiaryByIban(iban: string): Promise<Beneficiary | undefined> {
    type B = { id: string; beneficiary: { company_name?: string; bank_details?: { iban?: string; swift_code?: string; account_currency?: string; account_name?: string } } };
    for (let page = 0; ; page++) {
      const r = await this.api.call<{ has_more: boolean; items: B[] }>("GET", "/beneficiaries", undefined, { page_num: String(page), page_size: "100" });
      const hit = r.items.find((b) => b.beneficiary.bank_details?.iban?.replace(/\s+/g, "") === iban);
      if (hit) {
        const bd = hit.beneficiary.bank_details!;
        return { id: hit.id, name: hit.beneficiary.company_name ?? bd.account_name ?? "", iban, bic: bd.swift_code ?? "", currency: (bd.account_currency ?? "EUR") as Currency };
      }
      if (!r.has_more) return undefined;
    }
  }

  async createBeneficiary(b: NewBeneficiary): Promise<Beneficiary> {
    const body = {
      beneficiary: {
        entity_type: "COMPANY", company_name: b.name, type: "BANK_ACCOUNT",
        address: { country_code: b.address.countryCode, street_address: b.address.street, city: b.address.city, postcode: b.address.postcode },
        bank_details: { account_currency: b.currency, account_name: b.name, bank_country_code: b.countryCode, bank_name: b.bankName, iban: b.iban, swift_code: b.bic },
      },
      nickname: `${b.name} ${b.currency} SWIFT`,
      transfer_methods: ["SWIFT"],
      payment_methods: ["SWIFT"],
    };
    // Airwallex's own schema for this country, currency and method names the fields it requires: check them first.
    const schema = await this.api.call<{ schema: Record<string, { required?: boolean; relevant?: boolean; type?: string }> }>("POST", "/beneficiaries/schema",
      { bank_country_code: b.countryCode, account_currency: b.currency, payment_method: "SWIFT", entity_type: "COMPANY" });
    const missing = Object.entries(schema.schema)
      .filter(([k, v]) => v.required && v.relevant && v.type !== "object" && k.startsWith("create_beneficiary_request."))
      .map(([k]) => k.slice("create_beneficiary_request.".length))
      .filter((path) => path.split(".").reduce<unknown>((o, key) => (o && typeof o === "object" ? (o as Record<string, unknown>)[key] : undefined), body) === undefined);
    if (missing.length) throw new Error(`Airwallex's beneficiary schema for ${b.countryCode}, ${b.currency}, SWIFT needs ${missing.join(", ")}`);
    await this.api.call("POST", "/beneficiaries/validate", body);
    const r = await this.api.call<{ id: string }>("POST", "/beneficiaries/create", body);
    return { id: r.id, name: b.name, iban: b.iban, bic: b.bic, currency: b.currency };
  }

  async createTransfer(t: NewTransfer): Promise<Transfer> {
    const r = await this.api.call<AwxTransfer>("POST", "/transfers/create", {
      request_id: t.requestId, beneficiary_id: t.beneficiaryId, transfer_amount: fromCents(t.amountCents), transfer_currency: t.currency,
      source_currency: t.sourceCurrency, transfer_method: "SWIFT", reference: t.reference, reason: t.reason,
      metadata: { approval_sha256: t.approvalSha256 }, ...feeOptions(t.applicationFee),
    });
    return toTransfer(r);
  }

  async findTransferByRequestId(requestId: string): Promise<Transfer | undefined> {
    const r = await this.api.call<{ items: AwxTransfer[] }>("GET", "/transfers", undefined, { request_id: requestId });
    const hit = r.items.find((t) => t.request_id === requestId);
    return hit && toTransfer(hit);
  }

  async findTransferByRequestIdStrict(requestId: string): Promise<Transfer | undefined> {
    const r = await this.api.call<{ items?: AwxTransfer[]; has_more?: unknown }>("GET", "/transfers", undefined, { request_id: requestId });
    const hit = onlyRequestId(r, requestId);
    return hit && toTransfer(hit);
  }

  async getTransfer(id: string): Promise<Transfer> {
    return toTransfer(await this.api.call<AwxTransfer>("GET", `/transfers/${encodeURIComponent(id)}`));
  }

  async transitionTransfer(id: string, to: "SENT" | "PAID" | "FAILED", failureType?: string): Promise<Transfer> {
    return toTransfer(await this.api.call<AwxTransfer>("POST", `/simulation/transfers/${id}/transition`, { next_status: to, ...(failureType ? { failure_type: failureType } : {}) }));
  }

  // ---- Payables in any currency (PayoutRail). Cents assume two decimals: src/payouts/routes.ts pays no other currency.

  async balancesAll(): Promise<Record<string, Balance>> {
    const rows = await this.api.call<{ currency: string; available_amount?: number; pending_amount?: number; reserved_amount?: number }[]>(
      "GET", "/balances/current", undefined, { account_type: "cash" },
    );
    const out: Record<string, Balance> = {};
    for (const r of rows) out[r.currency] = { availableCents: cents(r.available_amount ?? 0), pendingCents: cents(r.pending_amount ?? 0), reservedCents: cents(r.reserved_amount ?? 0) };
    return out;
  }

  async currentRateAny(a: { buyCurrency: string; sellCurrency: string; buyAmountCents: number }): Promise<MarketRate> {
    return this.currentRate(a as { buyCurrency: Currency; sellCurrency: Currency; buyAmountCents: number });
  }

  async createQuoteAny(a: { buyCurrency: string; sellCurrency: string; buyAmountCents: number; validity: "MIN_1" | "MIN_15" | "MIN_30" | "HR_1" }): Promise<AnyQuote> {
    return this.createQuote(a as { buyCurrency: Currency; sellCurrency: Currency; buyAmountCents: number; validity: "MIN_1" | "MIN_15" | "MIN_30" | "HR_1" });
  }

  async createConversionAny(a: { requestId: string; quote: AnyQuote; approvalSha256: string }): Promise<Conversion> {
    return this.createConversion({ ...a, quote: a.quote as Quote });
  }

  /**
   * POST /beneficiaries/create with bank_details for the route (create-beneficiaries.md: beneficiary.bank_details,
   * transfer_methods; the US example uses account_number, account_routing_type1/value1 and local_clearing_system).
   * Airwallex's schema for the country, currency and method is asked first, and /beneficiaries/validate runs before
   * the create (validate-a-beneficiary.md), as for the Kit 11 payees.
   */
  async createPayoutBeneficiary(b: NewPayoutBeneficiary): Promise<{ id: string }> {
    const k = b.bank;
    const bank_details: Record<string, string> = { account_currency: k.currency, account_name: k.accountName, bank_country_code: k.country };
    if (k.iban) bank_details.iban = k.iban;
    if (k.accountNumber) bank_details.account_number = k.accountNumber;
    if (k.routingType && k.routingValue) { bank_details.account_routing_type1 = k.routingType; bank_details.account_routing_value1 = k.routingValue; }
    if (k.swiftCode) bank_details.swift_code = k.swiftCode;
    if (b.clearing) bank_details.local_clearing_system = b.clearing;
    const body = {
      beneficiary: {
        entity_type: "COMPANY", company_name: b.name, type: "BANK_ACCOUNT",
        address: { country_code: b.address.countryCode, street_address: b.address.street, city: b.address.city, postcode: b.address.postcode },
        bank_details,
      },
      nickname: `${b.name} ${k.currency} ${b.method}`,
      transfer_methods: [b.method],
    };
    const schema = await this.api.call<{ schema: Record<string, { required?: boolean; relevant?: boolean; type?: string }> }>("POST", "/beneficiaries/schema",
      { bank_country_code: k.country, account_currency: k.currency, payment_method: b.method, entity_type: "COMPANY", ...(b.clearing ? { local_clearing_system: b.clearing } : {}) });
    const missing = Object.entries(schema.schema)
      .filter(([key, v]) => v.required && v.relevant && v.type !== "object" && key.startsWith("create_beneficiary_request."))
      .map(([key]) => key.slice("create_beneficiary_request.".length))
      .filter((path) => path.split(".").reduce<unknown>((o, key) => (o && typeof o === "object" ? (o as Record<string, unknown>)[key] : undefined), body) === undefined);
    if (missing.length) throw new Error(`Airwallex's beneficiary schema for ${k.country}, ${k.currency}, ${b.method} needs ${missing.join(", ")}`);
    await this.api.call("POST", "/beneficiaries/validate", body);
    const r = await this.api.call<{ id: string }>("POST", "/beneficiaries/create", body);
    return { id: r.id };
  }

  /**
   * GET /beneficiaries, every page: the one with this company name, transfer method and exactly these bank details
   * (an earlier create whose answer was lost), so a re-run adopts it instead of creating a second.
   */
  async findPayoutBeneficiary(b: NewPayoutBeneficiary): Promise<{ id: string } | undefined> {
    type B = { id: string; transfer_methods?: string[]; beneficiary: { company_name?: string; bank_details?: Record<string, string | undefined> } };
    const norm = (v: string | undefined) => (v ?? "").replace(/\s+/g, "").toUpperCase();
    const k = b.bank;
    // The account itself, as sent to /beneficiaries/create (the clearing system is not compared: the method is).
    const want: Record<string, string | undefined> = {
      bank_country_code: k.country, account_currency: k.currency, iban: k.iban, account_number: k.accountNumber,
      account_routing_value1: k.routingType && k.routingValue ? k.routingValue : undefined, swift_code: k.swiftCode,
    };
    for (let page = 0; ; page++) {
      const r = await this.api.call<{ has_more: boolean; items: B[] }>("GET", "/beneficiaries", undefined, { page_num: String(page), page_size: "100" });
      const hit = r.items.find((x) => x.beneficiary.company_name === b.name && (x.transfer_methods ?? []).includes(b.method)
        && Object.entries(want).every(([key, v]) => norm(x.beneficiary.bank_details?.[key]) === norm(v)));
      if (hit) return { id: hit.id };
      if (!r.has_more) return undefined;
    }
  }

  /** POST /transfers/create (create-a-transfer.md: transfer_method LOCAL or SWIFT, transfer_currency, source_currency). */
  async createPayoutTransfer(t: NewPayoutTransfer): Promise<Transfer> {
    const r = await this.api.call<AwxTransfer>("POST", "/transfers/create", {
      request_id: t.requestId, beneficiary_id: t.beneficiaryId, transfer_amount: fromCents(t.amountCents), transfer_currency: t.currency,
      source_currency: t.sourceCurrency, transfer_method: t.method, reference: t.reference, reason: t.reason,
      metadata: { approval_sha256: t.approvalSha256 }, ...feeOptions(t.applicationFee),
    });
    return toTransfer(r);
  }
}

/** The adapter when the sandbox keys are set; null otherwise, so callers stop instead of pretending. */
export async function airwallexFromEnv(): Promise<{ rail: AirwallexRail & PayoutRail; sim: SandboxSim } | null> {
  const cfg = fromEnv();
  if (!cfg) return null;
  const rest = new AirwallexRest(new Airwallex(cfg));
  return { rail: rest, sim: rest };
}
