// Paying an x402 route under a mandate (src/metal/pay.ts): every outcome is classified the way the facilitator means it,
// so a caller never pays twice. Paid; refused (nothing moved, safe to try again); in doubt (signed and maybe settled:
// look the nonce up, never resend under a new one). The CFO policy guard runs before anything is signed.
//
// The mandate scheme itself (P-256 signing of a real credential) is replaced by a fake scheme that records each
// signature; the x402 client, its hooks and wrapFetchWithPayment are the real libraries, and the seller is a stubbed
// fetch. No network.
import { encodePaymentRequiredHeader, encodePaymentResponseHeader } from "@x402/core/http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LoadedMandate } from "../src/metal/mandate.js";

const h = vi.hoisted(() => ({ signed: [] as { nonce: string; amount: string; payTo: string }[], n: 0 }));

vi.mock("@metalntwx/metal-pay/mandates", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@metalntwx/metal-pay/mandates")>();
  const { x402Client } = await import("@x402/core/client");
  const { wrapFetchWithPayment } = await import("@x402/fetch");
  return {
    ...actual,
    createMandatePaymentClient: () => {
      const scheme = {
        scheme: "exact",
        async createPaymentPayload(x402Version: number, req: { amount: string; payTo: string }) {
          const nonce = `0x${(++h.n).toString(16).padStart(64, "0")}`;
          h.signed.push({ nonce, amount: req.amount, payTo: req.payTo });
          return {
            x402Version,
            payload: { authorization: { nonce, value: req.amount, to: req.payTo }, signature: "0x5161" },
            extensions: { "metal-mandate": { ref: "0xref", checkoutMandate: "signed.offer.jwt" } },
          };
        },
      };
      const client = new x402Client().register("eip155:63825", scheme as never);
      // As the real factory does: only *USDZ may be paid.
      client.setSpendControls({ allowedAssets: [{ network: "eip155:63825", asset: "0x000000000000000000000000000000000000B5d5" }] } as never);
      return { client, fetchWithPayment: wrapFetchWithPayment((i: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(i, init), client) };
    },
  };
});

const { findSettlementByNonce, nothingSettled, payUnderMandate, settlementsTo } = await import("../src/metal/pay.js");

const SELLER = "0x00000000000000000000000000000000000000f1";
const URL_ = "http://seller.test/v1/stock-check";
const m = { credential: {}, signDigest: async () => "0x" } as unknown as LoadedMandate;
const units = (cents: number) => (BigInt(cents) * 10n ** 16n).toString();

function offer(amount: string, error?: string) {
  return encodePaymentRequiredHeader({
    x402Version: 2, resource: { url: URL_ }, ...(error ? { error } : {}),
    accepts: [{ scheme: "exact", network: "eip155:63825", amount, asset: "0x000000000000000000000000000000000000B5d5", payTo: SELLER, maxTimeoutSeconds: 60, extra: {} }],
  } as never);
}
const settled = (r: { success: boolean; transaction?: string; errorReason?: string }) =>
  encodePaymentResponseHeader({ network: "eip155:63825", payer: "0xpayer", transaction: "", ...r } as never);

/** A seller: answers an unpaid request with an offer, and a paid one with `paid()`. Records what it received. */
function seller(paid: () => Response | Promise<Response>, amount = units(4)) {
  const seen: { paid: boolean }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init);
    const isPaid = req.headers.has("PAYMENT-SIGNATURE") || req.headers.has("X-PAYMENT");
    seen.push({ paid: isPaid });
    if (!isPaid) return new Response("{}", { status: 402, headers: { "payment-required": offer(amount) } });
    return paid();
  }));
  return seen;
}

beforeEach(() => { h.signed.length = 0; });
afterEach(() => vi.unstubAllGlobals());

