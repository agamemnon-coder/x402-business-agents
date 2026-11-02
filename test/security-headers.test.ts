// The security package (QA, 2 November): the headers on every answer of the relay Worker and of the runner's local
// pages, read from the code that serves them, and the rate limits the docs promise (docs/security.md row 12, 21, 29,
// 31; docs/hardening.md HF1, HF13, R2; docs/airwallex.md), each checked where the docs say it is.
import { request } from "node:http";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { Airwallex } from "../src/airwallex/client.js";
import { ASK_AGENT_PER_HOUR, TASK_LINK_PENDING_MAX, TASK_WITHIN_PER_DAY } from "../src/config/policy.js";
import { openDb } from "../src/db/open.js";
import { softPasskey, type SoftPasskey } from "../src/metal/softPasskey.js";
import { openEnrolment, recordPasskey } from "../src/passkey/ledger.js";
import { createProposal } from "../src/policy/approvals.js";
import { buildPages } from "../src/relay/assets.js";
import { viewKey } from "../src/relay/config.js";
import { buildRelayState, stateHash } from "../src/relay/state.js";
import { approvalsApp } from "../src/servers/approvals.js";
import { CSP, DEMO_CSP, FILM_CSP, LAB_CSP, LIVE_CSP, METAL_CSP, METAL_REPORT_CSP, MONTH_CSP, TRY_CSP, VISA_CSP, dashboardApp } from "../src/servers/dashboard.js";
import { SYSTEM_HEALTH_CSP } from "../src/dashboard/health.js";
import { TERMS_SCHEMA, type Terms } from "../src/lib/terms.js";
import { pageResponse, Relay, viewKeyForWeek, type Sql } from "../worker/src/core.js";
import { TRY_MODEL_PER_MINUTE, TRY_PER_DAY, TRY_PER_MINUTE, TryDesk } from "../worker/src/try.js";

const RP = "kit11.example.workers.dev";
const BASE = `https://${RP}`;
const TOKEN = "t".repeat(64);
const t0 = new Date("2026-11-05T10:00:00Z");
const terms: Terms = { schema: TERMS_SCHEMA, kind: "refund_batch", proposal_id: "P-0001", expires_at: "2026-11-05T10:10:00Z", total: "0.60" };
const sqlOver = (db: Database.Database): Sql => ({ exec(q, ...b) { const st = db.prepare(q); const rows = st.reader ? st.all(...b) : (st.run(...b), []); return { toArray: () => rows }; } });

/** What every answer of the relay carries (worker/src/core.ts COMMON_HEADERS; HF2: HSTS on every answer). */
function expectCommon(res: Response, what: string) {
  expect(res.headers.get("strict-transport-security"), what).toBe("max-age=31536000");
  expect(res.headers.get("x-content-type-options"), what).toBe("nosniff");
  expect(res.headers.get("cache-control"), what).toMatch(/no-store|max-age=86400/);
  expect(res.headers.get("referrer-policy"), what).toBe("no-referrer");
}

/** A CSP that runs nothing it did not name: no inline script by keyword, no eval, no other origin, no framing. */
function expectStrictCsp(csp: string, what: string) {
  expect(csp, what).toMatch(/(^|; )default-src 'none'(;|$)/);
  expect(csp, what).toMatch(/frame-ancestors 'none'/);
  expect(csp, what).toMatch(/base-uri 'none'/);
  expect(csp, what).not.toMatch(/'unsafe-inline'|'unsafe-eval'|https?:|\*/);
}

