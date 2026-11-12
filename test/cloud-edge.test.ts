// Purser Cloud on Cloudflare's own platform (cloud/src/edge/): the Rate Limiting bindings in front of what costs, the
// nightly autopilot on the Cron Trigger, and the daily counters behind GET /v1/stats. Here the bindings are fakes with
// the binding's one method and the engine is the Node one (cloud/src/engine/node.ts, test money on the stand-in bank);
// test/cloud-edge-workerd.test.ts runs the same in local workerd with the bindings of cloud/wrangler.jsonc. No network.
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ROUTES } from "../cloud/src/app.js";
import { digestOf, noteEngineCompany, runAutopilot, type AutopilotRun } from "../cloud/src/edge/autopilot.js";
import { edgeRefusal, type RateLimiter } from "../cloud/src/edge/limits.js";
import { EDGE_SCHEMA } from "../cloud/src/edge/schema.js";
import { countsOf, countUp, dailyCounts, pruneCounts } from "../cloud/src/edge/stats.js";
import type { EngineApi, EngineStatus, InvoiceView, Settled } from "../cloud/src/engine/api.js";
import { EN } from "./fakes/apInvoices.js";
import { pdfOf } from "./fakes/pdf.js";
import { testCloud, type TestCloud, type TestTenant } from "./support/cloud.js";
import { cloudWranglerConfig } from "./support/wranglerConfig.js";

const b64 = (b: Uint8Array) => Buffer.from(b).toString("base64");

/** The Rate Limiting binding's one method, exact: `max` calls per key, then refused (the real one is approximate). */
function fakeLimiter(max: number): RateLimiter & { keys: string[] } {
  const n = new Map<string, number>();
  const keys: string[] = [];
  return {
    keys,
    limit: ({ key }) => {
      keys.push(key);
      const seen = (n.get(key) ?? 0) + 1;
      n.set(key, seen);
      return Promise.resolve({ success: seen <= max });
    },
  };
}

describe("the edge's tables", () => {
  it("are cloud/migrations/0002_edge.sql word for word, and hold no secret, account or person", () => {
    expect(EDGE_SCHEMA).toBe(readFileSync("cloud/migrations/0002_edge.sql", "utf8"));
    expect(EDGE_SCHEMA).not.toMatch(/secret TEXT|iban|account TEXT|display_name|email/i);
  });

  it("are in the route table as two routes, after the engine's, each with what it needs", () => {
    const edge = ROUTES.filter((r) => r.path === "/v1/autopilot" || r.path === "/v1/stats");
    expect(edge.map((r) => `${r.method} ${r.path} ${r.need}`)).toEqual(["GET /v1/autopilot read", "GET /v1/stats public"]);
  });
});

