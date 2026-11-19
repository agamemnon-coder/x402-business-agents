// The hourly synthetic checks behind /status and /status.json (src/ops/syntheticChecks.ts, worker/src/statusDesk.ts):
// what a round asks, what passes, how the rows add up over 24 h, 7 days and since the start, and that the page shows
// no number before the first check and nothing that was not checked. A fake clock and fake answers; the Durable
// Object's SQLite is an in-memory SQLite (the same call shape).
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CHECKS_END, CHECKS_START, CHECK_TARGETS, MCP_INITIALIZE, STATUS_CLOUD, STATUS_SINCE, STATUS_SITE, checksHtml, percentile, runChecks, summarize, withChecks,
  type CheckRow, type FetchLike,
} from "../src/ops/syntheticChecks.js";
import { statusPage } from "../src/redesign/status.js";
import { StatusDesk } from "../worker/src/statusDesk.js";
import type { Sql } from "../worker/src/core.js";

function memorySql(): Sql {
  const db = new Database(":memory:");
  return { exec(query, ...bindings) { const st = db.prepare(query); const rows = st.reader ? st.all(...bindings) : (st.run(...bindings), []); return { toArray: () => rows }; } };
}

/** A clock that only moves when told (or when a fake answer takes its time). */
function fakeClock(iso: string) {
  let t = Date.parse(iso);
  return { now: () => t, advance: (ms: number) => { t += ms; }, set: (s: string) => { t = Date.parse(s); } };
}

interface Answer { status: number; type?: string; body: string; ms: number }
const HTML: Answer = { status: 200, type: "text/html; charset=utf-8", body: "<!doctype html><html lang=\"en\"><body>ok</body></html>", ms: 100 };
const GOOD: Record<string, Answer> = {
  [`${STATUS_SITE}/`]: { ...HTML, ms: 120 },
  [`${STATUS_SITE}/proof`]: { ...HTML, ms: 140 },
  [`${STATUS_SITE}/try`]: { ...HTML, ms: 300 },
  [`${STATUS_SITE}/health`]: { status: 200, type: "application/json", body: JSON.stringify({ status: "recorded_demo", runner: "off", alerts: [] }), ms: 90 },
  [`${STATUS_SITE}/v1/try/stage/stats`]: { status: 200, type: "application/json", body: JSON.stringify({ live: false, counts: { started: 0 } }), ms: 200 },
  [`${STATUS_CLOUD}/mcp`]: { status: 200, type: "application/json", body: JSON.stringify({ jsonrpc: "2.0", id: 1, result: { serverInfo: { name: "purser" } } }), ms: 250 },
};

