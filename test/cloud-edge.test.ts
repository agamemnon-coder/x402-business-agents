// Purser Cloud on Cloudflare's own platform (cloud/src/edge/): the nightly autopilot on the Cron Trigger and the daily
// counters behind GET /v1/stats. Here the engine is the Node one (cloud/src/engine/node.ts, test money on the stand-in
// bank); test/cloud-edge-workerd.test.ts runs the same in local workerd with cloud/wrangler.jsonc. No network.
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ROUTES } from "../cloud/src/app.js";
import { digestOf, noteEngineCompany, pruneAutopilot, runAutopilot, type AutopilotRun } from "../cloud/src/edge/autopilot.js";
import { EDGE_SCHEMA, edgeSql } from "../cloud/src/edge/schema.js";
import { consumeMail, enqueueMail, fileMail, MAIL_ATTEMPTS, requeueWaitingMail, type MailJob } from "../cloud/src/edge/inbox.js";
import { receiveEmail } from "../cloud/src/mail.js";
import { countsOf, countUp, dailyCounts, pruneCounts, writeCounts } from "../cloud/src/edge/stats.js";
import { sqliteSql } from "../cloud/src/node.js";
import type { Sql } from "../cloud/src/store.js";
import type { EngineApi, EngineStatus, InvoiceView, Settled } from "../cloud/src/engine/api.js";
import { EN } from "./fakes/apInvoices.js";
import { emlWith, pdfOf } from "./fakes/pdf.js";
import { testCloud, type TestCloud, type TestTenant } from "./support/cloud.js";

const b64 = (b: Uint8Array) => Buffer.from(b).toString("base64");