describe("relay Worker: security headers on every answer", () => {
  const pages = buildPages();
  const page = (path: string) => pageResponse(new Request(`${BASE}${path}`), pages)!;

  it("every page: its own strict CSP, HSTS, nosniff, no-referrer, same-origin opener, passkeys for this site only", () => {
    for (const path of ["/", "/home", "/watch", "/proof", "/month", "/film", "/try", "/lab", "/metal", "/visa", "/airwallex", "/claude", "/metal/report", "/approve/P-0001", "/enrol", "/policy"]) {
      const res = page(path);
      expect(res, path).not.toBeNull();
      expectCommon(res, path);
      expectStrictCsp(res.headers.get("content-security-policy")!, path);
      expect(res.headers.get("cross-origin-opener-policy"), path).toBe("same-origin");
      expect(res.headers.get("permissions-policy"), path).toMatch(/publickey-credentials-get=\(self\).*camera=\(\)/);
      expect(res.headers.get("x-robots-tag"), path).toBe("noindex, nofollow");
    }
  });

  it("old public addresses redirect to the four tabs, with the common headers", () => {
    for (const [from, to] of [["/live", "/watch"], ["/demo", "/watch"]] as const) {
      const res = page(from);
      expect(res.status, from).toBe(302);
      expect(res.headers.get("location"), from).toBe(to);
      expectCommon(res, from);
    }
  });

  it("the assets (script, stylesheet, font, logos) carry the common headers too", () => {
    for (const path of ["/assets/approve.js", "/assets/approve.css", "/assets/inter.woff2", "/assets/logo-metal.svg"]) expectCommon(page(path), path);
  });

  it("the phone pages run only the Worker's own script, inline nothing", () => {
    for (const path of ["/approve/P-0001", "/enrol", "/policy"]) expect(page(path).headers.get("content-security-policy")).toMatch(/script-src 'self'.*style-src 'self'/);
  });

  it("JSON answers: refusals, 404, 405, /health and the passkey sign-in all carry HSTS (HF2)", async () => {
    const r = new Relay(sqlOver(new Database(":memory:")), { relayToken: TOKEN, now: () => t0, mfa: true });
    const db = openDb(":memory:");
    createProposal(db, { terms, createdBy: "support" }, t0);
    const { window } = openEnrolment(db, { rpId: RP, origin: BASE }, t0);
    recordPasskey(db, { window, credentialId: "cred-1", publicKey: "pk", counter: 0, transports: null, aaguid: null, registrationJson: "{}", label: "max" }, t0);
    const pk: SoftPasskey = softPasskey();
    const s = buildRelayState(db, { rpId: RP, relayToken: TOKEN }, t0);
    s.approvals.passkey.credentials = [{ id: "cred-1", label: "max", enrolled_at: t0.toISOString(), public_key: { x: Buffer.from(pk.key.qx.slice(2), "hex").toString("base64url"), y: Buffer.from(pk.key.qy.slice(2), "hex").toString("base64url") } }];
    await r.fetch(new Request(`${BASE}/api/runner/sync`, { method: "POST", headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" }, body: JSON.stringify({ state_hash: stateHash(s), state: s, acks: [] }) }));
    const view = await viewKeyForWeek(TOKEN, t0);
    const req = (path: string, o: { method?: string; body?: unknown; view?: string } = {}) => r.fetch(new Request(`${BASE}${path}`, {
      method: o.method ?? "GET", headers: { origin: BASE, "content-type": "application/json", ...(o.view ? { "x-kit11-view": o.view } : {}) }, ...(o.body !== undefined ? { body: JSON.stringify(o.body) } : {}),
    }));
    const answers: [string, Response][] = [
      ["401 without the viewer key", await req("/api/snapshot")],
      ["404", await req("/api/nothing", { view })],
      ["405", await req("/api/session", { view })],
      ["/health", await req("/health")],
      ["/api/snapshot", await req("/api/snapshot", { view })],
    ];
    const opt = await req("/api/session/options", { method: "POST", view, body: {} });
    const { challenge } = (await opt.json()) as { challenge: string };
    const a = pk.assert("0x00", { challenge, origin: BASE, rpId: RP });
    const b64u = (u: Uint8Array) => Buffer.from(u).toString("base64url");
    const signIn = await req("/api/session", { method: "POST", view, body: { challenge, credential: { id: "cred-1", response: { authenticatorData: b64u(a.authenticatorData), clientDataJSON: b64u(a.clientDataJSON), signature: b64u(a.signature) } } } });
    expect(signIn.status).toBe(200);
    answers.push(["/api/session/options", opt], ["the passkey sign-in", signIn]);
    for (const [what, res] of answers) expectCommon(res, what);
    expect(signIn.headers.get("set-cookie")).toMatch(/HttpOnly; Secure; SameSite=Strict; Path=\/api/);
  });

  it("Try Purser's answers carry them too", async () => {
    const d = new TryDesk(sqlOver(new Database(":memory:")), {});
    const res = await d.fetch(new Request(`${BASE}/api/try`, { method: "POST", body: JSON.stringify({ text: "a flight to Berlin, max €250" }), headers: { "content-type": "application/json", origin: BASE, "cf-connecting-ip": "203.0.113.9" } }));
    expectCommon(res, "/api/try");
    expectCommon(await d.fetch(new Request(`${BASE}/api/try`, { method: "POST", body: "{}", headers: { origin: "https://evil.example" } })), "/api/try refused");
  });
});

/** A GET to a local server with an explicit Host header (fetch cannot set one). */
function get(port: number, path: string, host = `127.0.0.1:${port}`): Promise<{ status: number; headers: Record<string, string | string[] | undefined> }> {
  return new Promise((resolve, reject) => {
    const r = request({ host: "127.0.0.1", port, path, headers: { host } }, (res) => { res.resume(); res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers })); });
    r.on("error", reject);
    r.end();
  });
}