/** Fake answers by URL; each takes its time on the clock. Records what was asked. */
function fakeFetch(clock: ReturnType<typeof fakeClock>, answers: Record<string, Answer | "network" | "hang"> = GOOD) {
  const asked: { url: string; init: RequestInit }[] = [];
  const fetchFn: FetchLike = (url, init) => {
    asked.push({ url, init });
    const a = answers[url];
    if (a === "network") return Promise.reject(new TypeError("fetch failed"));
    if (a === "hang" || !a) return new Promise((_, reject) => init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
    clock.advance(a.ms);
    return Promise.resolve(new Response(a.body, { status: a.status, headers: { "content-type": a.type ?? "text/plain" } }));
  };
  return { fetchFn, asked };
}

describe("a round of checks", () => {
  it("asks the six public addresses once each, in order, from outside, and times each to its full answer", async () => {
    const clock = fakeClock("2026-11-19T17:41:00.000Z");
    const { fetchFn, asked } = fakeFetch(clock);
    const rows = await runChecks(fetchFn, clock.now);
    expect(asked.map((a) => `${a.init.method} ${a.url}`)).toEqual([
      `GET ${STATUS_SITE}/`, `GET ${STATUS_SITE}/proof`, `GET ${STATUS_SITE}/try`, `GET ${STATUS_SITE}/health`, `GET ${STATUS_SITE}/v1/try/stage/stats`, `POST ${STATUS_CLOUD}/mcp`,
    ]);
    // MCP: initialize, with the demo company's public read-only token, nothing else.
    const mcp = asked[5]!.init;
    expect(mcp.body).toBe(MCP_INITIALIZE);
    expect(JSON.parse(MCP_INITIALIZE)).toMatchObject({ jsonrpc: "2.0", method: "initialize" });
    expect((mcp.headers as Record<string, string>).authorization).toBe("Bearer purser-demo-read-only");
    expect(rows.map((r) => [r.target, r.status, r.ms, r.ok])).toEqual([
      ["home", 200, 120, true], ["proof", 200, 140, true], ["try", 200, 300, true], ["health", 200, 90, true], ["try_api", 200, 200, true], ["mcp", 200, 250, true],
    ]);
    // Each row is dated when its own request started.
    expect(rows[1]!.at).toBe("2026-11-19T17:41:00.120Z");
  });

  it("passes only on the address's own shape: /health's 503 alarm passes, a 500, a page that is no HTML, an MCP error or a missing count fails", async () => {
    const clock = fakeClock("2026-11-19T18:41:00.000Z");
    const { fetchFn } = fakeFetch(clock, {
      ...GOOD,
      [`${STATUS_SITE}/`]: { status: 200, type: "application/json", body: "{}", ms: 50 },
      [`${STATUS_SITE}/proof`]: { status: 500, type: "text/html", body: "<html>error</html>", ms: 50 },
      [`${STATUS_SITE}/health`]: { status: 503, type: "application/json", body: JSON.stringify({ status: "alert", runner: "down", alerts: ["runner_down"] }), ms: 50 },
      [`${STATUS_SITE}/v1/try/stage/stats`]: { status: 200, type: "application/json", body: JSON.stringify({ live: true }), ms: 50 },
      [`${STATUS_CLOUD}/mcp`]: { status: 200, type: "application/json", body: JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32600 } }), ms: 50 },
    });
    const rows = await runChecks(fetchFn, clock.now);
    expect(Object.fromEntries(rows.map((r) => [r.target, r.ok]))).toEqual({ home: false, proof: false, try: true, health: true, try_api: false, mcp: false });
    expect(rows.find((r) => r.target === "proof")!.error).toMatch(/^unexpected answer \(expected 200, an HTML page\)$/);
  });

  it("a network error or no answer in time is a failed check with status 0, said in words", async () => {
    const clock = fakeClock("2026-11-19T19:41:00.000Z");
    const { fetchFn } = fakeFetch(clock, { ...GOOD, [`${STATUS_SITE}/`]: "network", [`${STATUS_SITE}/try`]: "hang" });
    const rows = await runChecks(fetchFn, clock.now, CHECK_TARGETS, 20);
    expect(rows.find((r) => r.target === "home")).toMatchObject({ status: 0, ok: false, error: "network error: fetch failed" });
    expect(rows.find((r) => r.target === "try")).toMatchObject({ status: 0, ok: false, error: "no answer within 0.02 s" });
  });
});

