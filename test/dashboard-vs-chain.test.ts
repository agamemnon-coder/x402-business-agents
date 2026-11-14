// Alta QA (1 November), exact since the night batch (2 November): the dashboard's mandate numbers, read against the
// chain. The comparison itself, without a chain; and the reading, with a chain that answers while the ledger moves.
import { describe, expect, it } from "vitest";
import { audit } from "../src/audit/log.js";
import { openDb, type DB } from "../src/db/open.js";
import { buildSnapshot } from "../src/dashboard/snapshot.js";
import { compareMandate, dashboardVsChain, plain, type ChainMandate, type ChainPayment, type ChainReader } from "../src/metal/dashboardVsChain.js";
import { centsToBaseUnits as u } from "../src/lib/money.js";
import type { LedgerPayment } from "../src/policy/available.js";

const shown = { agent: "sourcing", cap: "0.03", budget: "6.00", spent: "0.42", pending: "0.00", credentials: 1 };
const chain = { perPaymentCap: u(3), budget: u(600), spent: u(42), revoked: false, bound: true };
const tx = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;
const nonce = (n: number) => `0x${(n + 0xa000).toString(16).padStart(64, "0")}`;

describe("the dashboard against the chain (running spend only, when the payments cannot be listed)", () => {
  it("agrees when cap, budget and spend match what Alta has", () => {
    expect(compareMandate(shown, chain).differences).toEqual([]);
  });

  it("names every number that differs, and says no payment could be named", () => {
    const d = compareMandate({ ...shown, cap: "0.04", budget: "5.00" }, { ...chain, spent: u(50) }).differences;
    expect(d).toEqual([
      "cap: the dashboard shows 0.04, the chain 0.03",
      "budget: the dashboard shows 5.00, the chain 6.00",
      "spent: the dashboard shows 0.42 spent (0.00 pending), the chain 0.50; the chain's payments could not be listed to name the one that explains it",
    ]);
  });

  it("allows chain spend between paid and paid + pending + held (a payment on its way)", () => {
    expect(compareMandate({ ...shown, pending: "0.03" }, { ...chain, spent: u(45) }).differences).toEqual([]);
    expect(compareMandate({ ...shown, held: "0.03" }, { ...chain, spent: u(45) }).differences).toEqual([]);
  });

  it("after a replacement compares spend only as an upper bound, and says so", () => {
    const r = compareMandate({ ...shown, credentials: 2, spent: "1.00" }, { ...chain, spent: u(20) });
    expect(r.differences).toEqual([]);
    expect(r.notes).toEqual(["spent compared as an upper bound only: 2 credentials, and their payments could not be listed"]);
    expect(compareMandate({ ...shown, credentials: 2, spent: "0.10" }, { ...chain, spent: u(20) }).differences).toEqual(["spent: the dashboard shows 0.10 spent (0.00 pending), the chain 0.20 under the current credential alone; the chain's payments could not be listed to name the one that explains it"]);
  });

  it("refuses a mandate the chain has not bound, or revoked", () => {
    expect(compareMandate(shown, { ...chain, bound: false }).differences).toEqual(["the chain has no bound mandate for this credential"]);
    expect(compareMandate(shown, { ...chain, revoked: true }).differences).toEqual(["the chain has revoked this credential"]);
  });
});

/** The customer's mandate of dry-146: 67 stock checks of 0.05, the last one at block 13271973. */
function customer146(sales: number): { payments: ChainPayment[]; ledger: LedgerPayment[] } {
  const payments = Array.from({ length: 67 }, (_, i) => ({ tx: tx(i + 1), block: 13271973n - BigInt((66 - i) * 230), amount: u(5), nonce: nonce(i + 1) }));
  const ledger = Array.from({ length: sales }, (_, i): LedgerPayment => ({ what: `sale ${i + 1}`, cents: 5, tx: tx(i + 1), nonce: nonce(i + 1), state: "paid" }));
  return { payments, ledger };
}
const cust = { agent: "customer", cap: "0.10", budget: "5.00", credentials: 1 };
const custChain = (payments: ChainPayment[]): ChainMandate => ({ perPaymentCap: u(10), budget: u(500), spent: payments.reduce((s, p) => s + p.amount, 0n), revoked: false, bound: true, block: 13272000n, payments });

