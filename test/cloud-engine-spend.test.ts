// What Claude may cost, kept in the cloud's database (cloud/src/engine/spend.ts): an action's ceiling reserved against
// every cap at once, in one batch, and settled to what it cost. Plain run: better-sqlite3; with CLOUD_DB=d1, D1 itself.
import { describe, expect, it } from "vitest";
import { ensureSchema } from "../cloud/src/app.js";
import Anthropic from "@anthropic-ai/sdk";
import { claudeAccess } from "../cloud/src/engine/claudeAccess.js";
import { d1Spend, expireStale } from "../cloud/src/engine/spend.js";
import { openDb } from "../src/db/open.js";
import { actionBudget } from "../src/engine/budget.js";
import { sqliteSql } from "../cloud/src/node.js";
import { d1Sql, type Sql } from "../cloud/src/store.js";

const T0 = new Date("2026-11-13T10:00:00Z");
async function fresh(): Promise<Sql> {
  const sql = process.env.CLOUD_DB === "d1" && globalThis.__cloudD1 ? d1Sql(globalThis.__cloudD1.next()) : sqliteSql();
  await ensureSchema(sql);
  return sql;
}
const ON = { claude: "on", cap_action_micros: 250_000, cap_company_micros: 400_000, cap_addr_micros: 1_200_000, cap_day_micros_public: 4_000_000, cap_day_micros_smoke: 1_000_000, cap_all_micros: 75_000_000, max_inflight: 8 };
const scopes = async (sql: Sql) => Object.fromEntries((await sql.all<{ scope: string; micros: number }>("SELECT scope, micros FROM try_spend ORDER BY scope")).map((r) => [r.scope, r.micros]));
const smoke = (tenantId = "t_smoke1") => ({ tenantId, pool: "smoke", address: null });

