// The earnings sweep (src/agents/sweep.ts): how much may be swept, the pull under the treasury mandate (policy and
// velocity checked before signing; a retry keeps its payment id and amount; a sent pull is never forgotten), the
// finality gate before any credit, and one credit per on-chain transfer. The metal-agent CLI, the mandates and the
// chain are fakes; the ledger is a real in-memory database. No network.
import { withOrigin } from "../src/provenance/origin.js";
import { encodeAbiParameters, encodeEventTopics, erc20Abi, type Address, type Hash } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CliResult } from "../src/metal/agentCli.js";
import { FakeAirwallex } from "./fakes/airwallex.js";

type MandateFake = { budget: bigint; spent: bigint };
const h = vi.hoisted(() => ({
  mandates: {} as Record<string, MandateFake>,
  balance: 0n,
  cli: [] as string[][],
  answer: null as null | ((args: string[]) => CliResult),
  rpc: [] as unknown[],
  receipt: null as unknown,
  block: null as unknown,
}));

vi.mock("../src/metal/mandate.js", () => ({
  activeMandate: async (agent: string) => ({ agent, credentialPath: `/keys/${agent}.credential.json`, keyFile: `/keys/${agent}.key.json`, credential: { agent } }),
  mandateSpent: async (m: { agent: string }) => h.mandates[m.agent]!.spent,
  // One credential per agent here: no replace, so no earlier pull to look up (test/metal-pull-after-replace.test.ts).
  credentialFiles: () => [],
  loadCredentialFile: () => { throw new Error("no credential files in this test"); },
}));
vi.mock("@metalntwx/metal-pay/mandates", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@metalntwx/metal-pay/mandates")>()),
  extractTerms: (c: { agent: string }) => ({ constraints: { budget: h.mandates[c.agent]!.budget } }),
}));
vi.mock("../src/metal/chain.js", () => ({
  usdzBalance: async () => h.balance,
  publicClient: () => ({
    getTransactionReceipt: async () => h.receipt,
    getBlock: async () => h.block,
  }),
}));
vi.mock("../src/metal/agentCli.js", () => ({
  metalAgent: (args: string[], okCodes: number[] = [0]) => {
    h.cli.push(args);
    const r = h.answer!(args);
    if (!okCodes.includes(r.code)) throw new Error(`exit ${r.code}`);
    return r;
  },
}));
vi.mock("../src/metal/network.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/metal/network.js")>()),
  rpc: async () => h.rpc.shift(),
}));

const { awaitFinalTransfer, bookCredit, executeSweep, lockCredit, netEarnings, nextSweepId, planSweep } = await import("../src/agents/sweep.js");
const { openDb } = await import("../src/db/open.js");
const { velocityGate } = await import("../src/policy/velocity.js");
const { VELOCITY } = await import("../src/config/policy.js");
type DB = ReturnType<typeof openDb>;

const USDZ = "0x000000000000000000000000000000000000B5d5";
const BUSINESS = "0x00000000000000000000000000000000000000b1" as Address;
const SWEEP = "0x00000000000000000000000000000000000000aa" as Address;
const units = (cents: number) => BigInt(cents) * 10n ** 16n;
const cli = (code: number, lines: string[] = []): CliResult => {
  const out = lines.join("\n");
  const fields = new Map<string, string[]>();
  for (const l of lines) { const i = l.indexOf(" "); fields.set(l.slice(0, i), [...(fields.get(l.slice(0, i)) ?? []), l.slice(i + 1)]); }
  return { code, fields, out };
};
const events = (db: DB, e: string) => (db.prepare("SELECT payload_json FROM audit_log WHERE event = ? ORDER BY seq").all(e) as { payload_json: string }[]).map((r) => JSON.parse(r.payload_json) as Record<string, unknown>);
const sweepRow = (db: DB, id: string) => db.prepare("SELECT amount_cents, outcome, tx_hash FROM sweeps WHERE payment_id = ?").get(id);