describe("the dashboard against the chain, payment by payment", () => {
  it("night batch, dry-146: a sale on chain before its row fails, and names that payment", () => {
    const { payments, ledger } = customer146(66);
    const r = compareMandate({ ...cust, spent: "3.30", pending: "0.00" }, custChain(payments), ledger);
    expect(r.differences).toHaveLength(1);
    expect(r.differences[0]).toMatch(/^spent: the dashboard shows 3\.30 spent \(0\.00 pending\), the chain 3\.35 at block 13272000: tx 0x0000000000…0043 \(0\.05 in block 13271973\) is on chain under the customer mandate, but the ledger has no payment for it/);
  });

  it("the same moment with the sale shown as being settled: agrees, and lists it as on its way", () => {
    const { payments, ledger } = customer146(66);
    const settling: LedgerPayment = { what: "a sale being settled", cents: 5, tx: null, nonce: nonce(67), state: "pending" };
    const r = compareMandate({ ...cust, spent: "3.30", pending: "0.05" }, custChain(payments), [...ledger, settling]);
    expect(r.differences).toEqual([]);
    expect(r.notes).toEqual(["tx 0x0000000000…0043 (0.05 in block 13271973) is on chain; the ledger has a sale being settled on its way (shown as pending)"]);
  });

  it("a pending line the chain does not count yet agrees too (sent, not yet in a block)", () => {
    const { payments, ledger } = customer146(66);
    const settling: LedgerPayment = { what: "a sale being settled", cents: 5, tx: null, nonce: nonce(67), state: "pending" };
    expect(compareMandate({ ...cust, spent: "3.30", pending: "0.05" }, custChain(payments.slice(0, 66)), [...ledger, settling])).toEqual({ differences: [], notes: [] });
  });

  it("names a payment the ledger has paid that the chain does not have, and a different amount", () => {
    const { payments, ledger } = customer146(67);
    const r1 = compareMandate({ ...cust, spent: "3.35", pending: "0.00" }, custChain(payments.slice(0, 66)), ledger);
    expect(r1.differences[0]).toMatch(/sale 67: the ledger has it paid \(0\.05, tx 0x0000000000…0043\), but the chain has no such payment under the customer mandate at block 13272000/);
    const wrong = ledger.map((l) => (l.what === "sale 67" ? { ...l, cents: 0 } : l));
    const r2 = compareMandate({ ...cust, spent: "3.30", pending: "0.00" }, custChain(payments), wrong);
    expect(r2.differences[0]).toMatch(/sale 67: the ledger has 0\.00 \(paid\), the chain paid 0\.05 in tx 0x0000000000…0043/);
  });

  it("a settle the ledger has as failed, but which is on chain, fails", () => {
    const { payments, ledger } = customer146(66);
    const failed: LedgerPayment = { what: "a sale being settled", cents: 5, tx: null, nonce: nonce(67), state: "failed", detail: "payment_failed" };
    const r = compareMandate({ ...cust, spent: "3.30", pending: "0.00" }, custChain(payments), [...ledger, failed]);
    expect(r.differences[0]).toMatch(/is on chain, but the ledger has a sale being settled as a settle that failed, nothing moved \(payment_failed\)/);
  });

  it("a purchase being made now: a fresh hold of the same amount, made just before its block, explains it", () => {
    const now = new Date("2026-11-02T16:10:00Z");
    const pay = [{ tx: tx(1), block: 10n, amount: u(3) }, { tx: tx(2), block: 11n, amount: u(3), at: "2026-11-02T16:09:58.000Z" }];
    const hold: LedgerPayment = { what: "the hold upstream:2", cents: 3, tx: null, nonce: null, state: "held", since: "2026-11-02T16:09:57.500Z" };
    const ledger: LedgerPayment[] = [{ what: "purchase 1", cents: 3, tx: tx(1), nonce: null, state: "paid" }, hold];
    const r = compareMandate({ ...shown, spent: "0.03", held: "0.03" }, { ...chain, spent: u(6), block: 12n, payments: pay }, ledger, now);
    expect(r.differences).toEqual([]);
    expect(r.notes[0]).toMatch(/the ledger has the hold upstream:2, held for a payment being made now \(shown as held\), on its way since 2026-11-02T16:09:57\.500Z/);
    // A hold made after the payment, or one left for longer than a payment takes, explains nothing.
    const later = { ...hold, since: "2026-11-02T16:09:59.500Z" };
    expect(compareMandate({ ...shown, spent: "0.03", held: "0.03" }, { ...chain, spent: u(6), block: 12n, payments: pay }, [ledger[0]!, later], now).differences[0]).toMatch(/0x0000000000…0002 \(0\.03 in block 11, 2026-11-02T16:09:58\.000Z\) is on chain under the sourcing mandate, but the ledger has no payment for it/);
    expect(compareMandate({ ...shown, spent: "0.03", held: "0.03" }, { ...chain, spent: u(6), block: 12n, payments: pay }, ledger, new Date("2026-11-02T16:20:00Z")).differences).toHaveLength(1);
  });

  it("a sale left 'being settled' for longer than a settle takes is named, not passed as on its way", () => {
    const { payments, ledger } = customer146(66);
    const settling: LedgerPayment = { what: "a sale being settled", cents: 5, tx: null, nonce: nonce(67), state: "pending", since: "2026-11-02T16:30:43.900Z", detail: "outcome unknown, it may have settled: fetch failed" };
    const now = new Date("2026-11-02T16:36:00Z");
    const r = compareMandate({ ...cust, spent: "3.30", pending: "0.05" }, custChain(payments), [...ledger, settling], now);
    expect(r.differences[0]).toMatch(/is on chain, but the ledger still has a sale being settled on its way \(shown as pending\), on its way since 2026-11-02T16:30:43\.900Z: it was never recorded as paid \(outcome unknown, it may have settled: fetch failed\)/);
    expect(compareMandate({ ...cust, spent: "3.30", pending: "0.05" }, custChain(payments), [...ledger, settling], new Date("2026-11-02T16:30:50Z")).differences).toEqual([]);
  });

  it("a payment on its way whose amount differs from the chain's is named", () => {
    const { payments, ledger } = customer146(66);
    const settling: LedgerPayment = { what: "a sale being settled", cents: 5, tx: null, nonce: nonce(67), state: "pending" };
    const big = payments.map((p, i) => (i === 66 ? { ...p, amount: u(50) } : p));
    expect(compareMandate({ ...cust, spent: "3.30", pending: "0.50" }, custChain(big), [...ledger, settling]).differences[0]).toMatch(/a sale being settled: the ledger has 0\.05 \(pending\), the chain paid 0\.50/);
  });

  it("a sub-cent payment is named in full, not an error", () => {
    const { payments, ledger } = customer146(66);
    const odd = [...payments.slice(0, 66), { ...payments[66]!, amount: 15n * 10n ** 15n }];
    expect(compareMandate({ ...cust, spent: "3.30", pending: "0.00" }, { ...custChain(odd), spent: u(330) + 15n * 10n ** 15n }, ledger).differences[0]).toMatch(/the chain 3\.315 at block 13272000: tx 0x0000000000…0043 \(0\.015 in block/);
  });

  it("the bound credential's payments must add up to its running spend", () => {
    const { payments, ledger } = customer146(67);
    expect(compareMandate({ ...cust, spent: "3.35", pending: "0.00" }, { ...custChain(payments), currentPaid: u(335), spent: u(340) }, ledger).differences).toEqual([
      "the chain's own figures disagree: the bound credential's payments add up to 3.35, its running spend says 3.40 at block 13272000",
    ]);
  });

  it("after a replacement compares exactly, over every credential's payments", () => {
    // Two credentials: 0.20 under the first, 0.10 under the current one; the dashboard carries 0.30.
    const pay = [{ tx: tx(1), block: 10n, amount: u(20) }, { tx: tx(2), block: 20n, amount: u(10) }];
    const ledger: LedgerPayment[] = [{ what: "purchase 1", cents: 20, tx: tx(1), nonce: null, state: "paid" }, { what: "purchase 2", cents: 10, tx: tx(2), nonce: null, state: "paid" }];
    expect(compareMandate({ ...shown, credentials: 2, spent: "0.30" }, { ...chain, spent: u(10), payments: pay }, ledger).differences).toEqual([]);
    expect(compareMandate({ ...shown, credentials: 2, spent: "0.20" }, { ...chain, spent: u(10), payments: pay }, ledger.slice(0, 1)).differences[0]).toMatch(/tx 0x0000000000…0002 \(0\.10 in block 20\) is on chain under the sourcing mandate, but the ledger has no payment for it/);
  });
});

describe("after a pause and a resume", () => {
  it("the dashboard counts the resumed credential and compares its budget with what was left, as Alta bound it", () => {
    const db = openDb(":memory:");
    audit(db, "owner-signer", "mandate.bound", "support", { cap: "0.10", budget: "4.00", payee: "0x00000000000000000000000000000000000000c1" });
    audit(db, "owner-signer", "mandate.resumed", "support", { agent: "support", proposal_id: "P-0009", tx: tx(9), credential_hash: tx(10), spent_before: "0.30", budget: "3.70" });
    const b = buildSnapshot(db).budgets.agents.find((x) => x.agent === "support")!;
    expect(b).toMatchObject({ budget: "4.00", chain_budget: "3.70", credentials: 2, cap: "0.10" });
    const sup = { agent: "support", cap: "0.10", budget: "4.00", chain_budget: "3.70", spent: "0.00", pending: "0.00", credentials: 2 };
    const c = { perPaymentCap: u(10), budget: u(370), spent: 0n, revoked: false, bound: true, payments: [] as ChainPayment[] };
    expect(compareMandate(sup, c)).toEqual({ differences: [], notes: ["budget: 4.00 over the mandate's life; the credential bound at the resume has 3.70, what was left, as on chain"] });
    expect(compareMandate(sup, { ...c, budget: u(400) }).differences).toEqual(["budget: the bound credential's budget is 3.70 on the dashboard (what was left of 4.00 at the resume), the chain 4.00"]);
  });
});

describe("the reading: the ledger, the chain at one block, the ledger again", () => {
  function world(sales: number): DB {
    const db = openDb(":memory:");
    audit(db, "owner-signer", "mandate.bound", "customer", { cap: "0.10", budget: "5.00", payee: "0x00000000000000000000000000000000000000b1" });
    for (let i = 1; i <= sales; i++) sale(db, i);
    return db;
  }
  function sale(db: DB, i: number): void {
    db.prepare(`INSERT INTO sales (route, price_cents, payer, settlement_id, tx_hash, request_url, request_params_json, status, created_at)
                VALUES ('GET /v1/stock', 5, '0xc1', ?, ?, 'u', '{}', 'DELIVERED', ?)`).run(`eip155:63825:eip3009:0xb5d5:0xc1:${nonce(i)}`, tx(i), new Date().toISOString());
  }
  function reader(_db: DB, onChain: () => number, during?: () => void): ChainReader & { reads: number } {
    const r = {
      reads: 0,
      block: async () => 100n + BigInt(r.reads),
      async mandate(_agent: string, block: bigint): Promise<ChainMandate> {
        r.reads++;
        during?.();
        return { ...custChain(Array.from({ length: onChain() }, (_, i) => ({ tx: tx(i + 1), block: block - 1n, amount: u(5) }))), block };
      },
      detail: async (t: string) => ({ nonce: nonce(parseInt(t.slice(2), 16)), at: null }),
    };
    return r;
  }

  it("a sale recorded while the chain was read: read again, and the two agree", async () => {
    const db = world(66);
    // The 67th is on chain; its row lands while the chain is read.
    const r = reader(db, () => 67, () => { if (r.reads === 1) sale(db, 67); });
    const [c] = await dashboardVsChain(db, r);
    expect(r.reads).toBe(2);
    expect(c).toEqual({ agent: "customer", ok: true, differences: [], notes: [] });
  });

  it("a sale on chain the ledger never records: fails loudly and names it", async () => {
    const db = world(66);
    const r = reader(db, () => 67);
    const [c] = await dashboardVsChain(db, r);
    expect(c!.ok).toBe(false);
    expect(c!.differences[0]).toMatch(/the chain 3\.35 at block 100: tx 0x0000000000…0043 \(0\.05 in block 99\) is on chain under the customer mandate, but the ledger has no payment for it \(nonce 0x00000000…\)/);
  });

  it("a chain that cannot be read fails every mandate, in one line and without the node's URL", async () => {
    const db = world(1);
    // A made-up node URL, put together here so no scanner takes the test for a leaked key.
    const fakeKey = ["k3y", "s3cr3t", "0123456789"].join("-"), fakeParam = ["abc", "def", "123456"].join("");
    const env = { METAL_RPC_URL: `https://rpc.example.test/v3/${fakeKey}?${"api"}${"key"}=${fakeParam}` };
    const err = new Error(`HTTP request failed.\n\nURL: ${env.METAL_RPC_URL}\nDetails: 401`);
    expect(plain(err, env)).toBe("HTTP request failed.");
    expect(plain(new Error(`invalid project id /v3/${fakeKey} (${"api"}${"key"}=${fakeParam})`), env)).toBe("invalid project id /v3/[redacted] (apikey=[redacted])");
    expect(plain(new Error(`request to ${env.METAL_RPC_URL} failed`), env)).not.toContain(fakeKey);
    expect(plain(new Error(`request to ${env.METAL_RPC_URL} failed`), env)).not.toContain(fakeParam);
    const r = { block: async () => { throw err; }, mandate: async () => { throw new Error("not reached"); }, detail: async () => ({ nonce: null, at: null }) };
    const prev = process.env.METAL_RPC_URL;
    process.env.METAL_RPC_URL = env.METAL_RPC_URL;
    try {
      expect(await dashboardVsChain(db, r, 1)).toEqual([{ agent: "customer", ok: false, differences: ["could not read it on chain: HTTP request failed."], notes: [] }]);
    } finally {
      if (prev === undefined) delete process.env.METAL_RPC_URL; else process.env.METAL_RPC_URL = prev;
    }
  });

  it("a ledger that never stops moving is compared as read before the chain, and says so", async () => {
    // Each time the chain is read at its block, a sale from after that block lands in the ledger. Read after the chain,
    // the ledger would have a paid sale the chain does not have at that block; read before it, the two agree.
    const db = world(1);
    let k = 1;
    const r = {
      reads: 0,
      block: async () => 100n + BigInt(r.reads),
      async mandate(_agent: string, block: bigint): Promise<ChainMandate> {
        r.reads++;
        const m = { ...custChain(Array.from({ length: k }, (_, i) => ({ tx: tx(i + 1), block: block - 1n, amount: u(5) }))), block };
        k++;
        sale(db, k);
        return m;
      },
      detail: async (t: string) => ({ nonce: nonce(parseInt(t.slice(2), 16)), at: null }),
    };
    const [c] = await dashboardVsChain(db, r, 3);
    expect(r.reads).toBe(3);
    expect(c).toMatchObject({ ok: true, differences: [] });
    expect(c!.notes).toContain("the ledger kept changing during 3 readings; this is the last one");
  });
});
