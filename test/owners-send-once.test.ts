// Nothing on the owners path is sent twice. Every send records its hash in the ledger before the transaction leaves,
// and a run after a crash carries on from that hash. Breaks if a transaction leaves before its hash is recorded; if a
// re-run signs or sends a second transaction while the first may still land; if a re-run does nothing for a
// transaction that never reached a node (it sends the identical one again: same nonce, same hash); or if a step that
// is done costs a call. The chain is the in-process stand-in; no network.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encodeFunctionData, type Address } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb, type DB } from "../src/db/open.js";
import { centsToBaseUnits } from "../src/lib/money.js";
import { factoryAbi } from "../src/metal/fourEyes.js";
import { callBudget, OwnersBudgetSpent, readOwnersCalls } from "../src/metal/ownersBudget.js";
import { NodeRefused, NoReceiptYet, ownersChain, type OwnersChain } from "../src/metal/ownersChain.js";
import { stepJournal, stepOnce } from "../src/metal/ownersTx.js";
import { ACCOUNT_FACTORY } from "../src/metal/passkeyRelay.js";
import { fakeMetal, type FakeMetal } from "./support/fakeMetal.js";

let dir: string;
let file: string;
let node: FakeMetal;
let db: DB;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "owners-once-")); file = join(dir, "calls.jsonl"); node = fakeMetal(); db = openDb(":memory:"); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));
const world = (o: { budget?: number; rpc?: FakeMetal["rpc"] } = {}): OwnersChain => ownersChain({ budget: callBudget({ budget: o.budget ?? 60, file }), rpc: o.rpc ?? node.rpc, sleep: async () => {}, pollsMs: [1, 1] });
const sponsor = privateKeyToAccount(generatePrivateKey());
const donor = privateKeyToAccount(generatePrivateKey());
const ACCOUNT = "0x10621289C2BF674Cf35085B155Bb5FEfCE6B04ea" as Address;
const data = encodeFunctionData({ abi: factoryAbi, functionName: "createAccount", args: [["0x1234"], [1n], 1n] });
const KEY = "setup:create-account";
/** The step under test: create the account from the sponsor, as owners setup does. */
const create = (chain: OwnersChain) => stepOnce({ db, chain }, KEY, {
  what: "create the account", from: sponsor.address,
  gas: () => chain.gasFor(sponsor.address, ACCOUNT_FACTORY, data, "creating the account"),
  sign: (as) => chain.signCall(sponsor, ACCOUNT_FACTORY, data, { nonce: as.nonce, gas: as.gas! }),
});
const events = (name: string) => (db.prepare("SELECT payload_json FROM audit_log WHERE event = ? ORDER BY seq").all(name) as { payload_json: string }[]).map((r) => JSON.parse(r.payload_json) as Record<string, unknown>);
const sends = () => node.methods().filter((m) => m === "eth_sendRawTransaction").length;

