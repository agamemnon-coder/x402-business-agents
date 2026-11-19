// The chain side of the dashboard check (src/metal/dashboardVsChain.ts metalReader), with Alta stood in for: of the
// credentials in the keys directory it reads only those this ledger bound (by hash, else by its bind transaction's block
// and account), and fails when not exactly one of them is live; it lists every MandatePayment under each of them,
// halving a block range the node refuses down to one block, and says when the list cannot be made instead of guessing;
// a payment's detail is its ERC-3009 nonce and its block's time.
import { beforeEach, describe, expect, it, vi } from "vitest";

type Cred = { file: string; principal: string; reference: string; credentialHash: string; cap: bigint; budget: bigint };
type State = { boundBlock: bigint; revoked: boolean; spent: bigint };
type Log = { ref: string; block: bigint; tx: string; amount: bigint };
const h = vi.hoisted(() => ({
  creds: [] as Cred[],
  states: new Map<string, State>(),
  logs: [] as Log[],
  /** The widest block range the node answers getLogs for; wider is refused. */
  maxSpan: 1_000_000n,
  /** getLogs fails for every range, however small. */
  down: false,
  getLogsCalls: [] as [bigint, bigint][],
  receipts: new Map<string, { blockNumber: bigint; logs: { topics: string[] }[] }>(),
  blocks: new Map<bigint, bigint>(),
  receiptReads: 0,
}));

vi.mock("../src/metal/chain.js", () => ({
  publicClient: () => ({
    getBlockNumber: async () => 500n,
    getLogs: async (q: { args: { ref: string }; fromBlock: bigint; toBlock: bigint }) => {
      h.getLogsCalls.push([q.fromBlock, q.toBlock]);
      if (h.down) throw new Error("HTTP request failed. URL: https://rpc.example/secret-key Details: 503");
      if (q.toBlock - q.fromBlock + 1n > h.maxSpan) throw new Error("query exceeds max block range");
      return h.logs.filter((l) => l.ref === q.args.ref && l.block >= q.fromBlock && l.block <= q.toBlock)
        .map((l) => ({ transactionHash: l.tx.toUpperCase().replace("0X", "0x"), blockNumber: l.block, args: { amount: l.amount } }));
    },
    getTransactionReceipt: async ({ hash }: { hash: string }) => { h.receiptReads++; const r = h.receipts.get(hash); if (!r) throw new Error("no receipt"); return r; },
    getBlock: async ({ blockNumber }: { blockNumber: bigint }) => ({ timestamp: h.blocks.get(blockNumber)! }),
  }),
}));
vi.mock("../src/metal/mandate.js", async (orig) => ({
  ...(await orig<typeof import("../src/metal/mandate.js")>()),
  credentialFiles: () => h.creds.map((c) => c.file),
  loadCredentialFile: (_agent: string, f: string) => { const c = h.creds.find((x) => x.file === f)!; return { ...c, credential: c }; },
}));
vi.mock("@metalntwx/metal-pay/mandates", async (orig) => ({
  ...(await orig<typeof import("@metalntwx/metal-pay/mandates")>()),
  readMandateState: async (_pc: unknown, _principal: string, reference: string) => h.states.get(reference) ?? { boundBlock: 0n, revoked: false, spent: 0n },
  extractTerms: (c: Cred) => ({ constraints: { perPaymentCap: c.cap, budget: c.budget } }),
}));

const { metalReader } = await import("../src/metal/dashboardVsChain.js");

const CENT = 10n ** 16n;
const PRINCIPAL = "0x00000000000000000000000000000000000000b0";
const cred = (n: number, over: Partial<Cred> = {}): Cred => ({ file: `support-${n}.json`, principal: PRINCIPAL, reference: `0xref${n}`, credentialHash: `0xhash${n}`, cap: 10n * CENT, budget: 400n * CENT, ...over });
const AUTH_USED = "0x98de503528ee59b575ef0c0a2576a82497bfc029a5685b209e9ec333479b10a5";

