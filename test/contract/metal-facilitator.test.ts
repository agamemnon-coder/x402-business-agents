// Contract tests for Alta's x402 facilitator as Purser meets it: every refusal reason Alta documents, classified the
// way the facilitator means it (refused: nothing moved, safe to try again; in doubt: maybe moved, looked up by its
// nonce, never paid a second way), plus the facilitator's own errors (/supported, /settlements, 429, clearing pauses).
// Offline: the seller is a stubbed fetch and the mandate scheme a fake signer, as in test/metal-pay.test.ts.
//
// Sources:
//   [FAC]   https://docs.metalntwx.com/agents/facilitator (endpoints, limits, "Refusal reasons", read 2 November 2026)
//   [PAY]   @metalntwx/metal-pay 0.3.4 REFUSALS (node_modules/@metalntwx/metal-pay/dist/mandates/binding.js): the
//           x402 reason for each Mandate Binding refusal
//   [RUN-S1] docs/runs/2026-10-29-s1.md (the price rise refused mandate_cap_exceeded; the old credential mandate_revoked)
//   [RUN-CLEARING] docs/runs/2026-10-29-clearing.md (between_epochs around each epoch close)
import { encodePaymentRequiredHeader, encodePaymentResponseHeader } from "@x402/core/http";
import { REFUSALS } from "@metalntwx/metal-pay/mandates";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LoadedMandate } from "../../src/metal/mandate.js";

const h = vi.hoisted(() => ({ signed: 0 }));

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
          return { x402Version, payload: { authorization: { nonce, value: req.amount, to: req.payTo }, signature: "0x5161" }, extensions: { "metal-mandate": { ref: "0xref", checkoutMandate: "signed.offer.jwt" } } };
        },
      };
      const client = new x402Client().register("eip155:63825", scheme as never);
      // As the real factory does: only *USDZ may be paid.
      client.setSpendControls({ allowedAssets: [{ network: "eip155:63825", asset: "0x000000000000000000000000000000000000B5d5" }] } as never);
      return { client, fetchWithPayment: wrapFetchWithPayment((i: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(i, init), client) };
    },
  };
});

const { findSettlementByNonce, nothingSettled, payUnderMandate } = await import("../../src/metal/pay.js");
const { betweenEpochs, outcomeUnknown } = await import("../../src/metal/clearing.js");
const { refusalWords: feedWords } = await import("../../src/dashboard/snapshot.js");
const { refusalWords: towerWords } = await import("../../src/dashboard/tower.js");

const SELLER = "0x00000000000000000000000000000000000000f1";
const URL_ = "http://seller.test/v1/stock-check";
const m = { credential: {}, signDigest: async () => "0x" } as unknown as LoadedMandate;
const offer = (error?: string) => encodePaymentRequiredHeader({
  x402Version: 2, resource: { url: URL_ }, ...(error ? { error } : {}),
  accepts: [{ scheme: "exact", network: "eip155:63825", amount: (4n * 10n ** 16n).toString(), asset: "0x000000000000000000000000000000000000B5d5", payTo: SELLER, maxTimeoutSeconds: 60, extra: {} }],
} as never);

/** A seller whose facilitator answered /settle with `errorReason` (the middleware passes it on in payment-response). */
function settleFails(errorReason: string, status = 402) {
  const paid: number[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init);
    if (!req.headers.has("PAYMENT-SIGNATURE") && !req.headers.has("X-PAYMENT")) return new Response("{}", { status: 402, headers: { "payment-required": offer() } });
    paid.push(1);
    return new Response("", { status, headers: { "payment-response": encodePaymentResponseHeader({ success: false, errorReason, network: "eip155:63825", payer: "0xpayer", transaction: "" } as never) } });
  }));
  return paid;
}

beforeEach(() => { h.signed = 0; });
afterEach(() => vi.unstubAllGlobals());

// [FAC] "Refusal reasons": what each means. Nothing moved -> refused; may have moved (or did) -> in doubt.
const NOTHING_MOVED = [
  "unsupported_network", "unsupported_scheme", "unsupported_asset", "unsupported_x402_version", // the offer asks for something it does not settle
  "invalid_payload", "payment_mismatch:amount", "payment_mismatch:payTo", "bad_signature", "authorization_window",
  "rpc_unreachable", "rate_limited", "daily_limit_reached", // "Nothing moved. Retry later."
  "payment_failed", "payment_reverted", // "The transfer reverted or was never sent … The payer signs a new one."
  "recipient_refuses", // "Nothing was sent."
];
const MAY_HAVE_MOVED = [
  "already_settled", // "This payment settled before … treat it as paid once."
  "nonce_already_used", // "The payer used this authorization elsewhere."
  "payment_in_flight", // "Another request is settling this payment."
  "payment_quarantined", // "The authorization is spent and the payee was not paid": the money left, to escrow.
  "settlement_in_doubt", // "The transfer may have been sent … never sent a second time."
  "transfer_would_fail", // "balance, or a used nonce": read conservatively, a used nonce may be this payment's own.
  "invalid_clearing_payment", "payment_already_used", // clearing receipts: never a second payment
];