function sale(db: DB, cents: number, status = "DELIVERED"): number {
  return Number(db.prepare(`INSERT INTO sales (route, price_cents, payer, request_url, request_params_json, status, created_at)
    VALUES ('GET /v1/stock', ?, '0xc1', 'u', '{}', ?, 'now')`).run(cents, status).lastInsertRowid);
}

let db: DB;
beforeEach(() => {
  db = openDb(":memory:");
  h.mandates = { sourcing: { budget: units(1000), spent: units(0) }, support: { budget: units(400), spent: units(0) }, treasury: { budget: units(600), spent: units(0) } };
  h.balance = 0n;
  h.cli = [];
  h.answer = () => cli(0, ["transaction 0xt1"]);
  h.rpc = [];
});

describe("net earnings", () => {
  it("counts delivered sales, minus paid upstream, minus paid or held refunds and sweeps", () => {
    const s1 = sale(db, 500);
    sale(db, 300);
    sale(db, 999, "ABORTED_NO_CHARGE");
    db.prepare("INSERT INTO upstream_purchases (price_cents, outcome, created_at) VALUES (200, 'PAID', 'now'), (77, 'REFUSED', 'now'), (66, 'IN_DOUBT', 'now')").run();
    const s2 = sale(db, 50);
    const s3 = sale(db, 50);
    db.prepare("INSERT INTO refunds (sale_id, payment_id, amount_cents, to_address, outcome) VALUES (?, 'refund-a', 10, '0xc1', 'PAID'), (?, 'refund-b', 20, '0xc1', 'HELD'), (?, 'refund-c', 40, '0xc1', 'REFUSED')").run(s1, s2, s3);
    db.prepare("INSERT INTO sweeps (payment_id, amount_cents, outcome, created_at) VALUES ('s1', 100, 'PAID', 'now'), ('s2', 30, 'HELD', 'now'), ('s3', 500, 'REFUSED', 'now'), ('s4', 500, 'PLANNED', 'now')").run();
    // Fails if: HELD refunds/sweeps stop counting (money that may still settle would be swept again), or refused
    // or aborted rows start counting.
    expect(netEarnings(db)).toEqual({ revenueCents: 900, upstreamCents: 200, refundsCents: 30, sweptCents: 130, netCents: 540 });
  });

  it("subtracts PENDING refunds and sweeps (sent, may still settle), not PLANNED ones (never sent)", () => {
    const s1 = sale(db, 500);
    db.prepare("INSERT INTO refunds (sale_id, payment_id, amount_cents, to_address, outcome) VALUES (?, 'refund-p', 25, '0xc1', 'PENDING')").run(s1);
    db.prepare("INSERT INTO sweeps (payment_id, amount_cents, outcome, created_at) VALUES ('s1', 100, 'PENDING', 'now'), ('s2', 70, 'PLANNED', 'now')").run();
    // Fails if: a pull that was sent and may still settle counts as earnings not yet swept or refunded (HF6): planning
    // another sweep would then take the same money twice, and the dashboard would overstate what is left.
    expect(netEarnings(db)).toEqual({ revenueCents: 500, upstreamCents: 0, refundsCents: 25, sweptCents: 100, netCents: 375 });
  });

  it("is all zero on an empty ledger", () => {
    // Fails if: SUM over no rows (NULL) is not read as 0.
    expect(netEarnings(db)).toEqual({ revenueCents: 0, upstreamCents: 0, refundsCents: 0, sweptCents: 0, netCents: 0 });
  });
});

