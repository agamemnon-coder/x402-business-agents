// The seller (src/servers/seller.ts) beyond the mandate sale the settle tests cover: the prepaid (clearing) route, which
// counts the buyer's payment before the handler runs, so a refused upstream purchase leaves a sale owed (and recorded as
// such) instead of a delivered one; the free price check in front of it; a bad seq; a payment the ledger cannot write
// down before its settle (the settle is aborted: nobody is charged); and a sub-cent amount, which is never a sale.
import type { AddressInfo } from "node:net";
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
// A clearing payment here is any payload marked as one; its id is its own (the codec's signatures are tested upstream).
vi.mock("@metalntwx/metal-pay", async (orig) => ({
  ...(await orig<object>()),
  registerMetalScheme: (s: unknown) => s,
  ClearingServerScheme: class {},
  clearingPaymentOf: (p: { payload?: { clearing_test?: string } } | undefined) => (p?.payload?.clearing_test ? p.payload : null),
  clearingPaymentId: (paid: { clearing_test: string }) => `eip155:63825:bajillion:${paid.clearing_test}`,
}));
vi.mock("@metalntwx/metal-pay/mandates", async (orig) => ({ ...(await orig<object>()), requireSignedOffer: (s: unknown) => s }));

const { openDb } = await import("../src/db/open.js");
const { sellerApp, PREPAID_ROUTE, SELLER_ROUTE, priceToCents } = await import("../src/servers/seller.js");
const { centsToBaseUnits } = await import("../src/lib/money.js");

const PAYER = "0xdeb2b72781c12b9d2cd66798f47161c88601dd5f";
const BUSINESS = "0x00000000000000000000000000000000000000b1";
const CLEARING_KEY = `0x03${"ab".repeat(32)}` as const;
const header = (payload: unknown) => Buffer.from(JSON.stringify({ x402Version: 2, payload })).toString("base64");
const events = (db: DB) => db.prepare("SELECT event, subject, payload_json FROM audit_log ORDER BY seq").all() as { event: string; subject: string | null; payload_json: string }[];

const servers: { close: () => void }[] = [];
beforeEach(() => { hooks.before = []; hooks.after = []; hooks.failure = []; vi.stubEnv("METAL_RPC_URL", "http://127.0.0.1:1"); });
afterEach(() => { while (servers.length) servers.pop()!.close(); vi.unstubAllEnvs(); });

