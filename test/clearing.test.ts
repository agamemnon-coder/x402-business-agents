// Metal clearing for data sales: the prepaid route offers itself only when it can deliver (a clearing payment is
// counted before the seller can say no), Summit falls back to the mandate route only when nothing was paid, and the
// dashboard shows the prepaid budget apart from the mandates.
import type { AddressInfo } from "node:net";
import { encodePaymentRequiredHeader } from "@x402/core/http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { audit } from "../src/audit/log.js";
import { CustomerAgent, type ClearingAttempt, type Purchase } from "../src/agents/customer.js";
import { SourcingAgent } from "../src/agents/sourcing.js";
import { buildSnapshot } from "../src/dashboard/snapshot.js";
import { openDb } from "../src/db/open.js";
import { betweenEpochs } from "../src/metal/clearing.js";
import { PREPAID_ROUTE, sellerApp } from "../src/servers/seller.js";

const SUPPLIER = "0x00000000000000000000000000000000000000f1";
const offer = (cents: number) => encodePaymentRequiredHeader({
  x402Version: 2, resource: { url: "http://supplier/v1/stock-check" },
  accepts: [{ scheme: "exact", network: "eip155:63825", amount: (BigInt(cents) * 10n ** 16n).toString(), asset: "0x000000000000000000000000000000000000B5d5", payTo: SUPPLIER, maxTimeoutSeconds: 60, extra: {} }],
} as never);

afterEach(() => vi.unstubAllGlobals());

describe("the free price check before a prepaid sale", () => {
  function sourcing(cap: string, policy?: string) {
    const db = openDb(":memory:");
    audit(db, "owner-signer", "mandate.bound", "sourcing", { cap, budget: "10.00", payee: SUPPLIER });
    if (policy) db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('cap.sourcing', ?, 'now')").run(policy);
    return new SourcingAgent(db, "http://supplier", SUPPLIER);
  }
  const supplierAsks = (cents: number) => vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 402, headers: { "payment-required": offer(cents) } })));

  it("offers when the supplier's price is within the mandate and the policy", async () => {
    supplierAsks(4);
    expect(await sourcing("0.04", "0.04").wouldRefuse(1)).toBeNull();
  });
  it("refuses over the mandate's cap or over the CFO policy, without paying anything", async () => {
    supplierAsks(4);
    expect(await sourcing("0.03").wouldRefuse(1)).toMatch(/^mandate_cap_exceeded: the supplier asks 0.04, over the sourcing mandate's 0.03/);
    expect(await sourcing("0.04", "0.03").wouldRefuse(1)).toMatch(/^policy_cap_exceeded/);
    const f = vi.mocked(fetch);
    expect(f.mock.calls.every(([, init]) => !(init as RequestInit | undefined)?.headers)).toBe(true);
  });
  it("refuses when the supplier makes no offer", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("down", { status: 500 })));
    expect(await sourcing("0.04").wouldRefuse(1)).toMatch(/answered 500 without an offer/);
  });
});