describe("planning a sweep", () => {
  it("refuses when there is nothing to sweep, without reading the chain", async () => {
    h.balance = units(10_000);
    // Fails if: the net-earnings check is dropped (a sweep of 0 or less would be planned).
    expect(await planSweep(db, BUSINESS)).toEqual({ refuse: "nothing to sweep: net earnings 0.00" });
  });

  it("plans the net earnings when the business keeps enough for the other mandates", async () => {
    sale(db, 300);
    h.balance = units(2000);
    h.mandates.sourcing!.spent = units(400); // 6.00 left
    h.mandates.support!.spent = units(100); // 3.00 left
    h.mandates.treasury!.spent = units(100); // 5.00 left
    // Fails if: committed or treasury remaining stop subtracting what was spent.
    expect(await planSweep(db, BUSINESS)).toEqual({ amountCents: 300, businessBeforeCents: 2000, businessAfterCents: 1700, committedCents: 900, treasuryRemainingCents: 500 });
  });

  it("refuses a sweep past treasury's remaining budget", async () => {
    sale(db, 300);
    h.balance = units(5000);
    h.mandates.treasury!.spent = units(400); // 2.00 left
    // Fails if: the treasury budget check is removed (the pull would be refused on chain, or worse).
    expect(await planSweep(db, BUSINESS)).toEqual({ refuse: "sweep 3.00 exceeds treasury's remaining budget 2.00" });
  });

  it("refuses a sweep that would leave less than the other mandates may still spend", async () => {
    sale(db, 300);
    h.balance = units(1500); // 15.00 - 3.00 = 12.00 < 14.00 committed
    // Fails if: the committed-funds check is removed (sourcing or refunds could bounce after the sweep).
    expect(await planSweep(db, BUSINESS)).toEqual({ refuse: "sweep would leave 12.00, under the 14.00 the other mandates may still spend" });
  });
});

describe("sweep ids", () => {
  it("numbers sweeps per UTC day", () => {
    const now = new Date("2026-11-03T23:59:00Z");
    expect(nextSweepId(db, now)).toBe("sweep-20261103-1");
    db.prepare("INSERT INTO sweeps (payment_id, amount_cents, outcome, created_at) VALUES ('sweep-20261103-1', 1, 'PAID', 'now'), ('sweep-20261102-1', 1, 'PAID', 'now')").run();
    // Fails if: the count stops being per day (or ids repeat, which metal-agent would read as the same payment).
    expect(nextSweepId(db, now)).toBe("sweep-20261103-2");
  });
});