describe("adding the rows up", () => {
  const row = (at: string, target: string, ok: boolean, ms: number, status = ok ? 200 : 500): CheckRow => ({ at, target, status, ms, ok, error: ok ? null : "x" });

  it("percentile is nearest-rank: a value that was measured", () => {
    expect(percentile([], 50)).toBeNull();
    expect(percentile([7], 95)).toBe(7);
    expect(percentile([1, 2, 3, 4], 50)).toBe(2);
    expect(percentile(Array.from({ length: 20 }, (_, i) => i + 1), 95)).toBe(19);
    expect(percentile(Array.from({ length: 100 }, (_, i) => i + 1), 95)).toBe(95);
  });

  it("uptime and p50/p95 per address over 24 h, 7 days and since the start; latency only over checks that got an answer", () => {
    const now = Date.parse("2026-11-28T12:00:00.000Z");
    const rows = [
      row("2026-11-19T12:41:00.000Z", "home", true, 400), // 9 days ago: since start only
      row("2026-11-25T12:41:00.000Z", "home", false, 900), // 3 days ago: 7 days and since start
      row("2026-11-28T09:41:00.000Z", "home", true, 100),
      row("2026-11-28T10:41:00.000Z", "home", true, 200),
      { at: "2026-11-28T11:41:00.000Z", target: "home", status: 0, ms: 10_000, ok: false, error: "no answer within 10 s" },
    ];
    const s = summarize(rows, now);
    const home = s.endpoints.find((e) => e.key === "home")!;
    expect(home.windows["24h"]).toEqual({ checks: 3, passed: 2, uptime_pct: 66.67, p50_ms: 100, p95_ms: 200 });
    expect(home.windows["7d"]).toEqual({ checks: 4, passed: 2, uptime_pct: 50, p50_ms: 200, p95_ms: 900 });
    expect(home.windows.all).toEqual({ checks: 5, passed: 3, uptime_pct: 60, p50_ms: 200, p95_ms: 900 });
    expect(home.last).toMatchObject({ at: "2026-11-28T11:41:00.000Z", ok: false, status: 0 });
    // An address with no row has no number, not 100%.
    expect(s.endpoints.find((e) => e.key === "mcp")!.windows.all).toEqual({ checks: 0, passed: 0, uptime_pct: null, p50_ms: null, p95_ms: null });
    expect(s).toMatchObject({ state: "checked", since: STATUS_SINCE, first_check_at: "2026-11-19T12:41:00.000Z", last_check_at: "2026-11-28T11:41:00.000Z", checks: 5 });
  });

  it("never counts a row from before 19 Nov 2026 or from the future: no backfill reaches the numbers", () => {
    const now = Date.parse("2026-11-20T00:00:00.000Z");
    const s = summarize([row("2026-11-18T23:00:00.000Z", "home", true, 1), row("2026-11-21T00:00:00.000Z", "home", true, 1)], now);
    expect(s).toMatchObject({ state: "no_checks_yet", checks: 0, first_check_at: null });
  });
});

describe("the store (the 'status' Durable Object's SQLite) under a fake clock", () => {
  it("is empty until the first round: the summary and the page say so, with no number", () => {
    const clock = fakeClock("2026-11-19T16:00:00.000Z");
    const desk = new StatusDesk(memorySql(), { fetch: fakeFetch(clock).fetchFn, now: clock.now });
    const s = desk.summary();
    expect(s).toMatchObject({ state: "no_checks_yet", since: "2026-11-19", checks: 0, first_check_at: null, last_check_at: null });
    for (const e of s.endpoints) for (const w of Object.values(e.windows)) expect(w.uptime_pct).toBeNull();
    const html = checksHtml(s);
    expect(html).toContain("No check has run yet: the first runs at the next hour. Nothing before it is shown or filled in.");
    expect(html).not.toMatch(/%|\bms\b/);
  });

  it("stores each round as it ran; the first check on record is the first round's, and hours with no round have no row", async () => {
    const clock = fakeClock("2026-11-19T17:41:00.000Z");
    const { fetchFn } = fakeFetch(clock);
    const desk = new StatusDesk(memorySql(), { fetch: fetchFn, now: clock.now });
    expect(await desk.run()).toEqual({ checks: 6, passed: 6 });
    clock.set("2026-11-19T18:41:00.000Z");
    await desk.run();
    // A missed hour (no cron firing) leaves a gap: nothing is written for it.
    clock.set("2026-11-19T20:41:00.000Z");
    await desk.run();
    expect(desk.rows()).toHaveLength(18);
    clock.set("2026-11-19T21:00:00.000Z");
    const s = desk.summary();
    expect(s).toMatchObject({ state: "checked", checks: 18, first_check_at: "2026-11-19T17:41:00.000Z" });
    expect(s.endpoints.find((e) => e.key === "try")!.windows["24h"]).toEqual({ checks: 3, passed: 3, uptime_pct: 100, p50_ms: 300, p95_ms: 300 });
    expect(checksHtml(s)).toContain("Hourly checks since 19 Nov 2026 (first check 19 Nov 2026, 17:41 UTC). 18 checks on record");
  });

  it("serves a summary from memory for a minute, and a fresh one after the next round", async () => {
    const clock = fakeClock("2026-11-19T17:41:00.000Z");
    const desk = new StatusDesk(memorySql(), { fetch: fakeFetch(clock).fetchFn, now: clock.now });
    await desk.run();
    const a = desk.summary();
    clock.advance(30_000);
    expect(desk.summary()).toBe(a);
    await desk.run();
    expect(desk.summary().checks).toBe(12);
  });

  it("says when the first check came after the day the checks were added, instead of claiming the earlier date", () => {
    const s = summarize([{ at: "2026-11-23T08:41:00.000Z", target: "home", status: 200, ms: 100, ok: true, error: null }], Date.parse("2026-11-23T09:00:00.000Z"));
    expect(checksHtml(s)).toContain("Hourly checks, added on 19 Nov 2026; first check on record 23 Nov 2026, 08:41 UTC.");
    expect(checksHtml(s)).toContain("<th scope=\"col\">Since 23 Nov 2026</th>");
  });
});

