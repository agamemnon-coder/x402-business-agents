// The Airwallex REST adapter (src/airwallex/adapter.ts) against a recording stand-in: answers with fields left out are
// read as zero, empty or the value Purser sent, never guessed; balances in other currencies are left out where the
// rail pays only EUR and USD, kept where it pays any; a beneficiary found by IBAN or by its exact bank details, with a
// name from wherever Airwallex keeps it; the "any currency" FX calls are the same calls; and the adapter exists only
// with the sandbox keys. No network.
import { describe, expect, it } from "vitest";
import { airwallexFromEnv, AirwallexRest, missingFromSchema, payoutBeneficiaryBody } from "../src/airwallex/adapter.js";
import type { Airwallex } from "../src/airwallex/client.js";
import type { NewPayoutBeneficiary } from "../src/airwallex/port.js";

/** Pages of a list, answered in turn. */
class Pages { constructor(readonly pages: unknown[]) {} }
/** Answers by "METHOD /path" (Pages are taken in turn); records every call. */
function standIn(answers: Record<string, unknown>) {
  const calls: { method: string; path: string; body?: unknown; query?: Record<string, string> }[] = [];
  const turn = new Map<string, number>();
  const call = async (method: string, path: string, body?: unknown, query?: Record<string, string>) => {
    calls.push({ method, path, body, query });
    const key = `${method} ${path}`;
    if (!(key in answers)) throw new Error(`unexpected ${key}`);
    const a = answers[key];
    if (!(a instanceof Pages)) return a;
    const n = turn.get(key) ?? 0;
    turn.set(key, n + 1);
    return a.pages[Math.min(n, a.pages.length - 1)];
  };
  return { rest: new AirwallexRest({ call, onBehalfOf: null } as unknown as Airwallex), calls };
}

const US: NewPayoutBeneficiary = {
  name: "Ridgeline Outfitters", address: { street: "1 Main St", city: "Denver", postcode: "80202", countryCode: "US" }, method: "LOCAL", clearing: "ACH",
  bank: { country: "US", currency: "USD", accountName: "Ridgeline Outfitters", accountNumber: "000123456789", routingType: "aba", routingValue: "026009593" },
};

describe("bodies", () => {
  it("a US account: an account number and its routing, no IBAN or SWIFT code", () => {
    const b = payoutBeneficiaryBody(US) as { beneficiary: { bank_details: Record<string, string> } };
    expect(b.beneficiary.bank_details).toEqual({
      account_currency: "USD", account_name: "Ridgeline Outfitters", bank_country_code: "US", account_number: "000123456789",
      account_routing_type1: "aba", account_routing_value1: "026009593", local_clearing_system: "ACH",
    });
  });

  it("a required path through a field that is not an object is missing", () => {
    const schema = { "create_beneficiary_request.beneficiary.bank_details.iban": { required: true, relevant: true, type: "string" } };
    expect(missingFromSchema(schema, { beneficiary: { bank_details: "flat" } })).toEqual(["beneficiary.bank_details.iban"]);
    expect(missingFromSchema(schema, { beneficiary: { bank_details: { iban: "DE89" } } })).toEqual([]);
  });
});

