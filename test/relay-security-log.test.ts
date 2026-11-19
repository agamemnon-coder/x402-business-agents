// ASVS 4.0.3 on the site's relay (worker/src/core.ts; docs/security/asvs-l2.md): its security event log (V7.1.3, V7.2.1,
// V7.2.2) with alarms counted on /health (V8.1.4, V11.1.8), append-only in the Durable Object's own SQLite; JSON posts
// refused with 415 unless they say they are JSON (V13.1.5); JSON answers as downloads (V14.4.2); and the passkey
// session's cookie with the __Host- prefix (V3.4.4).
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openDb } from "../src/db/open.js";
import { TERMS_SCHEMA, type Terms } from "../src/lib/terms.js";
import { openEnrolment, recordPasskey } from "../src/passkey/ledger.js";
import { createProposal } from "../src/policy/approvals.js";
import { buildRelayState, stateHash, type RelayState } from "../src/relay/state.js";
import { softPasskey, type SoftPasskey } from "../src/metal/softPasskey.js";
import { Relay, SESSION_COOKIE, viewKeyForWeek, type Sql } from "../worker/src/core.js";

const RP = "kit11.example.workers.dev";
const BASE = `https://${RP}`;
const TOKEN = "t".repeat(64);
const t0 = new Date("2026-11-05T10:00:00Z");
const terms: Terms = { schema: TERMS_SCHEMA, kind: "refund_batch", proposal_id: "P-0001", expires_at: "2026-11-05T10:10:00Z", total: "0.60" };
type Row = { seq: number; at: string; kind: string; ip: string; route: string; status: number; detail_json: string };

afterEach(() => { vi.restoreAllMocks(); });

function sqlOver(db: Database.Database): Sql {
  return { exec(query, ...bindings) { const st = db.prepare(query); const rows = st.reader ? st.all(...bindings) : (st.run(...bindings), []); return { toArray: () => rows }; } };
}
function state(pk: SoftPasskey, health?: unknown): RelayState {
  const db = openDb(":memory:");
  createProposal(db, { terms, createdBy: "support" }, t0);
  const { window } = openEnrolment(db, { rpId: RP, origin: BASE }, t0);
  recordPasskey(db, { window, credentialId: "cred-1", publicKey: "pk", counter: 0, transports: null, aaguid: null, registrationJson: "{}", label: "max" }, t0);
  const s = buildRelayState(db, { rpId: RP, relayToken: TOKEN }, t0);
  s.approvals.passkey.credentials = [{ id: "cred-1", label: "max", enrolled_at: t0.toISOString(), public_key: { x: Buffer.from(pk.key.qx.slice(2), "hex").toString("base64url"), y: Buffer.from(pk.key.qy.slice(2), "hex").toString("base64url") } }];
  if (health !== undefined) (s.snapshot as Record<string, unknown>).health = health;
  return s;
}
function relay(o: { securityAlarms?: string; webhookSecret?: string } = {}) {
  const db = new Database(":memory:");
  const r = new Relay(sqlOver(db), { relayToken: TOKEN, now: () => t0, mfa: true, ...o });
  const rows = (kind?: string) => db.prepare(`SELECT * FROM sec_log${kind ? " WHERE kind = ?" : ""} ORDER BY seq`).all(...(kind ? [kind] : [])) as Row[];
  return { r, db, rows };
}
const push = (r: Relay, s: RelayState, o: { token?: string; type?: string } = {}) => r.fetch(new Request(`${BASE}/api/runner/sync`, { method: "POST", headers: { authorization: `Bearer ${o.token ?? TOKEN}`, "content-type": o.type ?? "application/json", "cf-connecting-ip": "203.0.113.50" }, body: JSON.stringify({ state_hash: stateHash(s), state: s, acks: [] }) }));
const req = (path: string, o: { method?: string; view?: string; cookie?: string; body?: unknown; type?: string | null; ip?: string } = {}) => new Request(`${BASE}${path}`, {
  method: o.method ?? "GET",
  headers: { origin: BASE, ...(o.type === null ? {} : { "content-type": o.type ?? "application/json" }), "cf-connecting-ip": o.ip ?? "198.51.100.23", ...(o.view ? { "x-kit11-view": o.view } : {}), ...(o.cookie ? { cookie: o.cookie } : {}) },
  ...(o.body !== undefined ? { body: JSON.stringify(o.body) } : {}),
});
const b64u = (u: Uint8Array) => Buffer.from(u).toString("base64url");
async function signIn(r: Relay, pk: SoftPasskey, view: string) {
  const { challenge } = (await (await r.fetch(req("/api/session/options", { method: "POST", view, body: {} }))).json()) as { challenge: string };
  const a = pk.assert("0x00", { challenge, origin: BASE, rpId: RP });
  return r.fetch(req("/api/session", { method: "POST", view, body: { challenge, credential: { id: "cred-1", response: { authenticatorData: b64u(a.authenticatorData), clientDataJSON: b64u(a.clientDataJSON), signature: b64u(a.signature) } } } }));
}

