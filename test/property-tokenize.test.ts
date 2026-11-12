// Property tests for invoice tokens (master list 725; docs/tokenize.md): the discounted price stays within its bounds
// for every face value and discount, the amounts a mint, a financing and a settlement move are conserved on the
// in-memory chain, and any changed field of a record is named by verify, never passed. Each property names the
// production change that would break it.
import fc from "fast-check";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import type { Hex } from "viem";
import { beforeAll, describe, expect, it } from "vitest";
import { invoiceTokenCalls, standInTokenCalls, tokenIdOf, txClient, type OnChainInvoice } from "../src/tokenize/client.js";
import { discountedPrice, financeToken, mintToken, settleToken } from "../src/tokenize/flow.js";
import { localChain } from "../src/tokenize/localChain.js";
import { mintRecord, MintRefused, sha256Bytes, testnetFaceValue, verifyRecord, type ApprovedInvoice } from "../src/tokenize/record.js";
import { centsToBaseUnits } from "../src/lib/money.js";
import { CHAIN_ID } from "../src/metal/network.js";

const RUNS = { numRuns: 300 };
const CENT = centsToBaseUnits(1);
const acct = () => privateKeyToAccount(generatePrivateKey());
/** Face values in whole cents of *USDZ, from one cent to beyond a billion euro, with the edges weighted. */
const faceCents = fc.oneof(fc.integer({ min: 1, max: 100_000_000_000 }), fc.constantFrom(1, 2, 99, 100, 101, 24_000, 999_999));
const bps = fc.integer({ min: 1, max: 9_999 });

describe("discountedPrice", () => {
  it("is never negative, never above the face value, always whole cents, and discounts at least the basis points asked", () => {
    // Breaks if: the rounding goes up instead of down, or the cent truncation is dropped.
    fc.assert(fc.property(faceCents, bps, (c, b) => {
      const face = centsToBaseUnits(c), price = discountedPrice(face, b);
      expect(price >= 0n && price <= face).toBe(true);
      expect(price % CENT).toBe(0n);
      expect((face - price) * 10_000n >= face * BigInt(b)).toBe(true);
      // ...and by less than one cent more than asked.
      expect((face - price) * 10_000n < face * BigInt(b) + CENT * 10_000n).toBe(true);
    }), RUNS);
  });

  it("never pays more for a bigger discount", () => {
    // Breaks if: the discount is applied the wrong way round.
    fc.assert(fc.property(faceCents, bps, bps, (c, a, b) => {
      const face = centsToBaseUnits(c), [lo, hi] = a <= b ? [a, b] : [b, a];
      expect(discountedPrice(face, hi) <= discountedPrice(face, lo)).toBe(true);
    }), RUNS);
  });

  it("refuses a discount of 0, 100 % or more, a negative one or a fraction", () => {
    fc.assert(fc.property(faceCents, fc.oneof(fc.integer({ max: 0 }), fc.integer({ min: 10_000 }), fc.double({ min: 0.01, max: 9_998.99, noInteger: true })), (c, b) => {
      expect(() => discountedPrice(centsToBaseUnits(c), b)).toThrow(/1 to 9999 basis points/);
    }), RUNS);
  });
});

describe("testnetFaceValue", () => {
  it("conserves the invoice amount: the face value times the divisor is the amount, or the mint is refused", () => {
    // Breaks if: a division that is not exact to the cent is rounded instead of refused.
    fc.assert(fc.property(fc.integer({ min: 1, max: 10_000_000_000 }), fc.integer({ min: 1, max: 10_000 }), (amount, div) => {
      if (amount % div !== 0) { expect(() => testnetFaceValue(amount, div)).toThrow(MintRefused); return; }
      expect((testnetFaceValue(amount, div) / CENT) * BigInt(div)).toBe(BigInt(amount));
    }), RUNS);
  });
});

/** An invoice document and its approval, as the ledger would give them: the approval holds the document's own hash. */
function approved(n: number, amountCents: number, day: number): { inv: ApprovedInvoice; document: string } {
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const document = `Invoice INV-${n}\nTotal due EUR ${(amountCents / 100).toFixed(2)}\nDue date: ${day} ${months[n % 12]} 2027\n`;
  return {
    document,
    inv: { proposalId: `P-${String(n).padStart(4, "0")}`, kind: "invoice", termsSha256: sha256Bytes(`terms ${n} ${amountCents}`), invoiceNo: `INV-${n}`, vendor: "Test Supplier GmbH (test)",
      amountCents, currency: "EUR", documentSha256: sha256Bytes(document), approver: "passkey", approvedAt: "2026-11-12T10:00:00Z", status: "APPROVED" },
  };
}

