// How Purser reads and writes money at Airwallex (src/airwallex/adapter.ts): amounts become integer cents and anything
// finer than a cent, negative or not a number is refused, never rounded; a payout's own fee and Purser's application
// fee are read only when Airwallex states them (fees in two currencies are no fee Purser can count); Purser's fee goes
// out as one FIXED fee in whole cents above zero; a transfer list that was not filtered by the request_id, or holds
// two, is an error, never "nothing"; a beneficiary is adopted only for the same name, method and bank details, and a
// schema field the body lacks stops the create before anything is sent.
import { describe, expect, it } from "vitest";
import { AirwallexRest, cents, missingFromSchema, onlyRequestId, payerOf, payoutBeneficiaryBody } from "../src/airwallex/adapter.js";
import type { Airwallex } from "../src/airwallex/client.js";
import type { NewPayoutBeneficiary, NewPayoutTransfer } from "../src/airwallex/port.js";

function rest(answer: (method: string, path: string, body: unknown, query?: Record<string, string>) => unknown, onBehalfOf: string | null = null) {
  const calls: { method: string; path: string; body: unknown; query?: Record<string, string> }[] = [];
  const api = { onBehalfOf, call: async (method: string, path: string, body?: unknown, query?: Record<string, string>) => { calls.push({ method, path, body, query }); return answer(method, path, body, query); } };
  return { rail: new AirwallexRest(api as unknown as Airwallex), calls };
}
const transfer = (o: Record<string, unknown> = {}) => ({ id: "tr_1", request_id: "req-1", status: "PROCESSING", transfer_amount: "1850.00", transfer_currency: "EUR", ...o });
const supplier: NewPayoutBeneficiary = { name: "Stockline GmbH", address: { street: "Hafen 1", city: "Hamburg", postcode: "20457", countryCode: "DE" }, method: "SWIFT", bank: { country: "DE", currency: "EUR", accountName: "Stockline GmbH", iban: "DE00 0000 0000 0000 0044 71", swiftCode: "COBADEFFXXX" } };

describe("amounts in cents", () => {
  it("takes numbers and numeric strings to the cent, and refuses anything else", () => {
    expect(cents("1850.00")).toBe(185_000);
    expect(cents(" 12.5 ")).toBe(1_250);
    expect(cents(7)).toBe(700);
    expect(cents(0.1 + 0.2)).toBe(30);
    expect(cents("3.100000")).toBe(310);
    for (const v of ["-1.00", "1e3", "", null, undefined, "abc", "1,00", -0.5]) expect(() => cents(v), String(v)).toThrow(/^not a non-negative amount/);
    expect(() => cents("1.001")).toThrow("amount finer than a cent: 1.001");
    expect(() => cents(0.005)).toThrow("amount finer than a cent: 0.005000");
  });
});

describe("a transfer as Airwallex states it", () => {
  it("reads the failure from either schema, and the fee only when its currency is stated", async () => {
    const answers = [
      transfer({ status: "FAILED", failure: { code: "invalid_beneficiary", message: "rejected", details: { type: "BENEFICIARY_REJECTED" } }, fee_amount: 15, fee_currency: "EUR" }),
      transfer({ status: "FAILED", failure_type: "INSUFFICIENT_FUNDS", failure_reason: "no money", fee_amount: 15 }),
      transfer({ failure: { code: "x_code" } }),
    ];
    const { rail } = rest(() => answers.shift());
    expect(await rail.getTransfer("tr_1")).toMatchObject({ amountCents: 185_000, failureType: "BENEFICIARY_REJECTED", failureReason: "rejected", fee: { cents: 1_500, currency: "EUR" }, beneficiaryId: null, applicationFee: null });
    expect(await rail.getTransfer("tr_1")).toMatchObject({ failureType: "INSUFFICIENT_FUNDS", failureReason: "no money", fee: null });
    expect(await rail.getTransfer("tr_1")).toMatchObject({ failureType: "x_code", failureReason: null });
  });

  it("counts Purser's application fees only on the transfer, in one currency", async () => {
    const fees = [
      [{ source_type: "TRANSFER", amount: "2.00", currency: "EUR" }, { source_type: "TRANSFER", amount: 0.63, currency: "EUR" }, { source_type: "CONVERSION", amount: "9.00", currency: "EUR" }],
      [{ source_type: "TRANSFER", amount: "2.00", currency: "EUR" }, { source_type: "TRANSFER", amount: "2.00", currency: "USD" }],
      [{ source_type: "TRANSFER", currency: "EUR" }],
      null,
    ];
    const { rail } = rest(() => transfer({ application_fees: fees.shift() }));
    expect((await rail.getTransfer("tr_1")).applicationFee).toEqual({ cents: 263, currency: "EUR" });
    expect((await rail.getTransfer("tr_1")).applicationFee).toBeNull();
    expect((await rail.getTransfer("tr_1")).applicationFee).toBeNull();
    expect((await rail.getTransfer("tr_1")).applicationFee).toBeNull();
  });

  it("escapes a transfer id in its path", async () => {
    const { rail, calls } = rest(() => transfer());
    await rail.getTransfer("tr/../balances");
    expect(calls[0]!.path).toBe("/transfers/tr%2F..%2Fbalances");
  });
});