describe("the Rate Limiting bindings in front of what costs", () => {
  it("counts a company's writes to its engine per company, and anyone's public calls per address; nothing else", async () => {
    const engineWrites = fakeLimiter(2), publicCalls = fakeLimiter(1);
    const limits = { engineWrites, publicCalls, prefix: "cloud.test" };
    const write = (tenantId: string) => edgeRefusal(limits, { method: "POST", route: "/v1/engine/documents", need: "admin", tenantId, ip: "198.51.100.1" });
    expect(await write("t_a")).toBeNull();
    expect(await write("t_a")).toBeNull();
    expect(await write("t_a")).toMatch(/too many uploads, payments or approvals for this company/);
    expect(await write("t_b")).toBeNull();
    // A read of the engine, or a write elsewhere, is not counted.
    expect(await edgeRefusal(limits, { method: "GET", route: "/v1/engine/invoices", need: "read", tenantId: "t_a", ip: "x" })).toBeNull();
    expect(await edgeRefusal(limits, { method: "POST", route: "/v1/keys", need: "admin", tenantId: "t_a", ip: "x" })).toBeNull();
    const pub = (ip: string) => edgeRefusal(limits, { method: "GET", route: "/v1/health", need: "public", tenantId: null, ip });
    expect(await pub("198.51.100.7")).toBeNull();
    expect(await pub("198.51.100.7")).toMatch(/too many requests from this address/);
    expect(await pub("198.51.100.8")).toBeNull();
    expect(engineWrites.keys).toEqual(["cloud.test|engine:t_a", "cloud.test|engine:t_a", "cloud.test|engine:t_a", "cloud.test|engine:t_b"]);
    expect(publicCalls.keys).toEqual(["cloud.test|public:198.51.100.7", "cloud.test|public:198.51.100.7", "cloud.test|public:198.51.100.8"]);
  });

  it("refuses nothing when unbound, and lets a request through when the binding itself fails", async () => {
    expect(await edgeRefusal(undefined, { method: "POST", route: "/v1/engine/sync", need: "admin", tenantId: "t_a", ip: "x" })).toBeNull();
    const broken: RateLimiter = { limit: () => Promise.reject(new Error("binding away")) };
    expect(await edgeRefusal({ engineWrites: broken, publicCalls: broken }, { method: "POST", route: "/v1/engine/sync", need: "admin", tenantId: "t_a", ip: "x" })).toBeNull();
  });

  describe("behind the cloud's own gates", () => {
    let c: TestCloud;
    let A: TestTenant;
    let B: TestTenant;
    beforeAll(async () => {
      c = testCloud({ engine: true });
      A = await c.tenant("northwind");
      B = await c.tenant("bravo");
      c.env.edge = { limits: { engineWrites: fakeLimiter(2), publicCalls: fakeLimiter(3), prefix: "cloud.test" } };
    });
    afterAll(() => c.close());

    it("answers 429 in the cloud's one error shape past the company's limit; the other company and the reads go on", async () => {
      expect((await c.req("POST", "/v1/engine/sync", { key: A.key })).status).toBe(200);
      expect((await c.req("POST", "/v1/engine/sync", { key: A.key })).status).toBe(200);
      const third = await c.req("POST", "/v1/engine/sync", { key: A.key });
      expect(third.status).toBe(429);
      expect(third.json).toEqual({ error: expect.stringMatching(/too many uploads, payments or approvals/), code: "rate_limited" });
      expect((await c.req("POST", "/v1/engine/sync", { key: B.key })).status).toBe(200);
      expect((await c.req("GET", "/v1/engine/invoices", { key: A.key })).status).toBe(200);
    });

    it("counts a write only once the caller is known: a request without a key is 401 and costs the company nothing", async () => {
      for (let i = 0; i < 3; i++) expect((await c.req("POST", "/v1/engine/sync", { key: null })).status).toBe(401);
      expect((await c.req("POST", "/v1/engine/sync", { key: B.key })).status).toBe(200);
    });

    it("turns the public routes away per address", async () => {
      const at = (ip: string) => c.req("GET", "/v1/health", { headers: { "cf-connecting-ip": ip } });
      for (let i = 0; i < 3; i++) expect((await at("203.0.113.5")).status).toBe(200);
      expect((await at("203.0.113.5")).status).toBe(429);
      expect((await at("203.0.113.6")).status).toBe(200);
    });
  });
});

const VIEW = (o: Partial<InvoiceView>): InvoiceView => ({ id: "AP-0001", status: "ready", status_words: "", payable: true, vendor: "V", invoice_no: "1", currency: "EUR", total: "10.00", due_date: "2026-11-16", read_by: "parser", findings: [], doc_sha256: "0".repeat(64), proposal: null, ...o });
const SETTLED: Settled = { invoice_status: null, transfer_status: null, ledger_entries: 3, vault_added: ["a.pdf", "b.json"], fed: true, error: null };
const STATUS: EngineStatus = { mode: "test_money", passkey: null, balances: { EUR: "1000.00" }, chains: { audit: true, ledger: true } };

describe("the nightly digest", () => {
  it("counts the invoices by status, lists the overdue ones most overdue first, and the ones due within a week", () => {
    const pending = { id: "P-1", kind: "invoice_payment", status: "PENDING_APPROVAL", terms_sha256: "", challenge: "", facts: [], warnings: [] };
    const d = digestOf("2026-11-20", [
      VIEW({ id: "AP-0001", due_date: "2026-11-16" }),
      VIEW({ id: "AP-0002", due_date: "2026-11-01", status: "waiting_cfo", proposal: pending }),
      VIEW({ id: "AP-0003", due_date: "2026-11-01", status: "paid" }),
      VIEW({ id: "AP-0004", due_date: "2026-11-20" }),
      VIEW({ id: "AP-0005", due_date: "2026-11-27", status: "blocked" }),
      VIEW({ id: "AP-0006", due_date: "2026-11-28" }),
      VIEW({ id: "AP-0007", due_date: "unknown" }),
      VIEW({ id: "AP-0008", due_date: "2026-10-01", status: "rejected" }),
    ], SETTLED, STATUS);
    expect(d.invoices.overdue.map((o) => `${o.id} ${o.days_overdue}`)).toEqual(["AP-0002 19", "AP-0001 4"]);
    expect(d.invoices).toMatchObject({ total: 8, overdue_count: 2, due_within_7_days: 2, awaiting_approval: 1, by_status: { ready: 4, waiting_cfo: 1, paid: 1, blocked: 1, rejected: 1 } });
    expect(d.sync).toEqual({ ledger_entries: 3, archived: 2, fed: true, error: null });
    expect(d).toMatchObject({ day: "2026-11-20", mode: "test_money", chains: { audit: true, ledger: true } });
  });

  it("lists at most twenty overdue invoices, and counts them all", () => {
    const many = Array.from({ length: 25 }, (_, i) => VIEW({ id: `AP-${String(i).padStart(4, "0")}`, due_date: "2026-11-01" }));
    const d = digestOf("2026-11-20", many, SETTLED, STATUS);
    expect(d.invoices.overdue).toHaveLength(20);
    expect(d.invoices.overdue_count).toBe(25);
  });
});