describe("a record, tampered", () => {
  const FIELDS = ["documentHash", "termsHash", "amountMinor", "currency", "faceValue", "dueDate", "debtorRef", "creditorRef", "payer"] as const;
  const salt = Buffer.alloc(32, 3);
  const creditor = acct().address, payer = acct().address;

  it("is always refused by verify, which names exactly the changed field", () => {
    // Breaks if: verify stops comparing a field, or compares it loosely.
    fc.assert(fc.property(fc.integer({ min: 1, max: 9_999 }), fc.integer({ min: 1, max: 1_000_000_000 }), fc.integer({ min: 1, max: 28 }), fc.constantFrom(...FIELDS), fc.integer({ min: 1, max: 255 }),
      (n, amount, day, field, k) => {
        const { inv, document } = approved(n, amount, day);
        const r = mintRecord(inv, { document, creditor, payer, salt, debtorName: "Northwind Outdoor (test)", faceValue: centsToBaseUnits(amount) });
        expect(verifyRecord(r, r)).toEqual([]);
        const hex = (h: string) => `0x${(BigInt(h) ^ BigInt(k)).toString(16).padStart(h.length - 2, "0")}` as Hex;
        const changed: OnChainInvoice = { ...r, [field]: typeof r[field] === "bigint" ? (r[field] as bigint) + BigInt(k) : hex(r[field] as string) };
        expect(verifyRecord(changed, r).map((m) => m.split(":")[0])).toEqual([field]);
      }), RUNS);
  });

  it("refuses to mint for any document but the one the CFO approved", () => {
    // Breaks if: mintRecord stops hashing the document it is given.
    fc.assert(fc.property(fc.integer({ min: 1, max: 9_999 }), fc.integer({ min: 1, max: 1_000_000_000 }), fc.string({ minLength: 1, maxLength: 20 }), (n, amount, extra) => {
      const { inv, document } = approved(n, amount, 15);
      expect(() => mintRecord(inv, { document: document + extra, creditor, payer, salt, debtorName: "x", faceValue: 1n })).toThrow(MintRefused);
    }), RUNS);
  });
});

describe("mint, finance and settle on the in-memory chain conserve the money", () => {
  let w: Awaited<ReturnType<typeof world>>;
  async function world() {
    const chain = await localChain();
    const c = txClient({ request: chain.request, chainId: CHAIN_ID, sleep: async () => {} });
    const calls = invoiceTokenCalls(c), usd = standInTokenCalls(c);
    const [issuer, creditor, financier, payer] = [acct(), acct(), acct(), acct()] as PrivateKeyAccount[];
    const settlement = await usd.deploy(issuer!);
    for (const who of [financier!, payer!]) await usd.mint(issuer!, settlement, who.address, centsToBaseUnits(100_000_000));
    const { address: contract } = await calls.deploy(issuer!, settlement);
    return { calls, issuer: issuer!, creditor: creditor!, financier: financier!, payer: payer!, settlement, contract };
  }
  beforeAll(async () => { w = await world(); }, 120_000);
  let n = 0;

  it("for any face value and discount: the creditor gets the price, the financier the difference, the payer pays the face value once, and nothing is created or lost", async () => {
    // Breaks if: the contract pays the price or the face value to the wrong party, takes a fee, or settles twice.
    await fc.assert(fc.asyncProperty(fc.integer({ min: 1, max: 5_000_000 }), bps, async (cents, b) => {
      const { inv, document } = approved(++n, cents, 20);
      const face = centsToBaseUnits(cents), price = discountedPrice(face, b);
      const record = mintRecord(inv, { document, creditor: w.creditor.address, payer: w.payer.address, salt: Buffer.alloc(32, 5), debtorName: "Northwind Outdoor (test)", faceValue: face });
      const bal = async () => Promise.all([w.creditor, w.financier, w.payer].map((a) => w.calls.balanceOf(w.settlement, a.address)));
      const [c0, f0, p0] = await bal();
      const { tokenId } = await mintToken(w.calls, w.issuer, w.contract, w.creditor.address, record);
      expect(tokenId).toBe(tokenIdOf(record.documentHash));
      if (price > 0n) await financeToken(w.calls, { creditor: w.creditor, financier: w.financier }, w.contract, w.settlement, tokenId, price);
      await settleToken(w.calls, w.payer, w.contract, w.settlement, tokenId, face);
      const [c1, f1, p1] = await bal();
      if (price > 0n) {
        expect(c1! - c0!).toBe(price);
        expect(f1! - f0!).toBe(face - price);
      } else {
        expect(c1! - c0!).toBe(face); // not financed: the creditor still holds the token and is paid the face value
      }
      expect(p0! - p1!).toBe(face);
      expect(c1! + f1! + p1!).toBe(c0! + f0! + p0!);
      expect(await w.calls.simulate(w.payer.address, w.contract, w.calls.settleData(tokenId))).toBe("AlreadySettled");
    }), { numRuns: 4 });
  }, 240_000);
});