type Up = Parameters<typeof sellerApp>[0]["buyUpstream"];
async function serve(db: DB, buyUpstream: Up, preflight: (seq: number) => Promise<string | null> = async () => null) {
  const server = sellerApp({ db, payTo: BUSINESS, price: () => "0.05", buyUpstream, clearing: { payTo: CLEARING_KEY, preflight } }).listen(0, "127.0.0.1");
  servers.push(server);
  await new Promise<void>((r) => server.once("listening", () => r()));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
const stock = { on_hand: 12, reserved: 2 };

describe("the prepaid route's free price check", () => {
  it("refuses a seq that is not a positive integer before checking anything", async () => {
    const db = openDb(":memory:");
    const preflight = vi.fn(async () => null);
    const base = await serve(db, async () => { throw new Error("must not buy"); }, preflight);
    for (const seq of ["0", "-3", "1.5", "x"]) {
      const res = await fetch(`${base}${PREPAID_ROUTE}?seq=${seq}`);
      expect(res.status, seq).toBe(400);
    }
    expect(preflight).not.toHaveBeenCalled();
    expect(events(db)).toEqual([]);
  });

  it("is not offered when the price cannot be checked, and says why", async () => {
    const db = openDb(":memory:");
    const base = await serve(db, async () => { throw new Error("must not buy"); }, async () => { throw new Error("supplier timed out"); });
    const res = await fetch(`${base}${PREPAID_ROUTE}?seq=4`);
    expect(res.status).toBe(503);
    const body = await res.json() as { reason: string; route: string };
    expect(body).toMatchObject({ route: SELLER_ROUTE, reason: "the supplier's price could not be checked (supplier timed out)" });
    expect(events(db).map((e) => [e.event, e.subject])).toEqual([["sale.prepaid_not_offered", "4"]]);
  });
});

describe("the mandate route", () => {
  it("refuses a seq that is not a positive integer and buys nothing", async () => {
    const db = openDb(":memory:");
    const buy = vi.fn(async () => ({ ok: true as const, purchaseId: 1, body: { stock } }));
    const base = await serve(db, buy);
    expect((await fetch(`${base}${SELLER_ROUTE}?seq=0`)).status).toBe(400);
    expect((await fetch(`${base}${SELLER_ROUTE}`)).status).toBe(400);
    expect(buy).not.toHaveBeenCalled();
  });
});

describe("a prepaid sale", () => {
  const paidHeader = (id: string) => header({ clearing_test: id });
  const settle = async (id: string, success = true) => {
    for (const h of hooks.before) expect(await h({ paymentPayload: { payload: { clearing_test: id } } })).toBeUndefined();
    for (const h of hooks.after) {
      await h({
        paymentPayload: { payload: { clearing_test: id } },
        requirements: { scheme: "bajillion", amount: String(centsToBaseUnits(5)), payTo: CLEARING_KEY },
        result: { success, payer: PAYER, extra: { clearing: { receipt: `r-${id}` } } },
      });
    }
  };

  it("is recorded with the body delivered, its payer, amount and the clearing receipt, once", async () => {
    const db = openDb(":memory:");
    // The supplier's stock check, bought first under the sourcing mandate (the sale points at it).
    db.prepare("INSERT INTO upstream_purchases (id, price_cents, outcome, created_at) VALUES (31, 2, 'PAID', ?)").run(new Date().toISOString());
    const base = await serve(db, async () => ({ ok: true, purchaseId: 31, body: { stock } }));
    await settle("p1");
    const res = await fetch(`${base}${PREPAID_ROUTE}?seq=9`, { headers: { "payment-signature": paidHeader("p1") } });
    expect(res.status).toBe(200);
    expect(res.headers.get("x-upstream-purchase")).toBe("31");
    const body = await res.text();
    expect(JSON.parse(body)).toEqual({ seller: "Northwind Outdoor", seq: 9, stock });
    const sale = db.prepare("SELECT route, price_cents, payer, settlement_id, upstream_purchase_id, body_json, scheme, clearing_json, request_params_json FROM sales").get() as Record<string, unknown>;
    expect(sale).toMatchObject({ route: `GET ${PREPAID_ROUTE}`, price_cents: 5, payer: PAYER, settlement_id: "eip155:63825:bajillion:p1", upstream_purchase_id: 31, body_json: body, scheme: "bajillion", request_params_json: '{"seq":"9"}' });
    expect(JSON.parse(String(sale.clearing_json))).toEqual({ paid: { clearing_test: "p1" }, settled: { receipt: "r-p1" } });
    expect(events(db).map((e) => [e.event, e.subject])).toEqual([["sale.delivered", "1"]]);

    // The same payment shown again: the settled record was used once, and the second row is ignored (same settlement id).
    const again = await fetch(`${base}${PREPAID_ROUTE}?seq=9`, { headers: { "payment-signature": paidHeader("p1") } });
    expect(again.status).toBe(200);
    expect(db.prepare("SELECT COUNT(*) AS n FROM sales").get()).toEqual({ n: 1 });
    expect(events(db).filter((e) => e.event === "sale.delivered")).toHaveLength(1);
  });

  it("refused upstream after payment is recorded as owed (to refund), never as delivered", async () => {
    const db = openDb(":memory:");
    const base = await serve(db, async () => ({ ok: false, purchaseId: 32, reason: "supplier out of stock", inDoubt: false }));
    await settle("p2");
    const res = await fetch(`${base}${PREPAID_ROUTE}?seq=10`, { headers: { "payment-signature": paidHeader("p2") } });
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: string }).error).toMatch(/refunded/);
    expect(db.prepare("SELECT COUNT(*) AS n FROM sales").get()).toEqual({ n: 0 });
    const [e] = events(db);
    expect(e).toMatchObject({ event: "sale.prepaid_undelivered", subject: "10" });
    expect(JSON.parse(e!.payload_json)).toEqual({ seq: 10, clearing_id: "eip155:63825:bajillion:p2", payer: PAYER, reason: "supplier out of stock" });
  });

  it("a failed clearing settle keeps nothing for the handler, so no payer is credited to the sale", async () => {
    const db = openDb(":memory:");
    const base = await serve(db, async () => ({ ok: false, purchaseId: 33, reason: "refused", inDoubt: false }));
    await settle("p3", false);
    const res = await fetch(`${base}${PREPAID_ROUTE}?seq=11`, { headers: { "payment-signature": paidHeader("p3") } });
    expect(res.status).toBe(503);
    expect(JSON.parse(events(db)[0]!.payload_json)).toMatchObject({ clearing_id: "eip155:63825:bajillion:p3", payer: null });
  });

  it("an unreadable payment header is no clearing payment: the row carries no settlement id", async () => {
    const db = openDb(":memory:");
    const base = await serve(db, async () => ({ ok: false, purchaseId: 34, reason: "refused", inDoubt: false }));
    const res = await fetch(`${base}${PREPAID_ROUTE}?seq=12`, { headers: { "payment-signature": "%%% not base64 %%%" } });
    expect(res.status).toBe(503);
    expect(JSON.parse(events(db)[0]!.payload_json)).toMatchObject({ clearing_id: "", payer: null });
  });

  it("a clearing settle failure records the write-off without touching the mandate's settlement lines", async () => {
    const db = openDb(":memory:");
    await serve(db, async () => ({ ok: true, purchaseId: 1, body: { stock } }));
    for (const h of hooks.failure) await h({ paymentPayload: { payload: { clearing_test: "p4" } }, error: new Error("service down"), transportContext: { responseHeaders: { "x-upstream-purchase": "41" } } });
    expect(db.prepare("SELECT COUNT(*) AS n FROM sale_settlements").get()).toEqual({ n: 0 });
    expect(events(db).map((e) => [e.event, e.subject, JSON.parse(e.payload_json)])).toEqual([["sale.settle_failed", "41", { error: "service down" }]]);
  });
});