describe("executing a sweep", () => {
  it("pulls once under the treasury mandate with the payment id and amount, and records PAID with the tx", async () => {
    const origin = { actor: "agent" as const, agent: "treasury", model: "claude-opus-5-5", request_id: "req_1", run_id: "run-treasury-1-abcdef" };
    const r = await withOrigin(origin, () => executeSweep(db, "sweep-1", 250, SWEEP));
    expect(r).toEqual({ outcome: "PAID", tx: "0xt1", reason: null });
    // D24: who decided it is recorded with the sweep, in its ledger row and its audit event, when it starts.
    expect(JSON.parse((db.prepare("SELECT origin_json FROM sweeps WHERE payment_id = 'sweep-1'").get() as { origin_json: string }).origin_json)).toEqual(origin);
    // Fails if: the pull is made without the payment id (metal-agent's at-most-once key) or with another amount.
    expect(h.cli).toEqual([["mandate", "pull", "--credential", "/keys/treasury.credential.json", "--mandate-key-file", "/keys/treasury.key.json", "--to", SWEEP, "--amount", "2.50", "--payment-id", "sweep-1"]]);
    expect(sweepRow(db, "sweep-1")).toEqual({ amount_cents: 250, outcome: "PAID", tx_hash: "0xt1" });
    expect(events(db, "sweep.paid")).toEqual([{ amount: "2.50", to: SWEEP, tx: "0xt1", reason: null, origin }]);
  });

  it("retries a pending pull under the same payment id, and keeps an earlier tx when the retry reports none", async () => {
    h.answer = () => cli(3, ["transaction 0xpending", "reason submitted, not yet final"]);
    expect(await executeSweep(db, "sweep-1", 250, SWEEP)).toEqual({ outcome: "PENDING", tx: "0xpending", reason: "submitted, not yet final" });
    h.answer = () => cli(0, ["status paid"]);
    expect(await executeSweep(db, "sweep-1", 250, SWEEP)).toMatchObject({ outcome: "PAID" });
    // Fails if: a retry uses a new payment id (the pull could be paid twice).
    expect(h.cli.map((a) => a[a.indexOf("--payment-id") + 1])).toEqual(["sweep-1", "sweep-1"]);
    // Fails if: COALESCE(?, tx_hash) is dropped and the known tx is lost.
    expect(sweepRow(db, "sweep-1")).toEqual({ amount_cents: 250, outcome: "PAID", tx_hash: "0xpending" });
    expect(db.prepare("SELECT COUNT(*) AS n FROM sweeps").get()).toEqual({ n: 1 });
  });

  it("refuses a retry that changes the amount, before anything is signed", async () => {
    h.answer = () => cli(3);
    await executeSweep(db, "sweep-1", 250, SWEEP);
    // Fails if: the planned-amount check is removed (a retry could pull a different amount under the same id).
    await expect(executeSweep(db, "sweep-1", 900, SWEEP)).rejects.toThrow("sweep-1 was planned for 2.50; a retry must not change the amount");
    expect(h.cli).toHaveLength(1);
  });

  it("records metal-agent's refusal and its reason", async () => {
    h.answer = () => cli(1, ["reason mandate_budget_spent"]);
    // Fails if: exit code 1 is mapped to anything but REFUSED, or the reason is dropped.
    expect(await executeSweep(db, "sweep-1", 250, SWEEP)).toEqual({ outcome: "REFUSED", tx: null, reason: "mandate_budget_spent" });
    expect(sweepRow(db, "sweep-1")).toMatchObject({ outcome: "REFUSED" });
    expect(events(db, "sweep.refused")).toHaveLength(1);
  });

  it("records a held pull as HELD (exit 4)", async () => {
    h.answer = () => cli(4, ["transaction 0xheld"]);
    // Fails if: exit 4 is not mapped to HELD (a held pull would look unsent and be swept again).
    expect(await executeSweep(db, "sweep-1", 250, SWEEP)).toMatchObject({ outcome: "HELD", tx: "0xheld" });
  });

  it("checks the CFO policy's per-sweep limit before signing, and records the refusal", async () => {
    db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('cap.treasury', '2.00', 'now')").run();
    const r = await executeSweep(db, "sweep-1", 250, SWEEP);
    // Fails if: capRefusal is not checked before metalAgent (the pull would be signed over the CFO's limit).
    expect(r).toEqual({ outcome: "REFUSED", tx: null, reason: "policy_cap_exceeded: 2.50 is over the Treasury agent's limit of 2.00" });
    expect(h.cli).toEqual([]);
    expect(sweepRow(db, "sweep-1")).toMatchObject({ outcome: "REFUSED" });
    expect(events(db, "sweep.refused")).toEqual([expect.objectContaining({ reason: expect.stringMatching(/^policy_cap_exceeded/) })]);
  });

  it("checks the velocity limit before signing", async () => {
    // Fills treasury's hourly amount; the sweep would exceed it.
    expect(velocityGate(db, "treasury", "metal", VELOCITY.treasury.usdzPerHourCents, new Date())).toBeNull();
    const r = await executeSweep(db, "sweep-1", 100, SWEEP);
    // Fails if: velocityGate is not consulted before the pull.
    expect(r).toMatchObject({ outcome: "REFUSED", reason: expect.stringMatching(/^velocity_exceeded/) });
    expect(h.cli).toEqual([]);
  });

  it("keeps a held sweep HELD when a later check refuses, and records why it was deferred", async () => {
    db.prepare("INSERT INTO sweeps (payment_id, amount_cents, outcome, created_at) VALUES ('sweep-1', 250, 'HELD', 'now')").run();
    db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('cap.treasury', '1.00', 'now')").run();
    const r = await executeSweep(db, "sweep-1", 250, SWEEP);
    // Fails if: a refused retry overwrites HELD with REFUSED (the sweep would be forgotten and swept again).
    expect(r).toEqual({ outcome: "HELD", tx: null, reason: expect.stringMatching(/^policy_cap_exceeded/) });
    expect(sweepRow(db, "sweep-1")).toMatchObject({ outcome: "HELD" });
    expect(events(db, "sweep.deferred")).toEqual([expect.objectContaining({ kept: "HELD" })]);
    expect(h.cli).toEqual([]);
  });
});