describe("the relay's security event log", () => {
  it("a wrong viewer link, a wrong relay token, a bad webhook signature: one failure each, with the network, never the secret", async () => {
    const { r, rows } = relay();
    await push(r, state(softPasskey()));
    expect((await r.fetch(req("/api/snapshot", { view: "not-the-link" }))).status).toBe(401);
    expect((await push(r, state(softPasskey()), { token: "w".repeat(64) })).status).toBe(401);
    expect((await r.fetch(req("/hooks/airwallex", { method: "POST", body: { id: "evt_1" } }))).status).toBe(503);
    const failures = rows("auth.failure");
    expect(failures.map((x) => [x.route, x.status, x.ip])).toEqual([["GET /api/snapshot", 401, "198.51.100.0/24"], ["POST /api/runner/sync", 401, "203.0.113.0/24"]]);
    expect(JSON.stringify(rows())).not.toMatch(/not-the-link|wwwwwwww|tttttttt/);
  });

  it("an Airwallex webhook whose signature does not check: webhook.signature_failure", async () => {
    const { r, rows } = relay({ webhookSecret: "hook-secret-for-the-test" });
    const res = await r.fetch(new Request(`${BASE}/hooks/airwallex`, { method: "POST", headers: { "content-type": "application/json", "x-timestamp": String(t0.getTime()), "x-signature": "0".repeat(64), "cf-connecting-ip": "2001:db8:1:2::9" }, body: JSON.stringify({ id: "evt_1" }) }));
    expect(res.status).toBe(401);
    expect(rows("webhook.signature_failure")).toMatchObject([{ route: "POST /hooks/airwallex", status: 401, ip: "2001:db8:1::/48" }]);
  });

  it("a passkey sign-in: passkey.success; one by an unknown passkey: passkey.failure", async () => {
    const { r, rows } = relay(); const pk = softPasskey(); await push(r, state(pk));
    const view = await viewKeyForWeek(TOKEN, t0);
    expect((await signIn(r, pk, view)).status).toBe(200);
    expect((await signIn(r, softPasskey(), view)).status).toBe(401);
    expect(rows("passkey.success")).toMatchObject([{ route: "POST /api/session", status: 200 }]);
    expect(rows("passkey.failure")).toMatchObject([{ route: "POST /api/session", status: 401 }]);
  });

  it("a post from another site: access.denied; a limit hit: rate.limited", async () => {
    const { r, rows } = relay(); await push(r, state(softPasskey()));
    const view = await viewKeyForWeek(TOKEN, t0);
    expect((await r.fetch(req("/api/session/options", { method: "POST", view, body: {}, ...{} }).clone())).status).toBe(200);
    const evil = new Request(`${BASE}/api/session/options`, { method: "POST", headers: { origin: "https://evil.example", "content-type": "application/json", "x-kit11-view": view }, body: "{}" });
    expect((await r.fetch(evil)).status).toBe(403);
    expect(rows("access.denied")).toMatchObject([{ route: "POST /api/session/options", status: 403 }]);
    let last = 0;
    for (let i = 0; i < 12 && last !== 429; i++) last = (await r.fetch(req("/api/session/options", { method: "POST", view, body: {} }))).status;
    expect(last).toBe(429);
    expect(rows("rate.limited").length).toBeGreaterThanOrEqual(1);
  });

  it("is append-only: no update, no deletion of a row younger than 90 days", async () => {
    const { r, db, rows } = relay();
    await r.fetch(req("/api/snapshot", { view: "x" }));
    const [row] = rows();
    expect(() => db.prepare("UPDATE sec_log SET kind = 'x' WHERE seq = ?").run(row!.seq)).toThrow(/append-only/);
    expect(() => db.prepare("DELETE FROM sec_log WHERE seq = ?").run(row!.seq)).toThrow(/kept 90 days/);
  });

  it("raises one alarm when failures cross the threshold, counted on /health and /health/live with no address", async () => {
    const { r, rows } = relay({ securityAlarms: "auth_failures=3" });
    await push(r, state(softPasskey()));
    expect(((await (await r.fetch(req("/health"))).json()) as { security: unknown }).security).toEqual({ alarms_24h: 0, rules: {} });
    for (let i = 0; i < 5; i++) await r.fetch(req("/api/snapshot", { view: "x", ip: `192.0.2.${i}` }));
    expect(rows("alarm.raised")).toHaveLength(1);
    for (const path of ["/health", "/health/live"]) {
      const body = (await (await r.fetch(req(path))).json()) as Record<string, unknown>;
      expect(body.security, path).toEqual({ alarms_24h: 1, rules: { auth_failures: 1 } });
      expect(JSON.stringify(body)).not.toMatch(/192\.0\.2/);
    }
  });

  it("a runner newly reporting tampered terms: one tamper alarm, not one per sync", async () => {
    const { r, rows } = relay();
    const pk = softPasskey();
    const tampered = { at: t0.toISOString(), alerts: [{ code: "passkey_terms_tampered", severity: "critical" }] };
    for (let i = 0; i < 3; i++) expect((await push(r, state(pk, tampered))).status).toBe(200);
    expect(rows("tamper.alarm")).toHaveLength(1);
    expect(rows("alarm.raised").map((x) => JSON.parse(x.detail_json).rule)).toEqual(["tamper"]);
  });
});

