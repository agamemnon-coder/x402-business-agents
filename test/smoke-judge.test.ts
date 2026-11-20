// npm run smoke:judge (scripts/smoke-judge.ts) and the judge-load tools beside it (scripts/try-concurrent.ts,
// scripts/tryWalkNetwork.ts): their pure parts, with no network and no browser. The checks read from a walk's record,
// the headroom from the owner's aggregates, the one screen, a concurrent run's figures, and the phone and network a
// recorded walk can take.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { headroom, healthOk, pageChecks, PAGES, render, walkChecks, type Ops, type WalkRecord } from "../scripts/smoke-judge.js";
import { concurrencyOf, routeOf, type ConcRecord } from "../scripts/try-concurrent.js";
import { IPHONE, networkProfile, NETWORKS, phonePlan } from "../scripts/tryWalkNetwork.js";
import { AWX_PAYOUT_DAY } from "../worker/src/awxPayout.js";

const ev = (event: string, fields: Record<string, unknown>) => ({ event, subject: null, fields });
/** A walk as scripts/try-live-record.ts writes it when everything went right (its figures cut down to what is read). */
function goodWalk(): WalkRecord & ConcRecord {
  return {
    run: 1, ok: true, failures: [], started_at: "2026-11-21T00:05:00.000Z", finished_at: "2026-11-21T00:06:10.000Z", profile: "desktop", browser: { name: "chromium" },
    steps_ms: { start_ms: 5000, read_120_ms: 6000, autopay_ms: 9000, autopay_awx_paid_ms: 12000, read_1850_ms: 8000, cfo_to_approved_ms: 7000, sign_to_paid_on_screen_ms: 6000, refusal_ms: 700, verify_ms: 60, hold_ms: 7000 },
    calls: [
      { method: "POST", path: "/v1/try/start", status: 201, ms: 1400 },
      { method: "POST", path: "/v1/engine/invoices/AP-0002/pay", status: 200, ms: 7500 },
      { method: "GET", path: "/v1/engine/events?after=0&limit=200", status: 200, ms: 300 },
    ],
    answers: [
      { path: "/v1/engine/invoices/AP-0002/pay", body: { airwallex_payout: { source: "airwallex-sandbox", transfer_id: "t1" } } },
      { path: "/v1/engine/proposals/P-0001/payout/simulate", body: { note: { status: "PAID" } } },
      { path: "/v1/engine/proposals/P-0002/pay", body: { outcome: "paid", airwallex_payout: { source: "airwallex-sandbox", transfer_id: "t2" } } },
      { path: "/v1/engine/proposals/P-0002/payout/simulate", body: { note: { status: "PAID" } } },
      { path: "/v1/engine/proposals/P-0002/pay", body: { outcome: "refused" } },
    ],
    events: {
      main: [
        ev("claude.read", { source: "claude", model: "claude-haiku-5-5", cost_usd_micros: 166 }),
        ev("claude.read", { source: "claude", model: "claude-haiku-5-5", cost_usd_micros: 86 }),
        ev("agent.run", { status: "done", cost_usd_micros: 580 }),
      ],
      cash: [ev("claude.read", { source: "claude", model: "claude-haiku-5-5", cost_usd_micros: 90 })],
    },
    bundle: { downloaded: { repo_verifier: { ok: true } }, paid: { repo_verifier: { ok: true } } },
    console_errors: [],
  };
}

