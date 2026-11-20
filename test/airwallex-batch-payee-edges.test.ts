// Two Airwallex surfaces read strictly (src/airwallex/batchTransfers.ts, src/airwallex/payeeName.ts): a batch or item
// Airwallex answers with fields left out is read as nothing (no amount, no currency, no draft), never guessed; the
// batch REST client calls the documented paths for a read, a quote and a submit; the in-memory batch stand-in keeps
// Airwallex's lifecycle (a duplicate request_id, items or a submit outside DRAFTING, a delete or a web-app decision
// out of turn are refused; without an approval workflow a submit books at once). The payee name check's body carries
// exactly the account given; its REST client reads an empty answer as UNKNOWN; a holder of another kind is refused
// with or without the name the bank holds; the stand-in finds an account by number too. No network.
import { describe, expect, it } from "vitest";
import { AirwallexBatchRest, FakeBatchTransfers, toBatch, toItem, type BatchItemIn } from "../src/airwallex/batchTransfers.js";
import type { Airwallex } from "../src/airwallex/client.js";
import { AirwallexPayeeNameRest, FakePayeeNames, nameCheckVerdict, payeeVerifierFromEnv, recordNameCheck, verifyBody } from "../src/airwallex/payeeName.js";
import { openDb } from "../src/db/open.js";

function stub(answer: unknown, onBehalfOf: string | null = null) {
  const calls: { method: string; path: string; body: unknown }[] = [];
  const api = { onBehalfOf, call: async (method: string, path: string, body?: unknown) => { calls.push({ method, path, body }); return answer; } } as unknown as Airwallex;
  return { api, calls };
}

describe("a batch or an item with fields left out is read as nothing", () => {
  it("quotes without currencies or amounts", () => {
    const b = toBatch({ id: "b1", request_id: "r1", status: "DRAFTING", quote_summary: { quotes: [{}] } } as never);
    expect(b).toEqual({ id: "b1", requestId: "r1", status: "DRAFTING", shortReference: null, totalItemCount: 0, validItemCount: 0, metadata: {},
      quotes: [{ sourceCurrency: "", transferCurrency: "", payerPaysCents: 0, feeCents: 0, feeCurrency: null }], quoteExpiresAt: null });
  });

  it("an item's draft without its fields, and an item without a draft", () => {
    expect(toItem({ id: "i1", request_id: "q1", status: "VALIDATED", transfer_draft: {} }).draft).toEqual({
      beneficiaryId: null, amountCents: 0, currency: "", sourceCurrency: "", method: "", reference: "", reason: null, feeCents: null, feeCurrency: null, payerPaysCents: null, metadata: {},
    });
    expect(toItem({ id: "i1", request_id: "q1", status: "VALIDATION_FAILED", transfer_draft: null, errors: [{ code: "beneficiary_not_found", source: "beneficiary_id" }, { code: "x" }] }))
      .toMatchObject({ draft: null, transferId: null, errors: ["beneficiary_not_found at beneficiary_id", "x"] });
  });
});

describe("the batch REST client", () => {
  it("reads, quotes and submits on the documented paths, for the account it acts for", async () => {
    const { api, calls } = stub({ id: "btr 1", request_id: "r1", status: "SCHEDULED" }, "acct_1");
    const rest = new AirwallexBatchRest(api);
    expect(rest.payingAccount).toBe("acct_1");
    expect(await rest.getBatch("btr 1")).toMatchObject({ id: "btr 1", status: "SCHEDULED" });
    await rest.quoteBatch("btr 1", "MIN_15");
    await rest.submitBatch("btr 1");
    expect(calls).toEqual([
      { method: "GET", path: "/batch_transfers/btr%201", body: undefined },
      { method: "POST", path: "/batch_transfers/btr%201/quote", body: { validity: "MIN_15" } },
      { method: "POST", path: "/batch_transfers/btr%201/submit", body: undefined },
    ]);
  });
});

describe("the in-memory batch stand-in keeps Airwallex's lifecycle", () => {
  const item = (n: number, beneficiaryId = "ben_1"): BatchItemIn => ({
    requestId: `q${n}`, beneficiaryId, amountCents: 10000 * n, currency: "EUR", sourceCurrency: "EUR", method: "SWIFT", reference: `INV-${n}`, reason: "goods_purchased", metadata: { line: `P-000${n}` },
  });

  it("refuses an unknown batch and a second create under one request_id", async () => {
    const f = new FakeBatchTransfers();
    await expect(f.getBatch("btr_404")).rejects.toMatchObject({ message: "Airwallex /batch_transfers/btr_404 -> 404 not_found", status: 404 });
    await f.createBatch({ requestId: "r1", name: "b", metadata: {} });
    await expect(f.createBatch({ requestId: "r1", name: "b", metadata: {} })).rejects.toMatchObject({ status: 400, code: "duplicate_request_id" });
  });

  it("without an approval workflow a submit books the valid items at once; nothing changes after", async () => {
    const f = new FakeBatchTransfers();
    f.approvalWorkflow = false;
    f.knownBeneficiaries = new Set(["ben_1"]);
    const b = await f.createBatch({ requestId: "r1", name: "b", metadata: {} });
    await f.addItems(b.id, [item(1), item(2, "ben_unknown")]);
    await f.quoteBatch(b.id);
    expect(await f.submitBatch(b.id)).toMatchObject({ status: "BOOKED", totalItemCount: 2, validItemCount: 1 });
    const items = await f.listItems(b.id);
    expect(items.map((i) => [i.status, i.transferId === null, i.draft === null])).toEqual([["BOOKED", false, true], ["VALIDATION_FAILED", true, true]]);
    await expect(f.addItems(b.id, [item(3)])).rejects.toMatchObject({ message: "Airwallex add_items -> 400 batch not DRAFTING", status: 400 });
    await expect(f.submitBatch(b.id)).rejects.toMatchObject({ message: "Airwallex submit -> 400 batch is BOOKED" });
    await expect(f.deleteBatch(b.id)).rejects.toMatchObject({ message: "Airwallex delete -> 400 batch not DRAFTING" });
    expect(() => f.decideInWebApp(b.id, "approve")).toThrow(`batch ${b.id} is BOOKED`);
  });
});

