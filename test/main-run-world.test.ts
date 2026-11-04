// The main run's world (Max, 2 November): every Kit 11 sentence in one world. (1) No upstream cache: every sale buys its
// stock check upstream once, and the Sourcing agent's buy policy cannot turn a cache back on. (2) Per customer query the
// ledger keeps the HTTP status the customer got and whether its payment settled. (3) Less free EUR: the licence plan
// converts only the shortfall on a fresh quote and still passes every floor. (4) The TAP rail on the world's own card:
// the live Sourcing world's Packwise purchase is signed with TAP, checked by our merchant layer, and only then charged
// to that world's Sourcing card at Airwallex, whose limit still decides. Fakes only; no network, no Claude.
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DB } from "../src/db/open.js";

const state = vi.hoisted(() => ({ db: null as DB | null, signed: 0 }));

vi.mock("../src/metal/mandate.js", async (orig) => ({
  ...(await orig<object>()),
  activeMandate: async () => ({ agent: "sourcing", reference: `0x${"12".repeat(32)}`, credentialPath: "", keyFile: "", credential: {}, credentialHash: `0x${"34".repeat(32)}`, principal: `0x${"56".repeat(20)}`, signDigest: async () => "0x" }),
}));
// Every purchase that passes Purser's guard is signed and paid at the supplier's price in the ledger.
vi.mock("../src/metal/pay.js", async (orig) => ({
  ...(await orig<object>()),
  payUnderMandate: async (_m: unknown, _url: string, _init: unknown, guard?: (cents: number, payTo: string) => string | null) => {
    const { getSetting } = await import("../src/world/settings.js");
    const cents = Math.round(Number(getSetting(state.db!, "upstream_price", "0.02")) * 100);
    const blocked = guard ? guard(cents, "0x0000000000000000000000000000000000000001") : null;
    if (blocked) return { kind: "refused", reason: blocked, status: 0, body: "" };
    state.signed++;
    return { kind: "paid", status: 200, body: JSON.stringify({ supplier: "Stockline", stock: { units: state.signed } }), tx: `0x${String(state.signed).padStart(64, "a")}`, nonce: `0x${String(state.signed).padStart(64, "0")}`, signedOffer: "", amount: String(BigInt(cents) * 10n ** 16n), payTo: "0x0000000000000000000000000000000000000001" };
  },
}));

const { openDb } = await import("../src/db/open.js");
const { audit } = await import("../src/audit/log.js");
const { buyPolicy, SourcingAgent } = await import("../src/agents/sourcing.js");
const { setupWorld, upstreamCacheOff } = await import("../src/world/options.js");
const { sourcingProfile, liveSourcingWorld } = await import("../src/autonomy/sourcingProfile.js");
const { sourcingBrief } = await import("../src/autonomy/sourcingCore.js");
const { answerOf, recordQueryAnswer } = await import("../src/world/customerAnswer.js");
const { proposeInvoicePayment, seedTreasury, treasuryState } = await import("../src/agents/euroBill.js");
const { parseInvoiceFallback } = await import("../src/agents/invoice.js");
const { executeInvoicePayment } = await import("../src/executors/invoicePayment.js");
const { decide } = await import("../src/policy/approvals.js");
const { FakeAirwallex } = await import("../src/redteam/airwallex.js");
const { FakeIssuing } = await import("../src/redteam/issuing.js");
const { setupCards, cardOf } = await import("../src/policy/cards.js");
const { registerAgent, revokeAgent } = await import("../src/visa/tap.js");
const { ed25519FromSeed } = await import("../src/visa/tapSig.js");
const { parseOrigin, withOrigin } = await import("../src/provenance/origin.js");

const env = { ...process.env };
beforeEach(() => { process.env.KIT11_AGENTS = "on"; process.env.KIT11_AUTONOMY = "on"; delete process.env.KIT11_UPSTREAM_CACHE; delete process.env.KIT11_TAP_RAIL; delete process.env.KIT11_TAP_PROXY; state.signed = 0; });
afterEach(() => { process.env = { ...env }; });