describe("the runner's local pages: security headers", () => {
  it("dashboard server: every route nosniff, no-referrer, no-store; each page its own strict CSP; other Hosts refused", async () => {
    const db = openDb(":memory:");
    const server = dashboardApp(db, { approvalsUrl: "http://127.0.0.1:4200/", now: () => t0 }).listen(0, "127.0.0.1");
    await new Promise<void>((r) => server.once("listening", () => r()));
    const port = (server.address() as { port: number }).port;
    try {
      const csp: Record<string, string> = { "/": CSP, "/month": MONTH_CSP, "/demo": DEMO_CSP, "/live": LIVE_CSP, "/film": FILM_CSP, "/try": TRY_CSP, "/metal": METAL_CSP, "/visa": VISA_CSP, "/metal/report": METAL_REPORT_CSP, "/system-health": SYSTEM_HEALTH_CSP };
      for (const [path, want] of Object.entries(csp)) {
        const res = await get(port, path);
        expect(res.status, path).toBe(200);
        expect(res.headers["content-security-policy"], path).toBe(want);
        expectStrictCsp(want, path);
      }
      expectStrictCsp(LAB_CSP, "/lab");
      for (const path of ["/", "/api/snapshot", "/api/system-health", "/health", "/metrics", "/assets/inter.woff2"]) {
        const res = await get(port, path);
        expect(res.headers["x-content-type-options"], path).toBe("nosniff");
        expect(res.headers["referrer-policy"], path).toBe("no-referrer");
        expect(res.headers["cache-control"], path).toBe("no-store");
        expect(res.headers["x-powered-by"], path).toBeUndefined();
      }
      // DNS rebinding: a page that resolves some name to 127.0.0.1 gets nothing.
      for (const path of ["/", "/api/snapshot", "/system-health", "/api/trace/1"]) expect((await get(port, path, "evil.example")).status, path).toBe(403);
    } finally {
      server.close();
    }
  });

  it("approvals page: no framing, posts only to itself, nosniff, no-store, no-referrer; other Hosts refused", async () => {
    const db = openDb(":memory:");
    const server = approvalsApp(db, { approver: "test", execute: async () => {} }).listen(0, "127.0.0.1");
    await new Promise<void>((r) => server.once("listening", () => r()));
    const port = (server.address() as { port: number }).port;
    try {
      const res = await get(port, "/");
      expect(res.status).toBe(200);
      const csp = String(res.headers["content-security-policy"]);
      expect(csp).toMatch(/default-src 'none'/);
      expect(csp).toMatch(/frame-ancestors 'none'/);
      expect(csp).toMatch(/form-action 'self'/);
      expect(csp).toMatch(/base-uri 'none'/);
      expect(res.headers["x-content-type-options"]).toBe("nosniff");
      expect(res.headers["cache-control"]).toBe("no-store");
      expect(res.headers["referrer-policy"]).toBe("no-referrer");
      expect((await get(port, "/", "evil.example")).status).toBe(403);
    } finally {
      server.close();
    }
  });
});