describe("a mandate payment the ledger cannot write down", () => {
  const ctx = (value: string) => ({
    paymentPayload: { x402Version: 2, payload: { authorization: { from: PAYER, to: BUSINESS, value, nonce: `0x${"0a".repeat(32)}`, validBefore: "1793637600" } } },
    transportContext: { responseHeaders: { "x-upstream-purchase": "77" } },
  });

  it("aborts the settle (the customer is not charged) and records why", async () => {
    const db = openDb(":memory:");
    await serve(db, async () => ({ ok: true, purchaseId: 1, body: { stock } }));
    db.exec("CREATE TRIGGER no_write BEFORE INSERT ON sale_settlements BEGIN SELECT RAISE(ABORT, 'disk full'); END;");
    const [before] = hooks.before;
    expect(await before!(ctx(String(centsToBaseUnits(5))))).toEqual({ abort: true, reason: "ledger_unavailable", message: expect.stringMatching(/nothing was charged/) });
    const [e] = events(db);
    expect(e).toMatchObject({ event: "sale.settle_failed", subject: "77" });
    expect(JSON.parse(e!.payload_json).error).toMatch(/not settled and the customer was not charged: disk full/);
  });

  it("still aborts when even the audit log cannot be written", async () => {
    const db = openDb(":memory:");
    await serve(db, async () => ({ ok: true, purchaseId: 1, body: { stock } }));
    db.exec("CREATE TRIGGER no_write BEFORE INSERT ON sale_settlements BEGIN SELECT RAISE(ABORT, 'disk full'); END;");
    db.exec("CREATE TRIGGER no_audit BEFORE INSERT ON audit_log BEGIN SELECT RAISE(ABORT, 'disk full'); END;");
    expect(await hooks.before[0]!({ ...ctx("not a number"), transportContext: {} })).toMatchObject({ abort: true, reason: "ledger_unavailable" });
  });

  it("never records a sub-cent amount as a sale", async () => {
    const db = openDb(":memory:");
    await serve(db, async () => ({ ok: true, purchaseId: 1, body: { stock } }));
    const subCent = String(centsToBaseUnits(5) + 1n);
    const c = { ...ctx(subCent), requirements: { amount: subCent }, transportContext: { responseBody: Buffer.from("{}"), request: { adapter: { getUrl: () => "http://127.0.0.1/v1/stock?seq=1" } }, responseHeaders: {} } };
    await hooks.before[0]!(c);
    await expect(hooks.after[0]!({ ...c, result: { success: true, transaction: `0x${"11".repeat(32)}`, payer: PAYER, extra: { settlement: { id: "s-1", first: true } } } })).rejects.toThrow(/^sub-cent sale: /);
    expect(db.prepare("SELECT COUNT(*) AS n FROM sales").get()).toEqual({ n: 0 });
  });
});

describe("priceToCents", () => {
  it("reads a dollar price with or without its sign", () => {
    expect(priceToCents("$0.05")).toBe(5);
    expect(priceToCents("1.20")).toBe(120);
  });
});
