// Reading the order the customer's agent signed: Metal's signed offer (an SD-JWT) carrying the x402 checkout.
import { describe, expect, it } from "vitest";
import { orderOf } from "../src/index.js";

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const offer = (checkout: object, nonce: unknown = "n1") =>
  `${b64({ alg: "ES256" })}.${b64({ nonce })}.sig~${b64(["salt", { vct: "mandate.checkout.1", checkout_jwt: `h.${b64(checkout)}.s` }])}~`;

describe("orderOf", () => {
  it("reads the amount, payee (lower-cased), resource and nonce the agent signed", () => {
    expect(orderOf(offer({ amount: "50000000000000000", id: "0x828c7DE12cab8149AA516958433F6EEe23aEC875", extra: { resource: "GET /v1/stock" } })))
      .toEqual({ amount_cents: 5, pay_to: "0x828c7de12cab8149aa516958433f6eee23aec875", resource: "GET /v1/stock", nonce: "n1" });
  });

  it("takes payTo when the checkout has no id, and allows no resource or nonce", () => {
    expect(orderOf(offer({ amount: "100000000000000000", payTo: "0xAB" }, 7))).toEqual({ amount_cents: 10, pay_to: "0xab", resource: null, nonce: null });
  });

  it("reads nothing from no offer, garbage, a sub-cent amount or a checkout without a payee", () => {
    expect(orderOf(null)).toBeNull();
    expect(orderOf("")).toBeNull();
    expect(orderOf("garbage")).toBeNull();
    expect(orderOf(offer({ amount: "1", id: "0xab" }))).toBeNull();
    expect(orderOf(offer({ amount: "50000000000000000" }))).toBeNull();
    expect(orderOf(offer({ amount: "5.0", id: "0xab" }))).toBeNull();
    expect(orderOf(`${b64({ alg: "ES256" })}.${b64({ nonce: "n" })}.sig~${b64(["salt", { vct: "other" }])}~`)).toBeNull();
  });
});
