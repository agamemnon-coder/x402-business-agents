// In-memory stand-in for the Airwallex sandbox, for tests, the red team and the evals. It never reaches a live run.

import { AirwallexAmbiguous } from "../airwallex/client.js";
import type { AirwallexRail, AnyQuote, Balance, Beneficiary, Conversion, Currency, Deposit, NewBeneficiary, NewPayoutBeneficiary, NewPayoutTransfer, NewTransfer, PayoutRail, PlatformFee, Quote, SandboxSim, Transfer, MarketRate } from "../airwallex/port.js";

/**
 * The stand-in's SWIFT fee for a EUR payout: the one constant every simulated rail charges (FakeAirwallex here, the
 * sim worlds' ledger in src/evals/simRails.ts, the month in src/sim/month.ts). It matches what the live sandbox charged
 * this week, not the EUR 13.47 of 2026-10-29 (docs/runs/2026-10-29-s3.md), which the stand-in used until 2 November:
 *   - 2026-11-02 night-batch calibration, 14 dry runs: EUR 13.39 and 13.40 (branch night-batch,
 *     docs/runs/variation/2026-11-02/live-logs/dry-142.txt to dry-155.txt; docs/runs/2026-11-02-night-batch.md)
 *   - 2026-11-02 dry-141: EUR 13.36; agent run 1, P-0007: EUR 13.37 (night-batch, docs/runs/2026-11-02-agent-run-1.md)
 *   - 2026-10-30 endcheck, P-0005: EUR 13.40 (night-batch, docs/runs/2026-10-30-endcheck.md)
 * The fee reserve (feeReserveCents, src/policy/treasury.ts: the highest measured fee + 25%, at least EUR 20.00, at most
 * EUR 60.00) reads measured fees from the ledger; its rule is not changed by this value (13.40 + 25% is under 20.00).
 */
export const SANDBOX_SWIFT_FEE_CENTS = 1340;

export class FakeAirwallex implements AirwallexRail, SandboxSim, PayoutRail {
  bal: Record<Currency, Balance> & Record<string, Balance> = { USD: { availableCents: 0, pendingCents: 0, reservedCents: 0 }, EUR: { availableCents: 3_500_000, pendingCents: 0, reservedCents: 0 } };
  deposits: (Deposit & { createdAt: string })[] = [];
  quotes = new Map<string, Quote>();
  conversions: Conversion[] = [];
  beneficiaries: Beneficiary[] = [];
  transfers: (Transfer & { metadata: string; reference?: string })[] = [];
  /** The approval hash each conversion carried in its metadata, by conversion id (as Airwallex keeps it). */
  conversionMetadata = new Map<string, string>();
  calls: string[] = [];
  /** Lose the answer to the next transfer create (the transfer is still made). */
  loseNextTransferAnswer = false;
  /** The next transfer create is lost on its way: Airwallex never gets it, and the answer is lost too. */
  dropNextTransfer = false;
  /** The next N look-ups of a transfer by request_id find nothing yet (a list that lags behind a create). */
  transferLookupMisses = 0;
  /** The next transfer create is refused outright with this documented code (nothing is made). */
  refuseNextTransfer: string | null = null;
  /** Purser as a platform: the connected account this stand-in acts for, and the Purser fees taken from it. */
  payingAccount: string | null = null;
  /**
   * Airwallex's own transfer approval workflow (web app: "Require API-initiated transfers to go through the same approval
   * workflow?" Yes): a new transfer waits IN_APPROVAL until an approver in Airwallex's web app approves it (approveInWebApp).
   */
  approvalWorkflow = false;
  /** Purser's fees Airwallex took with paid payouts (application_fee_options), in the order the payouts were paid. */
  platformFees: PlatformFee[] = [];
  /** Airwallex answers transfers without the application fee asked for (it was not taken). */
  dropApplicationFee = false;
  clock = () => Date.now();
  rate = "1.0850";
  n = 0;

