// System health (src/dashboard/health.ts): per run and per agent, decisions, latency p50/p95, cost, fallback share and
// refused tool calls, and the SLOs, all from an in-memory ledger built the way the agent loop and the executors write it.
import { describe, expect, it } from "vitest";
import { audit } from "../src/audit/log.js";
import { openDb, type DB } from "../src/db/open.js";
import { percentile, systemHealth, systemHealthPage, SYSTEM_HEALTH_CSP } from "../src/dashboard/health.js";
import { withOrigin } from "../src/provenance/origin.js";
import { dashboardApp } from "../src/servers/dashboard.js";

const t0 = new Date("2026-11-02T10:00:00Z");
const at = (s: number) => new Date(t0.getTime() + s * 1000);
let runN = 0;

/** One agent wake as src/agents/loop.ts and src/autonomy/runtime.ts record it: tool rows, the run row, the decision. */
function wake(db: DB, agent: string, o: { latencyMs: number; costMicros: number; source: "claude" | "fallback" | "idle"; blocked?: number; tools?: number; status?: string; s: number }) {
  const task = `wake.${agent}`;
  const runId = `run-${agent}-${++runN}`;
  const from = (db.prepare("SELECT COALESCE(MAX(seq), 0) AS n FROM audit_log").get() as { n: number }).n;
  for (let i = 0; i < (o.tools ?? 1); i++) {
    audit(db, agent as never, "agent.tool", task, { agent, model: "claude-sonnet-5-5", request_id: `req_${runN}_${i}`, tool: "pay", input: {}, result: "ok", ms: 5, turn: 1, ...(i < (o.blocked ?? 0) ? { blocked_by: "the Metal mandate on chain" } : {}) }, at(o.s));
  }
  audit(db, agent as never, "agent.run", task, {
    agent, model: "claude-sonnet-5-5", status: o.status ?? (o.source === "claude" ? "done" : "unavailable"), turns: 2, tools: [], blocked: [], said: "", cost_usd_micros: o.costMicros,
    latency_ms: o.latencyMs, from_seq: from, run_id: runId, tokens: { input: 10, output: 5, cache_read: 0, cache_write: 0 }, claude_ms: [o.latencyMs], claude_calls: [], request_ids: [],
  }, at(o.s));
  audit(db, agent as never, "agent.decision", task, { agent, source: o.source, model: "claude-sonnet-5-5", summary: "did a thing", events: [], messages: [], tools: [] }, at(o.s));
  return runId;
}

function ledger() {
  runN = 0;
  const db = openDb(":memory:");
  // Sourcing: four wakes, all by Claude, one slow (12 s), one tool call refused by the mandate.
  wake(db, "sourcing", { latencyMs: 2000, costMicros: 1000, source: "claude", s: 1 });
  wake(db, "sourcing", { latencyMs: 4000, costMicros: 3000, source: "claude", blocked: 1, tools: 2, s: 2 });
  wake(db, "sourcing", { latencyMs: 6000, costMicros: 2000, source: "claude", s: 3 });
  wake(db, "sourcing", { latencyMs: 12_000, costMicros: 4000, source: "claude", s: 4 });
  // Treasury: one by Claude, one fallback.
  wake(db, "treasury", { latencyMs: 1000, costMicros: 500, source: "claude", s: 5 });
  wake(db, "treasury", { latencyMs: 30, costMicros: 0, source: "fallback", s: 6 });
  return db;
}

describe("percentile", () => {
  it("is the nearest-rank percentile, null for no data", () => {
    expect(percentile([], 50)).toBeNull();
    expect(percentile([5], 95)).toBe(5);
    expect(percentile([1, 2, 3, 4], 50)).toBe(2);
    expect(percentile([1, 2, 3, 4], 95)).toBe(4);
    expect(percentile([4, 1, 3, 2], 50)).toBe(2);
  });
});

