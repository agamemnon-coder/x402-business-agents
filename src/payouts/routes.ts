// Where and how a supplier can be paid, from Airwallex's payout network guides (read 8 November 2026), and the checks
// code makes on bank details before anything is sent. Airwallex's own /beneficiaries/schema and /beneficiaries/validate
// still run when a beneficiary is created (src/airwallex/adapter.ts): this table is the first check, not the only one.
// Pure: no database, no Node modules.
//
// Guides, one per country (bank_details fields and their permitted data, per transfer method):
//   US https://www.airwallex.com/docs/payouts/payout-network/bank-accounts/united-states.md
//   GB https://www.airwallex.com/docs/payouts/payout-network/bank-accounts/united-kingdom.md
//   CN https://www.airwallex.com/docs/payouts/payout-network/bank-accounts/china.md
//   TR https://www.airwallex.com/docs/payouts/payout-network/bank-accounts/turkey.md
//   NL https://www.airwallex.com/docs/payouts/payout-network/bank-accounts/netherlands.md
//   DE https://www.airwallex.com/docs/payouts/payout-network/bank-accounts/germany.md
// Precision (two decimals; JPY has none): https://www.airwallex.com/docs/payouts/how-airwallex-payouts-work/currency-precision.md

import { ibanValid } from "../ap/reading.js";

export type Method = "LOCAL" | "SWIFT";
export type RoutingType = "aba" | "sort_code" | "cnaps";

/** A supplier's bank details as the invoice or a person gives them. Empty strings count as absent. */
export type BankDetails = {
  /** ISO 3166 alpha-2 code of the bank's country. */
  country: string;
  /** ISO 4217 code the supplier receives. */
  currency: string;
  accountName: string;
  iban?: string;
  accountNumber?: string;
  routingType?: RoutingType | "";
  routingValue?: string;
  swiftCode?: string;
};

type Field = "iban" | "account_number" | "routing" | "swift_code";

export interface Route {
  country: string;
  currency: string;
  method: Method;
  /** The local clearing system Airwallex names (local_clearing_system), where the guide gives one. */
  clearing?: string;
  /** What the route needs; `alt` is another complete set the guide accepts instead (a UK IBAN for a GBP local payout). */
  needs: Field[];
  alt?: Field[];
  routingType?: RoutingType;
  /** The account number's shape on this route. */
  account?: RegExp;
  /** Characters the account name may use, where the guide narrows it (2-200 characters everywhere). */
  doc: string;
}

/** The 22 currencies every guide lists for SWIFT payouts. */
export const SWIFT_CURRENCIES = ["AUD", "CAD", "CHF", "CNY", "CZK", "DKK", "EUR", "GBP", "HKD", "HUF", "ILS", "JPY", "NOK", "NZD", "PLN", "RON", "SEK", "SGD", "THB", "TRY", "USD", "ZAR"] as const;

/** Decimal places, from the currency precision page; every SWIFT currency has two except JPY. */
const ZERO_DECIMALS = new Set(["JPY"]);

/** IBAN length by country, from each guide ("22 alphanumeric characters" for DE and GB, 18 for NL, 26 for TR). */
const IBAN_LENGTH: Record<string, number> = { DE: 22, GB: 22, NL: 18, TR: 26 };

const guide = (c: string) => `https://www.airwallex.com/docs/payouts/payout-network/bank-accounts/${c}.md`;

interface Country {
  doc: string;
  local: Omit<Route, "country" | "method" | "doc">[];
  swift: Omit<Route, "country" | "method" | "doc" | "currency">;
}