describe("a send on the owners path", () => {
  it("records its hash in the ledger before the transaction leaves, then its outcome", async () => {
    const recordedAtSend: unknown[] = [];
    const chain = world({ rpc: async (a) => { if (a.method === "eth_sendRawTransaction") recordedAtSend.push(stepJournal(db, KEY).open()?.tx ?? null); return node.rpc(a); } });
    const r = await create(chain);
    expect(r).toMatchObject({ ok: true, fresh: true, reason: null });
    expect(recordedAtSend).toEqual([r.tx]);
    expect(node.sent().map((t) => t.hash)).toEqual([r.tx]);
    expect(events("owners.tx_sent")).toEqual([{ step: KEY, what: "create the account", tx: r.tx, from: sponsor.address, nonce: 0, gas: "600000" }]);
    expect(events("owners.tx_done")).toEqual([expect.objectContaining({ step: KEY, tx: r.tx, ok: true, block: 0x18ad1cd })]);
    expect(node.methods()).toEqual(["eth_estimateGas", "eth_getTransactionCount", "eth_sendRawTransaction", "eth_getTransactionReceipt"]);
  });

  it("is not made again once it is done: the step answers from the ledger with no call", async () => {
    const first = await create(world());
    const before = readOwnersCalls(file).length;
    const again = await create(world());
    expect(again).toMatchObject({ tx: first.tx, ok: true, fresh: false });
    expect(readOwnersCalls(file).length).toBe(before);
    expect(sends()).toBe(1);
  });

  it("after a crash between send and receipt, the next run waits for the recorded hash and sends nothing", async () => {
    node.state.receiptAfter = Infinity;
    await expect(create(world())).rejects.toThrow(NoReceiptYet);
    const recorded = stepJournal(db, KEY).open()!;
    node.mine(recorded.tx);
    const requestsBefore = node.requests.length;
    const r = await create(world());
    expect(r).toMatchObject({ tx: recorded.tx, ok: true, fresh: false });
    expect(sends()).toBe(1);
    expect(node.methods().slice(requestsBefore)).toEqual(["eth_getTransactionReceipt"]);
  });

  it("when the answer to the send was lost, the next run finds the transaction on chain and sends nothing", async () => {
    node.state.sendFault = "lose-answer";
    await expect(create(world())).rejects.toThrow(/socket hang up/);
    expect(stepJournal(db, KEY).open()).not.toBeNull();
    const r = await create(world());
    expect(r.ok).toBe(true);
    expect(sends()).toBe(1);
    expect(node.sent()).toHaveLength(1);
  });

  it("when the send never reached a node, the next run sends the identical transaction again: same nonce, same hash, once on chain", async () => {
    node.state.sendFault = "drop";
    await expect(create(world())).rejects.toThrow(/fetch failed/);
    const recorded = stepJournal(db, KEY).open()!;
    expect(node.sent()).toHaveLength(0);
    const requestsBefore = node.requests.length;
    const r = await create(world());
    expect(r).toMatchObject({ tx: recorded.tx, ok: true });
    expect(node.sent().map((t) => [t.hash, t.nonce])).toEqual([[recorded.tx, 0]]);
    // Its receipt first (none), then the sender's nonce (not used), then the same bytes again, then the receipt.
    expect(node.methods().slice(requestsBefore)).toEqual(["eth_getTransactionReceipt", "eth_getTransactionReceipt", "eth_getTransactionCount", "eth_sendRawTransaction", "eth_getTransactionReceipt"]);
    expect(events("owners.tx_sent")).toHaveLength(1);
  });

  it("when the sender's nonce has moved past a recorded send with no receipt, nothing is sent and the step says so", async () => {
    node.state.sendFault = "drop";
    await expect(create(world())).rejects.toThrow();
    // Something else used the sponsor's nonce 0 meanwhile.
    const chain = world();
    const other = await chain.signCall(sponsor, ACCOUNT, "0x", { nonce: 0, gas: 21_000n });
    await chain.broadcast(other);
    node.mine(other.tx);
    const before = sends();
    await expect(create(world())).rejects.toThrow(/nonce has moved past it/);
    expect(sends()).toBe(before);
  });

  it("when the node refuses it outright, the record is voided and a later run signs a new one", async () => {
    node.state.sendFault = "refuse:insufficient funds for gas * price + value";
    await expect(create(world())).rejects.toThrow(NodeRefused);
    expect(stepJournal(db, KEY).open()).toBeNull();
    expect(events("owners.tx_unsent")).toEqual([expect.objectContaining({ step: KEY, why: expect.stringMatching(/insufficient funds/) })]);
    const r = await create(world());
    expect(r).toMatchObject({ ok: true, fresh: true });
    expect(node.sent()).toHaveLength(1);
  });

  it("when the call budget stops the send itself, nothing left this machine and the record is voided", async () => {
    // Estimate and nonce fit the budget; the send is the request over it.
    await expect(create(world({ budget: 2 }))).rejects.toThrow(OwnersBudgetSpent);
    expect(sends()).toBe(0);
    expect(stepJournal(db, KEY).open()).toBeNull();
    expect((await create(world({ budget: 20 }))).ok).toBe(true);
    expect(node.sent()).toHaveLength(1);
  });

  it("a transaction that reverted is settled with the reason; the step may then be sent anew", async () => {
    node.state.reverts.set(ACCOUNT_FACTORY.toLowerCase(), "0x");
    const chain = world();
    // The estimate would refuse it; this step signs with a fixed gas to show a revert on chain.
    const step = (c: OwnersChain) => stepOnce({ db, chain: c }, KEY, { what: "create the account", from: sponsor.address, sign: (as) => c.signCall(sponsor, ACCOUNT_FACTORY, data, { nonce: as.nonce, gas: 600_000n }), reason: () => c.why(sponsor.address, ACCOUNT_FACTORY, data) });
    const r = await step(chain);
    expect(r).toMatchObject({ ok: false, reason: expect.stringMatching(/reverted without revert data/) });
    expect(events("owners.tx_done")).toEqual([expect.objectContaining({ ok: false, reason: expect.stringMatching(/reverted without revert data/) })]);
    node.state.reverts.clear();
    const again = await step(world());
    expect(again).toMatchObject({ ok: true, fresh: true });
    expect(again.tx).not.toBe(r.tx);
  });

  it("a *USDZ transfer is journaled the same way: recorded first, identical on a re-send", async () => {
    node.balances.set(donor.address.toLowerCase(), centsToBaseUnits(9900));
    const fund = (c: OwnersChain) => stepOnce({ db, chain: c }, "setup:fund-sponsor", { what: "fund the gas sponsor", from: donor.address, sign: (as) => c.signTransfer(donor, sponsor.address, centsToBaseUnits(500), { nonce: as.nonce }) });
    node.state.sendFault = "drop";
    await expect(fund(world())).rejects.toThrow(/fetch failed/);
    const recorded = stepJournal(db, "setup:fund-sponsor").open()!;
    const r = await fund(world());
    expect(r).toMatchObject({ tx: recorded.tx, ok: true });
    expect(node.sent()).toHaveLength(1);
    expect(node.balances.get(sponsor.address.toLowerCase())).toBe(centsToBaseUnits(500));
  });
});
