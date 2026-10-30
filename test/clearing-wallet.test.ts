// Metal clearing, the money side (src/metal/clearing.ts): which deployment is used, deposits and withdrawals go to the
// right accounts with the right amounts, nothing moves when the facilitator offers no deployment (or one holding
// another asset), and the clearing wallet is always closed again. metal-pay's custody calls and the wallet are fakes;
// the facilitator's /supported list is a stubbed fetch. No network.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { privateKeyToAccount } from "viem/accounts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  dir: "",
  closed: [] as string[],
  opened: [] as string[],
  depositToClearing: (() => {}) as unknown as import("vitest").Mock,
  withdrawFromClearing: (() => {}) as unknown as import("vitest").Mock,
  clearingSpendable: (() => {}) as unknown as import("vitest").Mock,
  createClearingClient: (() => {}) as unknown as import("vitest").Mock,
}));

vi.mock("@metalntwx/metal-pay", () => ({
  depositToClearing: (...a: unknown[]) => h.depositToClearing(...a),
  withdrawFromClearing: (...a: unknown[]) => h.withdrawFromClearing(...a),
  clearingSpendable: (...a: unknown[]) => h.clearingSpendable(...a),
  createClearingClient: (...a: unknown[]) => h.createClearingClient(...a),
}));
vi.mock("@metalntwx/metal-pay/node", () => ({
  openClearingWallet: async (dir: string) => {
    h.opened.push(dir);
    const party = dir.endsWith("clearing-seller") ? "seller" : "customer";
    return { signer: { publicKey: `0x03${party === "seller" ? "5e" : "c0"}`, sign: () => "0x" }, store: { party }, close: async () => { h.closed.push(dir); } };
  },
}));
vi.mock("../src/metal/agentCli.js", () => ({ keyPath: (name: string) => join(h.dir, name) }));

const USDZ = "0x000000000000000000000000000000000000B5d5";
const SETTLEMENT = "0x00000000000000000000000000000000000c1ea4";
const PAYER_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const GAS_KEY = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a";

type Clearing = typeof import("../src/metal/clearing.js");
let c: Clearing;

function supported(kinds: unknown[], status = 200) {
  const f = vi.fn(async () => new Response(JSON.stringify({ kinds }), { status }));
  vi.stubGlobal("fetch", f);
  return f;
}
const bajillion = (extra: Record<string, string>) => ({ scheme: "bajillion", network: "eip155:63825", extra });
const deployment = { settlement: SETTLEMENT, asset: USDZ, serviceUrl: "https://clearing.test" };

beforeEach(async () => {
  h.dir = mkdtempSync(join(tmpdir(), "clearing-keys-"));
  writeFileSync(join(h.dir, "customer-clearing.key.json"), JSON.stringify({ privateKey: PAYER_KEY }));
  writeFileSync(join(h.dir, "gas.key.json"), JSON.stringify({ privateKey: GAS_KEY }));
  h.closed.length = 0;
  h.opened.length = 0;
  h.depositToClearing = vi.fn(async () => ({ approveTx: "0xa1", depositTx: "0xd1" }));
  h.withdrawFromClearing = vi.fn(async () => ({ requested: "0xw1" }));
  h.clearingSpendable = vi.fn(async () => 465n * 10n ** 16n);
  h.createClearingClient = vi.fn(() => ({ fake: "client" }));
  vi.stubEnv("METAL_RPC_URL", "http://rpc.test");
  // The deployment is cached per process; each test starts from a fresh module.
  vi.resetModules();
  c = await import("../src/metal/clearing.js");
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("the clearing deployment", () => {
  it("is read from the facilitator's /supported list and cached", async () => {
    const f = supported([{ scheme: "exact", network: "eip155:63825" }, bajillion({ ...deployment, other: "x" })]);
    expect(await c.clearingDeployment()).toEqual(deployment);
    expect(await c.clearingDeployment()).toEqual(deployment);
    // Fails if: the cache is removed (each payment would hit /supported).
    expect(f).toHaveBeenCalledOnce();
  });

  it("uses an injected fetcher", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ kinds: [bajillion(deployment)] })));
    // Fails if: the fetcher parameter is ignored.
    expect(await c.clearingDeployment(fetcher as never)).toEqual(deployment);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("is null when the facilitator offers none, or one on another network, or an incomplete one", async () => {
    supported([bajillion({ settlement: SETTLEMENT, asset: USDZ }), { ...bajillion(deployment), network: "eip155:1" }]);
    // Fails if: a deployment without a serviceUrl, or on another chain, is accepted.
    expect(await c.clearingDeployment()).toBeNull();
  });

  it("refuses a deployment that holds another asset than *USDZ", async () => {
    supported([bajillion({ ...deployment, asset: "0x00000000000000000000000000000000000000ee" })]);
    // Fails if: the asset check is removed (Summit would deposit into a deployment for another token).
    await expect(c.clearingDeployment()).rejects.toThrow(/not \*USDZ/);
  });

  it("matches *USDZ regardless of address case", async () => {
    supported([bajillion({ ...deployment, asset: USDZ.toLowerCase() })]);
    // Fails if: the asset comparison becomes case-sensitive.
    expect(await c.clearingDeployment()).toMatchObject({ asset: USDZ.toLowerCase() });
  });

  it("throws when /supported does not answer OK", async () => {
    supported([], 502);
    // Fails if: a failed /supported read is taken as "no deployment" or as a deployment.
    await expect(c.clearingDeployment()).rejects.toThrow("the facilitator's /supported answered 502");
  });
});