describe("rate limits where the docs say them", () => {
  const relayWith = () => {
    let clock = t0;
    return { r: new Relay(sqlOver(new Database(":memory:")), { relayToken: TOKEN, now: () => clock }), at: (d: Date) => { clock = d; } };
  };
  const post = (r: Relay, path: string, ip: string, body: unknown = {}) => r.fetch(new Request(`${BASE}${path}`, {
    method: "POST", headers: { origin: BASE, "content-type": "application/json", "x-kit11-view": viewKey(TOKEN), "cf-connecting-ip": ip }, body: JSON.stringify(body),
  }));

  it("relay (security.md #12): ten submissions per address in ten minutes, then 429; another address is not affected", async () => {
    const { r, at } = relayWith();
    for (let i = 0; i < 10; i++) expect((await post(r, "/api/assertions", "198.51.100.1")).status).not.toBe(429);
    expect((await post(r, "/api/assertions", "198.51.100.1")).status).toBe(429);
    expect((await post(r, "/api/assertions", "198.51.100.2")).status).not.toBe(429);
    at(new Date(t0.getTime() + 10 * 60_000 + 1000));
    expect((await post(r, "/api/assertions", "198.51.100.1")).status).not.toBe(429);
  });

  it("relay (HF1): twenty failed viewer-key attempts per address in ten minutes, then refused even with the right key", async () => {
    const { r } = relayWith();
    const snap = (key: string) => r.fetch(new Request(`${BASE}/api/snapshot`, { headers: { "x-kit11-view": key, "cf-connecting-ip": "198.51.100.3" } }));
    for (let i = 0; i < 20; i++) expect((await snap("wrong")).status).toBe(401);
    expect((await snap(viewKey(TOKEN))).status).toBe(429);
  });

  it("relay (security.md #21, #29): one plain-words policy text and one Ask Purser message waiting at a time", async () => {
    const { r } = relayWith();
    const db = openDb(":memory:");
    createProposal(db, { terms, createdBy: "support" }, t0);
    const s = buildRelayState(db, { rpId: RP, relayToken: TOKEN }, t0);
    await r.fetch(new Request(`${BASE}/api/runner/sync`, { method: "POST", headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" }, body: JSON.stringify({ state_hash: stateHash(s), state: s, acks: [] }) }));
    expect((await post(r, "/api/policy-text", "198.51.100.4", { text: "at most 10 a day" })).status).toBe(202);
    expect((await post(r, "/api/policy-text", "198.51.100.5", { text: "and another" })).status).toBe(429);
    expect((await post(r, "/api/ask", "198.51.100.6", { text: "a train to Hamburg, max €80" })).status).toBe(202);
    expect((await post(r, "/api/ask", "198.51.100.7", { text: "and a hotel" })).status).toBe(429);
  });

  it("Try Purser (D21; HF13 said 30, D21 raised it): 6 tries a minute and 40 a day per address, 60 model calls a minute for everyone", async () => {
    expect([TRY_PER_MINUTE, TRY_PER_DAY, TRY_MODEL_PER_MINUTE]).toEqual([6, 40, 60]);
    const d = new TryDesk(sqlOver(new Database(":memory:")), { now: () => t0 });
    const ask = () => d.fetch(new Request(`${BASE}/api/try`, { method: "POST", body: JSON.stringify({ text: "a flight to Berlin, max €250" }), headers: { "content-type": "application/json", origin: BASE, "cf-connecting-ip": "203.0.113.20" } }));
    for (let i = 0; i < TRY_PER_MINUTE; i++) expect((await ask()).status).not.toBe(429);
    expect((await ask()).status).toBe(429);
  });

  it("Ask Purser (R1, R2): an outside agent five asks an hour, the dashboard link three waiting, three cards a day within the policy", () => {
    expect([ASK_AGENT_PER_HOUR, TASK_LINK_PENDING_MAX, TASK_WITHIN_PER_DAY]).toEqual([5, 3, 3]);
  });

  it("Airwallex (airwallex.md): one call per 200 ms, half the sandbox's 10 a second per endpoint", async () => {
    const at: number[] = [];
    let t = 0;
    const fetchImpl = (async (u: string | URL) => {
      at.push(t);
      return new Response(JSON.stringify(String(u).endsWith("/login") ? { token: "x" } : []), { status: 200 });
    }) as typeof fetch;
    const api = new Airwallex({ clientId: "a", apiKey: "b", fetchImpl, now: () => t, sleep: async (ms) => { t += ms; } });
    await Promise.all([api.call("GET", "/balances/current"), api.call("GET", "/balances/current"), api.call("GET", "/balances/current")]);
    const calls = at.slice(1); // after the login
    for (let i = 1; i < calls.length; i++) expect(calls[i]! - calls[i - 1]!).toBeGreaterThanOrEqual(200);
  });
});