describe("the relay's JSON posts and answers", () => {
  it("refuses a JSON post without Content-Type: application/json with 415, before anything is read", async () => {
    const { r } = relay();
    expect((await push(r, state(softPasskey()), { type: "text/plain" })).status).toBe(415);
    const view = await viewKeyForWeek(TOKEN, t0);
    for (const type of [null, "text/plain", "application/x-www-form-urlencoded"]) {
      const res = await r.fetch(req("/api/session/options", { method: "POST", view, body: {}, type }));
      expect(res.status, String(type)).toBe(415);
    }
    expect((await r.fetch(req("/api/session/options", { method: "POST", view, body: {}, type: "application/json; charset=utf-8" }))).status).not.toBe(415);
  });

  it("marks every JSON answer as a download with nosniff", async () => {
    const { r } = relay(); await push(r, state(softPasskey()));
    for (const res of [await r.fetch(req("/health")), await r.fetch(req("/api/snapshot", { view: "x" }))]) {
      expect(res.headers.get("content-disposition")).toBe('attachment; filename="api.json"');
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    }
  });
});

describe("the passkey session's cookie", () => {
  it("is __Host- prefixed: Secure, Path=/, no Domain; the old name no longer opens a session", async () => {
    const { r } = relay(); const pk = softPasskey(); await push(r, state(pk));
    const view = await viewKeyForWeek(TOKEN, t0);
    const res = await signIn(r, pk, view);
    const set = res.headers.get("set-cookie")!;
    expect(set).toMatch(/^__Host-kit11_session=[A-Za-z0-9_-]{43}; HttpOnly; Secure; SameSite=Strict; Path=\/; Max-Age=43200$/);
    expect(set).not.toMatch(/Domain=/i);
    expect(SESSION_COOKIE).toBe("__Host-kit11_session");
    const value = set.split(";")[0]!.split("=")[1]!;
    expect((await r.fetch(req("/api/ask", { method: "POST", view, cookie: `${SESSION_COOKIE}=${value}`, body: { text: "hi" } }))).status).not.toBe(401);
    expect((await r.fetch(req("/api/ask", { method: "POST", view, cookie: `kit11_session=${value}`, body: { text: "hi" } }))).status).toBe(401);
  });
});
