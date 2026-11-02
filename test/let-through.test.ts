// Defense in depth, one purchase (Max, 2 November). Purser refuses an over-cap purchase before signing, so Metal never
// refuses one itself. Once per world, armed in the serve loop's memory, exactly one such Sourcing purchase goes on to
// Metal, which must refuse it. (a) When Metal refuses, nothing settles: no transfer, no paid row, no hold left HELD, the
// customer gets 503 and is not charged, the budget is unchanged; the refusal is recorded on chain. (b) The arm applies
// to exactly one purchase: not to within-cap purchases, not to other agents, not while frozen or paused, not to an amount
// Metal could pay, not after the first attempt, not after a restart, not in another world, not after it lapsed.
// (c) If Metal accepts it anyway: an incident (the Sourcing agent stopped, an alarm row), the payment counted.
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DB } from "../src/db/open.js";

const state = vi.hoisted(() => ({ db: null as DB | null, signed: [] as number[], metal: "refuse" as "refuse" | "accept" | "lost", onChain: [] as number[] }));

vi.mock("../src/metal/mandate.js", async (orig) => ({
  ...(await orig<object>()),
  activeMandate: async () => ({ agent: "sourcing", reference: `0x${"12".repeat(32)}`, credentialPath: "", keyFile: "", credential: {}, credentialHash: `0x${"34".repeat(32)}`, principal: `0x${"56".repeat(20)}`, signDigest: async () => "0x" }),
  // The cap written in the bound credential: 0.03.
  boundCapUnits: () => 3n * 10n ** 16n,
}));
// Purser's guard decides whether anything is signed; a signed payment meets "Metal" as the test sets it.
vi.mock("../src/metal/pay.js", async (orig) => ({
  ...(await orig<object>()),
  payUnderMandate: async (_m: unknown, _url: string, _init: unknown, guard?: (cents: number, payTo: string) => string | null) => {
    const { getSetting } = await import("../src/world/settings.js");
    const cents = Math.round(Number(getSetting(state.db!, "upstream_price", "0.02")) * 100);
    const blocked = guard ? guard(cents, "0x0000000000000000000000000000000000000001") : null;
    if (blocked) return { kind: "refused", reason: blocked, status: 0, body: "" };
    state.signed.push(cents);
    const nonce = `0x${String(state.signed.length).padStart(64, "0")}`;
    const paid = { kind: "paid", status: 200, body: JSON.stringify({ supplier: "Stockline", stock: {} }), tx: `0x${"ab".repeat(32)}`, nonce, signedOffer: "", amount: String(BigInt(cents) * 10n ** 16n), payTo: "0x0000000000000000000000000000000000000001" };
    if (cents <= 3 || state.metal === "accept") return paid;
    if (state.metal === "lost") return { kind: "in_doubt", reason: "seller answered 502 without a settlement", status: 502, body: "", nonce };
    return { kind: "refused", reason: "mandate_cap_exceeded", status: 402, body: "", nonce };
  },
  findSettlementByNonce: async () => undefined,
}));
vi.mock("../src/metal/recordRefusal.js", () => ({ recordCapRefusalOnChain: async (_m: unknown, _to: unknown, cents: number) => { state.onChain.push(cents); return { tx: `0x${"cd".repeat(32)}`, reason: "mandate_cap_exceeded" }; } }));
// The x402 middleware stands aside here: the seller's own answer (and its ledger row) is what is tested.
vi.mock("@x402/express", () => ({ paymentMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next() }));

const { openDb } = await import("../src/db/open.js");
const { audit } = await import("../src/audit/log.js");
const { SourcingAgent } = await import("../src/agents/sourcing.js");
const { claimLetThrough, letThrough, requestLetThrough, LET_THROUGH_LABEL, LET_THROUGH_TTL_MS } = await import("../src/world/letThrough.js");
const { reserveSpend } = await import("../src/policy/holds.js");
const { stopped, stopReason } = await import("../src/policy/velocity.js");
const { sellerApp, SELLER_ROUTE } = await import("../src/servers/seller.js");