describe("/status and /status.json on the site", () => {
  it("the page as built has the checks' card with no number in it, between the markers the Worker fills in", () => {
    const html = statusPage();
    const card = html.slice(html.indexOf('id="checks"'));
    expect(card).toContain(`${CHECKS_START}<p>No check results in this copy: the hosted site fills this in from its hourly checks.</p>${CHECKS_END}`);
    expect(card).toContain('href="status.json"');
    expect(statusPage("offline")).toContain("No hourly checks in this offline copy.");
  });

  it("the Worker fills the card from the store, escaping what it writes, and says so when the store cannot be read", () => {
    const page = statusPage();
    const s = summarize([{ at: "2026-11-19T17:41:00.000Z", target: "home", status: 200, ms: 120, ok: true, error: null }], Date.parse("2026-11-19T18:00:00.000Z"), [{ ...CHECK_TARGETS[0]!, label: "<b>Home</b>" }]);
    const filled = withChecks(page, s);
    expect(filled).toContain("&lt;b&gt;Home&lt;/b&gt;");
    expect(filled).toContain("100.00%");
    expect(filled.replace(/<!--status-checks-->[\s\S]*<!--\/status-checks-->/, "")).toBe(page.replace(/<!--status-checks-->[\s\S]*<!--\/status-checks-->/, ""));
    expect(withChecks(page, null)).toContain("The hourly checks could not be read just now.");
  });

  it("the kit11 Worker runs the checks hourly from its cron, over the public internet, and serves both paths read-only", () => {
    const conf = readFileSync(new URL("../worker/wrangler.jsonc", import.meta.url), "utf8");
    expect(conf).toMatch(/"triggers": \{ "crons": \["41 \* \* \* \*"\] \}/);
    expect(conf).toContain('"compatibility_flags": ["global_fetch_strictly_public"]');
    const index = readFileSync(new URL("../worker/src/index.ts", import.meta.url), "utf8");
    expect(index).toMatch(/async scheduled\([^)]*\)[^{]*\{\s*ctx\.waitUntil\(env\.RELAY\.get\(env\.RELAY\.idFromName\("status"\)\)\.statusRun\(\)/);
    // The round runs by RPC only: no HTTP path names it.
    expect(index).not.toMatch(/path === "\/status\/run"|statusRun\(\)\s*\)\s*;?\s*\/\/ http/i);
    expect(index).toContain('if (path !== "/status" && path !== "/status.json") return null;');
    expect(index).toContain('if (req.method !== "GET" && req.method !== "HEAD") return null;');
  });
});
