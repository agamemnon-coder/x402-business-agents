// The live sources for the hourly reconciliation (src/finance/sources.ts): the chain check confirms a recorded *USDZ
// payment only when the receipt succeeded and carries exactly that transfer, and each source is wired only when its
// credentials are set. The chain client and the Airwallex clients are fakes. No network.
import { encodeAbiParameters, encodeEventTopics, erc20Abi, type Address } from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  receipt: null as unknown,
  cfg: null as null | { clientId: string; apiKey: string },
  issuing: null as unknown,
  transfers: [] as string[],
}));

vi.mock("../src/metal/chain.js", () => ({
  publicClient: () => ({
    getTransactionReceipt: async ({ hash }: { hash: string }) => {
      if (h.receipt === null) throw new Error(`Transaction receipt with hash "${hash}" could not be found`);
      return h.receipt;
    },
  }),
}));
vi.mock("../src/airwallex/client.js", () => ({
  fromEnv: () => h.cfg,
  Airwallex: class { constructor(readonly cfg: unknown) {} },
}));
vi.mock("../src/airwallex/adapter.js", () => ({
  AirwallexRest: class {
    async getTransfer(id: string) {
      h.transfers.push(id);
      return { id, status: "PAID", amountCents: 185_000, currency: "EUR", reference: "BTX-2026-11", fee: "13.47" };
    }
  },
}));
vi.mock("../src/airwallex/issuing.js", () => ({ issuingFromEnv: () => h.issuing }));

const { receiptCarries, reconcileSourcesFromEnv } = await import("../src/finance/sources.js");

const USDZ = "0x000000000000000000000000000000000000B5d5";
const FROM = "0x00000000000000000000000000000000000000b1";
const TO = "0x00000000000000000000000000000000000000aa";
const TX = `0x${"12".repeat(32)}`;
const units = (cents: number) => BigInt(cents) * 10n ** 16n;
const log = (token: string, from: string, to: string, value: bigint) => ({
  address: token, topics: encodeEventTopics({ abi: erc20Abi, eventName: "Transfer", args: { from: from as Address, to: to as Address } }),
  data: encodeAbiParameters([{ type: "uint256" }], [value]), logIndex: 0, blockNumber: 1n, blockHash: `0x${"bb".repeat(32)}`, transactionHash: TX, transactionIndex: 0, removed: false,
});

beforeEach(() => { h.receipt = null; h.cfg = null; h.issuing = null; h.transfers = []; });
afterEach(() => vi.unstubAllEnvs());

describe("receiptCarries", () => {
  it("confirms a receipt carrying exactly this *USDZ transfer, regardless of address case", async () => {
    h.receipt = { status: "success", logs: [log(USDZ.toLowerCase(), FROM, TO, units(5))] };
    // Fails if: the address comparisons become case-sensitive (every live check would report a difference).
    expect(await receiptCarries(TX, FROM.toUpperCase().replace("0X", "0x"), TO, 5)).toBeNull();
  });

  it("reports a transaction the chain does not know", async () => {
    // Fails if: a failed receipt lookup throws or passes instead of being reported.
    expect(await receiptCarries(TX, FROM, TO, 5)).toBe("no such transaction on chain");
  });

  it("reports a transaction that failed on chain", async () => {
    h.receipt = { status: "reverted", logs: [log(USDZ, FROM, TO, units(5))] };
    // Fails if: the status check is removed (a reverted payment would reconcile as paid).
    expect(await receiptCarries(TX, FROM, TO, 5)).toBe("the transaction failed on chain");
  });

  it("reports a receipt whose transfer differs in amount, token, payer or payee", async () => {
    const wrong = `no *USDZ transfer of 0.05 from ${FROM.slice(0, 8)}… to ${TO.slice(0, 8)}… in the receipt`;
    // Fails if: any one of the four filters (amount, token, from, to) is dropped.
    for (const l of [log(USDZ, FROM, TO, units(4)), log("0x00000000000000000000000000000000000000ee", FROM, TO, units(5)), log(USDZ, TO, TO, units(5)), log(USDZ, FROM, FROM, units(5))]) {
      h.receipt = { status: "success", logs: [l] };
      expect(await receiptCarries(TX, FROM, TO, 5)).toBe(wrong);
    }
  });
});

describe("reconcileSourcesFromEnv", () => {
  it("wires no source when no credentials are set", () => {
    vi.stubEnv("METAL_RPC_URL", "");
    // Fails if: a source is wired without its credentials (the reconciliation would call a service it cannot reach).
    expect(reconcileSourcesFromEnv()).toEqual({});
  });

  it("wires Airwallex transfers, card transactions and the chain when each is configured", async () => {
    h.cfg = { clientId: "id", apiKey: "key" };
    const listCardTransactions = vi.fn(async (cardId: string) => [{ cardId, amountCents: 100 }]);
    h.issuing = { rail: { listCardTransactions }, sim: {} };
    vi.stubEnv("METAL_RPC_URL", "http://rpc.test");
    const src = reconcileSourcesFromEnv();
    // Fails if: the transfer source passes more (or other) fields than status, amount and currency.
    expect(await src.transfer!("tr_1")).toEqual({ status: "PAID", amountCents: 185_000, currency: "EUR" });
    expect(h.transfers).toEqual(["tr_1"]);
    // Fails if: card transactions are read for another card.
    expect(await src.cardTransactions!("card_9")).toEqual([{ cardId: "card_9", amountCents: 100 }]);
    // Fails if: the chain source is not the receipt check.
    expect(src.chainTransfer).toBe(receiptCarries);
  });
});
