// The Airwallex sandbox REST adapter behind the port. Field names and types follow the API reference
// (docs pages read 2026-10-29): some request amounts are numbers (quotes, deposit simulation), others
// strings (conversions, transfers); responses are numbers in major units. We convert to integer cents
// at this boundary and nowhere else.

import { randomUUID } from "node:crypto";
import { Airwallex, fromEnv } from "./client.js";
import type {
  AirwallexRail, Balance, Beneficiary, Conversion, Currency, Deposit, NewBeneficiary, NewTransfer, Quote, SandboxSim, Transfer,
} from "./port.js";
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
  };
}

export class AirwallexRest implements AirwallexRail, SandboxSim {
  private usdAccount: string | undefined;

  constructor(private readonly api: Airwallex) {}

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
      request_id: randomUUID(), country_code: "US", nick_name: "Tidemark USD", required_features: [{ currency: "USD", transfer_method: "LOCAL" }],
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
        bank_details: { account_currency: b.currency, account_name: b.name, bank_country_code: b.countryCode, iban: b.iban, swift_code: b.bic },
      },
      nickname: `${b.name} ${b.currency} SWIFT`,
      transfer_methods: ["SWIFT"],
    };
    await this.api.call("POST", "/beneficiaries/validate", body);
    const r = await this.api.call<{ id: string }>("POST", "/beneficiaries/create", body);
    return { id: r.id, name: b.name, iban: b.iban, bic: b.bic, currency: b.currency };
  }

  async createTransfer(t: NewTransfer): Promise<Transfer> {
    const r = await this.api.call<AwxTransfer>("POST", "/transfers/create", {
      request_id: t.requestId, beneficiary_id: t.beneficiaryId, transfer_amount: fromCents(t.amountCents), transfer_currency: t.currency,
      source_currency: t.sourceCurrency, transfer_method: "SWIFT", reference: t.reference, reason: t.reason,
      metadata: { approval_sha256: t.approvalSha256 },
    });
    return toTransfer(r);
  }

  async findTransferByRequestId(requestId: string): Promise<Transfer | undefined> {
    const r = await this.api.call<{ items: AwxTransfer[] }>("GET", "/transfers", undefined, { request_id: requestId });
    const hit = r.items.find((t) => t.request_id === requestId);
    return hit && toTransfer(hit);
  }

  async getTransfer(id: string): Promise<Transfer> {
    return toTransfer(await this.api.call<AwxTransfer>("GET", `/transfers/${id}`));
  }

  async transitionTransfer(id: string, to: "SENT" | "PAID" | "FAILED", failureType?: string): Promise<Transfer> {
    return toTransfer(await this.api.call<AwxTransfer>("POST", `/simulation/transfers/${id}/transition`, { next_status: to, ...(failureType ? { failure_type: failureType } : {}) }));
  }
}

/** The adapter when the sandbox keys are set; null otherwise, so callers stop instead of pretending. */
export async function airwallexFromEnv(): Promise<{ rail: AirwallexRail; sim: SandboxSim } | null> {
  const cfg = fromEnv();
  if (!cfg) return null;
  const rest = new AirwallexRest(new Airwallex(cfg));
  return { rail: rest, sim: rest };
}
