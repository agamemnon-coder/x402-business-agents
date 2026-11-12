// What the Airwallex sandbox reports for the Airi run's two PaymentIntents (src/airwallex/intentReadback.ts): each
// answer is kept as Airwallex returned it, except what must not be kept (a secret, card data, personal or device data,
// an authentication value), which is replaced by a marker and listed with its path and reason. The answers below are
// made up for these tests: they are not Airwallex's.
import { describe, expect, it } from "vitest";
import { REDACTED, assertRecordSafe, intentsRecord, luhnValid, redactAnswer } from "../src/airwallex/intentReadback.js";

/** A made-up signed token, put together here so no scanner reads it as a real one. */
const FAKE_TOKEN = ["eyJ", "mYWtlIjoibWFkZS11cCJ9", ".made", ".up"].join("");
/** A made-up answer in the shape of a PaymentIntent, with everything the redaction must catch. Not Airwallex's. */
const made = () => ({
  id: "int_madeup0001", request_id: "airi-x-1-pi", amount: 12, currency: "EUR", merchant_order_id: "airi-x-1", status: "SUCCEEDED", captured_amount: 12,
  created_at: "2026-11-07T13:56:59+0000", client_secret: FAKE_TOKEN,
  customer: { email: "someone@example.test", first_name: "A", last_name: "B" },
  latest_payment_attempt: {
    id: "att_madeup0001", status: "AUTHORIZED", authorization_code: "A1B2C3", provider_original_response_code: "00", amount: 12,
    payment_method: {
      type: "card",
      card: { brand: "visa", card_type: "credit", bin: "411111", last4: "1111", number_type: "PAN", issuer_country_code: "US", expiry_month: "12", expiry_year: "2030", name: "Somebody Cardholder", fingerprint: "fp_madeup", billing: { address: { city: "Nowhere" } } },
    },
    authentication_data: { ds_data: { version: "2.2.0", eci: "05", cavv: "bWFkZS11cC1jYXZ2LXZhbHVl" }, cvc_result: "Y", avs_result: "U" },
    notes: "paid with 4111 1111 1111 1111 at the page", provider_transaction_id: "100000000000001",
  },
});

const at = (o: unknown, path: string): unknown => path.split(".").reduce<unknown>((v, k) => (v as Record<string, unknown> | undefined)?.[k], o);

