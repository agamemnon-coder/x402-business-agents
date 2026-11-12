// Go-live hardening (Max, 9 November: "Blijf doorgaan"): the cloud's health and status, structured logs that carry no
// personal data or secrets, alert webhooks signed with HMAC, retried and capped.
import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { logEvent, redact } from "../cloud/src/log.js";
import { ADMIN_TOKEN, ORIGIN, RP, testCloud, type TestCloud } from "./support/cloud.js";
import { FakeAuthenticator } from "../src/redteam/authenticator.js";

let c: TestCloud;
let t: { id: string; key: string; owner: string };
beforeEach(async () => { c = testCloud(); t = await c.tenant("northwind"); });
afterEach(() => { c.close(); vi.restoreAllMocks(); });

const syncKey = async () => (await c.req("POST", "/v1/keys", { key: t.key, body: { name: "runner", scopes: ["sync"], expires_in_days: 30 } })).json.api_key as string;
const readKey = async () => (await c.req("POST", "/v1/keys", { key: t.key, body: { name: "accountant", scopes: ["read"], expires_in_days: 30 } })).json.api_key as string;
const report = (key: string, alerts: { code: string; severity: string; words?: string }[]) =>
  c.req("POST", "/v1/health/report", { key, body: { at: c.clock.now.toISOString(), status: alerts.length ? "alert" : "ok", alerts } });

describe("GET /v1/health (public)", () => {
  it("says the database and the document store answer, the version and the mail queue, and nothing of any company", async () => {
    const r = await c.req("GET", "/v1/health");
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ ok: true, d1: "ok", r2: "ok", mail_queued: 0 });
    expect(typeof r.json.version).toBe("string");
    expect(JSON.stringify(r.json)).not.toMatch(/northwind|t_[a-z0-9]{6,}/);
  });

  it("answers 503 when the database does not", async () => {
    const real = c.env.sql.first.bind(c.env.sql);
    c.env.sql.first = (async (q: string, p?: unknown[]) => { if (q.startsWith("SELECT 1")) throw new Error("D1 down"); return real(q, p as never); }) as typeof c.env.sql.first;
    const r = await c.req("GET", "/v1/health");
    expect(r.status).toBe(503);
    expect(r.json).toMatchObject({ ok: false, d1: "down" });
  });
});

describe("GET /v1/status (owner)", () => {
  it("shows the last push, the mail queue, the quota used and the runner's alerts, codes only", async () => {
    const sk = await syncKey();
    expect((await report(sk, [{ code: "passkey_failures_spike", severity: "warning", words: "12 refused; supplier Bergtex IBAN DE89370400440532013000" }])).status).toBe(200);
    const r = await c.req("GET", "/v1/status", { key: t.key });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ mail: { queued: 0, refused: 0 }, quota: { messages_today: 0 }, runner: { status: "alert", alerts: [{ code: "passkey_failures_spike", severity: "warning" }] } });
    expect(JSON.stringify(r.json)).not.toMatch(/Bergtex|DE89/);
  });

  it("is for the company's owners and admin keys only, and shows only the caller's company", async () => {
    expect((await c.req("GET", "/v1/status", { key: await readKey() })).status).toBe(403);
    const other = await c.tenant("other");
    await report(await syncKey(), [{ code: "reconciliation_difference", severity: "critical" }]);
    expect((await c.req("GET", "/v1/status", { key: other.key })).json).toMatchObject({ runner: null });
  });

  it("refuses a report from a key without the sync scope, and an alert code that is not a code", async () => {
    expect((await report(await readKey(), [])).status).toBe(403);
    expect((await report(await syncKey(), [{ code: "<script>", severity: "warning" }])).status).toBe(400);
  });
});

