// The Airwallex sandbox checkout for the Airi rail (src/airi/checkout.ts) and the credential file reader
// (src/airi/credential.ts), against a scripted Airwallex client: nothing reaches Airwallex. The card used is the public
// test number 4111 1111 1111 1111; the tests check that it never appears in an error, an answer or a log line.
import { chmodSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AirwallexAmbiguous, AirwallexError } from "../src/airwallex/client.js";
import { AirwallexSandboxCheckout, answerOf } from "../src/airi/checkout.js";
import { CheckoutOutcomeUnknown } from "../src/airi/client.js";
import { CredentialFileError, cardFromCredential, readCredentialFile } from "../src/airi/credential.js";

const PAN = "4111111111111111";
const CVC = "737";

function credFile(content: unknown, mode = 0o600): string {
  const dir = mkdtempSync(join(tmpdir(), "airi-cred-test-"));
  const f = join(dir, "credential.json");
  writeFileSync(f, JSON.stringify(content), { mode });
  chmodSync(f, mode);
  return f;
}
const goodCred = () => credFile({ tokenNumber: PAN, expiryMonth: "12", expiryYear: "2030", cvv: CVC, tokenType: "NETWORK_TOKEN" });

type Call = { method: string; path: string; body?: unknown };
function api(answer: (c: Call) => unknown) {
  const calls: Call[] = [];
  return { calls, call: async <T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> => { calls.push({ method, path, body }); return answer({ method, path, body }) as T; } };
}
const never = (s: string) => (v: unknown) => expect(JSON.stringify(v ?? null) + String((v as Error)?.message ?? "") + String((v as Error)?.stack ?? "")).not.toContain(s);

describe("credential file", () => {
  it("reads the card from the documented words (tokenized PAN, expiry, CVV), in memory only", () => {
    expect(readCredentialFile(goodCred())).toEqual({ number: PAN, expiryMonth: "12", expiryYear: "2030", cvc: CVC });
    expect(cardFromCredential({ credential: { pan: PAN, expiry: "07/31", cvc: "1234" } })).toEqual({ number: PAN, expiryMonth: "07", expiryYear: "2031", cvc: "1234" });
  });

  it("refuses a file others can read, a symlink, and a shape it does not know, naming keys and never values", () => {
    expect(() => readCredentialFile(credFile({ tokenNumber: PAN }, 0o644))).toThrow(/readable by others/);
    const f = goodCred();
    const link = join(mkdtempSync(join(tmpdir(), "airi-link-")), "credential.json");
    symlinkSync(f, link);
    expect(() => readCredentialFile(link)).toThrow(CredentialFileError);
    const e = (() => { try { cardFromCredential({ cardNo: PAN, exp: "12/30", code: CVC }); } catch (x) { return x as Error; } return null; })();
    expect(e?.message).toMatch(/keys: cardNo, exp, code/);
    never(PAN)(e);
    never(CVC)(e);
  });
});