const COUNTRIES: Record<string, Country> = {
  US: {
    doc: guide("united-states"),
    // "Local ACH/Next Day ACH payout": account_number up to 17 digits, account_routing_type1 aba, 9 digits.
    local: [{ currency: "USD", clearing: "ACH", needs: ["account_number", "routing"], routingType: "aba", account: /^\d{1,17}$/ }],
    // "SWIFT payout": account_number up to 26 alphanumeric characters, swift_code.
    swift: { needs: ["account_number", "swift_code"], account: /^[A-Z0-9]{1,26}$/ },
  },
  GB: {
    doc: guide("united-kingdom"),
    // "Local GBP payout": account_number 8 digits, sort_code 6 digits; or a GB IBAN when those are not given.
    local: [
      { currency: "GBP", clearing: "FASTER_PAYMENTS", needs: ["account_number", "routing"], alt: ["iban"], routingType: "sort_code", account: /^\d{8}$/ },
      // "Local EUR payout": a GB IBAN.
      { currency: "EUR", needs: ["iban"] },
    ],
    swift: { needs: ["iban"] },
  },
  CN: {
    doc: guide("china"),
    // No local route: LOCAL CNY needs declarant and order information and an account name in Chinese characters
    // (china.md; transfers-to-from-countries-with-regulatory-requirements.md). SWIFT carries CNY without them.
    local: [],
    // "SWIFT payout": account_number 8-34 alphanumeric characters, swift_code.
    swift: { needs: ["account_number", "swift_code"], account: /^[A-Z0-9]{8,34}$/ },
  },
  TR: {
    doc: guide("turkey"),
    // "Local TRY payout" (FAST/EFT): a TR IBAN of 26 characters; at most 250,000 TRY per payout.
    local: [{ currency: "TRY", needs: ["iban"] }],
    swift: { needs: ["iban"] },
  },
  NL: { doc: guide("netherlands"), local: [{ currency: "EUR", needs: ["iban"] }], swift: { needs: ["iban"] } },
  DE: { doc: guide("germany"), local: [{ currency: "EUR", needs: ["iban"] }], swift: { needs: ["iban"] } },
};

/** The countries Purser can pay (those whose guide it has read). */
export const PAYOUT_COUNTRIES = Object.keys(COUNTRIES);

/** A currency Purser can pay: one SWIFT carries, with two decimals. */
export function payableCurrency(currency: string): boolean {
  return (SWIFT_CURRENCIES as readonly string[]).includes(currency) && !ZERO_DECIMALS.has(currency);
}

const has = (v: string | undefined) => !!v && v.trim() !== "";
const present = (d: BankDetails, f: Field) =>
  f === "iban" ? has(d.iban) : f === "account_number" ? has(d.accountNumber) : f === "routing" ? has(d.routingValue) : has(d.swiftCode);

/** The route to pay these details on: LOCAL where the guide offers it for the currency, else SWIFT. */
export function chooseRoute(d: BankDetails): { ok: true; route: Route } | { ok: false; reason: string } {
  const c = COUNTRIES[d.country];
  if (!c) return { ok: false, reason: `Purser has no payout guide for bank country ${d.country || "(none)"} yet; a person pays this supplier, or adds the country from Airwallex's payout network guide` };
  if (!payableCurrency(d.currency)) return { ok: false, reason: `Purser cannot pay in ${d.currency || "(no currency)"}: only two-decimal currencies that SWIFT carries (${SWIFT_CURRENCIES.filter(payableCurrency).join(", ")})` };
  for (const l of c.local) {
    if (l.currency !== d.currency) continue;
    if (l.needs.every((f) => present(d, f)) || (l.alt ?? []).every((f) => present(d, f)) && l.alt) return { ok: true, route: { ...l, country: d.country, method: "LOCAL", doc: c.doc } };
  }
  return { ok: true, route: { ...c.swift, country: d.country, currency: d.currency, method: "SWIFT", doc: c.doc } };
}

/** ABA routing number checksum (weights 3, 7, 1). */
export function abaValid(v: string): boolean {
  if (!/^\d{9}$/.test(v)) return false;
  const n = [...v].map(Number);
  const sum = 3 * (n[0]! + n[3]! + n[6]!) + 7 * (n[1]! + n[4]! + n[7]!) + (n[2]! + n[5]! + n[8]!);
  return sum % 10 === 0;
}

const BIC = /^[A-Z]{4}([A-Z]{2})[A-Z0-9]{2}([A-Z0-9]{3})?$/;