describe("the nightly autopilot (the Cron Trigger's daily job)", () => {
  let c: TestCloud;
  let A: TestTenant;
  let B: TestTenant;
  let C: TestTenant;
  const NIGHT = new Date("2026-11-20T03:17:00Z");
  const runs = async (t: TestTenant) => (await c.req("GET", "/v1/autopilot", { key: t.key })).json.items as AutopilotRun[];

  beforeAll(async () => {
    c = testCloud({ engine: true });
    A = await c.tenant("northwind");
    B = await c.tenant("bravo");
    C = await c.tenant("closing");
    expect((await c.req("POST", "/v1/company", { key: A.session, body: { language: "en" } })).status).toBe(200);
    const up = await c.req("POST", "/v1/engine/documents", { key: A.key, body: { filename: "bergtex-BTX-2026-21.pdf", mime: "application/pdf", base64: b64(await pdfOf(EN)) } });
    expect(up.status, JSON.stringify(up.json)).toBe(200);
  }, 60_000);
  afterAll(() => c.close());

  it("runs for a company that wrote to its engine, and writes its digest: the invoice due on the 16th is four days overdue", async () => {
    const r = await runAutopilot(c.env.sql, c.env.engine!, { now: NIGHT });
    expect(r).toEqual({ day: "2026-11-20", done: [A.id], failed: [], skipped: 0 });
    const [run] = await runs(A);
    expect(run).toMatchObject({ day: "2026-11-20", status: "done", error: null });
    expect(run!.digest!.invoices).toMatchObject({ total: 1, overdue_count: 1, by_status: { ready: 1 }, awaiting_approval: 0 });
    expect(run!.digest!.invoices.overdue[0]).toMatchObject({ id: "AP-0001", vendor: "Bergtex Textil GmbH", invoice_no: "BTX-2026-21", currency: "EUR", total: "1850.00", due_date: "2026-11-16", days_overdue: 4 });
    expect(run!.digest!.chains).toEqual({ audit: true, ledger: true });
    expect(run!.digest!.mode).toBe("test_money");
  }, 60_000);

  it("runs once a day: a second firing that day finds nothing to do; the next day runs again", async () => {
    expect(await runAutopilot(c.env.sql, c.env.engine!, { now: new Date("2026-11-20T03:18:00Z") })).toEqual({ day: "2026-11-20", done: [], failed: [], skipped: 0 });
    expect((await runAutopilot(c.env.sql, c.env.engine!, { now: new Date("2026-11-21T03:17:00Z") })).done).toEqual([A.id]);
    expect((await runs(A)).map((r) => r.day)).toEqual(["2026-11-21", "2026-11-20"]);
  }, 60_000);

  it("shows a company only its own runs; a company that never used its engine has none", async () => {
    expect(await runs(B)).toEqual([]);
    const bad = await c.req("GET", "/v1/autopilot?limit=0", { key: A.key });
    expect(bad.status).toBe(400);
    expect((await c.req("GET", "/v1/autopilot?limit=1", { key: A.key })).json.items).toHaveLength(1);
    expect((await c.req("GET", "/v1/autopilot", { key: null })).status).toBe(401);
  });

  it("marks a run that failed, in words without an account number, and the next firing that day takes it again", async () => {
    await noteEngineCompany(c.env.sql, B.id, NIGHT);
    let fail = true;
    const engine = (id: string): EngineApi => {
      const real = c.env.engine!(id);
      return new Proxy(real, { get: (t, m) => (m === "sync" && id === B.id && fail ? () => Promise.reject(new Error("the stand-in bank is away for DE89370400440532013000")) : t[m as keyof EngineApi]) });
    };
    const night = new Date("2026-11-22T03:17:00Z");
    const first = await runAutopilot(c.env.sql, engine, { now: night });
    expect(first.failed).toEqual([B.id]);
    const [run] = await runs(B);
    expect(run).toMatchObject({ day: "2026-11-22", status: "failed", digest: null });
    expect(run!.error).toMatch(/stand-in bank is away/);
    expect(run!.error).not.toMatch(/DE89370400440532013000/);
    fail = false;
    const again = await runAutopilot(c.env.sql, engine, { now: new Date("2026-11-22T04:17:00Z") });
    expect(again.done).toEqual([B.id]);
    expect((await runs(B))[0]).toMatchObject({ day: "2026-11-22", status: "done", error: null });
  }, 60_000);

  it("gives up on an engine that does not answer, and takes a run left running (a firing that died) again once stale", async () => {
    const hang = (): EngineApi => new Proxy({} as EngineApi, { get: () => () => new Promise(() => undefined) });
    const night = new Date("2026-11-23T03:17:00Z");
    const r = await runAutopilot(c.env.sql, hang, { now: night, timeoutMs: 50 });
    expect(r.failed.sort()).toEqual([A.id, B.id].sort());
    expect((await runs(A))[0]!.error).toMatch(/did not answer within/);
    // A firing that died mid-run leaves its row running: a firing within 30 minutes leaves it, a later one takes it.
    await c.env.sql.run("UPDATE autopilot_runs SET status = 'running' WHERE tenant_id = ? AND day = '2026-11-23'", [A.id]);
    const soon = await runAutopilot(c.env.sql, c.env.engine!, { now: new Date("2026-11-23T03:30:00Z") });
    expect(soon.skipped).toBe(1);
    expect(soon.done).toEqual([B.id]);
    const later = await runAutopilot(c.env.sql, c.env.engine!, { now: new Date("2026-11-23T04:00:00Z") });
    expect(later.done).toEqual([A.id]);
  }, 60_000);

  it("skips a closed company, and forgets a purged one's runs", async () => {
    await noteEngineCompany(c.env.sql, C.id, NIGHT);
    expect((await runAutopilot(c.env.sql, c.env.engine!, { now: new Date("2026-11-24T03:17:00Z") })).done.sort()).toEqual([A.id, B.id, C.id].sort());
    expect((await c.req("POST", "/v1/close", { key: C.key })).status).toBe(200);
    expect((await runAutopilot(c.env.sql, c.env.engine!, { now: new Date("2026-11-25T03:17:00Z") })).done.sort()).toEqual([A.id, B.id].sort());
    await c.env.sql.run("UPDATE tenants SET name = '[purged]' WHERE id = ?", [C.id]);
    await runAutopilot(c.env.sql, c.env.engine!, { now: new Date("2026-11-26T03:17:00Z") });
    expect(await c.env.sql.all("SELECT day FROM autopilot_runs WHERE tenant_id = ?", [C.id])).toEqual([]);
    expect(await c.env.sql.all("SELECT tenant_id FROM engine_companies WHERE tenant_id = ?", [C.id])).toEqual([]);
  }, 60_000);

  it("keeps ninety days of runs", async () => {
    await runAutopilot(c.env.sql, c.env.engine!, { now: new Date("2027-02-25T03:17:00Z") });
    // 90 days before 25 February 2027 is 27 November 2026: the run of the 26th goes, a run on the 27th would stay.
    expect((await runs(A)).map((r) => r.day)).toEqual(["2027-02-25"]);
  }, 60_000);

  it("answers 404 on a cloud that runs no engine", async () => {
    const plain = testCloud();
    const t = await plain.tenant("plain");
    expect((await plain.req("GET", "/v1/autopilot", { key: t.key })).status).toBe(404);
    plain.close();
  });
});