describe("AirwallexSandboxCheckout", () => {
  it("opens a PaymentIntent, then confirms it with the card, as the API reference documents", async () => {
    const a = api((c) => (c.path.endsWith("/create") ? { id: "int_1", status: "REQUIRES_PAYMENT_METHOD" } : { id: "int_1", status: "SUCCEEDED", latest_payment_attempt: { status: "PAID" } }));
    const co = new AirwallexSandboxCheckout(a);
    expect(await co.prepare({ ref: "airi-x1", amount: "12.00", currency: "EUR", description: "vic-1 A" })).toEqual({ reference: "int_1" });
    expect(await co.pay("int_1", "airi-x1", goodCred())).toEqual({ outcome: "SUCCEEDED", reference: "int_1", code: "SUCCEEDED" });
    expect(a.calls[0]).toEqual({ method: "POST", path: "/pa/payment_intents/create", body: { request_id: "airi-x1-pi", amount: 12, currency: "EUR", merchant_order_id: "airi-x1", descriptor: "vic-1 A" } });
    expect(a.calls[1]).toEqual({ method: "POST", path: "/pa/payment_intents/int_1/confirm", body: { request_id: "airi-x1-confirm", payment_method: { type: "card", card: { number: PAN, expiry_month: "12", expiry_year: "2030", cvc: CVC } }, payment_method_options: { card: { auto_capture: true } } } });
  });

  it("maps Airwallex's states: accepted, declined with its own code, not final", () => {
    expect(answerOf({ id: "i", status: "REQUIRES_CAPTURE" })).toMatchObject({ outcome: "SUCCEEDED" });
    expect(answerOf({ id: "i", status: "REQUIRES_PAYMENT_METHOD", latest_payment_attempt: { status: "FAILED", failure_code: "authorization_failed", provider_original_response_code: "05" } })).toEqual({ outcome: "DECLINED", reference: "i", code: "authorization_failed" });
    expect(answerOf({ id: "i", status: "REQUIRES_PAYMENT_METHOD", latest_payment_attempt: { status: "FAILED", provider_original_response_code: "05" } })).toMatchObject({ outcome: "DECLINED", code: "05" });
    expect(answerOf({ id: "i", status: "REQUIRES_CUSTOMER_ACTION" })).toMatchObject({ outcome: "DECLINED", code: "REQUIRES_CUSTOMER_ACTION" });
    expect(answerOf({ id: "i", status: "REQUIRES_PAYMENT_METHOD" })).toMatchObject({ outcome: "NOT_SUBMITTED" });
    expect(answerOf({ id: "i", status: "PENDING" })).toBeNull();
  });

  it("a confirm Airwallex refuses is a decline with its code; the error body (which might echo the card) is not kept", async () => {
    const a = api((c) => { if (c.path.endsWith("/confirm")) throw new AirwallexError(400, "validation_error", { code: "validation_error", message: `card ${PAN} cvc ${CVC} invalid`, number: PAN }, c.path); return { id: "int_1", status: "REQUIRES_PAYMENT_METHOD" }; });
    const out = await new AirwallexSandboxCheckout(a).pay("int_1", "airi-x1", goodCred());
    expect(out).toEqual({ outcome: "DECLINED", reference: "int_1", code: "validation_error" });
    never(PAN)(out);
  });

  it("a thrown error carries no PAN and no CVC, even when the failure quoted the request", async () => {
    const leaky = new Error(`socket hang up while sending {"number":"${PAN}","cvc":"${CVC}"}`);
    for (const thrown of [leaky, new AirwallexAmbiguous("/pa/payment_intents/int_1/confirm", leaky)]) {
      const a = api((c) => { if (c.path.endsWith("/confirm")) throw thrown; return {}; });
      const e = await new AirwallexSandboxCheckout(a).pay("int_1", "airi-x1", goodCred()).catch((x: unknown) => x as Error);
      expect(e).toBeInstanceOf(CheckoutOutcomeUnknown);
      expect((e as Error & { cause?: unknown }).cause).toBeUndefined();
      never(PAN)(e);
      never(CVC)(e);
    }
  });

  it("an answer still pending is an unknown outcome, looked up later by the intent's id", async () => {
    const a = api((c) => (c.method === "GET" ? { id: "int_1", status: "SUCCEEDED" } : { id: "int_1", status: "PENDING" }));
    const co = new AirwallexSandboxCheckout(a);
    await expect(co.pay("int_1", "airi-x1", goodCred())).rejects.toBeInstanceOf(CheckoutOutcomeUnknown);
    expect(await co.lookup("int_1")).toMatchObject({ outcome: "SUCCEEDED" });
    expect(a.calls.at(-1)).toEqual({ method: "GET", path: "/pa/payment_intents/int_1", body: undefined });
  });

  it("duplicate_request on the create (a retry after no answer; vic-1c, 7 Nov): asked once more under a fresh request id, no card sent", async () => {
    const dup = () => { throw new AirwallexError(400, "duplicate_request", { code: "duplicate_request", message: "request_id airi-x1-pi was used before" }, "/pa/payment_intents/create"); };
    const a = api((c) => ((c.body as { request_id: string }).request_id === "airi-x1-pi" ? dup() : { id: "int_2", status: "REQUIRES_PAYMENT_METHOD" }));
    const co = new AirwallexSandboxCheckout(a);
    expect(await co.prepare({ ref: "airi-x1", amount: "12.00", currency: "EUR", description: "vic-1 A" })).toEqual({ reference: "int_2" });
    expect(a.calls.map((c) => (c.body as { request_id: string; merchant_order_id: string }))).toEqual([
      expect.objectContaining({ request_id: "airi-x1-pi", merchant_order_id: "airi-x1" }), expect.objectContaining({ request_id: "airi-x1-pi-r2", merchant_order_id: "airi-x1" })]);
    // Twice a duplicate: it stops there, with Airwallex's own code. Still no card.
    const b = api(() => dup());
    expect(await new AirwallexSandboxCheckout(b).prepare({ ref: "airi-x1", amount: "12.00", currency: "EUR", description: "vic-1 A" })).toMatchObject({ outcome: "NOT_SUBMITTED", reference: null, code: "duplicate_request" });
    expect(b.calls).toHaveLength(2);
    for (const c of [...a.calls, ...b.calls]) never(PAN)(c);
    // A long order ref: the fresh request id still fits Airwallex's 64 characters and differs from the first.
    const long = api((c) => ((c.body as { request_id: string }).request_id.endsWith("-r2") ? { id: "int_3", status: "REQUIRES_PAYMENT_METHOD" } : dup()));
    await new AirwallexSandboxCheckout(long).prepare({ ref: "x".repeat(70), amount: "12.00", currency: "EUR", description: "d" });
    const ids = long.calls.map((c) => (c.body as { request_id: string }).request_id);
    expect(ids.every((i) => i.length <= 64)).toBe(true);
    expect(new Set(ids).size).toBe(2);
  });

  it("acquiring not available: says so plainly and sends no card", async () => {
    const a = api((c) => { throw new AirwallexError(401, "unauthorized", {}, c.path); });
    expect(await new AirwallexSandboxCheckout(a).prepare({ ref: "airi-x1", amount: "12.00", currency: "EUR", description: "d" }))
      .toEqual({ outcome: "NOT_SUBMITTED", reference: null, code: "unauthorized", reason: "Airwallex refused to open a PaymentIntent: acquiring is not available on this sandbox account" });
    expect(a.calls.map((c) => c.path)).toEqual(["/pa/payment_intents/create"]);
  });

  it("an unreadable credential is not sent: NOT_SUBMITTED, naming keys only", async () => {
    const a = api(() => ({ id: "int_1", status: "SUCCEEDED" }));
    const out = await new AirwallexSandboxCheckout(a).pay("int_1", "airi-x1", credFile({ weird: PAN }));
    expect(out).toMatchObject({ outcome: "NOT_SUBMITTED", code: "CREDENTIAL_UNREADABLE" });
    never(PAN)(out);
    expect(a.calls).toEqual([]);
  });
});