describe("alert webhooks", () => {
  type Call = { url: string; body: string; headers: Record<string, string> };
  function outbound(answers: number[]) {
    const calls: Call[] = [];
    c.env.outbound = async (url, init) => {
      calls.push({ url, body: String(init.body), headers: init.headers as Record<string, string> });
      return new Response("", { status: answers.length ? answers.shift()! : 200 });
    };
    c.env.retryDelayMs = 0;
    return calls;
  }

  it("is set by an owner over https only, to a public host; its secret is shown once and never again", async () => {
    for (const url of ["http://hooks.example/x", "https://localhost/x", "https://127.0.0.1/x", "https://10.0.0.5/x", "https://[::1]/x", "https://intranet/x"]) {
      expect((await c.req("POST", "/v1/webhook", { key: t.key, body: { url } })).status).toBe(400);
    }
    const set = await c.req("POST", "/v1/webhook", { key: t.key, body: { url: "https://hooks.example/purser" } });
    expect(set.status).toBe(200);
    expect(set.json.secret).toMatch(/^whsec_[A-Za-z0-9_-]{32,}$/);
    const got = await c.req("GET", "/v1/webhook", { key: t.key });
    expect(got.json).toMatchObject({ url: "https://hooks.example/purser" });
    expect(JSON.stringify(got.json)).not.toContain(set.json.secret as string);
    expect(JSON.stringify((await c.req("GET", "/v1/export", { key: t.key })).json)).not.toContain(set.json.secret as string);
    expect((await c.req("POST", "/v1/webhook", { key: await readKey(), body: { url: "https://hooks.example/x" } })).status).toBe(403);
  });

  it("sends a new alert and its clearing once each, signed with HMAC-SHA256 over the timestamp and the body", async () => {
    const secret = (await c.req("POST", "/v1/webhook", { key: t.key, body: { url: "https://hooks.example/purser" } })).json.secret as string;
    const calls = outbound([]);
    const sk = await syncKey();
    await report(sk, [{ code: "passkey_enrol_closed", severity: "warning" }]);
    await report(sk, [{ code: "passkey_enrol_closed", severity: "warning" }]);
    await report(sk, []);
    expect(calls.map((x) => (JSON.parse(x.body) as { type: string; alert: { code: string } }))).toMatchObject([
      { type: "alert.raised", alert: { code: "passkey_enrol_closed" } },
      { type: "alert.cleared", alert: { code: "passkey_enrol_closed" } },
    ]);
    const sig = calls[0]!.headers["x-purser-signature"]!;
    const m = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(sig);
    expect(m).not.toBeNull();
    expect(m![2]).toBe(createHmac("sha256", secret).update(`${m![1]}.${calls[0]!.body}`).digest("hex"));
    expect(calls[0]!.body).not.toMatch(/northwind test company/);
  });

  it("retries a failed delivery up to three times, then records the failure; twenty failures in a row turn it off", async () => {
    await c.req("POST", "/v1/webhook", { key: t.key, body: { url: "https://hooks.example/purser" } });
    const sk = await syncKey();
    let calls = outbound([500, 502]);
    await report(sk, [{ code: "action_stuck", severity: "warning" }]);
    expect(calls).toHaveLength(3);
    calls = outbound(Array(3).fill(500));
    await report(sk, []);
    expect(calls).toHaveLength(3);
    expect((await c.req("GET", "/v1/webhook", { key: t.key })).json).toMatchObject({ consecutive_failures: 1, disabled_at: null });
    calls = outbound(Array(200).fill(500));
    for (let i = 0; i < 25; i++) await report(sk, i % 2 ? [] : [{ code: "action_stuck", severity: "warning" }]);
    const hook = (await c.req("GET", "/v1/webhook", { key: t.key })).json;
    expect(hook.disabled_at).toBeTruthy();
    expect(calls.length).toBeLessThanOrEqual(3 * 20);
  });

  it("sends at most thirty events an hour per company", async () => {
    await c.req("POST", "/v1/webhook", { key: t.key, body: { url: "https://hooks.example/purser" } });
    const sk = await syncKey();
    const calls = outbound([]);
    for (let i = 0; i < 40; i++) await report(sk, i % 2 ? [] : [{ code: "hold_stale", severity: "warning" }]);
    expect(calls).toHaveLength(30);
  });
});

describe("structured logs", () => {
  it("are one JSON object per line and redact secrets, tokens and account numbers", () => {
    const out: string[] = [];
    vi.spyOn(console, "log").mockImplementation((s: unknown) => { out.push(String(s)); });
    logEvent("info", "test", { authorization: "Bearer pck_abc", note: "pay DE89 3704 0044 0532 0130 00 now", secret: "whsec_x", nested: { token: "t", iban: "NL91ABNA0417164300", key_id: "k_1" } });
    const line = JSON.parse(out[0]!) as Record<string, unknown>;
    expect(line).toMatchObject({ level: "info", event: "test", authorization: "[redacted]", secret: "[redacted]", nested: { token: "[redacted]", iban: "…4300", key_id: "k_1" } });
    expect(out[0]).not.toMatch(/pck_abc|whsec_x|0532 0130 00|NL91ABNA/);
    expect(redact("key pck_live_0123456789abcdef0123")).not.toContain("0123456789abcdef");
  });

  it("a whole session of the API writes no key, session token, invite secret or account number to the log", async () => {
    const out: string[] = [];
    const sink = (s: unknown, ...rest: unknown[]) => { out.push([s, ...rest].map(String).join(" ")); };
    vi.spyOn(console, "log").mockImplementation(sink);
    vi.spyOn(console, "error").mockImplementation(sink);
    vi.spyOn(console, "warn").mockImplementation(sink);
    const sk = await syncKey();
    await c.req("GET", "/v1/invoices", { key: "pck_not_a_real_key_0000000000000000" });
    await c.req("GET", "/v1/invoices", { key: t.key });
    const u = (await c.req("POST", "/v1/users", { key: t.key, body: { display_name: "Accountant", email: "acc@example.test", role: "accountant" } })).json.id as string;
    const inv = (await c.req("POST", `/v1/users/${u}/enrolment`, { key: t.key })).json;
    await report(sk, [{ code: "airwallex_disagrees", severity: "critical", words: "IBAN DE89370400440532013000" }]);
    const log = out.join("\n");
    expect(out.length).toBeGreaterThan(0);
    for (const s of [t.key, sk, "pck_not_a_real_key_0000000000000000", String(inv.token ?? "§"), String(inv.link ?? "§"), "DE89370400440532013000", "acc@example.test"]) expect(log).not.toContain(s);
    for (const l of out.filter((x) => x.startsWith("{"))) expect(() => JSON.parse(l) as unknown).not.toThrow();
  });
});