describe("payUnderMandate", () => {
  it("reports a settled payment with its nonce, transaction, signed offer and the offer it answered, paying once", async () => {
    const seen = seller(() => new Response('{"stock":12}', { status: 200, headers: { "payment-response": settled({ success: true, transaction: "0xt1" }) } }));
    const r = await payUnderMandate(m, URL_);
    // Fails if: the paid branch stops carrying tx/nonce/amount/payTo (the sale ledger and the nonce lookup need them).
    expect(r).toEqual({ kind: "paid", status: 200, body: '{"stock":12}', tx: "0xt1", nonce: h.signed[0]!.nonce, signedOffer: "signed.offer.jwt", amount: units(4), payTo: SELLER });
    // Fails if: a paid request is ever sent twice (double payment).
    expect(seen.filter((s) => s.paid)).toHaveLength(1);
    expect(h.signed).toHaveLength(1);
  });

  it("lets the CFO policy guard refuse an offer before anything is signed, and sends no paid request", async () => {
    const seen = seller(() => { throw new Error("must not be reached"); });
    const guard = vi.fn(() => "policy_cap_exceeded: 0.04 is over the sourcing limit of 0.03");
    const r = await payUnderMandate(m, URL_, {}, guard);
    // Fails if: the onBeforePaymentCreation guard is removed or its refusal is not returned as the reason.
    expect(r).toEqual({ kind: "refused", reason: "policy_cap_exceeded: 0.04 is over the sourcing limit of 0.03", status: 0, body: "" });
    expect(guard).toHaveBeenCalledWith(4, SELLER);
    // Fails if: the guard runs after signing instead of before it.
    expect(h.signed).toHaveLength(0);
    expect(seen.filter((s) => s.paid)).toHaveLength(0);
  });

  it("rounds a fractional-cent offer up for the guard, so 0.0301 is not taken for 0.03", async () => {
    seller(() => new Response("", { status: 200 }), (3n * 10n ** 16n + 10n ** 14n).toString());
    const guard = vi.fn((cents: number) => (cents > 3 ? "over 0.03" : null));
    const r = await payUnderMandate(m, URL_, {}, guard);
    // Fails if: the guard's amount is rounded down (truncating division) instead of up.
    expect(guard).toHaveBeenCalledWith(4, SELLER);
    expect(r).toMatchObject({ kind: "refused", reason: "over 0.03" });
    expect(h.signed).toHaveLength(0);
  });

  it("signs when the guard allows the offer", async () => {
    seller(() => new Response("ok", { status: 200, headers: { "payment-response": settled({ success: true, transaction: "0xt2" }) } }));
    const guard = vi.fn(() => null);
    // Fails if: a null guard answer aborts the payment.
    expect(await payUnderMandate(m, URL_, {}, guard)).toMatchObject({ kind: "paid", tx: "0xt2" });
    expect(guard).toHaveBeenCalledOnce();
  });

  it("treats a paid request that fails in transit as in doubt, keyed by its nonce, and does not resend it", async () => {
    const seen = seller(() => { throw new TypeError("socket hang up"); });
    const r = await payUnderMandate(m, URL_);
    // Fails if: a signed-then-failed request is reported as refused (a caller would pay again under a new nonce).
    expect(r).toEqual({ kind: "in_doubt", reason: expect.stringMatching(/socket hang up/), nonce: h.signed[0]!.nonce });
    expect(seen.filter((s) => s.paid)).toHaveLength(1);
    expect(h.signed).toHaveLength(1);
  });

  it("reports a failure before any signature as refused: nothing was signed", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("ECONNREFUSED"); }));
    const r = await payUnderMandate(m, URL_);
    // Fails if: the "no nonce yet" branch is dropped and a dead seller is reported as in doubt (blocking a safe retry).
    expect(r).toEqual({ kind: "refused", reason: "nothing was signed: ECONNREFUSED", status: 0, body: "" });
    expect(h.signed).toHaveLength(0);
  });

  it("reports a 402 after payment as refused with the seller's reason and the nonce used", async () => {
    seller(() => new Response("no", { status: 402, headers: { "payment-required": offer(units(4), "mandate_payee_not_listed") } }));
    const r = await payUnderMandate(m, URL_);
    // Fails if: the 402 + payment-required branch stops reading the facilitator's error.
    expect(r).toEqual({ kind: "refused", reason: "mandate_payee_not_listed", status: 402, body: "no", nonce: h.signed[0]!.nonce });
  });

  it("reports a 402 without an error message as 'payment required'", async () => {
    seller(() => new Response("", { status: 402, headers: { "payment-required": offer(units(4)) } }));
    // Fails if: the fallback reason for a bare 402 is removed.
    expect(await payUnderMandate(m, URL_)).toMatchObject({ kind: "refused", reason: "payment required" });
  });

  it("classifies a failed settlement by whether anything can have moved", async () => {
    const run = async (errorReason: string | undefined) => {
      seller(() => new Response("x", { status: 500, headers: { "payment-response": settled({ success: false, ...(errorReason ? { errorReason } : {}) }) } }));
      return payUnderMandate(m, URL_);
    };
    // Fails if: a mandate refusal (the chain refused the pull) is reported as in doubt.
    expect(await run("mandate_cap_exceeded")).toMatchObject({ kind: "refused", reason: "mandate_cap_exceeded", status: 500 });
    expect(await run("payment_mismatch:amount")).toMatchObject({ kind: "refused", reason: "payment_mismatch:amount" });
    expect(await run("rate_limited")).toMatchObject({ kind: "refused" });
    // Fails if: "nonce used" (this payment may already have been made) is treated as nothing settled.
    expect(await run("mandate_nonce_used")).toMatchObject({ kind: "in_doubt", reason: "mandate_nonce_used", nonce: expect.stringMatching(/^0x/) });
    // Fails if: an unknown settlement failure is treated as safe to pay again.
    expect(await run("facilitator_timeout")).toMatchObject({ kind: "in_doubt", reason: "facilitator_timeout" });
    expect(await run(undefined)).toMatchObject({ kind: "in_doubt", reason: "settlement failed" });
  });

  it("treats a signed payment answered without a settlement as in doubt", async () => {
    seller(() => new Response("oops", { status: 500 }));
    // Fails if: a missing payment-response after signing is read as refused or paid.
    expect(await payUnderMandate(m, URL_)).toEqual({ kind: "in_doubt", reason: "seller answered 500 without a settlement", status: 500, body: "oops", nonce: h.signed[0]!.nonce });
  });

  it("refuses when the seller asked for no payment at all", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("free", { status: 200 })));
    // Fails if: an unpaid 200 is reported as paid (a sale booked without money).
    expect(await payUnderMandate(m, URL_)).toEqual({ kind: "refused", reason: "seller answered 200 and asked for no payment", status: 200, body: "free" });
    expect(h.signed).toHaveLength(0);
  });
});

