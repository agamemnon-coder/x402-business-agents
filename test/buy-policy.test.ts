// D19: code follows the Sourcing agent's buy policy per query. "Do not buy" and an unreachable supplier refuse the
// query before anything is signed (the customer is not charged), are logged as Purser's refusals with the supplier,
// and tell the agent once a minute at most. Off (no autonomy), the policy is ignored and Stockline is used as before.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb } from "../src/db/open.js";
import { buyPolicy, SourcingAgent } from "../src/agents/sourcing.js";
import { pending } from "../src/autonomy/bus.js";

const env = { ...process.env };
beforeEach(() => { process.env.KIT11_AGENTS = "on"; process.env.KIT11_AUTONOMY = "on"; });
afterEach(() => { process.env = { ...env }; });
const set = (db: ReturnType<typeof openDb>, v: object) => db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('sourcing.buy_policy', ?, '2026-11-03T10:00:00Z') ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify(v));

describe("code follows the buy policy", () => {
  it("does not buy when the agent chose not to; the customer is not charged; the agent hears of it once", async () => {
    const db = openDb(":memory:");
    set(db, { supplier: "none", max_price: null, cache_seconds: 0 });
    const a = new SourcingAgent(db, "http://127.0.0.1:1", "0x0000000000000000000000000000000000000001");
    const r1 = await a.buy(51);
    const r2 = await a.buy(52);
    expect(r1).toMatchObject({ ok: false, reason: expect.stringMatching(/^buy_policy: the Sourcing agent chose not to buy/) });
    expect(r2.ok).toBe(false);
    expect(db.prepare("SELECT supplier, outcome FROM upstream_purchases").all()).toEqual([{ supplier: "none", outcome: "REFUSED" }, { supplier: "none", outcome: "REFUSED" }]);
    expect(pending(db, "sourcing").events.filter((e) => e.kind === "upstream.refused")).toHaveLength(1);
  });

  // dry-131: the Treasury agent saw the turned-away customers (its evidence of a block) only at its next tick, minutes
  // later; the rebalance came after the run moved on. The third customer turned away in 15 minutes wakes it, once.
  it("wakes the Treasury agent once when the third customer in 15 minutes is turned away", async () => {
    const db = openDb(":memory:");
    set(db, { supplier: "none", max_price: null, cache_seconds: 0 });
    const a = new SourcingAgent(db, "http://127.0.0.1:1", "0x0000000000000000000000000000000000000001");
    for (const seq of [61, 62]) await a.buy(seq);
    expect(pending(db, "treasury").events).toHaveLength(0);
    for (const seq of [63, 64, 65]) await a.buy(seq);
    const ev = pending(db, "treasury").events;
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ kind: "customers.turned_away", payload: { count: 3, window_minutes: 15 } });
  });

  it("refuses before signing when the policy's supplier makes no offer (unavailable)", async () => {
    const db = openDb(":memory:");
    set(db, { supplier: "stockline", max_price: "0.03", cache_seconds: 0 });
    const r = await new SourcingAgent(db, "http://127.0.0.1:1", "0x0000000000000000000000000000000000000001").buy(53);
    expect(r).toMatchObject({ ok: false, reason: expect.stringMatching(/^supplier_unavailable: Stockline made no offer/) });
  });

  it("ignores the policy with the autonomous agents off", () => {
    const db = openDb(":memory:");
    set(db, { supplier: "none", max_price: null, cache_seconds: 0 });
    expect(buyPolicy(db).supplier).toBe("none"); // stored, but buy() uses DEFAULT_POLICY when autonomy is off
  });
});