beforeEach(() => {
  h.creds = [];
  h.states.clear();
  h.logs = [];
  h.maxSpan = 1_000_000n;
  h.down = false;
  h.getLogsCalls = [];
  h.receipts.clear();
  h.blocks.clear();
  h.receiptReads = 0;
});

describe("which credential is this ledger's", () => {
  it("reads the bound one named by hash, with its terms, its spend and every payment under it", async () => {
    h.creds = [cred(1), cred(2)];
    h.states.set("0xref1", { boundBlock: 100n, revoked: false, spent: 15n * CENT });
    h.states.set("0xref2", { boundBlock: 200n, revoked: false, spent: 0n }); // another world's, in a shared keys directory
    h.logs = [{ ref: "0xref1", block: 120n, tx: "0xaa01", amount: 5n * CENT }, { ref: "0xref1", block: 130n, tx: "0xaa02", amount: 10n * CENT }, { ref: "0xref2", block: 210n, tx: "0xbb01", amount: 7n * CENT }];
    const m = await metalReader().mandate("support", 500n, [{ tx: null, credentialHash: "0xhash1", principal: null }]);
    expect(m).toEqual({
      perPaymentCap: 10n * CENT, budget: 400n * CENT, spent: 15n * CENT, revoked: false, bound: true, block: 500n,
      payments: [{ tx: "0xaa01", block: 120n, amount: 5n * CENT }, { tx: "0xaa02", block: 130n, amount: 10n * CENT }],
      currentPaid: 15n * CENT, credentialsRead: 1, listError: undefined,
    });
    // Its payments are listed from the block it was bound in to the block read.
    expect(h.getLogsCalls).toEqual([[100n, 500n]]);
  });

  it("finds a row without a hash by its bind transaction's block and account, reading each receipt once", async () => {
    h.creds = [cred(1), cred(2, { principal: "0x00000000000000000000000000000000000000c0" })];
    h.states.set("0xref1", { boundBlock: 100n, revoked: false, spent: 0n });
    h.states.set("0xref2", { boundBlock: 100n, revoked: false, spent: 0n }); // the same block, another account
    h.receipts.set("0xbind1", { blockNumber: 100n, logs: [] });
    const reader = metalReader();
    const binds = [{ tx: "0xbind1", credentialHash: null, principal: PRINCIPAL }];
    expect((await reader.mandate("support", 500n, binds)).credentialsRead).toBe(1);
    await reader.mandate("support", 501n, binds);
    expect(h.receiptReads).toBe(1);
  });

  it("after a replacement, lists the payments under every credential the ledger bound, and counts the bound one's own", async () => {
    h.creds = [cred(1), cred(2)];
    h.states.set("0xref1", { boundBlock: 100n, revoked: true, spent: 5n * CENT });
    h.states.set("0xref2", { boundBlock: 300n, revoked: false, spent: 8n * CENT });
    h.logs = [{ ref: "0xref1", block: 150n, tx: "0x01", amount: 5n * CENT }, { ref: "0xref2", block: 310n, tx: "0x02", amount: 3n * CENT }];
    const m = await metalReader().mandate("support", 500n, [{ tx: null, credentialHash: "0xhash1", principal: null }, { tx: null, credentialHash: "0xhash2", principal: null }]);
    expect(m.payments!.map((p) => p.tx)).toEqual(["0x01", "0x02"]);
    expect(m.currentPaid).toBe(3n * CENT);
    expect(m.credentialsRead).toBe(2);
  });

  it("fails when none, or more than one, of this ledger's credentials is live", async () => {
    h.creds = [cred(1), cred(2)];
    h.states.set("0xref1", { boundBlock: 100n, revoked: true, spent: 0n });
    h.states.set("0xref2", { boundBlock: 200n, revoked: false, spent: 0n });
    const binds = [{ tx: null, credentialHash: "0xhash1", principal: null }];
    await expect(metalReader().mandate("support", 500n, binds)).rejects.toThrow("support: expected one bound mandate of this ledger's at block 500, found 0");
    h.states.set("0xref1", { boundBlock: 100n, revoked: false, spent: 0n });
    // A ledger whose rows name no credential is read with every bound credential, as before: here two live.
    await expect(metalReader().mandate("support", 500n, [{ tx: null, credentialHash: null, principal: null }])).rejects.toThrow("found 2");
    await expect(metalReader().mandate("support", 500n, [])).rejects.toThrow("found 2");
  });

  it("does not list payments when the keys directory lacks a credential the ledger bound, and says how many it holds", async () => {
    h.creds = [cred(1)];
    h.states.set("0xref1", { boundBlock: 100n, revoked: false, spent: 2n * CENT });
    const m = await metalReader().mandate("support", 500n, [{ tx: null, credentialHash: "0xhash1", principal: null }, { tx: null, credentialHash: "0xgone", principal: null }]);
    expect(m.payments).toBeNull();
    expect(m.currentPaid).toBeUndefined();
    expect(m.listError).toBe("the keys directory holds 1 of the 2 credentials this ledger bound");
    expect(h.getLogsCalls).toEqual([]);
  });
});

