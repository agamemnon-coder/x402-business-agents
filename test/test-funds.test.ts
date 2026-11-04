// Max, 1 November: test money is scarce (the Metal testnet faucet has a daily limit), so finished dry runs' spare test
// money may fill new test worlds. Only from finished dry-N worlds, never from the reserve world or Thursday's, never
// from the world being filled; each transfer logged with its tx; keys stay where they are; old ledgers untouched.
import { describe, expect, it } from "vitest";
import type { Address, Hex } from "viem";
import { donorWorlds, fundTestWallet, type FundDeps } from "../src/metal/testFunds.js";

const U = (usdz: number) => BigInt(Math.round(usdz * 100)) * 10n ** 16n;
const HOUR = 3_600_000;
const A = (n: number) => `0x${String(n).padStart(40, "0")}` as Address;

function deps(over: Partial<FundDeps> = {}): FundDeps & { sent: [string, Address, bigint][]; logged: string[]; faucets: Address[] } {
  const balances = new Map<string, bigint>([[A(1), 0n], [A(11), U(99.99)], [A(12), U(79.99)], [A(21), U(99.99)], [A(22), U(79.99)]]);
  const sent: [string, Address, bigint][] = [], logged: string[] = [], faucets: Address[] = [];
  const files: Record<string, Address> = { "dry-5/owner-customer.key.json": A(11), "dry-5/owner-business.key.json": A(12), "dry-7/owner-customer.key.json": A(21), "dry-7/owner-business.key.json": A(22) };
  return {
    sent, logged, faucets,
    recycle: true,
    current: "dry-9",
    worlds: () => [{ name: "dry-5", ageMs: 5 * HOUR }, { name: "dry-7", ageMs: 2 * HOUR }, { name: "dry-8", ageMs: 10 * 60_000 }, { name: "live-1", ageMs: 9 * HOUR }, { name: "dry-9", ageMs: 9 * HOUR }, { name: "dry-6", ageMs: null }],
    address: (world, file) => files[`${world}/${file}`] ?? null,
    balance: async (a) => balances.get(a) ?? 0n,
    transfer: async (world, file, to, amount) => { const from = files[`${world}/${file}`]!; balances.set(from, balances.get(from)! - amount); balances.set(to, (balances.get(to) ?? 0n) + amount); sent.push([`${world}/${file}`, to, amount]); return `0x${"ab".repeat(32)}` as Hex; },
    faucet: (a) => { faucets.push(a); balances.set(a, (balances.get(a) ?? 0n) + U(100)); },
    log: (row) => { logged.push(row); },
    ...over,
  };
}

describe("which worlds may give test money", () => {
  it("finished dry-N worlds only (an hour since their ledger last changed), oldest first; never the world being filled, the reserve world or Thursday's", () => {
    const d = deps();
    expect(donorWorlds(d.worlds(), d.current)).toEqual(["dry-5", "dry-7"]);
  });
});

describe("filling a test wallet", () => {
  it("does nothing when the wallet already holds enough", async () => {
    const d = deps({ balance: async () => U(30) });
    expect(await fundTestWallet(A(1), 2500, { label: "owner-business", deps: d })).toBe("enough");
    expect(d.sent).toEqual([]);
  });

  it("with recycling on: takes the shortfall from the oldest finished world's spare wallets, and logs each transfer with its tx", async () => {
    const d = deps();
    expect(await fundTestWallet(A(1), 2500, { label: "owner-business", deps: d })).toBe("recycled");
    expect(d.sent).toEqual([["dry-5/owner-customer.key.json", A(1), U(25)]]);
    expect(d.logged).toHaveLength(1);
    expect(d.logged[0]).toMatch(/dry-5 · owner-customer .* 25\.00 .*0xabab/);
    expect(d.faucets).toEqual([]);
  });

  it("leaves 0.10 in a donor for its own gas, moves on to the next world, and never touches a business owner's key", async () => {
    const d = deps();
    await fundTestWallet(A(1), 15000, { label: "big", deps: d });
    expect(d.sent.map(([f, , a]) => [f, a])).toEqual([["dry-5/owner-customer.key.json", U(99.89)], ["dry-7/owner-customer.key.json", U(50.11)]]);
  });

  it("refuses rather than half-fill when the finished worlds cannot cover it", async () => {
    const d = deps();
    await expect(fundTestWallet(A(1), 100_000, { label: "too much", deps: d })).rejects.toThrow(/not enough spare test money/);
    expect(d.sent).toEqual([]);
  });

  it("moves whole cents only, even when a donor's balance and the shortfall end in fractions of a cent", async () => {
    const odd = U(15.9) - 1_913n; // a donor after paying gas: 15.899999999999998087 *USDZ
    const d = deps({ balance: async (a) => (a === A(11) ? odd : a === A(1) ? 12_345n : a === A(21) ? U(99.99) : 0n) });
    expect(await fundTestWallet(A(1), 2100, { label: "owner-business", deps: d })).toBe("recycled");
    expect(d.sent.map(([, , a]) => a % 10n ** 16n)).toEqual([0n, 0n]);
    expect(d.sent.map(([, , a]) => a)).toEqual([U(15.79), U(5.21)]);
    expect(d.logged.join("\n")).toMatch(/15\.79/);
  });

  it("with recycling off, asks the faucet as before", async () => {
    const d = deps({ recycle: false });
    expect(await fundTestWallet(A(1), 2500, { label: "owner-business", deps: d })).toBe("faucet");
    expect(d.faucets).toEqual([A(1)]);
    expect(d.sent).toEqual([]);
  });
});
