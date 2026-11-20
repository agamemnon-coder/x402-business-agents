// /x402/proof (worker/src/x402.ts), the edges test/x402-endpoint.test.ts leaves: the CORS preflight and other methods
// and paths, a header too long or without its parts, a facilitator that cannot verify, a refusal without a reason, a
// signed payment with no payer, and settlement on with Alta's own facilitator client, which here (no network) cannot
// verify: the nonce is spent, nothing is served.
import Database from "better-sqlite3";
import { encodePaymentSignatureHeader } from "@x402/core/http";
import { describe, expect, it } from "vitest";
import { sqlOver } from "./support/trySign.js";
import { DEFAULT_PAY_TO, NETWORK, PRICE_BASE_UNITS, STAND_IN_LABEL, USDZ_EXTRA, X402Desk, X402_PATH, type Facilitator } from "../worker/src/x402.js";
import { USDZ } from "../src/metal/network.js";

const URL0 = `https://kit11.example${X402_PATH}`;
const requirements = { scheme: "exact", network: NETWORK, asset: USDZ, amount: PRICE_BASE_UNITS, payTo: DEFAULT_PAY_TO, maxTimeoutSeconds: 60, extra: { ...USDZ_EXTRA } };
const header = (o: Record<string, unknown>) => encodePaymentSignatureHeader(o as never);
const signed = (nonce: string, from?: string) => header({ x402Version: 2, accepted: requirements, payload: { signature: "0xsig", authorization: { ...(from ? { from } : {}), to: DEFAULT_PAY_TO, value: PRICE_BASE_UNITS, validAfter: "0", validBefore: "9999999999", nonce } } });
const get = (d: X402Desk, h?: string, init: RequestInit = {}) => d.fetch(new Request(URL0, { ...init, headers: h ? { "payment-signature": h } : {} }));
const errorOf = async (r: Response) => ((await r.json()) as { error?: string }).error;

describe("the x402 endpoint's edges", () => {
  it("answers the CORS preflight, refuses other methods and paths", async () => {
    const d = new X402Desk(sqlOver(new Database(":memory:")));
    const pre = await d.fetch(new Request(URL0, { method: "OPTIONS" }));
    expect(pre.status).toBe(204);
    expect(pre.headers.get("access-control-allow-methods")).toBe("GET, HEAD");
    expect(pre.headers.get("access-control-allow-headers")).toBe("PAYMENT-SIGNATURE");
    const post = await d.fetch(new Request(URL0, { method: "POST", body: "{}" }));
    expect(post.status).toBe(405);
    expect(await errorOf(post)).toBe("method not allowed: GET");
    expect((await d.fetch(new Request("https://kit11.example/x402/other"))).status).toBe(404);
    expect((await get(d, undefined, { method: "HEAD" })).status).toBe(402);
  });

  it("refuses a header over 8 KB, a payment with no accepted requirements or payload, and another x402 version", async () => {
    const d = new X402Desk(sqlOver(new Database(":memory:")));
    expect(await errorOf(await get(d, "x".repeat(8193)))).toBe("the payment header is too long");
    expect(await errorOf(await get(d, header({ x402Version: 2, payload: { standIn: STAND_IN_LABEL, nonce: "nonce-0001" } })))).toBe("the payment names no accepted requirements");
    expect(await errorOf(await get(d, header({ x402Version: 2, accepted: requirements, payload: null })))).toBe("the payment names no accepted requirements");
    expect(await errorOf(await get(d, header({ x402Version: 1, accepted: requirements, payload: { standIn: STAND_IN_LABEL, nonce: "nonce-0002" } })))).toBe("x402Version must be 2");
  });

  it("settlement on: a facilitator that cannot verify, or refuses without a reason, spends the nonce and serves nothing", async () => {
    const db = new Database(":memory:");
    let verify: Facilitator["verify"] = async () => { throw new Error("fetch failed: ECONNREFUSED"); };
    let settle: Facilitator["settle"] = async () => ({ success: false, transaction: "", network: NETWORK });
    const d = new X402Desk(sqlOver(db), { settle: "on", facilitator: async () => ({ verify: (p, r) => verify(p, r), settle: (p, r) => settle(p, r) }) });
    const a = await get(d, signed("nonce-verify-throws"));
    expect(a.status).toBe(402);
    expect(await errorOf(a)).toBe("Alta's facilitator could not verify the payment: fetch failed: ECONNREFUSED");
    verify = async () => ({ isValid: false });
    expect(await errorOf(await get(d, signed("nonce-invalid-no-reason")))).toBe("Alta's facilitator refused the payment: invalid");
    verify = async () => ({ isValid: true });
    expect(await errorOf(await get(d, signed("nonce-settle-no-reason")))).toBe("Alta's facilitator did not settle the payment: unknown");
    // Every one of them is refused, its payer unknown (the authorization named none), and its nonce spent.
    expect(db.prepare("SELECT nonce, payer, status FROM x402_payments ORDER BY nonce").all()).toEqual([
      { nonce: "nonce-invalid-no-reason", payer: null, status: "refused" },
      { nonce: "nonce-settle-no-reason", payer: null, status: "refused" },
      { nonce: "nonce-verify-throws", payer: null, status: "refused" },
    ]);
    expect((await get(d, signed("nonce-verify-throws"))).status).toBe(409);
  });

  it("settlement on with Alta's own facilitator client: no network here, so it cannot verify and nothing is served", async () => {
    const db = new Database(":memory:");
    const d = new X402Desk(sqlOver(db), { settle: " ON ", payTo: "  " });
    expect(d.requirements().payTo).toBe(DEFAULT_PAY_TO);
    const r = await get(d, signed("nonce-real-client", "0x00000000000000000000000000000000000000b1"));
    expect(r.status).toBe(402);
    expect(await errorOf(r)).toMatch(/^Alta's facilitator could not verify the payment: /);
    expect(db.prepare("SELECT payer, status FROM x402_payments").get()).toEqual({ payer: "0x00000000000000000000000000000000000000b1", status: "refused" });
  });
});