/** What is wrong with these details for this route, in plain words; empty when nothing is. */
export function validateDetails(d: BankDetails, r: Route): string[] {
  const out: string[] = [];
  const name = d.accountName.trim();
  if (name.length < 2 || name.length > 200) out.push("the account holder's name must be 2 to 200 characters");
  if (d.country !== r.country) out.push(`the bank country ${d.country} is not the route's ${r.country}`);
  const useAlt = r.alt && !r.needs.every((f) => present(d, f)) && r.alt.every((f) => present(d, f));
  const needs = useAlt ? r.alt! : r.needs;
  for (const f of needs) if (!present(d, f)) out.push(`${r.method} ${r.currency} to ${r.country} needs ${f.replace("_", " ")}`);
  if (needs.includes("iban") && has(d.iban)) {
    const iban = d.iban!.replace(/\s+/g, "").toUpperCase();
    if (!iban.startsWith(r.country)) out.push(`the IBAN must start with ${r.country}, not ${iban.slice(0, 2)}`);
    else if (IBAN_LENGTH[r.country] && iban.length !== IBAN_LENGTH[r.country]) out.push(`a ${r.country} IBAN has ${IBAN_LENGTH[r.country]} characters, not ${iban.length}`);
    else if (!ibanValid(iban)) out.push(`the IBAN ending ${iban.slice(-4)} fails its checksum`);
  }
  if (needs.includes("account_number") && has(d.accountNumber) && r.account && !r.account.test(d.accountNumber!.replace(/[\s-]/g, "").toUpperCase())) {
    out.push(`the account number does not have the shape ${r.method} ${r.currency} to ${r.country} needs`);
  }
  if (needs.includes("routing") && has(d.routingValue)) {
    const v = d.routingValue!.replace(/[\s-]/g, "");
    if (d.routingType && r.routingType && d.routingType !== r.routingType) out.push(`${r.country} uses ${r.routingType.replace("_", " ")}, not ${d.routingType.replace("_", " ")}`);
    if (r.routingType === "aba" && !abaValid(v)) out.push(`the ABA routing number ${v} fails its checksum`);
    if (r.routingType === "sort_code" && !/^\d{6}$/.test(v)) out.push(`a UK sort code has 6 digits, not ${JSON.stringify(d.routingValue)}`);
  }
  if (needs.includes("swift_code") && has(d.swiftCode)) {
    const m = BIC.exec(d.swiftCode!.trim().toUpperCase());
    if (!m) out.push(`not a BIC: ${d.swiftCode}`);
    else if (m[1] !== r.country) out.push(`the BIC ${d.swiftCode} is a bank in ${m[1]}, not ${r.country}`);
  }
  return out;
}

const digits = (s: string | undefined) => (s ?? "").replace(/[\s-]/g, "").toUpperCase();

/** One identity per account, for duplicate and fraud checks: the IBAN where there is one, else country, routing and number. */
export function accountKey(d: BankDetails): string {
  if (has(d.iban)) return digits(d.iban);
  if (has(d.routingValue)) return `${d.country}:${d.routingType || "routing"}:${digits(d.routingValue)}:${digits(d.accountNumber)}`;
  return `${d.country}:swift:${digits(d.swiftCode).slice(0, 8)}:${digits(d.accountNumber)}`;
}

/** The account as the CFO sees it in the terms: enough to recognise it, not enough to reuse it. */
export function maskAccount(d: BankDetails): string {
  if (has(d.iban)) { const i = digits(d.iban); return `IBAN ${i.slice(0, 4)}…${i.slice(-4)}`; }
  const acct = `account …${digits(d.accountNumber).slice(-4)}`;
  if (d.routingType === "aba") return `${acct}, ABA ${digits(d.routingValue)} (${d.country})`;
  if (d.routingType === "sort_code") { const s = digits(d.routingValue); return `${acct}, sort code ${s.slice(0, 2)}-${s.slice(2, 4)}-${s.slice(4)} (${d.country})`; }
  return `${acct}, BIC ${digits(d.swiftCode)} (${d.country})`;
}
