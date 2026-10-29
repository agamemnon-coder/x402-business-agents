// What the treasury needs from Airwallex, in our own terms (integer cents, our names).
// The real adapter maps these onto the sandbox REST API; tests use an in-memory fake. Nothing in the
// demo itself is faked: without keys, the Airwallex steps stop and say so.
// Simulation calls live behind their own interface, as the builder guide asks.

export type Currency = "USD" | "EUR";

export interface Balance {
  availableCents: number;
  /** Never counted toward spendable money: unsettled conversions. */
  pendingCents: number;
  /** Never counted either: outbound payouts not yet settled. */
  reservedCents: number;
}

export interface Deposit {
  id: string;
  amountCents: number;
  currency: string;
  reference: string | null;
  status: string;
}

export interface Quote {
  quoteId: string;
  buyCurrency: Currency;
  sellCurrency: Currency;
  buyAmountCents: number;
  sellAmountCents: number;
  /** The rate as Airwallex states it, kept as a string. */
  clientRate: string;
  validFrom: string;
  validTo: string;
}

export interface Conversion {
  conversionId: string;
  requestId: string;
  quoteId: string;
  status: string;
  buyAmountCents: number;
  sellAmountCents: number;
}

export interface Beneficiary {
  id: string;
  name: string;
  iban: string;
  bic: string;
  currency: Currency;
}

export type TransferStatus = "SCHEDULED" | "OVERDUE" | "PROCESSING" | "SENT" | "PAID" | "FAILED" | "CANCELLED";

export interface Transfer {
  id: string;
  requestId: string;
  status: TransferStatus | string;
  amountCents: number;
  currency: Currency;
  failureType?: string | null;
  failureReason?: string | null;
  /** What Airwallex charged, once it says; null before. */
  fee?: { cents: number; currency: string } | null;
}

export interface NewBeneficiary {
  name: string;
  iban: string;
  bic: string;
  currency: "EUR";
  countryCode: "DE";
  /** Airwallex's beneficiary schema for DE, EUR, SWIFT requires the bank's name. */
  bankName: string;
  address: { street: string; city: string; postcode: string; countryCode: "DE" };
}

/** The market's current rate for a conversion: what Airwallex would charge now, before any quote is locked. */
export interface MarketRate {
  /** The client rate as Airwallex states it. */
  rate: string;
  /** What the buy amount would cost now, in cents of the sell currency. */
  sellAmountCents: number;
  at: string;
}

export interface NewTransfer {
  requestId: string;
  beneficiaryId: string;
  amountCents: number;
  currency: "EUR";
  sourceCurrency: "EUR";
  reference: string;
  reason: string;
  approvalSha256: string;
}

export interface AirwallexRail {
  balances(): Promise<Partial<Record<Currency, Balance>>>;
  usdGlobalAccountId(): Promise<string>;
  /** Deposits whose reference equals `reference`, created at or after `since`. */
  findDepositsByReference(reference: string, since: string): Promise<Deposit[]>;
  /** The current rate (GET /fx/rates/current): context for the decision, not a price anyone can trade at. */
  currentRate(a: { buyCurrency: Currency; sellCurrency: Currency; buyAmountCents: number }): Promise<MarketRate>;
  createQuote(a: { buyCurrency: Currency; sellCurrency: Currency; buyAmountCents: number; validity: "MIN_1" | "MIN_15" | "MIN_30" | "HR_1" }): Promise<Quote>;
  createConversion(a: { requestId: string; quote: Quote; approvalSha256: string }): Promise<Conversion>;
  findBeneficiaryByIban(iban: string): Promise<Beneficiary | undefined>;
  createBeneficiary(b: NewBeneficiary): Promise<Beneficiary>;
  createTransfer(t: NewTransfer): Promise<Transfer>;
  findTransferByRequestId(requestId: string): Promise<Transfer | undefined>;
  getTransfer(id: string): Promise<Transfer>;
}

/** Sandbox-only simulations. Kept apart so no production path can reach them. */
export interface SandboxSim {
  simulateDeposit(a: { globalAccountId: string; amountCents: number; reference: string; payerName: string }): Promise<Deposit>;
  transitionTransfer(id: string, to: "SENT" | "PAID" | "FAILED", failureType?: string): Promise<Transfer>;
}
