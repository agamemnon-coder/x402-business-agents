// Backend review B7: alarms for the emergency stop, a speed-limit stop, a reconciliation difference, a stuck action
// and a stale hold; Prometheus metrics; and the relay's public /health, which also raises runner_down when the
// runner stops syncing, and shows codes only.
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { audit } from "../src/audit/log.js";
import { openDb, type DB } from "../src/db/open.js";
import { health, prometheus } from "../src/ops/health.js";
import { publicHealth } from "../src/ops/publicHealth.js";
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

  it("calls a mandate replace that failed after a step ran half run, and nothing else", () => {
    const db = openDb(":memory:");
    const ins = (id: string, status: string) => db.prepare("INSERT INTO proposals (proposal_id, kind, terms_json, terms_sha256, created_by, status, expires_at, created_at) VALUES (?, 'mandate_replace', '{}', ?, 'treasury', ?, '2099-01-01T00:00:00Z', ?)").run(id, `h-${id}`, status, now.toISOString());
    const step = (id: string, no: number, status: string) => db.prepare("INSERT INTO executions (proposal_id, step_no, idempotency_key, status, request_redacted, updated_at) VALUES (?, ?, ?, ?, '{}', ?)").run(id, no, `${id}:${no}`, status, now.toISOString());
    // Failed before any step was DONE (only STARTED): not half run.
    ins("P-0001", "FAILED"); step("P-0001", 1, "STARTED");
    // Executed: done, not half run.
    ins("P-0002", "EXECUTED"); step("P-0002", 1, "DONE"); step("P-0002", 2, "DONE");
    expect(codes(db)).toEqual([]);
    // Failed after step 1 was bound on chain: half run.
    ins("P-0003", "FAILED"); step("P-0003", 1, "DONE"); step("P-0003", 2, "STARTED");
    audit(db, "system", "proposal.failed", "P-0003", { error: "rpc unreachable" }, now);
    const a = health(db, min(1)).alerts;
    expect(a.map((x) => x.code)).toEqual(["replace_half_run"]);
    expect(a[0]).toMatchObject({ severity: "warning", since: now.toISOString() });
    expect(a[0]!.words).toMatch(/P-0003 failed after 1 of its steps ran on chain/);
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