describe("system health from the ledger", () => {
  it("lists each run with its decision, latency, cost, who decided, refused tool calls and a link to its trace", () => {
    const h = systemHealth(ledger(), t0);
    expect(h.runs).toHaveLength(6);
    const slow = h.runs.find((r) => r.latency_ms === 12_000)!;
    expect(slow).toMatchObject({ agent: "sourcing", decided_by: "claude", cost_usd_micros: 4000, refused_tool_calls: 0, decision_seq: expect.any(Number) });
    expect(slow.trace).toBe(`api/trace/${slow.run_seq}`);
    expect(h.runs.find((r) => r.refused_tool_calls === 1)).toMatchObject({ agent: "sourcing", latency_ms: 4000 });
    expect(h.runs.find((r) => r.decided_by === "fallback")).toMatchObject({ agent: "treasury", latency_ms: 30 });
  });

  it("sums each agent: decisions, latency p50 and p95, cost, fallback share and refused tool calls", () => {
    const h = systemHealth(ledger(), t0);
    expect(h.agents).toEqual([
      { agent: "sourcing", runs: 4, decisions: 4, latency_p50_ms: 4000, latency_p95_ms: 12_000, cost_usd_micros: 10_000, fallback_pct: 0, refused_tool_calls: 1 },
      { agent: "treasury", runs: 2, decisions: 2, latency_p50_ms: 30, latency_p95_ms: 1000, cost_usd_micros: 500, fallback_pct: 50, refused_tool_calls: 0 },
    ]);
    expect(h.totals).toMatchObject({ runs: 6, decisions: 6, fallback_pct: 16.7, refused_tool_calls: 1, cost_usd_micros: 10_500, latency_p50_ms: 2000, latency_p95_ms: 12_000 });
  });

  it("judges the SLOs: 99% of decisions under 10 s, 0 double payments, 0 missing origin, fallbacks under 10%", () => {
    const h = systemHealth(ledger(), t0);
    const slo = Object.fromEntries(h.slos.map((s) => [s.id, s]));
    // 5 of 6 under 10 s is 83.3%: missed.
    expect(slo.decision_latency).toMatchObject({ met: false, actual: "83.3% under 10 s (5 of 6)" });
    expect(slo.double_payments).toMatchObject({ met: true, actual: "0" });
    expect(slo.missing_origin).toMatchObject({ met: null }); // no money moved: nothing to check
    expect(slo.fallbacks).toMatchObject({ met: false, actual: "16.7% (1 of 6)" });
    expect(slo.audit_chain).toMatchObject({ met: true });
    expect(slo.finality).toMatchObject({ met: null });
  });

  it("meets the latency and fallback SLOs on a healthy ledger, and says 'no data' on an empty one", () => {
    const empty = systemHealth(openDb(":memory:"), t0);
    expect(empty.slos.find((s) => s.id === "decision_latency")).toMatchObject({ met: null, actual: "no decisions yet" });
    expect(empty.slos.find((s) => s.id === "fallbacks")).toMatchObject({ met: null });
    runN = 0;
    const db = openDb(":memory:");
    for (let i = 0; i < 20; i++) wake(db, "support", { latencyMs: 1000 + i, costMicros: 10, source: "claude", s: i });
    const h = systemHealth(db, t0);
    expect(h.slos.find((s) => s.id === "decision_latency")).toMatchObject({ met: true });
    expect(h.slos.find((s) => s.id === "fallbacks")).toMatchObject({ met: true, actual: "0.0% (0 of 20)" });
  });

  it("counts a money movement without an origin against the SLO", () => {
    const db = ledger();
    withOrigin({ actor: "agent", agent: "sourcing", model: "m", request_id: "r", run_id: "run-1" }, () => audit(db, "sourcing", "upstream.paid", "1", { seq: 1, tx: "0x1" }, t0));
    expect(systemHealth(db, t0).slos.find((s) => s.id === "missing_origin")).toMatchObject({ met: true, actual: "0 of 1" });
    audit(db, "sourcing", "upstream.paid", "2", { seq: 2, tx: "0x2" }, t0); // no origin in force
    expect(systemHealth(db, t0).slos.find((s) => s.id === "missing_origin")).toMatchObject({ met: false, actual: "1 of 2", detail: expect.stringMatching(/upstream\.paid/) });
  });

  it("finds a double payment: two live payouts for one invoice, two transfers under one request_id, one nonce paid twice", () => {
    const db = ledger();
    db.exec("INSERT INTO invoices (invoice_no, vendor, amount, currency, due_date, iban_sha256, bic, beneficiary_id, doc_sha256, extracted_json, status) VALUES ('BTX-1', 'B', '1.00', 'EUR', '2026-11-16', 'x', 'b', NULL, 'd', '{}', 'RECEIVED'), ('btx-1 ', 'B', '1.00', 'EUR', '2026-11-16', 'x', 'b', NULL, 'd', '{}', 'RECEIVED')");
    const tr = db.prepare("INSERT INTO transfers (transfer_id, request_id, invoice_no, amount, currency, method, fee_estimate, status, approval_sha256, updated_at) VALUES (?, ?, ?, '1.00', 'EUR', 'SWIFT', '20.00', ?, 'h', ?)");
    tr.run("tr-1", "req-1", "BTX-1", "PAID", t0.toISOString());
    expect(systemHealth(db, t0).slos.find((s) => s.id === "double_payments")).toMatchObject({ met: true });
    tr.run("tr-2", "req-2", "btx-1 ", "PAID", t0.toISOString()); // the same invoice, written another way
    audit(db, "awx-executor", "transfer.created", "tr-1", { origin: { actor: "code", rule: "test" }, request_id: "req-1" }, t0);
    audit(db, "awx-executor", "transfer.adopted", "tr-9", { origin: { actor: "code", rule: "test" }, request_id: "req-1" }, t0);
    db.prepare("INSERT INTO upstream_purchases (price_cents, nonce, tx_hash, outcome, created_at) VALUES (3, '0xn', ?, 'PAID', ?)").run("0xa", t0.toISOString());
    db.prepare("INSERT INTO upstream_purchases (price_cents, nonce, tx_hash, outcome, created_at) VALUES (3, '0xn', ?, 'PAID', ?)").run("0xb", t0.toISOString());
    const s = systemHealth(db, t0).slos.find((x) => x.id === "double_payments")!;
    expect(s).toMatchObject({ met: false, actual: "3" });
    expect(s.detail).toMatch(/invoice BTX-1.*request_id req-1.*nonce 0xn/s);
  });

  it("a broken audit chain fails its check", () => {
    const db = ledger();
    db.exec("DROP TRIGGER audit_log_no_update");
    db.exec("UPDATE audit_log SET payload_json = '{}' WHERE seq = 2");
    expect(systemHealth(db, t0).slos.find((s) => s.id === "audit_chain")).toMatchObject({ met: false });
  });
});