describe("nothingSettled", () => {
  it("knows which reasons mean nothing moved", () => {
    // Fails if: an absent reason is taken as "nothing settled" (that would license a second payment).
    expect(nothingSettled(undefined)).toBe(false);
    expect(nothingSettled("mandate_budget_spent")).toBe(true);
    expect(nothingSettled("mandate_nonce_used")).toBe(false);
    expect(nothingSettled("payment_reverted")).toBe(true);
    expect(nothingSettled("payment_mismatch:payTo")).toBe(true);
    expect(nothingSettled("something_new")).toBe(false);
  });
});

describe("looking a payment up by its nonce", () => {
  const s = (id: string, settledAt: number) => ({ id, payer: "0xp", payTo: SELLER, amount: "1", transaction: `0x${id}`, settledAt });

  it("pages through the facilitator's settlements, without duplicates at a page boundary", async () => {
    const page1 = Array.from({ length: 500 }, (_, i) => s(`a${i}`, 1000 + i));
    const page2 = [page1[499]!, s("b0", 2000)];
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (u: string) => {
      calls.push(u);
      return new Response(JSON.stringify({ settlements: calls.length === 1 ? page1 : page2 }), { status: 200 });
    }));
    const out = await settlementsTo(SELLER, 1000);
    // Fails if: pagination stops after a full page, or the next page does not start at the last settledAt.
    expect(calls).toHaveLength(2);
    expect(calls[1]).toContain(`since=1499`);
    expect(calls[0]).toContain(`payTo=${SELLER}&since=1000`);
    // Fails if: the de-duplication by id is removed (a settlement would be counted twice).
    expect(out).toHaveLength(501);
  });

  it("throws when the facilitator does not answer OK, rather than reporting nothing settled", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("down", { status: 503 })));
    // Fails if: a failed lookup returns [] (an in-doubt payment would look unpaid and be paid again).
    await expect(settlementsTo(SELLER, 0)).rejects.toThrow("/settlements answered 503");
  });

  it("finds a settlement whose id ends with the nonce, ignoring case and 0x", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ settlements: [s("63825-0xAAAA", 1), s("63825-0xBEEF01", 2)] }), { status: 200 })));
    // Fails if: the lookup is case-sensitive or keeps the 0x prefix.
    expect(await findSettlementByNonce(SELLER, "0xbeef01", 0)).toMatchObject({ id: "63825-0xBEEF01" });
    expect(await findSettlementByNonce(SELLER, "0xcafe", 0)).toBeUndefined();
  });
});
