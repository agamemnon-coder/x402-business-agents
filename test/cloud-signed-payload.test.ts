// One check for Purser's signed tokens (<tag>.<base64url JSON>.<HMAC>): the session, the connector access token, the
// try gate's session read, the OAuth client id and the consent form's token all use cloud/src/crypto.ts signedPayload.
import { describe, expect, it } from "vitest";
import { hmacB64u, signedPayload, toB64u } from "../cloud/src/crypto.js";

const SECRET = "s".repeat(32);
const make = async (tag: string, body: unknown, secret = SECRET) => {
  const b = toB64u(new TextEncoder().encode(JSON.stringify(body)));
  return `${tag}.${b}.${await hmacB64u(secret, b)}`;
};

describe("signedPayload", () => {
  it("returns the JSON a token of this tag carries, signed under this secret", async () => {
    expect(await signedPayload(SECRET, "pcs", await make("pcs", { t: "t_x", g: 2 }), Infinity)).toEqual({ t: "t_x", g: 2 });
  });

  it("returns null for another tag, a forged or missing signature, another secret, bad JSON or a token over the limit", async () => {
    const ok = await make("pcf", { b: 1 });
    expect(await signedPayload(SECRET, "pcs", ok, Infinity)).toBeNull();
    expect(await signedPayload(SECRET, "pcf", ok.slice(0, -2) + (ok.endsWith("AA") ? "BB" : "AA"), Infinity)).toBeNull();
    expect(await signedPayload(SECRET, "pcf", ok.split(".").slice(0, 2).join("."), Infinity)).toBeNull();
    expect(await signedPayload("other-secret", "pcf", ok, Infinity)).toBeNull();
    expect(await signedPayload(SECRET, "pcf", ok, ok.length)).toEqual({ b: 1 });
    expect(await signedPayload(SECRET, "pcf", ok, ok.length - 1)).toBeNull();
    const b = toB64u(new TextEncoder().encode("{not json"));
    expect(await signedPayload(SECRET, "pcf", `pcf.${b}.${await hmacB64u(SECRET, b)}`, Infinity)).toBeNull();
  });
});