describe("deposits, balances and withdrawals", () => {
  it("deposits the exact amount from Summit's payer key into its clearing account, and closes the wallet", async () => {
    supported([bajillion(deployment)]);
    const r = await c.depositCustomer(5n * 10n ** 18n);
    expect(r).toEqual({ approveTx: "0xa1", depositTx: "0xd1", account: "0x03c0" });
    const arg = h.depositToClearing.mock.calls[0]![0] as Record<string, unknown> & { from: { address: string } };
    // Fails if: the amount, the clearing account, the settlement contract or the paying key change.
    expect(arg).toMatchObject({ rpcUrl: "http://rpc.test", chainId: 63825, settlement: SETTLEMENT, asset: USDZ, account: "0x03c0", amount: 5n * 10n ** 18n });
    expect(arg.from.address).toBe(privateKeyToAccount(PAYER_KEY).address);
    expect(h.opened).toEqual([join(h.dir, "clearing-customer")]);
    // Fails if: the wallet is not closed (the next process could not open its receipt journal).
    expect(h.closed).toEqual([join(h.dir, "clearing-customer")]);
  });

  it("closes the wallet even when the deposit fails", async () => {
    supported([bajillion(deployment)]);
    h.depositToClearing = vi.fn(async () => { throw new Error("insufficient funds for gas"); });
    await expect(c.depositCustomer(1n)).rejects.toThrow("insufficient funds for gas");
    // Fails if: the try/finally around the deposit is removed.
    expect(h.closed).toEqual([join(h.dir, "clearing-customer")]);
  });

  it("moves nothing and opens no wallet when the facilitator offers no deployment", async () => {
    supported([]);
    // Fails if: need() stops refusing a missing deployment before any custody call.
    await expect(c.depositCustomer(1n)).rejects.toThrow("offers no clearing deployment");
    await expect(c.withdrawSeller("0x00000000000000000000000000000000000000aa", join(h.dir, "gas.key.json"))).rejects.toThrow("offers no clearing deployment");
    expect(h.depositToClearing).not.toHaveBeenCalled();
    expect(h.withdrawFromClearing).not.toHaveBeenCalled();
    expect(h.opened).toEqual([]);
  });

  it("reads a party's spendable balance from the service for that party's account", async () => {
    supported([bajillion(deployment)]);
    // Fails if: spendable reads another party's account or another service.
    expect(await c.spendable("seller")).toEqual({ account: "0x035e", units: 465n * 10n ** 16n });
    expect(h.clearingSpendable).toHaveBeenCalledWith({ rpcUrl: "http://rpc.test", settlement: SETTLEMENT, serviceUrl: "https://clearing.test", account: "0x035e" });
    expect(h.closed).toEqual([join(h.dir, "clearing-seller")]);
  });

  it("withdraws the seller's earnings to the given destination, gas paid by the given key", async () => {
    supported([bajillion(deployment)]);
    const dest = "0x00000000000000000000000000000000000000aa";
    expect(await c.withdrawSeller(dest, join(h.dir, "gas.key.json"))).toEqual({ requested: "0xw1" });
    const arg = h.withdrawFromClearing.mock.calls[0]![0] as Record<string, unknown> & { from: { address: string }; signer: { publicKey: string } };
    // Fails if: the destination or the signing wallet change (earnings would go elsewhere).
    expect(arg).toMatchObject({ destination: dest, settlement: SETTLEMENT, serviceUrl: "https://clearing.test", chainId: 63825 });
    expect(arg.signer.publicKey).toBe("0x035e");
    expect(arg.from.address).toBe(privateKeyToAccount(GAS_KEY).address);
    expect(h.closed).toEqual([join(h.dir, "clearing-seller")]);
  });

  it("closes the seller wallet even when the withdrawal fails", async () => {
    supported([bajillion(deployment)]);
    h.withdrawFromClearing = vi.fn(async () => { throw new Error("epoch not final"); });
    await expect(c.withdrawSeller("0x00000000000000000000000000000000000000aa", join(h.dir, "gas.key.json"))).rejects.toThrow("epoch not final");
    // Fails if: the try/finally around the withdrawal is removed.
    expect(h.closed).toEqual([join(h.dir, "clearing-seller")]);
  });

  it("builds Summit's clearing payer with the per-request ceiling, leaving the wallet open for the caller", async () => {
    supported([bajillion(deployment)]);
    const { client, wallet } = await c.customerClearingClient(7n * 10n ** 16n);
    expect(client).toEqual({ fake: "client" });
    // Fails if: maxAmount is dropped (a seller could charge any amount per request).
    expect(h.createClearingClient).toHaveBeenCalledWith(expect.objectContaining({ maxAmount: 7n * 10n ** 16n, network: "eip155:63825", settlement: SETTLEMENT, asset: USDZ, serviceUrl: "https://clearing.test", store: { party: "customer" } }));
    expect(wallet.signer.publicKey).toBe("0x03c0");
    expect(h.closed).toEqual([]);
  });
});