describe("the System health page and its routes", () => {
  it("renders without a script, escapes what the ledger says, and links each run to its trace", () => {
    const db = ledger();
    audit(db, "sourcing", "agent.run", "<script>alert(1)</script>", { agent: "sourcing", model: "m", status: "done", latency_ms: 1, cost_usd_micros: 0, run_id: "x", from_seq: 0 }, t0);
    const html = systemHealthPage(systemHealth(db, t0));
    expect(html).not.toMatch(/<script/i);
    expect(html).toContain("&lt;script&gt;");
    expect(html).toMatch(/href="api\/trace\/\d+"/);
    expect(html).toContain("99% of decisions under 10 s");
    expect(SYSTEM_HEALTH_CSP).toMatch(/default-src 'none'/);
    expect(SYSTEM_HEALTH_CSP).not.toMatch(/script-src/);
  });

  // Behind the dashboard's loopback-host check like every route (test/security-headers.test.ts checks the Host refusal).
  it("serves /system-health, /api/system-health and /api/trace/:seq on the local dashboard", async () => {
    const db = ledger();
    const server = dashboardApp(db, { approvalsUrl: "http://127.0.0.1:4200/", now: () => t0 }).listen(0, "127.0.0.1");
    await new Promise<void>((r) => server.once("listening", () => r()));
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    try {
      const page = await fetch(`${base}/system-health`);
      expect(page.status).toBe(200);
      expect(page.headers.get("content-security-policy")).toBe(SYSTEM_HEALTH_CSP);
      expect(page.headers.get("x-content-type-options")).toBe("nosniff");
      const json = (await (await fetch(`${base}/api/system-health`)).json()) as { runs: { run_seq: number }[]; slos: unknown[] };
      expect(json.runs).toHaveLength(6);
      const trace = await fetch(`${base}/api/trace/${json.runs[0]!.run_seq}`);
      expect(await trace.json()).toMatchObject({ run_seq: json.runs[0]!.run_seq, agent: expect.any(String), steps: expect.any(Array) });
      expect((await fetch(`${base}/api/trace/99999`)).status).toBe(404);
      expect((await fetch(`${base}/api/trace/abc`)).status).toBe(400);
    } finally {
      server.close();
    }
  });
});
