// x402 version 2 on the wire, as Purser's own servers and buyer send it. Each header is base64 JSON
// (x402's HTTP transport for version 2): the seller's 402 carries PAYMENT-REQUIRED, the buyer's retry carries
// PAYMENT-SIGNATURE, and the seller's answer carries PAYMENT-RESPONSE. Other tests stand the seller's middleware aside;
// here the real middleware serves the offer, and the real x402 client and wrapFetchWithPayment build the payment.
//
// Offline: Metal's facilitator is stood in for /supported (test/support/facilitatorStandIn.ts), the RPC URL points
// nowhere, the seller and supplier listen on 127.0.0.1, and the buyer's seller is a stubbed fetch. The mandate scheme
// is a fake signer, as in test/contract/metal-facilitator.test.ts. Header values are encoded at run time.
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import {
  decodePaymentRequiredHeader, decodePaymentSignatureHeader, encodePaymentRequiredHeader, encodePaymentResponseHeader,
} from "@x402/core/http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LoadedMandate } from "../src/metal/mandate.js";

// Metal's facilitator stood in: building the seller or a supplier asks its /supported.
vi.mock("@x402/core/server", async (orig) => (await import("./support/facilitatorStandIn.js")).standInServer(await orig<typeof import("@x402/core/server")>()));

const h = vi.hoisted(() => ({ signed: 0 }));

// The mandate scheme as a fake signer; the x402 client, its hooks and wrapFetchWithPayment are the real libraries.
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
          const nonce = `0x${(++h.signed).toString(16).padStart(64, "0")}`;
          return { x402Version, payload: { authorization: { nonce, value: req.amount, to: req.payTo }, signature: "0x5161" }, extensions: { "metal-mandate": { ref: "0xref", checkoutMandate: "signed.order" } } };
        },
      };
      const client = new x402Client().register("eip155:63825", scheme as never);
      client.setSpendControls({ allowedAssets: [{ network: "eip155:63825", asset: "0x000000000000000000000000000000000000B5d5" }] } as never);
      return { client, fetchWithPayment: wrapFetchWithPayment((i: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(i, init), client) };
    },
  };
});

const { USDZ } = await import("../src/metal/network.js");
const { SELLER_ROUTE, sellerApp } = await import("../src/servers/seller.js");
const { SUPPLIER_ROUTE, supplierApp } = await import("../src/servers/supplier.js");
const { openDb } = await import("../src/db/open.js");
const { payUnderMandate } = await import("../src/metal/pay.js");

const PAY_TO = "0x00000000000000000000000000000000000000f1";
const servers: Server[] = [];

async function serve(app: { listen: (port: number, host: string) => Server }): Promise<string> {
  const server = app.listen(0, "127.0.0.1");
  servers.push(server);
  await new Promise<void>((r) => server.once("listening", () => r()));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

/** The offer a route serves to a request with no payment, decoded from its PAYMENT-REQUIRED header. */
async function offerOf(url: string) {
  const res = await fetch(url);
  expect(res.status).toBe(402);
  const header = res.headers.get("PAYMENT-REQUIRED");
  expect(header).toBeTruthy();
  return decodePaymentRequiredHeader(header!);
}

function expectExactOnMetal(offer: ReturnType<typeof decodePaymentRequiredHeader>, cents: number) {
  expect(offer.x402Version).toBe(2);
  expect(offer.resource.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\//);
  const a = offer.accepts[0]!;
  expect(a.scheme).toBe("exact");
  expect(a.network).toBe("eip155:63825");
  expect(a.amount).toMatch(/^\d+$/);
  expect(BigInt(a.amount)).toBe(BigInt(cents) * 10n ** 16n);
  expect(a.asset.toLowerCase()).toBe(USDZ.toLowerCase());
  expect(a.payTo).toBe(PAY_TO);
  expect(typeof a.maxTimeoutSeconds).toBe("number");
}

beforeEach(() => { vi.stubEnv("METAL_RPC_URL", "http://127.0.0.1:1"); h.signed = 0; });
afterEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  await Promise.all(servers.splice(0).map((s) => new Promise<void>((r) => s.close(() => r()))));
});