describe("an Airwallex answer, redacted where needed and otherwise unedited", () => {
  it("replaces a secret, card data, personal and device data and an authentication value with a marker, and lists each path with its reason", () => {
    const { value, redacted } = redactAnswer(made());
    const why = Object.fromEntries(redacted.map((r) => [r.path, r.why]));
    expect(why).toEqual({
      client_secret: "a secret",
      customer: "personal or device data",
      "latest_payment_attempt.payment_method.card.expiry_month": "card data",
      "latest_payment_attempt.payment_method.card.expiry_year": "card data",
      "latest_payment_attempt.payment_method.card.name": "personal or device data",
      "latest_payment_attempt.payment_method.card.fingerprint": "card data",
      "latest_payment_attempt.payment_method.card.billing": "personal or device data",
      "latest_payment_attempt.authentication_data.ds_data.cavv": "an authentication value",
      "latest_payment_attempt.notes": "a card-like number",
    });
    for (const r of redacted) expect({ path: r.path, marked: String(at(value, r.path)).includes(REDACTED) }).toEqual({ path: r.path, marked: true });
    // The marker says what was there, never the value: a whole object, a text of so many characters.
    expect(at(value, "client_secret")).toBe("[redacted: a secret, 32 characters]");
    expect(at(value, "customer")).toBe("[redacted: personal or device data, an object]");
    expect(at(value, "latest_payment_attempt.authentication_data.ds_data.cavv")).toBe("[redacted: an authentication value, 24 characters]");
    expect(at(value, "latest_payment_attempt.notes")).toBe("paid with [redacted: a card-like number, 16 digits] at the page");
    const text = JSON.stringify(value);
    for (const gone of ["eyJmYWtl", "someone@example.test", "Somebody Cardholder", "fp_madeup", "Nowhere", "bWFkZS11", "4111 1111", "2030"]) expect({ gone, kept: text.includes(gone) }).toEqual({ gone, kept: false });
  });

  it("leaves everything else exactly as returned: ids, status, amounts, the authorisation code, the card's brand, type, first six and last four, the results", () => {
    const raw = made();
    const { value, redacted } = redactAnswer(raw);
    for (const path of ["id", "request_id", "amount", "currency", "status", "captured_amount", "created_at", "latest_payment_attempt.id", "latest_payment_attempt.status", "latest_payment_attempt.authorization_code",
      "latest_payment_attempt.provider_original_response_code", "latest_payment_attempt.payment_method.type", "latest_payment_attempt.payment_method.card.brand", "latest_payment_attempt.payment_method.card.card_type",
      "latest_payment_attempt.payment_method.card.bin", "latest_payment_attempt.payment_method.card.last4", "latest_payment_attempt.payment_method.card.number_type", "latest_payment_attempt.payment_method.card.issuer_country_code",
      "latest_payment_attempt.authentication_data.ds_data.version", "latest_payment_attempt.authentication_data.ds_data.eci", "latest_payment_attempt.authentication_data.cvc_result", "latest_payment_attempt.authentication_data.avs_result",
      // A long number that is not a card number (it fails the card check digit) is an id: kept.
      "latest_payment_attempt.provider_transaction_id"]) expect({ path, same: at(value, path) === at(raw, path) && at(raw, path) !== undefined }).toEqual({ path, same: true });
    // Nothing is added, dropped or renamed: the same keys, in the same order, at every level that was not redacted whole.
    const keys = (v: unknown, p = ""): string[] => (v && typeof v === "object" && !Array.isArray(v) ? Object.entries(v).flatMap(([k, x]) => [`${p}${k}`, ...keys(x, `${p}${k}.`)]) : []);
    const whole = new Set(redacted.map((r) => r.path));
    expect(keys(value)).toEqual(keys(raw).filter((k) => ![...whole].some((w) => k.startsWith(`${w}.`))));
    // The input is not changed.
    expect(raw.client_secret).toBe(FAKE_TOKEN);
    expect(luhnValid("4111111111111111")).toBe(true);
    expect(luhnValid("100000000000001")).toBe(false);
  });

  it("can drop the secrets alone, for a private working copy of an answer; redacting that copy in full lists the secret too", () => {
    const { value, redacted } = redactAnswer(made(), ["a secret"]);
    expect(redacted).toEqual([{ path: "client_secret", why: "a secret" }]);
    expect(JSON.stringify(value)).not.toContain("eyJmYWtl");
    expect(at(value, "latest_payment_attempt.payment_method.card.expiry_year")).toBe("2030");
    // The record is built from that copy: the same value and the same list as redacting the answer in one go.
    const direct = redactAnswer(made()), twice = redactAnswer(value);
    expect(twice.value).toEqual(direct.value);
    expect(twice.redacted).toEqual(direct.redacted);
    expect(redactAnswer(direct.value)).toEqual(direct);
  });

  it("redacts by the same rules inside arrays, and whatever the letter case of a key", () => {
    const { value, redacted } = redactAnswer({ attempts: [{ card: { CVC: "123", last4: "1111" } }, { Client_Secret: "abc" }], Email: "x@example.test" });
    expect(redacted.map((r) => r.path)).toEqual(["attempts.0.card.CVC", "attempts.1.Client_Secret", "Email"]);
    expect(JSON.stringify(value)).not.toMatch(/abc|"123"|example\.test/);
    expect(at(value, "attempts.0.card.last4")).toBe("1111");
  });
});

