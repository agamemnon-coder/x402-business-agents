// The CFO-signed terms hash in Airwallex's PaymentIntent record, and its read-back (vic-3, spec item (1)): checkout.ts
// sends metadata {purser_terms_sha256, purser_proposal} on create when the purchase has signed terms and none otherwise;
// a GET-only read-back returns the PaymentIntent's metadata, and a pure comparison marks it equal or not equal to the
// signed hash. Against a scripted Airwallex client and the labelled stand-ins: nothing reaches the network.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AirwallexError } from "../src/airwallex/client.js";
import { AirwallexSandboxCheckout } from "../src/airi/checkout.js";
import { AirwallexHostedCheckout } from "../src/airi/hostedCheckout.js";
import { executeAiriPurchase, requestAiriPurchase, type AiriDeps, type AiriPurchaseRequest } from "../src/airi/purchase.js";
import { StandInAiriClient, StandInCheckout } from "../src/airi/standIn.js";
import { TERMS_METADATA_KEYS, compareTermsMetadata, readBackTerms, readIntentMetadata, termsMetadata } from "../src/airi/termsMetadata.js";
import { openDb, type DB } from "../src/db/open.js";
import { decide, resuming } from "../src/policy/approvals.js";

const SHA = "a".repeat(64);
const OTHER = "b".repeat(64);
const SIGNED = { termsSha256: SHA, proposalId: "P-0007" };
const ORDER = { ref: "P-0007-x1", amount: "45.00", currency: "EUR", description: "vic-3 B" };

type Call = { method: string; path: string; body?: unknown };
function api(answer: (c: Call) => unknown) {
  const calls: Call[] = [];
  return { calls, call: async <T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> => { calls.push({ method, path, body }); return answer({ method, path, body }) as T; } };
}
const created = { id: "int_1", status: "REQUIRES_PAYMENT_METHOD" };

describe("the terms hash on PaymentIntent create", () => {
  it("sends {purser_terms_sha256, purser_proposal} as metadata when the purchase has signed terms", async () => {
    const a = api(() => created);
    expect(await new AirwallexSandboxCheckout(a).prepare({ ...ORDER, signed: SIGNED })).toEqual({ reference: "int_1" });
    expect(a.calls).toEqual([{ method: "POST", path: "/pa/payment_intents/create", body: {
      request_id: "P-0007-x1-pi", amount: 45, currency: "EUR", merchant_order_id: "P-0007-x1", descriptor: "vic-3 B",
      metadata: { purser_terms_sha256: SHA, purser_proposal: "P-0007" },
    } }]);
  });

  it("sends no metadata at all without signed terms", async () => {
    const a = api(() => created);
    await new AirwallexSandboxCheckout(a).prepare(ORDER);
    expect(a.calls[0]!.body).not.toHaveProperty("metadata");
  });

  it("keeps the metadata on the create retried under a fresh request id after duplicate_request", async () => {
    let n = 0;
    const a = api(() => { n += 1; if (n === 1) throw new AirwallexError(400, "duplicate_request", {}, "/pa/payment_intents/create"); return created; });
    await new AirwallexSandboxCheckout(a).prepare({ ...ORDER, signed: SIGNED });
    expect(a.calls.map((c) => (c.body as { metadata?: unknown }).metadata)).toEqual([termsMetadata(SIGNED), termsMetadata(SIGNED)]);
  });

  it("the hosted page's checkout opens its PaymentIntent the same way", async () => {
    const a = api(() => ({ ...created, client_secret: "cs_test" }));
    await new AirwallexHostedCheckout(a).prepare({ ...ORDER, signed: SIGNED });
    expect((a.calls[0]!.body as { metadata?: unknown }).metadata).toEqual({ purser_terms_sha256: SHA, purser_proposal: "P-0007" });
  });

  it("refuses a hash that is not a full SHA-256, before any call", async () => {
    const a = api(() => created);
    await expect(new AirwallexSandboxCheckout(a).prepare({ ...ORDER, signed: { termsSha256: SHA.slice(0, 8), proposalId: "P-0007" } })).rejects.toThrow(/SHA-256/);
    expect(a.calls).toEqual([]);
  });
});