describe("Purser's fee on a payout", () => {
  const payout = (o: Partial<NewPayoutTransfer> = {}): NewPayoutTransfer => ({ requestId: "req-1", beneficiaryId: "ben_1", amountCents: 185_000, currency: "EUR", sourceCurrency: "EUR", method: "SWIFT", reference: "INV-1", reason: "goods", approvalSha256: "a".repeat(64), ...o });

  it("goes out as one FIXED fee on the transfer, in whole cents above zero, or not at all", async () => {
    const { rail, calls } = rest(() => transfer());
    await rail.createPayoutTransfer(payout({ applicationFee: { amountCents: 463, currency: "EUR" } }));
    expect(calls[0]!.body).toMatchObject({ transfer_amount: "1850.00", application_fee_options: [{ source_type: "TRANSFER", type: "FIXED", amount: "4.63", currency: "EUR" }], metadata: { approval_sha256: "a".repeat(64) } });
    await rail.createPayoutTransfer(payout());
    expect(calls[1]!.body).not.toHaveProperty("application_fee_options");
    for (const amountCents of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      await expect(rail.createPayoutTransfer(payout({ applicationFee: { amountCents, currency: "EUR" } }))).rejects.toThrow("an application fee is a whole number of cents above zero");
    }
    expect(calls).toHaveLength(2);
  });

  it("names the payer only when one is given", () => {
    expect(payerOf(undefined)).toEqual({});
    expect(payerOf({ companyName: "Northwind B.V.", registrationNumber: "12345678", address: { countryCode: "NL", city: "Amsterdam", postcode: "1011AA", street: "Dam 1" } })).toEqual({ payer: {
      entity_type: "COMPANY", company_name: "Northwind B.V.", address: { country_code: "NL", city: "Amsterdam", postcode: "1011AA", street_address: "Dam 1" }, additional_info: { business_registration_number: "12345678" },
    } });
  });
});

describe("a transfer list under a request_id", () => {
  it("one item, or nothing; a list not filtered, with more pages, holding two, or without items is an error", () => {
    expect(onlyRequestId({ items: [{ request_id: "r1", id: "t" }] }, "r1")).toEqual({ request_id: "r1", id: "t" });
    expect(onlyRequestId({ items: [] }, "r1")).toBeUndefined();
    expect(() => onlyRequestId(null, "r1")).toThrow("Airwallex's transfer list came without items");
    expect(() => onlyRequestId({}, "r1")).toThrow("Airwallex's transfer list came without items");
    expect(() => onlyRequestId({ items: [{ request_id: "r2" }] }, "r1")).toThrow("Airwallex's transfer list was not filtered by the request_id");
    expect(() => onlyRequestId({ items: [], has_more: true }, "r1")).toThrow("Airwallex's transfer list was not filtered by the request_id");
    expect(() => onlyRequestId({ items: [{ request_id: "r1" }, { request_id: "r1" }] }, "r1")).toThrow("Airwallex lists more than one transfer under request_id r1");
  });

  it("the lenient look-up picks its own request_id out of an unfiltered list; the strict one refuses it", async () => {
    const { rail } = rest(() => ({ items: [transfer({ id: "tr_other", request_id: "req-other" }), transfer()] }));
    expect((await rail.findTransferByRequestId("req-1"))?.id).toBe("tr_1");
    await expect(rail.findTransferByRequestIdStrict("req-1")).rejects.toThrow("not filtered by the request_id");
  });
});

