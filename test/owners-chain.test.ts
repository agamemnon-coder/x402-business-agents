// Metal testnet behind the owners call budget. Breaks if any request (a read, a send, a receipt poll, viem's or
// metal-ts's own) reaches the node without being in the log first; if the request over the budget is sent; if signing
// makes a request; if a revert is reported as "unknown reason"; or if a refusal by the node is confused with a request
// that got lost. The node is the in-process stand-in (test/support/fakeMetal.ts); no network.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encodeErrorResult, encodeFunctionData, keccak256, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mandateBindingAbi, readMandateState } from "@metalntwx/metal-pay/mandates";
import { centsToBaseUnits } from "../src/lib/money.js";
import { factoryAbi } from "../src/metal/fourEyes.js";
import { callBudget, OwnersBudgetSpent, readOwnersCalls } from "../src/metal/ownersBudget.js";
import { ChainRefused, isBudgetStop, NodeRefused, NoReceiptYet, ownersChain } from "../src/metal/ownersChain.js";
import { ACCOUNT_FACTORY, PASSKEY_VERIFIER } from "../src/metal/passkeyRelay.js";
import { USDZ } from "../src/metal/network.js";
import { fakeMetal, type FakeMetal } from "./support/fakeMetal.js";

let dir: string;
let file: string;
let node: FakeMetal;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "owners-chain-")); file = join(dir, "calls.jsonl"); node = fakeMetal(); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));
const world = (budget = 50) => ownersChain({ budget: callBudget({ budget, file }), rpc: node.rpc, sleep: async () => {} });
const logged = () => readOwnersCalls(file).map((c) => `${c.step}:${c.method}`);
const sponsor = privateKeyToAccount(generatePrivateKey());
const ACCOUNT = "0x10621289C2BF674Cf35085B155Bb5FEfCE6B04ea" as Address;
const createData = encodeFunctionData({ abi: factoryAbi, functionName: "createAccount", args: [["0x1234"], [1n], 1n] });

describe("every request goes through the budget", () => {
  it("is in the log before the node sees it, under the step it belongs to", async () => {
    const seen: string[] = [];
    const chain = ownersChain({ budget: callBudget({ budget: 9, file }), sleep: async () => {}, rpc: async (a) => { seen.push(`${readOwnersCalls(file).at(-1)?.method} logged before ${a.method} was sent`); return node.rpc(a); } });
    chain.step("setup");
    await chain.hasCode(PASSKEY_VERIFIER);
    await chain.balance(sponsor.address);
    chain.step("propose");
    await chain.nonce(sponsor.address, "pending");
    expect(seen).toEqual(["eth_getCode logged before eth_getCode was sent", "eth_call logged before eth_call was sent", "eth_getTransactionCount logged before eth_getTransactionCount was sent"]);
    expect(logged()).toEqual(["setup:eth_getCode", "setup:eth_call", "propose:eth_getTransactionCount"]);
  });

  it("counts the reads the SDK makes through the viem client too, and answers viem's chain id itself", async () => {
    const chain = world();
    chain.step("status");
    expect(await chain.client.getChainId()).toBe(63825);
    const s = await readMandateState(chain.client, ACCOUNT, `0x${"ab".repeat(32)}`);
    expect(s.boundBlock).toBe(0n);
    expect(node.methods()).toEqual(["eth_call"]);
    expect(logged()).toEqual(["status:eth_call"]);
  });

  it("asks the node itself for the chain id when told to, and counts it", async () => {
    const chain = world();
    chain.step("preflight");
    expect(await chain.chainId()).toBe(63825);
    expect(node.methods()).toEqual(["eth_chainId"]);
    expect(logged()).toEqual(["preflight:eth_chainId"]);
  });

  it("does not send the request that would go over the budget", async () => {
    const chain = world(2);
    await chain.hasCode(PASSKEY_VERIFIER);
    await chain.hasCode(ACCOUNT);
    await expect(chain.balance(sponsor.address)).rejects.toThrow(OwnersBudgetSpent);
    const viaViem = await readMandateState(chain.client, ACCOUNT, `0x${"ab".repeat(32)}`).then(() => null, (e: unknown) => e);
    expect(isBudgetStop(viaViem)).toBe(true);
    expect(node.methods()).toEqual(["eth_getCode", "eth_getCode"]);
    expect(readOwnersCalls(file)).toHaveLength(2);
  });
});