describe("answers with fields left out", () => {
  it("balances without amounts are zero; another currency is left out where only EUR and USD are paid, kept where any is", async () => {
    const rows = [{ currency: "EUR" }, { currency: "GBP", available_amount: 5 }, { currency: "USD", available_amount: 12.5, pending_amount: 1, reserved_amount: 2 }];
    const { rest } = standIn({ "GET /balances/current": rows });
    expect(await rest.balances()).toEqual({ EUR: { availableCents: 0, pendingCents: 0, reservedCents: 0 }, USD: { availableCents: 1250, pendingCents: 100, reservedCents: 200 } });
    expect(await rest.balancesAll()).toMatchObject({ EUR: { availableCents: 0 }, GBP: { availableCents: 500, pendingCents: 0, reservedCents: 0 } });
  });

  it("a simulated deposit answered without its reference keeps the one sent", async () => {
    const { rest } = standIn({ "POST /simulation/deposit/create": { id: "dep_1", amount: 20, currency: "USD", status: "SETTLED" } });
    expect(await rest.simulateDeposit({ globalAccountId: "ga_1", amountCents: 2000, reference: "NW-1", payerName: "Ridgeline" }))
      .toEqual({ id: "dep_1", amountCents: 2000, currency: "USD", reference: "NW-1", status: "SETTLED" });
  });

  it("a rate without its time is stamped now; the any-currency calls are the same calls", async () => {
    const quote = { quote_id: "q1", buy_amount: 100, sell_amount: 110, client_rate: 1.1, valid_from_at: "2026-11-19T10:00:00Z", valid_to_at: "2026-11-19T10:15:00Z" };
    const { rest, calls } = standIn({
      "GET /fx/rates/current": { rate: 1.1, rate_details: [{ level: "CLIENT", rate: 1.1, sell_amount: 110.004 }] },
      "POST /fx/quotes/create": quote,
      "POST /fx/conversions/create": { conversion_id: "conv_1", request_id: "r1", status: "SCHEDULED", buy_amount: "100.00", sell_amount: "110.00" },
    });
    const before = Date.now();
    const rate = await rest.currentRateAny({ buyCurrency: "GBP", sellCurrency: "EUR", buyAmountCents: 10000 });
    expect(rate).toMatchObject({ rate: "1.1", sellAmountCents: 11000 });
    expect(Date.parse(rate.at)).toBeGreaterThanOrEqual(before);
    const q = await rest.createQuoteAny({ buyCurrency: "GBP", sellCurrency: "EUR", buyAmountCents: 10000, validity: "MIN_15" });
    expect(q).toMatchObject({ quoteId: "q1", buyCurrency: "GBP", sellAmountCents: 11000, clientRate: "1.1" });
    // A conversion answered without its quote id is the one on the quote it was made on.
    expect(await rest.createConversionAny({ requestId: "r1", quote: q, approvalSha256: "a".repeat(64) })).toMatchObject({ conversionId: "conv_1", quoteId: "q1", buyAmountCents: 10000 });
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(["GET /fx/rates/current", "POST /fx/quotes/create", "POST /fx/conversions/create"]);
  });

  it("a conversion found by its request_id without a quote id has none", async () => {
    const { rest } = standIn({ "GET /fx/conversions": { has_more: false, items: [{ conversion_id: "conv_1", request_id: "r1", status: "SETTLED", buy_amount: 1, sell_amount: 2 }] } });
    expect(await rest.findConversionByRequestId("r1")).toEqual({ conversionId: "conv_1", requestId: "r1", quoteId: "", status: "SETTLED", buyAmountCents: 100, sellAmountCents: 200 });
  });
});

describe("finding a beneficiary", () => {
  it("by IBAN, with the account name where the company name is missing, and EUR where no currency is given", async () => {
    const { rest } = standIn({ "GET /beneficiaries": { has_more: false, items: [
      { id: "ben_1", beneficiary: { bank_details: { iban: "DE89 3704 0044 0532 0130 00", account_name: "Bergtex Textil GmbH" } } },
      { id: "ben_2", beneficiary: { bank_details: { iban: "NL91ABNA0417164300" } } },
    ] } });
    expect(await rest.findBeneficiaryByIban("DE89370400440532013000")).toEqual({ id: "ben_1", name: "Bergtex Textil GmbH", iban: "DE89370400440532013000", bic: "", currency: "EUR" });
    expect(await rest.findBeneficiaryByIban("NL91ABNA0417164300")).toMatchObject({ id: "ben_2", name: "" });
  });

  it("a payout beneficiary only with the same name, method and bank details; one listed without methods is not it", async () => {
    const details = { bank_country_code: "US", account_currency: "USD", account_number: "000123456789", account_routing_value1: "026009593" };
    const { rest, calls } = standIn({ "GET /beneficiaries": new Pages([
      { has_more: true, items: [{ id: "ben_no_methods", beneficiary: { company_name: US.name, bank_details: details } }] },
      { has_more: false, items: [{ id: "ben_us", transfer_methods: ["LOCAL"], beneficiary: { company_name: US.name, bank_details: details } }] },
    ]) });
    expect(await rest.findPayoutBeneficiary(US)).toEqual({ id: "ben_us" });
    expect(calls.map((c) => c.query?.page_num)).toEqual(["0", "1"]);
  });
});

describe("the adapter from the environment", () => {
  it("exists only with the sandbox keys; the rail and the simulation are one client", async () => {
    const saved = { id: process.env.AIRWALLEX_CLIENT_ID, key: process.env.AIRWALLEX_API_KEY, oauth: process.env.AIRWALLEX_OAUTH, payout: process.env.AIRWALLEX_API_KEY_PAYOUT };
    try {
      for (const k of ["AIRWALLEX_OAUTH", "AIRWALLEX_CLIENT_ID", "AIRWALLEX_API_KEY", "AIRWALLEX_API_KEY_PAYOUT"]) delete process.env[k];
      expect(await airwallexFromEnv()).toBeNull();
      process.env.AIRWALLEX_CLIENT_ID = "stand-in-client";
      process.env.AIRWALLEX_API_KEY = "stand-in-key";
      const r = (await airwallexFromEnv())!;
      expect(r.rail).toBeInstanceOf(AirwallexRest);
      expect(r.sim).toBe(r.rail);
    } finally {
      for (const [k, v] of [["AIRWALLEX_CLIENT_ID", saved.id], ["AIRWALLEX_API_KEY", saved.key], ["AIRWALLEX_OAUTH", saved.oauth], ["AIRWALLEX_API_KEY_PAYOUT", saved.payout]] as const) {
        if (v === undefined) delete process.env[k]; else process.env[k] = v;
      }
    }
  });
});