  async balances() { this.calls.push("balances"); return structuredClone({ USD: this.bal.USD, EUR: this.bal.EUR }); }
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
    // Airwallex keys a conversion by its request_id: the same one twice is refused, never converted twice.
    if (this.conversions.some((c) => c.requestId === a.requestId)) throw Object.assign(new Error("duplicate request_id"), { code: "duplicate_request" });
    const q = this.quotes.get(a.quote.quoteId)!;
    if (Date.parse(q.validTo) <= this.clock()) throw Object.assign(new Error("expired"), { code: "expired_quote" });
    this.bal.USD.availableCents -= q.sellAmountCents;
    this.bal.EUR.availableCents += q.buyAmountCents;
    const c = { conversionId: `conv_${++this.n}`, requestId: a.requestId, quoteId: q.quoteId, status: "SETTLED", buyAmountCents: q.buyAmountCents, sellAmountCents: q.sellAmountCents };
    this.conversions.push(c);
    this.conversionMetadata.set(c.conversionId, a.approvalSha256);
    return c;
  }
  async findConversionByRequestId(requestId: string) { const c = this.conversions.find((x) => x.requestId === requestId); return c && { ...c }; }
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
    const tr = { id: `tr_${++this.n}`, requestId: t.requestId, status: this.approvalWorkflow ? "IN_APPROVAL" : "PROCESSING", amountCents: t.amountCents, currency: "EUR" as const, metadata: t.approvalSha256, reference: t.reference, fee: { cents: fee, currency: "EUR" }, beneficiaryId: t.beneficiaryId, ...this.appFee(t) };
    this.transfers.push(tr);
    if (this.loseNextTransferAnswer) { this.loseNextTransferAnswer = false; throw new AirwallexAmbiguous("/transfers/create", new Error("socket hang up")); }
    return { ...tr };
  }
  async findTransferByRequestId(requestId: string) {
    if (this.transferLookupMisses > 0) { this.transferLookupMisses--; return undefined; }
    const t = this.transfers.find((x) => x.requestId === requestId);
    return t && { ...t };
  }
  async findTransferByRequestIdStrict(requestId: string) { return this.findTransferByRequestId(requestId); }
  async getTransfer(id: string) { return { ...this.transfers.find((x) => x.id === id)! }; }
  /** The application fee Airwallex takes with a payout, and reports back (unless told to drop it). */
  private appFee(t: { requestId: string; applicationFee?: { amountCents: number; currency: string } }): { applicationFee: { cents: number; currency: string } | null; feeRequest?: string } {
    if (!t.applicationFee || this.dropApplicationFee) return { applicationFee: null };
    const b = this.balOf(t.applicationFee.currency);
    if (b.availableCents < t.applicationFee.amountCents) throw Object.assign(new Error("balance_insufficient"), { code: "balance_insufficient" });
    b.availableCents -= t.applicationFee.amountCents;
    return { applicationFee: { cents: t.applicationFee.amountCents, currency: t.applicationFee.currency }, feeRequest: t.requestId };
  }
  /** An approver in Airwallex's web app approves (SCHEDULED) or rejects (CANCELLED) a transfer waiting IN_APPROVAL. */
  approveInWebApp(id: string, ok = true): void {
    const t = this.transfers.find((x) => x.id === id)!;
    if (t.status !== "IN_APPROVAL") throw new Error(`transfer ${id} is ${t.status}, not IN_APPROVAL`);
    t.status = ok ? "SCHEDULED" : "CANCELLED";
  }
  async transitionTransfer(id: string, to: "SENT" | "PAID" | "FAILED", failureType?: string): Promise<Transfer> {
    this.calls.push(`transition:${to}`);
    const t = this.transfers.find((x) => x.id === id)!;
    if (t.status === "IN_APPROVAL") throw Object.assign(new Error("the transfer is waiting for approval in Airwallex"), { code: "invalid_status" });
    t.status = to;
    if (to === "PAID") this.balOf(t.currency).reservedCents -= t.amountCents + (t.fee?.cents ?? SANDBOX_SWIFT_FEE_CENTS);
    if (to === "PAID" && t.applicationFee && !this.platformFees.some((f) => f.requestId === t.requestId)) {
      this.platformFees.push({ requestId: t.requestId, amountCents: t.applicationFee.cents, currency: t.applicationFee.currency, destination: "acct_purser_platform", reference: t.reference ?? "" });
    }
    if (to === "FAILED" && t.applicationFee) this.balOf(t.applicationFee.currency).availableCents += t.applicationFee.cents;
    if (to === "FAILED") { t.failureType = failureType ?? "BENEFICIARY_BANK_RETURNED"; t.status = "CANCELLED"; }
    return { ...t };
  }

  // ---- Payables in any currency (PayoutRail). Rates are sell units per buy unit, by "BUY/SELL"; a test may change them.
  ratesAny: Record<string, string> = { "USD/EUR": "0.9220", "GBP/EUR": "1.1700", "CNY/EUR": "0.1300", "TRY/EUR": "0.0265", "EUR/USD": "1.0850", "USD/GBP": "0.7880" };
  /** The market's rate by pair, when a test wants the locked quote to differ from it. */
  marketRatesAny: Record<string, string> = {};
  payoutBeneficiaries: (NewPayoutBeneficiary & { id: string })[] = [];
  /** The next beneficiary create is refused as Airwallex's validate would refuse it. */
  refuseNextBeneficiary: string | null = null;
  /** Lose the answer to the next beneficiary create (the beneficiary is still made). */
  loseNextBeneficiaryAnswer = false;
  /** The stand-in's fee per method and currency, charged to the payer in the transfer's currency (no real fee data). */
  payoutFeeCents: Record<string, number> = { "SWIFT:EUR": SANDBOX_SWIFT_FEE_CENTS, "SWIFT:USD": 1500, "SWIFT:GBP": 1200, "SWIFT:CNY": 10_000, "SWIFT:TRY": 45_000 };

  balOf(currency: string): Balance { return (this.bal[currency] ??= { availableCents: 0, pendingCents: 0, reservedCents: 0 }); }
  async balancesAll() { this.calls.push("balancesAll"); return structuredClone(this.bal) as Record<string, Balance>; }
  private rateOf(buy: string, sell: string): string {
    const r = this.ratesAny[`${buy}/${sell}`];
    if (!r) throw Object.assign(new Error(`currency_pair_invalid: ${buy}/${sell}`), { code: "currency_pair_invalid" });
    return r;
  }
  async currentRateAny(a: { buyCurrency: string; sellCurrency: string; buyAmountCents: number }): Promise<MarketRate> {
    this.calls.push("currentRateAny");
    const rate = this.marketRatesAny[`${a.buyCurrency}/${a.sellCurrency}`] ?? this.rateOf(a.buyCurrency, a.sellCurrency);
    return { rate, sellAmountCents: Math.ceil(a.buyAmountCents * Number(rate)), at: new Date(this.clock()).toISOString() };
  }
  async createQuoteAny(a: { buyCurrency: string; sellCurrency: string; buyAmountCents: number; validity: string }): Promise<AnyQuote> {
    this.calls.push("createQuoteAny");
    const ms = { MIN_1: 60_000, MIN_15: 900_000, MIN_30: 1_800_000, HR_1: 3_600_000 }[a.validity]!;
    const rate = this.rateOf(a.buyCurrency, a.sellCurrency);
    const q: AnyQuote = {
      quoteId: `q_${++this.n}`, buyCurrency: a.buyCurrency, sellCurrency: a.sellCurrency, buyAmountCents: a.buyAmountCents,
      sellAmountCents: Math.ceil(a.buyAmountCents * Number(rate)), clientRate: rate,
      validFrom: new Date(this.clock()).toISOString(), validTo: new Date(this.clock() + ms).toISOString(),
    };
    this.quotes.set(q.quoteId, q as unknown as Quote);
    return q;
  }
  async createConversionAny(a: { requestId: string; quote: AnyQuote; approvalSha256: string }): Promise<Conversion> {
    this.calls.push("createConversionAny");
    if (this.conversions.some((c) => c.requestId === a.requestId)) throw Object.assign(new Error("duplicate request_id"), { code: "duplicate_request" });
    const q = this.quotes.get(a.quote.quoteId) as unknown as AnyQuote | undefined;
    if (!q) throw Object.assign(new Error("unknown quote"), { code: "invalid_quote" });
    if (Date.parse(q.validTo) <= this.clock()) throw Object.assign(new Error("expired"), { code: "expired_quote" });
    if (this.balOf(q.sellCurrency).availableCents < q.sellAmountCents) throw Object.assign(new Error("balance_insufficient"), { code: "balance_insufficient" });
    this.balOf(q.sellCurrency).availableCents -= q.sellAmountCents;
    this.balOf(q.buyCurrency).availableCents += q.buyAmountCents;
    const c = { conversionId: `conv_${++this.n}`, requestId: a.requestId, quoteId: q.quoteId, status: "SETTLED", buyAmountCents: q.buyAmountCents, sellAmountCents: q.sellAmountCents };
    this.conversions.push(c);
    this.conversionMetadata.set(c.conversionId, a.approvalSha256);
    return c;
  }
  async createPayoutBeneficiary(b: NewPayoutBeneficiary): Promise<{ id: string }> {
    this.calls.push("createPayoutBeneficiary");
    if (this.refuseNextBeneficiary) { const code = this.refuseNextBeneficiary; this.refuseNextBeneficiary = null; throw Object.assign(new Error(`validation_failed: ${code}`), { code: "validation_failed" }); }
    const ben = { ...structuredClone(b), id: `ben_${++this.n}` };
    this.payoutBeneficiaries.push(ben);
    if (this.loseNextBeneficiaryAnswer) { this.loseNextBeneficiaryAnswer = false; throw new AirwallexAmbiguous("/beneficiaries/create", new Error("socket hang up")); }
    return { id: ben.id };
  }
  /** A beneficiary already at Airwallex with this name, method and these exact bank details (GET /beneficiaries). */
  async findPayoutBeneficiary(b: NewPayoutBeneficiary): Promise<{ id: string } | undefined> {
    this.calls.push("findPayoutBeneficiary");
    const same = (x: NewPayoutBeneficiary) => x.name === b.name && x.method === b.method && (x.clearing ?? "") === (b.clearing ?? "")
      && (["country", "currency", "iban", "accountNumber", "routingType", "routingValue", "swiftCode"] as const).every((k) => (x.bank[k] ?? "") === (b.bank[k] ?? ""));
    const hit = this.payoutBeneficiaries.find(same);
    return hit && { id: hit.id };
  }
  async createPayoutTransfer(t: NewPayoutTransfer): Promise<Transfer> {
    this.calls.push("createPayoutTransfer");
    if (this.dropNextTransfer) { this.dropNextTransfer = false; throw new AirwallexAmbiguous("/transfers/create", new Error("socket hang up")); }
    if (this.refuseNextTransfer) { const code = this.refuseNextTransfer; this.refuseNextTransfer = null; throw Object.assign(new Error(code), { code }); }
    if (this.transfers.some((x) => x.requestId === t.requestId)) throw Object.assign(new Error("duplicate request_id"), { code: "duplicate_request" });
    if (t.sourceCurrency !== t.currency) throw Object.assign(new Error("the stand-in pays from the same currency only"), { code: "source_currency_unsupported" });
    const ben = this.payoutBeneficiaries.find((b) => b.id === t.beneficiaryId);
    if (!ben) throw Object.assign(new Error("beneficiary_not_found"), { code: "beneficiary_not_found" });
    if (ben.bank.currency !== t.currency) throw Object.assign(new Error("transfer_currency must match account_currency"), { code: "transfer_currency_unsupported" });
    const fee = this.payoutFeeCents[`${t.method}:${t.currency}`] ?? 0;
    const b = this.balOf(t.sourceCurrency);
    if (b.availableCents < t.amountCents + fee) throw Object.assign(new Error("balance_insufficient"), { code: "balance_insufficient" });
    b.availableCents -= t.amountCents + fee;
    b.reservedCents += t.amountCents + fee;
    const tr = { id: `tr_${++this.n}`, requestId: t.requestId, status: this.approvalWorkflow ? "IN_APPROVAL" : "PROCESSING", amountCents: t.amountCents, currency: t.currency as Currency, metadata: t.approvalSha256, reference: t.reference, fee: { cents: fee, currency: t.currency }, beneficiaryId: t.beneficiaryId, ...this.appFee(t) };
    this.transfers.push(tr);
    if (this.loseNextTransferAnswer) { this.loseNextTransferAnswer = false; throw new AirwallexAmbiguous("/transfers/create", new Error("socket hang up")); }
    return { ...tr };
  }
}