describe("listing the payments", () => {
  it("halves a block range the node refuses, and still lists every payment once", async () => {
    h.creds = [cred(1)];
    h.states.set("0xref1", { boundBlock: 1n, revoked: false, spent: 0n });
    h.maxSpan = 100n;
    h.logs = [10n, 150n, 260n, 399n, 400n].map((block, i) => ({ ref: "0xref1", block, tx: `0x0${i}`, amount: CENT }));
    const m = await metalReader().mandate("support", 400n, [{ tx: null, credentialHash: "0xhash1", principal: null }]);
    expect(m.payments!.map((p) => p.block)).toEqual([10n, 150n, 260n, 399n, 400n]);
    expect(m.currentPaid).toBe(5n * CENT);
    // 400 blocks refused, 200 refused, 100 answered: four ranges of 100 cover 1..400 with no gap and no overlap.
    const answered = h.getLogsCalls.filter(([a, b]) => b - a + 1n <= 100n);
    expect(answered).toEqual([[1n, 100n], [101n, 200n], [201n, 300n], [301n, 400n]]);
  });

  it("says the list cannot be made when the node refuses even one block, without the node's URL", async () => {
    h.creds = [cred(1)];
    h.states.set("0xref1", { boundBlock: 100n, revoked: false, spent: 0n });
    h.down = true;
    const m = await metalReader().mandate("support", 103n, [{ tx: null, credentialHash: "0xhash1", principal: null }]);
    expect(m.payments).toBeNull();
    expect(m.currentPaid).toBeUndefined();
    expect(m.listError).toMatch(/^the node refused eth_getLogs for one block: /);
    expect(m.listError).not.toContain("secret-key");
    // 4 blocks, 2, 1, then the one block refused: given up.
    expect(h.getLogsCalls.map(([a, b]) => b - a + 1n)).toEqual([4n, 2n, 1n]);
  });
});

describe("a payment's detail", () => {
  it("is the ERC-3009 nonce its transaction used and its block's time; a transaction without one has no nonce", async () => {
    h.receipts.set("0xpay", { blockNumber: 77n, logs: [{ topics: ["0xother"] }, { topics: [AUTH_USED, "0xauthorizer", "0xABCDEF"] }] });
    h.receipts.set("0xplain", { blockNumber: 78n, logs: [] });
    h.blocks.set(77n, 1_795_000_000n);
    h.blocks.set(78n, 1_795_000_012n);
    const reader = metalReader();
    expect(await reader.detail("0xpay")).toEqual({ nonce: "0xabcdef", at: "2026-11-18T11:06:40.000Z" });
    expect(await reader.detail("0xplain")).toEqual({ nonce: null, at: "2026-11-18T11:06:52.000Z" });
    expect(await reader.block()).toBe(500n);
  });
});
