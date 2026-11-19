// The Airwallex look-ups that keep a lost answer from paying twice (docs/security.md, "Limits on every external call"):
// after a POST whose answer was lost, the runner looks the object up by what it sent (a conversion by its request_id,
// a supplier's beneficiary by its exact bank details, a batch by its request_id) and adopts it instead of creating a
// second. Each test is one way a careless look-up would adopt the wrong object or miss the right one. The API is a
// stand-in that answers by path; no network, test money only.
import { describe, expect, it } from "vitest";
import { AirwallexRest } from "../src/airwallex/adapter.js";
import { AirwallexBatchRest, type BatchItemIn } from "../src/airwallex/batchTransfers.js";
import type { Airwallex } from "../src/airwallex/client.js";
import type { NewPayoutBeneficiary } from "../src/airwallex/port.js";

type Call = { method: string; path: string; body?: unknown; query?: Record<string, string> };

/** An API stand-in: each answer is chosen by method and path (and the call's query), and every call is recorded. */
function api(answer: (c: Call) => unknown): { api: Airwallex; calls: Call[] } {
  const calls: Call[] = [];
  const stub = {
    onBehalfOf: null,
    async call(method: string, path: string, body?: unknown, query?: Record<string, string>) {
      const c = { method, path, body, query };
      calls.push(c);
      const a = answer(c);
      if (a instanceof Error) throw a;
      return a;
    },
  };
  return { api: stub as unknown as Airwallex, calls };
}

const conversion = (requestId: string, id: string) => ({ conversion_id: id, request_id: requestId, status: "SETTLED", buy_amount: 1850, sell_amount: "2001.37", quote_id: "q-1" });

describe("a conversion is found again by its request_id", () => {
  it("adopts the one with this request_id, even when the list ignores the filter, with amounts to the cent", async () => {
    const { api: a, calls } = api(() => ({ has_more: false, items: [conversion("other-request", "conv-other"), conversion("req-7", "conv-7")] }));
    const found = await new AirwallexRest(a).findConversionByRequestId("req-7");
    expect(found).toEqual({ conversionId: "conv-7", requestId: "req-7", quoteId: "q-1", status: "SETTLED", buyAmountCents: 185000, sellAmountCents: 200137 });
    expect(calls).toEqual([{ method: "GET", path: "/fx/conversions", body: undefined, query: { request_id: "req-7", page_num: "0", page_size: "100" } }]);
  });

  it("reads further pages while Airwallex says there are more, and answers none when it is not there", async () => {
    const { api: a, calls } = api((c) => ({ has_more: c.query!.page_num !== "2", items: [conversion(`noise-${c.query!.page_num}`, "x")] }));
    expect(await new AirwallexRest(a).findConversionByRequestId("req-7")).toBeUndefined();
    expect(calls.map((c) => c.query!.page_num)).toEqual(["0", "1", "2"]);
  });

  it("stops after five pages rather than paging forever", async () => {
    const { api: a, calls } = api(() => ({ has_more: true, items: [] }));
    expect(await new AirwallexRest(a).findConversionByRequestId("req-7")).toBeUndefined();
    expect(calls).toHaveLength(5);
  });

  it("refuses an amount finer than a cent instead of rounding it", async () => {
    const { api: a } = api(() => ({ has_more: false, items: [{ ...conversion("req-7", "c"), sell_amount: "2001.375" }] }));
    await expect(new AirwallexRest(a).findConversionByRequestId("req-7")).rejects.toThrow("amount finer than a cent");
  });
});

describe("a beneficiary is found by its IBAN", () => {
  it("matches an IBAN that Airwallex stores with spaces, on a later page", async () => {
    const pages = [
      { has_more: true, items: [{ id: "ben-1", beneficiary: { company_name: "Other GmbH", bank_details: { iban: "DE02120300000000202051" } } }] },
      { has_more: false, items: [{ id: "ben-2", beneficiary: { company_name: "Bergtex GmbH", bank_details: { iban: "DE89 3704 0044 0532 0130 00", swift_code: "COBADEFFXXX", account_currency: "EUR" } } }] },
    ];
    const { api: a } = api((c) => pages[Number(c.query!.page_num)]);
    expect(await new AirwallexRest(a).findBeneficiaryByIban("DE89370400440532013000"))
      .toEqual({ id: "ben-2", name: "Bergtex GmbH", iban: "DE89370400440532013000", bic: "COBADEFFXXX", currency: "EUR" });
  });

  it("answers none when no page has it", async () => {
    const { api: a } = api(() => ({ has_more: false, items: [{ id: "ben-1", beneficiary: { bank_details: { iban: "DE02120300000000202051" } } }] }));
    expect(await new AirwallexRest(a).findBeneficiaryByIban("DE89370400440532013000")).toBeUndefined();
  });
});

