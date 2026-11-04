// Backend review B7: alarms for the emergency stop, a speed-limit stop, a reconciliation difference, a stuck action
// and a stale hold; Prometheus metrics; and the relay's public /health, which also raises runner_down when the
// runner stops syncing, and shows codes only.
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { audit } from "../src/audit/log.js";
import { openDb, type DB } from "../src/db/open.js";
import { health, prometheus } from "../src/ops/health.js";
import { LIVE_RUN_EXPECTED_MS, publicHealth, publicStatus, RECORDED_DEMO_WORDS } from "../src/ops/publicHealth.js";
import { reserveSpend } from "../src/policy/holds.js";
import { buildRelayState, stateHash } from "../src/relay/state.js";
import { Relay, type Sql } from "../worker/src/core.js";

const now = new Date("2026-11-03T10:00:00Z");
const min = (m: number) => new Date(now.getTime() + m * 60_000);
const set = (db: DB, key: string, value: string) => db.prepare("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value, now.toISOString());
const codes = (db: DB, at = now) => health(db, at).alerts.map((a) => a.code);

describe("monitoring (B7)", () => {
  it("is quiet on a calm ledger", () => {
    const h = health(openDb(":memory:"), now);
    expect(h).toMatchObject({ status: "ok", alerts: [] });
    expect(h.metrics).toMatchObject({ emergency_stop: 0, agents_stopped: 0, reconcile_differences: 0, holds_open: 0, actions_executing: 0 });
  });

  it("raises an alarm for the emergency stop, a speed-limit stop, a reconciliation difference and a stale hold", () => {
    const db = openDb(":memory:");
    set(db, "freeze", "on");
    set(db, "stop.support", "on");
    audit(db, "system", "reconcile.done", null, { checked: 12, differences: 1, skipped: [] }, now);
    audit(db, "treasury", "mandate.bound", "treasury", { cap: "4.00", budget: "12.00", payee: "0x0000000000000000000000000000000000000001" }, now);
    set(db, "freeze", "off");
    expect(reserveSpend(db, { agent: "treasury", rail: "metal", cents: 100, ref: "s1", now, payee: "sweep" })).toBeNull();
    set(db, "freeze", "on");
    expect(codes(db, min(5))).toEqual(["emergency_stop", "velocity_stop", "reconciliation_difference"]);
    expect(codes(db, min(61))).toContain("hold_stale");
    expect(health(db, min(5)).alerts.find((a) => a.code === "velocity_stop")?.words).toMatch(/support agent/);
    const text = prometheus(health(db, min(5)));
    expect(text).toContain("purser_emergency_stop 1");
    expect(text).toContain("purser_holds_open_cents 100");
    expect(text).toContain('purser_alert{code="reconciliation_difference",severity="critical"} 1');
  });

  it("calls an action stuck when it has executed for over ten minutes", () => {
    const db = openDb(":memory:");
    db.prepare("INSERT INTO proposals (proposal_id, kind, terms_json, terms_sha256, created_by, status, expires_at, created_at) VALUES ('P-0001', 'dev_test', '{}', 'h', 'treasury', 'EXECUTING', '2099-01-01T00:00:00Z', ?)").run(now.toISOString());
    audit(db, "system", "proposal.executing", "P-0001", {}, now);
    expect(codes(db, min(5))).toEqual([]);
    expect(codes(db, min(11))).toEqual(["action_stuck"]);
  });

  it("answers 503 on the public /health with alarm codes only, and runner_down when the runner stops syncing", async () => {
    expect(publicHealth(null, null)).toEqual({ status: 503, body: { status: "alert", runner: "unknown", alerts: [], checked_at: null } });
    const db = openDb(":memory:");
    const sql: Sql = { exec(q, ...b) { const st = mem.prepare(q); const rows = st.reader ? st.all(...b) : (st.run(...b), []); return { toArray: () => rows }; } };
    const mem = new Database(":memory:");
    let clock = now;
    const relay = new Relay(sql, { relayToken: "t".repeat(64), now: () => clock });
    const state = buildRelayState(db, { rpId: "kit11.example", relayToken: "t".repeat(64) }, now);
    await relay.fetch(new Request("https://kit11.example/api/runner/sync", { method: "POST", headers: { authorization: `Bearer ${"t".repeat(64)}`, "content-type": "application/json" }, body: JSON.stringify({ state_hash: stateHash(state), state, acks: [] }) }));
    const get = async () => { const r = await relay.fetch(new Request("https://kit11.example/health")); return { status: r.status, body: await r.json() as Record<string, unknown> }; };
    expect(await get()).toEqual({ status: 200, body: { status: "ok", runner: "up", alerts: [], checked_at: now.toISOString() } });
    clock = min(3);
    expect(await get()).toMatchObject({ status: 503, body: { runner: "down", alerts: ["runner_down"] } });
    expect(Object.keys((await get()).body).sort()).toEqual(["alerts", "checked_at", "runner", "status"]);
  });
});

// First impression (4 Nov): between live runs the runner is off on purpose, and /health says so (200) instead of
// raising runner_down for anyone who opens it; while a live run is expected it is the alarm, as above. /health/live is
// the alarm at all times, for an uptime monitor and the CFO.
describe("/health between live runs and during one", () => {
  const relayAt = (opts: { liveRun?: boolean } = {}) => {
    const mem = new Database(":memory:");
    const sql: Sql = { exec(q, ...b) { const st = mem.prepare(q); const rows = st.reader ? st.all(...b) : (st.run(...b), []); return { toArray: () => rows }; } };
    const clock = { at: now };
    const relay = new Relay(sql, { relayToken: "t".repeat(64), now: () => clock.at, ...opts });
    const sync = async (db: DB) => {
      const state = buildRelayState(db, { rpId: "kit11.example", relayToken: "t".repeat(64) }, clock.at);
      await relay.fetch(new Request("https://kit11.example/api/runner/sync", { method: "POST", headers: { authorization: `Bearer ${"t".repeat(64)}`, "content-type": "application/json" }, body: JSON.stringify({ state_hash: stateHash(state), state, acks: [] }) }));
    };
    const get = async (path: string) => { const r = await relay.fetch(new Request(`https://kit11.example${path}`)); return { status: r.status, body: await r.json() as Record<string, unknown> }; };
    return { relay, clock, sync, get };
  };

  it("keeps the alarm while a live run is expected: the runner synced in the last 30 minutes, or a run is declared", () => {
    const h = health(openDb(":memory:"), now);
    for (const age of [0, 3 * 60_000, LIVE_RUN_EXPECTED_MS]) expect(publicStatus(h, age, { lastSync: now.toISOString() })).toEqual(publicHealth(h, age));
    expect(publicStatus(h, 3 * 60_000)).toMatchObject({ status: 503, body: { status: "alert", runner: "down", alerts: ["runner_down"] } });
    expect(publicStatus(h, LIVE_RUN_EXPECTED_MS + 1, { liveRun: true })).toEqual(publicHealth(h, LIVE_RUN_EXPECTED_MS + 1));
    expect(publicStatus(null, null, { liveRun: true })).toEqual(publicHealth(null, null));
  });

  it("says \"Recorded demo\" with 200 between live runs, with the alarm codes of the runner's last sync", () => {
    const db = openDb(":memory:");
    expect(publicStatus(health(db, now), LIVE_RUN_EXPECTED_MS + 1, { lastSync: now.toISOString() })).toEqual({ status: 200, body: { status: "recorded_demo", words: RECORDED_DEMO_WORDS, runner: "off", alerts: [], checked_at: now.toISOString(), last_sync: now.toISOString() } });
    expect(RECORDED_DEMO_WORDS).toBe("Recorded demo · the live runner runs during live runs");
    // A relay no runner ever synced with: no live run here yet.
    expect(publicStatus(null, null)).toEqual({ status: 200, body: { status: "recorded_demo", words: RECORDED_DEMO_WORDS, runner: "off", alerts: [], checked_at: null, last_sync: null } });
    // Nothing moves while the runner is off, so an alarm that stood at its last sync still stands, and is shown.
    set(db, "freeze", "on");
    expect(publicStatus(health(db, now), LIVE_RUN_EXPECTED_MS + 1).body).toMatchObject({ status: "recorded_demo", alerts: ["emergency_stop"] });
  });

  it("on the relay: /health calm after 30 minutes without a sync, /health/live the alarm throughout, LIVE_RUN keeping /health strict", async () => {
    const r = relayAt();
    // Never synced: a calm /health, and /health/live does not call it ok.
    expect(await r.get("/health")).toMatchObject({ status: 200, body: { status: "recorded_demo", words: RECORDED_DEMO_WORDS, runner: "off" } });
    expect(await r.get("/health/live")).toEqual({ status: 503, body: { status: "alert", runner: "unknown", alerts: [], checked_at: null } });
    await r.sync(openDb(":memory:"));
    for (const path of ["/health", "/health/live"]) expect(await r.get(path)).toEqual({ status: 200, body: { status: "ok", runner: "up", alerts: [], checked_at: now.toISOString() } });
    // The runner stops during a live run: both raise runner_down.
    r.clock.at = min(3);
    for (const path of ["/health", "/health/live"]) expect(await r.get(path)).toMatchObject({ status: 503, body: { status: "alert", runner: "down", alerts: ["runner_down"] } });
    r.clock.at = min(30);
    expect((await r.get("/health")).status).toBe(503);
    // Past 30 minutes no live run is expected: /health is calm and says so; /health/live keeps the alarm.
    r.clock.at = min(31);
    expect(await r.get("/health")).toEqual({ status: 200, body: { status: "recorded_demo", words: RECORDED_DEMO_WORDS, runner: "off", alerts: [], checked_at: now.toISOString(), last_sync: now.toISOString() } });
    expect(await r.get("/health/live")).toMatchObject({ status: 503, body: { status: "alert", runner: "down", alerts: ["runner_down"] } });
    // A declared live run keeps /health the alarm however long the runner is silent.
    const declared = relayAt({ liveRun: true });
    await declared.sync(openDb(":memory:"));
    declared.clock.at = min(24 * 60);
    expect(await declared.get("/health")).toMatchObject({ status: 503, body: { status: "alert", runner: "down", alerts: ["runner_down"] } });
    expect(await relayAt({ liveRun: true }).get("/health")).toMatchObject({ status: 503, body: { status: "alert", runner: "unknown" } });
    // The runner back: live again at once.
    await r.sync(openDb(":memory:"));
    expect((await r.get("/health")).body).toMatchObject({ status: "ok", runner: "up" });
  });
});
