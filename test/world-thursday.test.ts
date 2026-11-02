// Thursday's world (Max, 2 November), both parts opt-in. In dry-141 Stockline's notice reached the Sourcing agent at
// once, and it switched suppliers before any purchase met the new price: no refusal, nothing on chain, no rebalance.
// (a) A silent price rise: the serve loop applies it before its next query, so the first contact with the new price is
//     a purchase attempt at Stockline, refused over the mandate's cap (and recorded on chain) before the notice comes.
// (b) Ridgeline Data offline for maintenance: its API answers 503 before any offer, and its notice tells Sourcing.
import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DB } from "../src/db/open.js";

const state = vi.hoisted(() => ({ db: null as DB | null, attempts: [] as { cents: number; noticePending: boolean }[] }));

vi.mock("../src/metal/mandate.js", async (orig) => ({
  ...(await orig<object>()),
  activeMandate: async () => ({ agent: "sourcing", reference: `0x${"12".repeat(32)}`, credentialPath: "", keyFile: "", credential: {}, credentialHash: `0x${"34".repeat(32)}`, principal: `0x${"56".repeat(20)}`, signDigest: async () => "0x" }),
}));
// The supplier's 402 offer is its price in the ledger (as the world's supplier server makes it); the guard is Purser's.
vi.mock("../src/metal/pay.js", async (orig) => ({
  ...(await orig<object>()),
  payUnderMandate: async (_m: unknown, _url: string, _init: unknown, guard?: (cents: number, payTo: string) => string | null) => {
    const db = state.db!;
    const { getSetting } = await import("../src/world/settings.js");
    const { pending } = await import("../src/autonomy/bus.js");
    const cents = Math.round(Number(getSetting(db, "upstream_price", "0.02")) * 100);
    state.attempts.push({ cents, noticePending: pending(db, "sourcing").events.some((e) => e.kind === "supplier.notice") });
    const blocked = guard ? guard(cents, "0x0000000000000000000000000000000000000001") : null;
    if (blocked) return { kind: "refused", reason: blocked, status: 0, body: "" };
    return { kind: "paid", status: 200, body: JSON.stringify({ supplier: "Stockline", stock: {} }), tx: `0x${"ab".repeat(32)}`, nonce: `0x${String(state.attempts.length).padStart(64, "0")}`, signedOffer: "", amount: String(BigInt(cents) * 10n ** 16n), payTo: "0x0000000000000000000000000000000000000001" };
  },
}));
vi.mock("../src/metal/recordRefusal.js", () => ({ recordCapRefusalOnChain: async () => ({ tx: `0x${"cd".repeat(32)}`, reason: "mandate_cap_exceeded" }) }));

const { openDb } = await import("../src/db/open.js");
const { audit } = await import("../src/audit/log.js");
const { pending } = await import("../src/autonomy/bus.js");
const { SourcingAgent, offerCents } = await import("../src/agents/sourcing.js");
const { getSetting } = await import("../src/world/settings.js");
const { supplierApp, SUPPLIER_ROUTE, SUPPLIER_INFO_ROUTE } = await import("../src/servers/supplier.js");
const w = await import("../src/world/supplierEvents.js");

const env = { ...process.env };
beforeEach(() => { process.env.KIT11_AGENTS = "on"; process.env.KIT11_AUTONOMY = "on"; state.attempts = []; });
afterEach(() => { process.env = { ...env }; });

/** A world with the Sourcing mandate bound at a 0.03 cap, as bootstrap leaves it. */
function world(): DB {
  const db = openDb(":memory:");
  audit(db, "owner-signer", "mandate.bound", "sourcing", { cap: "0.03", budget: "10.00" });
  state.db = db;
  return db;
}
const seqOf = (db: DB, event: string, subject: string) => (db.prepare("SELECT seq FROM audit_log WHERE event = ? AND subject = ?").get(event, subject) as { seq: number } | undefined)?.seq ?? -1;

