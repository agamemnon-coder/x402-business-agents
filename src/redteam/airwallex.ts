// In-memory stand-in for the Airwallex sandbox, for tests, the red team and the evals. It never reaches a live run.

import { AirwallexAmbiguous } from "../airwallex/client.js";
import type { AirwallexRail, Balance, Beneficiary, Conversion, Currency, Deposit, NewBeneficiary, NewTransfer, Quote, SandboxSim, Transfer, MarketRate } from "../airwallex/port.js";

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

export class FakeAirwallex implements AirwallexRail, SandboxSim {
  bal: Record<Currency, Balance> = { USD: { availableCents: 0, pendingCents: 0, reservedCents: 0 }, EUR: { availableCents: 3_500_000, pendingCents: 0, reservedCents: 0 } };
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
  /** Airwallex's web-app approval workflow for API transfers: each new transfer waits as IN_APPROVAL. */
  approvalWorkflow = false;
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
    const tr = { id: `tr_${++this.n}`, requestId: t.requestId, status: this.approvalWorkflow ? "IN_APPROVAL" : "PROCESSING", amountCents: t.amountCents, currency: "EUR" as const, metadata: t.approvalSha256, reference: t.reference, fee: { cents: fee, currency: "EUR" }, beneficiaryId: t.beneficiaryId };
    this.transfers.push(tr);
    if (this.loseNextTransferAnswer) { this.loseNextTransferAnswer = false; throw new AirwallexAmbiguous("/transfers/create", new Error("socket hang up")); }
    return { ...tr };
  }
  async findTransferByRequestId(requestId: string) { const t = this.transfers.find((x) => x.requestId === requestId); return t && { ...t }; }
  async findTransferByRequestIdStrict(requestId: string) { return this.findTransferByRequestId(requestId); }
  async getTransfer(id: string) { return { ...this.transfers.find((x) => x.id === id)! }; }
  async transitionTransfer(id: string, to: "SENT" | "PAID" | "FAILED", failureType?: string): Promise<Transfer> {
    this.calls.push(`transition:${to}`);
    const t = this.transfers.find((x) => x.id === id)!;
    // As at Airwallex: a transfer in its approval workflow cannot be moved on by the simulation API.
    if (t.status.startsWith("APPROVAL_") || t.status === "IN_APPROVAL") throw Object.assign(new Error(`transfer ${id} is ${t.status}`), { code: "invalid_status" });
    t.status = to;
    if (to === "PAID") this.bal.EUR.reservedCents -= t.amountCents + SANDBOX_SWIFT_FEE_CENTS;
    if (to === "FAILED") { t.failureType = failureType ?? "BENEFICIARY_BANK_RETURNED"; t.status = "CANCELLED"; }
    return { ...t };
  }
  /** A person in the Airwallex web app approves (SCHEDULED) or rejects (APPROVAL_REJECTED) a waiting transfer. */
  decideInWebApp(id: string, decision: "approve" | "reject"): void {
    const t = this.transfers.find((x) => x.id === id)!;
    if (t.status !== "IN_APPROVAL") throw new Error(`transfer ${id} is ${t.status}, not IN_APPROVAL`);
    t.status = decision === "approve" ? "SCHEDULED" : "APPROVAL_REJECTED";
  }
}