describe("the read-back (GET only) and the comparison (pure)", () => {
  it("reads the PaymentIntent's metadata with one GET", async () => {
    const a = api(() => ({ id: "int_1", status: "SUCCEEDED", client_secret: "cs_x", metadata: { purser_terms_sha256: SHA, purser_proposal: "P-0007" } }));
    expect(await readIntentMetadata(a, "int_1")).toEqual({ purser_terms_sha256: SHA, purser_proposal: "P-0007" });
    expect(a.calls).toEqual([{ method: "GET", path: "/pa/payment_intents/int_1", body: undefined }]);
  });

  it("an intent without metadata reads back as null", async () => {
    expect(await readIntentMetadata(api(() => created), "int_1")).toBeNull();
  });

  it("the checkout reads its own PaymentIntent back the same way", async () => {
    const a = api((c) => (c.method === "POST" ? created : { ...created, metadata: termsMetadata(SIGNED) }));
    const co = new AirwallexSandboxCheckout(a);
    await co.prepare({ ...ORDER, signed: SIGNED });
    expect(await co.readMetadata("int_1")).toEqual(termsMetadata(SIGNED));
    expect(a.calls.map((c) => c.method)).toEqual(["POST", "GET"]);
  });

  it("marks equal only when hash and proposal both match what was signed", () => {
    expect(compareTermsMetadata(SIGNED, termsMetadata(SIGNED))).toEqual({
      key: TERMS_METADATA_KEYS.sha, expected: SHA, read_back: SHA, proposal_expected: "P-0007", proposal_read_back: "P-0007", equal: true,
    });
    expect(compareTermsMetadata(SIGNED, { purser_terms_sha256: OTHER, purser_proposal: "P-0007" })).toMatchObject({ read_back: OTHER, equal: false });
    expect(compareTermsMetadata(SIGNED, { purser_terms_sha256: SHA, purser_proposal: "P-0008" })).toMatchObject({ proposal_read_back: "P-0008", equal: false });
    expect(compareTermsMetadata(SIGNED, null)).toMatchObject({ read_back: null, proposal_read_back: null, equal: false });
    expect(compareTermsMetadata(SIGNED, { purser_terms_sha256: 42 })).toMatchObject({ read_back: null, equal: false });
  });

  it("readBackTerms records the reference and the comparison; a failed read is kept with its code, not equal", async () => {
    const a = api((c) => (c.method === "POST" ? created : { ...created, metadata: termsMetadata(SIGNED) }));
    const co = new AirwallexSandboxCheckout(a);
    expect(await readBackTerms(co, "int_1", SIGNED)).toEqual({ payment_intent_id: "int_1", ...compareTermsMetadata(SIGNED, termsMetadata(SIGNED)) });
    const down = new AirwallexSandboxCheckout(api(() => { throw new AirwallexError(404, "resource_not_found", {}, "/pa/payment_intents/int_9"); }));
    expect(await readBackTerms(down, "int_9", SIGNED)).toMatchObject({ payment_intent_id: "int_9", read_back: null, equal: false, error: "resource_not_found" });
  });
});

describe("the stand-in checkout keeps the metadata, so a dry run can read it back", () => {
  it("stores it on prepare and returns it; none without signed terms", async () => {
    const co = new StandInCheckout();
    const signed = await co.prepare({ ...ORDER, signed: SIGNED });
    const plain = await co.prepare(ORDER);
    if ("outcome" in signed || "outcome" in plain) throw new Error("stand-in refused");
    expect(await co.readMetadata(signed.reference)).toEqual(termsMetadata(SIGNED));
    expect(await co.readMetadata(plain.reference)).toBeNull();
    expect(await readBackTerms(co, signed.reference, SIGNED)).toMatchObject({ equal: true });
  });
});

describe("purchase.ts threads the signed terms to the checkout", () => {
  const T0 = new Date("2026-11-12T10:00:00Z");
  const URL0 = "https://kit11.max-31b.workers.dev/";
  afterEach(() => { resuming.clear(); });

  function fresh(): DB {
    const db = openDb(":memory:");
    const set = (k: string, v: string) => db.prepare("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(k, v, T0.toISOString());
    set("approval.airi_alone", "20.00");
    set("approval.airi_alone_per_day", "3");
    set("airi.merchant.northwind-sandbox", "allowed");
    return db;
  }
  const req = (amount: string): AiriPurchaseRequest => ({
    agent: "sourcing", paymentMethodId: "standin-pm-1", merchantName: "Northwind test shop", merchantUrl: URL0, merchantCountry: "NL",
    amount, currency: "EUR", items: [{ name: "Repair kit", unitPrice: amount, quantity: "1" }], description: "order 1",
  });
  const deps = (checkout: StandInCheckout): AiriDeps => ({ airi: new StandInAiriClient(), checkout, tmpRoot: mkdtempSync(join(tmpdir(), "airi-meta-")), showPasskeyUrl: () => {}, clearPasskeyUrl: () => {}, sleep: async () => {} });

  it("above the limit: the hash the CFO signed and the proposal id go into the PaymentIntent, and read back equal", async () => {
    const db = fresh();
    const co = new StandInCheckout();
    const d = deps(co);
    const out = await requestAiriPurchase(db, d, req("45.00"), T0);
    if (out.status !== "pending_approval") throw new Error(`expected a proposal, got ${out.status}`);
    decide(db, { proposalId: out.proposalId, decision: "APPROVED", typedPrefix: out.termsSha256.slice(0, 8), approver: "cfo", method: "passkey", signedSha256: out.termsSha256, passkey: { credentialId: "test-cred", assertionSha256: "0".repeat(64) } }, T0);
    const done = await executeAiriPurchase(db, d, out.proposalId, T0);
    if (done.status !== "succeeded") throw new Error(`expected success, got ${done.status}`);
    expect(await co.readMetadata(done.reference)).toEqual({ purser_terms_sha256: out.termsSha256, purser_proposal: out.proposalId });
    expect(await readBackTerms(co, done.reference, { termsSha256: out.termsSha256, proposalId: out.proposalId })).toMatchObject({ equal: true });
  });

  it("within the limit: no signed terms, so no metadata", async () => {
    const co = new StandInCheckout();
    const done = await requestAiriPurchase(fresh(), deps(co), req("12.00"), T0);
    if (done.status !== "succeeded") throw new Error(`expected success, got ${done.status}`);
    expect(await co.readMetadata(done.reference)).toBeNull();
  });
});