describe("(a) Stockline's silent price rise", () => {
  it("the first purchase attempt after it is a mandate_cap_exceeded refusal, recorded on chain, before the notice reaches Sourcing", async () => {
    const db = world();
    const sourcing = new SourcingAgent(db, "http://127.0.0.1:1", "0x0000000000000000000000000000000000000001");
    // The shop runs at 0.02 (the default buy policy: Stockline, up to the cap).
    await w.worldQuery(db, 40, () => sourcing.buy(40));
    w.scheduleSilentRise(db, "0.04");
    // Scheduled only: the price is unchanged and nothing was announced until the serve loop's next query.
    expect(getSetting(db, "upstream_price", "0.02")).toBe("0.02");
    expect(pending(db, "sourcing").events).toHaveLength(0);

    const lines: string[] = [];
    const r = await w.worldQuery(db, 41, () => sourcing.buy(41), (l) => lines.push(l));
    expect(r).toMatchObject({ ok: false, reason: "mandate_cap_exceeded: 0.04 is over the sourcing mandate's 0.03 a payment" });
    // The attempt met the new price in the offer, with no notice anywhere yet.
    expect(state.attempts).toEqual([{ cents: 2, noticePending: false }, { cents: 4, noticePending: false }]);

    const rise = w.silentRise(db)!;
    expect(rise).toMatchObject({ price: "0.04", stage: "noticed", seq: 41, notice_after: "first_attempt" });
    const first = db.prepare("SELECT id, supplier, outcome, refusal_reason FROM upstream_purchases WHERE id > ? ORDER BY id LIMIT 1").get(rise.from_id) as { id: number; supplier: string; outcome: string; refusal_reason: string };
    expect(first).toMatchObject({ id: rise.first_attempt_id, supplier: "stockline", outcome: "REFUSED", refusal_reason: expect.stringMatching(/^mandate_cap_exceeded/) });

    // The ledger's order: the refusal, then Metal's record of it on chain, then Stockline's notice.
    const refused = seqOf(db, "upstream.refused", String(first.id));
    const onChain = db.prepare("SELECT seq, payload_json FROM audit_log WHERE event = 'upstream.refused_on_chain'").get() as { seq: number; payload_json: string };
    const notice = seqOf(db, "world.event", String(rise.notice_event));
    expect(JSON.parse(onChain.payload_json)).toMatchObject({ seq: 41, amount: "0.04", tx: expect.stringMatching(/^0x[0-9a-f]{64}$/) });
    expect(refused).toBeGreaterThan(0);
    expect(refused).toBeLessThan(onChain.seq);
    expect(onChain.seq).toBeLessThan(notice);
    // What the Sourcing agent reads at its next wake, in order: the refusal first, then the notice.
    expect(pending(db, "sourcing").events.map((e) => [e.kind, e.payload.supplier])).toEqual([["upstream.refused", "stockline"], ["supplier.notice", "Stockline"]]);
    expect(lines).toEqual(["Stockline now asks 0.04 a stock check, from query #41; no notice sent", "Stockline's price notice reached the Sourcing agent, after the first purchase attempt at the new price"]);
  });

  it("the notice still comes 5 minutes after the rise when no purchase reaches Stockline", async () => {
    const db = world();
    db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('sourcing.buy_policy', ?, ?)").run(JSON.stringify({ supplier: "none", max_price: null, cache_seconds: 0 }), new Date().toISOString());
    const sourcing = new SourcingAgent(db, "http://127.0.0.1:1", "0x0000000000000000000000000000000000000001");
    const t0 = new Date("2026-11-05T10:00:00Z");
    w.scheduleSilentRise(db, "0.04", t0);
    expect(w.applySilentRise(db, 7, t0)).toMatchObject({ stage: "applied", seq: 7 });
    await sourcing.buy(7); // the agent's own policy: not bought, nothing reached Stockline
    expect(w.noticeIfDue(db, new Date(t0.getTime() + 4 * 60_000))).toBeNull();
    expect(pending(db, "sourcing").events.map((e) => e.kind)).toEqual(["upstream.refused"]);
    expect(w.noticeIfDue(db, new Date(t0.getTime() + 5 * 60_000))).toMatchObject({ stage: "noticed", notice_after: "time" });
    expect(pending(db, "sourcing").events.map((e) => e.kind)).toEqual(["upstream.refused", "supplier.notice"]);
    expect(state.attempts).toEqual([]);
  });

  it("does nothing unless asked: the default world's queries change no price and send no notice", async () => {
    const db = world();
    const sourcing = new SourcingAgent(db, "http://127.0.0.1:1", "0x0000000000000000000000000000000000000001");
    for (const seq of [1, 2, 3]) await w.worldQuery(db, seq, () => sourcing.buy(seq));
    expect(w.silentRise(db)).toBeNull();
    expect(getSetting(db, "upstream_price", "0.02")).toBe("0.02");
    expect(pending(db, "sourcing").events).toHaveLength(0);
  });

  it("one rise at a time; a rise not yet applied can be withdrawn, an applied one cannot", () => {
    const db = world();
    w.scheduleSilentRise(db, "0.04");
    expect(() => w.scheduleSilentRise(db, "0.05")).toThrow(/already under way/);
    expect(w.cancelSilentRise(db)).toBe(true);
    expect(w.silentRise(db)).toBeNull();
    w.scheduleSilentRise(db, "0.04");
    w.applySilentRise(db, 9);
    expect(w.cancelSilentRise(db)).toBe(false);
    expect(getSetting(db, "upstream_price", "")).toBe("0.04");
  });
});