describe("the payee name check", () => {
  it("its body carries the account as given: an account number and its routing, no IBAN", () => {
    expect(verifyBody({ name: "Ridgeline", entity: "COMPANY", country: "US", currency: "USD", accountNumber: "000123456789", routingType: "aba", routingValue: "026009593" })).toEqual({
      transfer_method: "LOCAL", entity_type: "COMPANY",
      bank_details: { account_name: "Ridgeline", bank_country_code: "US", account_currency: "USD", account_number: "000123456789", account_routing_type1: "aba", account_routing_value1: "026009593" },
    });
    // A routing type without its value is not sent.
    expect((verifyBody({ name: "R", entity: "COMPANY", country: "GB", currency: "GBP", accountNumber: "1", routingType: "sort_code" }).bank_details as Record<string, string>).account_routing_type1).toBeUndefined();
  });

  it("the REST client posts the body and reads an empty answer as UNKNOWN, which is not proposed", async () => {
    const { api, calls } = stub(null);
    const v = new AirwallexPayeeNameRest(api);
    expect(v.source).toBe("airwallex");
    const c = await v.verifyAccount({ name: "Bergtex", entity: "COMPANY", country: "DE", currency: "EUR", iban: "de89 3704 0044 0532 0130 00" });
    expect(c).toEqual({ code: "UNKNOWN", match: null, resolvedName: null, resolvedBank: null });
    expect(calls[0]).toMatchObject({ method: "POST", path: "/beneficiaries/verify_account", body: { bank_details: { iban: "DE89370400440532013000" } } });
    expect(nameCheckVerdict(c, "Bergtex")).toEqual({ proceed: false, label: "unknown answer UNKNOWN; not proposed" });
    const full = await new AirwallexPayeeNameRest(stub({ code: "VERIFIED", details: { account_name_match_result: "FULL_MATCH", resolved_account_name: "Bergtex Textil GmbH", resolved_bank_name: "Commerzbank" } }).api)
      .verifyAccount({ name: "Bergtex", entity: "COMPANY", country: "DE", currency: "EUR", iban: "DE89370400440532013000" });
    expect(full).toEqual({ code: "VERIFIED", match: "FULL_MATCH", resolvedName: "Bergtex Textil GmbH", resolvedBank: "Commerzbank" });
  });

  it("a holder of another kind is refused, with the name the bank holds or without it", () => {
    expect(nameCheckVerdict({ code: "VERIFIED", match: "FULL_MATCH_INCORRECT_TYPE", resolvedName: null, resolvedBank: null }, "Bergtex").label)
      .toBe("the payee's bank holds this account for another kind of holder than a company (FULL_MATCH_INCORRECT_TYPE); confirm with the supplier on a known contact before it is proposed");
  });

  it("the stand-in finds an account by its number, and an answer recorded without a source is Airwallex's", async () => {
    const f = new FakePayeeNames();
    f.accounts.set("000123456789", { name: "Ridgeline Outfitters", entity: "COMPANY", bank: "Chase" });
    expect(await f.verifyAccount({ name: "Ridgeline Outfitters", entity: "COMPANY", country: "US", currency: "USD", accountNumber: "000123456789" })).toMatchObject({ code: "VERIFIED", match: "FULL_MATCH" });
    expect(await f.verifyAccount({ name: "Nobody", entity: "COMPANY", country: "US", currency: "USD" })).toMatchObject({ code: "INVALID" });
    const db = openDb(":memory:");
    const row = recordNameCheck(db, { code: "CANNOT_VERIFY", match: null, resolvedName: null, resolvedBank: null }, { name: "Ridgeline", accountKey: "000123456789" }, undefined as never, "treasury");
    expect(row).toMatchObject({ code: "CANNOT_VERIFY", proceed: 1 });
    expect(JSON.parse((db.prepare("SELECT payload_json FROM audit_log WHERE event = 'payee.name_checked'").get() as { payload_json: string }).payload_json)).toMatchObject({ source: "airwallex" });
  });

  it("the live verifier exists only with the sandbox keys", async () => {
    const saved = { id: process.env.AIRWALLEX_CLIENT_ID, key: process.env.AIRWALLEX_API_KEY, oauth: process.env.AIRWALLEX_OAUTH };
    try {
      delete process.env.AIRWALLEX_OAUTH;
      delete process.env.AIRWALLEX_CLIENT_ID;
      delete process.env.AIRWALLEX_API_KEY;
      expect(await payeeVerifierFromEnv()).toBeNull();
      process.env.AIRWALLEX_CLIENT_ID = "stand-in-client";
      process.env.AIRWALLEX_API_KEY = "stand-in-key";
      expect(await payeeVerifierFromEnv()).toBeInstanceOf(AirwallexPayeeNameRest);
    } finally {
      for (const [k, v] of [["AIRWALLEX_CLIENT_ID", saved.id], ["AIRWALLEX_API_KEY", saved.key], ["AIRWALLEX_OAUTH", saved.oauth]] as const) if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  });
});