describe("the finality gate", () => {
  const TX = `0x${"77".repeat(32)}` as Hash;
  const BLOCK_HASH = `0x${"bb".repeat(32)}`;
  function transferLog(token: string, from: string, to: string, value: bigint, logIndex: number) {
    return {
      address: token, topics: encodeEventTopics({ abi: erc20Abi, eventName: "Transfer", args: { from: from as Address, to: to as Address } }),
      data: encodeAbiParameters([{ type: "uint256" }], [value]), logIndex, blockNumber: 100n, blockHash: BLOCK_HASH, transactionHash: TX, transactionIndex: 0, removed: false,
    };
  }
  function receipt(logs: unknown[], status = "success") {
    h.receipt = { status, logs, blockNumber: 100n, blockHash: BLOCK_HASH };
    h.block = { hash: BLOCK_HASH };
  }
  const finalized = (n: number) => ({ head: { hash: "0x", number: n + 5 }, finalized: { hash: "0x", number: n } });

  it("returns the matching transfer once its block is final and still canonical", async () => {
    receipt([
      transferLog("0x00000000000000000000000000000000000000ee", BUSINESS, SWEEP, units(250), 0), // another token
      transferLog(USDZ, BUSINESS, SWEEP, units(100), 1), // another amount
      transferLog(USDZ.toLowerCase(), BUSINESS, SWEEP, units(250), 2),
    ]);
    h.rpc = [finalized(100)];
    // Fails if: the token, amount or direction filters are loosened (another transfer would be credited).
    expect(await awaitFinalTransfer(TX, BUSINESS, SWEEP, 250)).toEqual({ eventKey: `63825:${TX}:2`, tx: TX, logIndex: 2, block: 100, finalizedBlock: 100, amountUnits: units(250) });
  });

  it("refuses a receipt that failed", async () => {
    receipt([transferLog(USDZ, BUSINESS, SWEEP, units(250), 0)], "reverted");
    // Fails if: the receipt status check is removed (a reverted sweep would be credited).
    await expect(awaitFinalTransfer(TX, BUSINESS, SWEEP, 250)).rejects.toThrow(`${TX} did not succeed`);
  });

  it("refuses a receipt without the exact *USDZ transfer", async () => {
    receipt([transferLog(USDZ, SWEEP, BUSINESS, units(250), 0), transferLog(USDZ, BUSINESS, SWEEP, units(249), 1)]);
    // Fails if: a reversed or short transfer passes the gate.
    await expect(awaitFinalTransfer(TX, BUSINESS, SWEEP, 250)).rejects.toThrow(/carries no \*USDZ transfer of 2.50/);
  });

  it("refuses a block that is no longer canonical", async () => {
    receipt([transferLog(USDZ, BUSINESS, SWEEP, units(250), 0)]);
    h.block = { hash: `0x${"cc".repeat(32)}` };
    h.rpc = [finalized(120)];
    // Fails if: the canonical-hash check is removed (a credit for a reorged-out transfer).
    await expect(awaitFinalTransfer(TX, BUSINESS, SWEEP, 250)).rejects.toThrow("block 100 is no longer canonical");
  });

  it("gives up when the block is not final in time", async () => {
    receipt([transferLog(USDZ, BUSINESS, SWEEP, units(250), 0)]);
    h.rpc = [finalized(99)];
    // Fails if: the finalized-height check is removed (credit before finality) or the deadline never fires.
    await expect(awaitFinalTransfer(TX, BUSINESS, SWEEP, 250, -1)).rejects.toThrow("block 100 not finalized after -1 ms");
  });

  it("waits and polls again until the block is final", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    try {
      receipt([transferLog(USDZ, BUSINESS, SWEEP, units(250), 0)]);
      h.rpc = [finalized(98), finalized(101)];
      const p = awaitFinalTransfer(TX, BUSINESS, SWEEP, 250, 60_000);
      await vi.advanceTimersByTimeAsync(2000);
      // Fails if: the loop stops polling after the first not-final answer.
      expect(await p).toMatchObject({ finalizedBlock: 101 });
      expect(h.rpc).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("crediting a final transfer", () => {
  const f = { eventKey: "63825:0xabc:1", tx: "0xabc" as Hash, logIndex: 1, block: 10, finalizedBlock: 12, amountUnits: units(135) };

  it("locks one credit per on-chain transfer and links it to the sweep", () => {
    db.prepare("INSERT INTO sweeps (payment_id, amount_cents, outcome, created_at) VALUES ('sweep-1', 135, 'PAID', 'now')").run();
    expect(lockCredit(db, f, BUSINESS, SWEEP, "sweep-1")).toEqual({ locked: true });
    // Fails if: INSERT OR IGNORE on the event key is replaced (a second credit for the same transfer).
    expect(lockCredit(db, f, BUSINESS, SWEEP, "sweep-1")).toEqual({ locked: false });
    expect(db.prepare("SELECT COUNT(*) AS n FROM chain_credits").get()).toEqual({ n: 1 });
    expect(db.prepare("SELECT event_key FROM sweeps WHERE payment_id = 'sweep-1'").get()).toEqual({ event_key: f.eventKey });
    expect(db.prepare("SELECT awx_reference, amount_base_units FROM chain_credits").get()).toEqual({ awx_reference: "0xabc", amount_base_units: units(135).toString() });
    expect(events(db, "credit.locked")).toHaveLength(1);
  });

  it("books a locked credit as one deposit of the same amount, and adopts it on a second run", async () => {
    const awx = new FakeAirwallex();
    lockCredit(db, f, BUSINESS, SWEEP, "none");
    const first = await bookCredit(db, awx, awx, f.eventKey);
    expect(first.adopted).toBe(false);
    expect(awx.deposits).toEqual([expect.objectContaining({ amountCents: 135, reference: "0xabc" })]);
    // Fails if: the stored deposit id is not checked first (a second deposit would be simulated).
    expect(await bookCredit(db, awx, awx, f.eventKey)).toEqual({ depositId: first.depositId, adopted: true });
    expect(awx.deposits).toHaveLength(1);
    expect(events(db, "credit.deposited")).toHaveLength(1);
  });

  it("refuses to book a credit that was never locked", async () => {
    const awx = new FakeAirwallex();
    // Fails if: bookCredit deposits without a locked, finality-checked credit.
    await expect(bookCredit(db, awx, awx, "63825:0xnone:0")).rejects.toThrow("no locked credit 63825:0xnone:0");
    expect(awx.deposits).toHaveLength(0);
  });

  it("stops when more than one deposit already references the transfer", async () => {
    const awx = new FakeAirwallex();
    lockCredit(db, f, BUSINESS, SWEEP, "none");
    for (let i = 0; i < 2; i++) await awx.simulateDeposit({ globalAccountId: "ga", amountCents: 135, reference: "0xabc", payerName: "x" });
    // Fails if: duplicates are silently adopted (the books would hide a double credit).
    await expect(bookCredit(db, awx, awx, f.eventKey)).rejects.toThrow("2 deposits already reference 0xabc; investigate");
    expect(awx.deposits).toHaveLength(2);
  });
});