describe("(b) Ridgeline Data offline for maintenance", () => {
  let server: Server | undefined;
  afterEach(() => new Promise<void>((r) => (server ? server.close(() => r()) : r())));

  it("answers 503 with no offer while offline, and its notice tells the Sourcing agent", async () => {
    const db = world();
    server = supplierApp({ payTo: "0x0000000000000000000000000000000000000002", price: () => "0.03", name: "Ridgeline Data", dataAgeSeconds: 900, unavailableEvery: 6, down: () => w.ridgelineDown(db) }).listen(0, "127.0.0.1");
    await new Promise((r) => server!.once("listening", r));
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    expect((await fetch(`${base}${SUPPLIER_INFO_ROUTE}`)).status).toBe(200);

    const now = new Date();
    w.ridgelineMaintenance(db, new Date(now.getTime() + 12 * 3_600_000), now);
    for (const seq of [1, 5]) {
      const res = await fetch(`${base}${SUPPLIER_ROUTE}?seq=${seq}`);
      expect(res.status).toBe(503);
      expect(res.headers.get("payment-required")).toBeNull();
      expect(((await res.json()) as { error: string }).error).toMatch(/^Ridgeline Data is offline for planned maintenance until \d\d:\d\d UTC; nothing was offered$/);
    }
    // Its free price list is down too, and the Sourcing agent's free look at an offer finds none.
    expect((await fetch(`${base}${SUPPLIER_INFO_ROUTE}`)).status).toBe(503);
    expect(await offerCents(`${base}${SUPPLIER_ROUTE}?seq=1`)).toBeNull();
    const ev = pending(db, "sourcing").events;
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ kind: "supplier.notice", payload: { supplier: "Ridgeline Data", offline_until: expect.any(String), text: expect.stringMatching(/planned maintenance.*503 before any offer/) } });

    // Back online: its price list answers again, and it says so.
    w.ridgelineMaintenance(db, null);
    expect((await fetch(`${base}${SUPPLIER_INFO_ROUTE}`)).status).toBe(200);
    expect(pending(db, "sourcing").events.at(-1)).toMatchObject({ kind: "supplier.notice", payload: { supplier: "Ridgeline Data", online: true } });
  });

  it("is open unless the world set a maintenance window, and only until its end", () => {
    const db = world();
    expect(w.ridgelineDown(db)).toBeNull();
    const now = new Date("2026-11-05T08:00:00Z");
    w.ridgelineMaintenance(db, new Date("2026-11-05T20:00:00Z"), now);
    expect(w.ridgelineDown(db, now)).toMatch(/until 20:00 UTC/);
    expect(w.ridgelineDown(db, new Date("2026-11-05T20:00:01Z"))).toBeNull();
  });
});