describe("contract: Alta facilitator refusal reasons [FAC]", () => {
  for (const reason of NOTHING_MOVED) {
    it(`${reason}: refused, nothing moved, paid once at most`, async () => {
      const paid = settleFails(reason);
      expect(await payUnderMandate(m, URL_)).toMatchObject({ kind: "refused", reason });
      expect(paid).toHaveLength(1);
    });
  }
  for (const reason of MAY_HAVE_MOVED) {
    it(`${reason}: in doubt (looked up by its nonce), never 'refused', never resent`, async () => {
      const paid = settleFails(reason);
      const r = await payUnderMandate(m, URL_);
      expect(r).toMatchObject({ kind: "in_doubt", reason, nonce: expect.stringMatching(/^0x/) });
      expect(paid).toHaveLength(1);
    });
  }
});

describe("contract: mandate refusals (mandate_*) [FAC, PAY, RUN-S1]", () => {
  const reasons = Object.values(REFUSALS).map((r) => r.reason);

  it("Alta 0.3.4 names these eleven reasons", () => {
    expect(reasons.sort()).toEqual([
      "mandate_bad_signature", "mandate_budget_spent", "mandate_cap_exceeded", "mandate_expired", "mandate_nonce_used", "mandate_not_bound",
      "mandate_occurrences_used", "mandate_outside_recurrence", "mandate_outside_window", "mandate_payee_not_listed", "mandate_revoked",
    ]);
  });

  for (const reason of ["mandate_cap_exceeded", "mandate_revoked", "mandate_expired", "mandate_budget_spent", "mandate_payee_not_listed", "mandate_not_bound"]) {
    it(`${reason} from /settle is a refusal: nothing moved, safe to try again (the account refused it on chain)`, async () => {
      settleFails(reason);
      expect(await payUnderMandate(m, URL_)).toMatchObject({ kind: "refused", reason });
      expect(nothingSettled(reason)).toBe(true);
    });
  }

  it("mandate_nonce_used is in doubt: this very payment may already have been made", () => {
    expect(nothingSettled("mandate_nonce_used")).toBe(false);
  });

  it("a mandate refusal passed on in the seller's 402 is a refusal with the nonce used", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      const paidReq = req.headers.has("PAYMENT-SIGNATURE") || req.headers.has("X-PAYMENT");
      return new Response("{}", { status: 402, headers: { "payment-required": offer(paidReq ? "mandate_revoked" : undefined) } });
    }));
    expect(await payUnderMandate(m, URL_)).toMatchObject({ kind: "refused", reason: "mandate_revoked", status: 402, nonce: expect.stringMatching(/^0x/) });
  });

  it("the CFO's pages say every mandate refusal in words (the feed and the control tower)", () => {
    for (const reason of reasons) {
      expect(feedWords(reason), reason).not.toBe(reason);
      expect(towerWords(reason), reason).not.toBe(reason);
    }
    // With the detail Purser adds (src/policy/holds.ts), as recorded in [RUN-S1].
    expect(feedWords("mandate_cap_exceeded: 0.04 is over the sourcing mandate's 0.03 a payment")).toMatch(/^over the mandate's per-payment cap \(0\.04/);
  });
});

describe("contract: the facilitator's own errors [FAC]", () => {
  it("GET /settlements answering 429 rate_limited is an error, never 'not settled' (which would license paying again)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "rate_limited" }), { status: 429 })));
    await expect(findSettlementByNonce(SELLER, "0x01", 0)).rejects.toThrow();
  });

  it("GET /settlements: the documented row shape is read, and a nonce is matched by the payment id it ends with", async () => {
    const nonce = `0x${"ab".repeat(32)}`;
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ settlements: [
      { id: `exact:${nonce.slice(2)}`, network: "eip155:63825", scheme: "exact", payer: "0xp", payTo: SELLER, amount: "40000000000000000", transaction: "0xtx", settledAt: 1791224477542 },
    ] }), { status: 200 })));
    expect(await findSettlementByNonce(SELLER, nonce, 0)).toMatchObject({ transaction: "0xtx", amount: "40000000000000000" });
  });

  it("GET /supported: an error answer throws; a list without clearing on testnet is 'none'; another asset is refused", async () => {
    const load = async () => { vi.resetModules(); return (await import("../../src/metal/clearing.js")).clearingDeployment; };
    let dep = await load();
    await expect(dep((async () => new Response("", { status: 503 })) as typeof fetch)).rejects.toThrow(/503/);
    dep = await load();
    expect(await dep((async () => new Response(JSON.stringify({ kinds: [{ scheme: "exact", network: "eip155:63825" }] }))) as typeof fetch)).toBeNull();
    dep = await load();
    const other = { kinds: [{ scheme: "bajillion", network: "eip155:63825", extra: { settlement: "0x01", asset: "0x0000000000000000000000000000000000000bad", serviceUrl: "https://c" } }] };
    await expect(dep((async () => new Response(JSON.stringify(other))) as typeof fetch)).rejects.toThrow(/not \*USDZ/);
  });

  it("clearing: a refusal around an epoch close (between_epochs) is recognised as 'nothing paid, send again' [RUN-CLEARING]", () => {
    expect(betweenEpochs(Object.assign(new Error("payment refused"), { cause: { reason: "between_epochs" } }))).toBe(true);
    expect(betweenEpochs(new Error("refused: between epochs"))).toBe(true);
    expect(betweenEpochs(new Error("insufficient deposit"))).toBe(false);
  });

  it("clearing: a lost answer is 'outcome unknown', held for a resend of the same request, never paid another way", () => {
    expect(outcomeUnknown(new Error("x", { cause: new Error("the outcome is unknown; send the same request again") }))).toBe(true);
    expect(outcomeUnknown(new Error("insufficient_deposit"))).toBe(false);
  });
});