const env = { ...process.env };
beforeEach(() => { process.env.KIT11_AGENTS = "on"; process.env.KIT11_AUTONOMY = "on"; state.signed = []; state.metal = "refuse"; state.onChain = []; });
afterEach(() => { process.env = { ...env }; vi.unstubAllEnvs(); });

const SUPPLIER = "0x0000000000000000000000000000000000000001" as const;
function world(): DB {
  const db = openDb(":memory:");
  audit(db, "owner-signer", "mandate.bound", "sourcing", { cap: "0.03", budget: "10.00" });
  state.db = db;
  return db;
}
const price = (db: DB, p: string) => db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('upstream_price', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(p, new Date().toISOString());
const set = (db: DB, key: string, value: string) => db.prepare("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value, new Date().toISOString());
const n = (db: DB, sql: string) => (db.prepare(sql).get() as { n: number }).n;
const events = (db: DB, e: string) => n(db, `SELECT COUNT(*) AS n FROM audit_log WHERE event = '${e}'`);
/** The world's serve loop: claims the request and arms its own Sourcing agent. */
function armed(db: DB): InstanceType<typeof SourcingAgent> {
  const a = new SourcingAgent(db, "http://127.0.0.1:1", SUPPLIER);
  requestLetThrough(db);
  expect(claimLetThrough(db)).toMatchObject({ stage: "armed" });
  a.armLetThrough();
  return a;
}

describe("(a) Metal refuses the one purchase let through: nothing settles", () => {
  it("the customer gets 503 and is not charged; no paid row, no hold left HELD, no sale; the refusal is Metal's and recorded on chain", async () => {
    vi.stubEnv("METAL_RPC_URL", "http://127.0.0.1:1");
    const db = world();
    const a = armed(db);
    price(db, "0.04");
    const app = sellerApp({ db, payTo: "0x0000000000000000000000000000000000000009", price: () => "0.05", buyUpstream: (seq) => a.buy(seq) });
    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>((r) => server.once("listening", () => r()));
    const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}${SELLER_ROUTE}?seq=18`);
    server.close();
    expect(res.status).toBe(503);
    // Signed once, at 0.04, and Metal refused it.
    expect(state.signed).toEqual([4]);
    expect(db.prepare("SELECT outcome, refusal_reason, tx_hash, nonce IS NOT NULL AS signed FROM upstream_purchases").all()).toEqual([{ outcome: "REFUSED", refusal_reason: "mandate_cap_exceeded", tx_hash: null, signed: 1 }]);
    expect(JSON.parse((db.prepare("SELECT payload_json FROM audit_log WHERE event = 'upstream.refused'").get() as { payload_json: string }).payload_json)).toMatchObject({ refused_by: "metal", reason: "mandate_cap_exceeded" });
    expect(n(db, "SELECT COUNT(*) AS n FROM upstream_purchases WHERE outcome = 'PAID'")).toBe(0);
    expect(n(db, "SELECT COUNT(*) AS n FROM sales")).toBe(0);
    expect(db.prepare("SELECT status, cents FROM holds").all()).toEqual([{ status: "RELEASED", cents: 4 }]);
    // The customer's side, from the seller: 503, not settled.
    expect(JSON.parse((db.prepare("SELECT payload_json FROM audit_log WHERE event = 'sale.refused'").get() as { payload_json: string }).payload_json)).toMatchObject({ seq: 18, status: 503, settled: false, reason: "mandate_cap_exceeded" });
    // The record: let through, refused by Metal with Max's label, recorded on chain for the 0.04.
    expect(JSON.parse((db.prepare("SELECT payload_json FROM audit_log WHERE event = 'upstream.let_through'").get() as { payload_json: string }).payload_json)).toMatchObject({ seq: 18, amount: "0.04", bound_cap: "0.03", purser_would_refuse: expect.stringMatching(/cap_exceeded/) });
    expect(JSON.parse((db.prepare("SELECT payload_json FROM audit_log WHERE event = 'upstream.let_through_refused'").get() as { payload_json: string }).payload_json)).toMatchObject({ metal_status: 402, metal_reason: "mandate_cap_exceeded", label: LET_THROUGH_LABEL });
    expect(LET_THROUGH_LABEL).toBe("Defense in depth: Purser normally refuses before signing. To prove the rail itself enforces the limit, one purchase was let through to Metal — Metal refused it; nothing moved.");
    expect(state.onChain).toEqual([4]);
    expect(events(db, "upstream.refused_on_chain")).toBe(1);
    expect(letThrough(db)).toMatchObject({ stage: "used", outcome: "metal_refused", seq: 18 });
    expect(stopped(db, "sourcing")).toBe(false);
  });
});

describe("(b) the arm applies to exactly one purchase, and nowhere else", () => {
  it("not after the first attempt: the next over-cap purchase is refused by Purser before signing, as always", async () => {
    const db = world();
    const a = armed(db);
    price(db, "0.04");
    await a.buy(18);
    const r = await a.buy(19);
    expect(r).toMatchObject({ ok: false, reason: expect.stringMatching(/^(policy|mandate)_cap_exceeded:/) });
    expect(state.signed).toEqual([4]);
    expect(events(db, "upstream.let_through")).toBe(1);
    expect(() => requestLetThrough(db)).toThrow(/already let its one purchase through/);
  });

  it("the main run's order: Purser refuses the first over-cap purchase before signing (recorded on chain), then the one let-through meets Metal (recorded too)", async () => {
    const db = world();
    const a = new SourcingAgent(db, "http://127.0.0.1:1", SUPPLIER);
    price(db, "0.04");
    expect(await a.buy(18)).toMatchObject({ ok: false, reason: expect.stringMatching(/cap_exceeded:/) });
    expect(state.signed).toEqual([]);
    requestLetThrough(db);
    claimLetThrough(db);
    a.armLetThrough();
    expect(await a.buy(19)).toMatchObject({ ok: false, reason: "mandate_cap_exceeded" });
    expect(state.signed).toEqual([4]);
    await a.buy(20); // Purser again, before signing; nothing recorded a third time
    expect(state.signed).toEqual([4]);
    const rows = (db.prepare("SELECT payload_json FROM audit_log WHERE event = 'upstream.refused_on_chain' ORDER BY seq").all() as { payload_json: string }[]).map((r) => JSON.parse(r.payload_json));
    expect(rows).toEqual([expect.objectContaining({ seq: 18, amount: "0.04" }), expect.objectContaining({ seq: 19, amount: "0.04", let_through: true })]);
    expect(rows[0]).not.toHaveProperty("let_through");
  });

  it("purchases within the cap are untouched (held and paid as usual); the arm waits for the first cap refusal", async () => {
    const db = world();
    const a = armed(db);
    expect(await a.buy(1)).toMatchObject({ ok: true });
    expect(db.prepare("SELECT status FROM holds").all()).toEqual([{ status: "SETTLED" }]);
    expect(events(db, "upstream.let_through")).toBe(0);
    price(db, "0.04");
    await a.buy(2);
    expect(state.signed).toEqual([2, 4]);
    expect(letThrough(db)).toMatchObject({ outcome: "metal_refused", seq: 2 });
  });

  it("not after a restart: a claimed request is never armed again, and a new process's agent is not armed", async () => {
    const db = world();
    armed(db); // the serve loop that armed it is gone
    expect(claimLetThrough(db)).toBeNull();
    const restarted = new SourcingAgent(db, "http://127.0.0.1:1", SUPPLIER);
    price(db, "0.04");
    expect(await restarted.buy(18)).toMatchObject({ ok: false, reason: expect.stringMatching(/cap_exceeded:/) });
    expect(state.signed).toEqual([]);
  });

  it("not in another world: a request in one ledger arms nothing in another", () => {
    const one = world();
    const other = openDb(":memory:");
    requestLetThrough(one);
    expect(claimLetThrough(other)).toBeNull();
    expect(letThrough(other)).toBeNull();
  });

  it("not to other agents: their over-cap payments are refused by Purser as before", () => {
    const db = world();
    armed(db);
    set(db, "cap.support", "0.15");
    expect(reserveSpend(db, { agent: "support", rail: "metal", cents: 500, ref: "refund:x", payee: "customer" })).toMatch(/cap_exceeded|budget|exceeded/);
    expect(n(db, "SELECT COUNT(*) AS n FROM holds")).toBe(0);
  });

  it("not while the CFO's emergency stop or a pause is on: nothing is signed, and the arm still waits for a cap refusal", async () => {
    for (const key of ["freeze", "pause.sourcing"]) {
      const db = world();
      const a = armed(db);
      set(db, key, "on");
      price(db, "0.04");
      expect(await a.buy(18)).toMatchObject({ ok: false, reason: expect.stringMatching(/^(frozen_by_cfo|paused_by_cfo)/) });
      expect(state.signed).toEqual([]);
      // A freeze or pause refuses before the cap: that is not a cap refusal, so the arm is still waiting.
      expect(letThrough(db)).toMatchObject({ stage: "armed" });
    }
  });

  it("not for an amount Metal could pay: over the CFO's policy limit but within the bound credential's cap", async () => {
    const db = world();
    const a = armed(db);
    set(db, "cap.sourcing", "0.02");
    price(db, "0.03");
    expect(await a.buy(18)).toMatchObject({ ok: false, reason: expect.stringMatching(/^policy_cap_exceeded/) });
    expect(state.signed).toEqual([]);
    expect(letThrough(db)).toMatchObject({ stage: "used", outcome: "not_let_through", detail: expect.stringMatching(/not over the cap in the bound credential/) });
  });

  it("not after it lapsed", async () => {
    const db = world();
    const a = new SourcingAgent(db, "http://127.0.0.1:1", SUPPLIER);
    requestLetThrough(db);
    claimLetThrough(db);
    a.armLetThrough(Date.now() - LET_THROUGH_TTL_MS - 1000);
    price(db, "0.04");
    await a.buy(18);
    expect(state.signed).toEqual([]);
    // The ledger's request lapses too, and a pending one that was never claimed in time.
    expect(claimLetThrough(db, new Date(Date.now() + LET_THROUGH_TTL_MS + 1000))).toBeNull();
    expect(letThrough(db)).toMatchObject({ stage: "expired" });
    const other = world();
    requestLetThrough(other, new Date(Date.now() - LET_THROUGH_TTL_MS - 1000));
    expect(claimLetThrough(other)).toBeNull();
  });

  it("one request at a time", () => {
    const db = world();
    requestLetThrough(db);
    expect(() => requestLetThrough(db)).toThrow(/already pending/);
  });
});

describe("(c) Metal accepts it anyway: an incident", () => {
  it("the payment is counted, the Sourcing agent is stopped (only the CFO lifts it), and an alarm row is written", async () => {
    const db = world();
    const a = armed(db);
    state.metal = "accept";
    price(db, "0.04");
    expect(await a.buy(18)).toMatchObject({ ok: true });
    expect(db.prepare("SELECT outcome, price_cents FROM upstream_purchases").all()).toEqual([{ outcome: "PAID", price_cents: 4 }]);
    expect(db.prepare("SELECT status FROM holds").all()).toEqual([{ status: "SETTLED" }]);
    expect(events(db, "upstream.let_through_incident")).toBe(1);
    expect(stopped(db, "sourcing")).toBe(true);
    expect(stopReason(db, "sourcing")?.reason).toMatch(/^incident: Metal accepted/);
    expect(letThrough(db)).toMatchObject({ stage: "used", outcome: "incident" });
    // Stopped: the next purchase, even within the cap, is refused before signing.
    price(db, "0.02");
    expect(await a.buy(19)).toMatchObject({ ok: false, reason: expect.stringMatching(/^stopped_by_velocity/) });
    expect(state.signed).toEqual([4]);
  });

  it("a lost answer is an incident too: the hold stays HELD until the reconciliation resolves it", async () => {
    const db = world();
    const a = armed(db);
    state.metal = "lost";
    price(db, "0.04");
    await a.buy(18);
    expect(db.prepare("SELECT outcome FROM upstream_purchases").all()).toEqual([{ outcome: "IN_DOUBT" }]);
    expect(db.prepare("SELECT status, cents FROM holds").all()).toEqual([{ status: "HELD", cents: 4 }]);
    expect(stopped(db, "sourcing")).toBe(true);
  });
});
