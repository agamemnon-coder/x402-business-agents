// Night batch, 2 November: in 2 of 10 live worlds (dry-145, dry-146) the CFO dashboard showed Summit's buying mandate
// 0.06 / 0.05 less spent than Metal (1.87 against 1.93; 3.30 against 3.35), with 0.00 pending. Each time the difference
// was the world's last sale: its block came about a second before the seller wrote the sale's row, and the dashboard
// was read in between (ledger copies: sale 33 of dry-145 in block 13253913 at 16:07:51, its row at 16:07:52.299; sale 67
// of dry-146 in block 13271973 at 16:30:44, its row at 16:30:45.114). Nothing recorded the payment until the row.
//
// Here the seller's own settle hooks run in that order on a ledger like dry-146's, and the dashboard is read between
// the block and the row: it must show the chain's figure as spent plus a pending line, never a bare difference.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DB } from "../src/db/open.js";

type Hook = (ctx: Record<string, unknown>) => Promise<unknown>;
const hooks = vi.hoisted(() => ({ before: [] as Hook[], after: [] as Hook[], failure: [] as Hook[] }));

// The x402 server stands aside: the test calls the seller's hooks itself, in the order the server calls them.
vi.mock("@x402/core/server", () => ({
  HTTPFacilitatorClient: class {},
  x402ResourceServer: class {
    register() { return this; }
    onBeforeSettle(h: Hook) { hooks.before.push(h); return this; }
    onAfterSettle(h: Hook) { hooks.after.push(h); return this; }
    onSettleFailure(h: Hook) { hooks.failure.push(h); return this; }
  },
}));
vi.mock("@x402/express", () => ({ paymentMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next() }));
vi.mock("@metalntwx/metal-pay", async (orig) => ({ ...(await orig<object>()), registerMetalScheme: (s: unknown) => s }));
vi.mock("@metalntwx/metal-pay/mandates", async (orig) => ({ ...(await orig<object>()), requireSignedOffer: (s: unknown) => s }));

const { openDb } = await import("../src/db/open.js");
const { audit } = await import("../src/audit/log.js");
const { buildSnapshot } = await import("../src/dashboard/snapshot.js");
const { sellerApp } = await import("../src/servers/seller.js");
const { dashboardVsChain } = await import("../src/metal/dashboardVsChain.js");
const { mandateAvailability } = await import("../src/policy/available.js");
const { centsToBaseUnits } = await import("../src/lib/money.js");

const PAYER = "0xdeb2b72781c12b9d2cd66798f47161c88601dd5f";
const BUSINESS = "0x00000000000000000000000000000000000000b1";
const nonce = (n: number) => `0x${(0xa5bb0000 + n).toString(16).padStart(64, "0")}`;
const tx = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;
const settlementId = (n: number) => `eip155:63825:eip3009:0x000000000000000000000000000000000000b5d5:${PAYER}:${nonce(n)}`;

beforeEach(() => { hooks.before = []; hooks.after = []; hooks.failure = []; vi.stubEnv("METAL_RPC_URL", "http://127.0.0.1:1"); });
afterEach(() => vi.unstubAllEnvs());

/** dry-146's customer mandate (cap 0.10, budget 5.00) after 66 stock checks of 0.05: 3.30 paid. */
function world(): DB {
  const db = openDb(":memory:");
  audit(db, "owner-signer", "mandate.bound", "customer", { cap: "0.10", budget: "5.00", payee: BUSINESS });
  for (let i = 1; i <= 66; i++) {
    db.prepare(`INSERT INTO sales (route, price_cents, payer, settlement_id, tx_hash, request_url, request_params_json, status, created_at)
                VALUES ('GET /v1/stock', 5, ?, ?, ?, 'u', '{}', 'DELIVERED', ?)`).run(PAYER, settlementId(i), tx(i), new Date().toISOString());
  }
  sellerApp({ db, payTo: BUSINESS, price: () => "0.05", buyUpstream: async () => ({ ok: true, purchaseId: 0, body: { stock: {} } }) });
  return db;
}

/** What the x402 server hands the seller's hooks for sale n. */
function ctx(n: number, extra: Record<string, unknown> = {}) {
  return {
    paymentPayload: { x402Version: 2, payload: { authorization: { from: PAYER, to: BUSINESS, value: String(centsToBaseUnits(5)), nonce: nonce(n) } } },
    requirements: { scheme: "exact", network: "eip155:63825", amount: String(centsToBaseUnits(5)) },
    transportContext: { responseBody: Buffer.from('{"seller":"Northwind Outdoor","seq":70,"stock":{}}'), request: { adapter: { getUrl: () => "http://127.0.0.1/v1/stock?seq=70" } }, responseHeaders: {} },
    ...extra,
  };
}
const settled = (n: number) => ({ result: { success: true, transaction: tx(n), network: "eip155:63825", payer: PAYER, extra: { settlement: { id: settlementId(n), first: true } } } });