describe("smoke:judge, a walk's checks", () => {
  it("passes a walk where Claude read, both sandbox payouts were PAID, the change was refused and both proofs are valid", () => {
    const checks = walkChecks("desktop", goodWalk());
    expect(checks.map((c) => [c.name, c.ok])).toEqual([
      ["every step of the walk passed", true], ["Claude read the invoices (no fallback)", true], ["Claude's agents answered", true],
      ["Airwallex sandbox: transfers made and PAID", true], ["the one-cent change refused", true], ["both proofs valid (repository's verifier)", true], ["no console error", true],
    ]);
    expect(checks[1]!.detail).toBe("3 of 3 reads by Claude (claude-haiku-5-5); USD 0.0009");
    expect(checks[0]!.ms).toBe(48_760);
  });

  it("fails a walk read by the parser, a payout not sent (with its reason), and an invalid proof, each on its own line", () => {
    const r = goodWalk();
    r.events.cash = [ev("claude.read", { source: "parser", cost_usd_micros: 0 })];
    r.answers[2] = { path: "/v1/engine/proposals/P-0002/pay", body: { outcome: "paid", airwallex_payout: { source: "simulated", reason: "day_cap" } } };
    r.answers.splice(3, 1);
    r.bundle.paid = { repo_verifier: { ok: false } };
    const by = Object.fromEntries(walkChecks("phone", r).map((c) => [c.name, c]));
    expect(by["Claude read the invoices (no fallback)"]!.ok).toBe(false);
    expect(by["Claude read the invoices (no fallback)"]!.detail).toMatch(/^2 of 3 reads by Claude/);
    expect(by["Airwallex sandbox: transfers made and PAID"]!.ok).toBe(false);
    expect(by["Airwallex sandbox: transfers made and PAID"]!.detail).toBe("1 of 2 sent to the sandbox, 1 PAID; not sent: day_cap");
    expect(by["both proofs valid (repository's verifier)"]!.ok).toBe(false);
    expect(by["every step of the walk passed"]!.ok).toBe(true);
  });

  it("says a step's time as unknown when the walk stopped before it", () => {
    const r = goodWalk();
    r.ok = false; r.failures = ["stopped: timeout"]; r.steps_ms.hold_ms = null;
    const first = walkChecks("desktop", r)[0]!;
    expect(first).toMatchObject({ ok: false, ms: null, detail: "stopped: timeout" });
  });
});