describe("a supplier's account at Airwallex", () => {
  it("the body carries the bank details given, the bank's name from its BIC, and both method names", () => {
    const body = payoutBeneficiaryBody({ ...supplier, clearing: "SEPA", bank: { ...supplier.bank, accountNumber: "123", routingType: "aba", routingValue: "021000021" } }) as { beneficiary: { bank_details: Record<string, string> }; transfer_methods: string[]; payment_methods: string[]; nickname: string };
    expect(body.beneficiary.bank_details).toMatchObject({ account_currency: "EUR", iban: "DE00 0000 0000 0000 0044 71", account_number: "123", account_routing_type1: "aba", account_routing_value1: "021000021", swift_code: "COBADEFFXXX", local_clearing_system: "SEPA" });
    expect(body.transfer_methods).toEqual(["SWIFT"]);
    expect(body.payment_methods).toEqual(["SWIFT"]);
    expect(body.nickname).toBe("Stockline GmbH EUR SWIFT");
    // A routing type without its value sends neither.
    const half = payoutBeneficiaryBody({ ...supplier, bank: { ...supplier.bank, routingType: "aba" } }) as { beneficiary: { bank_details: Record<string, string> } };
    expect(half.beneficiary.bank_details).not.toHaveProperty("account_routing_type1");
  });

  it("a field the schema requires that the body lacks stops the create before validate or create", async () => {
    const schema = { "create_beneficiary_request.beneficiary.bank_details.iban": { required: true, relevant: true }, "create_beneficiary_request.beneficiary.bank_details.bank_branch": { required: true, relevant: true }, "create_beneficiary_request.beneficiary": { required: true, relevant: true, type: "object" }, "create_beneficiary_request.nickname": { required: false, relevant: true }, "other.field": { required: true, relevant: true } };
    expect(missingFromSchema(schema, payoutBeneficiaryBody(supplier))).toEqual(["beneficiary.bank_details.bank_branch"]);
    const { rail, calls } = rest((_m, path) => (path === "/beneficiaries/schema" ? { schema } : { id: "ben_9" }));
    await expect(rail.createPayoutBeneficiary(supplier)).rejects.toThrow("Airwallex's beneficiary schema for DE, EUR, SWIFT needs beneficiary.bank_details.bank_branch");
    expect(calls.map((c) => c.path)).toEqual(["/beneficiaries/schema"]);
    const ok = rest((_m, path) => (path === "/beneficiaries/schema" ? { schema: {} } : { id: "ben_9" }));
    expect(await ok.rail.createPayoutBeneficiary(supplier)).toEqual({ id: "ben_9" });
    expect(ok.calls.map((c) => c.path)).toEqual(["/beneficiaries/schema", "/beneficiaries/validate", "/beneficiaries/create"]);
  });

  it("an earlier create is adopted only for the same name, method and bank details, across pages", async () => {
    const item = (id: string, o: { name?: string; methods?: string[]; iban?: string } = {}) => ({ id, transfer_methods: o.methods ?? ["SWIFT"], beneficiary: { company_name: o.name ?? "Stockline GmbH", bank_details: { bank_country_code: "DE", account_currency: "EUR", iban: o.iban ?? "DE00000000000000004471", swift_code: "cobadeffxxx" } } });
    const pages = [
      { has_more: true, items: [item("ben_name", { name: "Stockline AG" }), item("ben_method", { methods: ["LOCAL"] }), item("ben_iban", { iban: "DE00000000000000009999" })] },
      { has_more: false, items: [item("ben_same")] },
    ];
    const { rail, calls } = rest((_m, _p, _b, q) => pages[Number(q!.page_num)]);
    expect(await rail.findPayoutBeneficiary(supplier)).toEqual({ id: "ben_same" });
    expect(calls.map((c) => c.query!.page_num)).toEqual(["0", "1"]);
    const none = rest(() => ({ has_more: false, items: [item("ben_x", { iban: "DE00000000000000001111" })] }));
    expect(await none.rail.findPayoutBeneficiary(supplier)).toBeUndefined();
  });
});

describe("balances", () => {
  it("the EUR and USD cash balances in cents; every currency for the payables", async () => {
    const rows = [{ currency: "EUR", available_amount: 35000, pending_amount: 12.5 }, { currency: "USD", available_amount: 25000.1 }, { currency: "GBP", available_amount: 10 }];
    const { rail, calls } = rest(() => rows);
    expect(await rail.balances()).toEqual({ EUR: { availableCents: 3_500_000, pendingCents: 1_250, reservedCents: 0 }, USD: { availableCents: 2_500_010, pendingCents: 0, reservedCents: 0 } });
    expect(Object.keys(await rail.balancesAll())).toEqual(["EUR", "USD", "GBP"]);
    expect(calls[0]!.query).toEqual({ account_type: "cash" });
    expect(rest(() => [], "acct_northwind").rail.payingAccount).toBe("acct_northwind");
  });
});