/** Metal as the chain read it a moment after sale n's block: n payments of 0.05 under the customer's mandate. */
const chainWith = (n: number) => ({
  block: async () => 13271980n,
  mandate: async () => {
    const payments = Array.from({ length: n }, (_, i) => ({ tx: tx(i + 1), block: 13271973n - BigInt(n - 1 - i), amount: centsToBaseUnits(5) }));
    return { perPaymentCap: centsToBaseUnits(10), budget: centsToBaseUnits(500), spent: centsToBaseUnits(5 * n), revoked: false, bound: true, block: 13271980n, payments };
  },
  detail: async (t: string) => ({ nonce: nonce(parseInt(t.slice(2), 16)), at: "2026-11-02T16:30:44.000Z" }),
});
const customer = (db: DB) => buildSnapshot(db).budgets.counterparty!;

describe("a sale between its block and its row (dry-146, 2 November)", () => {
  it("the dashboard shows the payment as pending while it is settled, so it agrees with the chain", async () => {
    const db = world();
    for (const h of hooks.before) expect(await h(ctx(67))).toBeUndefined();
    // Metal's block holds sale 67 now; the seller has not written its row. This is the moment the night batch read.
    expect(customer(db)).toMatchObject({ spent: "3.30", pending: "0.05", remaining: "1.65" });
    const [c] = await dashboardVsChain(db, chainWith(67));
    expect(c).toMatchObject({ agent: "customer", ok: true, differences: [] });
    expect(c!.notes[0]).toMatch(/^tx 0x0000000000…0043 \(0\.05 in block 13271973, 2026-11-02T16:30:44\.000Z\) is on chain; the ledger has a sale being settled \(paid by 0xdeb2b727…\) on its way \(shown as pending\)$/);
    // The settle answer: the row, and in the same transaction the pending line closes.
    for (const h of hooks.after) await h({ ...ctx(67), ...settled(67) });
    expect(customer(db)).toMatchObject({ spent: "3.35", pending: "0.00", remaining: "1.65" });
    expect(db.prepare("SELECT status, sale_id, tx_hash FROM sale_settlements").all()).toEqual([{ status: "DONE", sale_id: 67, tx_hash: tx(67) }]);
    expect(await dashboardVsChain(db, chainWith(67))).toEqual([{ agent: "customer", ok: true, differences: [], notes: [] }]);
  });

  it("a ledger without the pending line fails loudly and names the payment (the night batch's reading)", async () => {
    const db = world();
    const [c] = await dashboardVsChain(db, chainWith(67));
    expect(c!.ok).toBe(false);
    expect(c!.differences[0]).toMatch(/^spent: the dashboard shows 3\.30 spent \(0\.00 pending\), the chain 3\.35 at block 13271980: tx 0x0000000000…0043 \(0\.05 in block 13271973, 2026-11-02T16:30:44\.000Z\) is on chain under the customer mandate, but the ledger has no payment for it/);
  });

  it("a settle the facilitator refuses closes the pending line; one with an unknown outcome keeps it", async () => {
    const db = world();
    for (const h of hooks.before) await h(ctx(67));
    for (const h of hooks.failure) await h({ ...ctx(67), error: Object.assign(new Error("payment failed"), { errorReason: "payment_failed" }) });
    expect(customer(db)).toMatchObject({ spent: "3.30", pending: "0.00" });
    for (const h of hooks.before) await h(ctx(68));
    for (const h of hooks.failure) await h({ ...ctx(68), error: new Error("fetch failed") });
    // Nothing says it did not move: it stays pending, with the reason, until the chain check or a person resolves it.
    expect(customer(db)).toMatchObject({ spent: "3.30", pending: "0.05" });
    expect(db.prepare("SELECT status, detail FROM sale_settlements ORDER BY started_at, key").all()).toEqual([
      { status: "FAILED", detail: "payment_failed" },
      { status: "SETTLING", detail: "outcome unknown, it may have settled: fetch failed" },
    ]);
    // The same payment tried again after a refused settle is on its way again.
    for (const h of hooks.before) await h(ctx(67));
    expect(mandateAvailability(db, "customer")).toMatchObject({ paidCents: 330, pendingCents: 10 });
  });

  it("a repeated settle answer for a sale already recorded closes its line against that sale", async () => {
    const db = world();
    for (const h of hooks.before) await h(ctx(67));
    for (const h of hooks.after) await h({ ...ctx(67), ...settled(67) });
    for (const h of hooks.before) await h(ctx(67));
    for (const h of hooks.after) await h({ ...ctx(67), result: { ...settled(67).result, extra: { settlement: { id: settlementId(67), first: false } } } });
    expect(customer(db)).toMatchObject({ spent: "3.35", pending: "0.00" });
    expect(db.prepare("SELECT COUNT(*) AS n FROM sales").get()).toEqual({ n: 67 });
  });

  it("if the payment cannot be written down first, the settle does not start (nobody is charged)", async () => {
    const db = world();
    db.exec("DROP TABLE sale_settlements");
    const [r] = await Promise.all(hooks.before.map((h) => h(ctx(67))));
    expect(r).toMatchObject({ abort: true, reason: "ledger_unavailable" });
    // Recorded as the settle failures are (the server's failure hooks do not run after an abort): the upstream cost is written off.
    const row = db.prepare("SELECT subject, json_extract(payload_json, '$.error') AS error FROM audit_log WHERE event = 'sale.settle_failed'").get() as { subject: string | null; error: string };
    expect(row.error).toMatch(/^the payment could not be written down before its settle, so it was not settled and the customer was not charged/);
    expect(buildSnapshot(db).feed.some((f) => /A sale did not settle; the customer was not charged/.test(f.text))).toBe(true);
  });

  it("a replay refused while the first settle of the same payment is still waiting leaves it on its way", async () => {
    const db = world();
    for (const h of hooks.before) await h(ctx(67)); // the first request's settle is sent
    for (const h of hooks.before) await h(ctx(67)); // a replay of the same payment
    for (const h of hooks.failure) await h({ ...ctx(67), error: Object.assign(new Error("nonce"), { errorReason: "payment_failed" }) });
    expect(db.prepare("SELECT status, inflight FROM sale_settlements").get()).toEqual({ status: "SETTLING", inflight: 1 });
    for (const h of hooks.after) await h({ ...ctx(67), ...settled(67) });
    expect(db.prepare("SELECT status, inflight FROM sale_settlements").get()).toEqual({ status: "DONE", inflight: 0 });
    expect(customer(db)).toMatchObject({ spent: "3.35", pending: "0.00" });
  });

  it("a ledger from before clearing (no scheme column, opened read-only) still reads the mandate's figures", async () => {
    const { mkdtempSync, rmSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const Database = (await import("better-sqlite3")).default;
    const dir = mkdtempSync(join(tmpdir(), "old-ledger-"));
    try {
      const path = join(dir, "old.sqlite");
      const w = openDb(path);
      audit(w, "owner-signer", "mandate.bound", "customer", { cap: "0.10", budget: "5.00", payee: BUSINESS });
      w.prepare(`INSERT INTO sales (route, price_cents, payer, tx_hash, request_url, request_params_json, status, created_at) VALUES ('GET /v1/stock', 5, ?, ?, 'u', '{}', 'DELIVERED', 'now')`).run(PAYER, tx(1));
      w.exec("ALTER TABLE sales DROP COLUMN clearing_json; ALTER TABLE sales DROP COLUMN scheme; DROP TABLE sale_settlements");
      w.close();
      const ro = new Database(path, { readonly: true });
      // The mandate's figures (the rest of the snapshot has its own needs of an old ledger).
      expect(mandateAvailability(ro, "customer")).toMatchObject({ paidCents: 5, pendingCents: 0 });
      const { mandatePayments } = await import("../src/policy/available.js");
      expect(mandatePayments(ro, "customer")).toEqual([{ what: "sale 1", cents: 5, tx: tx(1), nonce: null, state: "paid" }]);
      ro.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a clearing sale is not the mandate's: paid from Summit's deposit, Metal's mandate does not count it", () => {
    const db = world();
    db.prepare(`INSERT INTO sales (route, price_cents, payer, request_url, request_params_json, status, created_at, scheme)
                VALUES ('GET /v1/stock/prepaid', 5, '0x03', 'u', '{}', 'DELIVERED', 'now', 'bajillion')`).run();
    expect(customer(db)).toMatchObject({ spent: "3.30", pending: "0.00" });
  });
});