describe("smoke:judge, the headroom", () => {
  const ops: Ops = {
    claude: { switch: "on", spent_today_by_pool: { public: { micros: 2_000_000, cap_micros: 10_000_000 }, jury: { micros: 0, cap_micros: 5_000_000 } }, all_time: { micros: 60_000_000, cap_micros: 100_000_000 } },
    switches: { max_inflight: "20", starts_per_address_hour: "50", starts_per_day_public: "300", tokens: "1 tokens" },
    visitors: { last_day: { started: 120 } },
  };

  it("counts the walks each Claude cap still allows at the measured cost, and the payouts a day the code allows", () => {
    const { lines, warnings } = headroom(ops, 5_000, 4);
    expect(lines).toContain("Claude today, public: USD 2.00 of USD 10.00; USD 8.00 left, about 1,600 walks");
    expect(lines).toContain("Claude today, jury: USD 0.00 of USD 5.00; USD 5.00 left, about 1,000 walks");
    expect(lines).toContain("Claude all time: USD 60.00 of USD 100.00; USD 40.00 left, about 8,000 walks");
    expect(lines).toContain("Claude actions in flight at once (max_inflight): 20 (ceiling 20)");
    expect(lines.at(-1)).toBe(`Airwallex sandbox payouts a UTC day (code, AWX_PAYOUT_DAY): ${AWX_PAYOUT_DAY}, 2 a walk; this run used 4, so at most ${(AWX_PAYOUT_DAY - 4) / 2} more walks with payouts today (others' walks count too)`);
    expect(warnings).toEqual([]);
  });

  it("warns when a capacity switch is too tight for 20 judges, or Claude is off", () => {
    const tight: Ops = { ...ops, claude: { ...ops.claude, switch: "off" }, switches: { max_inflight: "4" } };
    const { lines, warnings } = headroom(tight, 5_000, 0);
    expect(lines).toContain("public starts per network an hour: 5 (default) (ceiling 50); a day: 300 (default)");
    expect(warnings).toEqual([
      "the claude switch is off: /try reads with Purser's code, not Claude",
      "max_inflight is 4: 20 judges at once need about 12; set it to 20 (POST /v1/try/admin)",
      "starts_per_address_hour is 5: 20 judges on one network need 40 (2 a walk); set it to 50, or give them a jury link",
    ]);
  });

  it("without the admin token says how to read the caps, and never guesses them", () => {
    const { lines, warnings } = headroom(null, null, 0);
    expect(lines[0]).toMatch(/^Claude caps: not read \(set PURSER_ADMIN_TOKEN/);
    expect(lines).toHaveLength(2);
    expect(warnings).toEqual([]);
  });
});

describe("smoke:judge, the screen", () => {
  it("prints every check on one line under its group, then the headroom, then PASS", () => {
    const checks = walkChecks("desktop", goodWalk());
    const text = render(checks, headroom(null, null, 4), 123_400);
    const lines = text.split("\n");
    expect(lines[0]).toBe("walk: desktop");
    expect(lines[1]).toMatch(/^ {2}PASS {2}every step of the walk passed +48\.8 s {2}all ok$/);
    expect(lines.at(-1)).toBe(`PASS: all ${checks.length} checks passed (123 s)`);
    expect(lines.length).toBeLessThanOrEqual(40);
  });

  it("ends with FAIL and the count when any check failed", () => {
    const checks = walkChecks("desktop", { ...goodWalk(), console_errors: ["main: boom"] });
    expect(render(checks, { lines: [], warnings: ["x"] }, 1_000).split("\n").at(-1)).toBe(`FAIL: 1 of ${checks.length} checks failed (1 s)`);
  });

  it("checks the pages for 200, /health for no alert, and the MCP endpoints for 401 with no token", async () => {
    const seen: { url: string; method: string; auth: boolean }[] = [];
    const fetch = async (url: string, init?: RequestInit) => {
      seen.push({ url, method: init?.method ?? "GET", auth: !!(init?.headers as Record<string, string> | undefined)?.authorization });
      if (url.endsWith("/health")) return new Response(JSON.stringify({ status: "recorded_demo", alerts: [] }), { status: 200 });
      if (url.includes("/mcp")) return new Response("{}", { status: url.endsWith("/mcp") ? 401 : 404 });
      return new Response("<html>", { status: url.endsWith("/visa") ? 500 : 200 });
    };
    const checks = await pageChecks({ site: "https://site.test", tryHost: "https://try.test", fetch });
    expect(checks).toHaveLength(PAGES.length + 3);
    expect(checks.filter((c) => !c.ok).map((c) => `${c.name}: ${c.detail}`)).toEqual(["/visa answers 200: 500", "MCP /mcp/airwallex refuses no token (401): 404"]);
    expect(seen.filter((s) => s.url.includes("/mcp")).every((s) => s.method === "POST" && !s.auth && s.url.startsWith("https://try.test/"))).toBe(true);
    expect([healthOk('{"alerts":[]}'), healthOk('{"alerts":[{"rule":"runner"}]}'), healthOk("<html>"), healthOk("{}")]).toEqual([true, false, false, false]);
  });
});

describe("try:concurrent, the figures of visitors at once", () => {
  it("adds up the walks: results, statuses, Claude refused a reservation, payouts not sent, and each route's times", () => {
    const a = goodWalk();
    const b = { ...goodWalk(), run: 2, ok: false, failures: ["EUR 1,850.00: the Airwallex sandbox transfer simulated to PAID"], started_at: "2026-11-21T00:05:01.500Z", finished_at: "2026-11-21T00:06:40.000Z" };
    b.calls = [...b.calls, { method: "GET", path: "/v1/engine/events?after=9&limit=200", status: 429, ms: 50 }];
    b.events = { main: [...b.events.main, ev("claude.capped", { reason: "busy" }), ev("claude.read", { source: "parser" })], cash: b.events.cash };
    b.answers = b.answers.map((x) => (x.path.endsWith("P-0002/pay") && x.body?.outcome === "paid" ? { ...x, body: { outcome: "paid", airwallex_payout: { source: "simulated", reason: "timeout" } } } : x));
    const f = concurrencyOf([a, b]);
    expect(f).toMatchObject({ visitors: 2, ok: 1, span_s: 100, started_within_ms: 1_500 });
    expect(f.http.s429).toEqual(["GET /v1/engine/events"]);
    expect(f.http.statuses).toEqual({ 200: 4, 201: 2, 429: 1 });
    expect(f.claude).toMatchObject({ reads: 7, by_claude: 6, not_by_claude: { parser: 1 }, capped: { busy: 1 }, agent_runs: 2, agent_runs_done: 2 });
    expect(f.airwallex).toEqual({ payouts_asked: 4, sent_to_sandbox: 3, paid: 4, not_sent: { timeout: 1 } });
    expect(f.routes_ms["POST /v1/engine/invoices/{id}/pay"]).toEqual({ n: 2, p50: 7500, p95: 7500, max: 7500 });
    expect(f.steps_ms.refusal_ms).toEqual({ n: 2, p50: 700, p95: 700, max: 700 });
  });

  it("names routes without their ids or queries", () => {
    expect(routeOf("POST", "/v1/engine/proposals/P-0012/payout/simulate")).toBe("POST /v1/engine/proposals/{id}/payout/simulate");
    expect(routeOf("POST", "/v1/engine/samples/within")).toBe("POST /v1/engine/samples/{name}");
    expect(routeOf("GET", "/v1/engine/events?after=3&limit=200")).toBe("GET /v1/engine/events");
  });
});

describe("a recorded walk's phone and network", () => {
  it("throttles only Chromium, only to a named DevTools preset, and never pretends to elsewhere", () => {
    expect(networkProfile(undefined, "webkit")).toBeNull();
    expect(networkProfile("none", "chromium")).toBeNull();
    expect(networkProfile("slow-4g", "chromium")).toEqual({ name: "slow-4g", latency_ms: 562.5, download_bytes_s: 180_000, upload_bytes_s: 84_375 });
    expect(() => networkProfile("slow-4g", "webkit")).toThrow(/needs Chromium/);
    expect(() => networkProfile("3g", "chromium")).toThrow(/must be one of slow-4g, fast-4g/);
    expect(Object.keys(NETWORKS)).toEqual(["slow-4g", "fast-4g"]);
  });

  it("is an iPhone 15 by Playwright's own figures, and the phone series takes WebKit, Chromium, then Chromium on Slow 4G", () => {
    expect(IPHONE).toMatchObject({ viewport: { width: 393, height: 659 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
    expect(IPHONE.userAgent).toMatch(/iPhone OS 17_5/);
    expect([1, 2, 3, 4].map(phonePlan)).toEqual([
      { profile: "phone-iphone", browser: "webkit" }, { profile: "phone-iphone", browser: "chromium" },
      { profile: "phone-iphone", browser: "chromium", network: "slow-4g" }, { profile: "phone-iphone", browser: "webkit" },
    ]);
  });
});

/** The code of each page.evaluate / waitForFunction callback in a file: from the call's "(" to its matching ")". */
function pageCode(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/\.(evaluate|waitForFunction)\(/g)) {
    let depth = 0, i = m.index + m[0].length - 1;
    for (; i < src.length; i++) { if (src[i] === "(") depth++; else if (src[i] === ")" && --depth === 0) break; }
    out.push(src.slice(m.index, i + 1));
  }
  return out;
}

describe("the walk scripts' code that runs in the page", () => {
  // Mega run walk 2 (19 Nov, docs/runs/2026-11-19-mega-run.md): a named helper inside page.evaluate became
  // __name(helper, "helper") under tsx, and __name does not exist in the page: "ReferenceError: __name is not defined"
  // stopped the walk after the proof download, the one walk of 58 that never reached the hold. No named function in there.
  it.each(["scripts/try-live-record.ts", "scripts/smoke-judge.ts"])("%s names no function inside page code", (file) => {
    const blocks = pageCode(readFileSync(file, "utf8"));
    expect(blocks.length).toBeGreaterThan(0);
    for (const b of blocks) expect(b, b.slice(0, 120)).not.toMatch(/\bfunction\s+[A-Za-z_$]|\b(const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*(async\s*)?(\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/);
  });

  it("finds the named helper that stopped walk 2", () => {
    const [b] = pageCode('p.evaluate(async () => { const wait = (ms) => new Promise((r) => setTimeout(r, ms)); await wait(1); })');
    expect(b).toMatch(/\b(const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*(async\s*)?(\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/);
  });
});