describe("the prepaid route", () => {
  const servers: { close: () => void }[] = [];
  afterEach(() => { while (servers.length) servers.pop()!.close(); });

  it("answers 503 before any offer when it cannot deliver, so nobody pays", async () => {
    vi.stubEnv("METAL_RPC_URL", "http://127.0.0.1:1");
    const db = openDb(":memory:");
    const app = sellerApp({
      db, payTo: SUPPLIER, price: () => "0.07", buyUpstream: async () => { throw new Error("must not buy"); },
      clearing: { payTo: `0x03${"ab".repeat(32)}`, preflight: async () => "policy_cap_exceeded: 0.04 is over the sourcing limit of 0.03" },
    });
    const server = app.listen(0, "127.0.0.1");
    servers.push(server);
    await new Promise<void>((r) => server.once("listening", () => r()));
    const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}${PREPAID_ROUTE}?seq=7`);
    expect(res.status).toBe(503);
    expect(res.headers.get("payment-required")).toBeNull();
    expect(((await res.json()) as { error: string }).error).toMatch(/not offered/);
    expect(db.prepare("SELECT event, subject FROM audit_log").all()).toEqual([{ event: "sale.prepaid_not_offered", subject: "7" }]);
    vi.unstubAllEnvs();
  });
});

describe("Summit's fallback", () => {
  const paidOnMandate: Purchase = { seq: 1, via: "mandate", outcome: { kind: "refused", reason: "x", status: 503, body: "" }, charged: false };
  function agent(attempt: ClearingAttempt) {
    const a = new CustomerAgent("http://seller", SUPPLIER);
    const mandateBuys: number[] = [];
    a.tryClearing = async () => attempt;
    a.buy = async (seq) => { mandateBuys.push(seq); return { ...paidOnMandate, seq }; };
    return { a, mandateBuys };
  }

  it("uses the mandate route only when clearing took nothing", async () => {
    const { a, mandateBuys } = agent({ kind: "unused", reason: "prepaid clearing is not offered for this stock check now" });
    expect(await a.buyPrepaid(5)).toMatchObject({ via: "mandate", seq: 5, fallbackFrom: "prepaid clearing is not offered for this stock check now" });
    expect(mandateBuys).toEqual([5]);
  });
  it("never pays a second way when a clearing payment may have been counted", async () => {
    const { a, mandateBuys } = agent({ kind: "in_doubt", reason: "payment_held" });
    expect(await a.buyPrepaid(6)).toMatchObject({ via: "clearing", charged: true });
    expect(mandateBuys).toEqual([]);
  });
  it("reports a clearing sale, and one paid but owed", async () => {
    expect(await agent({ kind: "paid", status: 200, body: "{}" }).a.buyPrepaid(7)).toMatchObject({ via: "clearing", status: 200, charged: true });
    expect(await agent({ kind: "owed", status: 503, body: "refused" }).a.buyPrepaid(8)).toMatchObject({ via: "clearing", status: 503, charged: true });
  });
  it("recognises the service's pause between epochs, also inside an error's causes", () => {
    expect(betweenEpochs(new Error("Failed to create payment payload", { cause: Object.assign(new Error("x"), { reason: "between_epochs" }) }))).toBe(true);
    expect(betweenEpochs(new Error("clearing is between epochs: ..."))).toBe(true);
    expect(betweenEpochs(new Error("insufficient_deposit"))).toBe(false);
  });
});

describe("the prepaid clearing budget on the dashboard", () => {
  it("is shown apart from the mandates: deposit, clearing sales, and what Metal last reported", () => {
    const db = openDb(":memory:");
    expect(buildSnapshot(db).clearing).toBeNull();
    const op = db.prepare("INSERT INTO clearing_ops (party, kind, units, tx, detail, created_at) VALUES (?, ?, ?, NULL, NULL, ?)");
    op.run("customer", "deposit", (5n * 10n ** 18n).toString(), "2026-10-29T16:40:00Z");
    op.run("customer", "balance", (465n * 10n ** 16n).toString(), "2026-10-29T16:50:00Z");
    op.run("seller", "balance", (35n * 10n ** 16n).toString(), "2026-10-29T16:50:01Z");
    db.prepare(`INSERT INTO sales (route, price_cents, payer, request_url, request_params_json, status, created_at, scheme)
                VALUES ('GET /v1/stock/prepaid', 7, '0x03', 'u', '{"seq":"60"}', 'DELIVERED', 'now', 'bajillion')`).run();
    audit(db, "system", "sale.delivered", "1", { settlement_id: "id", scheme: "bajillion" });
    const s = buildSnapshot(db);
    // What the customer paid comes from Metal's balance, so receipts made before this ledger count too.
    expect(s.clearing).toEqual({ customer: "Summit Outfitters", deposited: "5.00", charged: "0.35", sales: 1, earned: "0.07", customer_spendable: "4.65", seller_spendable: "0.35", as_of: "2026-10-29T16:50:01Z", withdrawn: "0.00" });
    expect(s.feed[0]!.text).toBe("Sold stock check #60 to Summit Outfitters for 0.07 USDZ by Metal clearing (a receipt, no transaction)");
  });
});