describe("the 402 offer Purser's servers send (PAYMENT-REQUIRED, x402 version 2)", () => {
  it("the seller's mandate route: exact on eip155:63825, in *USDZ, to the seller, asking for the buyer's signed order", async () => {
    // Fails if: the route's scheme, network, payTo or price changes, the asset is not *USDZ, or the offer moves out of
    // the version 2 header (proved red by a temporary payTo change in src/servers/seller.ts).
    const base = await serve(sellerApp({ db: openDb(":memory:"), payTo: PAY_TO, price: () => "0.07", buyUpstream: async () => { throw new Error("must not buy"); } }));
    const offer = await offerOf(`${base}${SELLER_ROUTE}?seq=1`);
    expectExactOnMetal(offer, 7);
    expect(offer.resource.url).toContain(`${SELLER_ROUTE}?seq=1`);
    // Metal's mandate extension: the buyer signs the order (requireSignedOffer), not x402's seller-signed offer.
    expect(offer.accepts[0]!.extra).toMatchObject({ signedOffer: "required", resource: `GET ${SELLER_ROUTE}` });
  });

  it("the supplier's route: exact on eip155:63825, in *USDZ, to the supplier", async () => {
    // Fails if: the supplier's scheme, network, payTo or price changes (proved red by a temporary payTo change in
    // src/servers/supplier.ts).
    const base = await serve(supplierApp({ payTo: PAY_TO, price: () => "0.04" }));
    const offer = await offerOf(`${base}${SUPPLIER_ROUTE}?seq=1`);
    expectExactOnMetal(offer, 4);
    expect(offer.resource.url).toContain(`${SUPPLIER_ROUTE}?seq=1`);
  });

  it("the supplier's unavailable stock check is refused before any offer, even with an X-PAYMENT header (x402 version 1)", async () => {
    // Fails if: the supplier lets an X-PAYMENT header (x402 version 1, which its middleware does not read) past the
    // unavailable check: the request then gets an offer for a stock check it cannot serve.
    const base = await serve(supplierApp({ payTo: PAY_TO, price: () => "0.04", unavailableEvery: 6 }));
    const res = await fetch(`${base}${SUPPLIER_ROUTE}?seq=6`, { headers: { "X-PAYMENT": "e30=" } });
    expect(res.status).toBe(503);
    expect(res.headers.get("PAYMENT-REQUIRED")).toBeNull();
  });
});

describe("the buyer's paid request (PAYMENT-SIGNATURE) and the answer it reads (PAYMENT-RESPONSE)", () => {
  const URL_ = "http://seller.test/v1/stock?seq=1";
  const m = { credential: {}, signDigest: async () => "0x" } as unknown as LoadedMandate;
  const OFFER = {
    x402Version: 2, resource: { url: URL_ },
    accepts: [{ scheme: "exact", network: "eip155:63825", amount: (4n * 10n ** 16n).toString(), asset: "0x000000000000000000000000000000000000B5d5", payTo: PAY_TO, maxTimeoutSeconds: 60, extra: { signedOffer: "required" } }],
  };
  const settleAnswer = (r: { success: boolean; transaction?: string; errorReason?: string }) =>
    encodePaymentResponseHeader({ network: "eip155:63825", payer: "0xpayer", transaction: "", ...r } as never);

  /** A seller: a 402 with OFFER to an unpaid request; `answer` to the paid retry, which it keeps. */
  function seller(answer: () => Response) {
    const retries: Request[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      if (!req.headers.has("PAYMENT-SIGNATURE") && !req.headers.has("X-PAYMENT")) {
        return new Response("{}", { status: 402, headers: { "PAYMENT-REQUIRED": encodePaymentRequiredHeader(OFFER as never) } });
      }
      retries.push(req);
      return answer();
    }));
    return retries;
  }

  it("retries with PAYMENT-SIGNATURE (never X-PAYMENT): version 2, the chosen offer in `accepted`, and reads PAYMENT-RESPONSE", async () => {
    // Fails if: the client sends the version 1 header or another version, `accepted` is not the offer chosen, or
    // payUnderMandate reads the settlement from any header but PAYMENT-RESPONSE (proved red by reading
    // "x-payment-response" in src/metal/pay.ts, and by sending X-PAYMENT for version 2 in @x402/core).
    const retries = seller(() => new Response('{"stock":12}', { status: 200, headers: { "PAYMENT-RESPONSE": settleAnswer({ success: true, transaction: "0x7e" }) } }));
    const r = await payUnderMandate(m, URL_);
    expect(retries).toHaveLength(1);
    const retry = retries[0]!;
    expect(retry.headers.has("X-PAYMENT")).toBe(false);
    const payment = decodePaymentSignatureHeader(retry.headers.get("PAYMENT-SIGNATURE")!);
    expect(payment.x402Version).toBe(2);
    expect(payment.accepted).toEqual(OFFER.accepts[0]);
    expect(payment.resource).toEqual(OFFER.resource);
    expect(r).toMatchObject({ kind: "paid", tx: "0x7e", amount: OFFER.accepts[0]!.amount, payTo: PAY_TO, signedOffer: "signed.order" });
  });

  it("a settlement under the version 1 header alone is not read as paid: the payment stays in doubt", async () => {
    // Fails if: payUnderMandate takes the outcome from X-PAYMENT-RESPONSE (x402 version 1) as well.
    seller(() => new Response("{}", { status: 200, headers: { "X-PAYMENT-RESPONSE": settleAnswer({ success: true, transaction: "0x7e" }) } }));
    expect(await payUnderMandate(m, URL_)).toMatchObject({ kind: "in_doubt", reason: "seller answered 200 without a settlement" });
  });

  it("a settle refusal Metal does not list (the specification's insufficient_funds) is in doubt, never refused", async () => {
    // Fails if: an unknown reason is read as "nothing moved" (refused), which would license paying a second time
    // (proved red by adding insufficient_funds to NOTHING_SETTLED in src/metal/pay.ts).
    seller(() => new Response("", { status: 402, headers: { "PAYMENT-RESPONSE": settleAnswer({ success: false, errorReason: "insufficient_funds" }) } }));
    const r = await payUnderMandate(m, URL_);
    expect(r).toMatchObject({ kind: "in_doubt", reason: "insufficient_funds", nonce: expect.stringMatching(/^0x/) });
    expect(r.kind).not.toBe("refused");
  });
});