describe("Claude's spend in the cloud's database", () => {
  it("reserves nothing while the switch is off, or when no switch is set at all", async () => {
    const sql = await fresh();
    expect(await d1Spend(sql, {}, smoke(), () => T0).reserve()).toEqual({ ok: false, reason: "switch_off" });
    expect(await d1Spend(sql, { ...ON, claude: "off" }, smoke(), () => T0).reserve()).toEqual({ ok: false, reason: "switch_off" });
    expect(await scopes(sql)).toEqual({});
    expect(await sql.all("SELECT * FROM try_resv")).toEqual([]);
  });

  it("reserves the action's ceiling against every scope at once, and settles to what it cost", async () => {
    const sql = await fresh();
    const got = await d1Spend(sql, ON, smoke(), () => T0).reserve();
    if (!got.ok) throw new Error(got.reason);
    expect(got.reservation.micros).toBe(250_000);
    expect(await scopes(sql)).toEqual({ all: 250_000, "co:t_smoke1": 250_000, "day:smoke:2026-11-13": 250_000 });
    await got.reservation.settle(90_000);
    expect(await scopes(sql)).toEqual({ all: 90_000, "co:t_smoke1": 90_000, "day:smoke:2026-11-13": 90_000 });
    expect(await sql.all("SELECT state, micros FROM try_resv")).toEqual([{ state: "settled", micros: 90_000 }]);
    // Settling again changes nothing.
    await got.reservation.settle(0);
    expect((await scopes(sql)).all).toBe(90_000);
  });

  it("gives an action no more than the company has left, and refuses when nothing is left: company_cap", async () => {
    const sql = await fresh();
    const spend = d1Spend(sql, ON, smoke(), () => T0);
    const a = await spend.reserve();
    if (!a.ok) throw new Error(a.reason);
    await a.reservation.settle(250_000);
    const b = await spend.reserve();
    if (!b.ok) throw new Error(b.reason);
    expect(b.reservation.micros).toBe(150_000);
    await b.reservation.settle(150_000);
    expect(await spend.reserve()).toEqual({ ok: false, reason: "company_cap" });
  });

  it("counts a visitor's address per day in the public pool, and no address in another pool", async () => {
    const sql = await fresh();
    const caps = { ...ON, cap_addr_micros: 300_000, cap_company_micros: 10_000_000, cap_day_micros_jury: 3_000_000 };
    const one = d1Spend(sql, caps, { tenantId: "t_try_a", pool: "public", address: "h1" }, () => T0);
    const two = d1Spend(sql, caps, { tenantId: "t_try_b", pool: "public", address: "h1" }, () => T0);
    const a = await one.reserve();
    if (!a.ok) throw new Error(a.reason);
    await a.reservation.settle(250_000);
    const b = await two.reserve();
    if (!b.ok) throw new Error(b.reason);
    expect(b.reservation.micros).toBe(50_000);
    await b.reservation.settle(50_000);
    expect(await two.reserve()).toEqual({ ok: false, reason: "address_cap" });
    const jury = await d1Spend(sql, caps, { tenantId: "t_try_c", pool: "jury", address: "h1" }, () => T0).reserve();
    expect(jury.ok).toBe(true);
    expect(Object.keys(await scopes(sql))).toEqual(["addr:h1:2026-11-13", "all", "co:t_try_a", "co:t_try_b", "co:t_try_c", "day:jury:2026-11-13", "day:public:2026-11-13"]);
  });

  it("admits exactly 3 of 20 actions at once against a pool's day cap of 3 actions", async () => {
    const sql = await fresh();
    const caps = { ...ON, cap_action_micros: 100_000, cap_day_micros_public: 300_000, max_inflight: 100 };
    const got = await Promise.all(Array.from({ length: 20 }, (_, i) => d1Spend(sql, caps, { tenantId: `t_try_${i}`, pool: "public", address: `a${i}` }, () => T0).reserve()));
    expect(got.filter((g) => g.ok)).toHaveLength(3);
    expect(got.filter((g) => !g.ok).map((g) => (g.ok ? "" : g.reason))).toEqual(Array(17).fill("pool_day_cap"));
    expect((await scopes(sql))["day:public:2026-11-13"]).toBe(300_000);
  });

  it("admits 3 of 20 actions at once when 3 may be in flight, and the next once one settles: busy", async () => {
    const sql = await fresh();
    const caps = { ...ON, cap_action_micros: 10_000, max_inflight: 3, cap_company_micros: 10_000_000 };
    const spends = Array.from({ length: 20 }, (_, i) => d1Spend(sql, caps, smoke(`t_smoke${i}`), () => T0));
    const got = await Promise.all(spends.map((s) => s.reserve()));
    const admitted = got.filter((g) => g.ok);
    expect(admitted).toHaveLength(3);
    expect(new Set(got.filter((g) => !g.ok).map((g) => (g.ok ? "" : g.reason)))).toEqual(new Set(["busy"]));
    expect((await spends[19]!.reserve()).ok).toBe(false);
    if (admitted[0]!.ok) await admitted[0]!.reservation.settle(5_000);
    expect((await spends[19]!.reserve()).ok).toBe(true);
  });

  it("closes a reservation older than ten minutes at its full amount: it stops counting as in flight and its spend stays", async () => {
    const sql = await fresh();
    const caps = { ...ON, max_inflight: 1 };
    const first = await d1Spend(sql, caps, smoke("t_a"), () => T0).reserve();
    expect(first.ok).toBe(true);
    expect(await d1Spend(sql, caps, smoke("t_b"), () => new Date(T0.getTime() + 9 * 60_000)).reserve()).toEqual({ ok: false, reason: "busy" });
    const later = await d1Spend(sql, caps, smoke("t_b"), () => new Date(T0.getTime() + 11 * 60_000)).reserve();
    expect(later.ok).toBe(true);
    expect(await sql.all("SELECT tenant_id, state, micros FROM try_resv ORDER BY started_at")).toEqual([
      { tenant_id: "t_a", state: "expired", micros: 250_000 }, { tenant_id: "t_b", state: "open", micros: 250_000 },
    ]);
    expect((await scopes(sql))["co:t_a"]).toBe(250_000);
    // Settling the expired one afterwards gives nothing back.
    if (first.ok) await first.reservation.settle(0);
    expect((await scopes(sql))["co:t_a"]).toBe(250_000);
    // The sweep closes them as well.
    expect(await expireStale(sql, new Date(T0.getTime() + 30 * 60_000))).toBe(1);
  });

  it("refuses at the all-time cap and at an action cap of 0 (a missing key is 0)", async () => {
    const sql = await fresh();
    expect(await d1Spend(sql, { ...ON, cap_all_micros: 0 }, smoke(), () => T0).reserve()).toEqual({ ok: false, reason: "all_time_cap" });
    expect(await d1Spend(sql, { ...ON, cap_action_micros: undefined }, smoke(), () => T0).reserve()).toEqual({ ok: false, reason: "action_budget" });
    expect(await d1Spend(sql, { ...ON, cap_day_micros_smoke: undefined }, smoke(), () => T0).reserve()).toEqual({ ok: false, reason: "pool_day_cap" });
  });

  it("says whether Claude may read, the company's cap and what the company has spent or holds reserved", async () => {
    const sql = await fresh();
    const spend = d1Spend(sql, ON, smoke(), () => T0);
    expect(await spend.status()).toEqual({ on: true, cap_micros: 400_000, spent_micros: 0 });
    const a = await spend.reserve();
    if (!a.ok) throw new Error(a.reason);
    // Held while in flight, then what it cost (a call counted at its worst case, a stale reservation: all of it counts).
    expect(await spend.status()).toEqual({ on: true, cap_micros: 400_000, spent_micros: 250_000 });
    await a.reservation.settle(250_000);
    const b = await spend.reserve();
    if (!b.ok) throw new Error(b.reason);
    await b.reservation.settle(150_000);
    // The cap is used up: the next action is the parser's, and the status says so.
    expect(await spend.status()).toEqual({ on: false, cap_micros: 400_000, spent_micros: 400_000 });
    expect(await d1Spend(sql, {}, smoke(), () => T0).status()).toEqual({ on: false, cap_micros: null, spent_micros: 400_000 });
  });
});