function world(): DB {
  const db = openDb(":memory:");
  audit(db, "owner-signer", "mandate.bound", "sourcing", { cap: "0.03", budget: "10.00" });
  state.db = db;
  return db;
}
const setPolicy = (db: DB, cache: number) => db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('sourcing.buy_policy', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
  .run(JSON.stringify({ supplier: "stockline", max_price: null, cache_seconds: cache, set_by: "sourcing" }), new Date().toISOString());
const count = (db: DB, sql: string) => (db.prepare(sql).get() as { n: number }).n;
const SUPPLIER = "0x0000000000000000000000000000000000000001" as const;

describe("(1) the main run's world has no upstream cache", () => {
  it("default world (unchanged): a 300 s cache serves the second query from the first purchase", async () => {
    const db = world();
    setPolicy(db, 300);
    const a = new SourcingAgent(db, "http://127.0.0.1:1", SUPPLIER);
    await a.buy(1);
    await a.buy(2);
    expect(state.signed).toBe(1);
    expect(count(db, "SELECT COUNT(*) AS n FROM audit_log WHERE event = 'upstream.cached'")).toBe(1);
  });

  it("world.upstream_cache = off: every sale buys upstream once, whatever the policy's cache", async () => {
    const db = world();
    expect(setupWorld(db, { upstreamCache: "off" })[0]).toMatch(/every customer query buys/);
    setPolicy(db, 300);
    const a = new SourcingAgent(db, "http://127.0.0.1:1", SUPPLIER);
    for (const seq of [1, 2, 3, 4]) expect(await a.buy(seq)).toMatchObject({ ok: true });
    expect(state.signed).toBe(4);
    expect(count(db, "SELECT COUNT(*) AS n FROM upstream_purchases WHERE outcome = 'PAID'")).toBe(4);
    expect(count(db, "SELECT COUNT(*) AS n FROM audit_log WHERE event = 'upstream.cached'")).toBe(0);
  });

  it("KIT11_UPSTREAM_CACHE=off in a process turns it off too, never on", () => {
    const db = world();
    expect(upstreamCacheOff(db, {})).toBe(false);
    expect(upstreamCacheOff(db, { KIT11_UPSTREAM_CACHE: "off" })).toBe(true);
    expect(upstreamCacheOff(db, { KIT11_UPSTREAM_CACHE: "on" })).toBe(false);
    setupWorld(db, { upstreamCache: "off" });
    expect(upstreamCacheOff(db, { KIT11_UPSTREAM_CACHE: "on" })).toBe(true);
  });

  it("set_buy_policy cannot turn the cache back on there: it stores 0 and says why; the brief states the fact", async () => {
    const db = world();
    setupWorld(db, { upstreamCache: "off" });
    const w = { suppliers: async () => [{ id: "stockline" as const, name: "Stockline", price_cents: 2, data_age_seconds: 5, available: true, last20: { paid: 1, refused: 0, unavailable: 0 } }], mandate: async () => ({ capCents: 3, budgetLeftCents: 900 }), sellCents: () => 5 };
    const tool = sourcingProfile(w).tools(db).find((t) => t.name === "set_buy_policy")!;
    const r = await tool.run({ supplier: "stockline", max_price: null, cache_seconds: 300, reason: "Save on upstream cost." } as never);
    expect(r.text).toMatch(/Not the 300 s cache: this world serves no cached stock check/);
    expect(buyPolicy(db)).toMatchObject({ supplier: "stockline", cache_seconds: 0 });
    const set = JSON.parse((db.prepare("SELECT payload_json FROM audit_log WHERE event = 'sourcing.policy_set'").get() as { payload_json: string }).payload_json);
    expect(set).toMatchObject({ cache_seconds: 0, cache_refused: 300 });
    const brief = await sourcingProfile(w).observe(db);
    expect(brief).toMatch(/In this world code serves no cached stock check/);
    // The default world's brief is as before.
    expect(sourcingBrief({ suppliers: [], capCents: 3, budgetLeftCents: 9, sellCents: 5, policy: { supplier: "stockline", max_price: null, cache_seconds: 60 }, card: null })).not.toMatch(/no cached/);
  });

  it("is for a fresh world only, and an option once set is not changed", async () => {
    const db = world();
    const a = new SourcingAgent(db, "http://127.0.0.1:1", SUPPLIER);
    await a.buy(1);
    expect(() => setupWorld(db, { upstreamCache: "off" })).toThrow(/fresh world/);
    expect(upstreamCacheOff(db, {})).toBe(false);
  });
});

describe("(2) per customer query: the status the customer got, and whether it settled", () => {
  const paid = { seq: 7, via: "mandate" as const, charged: true, outcome: { kind: "paid" as const, status: 200, body: "{}", tx: `0x${"ab".repeat(32)}` as `0x${string}`, nonce: "0x1", signedOffer: "", amount: String(5n * 10n ** 16n), payTo: "0x2" } };
  const refused = { seq: 8, via: "mandate" as const, charged: false, outcome: { kind: "in_doubt" as const, reason: "seller answered 503 without a settlement", status: 503, body: "{\"error\":\"upstream purchase refused\"}", nonce: "0x2" } };
  it("a sale: 200, settled; a refusal: 503, not settled (the facilitator's lookup found no settlement)", () => {
    expect(answerOf(7, paid)).toMatchObject({ seq: 7, status: 200, settled: true, outcome: "paid", amount: "0.05" });
    expect(answerOf(8, refused)).toMatchObject({ seq: 8, status: 503, settled: false, outcome: "in_doubt" });
    expect(answerOf(9, { error: "connect ECONNREFUSED" })).toMatchObject({ status: null, settled: null, outcome: "failed" });
  });

  it("each answer is a ledger row (query.answered), with its sale when there is one", () => {
    const db = world();
    db.prepare(`INSERT INTO sales (route, price_cents, payer, settlement_id, tx_hash, request_url, request_params_json, body_sha256, body_json, status, created_at)
      VALUES ('GET /v1/stock', 5, '0x3', 's1', ?, 'http://x/v1/stock?seq=7', '{"seq":"7"}', 'h', '{}', 'DELIVERED', ?)`).run(`0x${"ab".repeat(32)}`, new Date().toISOString());
    recordQueryAnswer(db, 7, paid);
    recordQueryAnswer(db, 8, refused);
    const rows = (db.prepare("SELECT subject, payload_json FROM audit_log WHERE event = 'query.answered' ORDER BY seq").all() as { subject: string; payload_json: string }[]).map((r) => JSON.parse(r.payload_json));
    expect(rows).toEqual([
      expect.objectContaining({ seq: 7, status: 200, settled: true, sale_id: 1 }),
      expect.objectContaining({ seq: 8, status: 503, settled: false }),
    ]);
    expect(rows[1]).not.toHaveProperty("sale_id");
  });
});

describe("(3) less free EUR: the licence needs FX for its shortfall", () => {
  const text = readFileSync(new URL("../fixtures/stockline-licence-SLL-2026-11.txt", import.meta.url), "utf8");

  it("the setup refuses a target that would need no FX, and one after the calibration ran", async () => {
    const db = world();
    expect(() => setupWorld(db, { freeEur: "260.00" })).toThrow(/no FX would be needed/);
    expect(() => setupWorld(db, { freeEur: "1.5" })).toThrow(/not an amount/);
    const awx = new FakeAirwallex();
    await seedTreasury(db, awx, awx);
    expect(() => setupWorld(db, { freeEur: "150.00" })).toThrow(/calibration already ran/);
  });

  it("free EUR 150.00: the plan converts only the 110.00 shortfall (licence 240.00 + fee ceiling 20.00) on a fresh quote, then pays by SWIFT", async () => {
    const db = world();
    setupWorld(db, { freeEur: "150.00" });
    const awx = new FakeAirwallex();
    const s = await seedTreasury(db, awx, awx);
    expect(s.eurAvailableCents - s.eurFloorCents - s.eurObligationsCents).toBe(15_000);
    const out = await proposeInvoicePayment(db, awx, parseInvoiceFallback(text), text);
    if (out.kind !== "proposed") throw new Error(out.reason);
    expect(out.terms).toMatchObject({ amount: "240.00", fee_max: "20.00", method: "SWIFT", conversion: { buy_currency: "EUR", buy_amount: "110.00", sell_currency: "USD" } });
    expect(awx.calls.indexOf("currentRate")).toBeLessThan(awx.calls.indexOf("createQuote"));
    expect(out.terms.after.eur_free).toBe("0.00");
    decide(db, { proposalId: out.proposal.proposal_id, decision: "APPROVED", typedPrefix: out.proposal.terms_sha256.slice(0, 8), approver: "test", method: "cli" });
    const eurBefore = awx.bal.EUR.availableCents;
    const r = await executeInvoicePayment(db, awx, awx, out.proposal.proposal_id);
    expect(r.transfer.status).toBe("PAID");
    expect(r.conversionId).not.toBeNull();
    // The floor and the commitments stay whole: EUR ends at least where the plan left it (the unused fee ceiling on top).
    const after = treasuryState(db, await awx.balances());
    expect(after.eurAvailableCents).toBeGreaterThanOrEqual(after.eurFloorCents + after.eurObligationsCents);
    expect(awx.bal.EUR.availableCents).toBeGreaterThan(eurBefore - 24_000 - 2000);
    expect(after.usdAvailableCents).toBeGreaterThanOrEqual(after.usdFloorCents);
  });

  it("the default world is unchanged: 1,500.00 free EUR, no FX for the licence", async () => {
    const db = world();
    const awx = new FakeAirwallex();
    await seedTreasury(db, awx, awx);
    const out = await proposeInvoicePayment(db, awx, parseInvoiceFallback(text), text);
    if (out.kind !== "proposed") throw new Error(out.reason);
    expect(out.terms.conversion).toBeNull();
  });
});

describe("(4) the TAP rail on the main world's own Sourcing card", () => {
  const now = new Date();
  async function tapWorld() {
    const db = world();
    const dir = mkdtempSync(join(tmpdir(), "kit11-tap-"));
    process.env.KIT11_KEYS_DIR = dir;
    const pair = ed25519FromSeed(Buffer.alloc(32, 7));
    writeFileSync(join(dir, "tap-sourcing.key.json"), JSON.stringify({ keyid: "sourcing-main-world", privateJwk: pair.privateKey.export({ format: "jwk" }) }), { mode: 0o600 });
    const awx = new FakeIssuing();
    await setupCards(db, awx, now);
    // Without the pinned key the world's TAP rail is refused at setup.
    expect(() => setupWorld(db, { tapRail: "on" })).toThrow(/no TAP key pinned/);
    registerAgent(db, { agent: "sourcing", keyid: "sourcing-main-world", publicJwk: pair.publicKey.export({ format: "jwk" }), domains: ["127.0.0.1:4410", "packwise.example"], notAfter: Math.floor(now.getTime() / 1000) + 86_400 });
    setupWorld(db, { tapRail: "on" });
    const tool = sourcingProfile(liveSourcingWorld(db, { issuing: { rail: awx, sim: awx } })).tools(db).find((t) => t.name === "buy_software")!;
    return { db, awx, tool };
  }
  const agent = { actor: "agent" as const, agent: "sourcing", model: "claude-haiku-5-5", request_id: "req_main", run_id: "run_main" };

  it("buy_software (no KIT11_TAP_RAIL in the env): signed with TAP, both signatures verified, then the world's own card is charged", async () => {
    const { db, awx, tool } = await tapWorld();
    const r = await withOrigin(agent, () => tool.run({ plan: "packwise-starter", rail: "airwallex_card", reason: "Starter covers our warehouse." } as never));
    expect(r.text).toMatch(/approved by Airwallex/);
    const verified = JSON.parse((db.prepare("SELECT payload_json FROM audit_log WHERE event = 'tap.checkout_verified'").get() as { payload_json: string }).payload_json);
    expect(verified).toMatchObject({ agent: "sourcing", plan: "packwise-starter", key_id: "sourcing-main-world", sig1: "verified", sig2: "verified", transport: "in-process" });
    // The charge went to this world's Sourcing card, and its origin carries the TAP evidence and Airwallex's id.
    const card = cardOf(db, "sourcing")!;
    expect(awx.txs.map((t) => t.cardId)).toEqual([card.card_id]);
    const o = parseOrigin((db.prepare("SELECT json_extract(payload_json, '$.origin') AS o FROM audit_log WHERE event = 'card.charge_approved'").get() as { o: string }).o);
    expect(o).toMatchObject({ ...agent, tap: { key_id: "sourcing-main-world", sig1: "verified", sig2: "verified", awx_transaction_id: awx.txs[0]!.transactionId } });
  });

  it("Pro (45.00) over the card's limit: TAP passes, and Airwallex's limit still declines it", async () => {
    const { db, awx, tool } = await tapWorld();
    const r = await withOrigin(agent, () => tool.run({ plan: "packwise-pro", rail: "airwallex_card", reason: "Starter ends." } as never));
    expect(r.text).toMatch(/declined by Airwallex \(LIMIT_EXCEEDED\)/);
    expect(count(db, "SELECT COUNT(*) AS n FROM audit_log WHERE event = 'tap.checkout_verified'")).toBe(1);
    expect(awx.txs.filter((t) => t.approved)).toHaveLength(0);
  });

  it("a revoked TAP key: our merchant refuses, nothing is charged", async () => {
    const { db, awx, tool } = await tapWorld();
    revokeAgent(db, "sourcing-main-world");
    await expect(withOrigin(agent, () => tool.run({ plan: "packwise-starter", rail: "airwallex_card", reason: "Starter." } as never))).rejects.toThrow(/refused .*TAP request.*nothing was charged/);
    expect(awx.calls).not.toContain("charge");
    expect(count(db, "SELECT COUNT(*) AS n FROM audit_log WHERE event = 'tap.checkout_refused'")).toBe(1);
  });
});
