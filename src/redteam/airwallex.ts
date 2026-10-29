// In-memory stand-in for the Airwallex sandbox, for tests, the red team and the evals. It never reaches a live run.

import { AirwallexAmbiguous } from "../airwallex/client.js";
import type { AirwallexRail, Balance, Beneficiary, Conversion, Currency, Deposit, NewBeneficiary, NewTransfer, Quote, SandboxSim, Transfer, MarketRate } from "../airwallex/port.js";

/** What the real sandbox charged for a EUR SWIFT payout on 2026-10-29. */
export const SANDBOX_SWIFT_FEE_CENTS = 1347;

export class FakeAirwallex implements AirwallexRail, SandboxSim {
  bal: Record<Currency, Balance> = { USD: { availableCents: 0, pendingCents: 0, reservedCents: 0 }, EUR: { availableCents: 1_000_000, pendingCents: 0, reservedCents: 0 } };
  deposits: (Deposit & { createdAt: string })[] = [];
  quotes = new Map<string, Quote>();
  conversions: Conversion[] = [];
  beneficiaries: Beneficiary[] = [];
  transfers: (Transfer & { metadata: string })[] = [];
  calls: string[] = [];
  /** Lose the answer to the next transfer create (the transfer is still made). */
  loseNextTransferAnswer = false;
  clock = () => Date.now();
  rate = "1.0850";
  n = 0;

  async balances() { this.calls.push("balances"); return structuredClone(this.bal); }
  async usdGlobalAccountId() { return "ga_usd_1"; }
  async findDepositsByReference(reference: string) { return this.deposits.filter((d) => d.reference === reference); }
  async simulateDeposit(a: { globalAccountId: string; amountCents: number; reference: string; payerName: string }): Promise<Deposit> {
    this.calls.push("simulateDeposit");
    const d = { id: `dep_${++this.n}`, amountCents: a.amountCents, currency: "USD", reference: a.reference, status: "SETTLED", createdAt: new Date(this.clock()).toISOString() };
    this.deposits.push(d);
    this.bal.USD.availableCents += a.amountCents;
    return d;
  }
  /** The market's rate, when a test wants the locked quote to differ from it. */
  marketRate: string | null = null;
  async currentRate(a: { buyCurrency: Currency; sellCurrency: Currency; buyAmountCents: number }): Promise<MarketRate> {
    this.calls.push("currentRate");
    const rate = this.marketRate ?? this.rate;
    return { rate, sellAmountCents: Math.ceil(a.buyAmountCents * Number(rate)), at: new Date(this.clock()).toISOString() };
  }
  async createQuote(a: { buyCurrency: Currency; sellCurrency: Currency; buyAmountCents: number; validity: string }): Promise<Quote> {
    this.calls.push("createQuote");
    const ms = { MIN_1: 60_000, MIN_15: 900_000, MIN_30: 1_800_000, HR_1: 3_600_000 }[a.validity]!;
    const q: Quote = {
      quoteId: `q_${++this.n}`, buyCurrency: a.buyCurrency, sellCurrency: a.sellCurrency, buyAmountCents: a.buyAmountCents,
      sellAmountCents: Math.ceil(a.buyAmountCents * Number(this.rate)), clientRate: this.rate,
      validFrom: new Date(this.clock()).toISOString(), validTo: new Date(this.clock() + ms).toISOString(),
    };
    this.quotes.set(q.quoteId, q);
    return q;
  }
  async createConversion(a: { requestId: string; quote: Quote; approvalSha256: string }): Promise<Conversion> {
    this.calls.push("createConversion");
    const q = this.quotes.get(a.quote.quoteId)!;
    if (Date.parse(q.validTo) <= this.clock()) throw Object.assign(new Error("expired"), { code: "expired_quote" });
    this.bal.USD.availableCents -= q.sellAmountCents;
    this.bal.EUR.availableCents += q.buyAmountCents;
    const c = { conversionId: `conv_${++this.n}`, requestId: a.requestId, quoteId: q.quoteId, status: "SETTLED", buyAmountCents: q.buyAmountCents, sellAmountCents: q.sellAmountCents };
    this.conversions.push(c);
    return c;
  }
  async findBeneficiaryByIban(iban: string) { return this.beneficiaries.find((b) => b.iban === iban); }
  async createBeneficiary(b: NewBeneficiary): Promise<Beneficiary> {
    const ben = { id: `ben_${++this.n}`, name: b.name, iban: b.iban, bic: b.bic, currency: b.currency };
    this.beneficiaries.push(ben);
    return ben;
  }
  async createTransfer(t: NewTransfer): Promise<Transfer> {
    this.calls.push("createTransfer");
    if (this.transfers.some((x) => x.requestId === t.requestId)) throw new Error("duplicate request_id");
    const fee = SANDBOX_SWIFT_FEE_CENTS;
    if (this.bal.EUR.availableCents < t.amountCents + fee) throw Object.assign(new Error("balance_insufficient"), { code: "balance_insufficient" });
    this.bal.EUR.availableCents -= t.amountCents + fee;
    this.bal.EUR.reservedCents += t.amountCents + fee;
    const tr = { id: `tr_${++this.n}`, requestId: t.requestId, status: "PROCESSING", amountCents: t.amountCents, currency: "EUR" as const, metadata: t.approvalSha256, fee: { cents: fee, currency: "EUR" } };
    this.transfers.push(tr);
    if (this.loseNextTransferAnswer) { this.loseNextTransferAnswer = false; throw new AirwallexAmbiguous("/transfers/create", new Error("socket hang up")); }
    return { ...tr };
  }
  async findTransferByRequestId(requestId: string) { const t = this.transfers.find((x) => x.requestId === requestId); return t && { ...t }; }
  async getTransfer(id: string) { return { ...this.transfers.find((x) => x.id === id)! }; }
  async transitionTransfer(id: string, to: "SENT" | "PAID" | "FAILED", failureType?: string): Promise<Transfer> {
    this.calls.push(`transition:${to}`);
    const t = this.transfers.find((x) => x.id === id)!;
    t.status = to;
    if (to === "PAID") this.bal.EUR.reservedCents -= t.amountCents + SANDBOX_SWIFT_FEE_CENTS;
    if (to === "FAILED") { t.failureType = failureType ?? "BENEFICIARY_BANK_RETURNED"; t.status = "CANCELLED"; }
    return { ...t };
  }
}
