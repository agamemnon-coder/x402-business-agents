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
  /** The payee, as Airwallex holds it (checked before a transfer found by request_id is adopted). */
  beneficiaryId?: string | null;
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
  /** The conversion made under this request_id, if any: after a crash, it is adopted instead of converting again. */
  findConversionByRequestId(requestId: string): Promise<Conversion | undefined>;
  findBeneficiaryByIban(iban: string): Promise<Beneficiary | undefined>;
  createBeneficiary(b: NewBeneficiary): Promise<Beneficiary>;
  createTransfer(t: NewTransfer): Promise<Transfer>;
  findTransferByRequestId(requestId: string): Promise<Transfer | undefined>;
  /**
   * The same look-up, strict: answers "nothing" only for an empty, filtered list. A list that holds another request_id,
   * says it has more pages, or holds two transfers is an error. Used where "nothing" lets a payout be closed or an
   * invoice be planned again.
   */
  findTransferByRequestIdStrict(requestId: string): Promise<Transfer | undefined>;
  getTransfer(id: string): Promise<Transfer>;
}

// Payables in any currency, to suppliers in any country Purser has a payout guide for (src/payouts/routes.ts). Kept
// apart from AirwallexRail, whose EUR and USD types the Kit 11 flows and their recorded figures rely on.

/** A locked quote between any two currencies. */
export interface AnyQuote {
  quoteId: string;
  buyCurrency: string;
  sellCurrency: string;
  buyAmountCents: number;
  sellAmountCents: number;
  clientRate: string;
  validFrom: string;
  validTo: string;
}

/** A supplier's account for Airwallex's beneficiary create (beneficiary.bank_details, transfer_methods). */
export interface NewPayoutBeneficiary {
  name: string;
  address: { street: string; city: string; postcode: string; countryCode: string };
  method: "LOCAL" | "SWIFT";
  /** local_clearing_system, where the route names one. */
  clearing?: string;
  bank: {
    country: string;
    currency: string;
    accountName: string;
    iban?: string;
    accountNumber?: string;
    routingType?: string;
    routingValue?: string;
    swiftCode?: string;
  };
}

export interface NewPayoutTransfer {
  requestId: string;
  beneficiaryId: string;
  amountCents: number;
  /** transfer_currency: what the supplier receives. */
  currency: string;
  /** source_currency: what pays for it (the same currency: any conversion was made before, on its own approved quote). */
  sourceCurrency: string;
  method: "LOCAL" | "SWIFT";
  reference: string;
  reason: string;
  approvalSha256: string;
}

export interface PayoutRail {
  /** Every currency the account holds (GET /balances/current). */
  balancesAll(): Promise<Record<string, Balance>>;
  currentRateAny(a: { buyCurrency: string; sellCurrency: string; buyAmountCents: number }): Promise<MarketRate>;
  createQuoteAny(a: { buyCurrency: string; sellCurrency: string; buyAmountCents: number; validity: "MIN_1" | "MIN_15" | "MIN_30" | "HR_1" }): Promise<AnyQuote>;
  createConversionAny(a: { requestId: string; quote: AnyQuote; approvalSha256: string }): Promise<Conversion>;
  findConversionByRequestId(requestId: string): Promise<Conversion | undefined>;
  createPayoutBeneficiary(b: NewPayoutBeneficiary): Promise<{ id: string }>;
  /** A beneficiary Airwallex already holds with this name, method and exactly these bank details (GET /beneficiaries). */
  findPayoutBeneficiary(b: NewPayoutBeneficiary): Promise<{ id: string } | undefined>;
  createPayoutTransfer(t: NewPayoutTransfer): Promise<Transfer>;
  findTransferByRequestIdStrict(requestId: string): Promise<Transfer | undefined>;
  getTransfer(id: string): Promise<Transfer>;
  /**
   * Purser as a platform (docs/airwallex-platform.md): the connected account every call is made for, or null/undefined
   * for the company's own account. The executor refuses terms that name another paying account.
   */
  readonly payingAccount?: string | null;
  /**
   * The Purser fee for a paid payout, from this (connected) account to Purser's platform account
   * (POST /connected_account_transfers/create with x-on-behalf-of: the mechanism is UNCONFIRMED by Airwallex, so it only
   * runs with AIRWALLEX_PLATFORM_FEE=on). Safe to ask again under the same request id.
   */
  collectPlatformFee?(f: PlatformFee): Promise<{ id: string; status: string }>;
}

export interface PlatformFee { requestId: string; amountCents: number; currency: string; destination: string; reference: string }

/** Sandbox-only simulations. Kept apart so no production path can reach them. */
export interface SandboxSim {
  simulateDeposit(a: { globalAccountId: string; amountCents: number; reference: string; payerName: string }): Promise<Deposit>;
  transitionTransfer(id: string, to: "SENT" | "PAID" | "FAILED", failureType?: string): Promise<Transfer>;
}