const SUPPLIER: NewPayoutBeneficiary = {
  name: "Bergtex GmbH", method: "LOCAL", clearing: "SEPA",
  address: { street: "Hauptstr. 1", city: "Köln", postcode: "50667", countryCode: "DE" },
  bank: { country: "DE", currency: "EUR", accountName: "Bergtex GmbH", iban: "DE89370400440532013000", swiftCode: "COBADEFFXXX" },
};
const saved = (over: { name?: string; methods?: string[]; iban?: string }) => ({
  id: `ben-${over.name ?? "x"}-${over.iban ?? "same"}-${(over.methods ?? ["LOCAL"]).join("")}`,
  transfer_methods: over.methods ?? ["LOCAL"],
  beneficiary: { company_name: over.name ?? "Bergtex GmbH", bank_details: { bank_country_code: "DE", account_currency: "EUR", iban: over.iban ?? "DE89 3704 0044 0532 0130 00", swift_code: "cobadeffxxx" } },
});

describe("a supplier's beneficiary whose create answer was lost is adopted only on an exact match", () => {
  it("adopts the one with this name, method and these bank details (spaces and case aside)", async () => {
    const { api: a } = api(() => ({ has_more: false, items: [saved({ iban: "DE02120300000000202051" }), saved({ methods: ["SWIFT"] }), saved({ name: "Bergtex Holding" }), saved({})] }));
    expect(await new AirwallexRest(a).findPayoutBeneficiary(SUPPLIER)).toEqual({ id: "ben-x-same-LOCAL" });
  });

  it("does not adopt a same-name beneficiary with another account or another method: a new one is created instead", async () => {
    const { api: a } = api(() => ({ has_more: false, items: [saved({ iban: "DE02120300000000202051" }), saved({ methods: ["SWIFT"] })] }));
    expect(await new AirwallexRest(a).findPayoutBeneficiary(SUPPLIER)).toBeUndefined();
  });

  it("creates only after Airwallex's schema is satisfied and the beneficiary validates, in that order", async () => {
    const { api: a, calls } = api((c) => (c.path === "/beneficiaries/schema" ? { schema: {} } : c.path === "/beneficiaries/create" ? { id: "ben-new" } : {}));
    expect(await new AirwallexRest(a).createPayoutBeneficiary(SUPPLIER)).toEqual({ id: "ben-new" });
    expect(calls.map((c) => c.path)).toEqual(["/beneficiaries/schema", "/beneficiaries/validate", "/beneficiaries/create"]);
    expect(calls[0]!.body).toEqual({ bank_country_code: "DE", account_currency: "EUR", payment_method: "LOCAL", entity_type: "COMPANY", local_clearing_system: "SEPA" });
  });

  it("refuses before validating or creating anything when the schema needs a field the body lacks", async () => {
    const schema = { "create_beneficiary_request.beneficiary.bank_details.account_routing_value1": { required: true, relevant: true, type: "string" } };
    const { api: a, calls } = api((c) => (c.path === "/beneficiaries/schema" ? { schema } : {}));
    await expect(new AirwallexRest(a).createPayoutBeneficiary(SUPPLIER)).rejects.toThrow("needs beneficiary.bank_details.account_routing_value1");
    expect(calls.map((c) => c.path)).toEqual(["/beneficiaries/schema"]);
  });
});

describe("the USD global account", () => {
  it("uses the active one that holds USD, and asks Airwallex only once", async () => {
    const items = [
      { id: "ga-eur", status: "ACTIVE", supported_features: [{ currency: "EUR" }] },
      { id: "ga-usd-closed", status: "CLOSED", supported_features: [{ currency: "USD" }] },
      { id: "ga-usd", status: "ACTIVE", required_features: [{ currency: "USD" }] },
    ];
    const { api: a, calls } = api(() => ({ items }));
    const rail = new AirwallexRest(a);
    expect(await rail.usdGlobalAccountId()).toBe("ga-usd");
    expect(await rail.usdGlobalAccountId()).toBe("ga-usd");
    expect(calls).toHaveLength(1);
  });

  it("opens one when there is none", async () => {
    const { api: a, calls } = api((c) => (c.method === "GET" ? { items: [] } : { id: "ga-new", status: "ACTIVE" }));
    expect(await new AirwallexRest(a).usdGlobalAccountId()).toBe("ga-new");
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(["GET /global_accounts", "POST /global_accounts/create"]);
    expect(calls[1]!.body).toMatchObject({ country_code: "US", required_features: [{ currency: "USD", transfer_method: "LOCAL" }] });
  });
});