describe("the edge's tables", () => {
  it("are made on demand where the migration did not run, and an error that is not theirs is left alone", async () => {
    const raw = sqliteSql(":memory:");
    const sql = edgeSql(raw);
    expect(await sql.all("SELECT * FROM daily_counts")).toEqual([]);
    expect(await sql.first<{ n: number }>("SELECT COUNT(*) AS n FROM autopilot_runs")).toEqual({ n: 0 });
    await expect(sql.all("SELECT * FROM no_such_thing")).rejects.toThrow(/no such table: no_such_thing/);
    raw.close();
  });

  it("are cloud/migrations/0002_edge.sql word for word, and hold no secret, account or person", () => {
    expect(EDGE_SCHEMA).toBe(readFileSync("cloud/migrations/0002_edge.sql", "utf8"));
    expect(EDGE_SCHEMA).not.toMatch(/secret TEXT|iban|account TEXT|display_name|email/i);
  });

  it("are in the route table as two routes, after the engine's, each with what it needs", () => {
    const edge = ROUTES.filter((r) => r.path === "/v1/autopilot" || r.path === "/v1/stats");
    expect(edge.map((r) => `${r.method} ${r.path} ${r.need}`)).toEqual(["GET /v1/autopilot read", "GET /v1/stats public"]);
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
    expect(r).toEqual({ day: "2026-11-20", done: [A.id], failed: [], skipped: 0, left: 0 });
    const [run] = await runs(A);
    expect(run).toMatchObject({ day: "2026-11-20", status: "done", error: null });
    expect(run!.digest!.invoices).toMatchObject({ total: 1, overdue_count: 1, by_status: { ready: 1 }, awaiting_approval: 0 });
    expect(run!.digest!.invoices.overdue[0]).toMatchObject({ id: "AP-0001", vendor: "Bergtex Textil GmbH", invoice_no: "BTX-2026-21", currency: "EUR", total: "1850.00", due_date: "2026-11-16", days_overdue: 4 });
    expect(run!.digest!.chains).toEqual({ audit: true, ledger: true });
    expect(run!.digest!.mode).toBe("test_money");
  }, 60_000);

  it("runs once a day: a second firing that day finds nothing to do; the next day runs again", async () => {
    expect(await runAutopilot(c.env.sql, c.env.engine!, { now: new Date("2026-11-20T03:18:00Z") })).toEqual({ day: "2026-11-20", done: [], failed: [], skipped: 0, left: 0 });
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
    // The daily job's clean-up runs whether the autopilot does or not.
    await runAutopilot(c.env.sql, c.env.engine!, { now: new Date("2026-11-26T03:17:00Z") });
    expect((await c.env.sql.all("SELECT day FROM autopilot_runs WHERE tenant_id = ?", [C.id])).length).toBeGreaterThan(0);
    await pruneAutopilot(c.env.sql, new Date("2026-11-26T03:17:00Z"));
    expect(await c.env.sql.all("SELECT day FROM autopilot_runs WHERE tenant_id = ?", [C.id])).toEqual([]);
    expect(await c.env.sql.all("SELECT tenant_id FROM engine_companies WHERE tenant_id = ?", [C.id])).toEqual([]);
  }, 60_000);

  it("takes the company whose last finished run is oldest first, and starts none past the firing's budget", async () => {
    // One company per firing: A and B ran on the 26th; A runs on the 27th, so B is first on the 28th.
    const first = await runAutopilot(c.env.sql, c.env.engine!, { now: new Date("2026-11-27T03:17:00Z"), maxCompanies: 1 });
    const second = await runAutopilot(c.env.sql, c.env.engine!, { now: new Date("2026-11-28T03:17:00Z"), maxCompanies: 1 });
    expect([first.done, second.done].flat().sort()).toEqual([A.id, B.id].sort());
    const none = await runAutopilot(c.env.sql, c.env.engine!, { now: new Date("2026-11-29T03:17:00Z"), budgetMs: 0 });
    expect(none).toMatchObject({ done: [], failed: [], left: 2 });
  }, 60_000);

  it("never notes a hands-on visitor's company (t_try_): it lives a day and has its own sweep", async () => {
    await noteEngineCompany(c.env.sql, "t_try_abcdefgh", NIGHT);
    expect(await c.env.sql.all("SELECT tenant_id FROM engine_companies WHERE tenant_id LIKE 't_try_%'")).toEqual([]);
  });

  it("keeps ninety days of runs", async () => {
    await runAutopilot(c.env.sql, c.env.engine!, { now: new Date("2027-02-25T03:17:00Z") });
    await pruneAutopilot(c.env.sql, new Date("2027-02-25T03:17:00Z"));
    // 90 days before 25 February 2027 is 27 November 2026: the runs before it go, the ones from it on stay.
    const days = (await runs(A)).map((r) => r.day);
    expect(days[0]).toBe("2027-02-25");
    expect(days.length).toBeGreaterThan(1);
    expect(days.every((d) => d >= "2026-11-27")).toBe(true);
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
    expect(await countsOf(post("/v1/engine/documents"), answer(200, { kind: "invoice" }))).toEqual(["requests", "uploads"]);
    expect(await countsOf(post("/v1/engine/documents"), answer(200, { kind: "duplicate_document" }))).toEqual(["requests"]);
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

  it("write no row per request: an isolate's counts go in one batch at most every ten seconds, or at once for an approval", async () => {
    const raw = sqliteSql(":memory:");
    await raw.exec(EDGE_SCHEMA);
    let batches = 0;
    const sql: Sql = { ...raw, batch: (s) => { batches++; return raw.batch(s); } };
    const db = {};
    const t0 = new Date("2026-11-12T10:00:00Z");
    const at = (ms: number) => new Date(t0.getTime() + ms);
    // A page polling every second for nine seconds: one write (the first), the rest kept.
    for (let i = 0; i < 10; i++) await countUp(sql, ["requests"], at(i * 1000), db);
    expect(batches).toBe(1);
    expect((await dailyCounts(sql, t0, 1))[0]!.requests).toBe(1);
    // An approval is written at once, with what was kept.
    await countUp(sql, ["requests", "approvals"], at(9500), db);
    expect(batches).toBe(2);
    expect((await dailyCounts(sql, t0, 1))[0]).toMatchObject({ requests: 11, approvals: 1 });
    // Ten seconds on, the next count writes what was kept.
    await countUp(sql, ["requests"], at(12_000), db);
    expect(batches).toBe(2);
    await countUp(sql, ["requests"], at(19_600), db);
    expect(batches).toBe(3);
    expect((await dailyCounts(sql, t0, 1))[0]!.requests).toBe(13);
    // A write that fails keeps its counts for the next one; the daily job writes what is left.
    const failing: Sql = { ...sql, batch: () => Promise.reject(new Error("D1 away")) };
    await countUp(failing, ["requests"], at(19_700), db);
    await expect(writeCounts(failing, at(30_000), db)).rejects.toThrow(/D1 away/);
    await writeCounts(sql, at(40_000), db);
    expect((await dailyCounts(sql, t0, 1))[0]!.requests).toBe(14);
    raw.close();
  });

  it("answer 404 when the counters are off", async () => {
    const c = testCloud();
    expect((await c.req("GET", "/v1/stats")).status).toBe(404);
    c.close();
  });
});

describe("inbound e-mail through the queue, into the company's engine (cloud/src/edge/inbox.ts)", () => {
  const DOMAIN = "in.cloud.test";
  let c: TestCloud;
  let A: TestTenant;
  const sent: MailJob[] = [];
  const queue = { send: (b: MailJob) => { sent.push(b); return Promise.resolve(); } };
  const message = (to: string, raw: Buffer) => ({ from: "billing@bergtex.example", to, raw: new Uint8Array(raw), rawSize: raw.length, setReject: () => undefined });
  /** A queued message as the queue hands it over, with what the handler did to it. */
  const delivered = (body: unknown, attempts = 1) => {
    const m = { body, attempts, acked: false, retried: null as number | null, ack() { m.acked = true; }, retry(o?: { delaySeconds?: number }) { m.retried = o?.delaySeconds ?? 0; } };
    return m;
  };
  const mailRow = async (id: string) => c.env.sql.first<{ status: string; note: string | null }>("SELECT status, note FROM inbound_mail WHERE tenant_id = ? AND id = ?", [A.id, id]);
  let mailId: string;

  beforeAll(async () => {
    c = testCloud({ engine: true });
    A = await c.tenant("northwind");
    expect((await c.req("POST", "/v1/company", { key: A.session, body: { language: "en" } })).status).toBe(200);
  }, 60_000);
  afterAll(() => c.close());

  it("puts a stored e-mail on the queue for the company it was sent to, and nothing for an unknown address", async () => {
    const raw = emlWith(await pdfOf(EN), "bergtex-BTX-2026-21.pdf");
    const got = await receiveEmail(c.env.sql, c.env.blobs, message(`northwind@${DOMAIN}`, raw), { domain: DOMAIN, now: c.clock.now });
    expect(got).toMatchObject({ queued: true });
    mailId = got.id!;
    expect(await enqueueMail(c.env.sql, queue, { to: `northwind@${DOMAIN}`, domain: DOMAIN, mailId })).toBe(true);
    expect(await enqueueMail(c.env.sql, queue, { to: `nobody@${DOMAIN}`, domain: DOMAIN, mailId })).toBe(false);
    expect(sent).toEqual([{ tenant_id: A.id, mail_id: mailId }]);
  });

  it("files it through the engine's inbox and marks it done; the same message again does nothing more", async () => {
    const m = delivered(sent[0]);
    await consumeMail({ sql: c.env.sql, blobs: c.env.blobs, engine: c.env.engine! }, [m]);
    expect(m.acked).toBe(true);
    expect(await mailRow(mailId)).toEqual({ status: "done", note: "filed by the cloud's engine (email)" });
    const invoices = (await c.req("GET", "/v1/engine/invoices", { key: A.key })).json.items as InvoiceView[];
    expect(invoices.map((i) => `${i.id} ${i.invoice_no} ${i.status}`)).toEqual(["AP-0001 BTX-2026-21 ready"]);
    // At-least-once delivery: the message again is acknowledged and files nothing.
    const again = delivered(sent[0], 2);
    expect(await fileMail({ sql: c.env.sql, blobs: c.env.blobs, engine: c.env.engine! }, sent[0], 2)).toEqual({ outcome: "skipped", note: "already done" });
    await consumeMail({ sql: c.env.sql, blobs: c.env.blobs, engine: c.env.engine! }, [again]);
    expect(again.acked).toBe(true);
    expect(((await c.req("GET", "/v1/engine/invoices", { key: A.key })).json.items as InvoiceView[])).toHaveLength(1);
  }, 60_000);

  it("files nothing twice when a message comes back after the engine took it but before the row was marked", async () => {
    await c.env.sql.run("UPDATE inbound_mail SET status = 'queued', note = NULL WHERE tenant_id = ? AND id = ?", [A.id, mailId]);
    expect(await fileMail({ sql: c.env.sql, blobs: c.env.blobs, engine: c.env.engine! }, sent[0], 3)).toMatchObject({ outcome: "filed" });
    expect(((await c.req("GET", "/v1/engine/invoices", { key: A.key })).json.items as InvoiceView[])).toHaveLength(1);
  }, 60_000);

  it("retries what failed on the way, later each time, then marks it refused with the reason: the dead-letter state", async () => {
    const raw = emlWith(await pdfOf(EN.replace(/BTX-2026-21/g, "BTX-2026-30")), "bergtex-BTX-2026-30.pdf");
    const got = await receiveEmail(c.env.sql, c.env.blobs, message(`northwind@${DOMAIN}`, raw), { domain: DOMAIN, now: c.clock.now });
    const job = { tenant_id: A.id, mail_id: got.id! };
    const away = () => ({ upload: () => Promise.reject(new Error("the engine did not answer (DE89370400440532013000)")) }) as unknown as EngineApi;
    const first = delivered(job, 1);
    await consumeMail({ sql: c.env.sql, blobs: c.env.blobs, engine: away }, [first]);
    expect(first).toMatchObject({ acked: false, retried: 30 });
    const third = delivered(job, 3);
    await consumeMail({ sql: c.env.sql, blobs: c.env.blobs, engine: away }, [third]);
    expect(third).toMatchObject({ acked: false, retried: 90 });
    expect((await mailRow(got.id!))!.status).toBe("queued");
    const last = delivered(job, MAIL_ATTEMPTS);
    await consumeMail({ sql: c.env.sql, blobs: c.env.blobs, engine: away }, [last]);
    expect(last.acked).toBe(true);
    const row = await mailRow(got.id!);
    expect(row!.status).toBe("refused");
    expect(row!.note).toMatch(/^not filed after 5 attempts: the engine did not answer/);
    expect(row!.note).not.toMatch(/DE89370400440532013000/);
  }, 60_000);

  it("marks what the inbox refuses at once (it would refuse it again), and skips what is not its message", async () => {
    const raw = Buffer.from("From: a@b.example\r\nTo: northwind@in.cloud.test\r\nSubject: hello\r\n\r\njust words, no invoice\r\n");
    const got = await receiveEmail(c.env.sql, c.env.blobs, message(`northwind@${DOMAIN}`, raw), { domain: DOMAIN, now: c.clock.now });
    const out = await fileMail({ sql: c.env.sql, blobs: c.env.blobs, engine: c.env.engine! }, { tenant_id: A.id, mail_id: got.id! }, 1);
    // An e-mail without a PDF is taken in by the inbox and files nothing: done, with what the inbox said.
    expect(out.outcome).toBe("filed");
    for (const body of [null, "x", { tenant_id: "t_x'; DROP", mail_id: "m" }, { tenant_id: A.id }, { tenant_id: "t_try_abcdefgh", mail_id: got.id }]) {
      expect((await fileMail({ sql: c.env.sql, blobs: c.env.blobs, engine: c.env.engine! }, body, 1)).outcome).toBe("skipped");
    }
  }, 60_000);

  it("puts e-mail still waiting an hour later on the queue again (the daily job)", async () => {
    const raw = emlWith(await pdfOf(EN.replace(/BTX-2026-21/g, "BTX-2026-31")), "bergtex-BTX-2026-31.pdf");
    const got = await receiveEmail(c.env.sql, c.env.blobs, message(`northwind@${DOMAIN}`, raw), { domain: DOMAIN, now: c.clock.now });
    sent.length = 0;
    expect(await requeueWaitingMail(c.env.sql, queue, new Date(c.clock.now.getTime() + 30 * 60_000))).toBe(0);
    expect(await requeueWaitingMail(c.env.sql, queue, new Date(c.clock.now.getTime() + 61 * 60_000))).toBe(1);
    expect(sent).toEqual([{ tenant_id: A.id, mail_id: got.id }]);
  }, 60_000);
});
