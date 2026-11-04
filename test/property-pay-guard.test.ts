// Hardening plan item 2: the pay guard in src/metal/pay.ts. The CFO policy's limit sees an x402 offer in whole cents
// before anything is signed; the offer's amount is in *USDZ base units (18 decimals, 10^16 per cent) and is rounded UP,
// so an offer of 0.0301 is never taken for 0.03 by a limit. The payment client is replaced by a stand-in that only
// runs the hooks the way @x402/core does (an abort throws "Payment creation aborted: <reason>"), so no network is used.
import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";

type Before = (ctx: { selectedRequirements: { amount: string; payTo: string } }) => Promise<{ abort: true; reason: string } | undefined>;
const offer = vi.hoisted(() => ({ amount: "0", payTo: "0x0000000000000000000000000000000000000001", signed: 0 }));

vi.mock("@metalntwx/metal-pay/mandates", async (importOriginal) => {
  const real = await importOriginal<typeof import("@metalntwx/metal-pay/mandates")>();
  return {
    ...real,
    createMandatePaymentClient: () => {
      const before: Before[] = [];
      return {
        client: { onBeforePaymentCreation: (h: Before) => before.push(h), onAfterPaymentCreation: () => undefined },
        fetchWithPayment: async () => {
          for (const h of before) {
            const r = await h({ selectedRequirements: { amount: offer.amount, payTo: offer.payTo } });
            if (r && r.abort) throw new Error(`Payment creation aborted: ${r.reason}`);
          }
          // Not aborted: the stand-in would sign here. Counted, then the seller answers without asking for payment.
          offer.signed++;
          return new Response("ok", { status: 200 });
        },
      };
    },
  };
});

const { payUnderMandate } = await import("../src/metal/pay.js");
const mandate = { credential: {}, signDigest: async () => "0x" } as unknown as Parameters<typeof payUnderMandate>[0];
const CENT = 10n ** 16n;
const MAX_CENTS = BigInt(Number.MAX_SAFE_INTEGER);

/** What the guard is shown for an offer of `units` base units. */
async function guardSees(units: bigint, cap?: number): Promise<{ seen: number; outcome: Awaited<ReturnType<typeof payUnderMandate>> }> {
  offer.amount = units.toString();
  let seen = -1;
  const outcome = await payUnderMandate(mandate, "https://seller.invalid/x", {}, (cents) => {
    seen = cents;
    return cap !== undefined && cents > cap ? `policy_cap_exceeded: over ${cap}` : null;
  });
  return { seen, outcome };
}

/** Offers near cent boundaries, where rounding goes wrong: k cents exactly, one unit under, one unit over. */
const units = (maxCents: bigint) => fc.oneof(
  fc.bigInt({ min: 0n, max: maxCents * CENT }),
  fc.tuple(fc.bigInt({ min: 0n, max: maxCents }), fc.constantFrom(-1n, 0n, 1n, CENT / 2n, CENT - 1n)).map(([c, d]) => (c * CENT + d < 0n ? 0n : c * CENT + d)),
);

describe("the pay guard rounds an offer up to whole cents (src/metal/pay.ts)", () => {
  // Breaks if the guard is given floor(amount / 10^16) (plain BigInt division), or Math.round of a float: an offer a
  // fraction of a cent over a limit would then pass it.
  it("never rounds a payment down below what is owed, and never adds a whole cent", async () => {
    await fc.assert(fc.asyncProperty(units(MAX_CENTS - 1n), async (u) => {
      const { seen } = await guardSees(u);
      expect(Number.isSafeInteger(seen)).toBe(true);
      expect(BigInt(seen) * CENT >= u).toBe(true); // covers the whole offer
      expect(BigInt(seen - 1) * CENT < u || seen === 0).toBe(true); // and no more than one cent's rounding
    }), { numRuns: 400 });
  });

  // Breaks if the guard's refusal stops being an abort (signing anyway), or if rounding lets k cents + 1 unit pass a
  // cap of k cents.
  it("an offer over the cap by any amount, even one base unit, is refused before anything is signed", async () => {
    await fc.assert(fc.asyncProperty(fc.integer({ min: 0, max: 100_000_000 }), fc.bigInt({ min: 1n, max: 10n ** 20n }), async (cap, over) => {
      const signedBefore = offer.signed;
      const { outcome } = await guardSees(BigInt(cap) * CENT + over, cap);
      expect(outcome.kind).toBe("refused");
      expect(outcome.kind === "refused" && outcome.reason).toMatch(/^policy_cap_exceeded/);
      expect(offer.signed).toBe(signedBefore);
    }), { numRuns: 300 });
  });

  // Breaks if rounding up overshoots (e.g. + 10^16 instead of + 10^16 - 1): an offer of exactly the cap would be refused.
  it("an offer of at most the cap is let through to signing", async () => {
    await fc.assert(fc.asyncProperty(fc.integer({ min: 0, max: 100_000_000 }), fc.bigInt({ min: 0n, max: CENT - 1n }), async (cap, under) => {
      const u = BigInt(cap) * CENT - under;
      fc.pre(u >= 0n);
      const signedBefore = offer.signed;
      const { outcome } = await guardSees(u, cap);
      expect(outcome.kind).toBe("refused"); // the stand-in seller asks for no payment after signing
      expect(offer.signed).toBe(signedBefore + 1);
    }), { numRuns: 300 });
  });

  // HF11 (found by this file): the rounded-up cents were turned into a JS number with Number(...), exact only up to
  // 2^53 cents, so amount = 2^53 * 10^16 + 1 base units was shown to the guard as one cent less than owed. Now an offer
  // too large to count exactly in cents is refused before the guard runs and before anything is signed.
  // Breaks if pay.ts goes back to Number(...) without the size check.
  it("never rounds down over the full range of offers: too large to count is refused unsigned", async () => {
    await fc.assert(fc.asyncProperty(fc.bigInt({ min: 0n, max: 2n ** 80n * CENT }), async (u) => {
      const signedBefore = offer.signed;
      const { seen, outcome } = await guardSees(u);
      if (u > MAX_CENTS * CENT) {
        expect(seen).toBe(-1);
        expect(outcome.kind).toBe("refused");
        expect(offer.signed).toBe(signedBefore);
      } else {
        expect(BigInt(seen) * CENT >= u).toBe(true);
      }
    }), { numRuns: 300, examples: [[2n ** 53n * CENT + 1n], [MAX_CENTS * CENT], [MAX_CENTS * CENT + 1n]] });
  });
});