describe("structured logs of the engine and the hands-on demo", () => {
  it("hold no admin token, pool token, visitor token, session, passkey answer or account number", async () => {
    const out: string[] = [];
    const sink = (x: unknown, ...rest: unknown[]) => { out.push([x, ...rest].map(String).join(" ")); };
    vi.spyOn(console, "log").mockImplementation(sink);
    vi.spyOn(console, "error").mockImplementation(sink);
    vi.spyOn(console, "warn").mockImplementation(sink);
    const d = testCloud({ engine: true, tryIt: {} });
    try {
      await d.req("POST", "/v1/try/admin", { key: ADMIN_TOKEN, body: { op: "set", key: "starts", value: "on" } });
      const token = (await d.req("POST", "/v1/try/admin", { key: ADMIN_TOKEN, body: { op: "token", pool: "jury", until: new Date(d.clock.now.getTime() + 3_600_000).toISOString() } })).json.token as string;
      const st = await d.req("POST", "/v1/try/start", { body: { token }, headers: { "cf-connecting-ip": "203.0.113.77" } });
      const s = st.json.session as string, vt = st.json.visitor_token as string;
      const renewed = (await d.req("POST", "/v1/try/session", { body: { tenant_id: st.json.tenant, visitor_token: vt } })).json.session as string;
      await d.req("POST", "/v1/try/session", { body: { tenant_id: st.json.tenant, visitor_token: "wrong-visitor-token" } });
      const day = (o: number) => new Date(Date.now() + o * 86_400_000).toISOString().slice(0, 10);
      const up = await d.req("POST", "/v1/engine/compose", { key: s, body: { supplier_key: "bergtex", invoice_no: "LOG-1", amount: "321.00", issue_date: day(0), due_date: day(9), iban: "DE89 3704 0044 0532 0130 00" } });
      const phone = new FakeAuthenticator();
      const ps = await d.req("POST", "/v1/engine/passkey/start", { key: s });
      const reg = phone.register({ challenge: ps.json.challenge as string, origin: ORIGIN, rpId: RP });
      await d.req("POST", "/v1/engine/passkey/finish", { key: s, body: { code: ps.json.code, credential: reg } });
      const p = (await d.req("POST", `/v1/engine/invoices/${(up.json.invoice as { id: string }).id}/pay`, { key: s })).json.proposal as { id: string; terms_sha256: string; challenge: string };
      const sig = phone.sign({ challenge: p.challenge, origin: ORIGIN, rpId: RP, counter: 1 });
      await d.req("POST", `/v1/engine/proposals/${p.id}/approve`, { key: s, body: { terms_sha256: p.terms_sha256, credential: sig } });
      const terms = (await d.req("GET", `/v1/engine/proposals/${p.id}/terms`, { key: s })).json.terms as Record<string, unknown>;
      await d.req("POST", `/v1/engine/proposals/${p.id}/pay`, { key: s, body: { terms: { ...terms, amount: "321.01" }, credential: sig } });
      await d.req("POST", `/v1/engine/proposals/${p.id}/pay`, { key: s, body: { terms, credential: sig } });
      await d.req("GET", "/v1/engine/export", { key: s });
      await d.req("POST", "/v1/try/admin", { key: "wrong-admin-token", body: { op: "get" } });
      const log = out.join("\n");
      expect(out.length).toBeGreaterThan(10);
      const answer = (sig as { response: { signature: string; authenticatorData: string } }).response;
      for (const secret of [ADMIN_TOKEN, "wrong-admin-token", token, s, renewed, vt, "wrong-visitor-token", answer.signature, answer.authenticatorData,
        "DE89370400440532013000", "DE89 3704 0044 0532 0130 00", "203.0.113.77"]) expect(log).not.toContain(secret);
    } finally { d.close(); }
  });
});

describe("the runner reports its health with every push", () => {
  it("npm run cloud -- push also sends the runner's alert codes, never their words", async () => {
    const { openDb } = await import("../src/db/open.js");
    const { pushToCloud } = await import("../src/cloudsync/client.js");
    const { countFailure } = await import("../src/passkey/failures.js");
    const db = openDb(":memory:");
    countFailure(db, "terms_tampered", c.clock.now);
    await pushToCloud(db, { url: "https://cloud.test", key: await syncKey(), fetch: c.fetch }, c.clock.now);
    const s = (await c.req("GET", "/v1/status", { key: t.key })).json;
    expect(s).toMatchObject({ runner: { status: "alert", alerts: [{ code: "passkey_terms_tampered", severity: "critical" }] } });
    expect(JSON.stringify(s)).not.toMatch(/emergency stop|npm run verify/);
  });
});