describe("the record of the read-back", () => {
  const calls = [{ at: "2026-11-12T10:00:00.000Z", method: "POST", endpoint: "/authentication/login", pid: 1 }, { at: "2026-11-12T10:00:01.000Z", method: "GET", endpoint: "/pa/{id}/{id}", pid: 1 }, { at: "2026-11-12T10:00:02.000Z", method: "GET", endpoint: "/pa/{id}/{id}", pid: 1 }];
  const purchases = [{ step: "A", id: "int_madeup0001" }, { step: "B", id: "int_madeup0002" }];
  const answers = { int_madeup0001: made(), int_madeup0002: { ...made(), id: "int_madeup0002", amount: 45 } };
  const build = (over: Partial<Parameters<typeof intentsRecord>[0]> = {}) => intentsRecord({ readAt: new Date("2026-11-12T10:00:03.000Z"), run: "docs/demo/airi-run.json", purchases, answers, calls, budget: 4, ...over });

  it("says how it was read (GET only, the sandbox, test money), holds each PaymentIntent with its redactions, and the calls made out of the budget", () => {
    const rec = build();
    expect(rec).toMatchObject({ read_at: "2026-11-12T10:00:03.000Z", run: "docs/demo/airi-run.json", test_money: true, budget: 4 });
    expect(rec.method).toMatch(/^GET only, Airwallex sandbox: GET \/api\/v1\/pa\/payment_intents\/\{id\}/);
    expect(rec.method).toMatch(/Nothing was created, updated or cancelled/);
    // These calls were logged as /pa/{id}/{id} (the old fold of payment_intents): the record says so; a log written
    // since 12 Nov holds the real path, and the note is not added.
    expect(rec.method).toMatch(/folded the path segment payment_intents as if it were an id/);
    const fixed = calls.map((c) => ({ ...c, endpoint: c.endpoint.replace("/pa/{id}/{id}", "/pa/payment_intents/{id}") }));
    expect(build({ calls: fixed }).method).not.toMatch(/folded/);
    expect(rec.calls).toEqual([{ at: "2026-11-12T10:00:00.000Z", method: "POST", endpoint: "/authentication/login" }, { at: "2026-11-12T10:00:01.000Z", method: "GET", endpoint: "/pa/{id}/{id}" }, { at: "2026-11-12T10:00:02.000Z", method: "GET", endpoint: "/pa/{id}/{id}" }]);
    expect(rec.payment_intents.map((p) => [p.purchase, p.id, p.intent.amount])).toEqual([["A", "int_madeup0001", 12], ["B", "int_madeup0002", 45]]);
    expect(rec.payment_intents[0]!.redacted.map((r) => r.path)).toContain("client_secret");
    expect(() => assertRecordSafe(rec)).not.toThrow();
  });

  it("refuses an answer for another PaymentIntent, more calls than the budget, and any call that is not a login or a GET", () => {
    expect(() => build({ answers: { ...answers, int_madeup0002: { ...made(), id: "int_other" } } })).toThrow(/int_madeup0002/);
    expect(() => build({ budget: 2 })).toThrow(/budget/);
    expect(() => build({ calls: [...calls, { at: "2026-11-12T10:00:02.500Z", method: "POST", endpoint: "/pa/{id}/create", pid: 1 }], budget: 4 })).toThrow(/read-only/);
  });

  it("leaves out a PaymentIntent that could not be read, and says so", () => {
    const rec = build({ answers: { int_madeup0001: made() }, notRead: [{ step: "B", id: "int_madeup0002", why: "HTTP 404" }] });
    expect(rec.payment_intents.map((p) => p.purchase)).toEqual(["A"]);
    expect(rec.not_read).toEqual([{ purchase: "B", id: "int_madeup0002", why: "HTTP 404" }]);
  });

  it("is refused when a secret or a card number is still in it", () => {
    const rec = build();
    const leak = (edit: (r: typeof rec) => void) => { const c = JSON.parse(JSON.stringify(rec)) as typeof rec; edit(c); return c; };
    expect(() => assertRecordSafe(leak((r) => { r.payment_intents[0]!.intent.client_secret = FAKE_TOKEN; }))).toThrow(/client_secret/);
    expect(() => assertRecordSafe(leak((r) => { r.payment_intents[0]!.intent.descriptor = "card 4111111111111111"; }))).toThrow(/card-like/);
    expect(() => assertRecordSafe(leak((r) => { (r.payment_intents[0]!.intent.latest_payment_attempt as Record<string, unknown>).cvc = "123"; }))).toThrow(/cvc/);
  });
});