const batch = (requestId: string) => ({ id: `bt-${requestId}`, request_id: requestId, status: "DRAFTING", total_item_count: 2, valid_item_count: 2 });

describe("a batch transfer is found again by its request_id", () => {
  it("adopts the one batch listed under it", async () => {
    const { api: a, calls } = api(() => ({ items: [batch("bt-req-1")] }));
    expect(await new AirwallexBatchRest(a).findBatchByRequestId("bt-req-1")).toMatchObject({ id: "bt-bt-req-1", requestId: "bt-req-1", totalItemCount: 2 });
    expect(calls[0]).toMatchObject({ method: "GET", path: "/batch_transfers", query: { request_id: "bt-req-1" } });
  });

  it("answers none when Airwallex lists nothing under it", async () => {
    const { api: a } = api(() => ({ items: [] }));
    expect(await new AirwallexBatchRest(a).findBatchByRequestId("bt-req-1")).toBeUndefined();
  });

  it.each([
    ["a list without items", {}, "came without items"],
    ["a list that ignored the filter", { items: [batch("bt-req-1"), batch("someone-else")] }, "not filtered by the request_id"],
    ["a list with more pages", { items: [batch("bt-req-1")], page_after: "next" }, "not filtered by the request_id"],
    ["two batches under one request_id", { items: [batch("bt-req-1"), batch("bt-req-1")] }, "more than one batch"],
  ])("refuses to guess on %s", async (_name, answer, error) => {
    const { api: a } = api(() => answer);
    await expect(new AirwallexBatchRest(a).findBatchByRequestId("bt-req-1")).rejects.toThrow(error);
  });
});

const line = (n: number): BatchItemIn => ({
  requestId: `line-${n}`, beneficiaryId: "ben-2", amountCents: 185000, currency: "EUR", sourceCurrency: "EUR", method: "LOCAL",
  reference: `BTX-${n}`, reason: "payment_to_supplier", metadata: { approval_sha256: "ab".repeat(32) },
});

describe("a batch's items", () => {
  it("adds exactly the signed amounts, and only 1 to 100 lines a call", async () => {
    const { api: a, calls } = api(() => batch("bt-req-1"));
    const rail = new AirwallexBatchRest(a);
    await rail.addItems("bt-1", [line(1)]);
    expect(calls[0]).toMatchObject({ method: "POST", path: "/batch_transfers/bt-1/add_items" });
    expect((calls[0]!.body as { items: Record<string, unknown>[] }).items[0]).toMatchObject({ request_id: "line-1", transfer_amount: "1850.00", transfer_currency: "EUR", beneficiary_id: "ben-2" });
    await expect(rail.addItems("bt-1", [])).rejects.toThrow("1 to 100 items");
    await expect(rail.addItems("bt-1", Array.from({ length: 101 }, (_, i) => line(i)))).rejects.toThrow("1 to 100 items");
    expect(calls).toHaveLength(1);
  });

  it("reads the items back with their errors, and refuses a list that does not fit one page", async () => {
    const item = { id: "it-1", request_id: "line-1", status: "INVALID", errors: [{ code: "invalid_beneficiary", source: "beneficiary_id" }], transfer_draft: { beneficiary_id: "ben-2", transfer_amount: "1850.00", transfer_currency: "EUR", fee_amount: null } };
    const { api: a } = api(() => ({ items: [item] }));
    const [read] = await new AirwallexBatchRest(a).listItems("bt-1");
    expect(read).toMatchObject({ id: "it-1", status: "INVALID", errors: ["invalid_beneficiary at beneficiary_id"], draft: { amountCents: 185000, feeCents: null } });
    const { api: more } = api(() => ({ items: [item], page_after: "p2" }));
    await expect(new AirwallexBatchRest(more).listItems("bt-1")).rejects.toThrow("more pages than a Purser batch can hold");
    const { api: none } = api(() => ({}));
    await expect(new AirwallexBatchRest(none).listItems("bt-1")).rejects.toThrow("came without items");
  });
});