describe("Claude for a company's engine in the Worker (cloud/src/engine/claudeAccess.ts)", () => {
  const KEY = "stand-in-not-a-key";
  it("is not there unless ENGINE_CLAUDE is on: the engine reads with the parser, as before", async () => {
    const sql = await fresh();
    expect(claudeAccess({ engineClaude: undefined, key: KEY, sql, tenantId: "t_a" })).toBeUndefined();
    expect(claudeAccess({ engineClaude: "off", key: KEY, sql, tenantId: "t_a" })).toBeUndefined();
  });

  it("without the key: no_key, nothing reserved, and the status says the parser reads", async () => {
    const sql = await fresh();
    const a = claudeAccess({ engineClaude: "on", key: undefined, sql, tenantId: "t_a", switches: async () => ON })!;
    expect(await a.reserve()).toEqual({ ok: false, reason: "no_key" });
    expect(await a.status()).toEqual({ on: false, cap_micros: null, spent_micros: null });
    expect(await scopes(sql)).toEqual({});
  });

  it("with the key but no switches set (lane C's switches not there yet): switch_off, nothing reserved", async () => {
    const sql = await fresh();
    const a = claudeAccess({ engineClaude: "on", key: KEY, sql, tenantId: "t_a" })!;
    expect(await a.reserve()).toEqual({ ok: false, reason: "switch_off" });
    expect(await scopes(sql)).toEqual({});
  });

  it("with the key and the switches: reserves in the company's pool, and reads with 4,000 tokens at most, each call announced", async () => {
    const sql = await fresh();
    const asked: { max_tokens: number }[] = [];
    const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const body = (await new Request(input as RequestInfo, init).json()) as { model: string; max_tokens: number };
      asked.push({ max_tokens: body.max_tokens });
      return new Response(JSON.stringify({ id: "m", type: "message", role: "assistant", model: body.model, stop_reason: "end_turn", stop_sequence: null, content: [{ type: "text", text: JSON.stringify({ v: "x" }) }], usage: { input_tokens: 10, output_tokens: 5 } }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    const a = claudeAccess({ engineClaude: "on", key: KEY, sql, tenantId: "t_try_1", switches: async () => ON, scopes: async () => ({ pool: "public", address: "h9" }), client: (key) => new Anthropic({ apiKey: key, fetch: f, maxRetries: 0 }) })!;
    const got = await a.reserve();
    expect(got.ok).toBe(true);
    expect(Object.keys(await scopes(sql))).toEqual(["addr:h9:" + new Date().toISOString().slice(0, 10), "all", "co:t_try_1", "day:public:" + new Date().toISOString().slice(0, 10)]);
    const db = openDb(":memory:");
    const { z } = await import("zod");
    await a.reader(db, actionBudget(250_000)).ask({ task: "t", role: "act", actor: "treasury", schema: z.object({ v: z.string() }), instruction: "Read.", document: "x" }, () => ({ v: "" }));
    expect(asked).toEqual([{ max_tokens: 4_000 }]);
    expect((db.prepare("SELECT event FROM audit_log ORDER BY seq").all() as { event: string }[]).map((r) => r.event)).toEqual(["claude.asking", "claude.read"]);
    expect(await a.status()).toEqual({ on: true, cap_micros: 400_000, spent_micros: (await scopes(sql))["co:t_try_1"] });
  });
});