describe("a transaction is signed here, with no request", () => {
  it("an account call: the hash is that of the signed bytes, and the same call signed again is the same transaction", async () => {
    const chain = world();
    const a = await chain.signCall(sponsor, ACCOUNT_FACTORY, createData, { nonce: 3, gas: 600_000n });
    const b = await chain.signCall(sponsor, ACCOUNT_FACTORY, createData, { nonce: 3, gas: 600_000n });
    expect(a).toMatchObject({ tx: keccak256(a.raw), from: sponsor.address, nonce: 3, gas: 600_000n });
    expect(b.tx).toBe(a.tx);
    expect((await chain.signCall(sponsor, ACCOUNT_FACTORY, createData, { nonce: 4, gas: 600_000n })).tx).not.toBe(a.tx);
    expect(node.requests).toEqual([]);
    expect(logged()).toEqual([]);
  });

  it("a *USDZ transfer (Metal's own transaction type, gas in *USDZ): the same, and it lands as a transfer", async () => {
    const chain = world();
    node.balances.set(sponsor.address.toLowerCase(), centsToBaseUnits(500));
    const a = await chain.signTransfer(sponsor, ACCOUNT, centsToBaseUnits(60), { nonce: 0 });
    expect(a.raw.startsWith("0x7f")).toBe(true);
    expect(a).toMatchObject({ tx: keccak256(a.raw), from: sponsor.address, nonce: 0, gas: 200_000n });
    expect((await chain.signTransfer(sponsor, ACCOUNT, centsToBaseUnits(60), { nonce: 0 })).tx).toBe(a.tx);
    expect(node.requests).toEqual([]);
    await chain.nonce(sponsor.address, "pending");
    await chain.broadcast(a);
    expect((await chain.wait(a.tx)).ok).toBe(true);
    expect(node.sent()[0]).toMatchObject({ to: USDZ.toLowerCase(), nonce: 0 });
    expect(await chain.balance(ACCOUNT)).toBe(centsToBaseUnits(60));
  });
});

describe("gas, refusals and receipts", () => {
  it("takes a fifth more gas than the node's estimate", async () => {
    const chain = world();
    expect(await chain.gasFor(sponsor.address, ACCOUNT_FACTORY, createData, "creating the account")).toBe(600_000n);
    expect(node.methods()).toEqual(["eth_estimateGas"]);
  });

  it("refuses to go on when the chain would revert, with the account's own error", async () => {
    const chain = world();
    node.state.reverts.set(ACCOUNT.toLowerCase(), encodeErrorResult({ abi: mandateBindingAbi, errorName: "AlreadyRevoked" }));
    const e = await chain.gasFor(sponsor.address, ACCOUNT, "0xb75c7dc6", "revoking the mandate").then(() => null, (x: unknown) => x);
    expect(e).toBeInstanceOf(ChainRefused);
    expect((e as ChainRefused).message).toBe("the chain would refuse revoking the mandate: AlreadyRevoked(); nothing was sent");
    expect(await chain.why(sponsor.address, ACCOUNT, "0xb75c7dc6")).toBe("AlreadyRevoked()");
    expect(await chain.why(sponsor.address, ACCOUNT_FACTORY, createData)).toBeNull();
  });

  it("does not take a failed request for a refusal by the chain", async () => {
    const chain = world();
    node.state.fail.set("eth_estimateGas", new Error("fetch failed"));
    const e = await chain.gasFor(sponsor.address, ACCOUNT_FACTORY, createData, "creating the account").then(() => null, (x: unknown) => x);
    expect(e).not.toBeInstanceOf(ChainRefused);
    expect((e as Error).message).toMatch(/gas estimate for creating the account failed.*fetch failed.*nothing was sent/);
  });

  it("tells a node that refuses a transaction from a request that got lost, and takes 'already known' as sent", async () => {
    const chain = world();
    const tx = async (nonce: number) => chain.signCall(sponsor, ACCOUNT_FACTORY, createData, { nonce, gas: 600_000n });
    node.state.sendFault = "refuse:insufficient funds for gas * price + value";
    await expect(chain.broadcast(await tx(0))).rejects.toThrow(NodeRefused);
    node.state.sendFault = "drop";
    const lost = await chain.broadcast(await tx(0)).then(() => null, (x: unknown) => x);
    expect(lost).not.toBeInstanceOf(NodeRefused);
    expect((lost as Error).message).toMatch(/fetch failed/);
    await chain.broadcast(await tx(0));
    await expect(chain.broadcast(await tx(0))).resolves.toBeUndefined(); // already known: the node has it
    expect(node.sent()).toHaveLength(1);
  });

  it("reads one receipt per poll: success, a revert, or none yet", async () => {
    const chain = ownersChain({ budget: callBudget({ budget: 50, file }), rpc: node.rpc, sleep: async () => {}, pollsMs: [1, 1, 1] });
    const first = await chain.signCall(sponsor, ACCOUNT_FACTORY, createData, { nonce: 0, gas: 600_000n });
    node.state.receiptAfter = 1;
    await chain.broadcast(first);
    expect(await chain.wait(first.tx)).toEqual({ ok: true, block: 0x18ad1cd, gasUsed: 0x1c6c3bn });
    expect(node.methods().filter((m) => m === "eth_getTransactionReceipt")).toHaveLength(2);

    node.state.reverts.set(ACCOUNT.toLowerCase(), "0x");
    const second = await chain.signCall(sponsor, ACCOUNT, "0xb75c7dc6" as Hex, { nonce: 1, gas: 600_000n });
    await chain.broadcast(second);
    expect((await chain.wait(second.tx)).ok).toBe(false);

    node.state.receiptAfter = Infinity;
    const third = await chain.signCall(sponsor, ACCOUNT_FACTORY, createData, { nonce: 2, gas: 600_000n });
    await chain.broadcast(third);
    const before = readOwnersCalls(file).length;
    await expect(chain.wait(third.tx)).rejects.toThrow(NoReceiptYet);
    expect(readOwnersCalls(file).length - before).toBe(3);
  });
});