describe("the daily counters (GET /v1/stats)", () => {
  const post = (path: string) => new Request(`https://cloud.test${path}`, { method: "POST" });
  const answer = (status: number, body: unknown = {}) => new Response(JSON.stringify(body), { status });

  it("count what the cloud answered: requests, refusals, rate limits, errors, uploads, payments, approvals", async () => {
    expect(await countsOf(new Request("https://cloud.test/"), answer(200))).toEqual([]);
    expect(await countsOf(new Request("https://cloud.test/v1/invoices"), answer(200))).toEqual(["requests"]);
    expect(await countsOf(new Request("https://cloud.test/v1/invoices"), answer(401))).toEqual(["requests", "refused"]);
    expect(await countsOf(new Request("https://cloud.test/v1/invoices"), answer(403))).toEqual(["requests", "refused"]);
    expect(await countsOf(post("/v1/engine/sync"), answer(429))).toEqual(["requests", "rate_limited"]);
    expect(await countsOf(new Request("https://cloud.test/v1/health"), answer(503))).toEqual(["requests", "errors"]);
    expect(await countsOf(post("/v1/engine/documents"), answer(200))).toEqual(["requests", "uploads"]);
    expect(await countsOf(post("/v1/engine/documents"), answer(400))).toEqual(["requests"]);
    expect(await countsOf(post("/v1/engine/invoices/AP-0001/pay"), answer(200))).toEqual(["requests", "payments_filed"]);
    expect(await countsOf(post("/v1/engine/invoices/AP-0001/pay"), answer(409))).toEqual(["requests", "engine_refusals"]);
    expect(await countsOf(post("/v1/engine/proposals/P-0001/approve"), answer(200, { status: "approved" }))).toEqual(["requests", "approvals"]);
    expect(await countsOf(post("/v1/engine/proposals/P-0001/approve"), answer(200, { status: "refused" }))).toEqual(["requests", "engine_refusals"]);
    // The answer itself is still whole for the caller: the counters read a copy.
    const res = answer(200, { status: "approved" });
    await countsOf(post("/v1/engine/proposals/P-0001/approve"), res);
    expect(await res.json()).toEqual({ status: "approved" });
  });

  it("add up per day, answer every metric on every day, and forget what is older than ninety days", async () => {
    const c = testCloud();
    c.env.edge = { stats: true };
    const day1 = new Date("2026-11-07T10:00:00Z");
    await countUp(c.env.sql, ["requests", "refused"], day1);
    await countUp(c.env.sql, ["requests"], day1);
    await countUp(c.env.sql, ["requests", "approvals"], c.clock.now);
    const days = await dailyCounts(c.env.sql, c.clock.now, 3);
    expect(days.map((d) => [d.day, d.requests, d.refused, d.approvals])).toEqual([["2026-11-08", 1, 0, 1], ["2026-11-07", 2, 1, 0], ["2026-11-06", 0, 0, 0]]);
    const r = await c.req("GET", "/v1/stats?days=2");
    expect(r.status).toBe(200);
    expect(r.res.headers.get("cache-control")).toBe("public, max-age=60");
    expect(r.json.metrics).toEqual(["requests", "refused", "rate_limited", "errors", "uploads", "payments_filed", "approvals", "engine_refusals"]);
    expect((r.json.days as { day: string }[]).map((d) => d.day)).toEqual(["2026-11-08", "2026-11-07"]);
    // Nothing of any company in the answer: days and numbers only.
    expect(JSON.stringify(r.json)).not.toMatch(/t_[a-z0-9]{6,}|tenant/);
    expect((await c.req("GET", "/v1/stats?days=91")).status).toBe(400);
    await pruneCounts(c.env.sql, new Date("2027-02-06T03:17:00Z"));
    expect((await dailyCounts(c.env.sql, c.clock.now, 3)).map((d) => d.requests)).toEqual([1, 0, 0]);
    await pruneCounts(c.env.sql, new Date("2027-02-07T03:17:00Z"));
    expect((await dailyCounts(c.env.sql, c.clock.now, 3)).map((d) => d.requests)).toEqual([0, 0, 0]);
    c.close();
  });

  it("answer 404 when the counters are off", async () => {
    const c = testCloud();
    expect((await c.req("GET", "/v1/stats")).status).toBe(404);
    c.close();
  });
});

describe("cloud/wrangler.jsonc", () => {
  it("binds the two rate limiters, each a namespace of its own, a whole minute, and keeps the one daily Cron Trigger", () => {
    const w = cloudWranglerConfig() as unknown as { ratelimits: { name: string; namespace_id: string; simple: { limit: number; period: number } }[]; triggers: { crons: string[] } };
    expect(w.ratelimits).toEqual([
      { name: "ENGINE_LIMITER", namespace_id: "41101", simple: { limit: 20, period: 60 } },
      { name: "PUBLIC_LIMITER", namespace_id: "41102", simple: { limit: 120, period: 60 } },
    ]);
    expect(w.triggers.crons).toEqual(["17 3 * * *"]);
  });
});
