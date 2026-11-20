// What a kept PaymentIntent answer may hold (src/airwallex/intentReadback.ts redactAnswer), the shapes the main test
// leaves: each marker says what was there (a text of so many characters, a list, an object, a number, null, a
// boolean); a list at the top is walked by index; a secret in a value is redacted only when secrets are asked for,
// and a card-like number only when those are; the card check digit refuses anything that is not a digit.
import { describe, expect, it } from "vitest";
import { luhnValid, redactAnswer } from "../src/airwallex/intentReadback.js";

describe("each marker says what was there", () => {
  it("a text, a list, an object, a number, a boolean; null and absent are left as they are", () => {
    const { value, redacted } = redactAnswer({ customer: { id: "c" }, billing: ["x"], email: "max@example.test", phone: 4930, device: true, address: null, name: undefined });
    expect(value).toEqual({
      customer: "[redacted: personal or device data, an object]", billing: "[redacted: personal or device data, a list]",
      email: "[redacted: personal or device data, 16 characters]", phone: "[redacted: personal or device data, a number]",
      device: "[redacted: personal or device data, a boolean]", address: null, name: undefined,
    });
    expect(redacted.map((r) => r.path)).toEqual(["customer", "billing", "email", "phone", "device"]);
  });
});

describe("lists and the reasons asked for", () => {
  // A token's shape, built here so no token-looking text sits in the source.
  const JWT = ["eyJhbGciOiJIUzI1NiJ9", "eyJzdWIiOiIxIn0", "c2lnbmF0dXJl"].join(".");
  const PAN = "4111 1111 1111 1111";

  it("a list at the top is walked by index", () => {
    const { value, redacted } = redactAnswer([JWT, { note: PAN }]);
    expect(value).toEqual([`[redacted: a secret, ${JWT.length} characters]`, { note: "[redacted: a card-like number, 16 digits]" }]);
    expect(redacted).toEqual([{ path: "0", why: "a secret" }, { path: "1.note", why: "a card-like number" }]);
  });

  it("only the reasons asked for are redacted", () => {
    expect(redactAnswer({ a: JWT, b: PAN }, ["a card-like number"])).toEqual({ value: { a: JWT, b: "[redacted: a card-like number, 16 digits]" }, redacted: [{ path: "b", why: "a card-like number" }] });
    expect(redactAnswer({ a: JWT, b: PAN }, ["a secret"])).toEqual({ value: { a: `[redacted: a secret, ${JWT.length} characters]`, b: PAN }, redacted: [{ path: "a", why: "a secret" }] });
  });

  it("the check digit refuses anything that is not a digit, and nothing at all", () => {
    expect(luhnValid("4111111111111111")).toBe(true);
    expect(luhnValid("4111x11111111111")).toBe(false);
    expect(luhnValid("")).toBe(false);
  });
});
