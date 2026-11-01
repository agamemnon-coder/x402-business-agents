// D20: phishing-resistant MFA on the relay (MFA_SESSIONS=on). The viewer link only reads, and expires weekly; the CFO's
// endpoints (policy, policy text, Ask Purser) need a passkey session, which the Worker opens only on a fresh, verified
// passkey assertion against an enrolled credential. The red team: a leaked link, a replayed sign-in, a passkey that is
// not enrolled, a stolen cookie (after it lapses, after the passkey is removed), a wrong origin. Off, nothing changes.
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { openDb } from "../src/db/open.js";
import { TERMS_SCHEMA, type Terms } from "../src/lib/terms.js";
import { openEnrolment, recordPasskey } from "../src/passkey/ledger.js";
import { createProposal } from "../src/policy/approvals.js";
import { buildRelayState, stateHash, type RelayState } from "../src/relay/state.js";
import { viewKey } from "../src/relay/config.js";
import { softPasskey, type SoftPasskey } from "../src/metal/softPasskey.js";
import { Relay, viewKeyForWeek, type Sql } from "../worker/src/core.js";

const RP = "kit11.example.workers.dev";
const BASE = `https://${RP}`;
const TOKEN = "t".repeat(64);
const t0 = new Date("2026-11-05T10:00:00Z");
const terms: Terms = { schema: TERMS_SCHEMA, kind: "refund_batch", proposal_id: "P-0001", expires_at: "2026-11-05T10:10:00Z", total: "0.60" };

function sqlOver(db: Database.Database): Sql {
  return { exec(query, ...bindings) { const st = db.prepare(query); const rows = st.reader ? st.all(...bindings) : (st.run(...bindings), []); return { toArray: () => rows }; } };
}
const xy = (pk: SoftPasskey) => ({ x: Buffer.from(pk.key.qx.slice(2), "hex").toString("base64url"), y: Buffer.from(pk.key.qy.slice(2), "hex").toString("base64url") });

/** The runner's state with cred-1 enrolled, carrying its public key (what the runner syncs under KIT11_MFA). */
function state(pk: SoftPasskey, credentials = [{ id: "cred-1", key: pk }]): RelayState {
  const db = openDb(":memory:");
  createProposal(db, { terms, createdBy: "support" }, t0);
  const { window } = openEnrolment(db, { rpId: RP, origin: BASE }, t0);
  recordPasskey(db, { window, credentialId: "cred-1", publicKey: "pk", counter: 0, transports: null, aaguid: null, registrationJson: "{}", label: "max" }, t0);
  const s = buildRelayState(db, { rpId: RP, relayToken: TOKEN }, t0);
  s.approvals.passkey.credentials = credentials.map((c) => ({ id: c.id, label: "max", enrolled_at: t0.toISOString(), public_key: xy(c.key) }));
  return s;
}
function relay(mfa = true) {
  let clock = t0;
  const db = new Database(":memory:");
  const r = new Relay(sqlOver(db), { relayToken: TOKEN, now: () => clock, mfa });
  return { r, db, at: (d: Date) => { clock = d; } };
}
const push = (r: Relay, s: RelayState) => r.fetch(new Request(`${BASE}/api/runner/sync`, { method: "POST", headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" }, body: JSON.stringify({ state_hash: stateHash(s), state: s, acks: [] }) }));
const req = (path: string, o: { method?: string; view?: string; cookie?: string; body?: unknown; origin?: string } = {}) => new Request(`${BASE}${path}`, {
  method: o.method ?? "GET",
  headers: { origin: o.origin ?? BASE, "content-type": "application/json", ...(o.view ? { "x-kit11-view": o.view } : {}), ...(o.cookie ? { cookie: o.cookie } : {}) },
  ...(o.body !== undefined ? { body: JSON.stringify(o.body) } : {}),
});
const b64u = (u: Uint8Array) => Buffer.from(u).toString("base64url");

async function signIn(r: Relay, pk: SoftPasskey, view: string, credId = "cred-1") {
  const opt = await r.fetch(req("/api/session/options", { method: "POST", view, body: {} }));
  const { challenge } = (await opt.json()) as { challenge: string };
  const a = pk.assert("0x00", { challenge, origin: BASE, rpId: RP });
  const body = { challenge, credential: { id: credId, response: { authenticatorData: b64u(a.authenticatorData), clientDataJSON: b64u(a.clientDataJSON), signature: b64u(a.signature) } } };
  const res = await r.fetch(req("/api/session", { method: "POST", view, body }));
  return { res, body, cookie: (res.headers.get("set-cookie") ?? "").split(";")[0]! };
}

describe("MFA on the relay (D20)", () => {
  it("the viewer link reads only, and expires: this week's and last week's key, not older, not the old fixed key", async () => {
    const { r } = relay(); const pk = softPasskey(); await push(r, state(pk));
    const now = await viewKeyForWeek(TOKEN, t0), last = await viewKeyForWeek(TOKEN, new Date(t0.getTime() - 7 * 864e5)), old = await viewKeyForWeek(TOKEN, new Date(t0.getTime() - 14 * 864e5));
    expect((await r.fetch(req("/api/snapshot", { view: now }))).status).toBe(200);
    expect((await r.fetch(req("/api/snapshot", { view: last }))).status).toBe(200);
    expect((await r.fetch(req("/api/snapshot", { view: old }))).status).toBe(401);
    expect((await r.fetch(req("/api/snapshot", { view: viewKey(TOKEN) }))).status).toBe(401);
  });

  it("red team, a leaked link: it cannot post to the CFO's endpoints", async () => {
    const { r } = relay(); const pk = softPasskey(); await push(r, state(pk));
    const view = await viewKeyForWeek(TOKEN, t0);
    for (const path of ["/api/policy", "/api/policy-text", "/api/ask"]) {
      const res = await r.fetch(req(path, { method: "POST", view, body: { message: "loosen everything" } }));
      expect({ path, status: res.status }).toEqual({ path, status: 401 });
    }
  });

  it("opens a session on a verified passkey: a cookie the page cannot read, for /api only, strict same-site; the CFO's endpoints then answer", async () => {
    const { r } = relay(); const pk = softPasskey(); await push(r, state(pk));
    const view = await viewKeyForWeek(TOKEN, t0);
    const { res, cookie } = await signIn(r, pk, view);
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toMatch(/^kit11_session=[A-Za-z0-9_-]{43}; HttpOnly; Secure; SameSite=Strict; Path=\/api; Max-Age=43200$/);
    const after = await r.fetch(req("/api/ask", { method: "POST", view, cookie, body: {} }));
    expect(after.status).not.toBe(401);
  });

  it("red team, a replay: the same signed sign-in does not open a second session", async () => {
    const { r } = relay(); const pk = softPasskey(); await push(r, state(pk));
    const view = await viewKeyForWeek(TOKEN, t0);
    const { body } = await signIn(r, pk, view);
    expect((await r.fetch(req("/api/session", { method: "POST", view, body }))).status).toBe(401);
  });

  it("red team, the wrong passkey: one that is not enrolled, or an enrolled id signed by another key", async () => {
    const { r } = relay(); const pk = softPasskey(); await push(r, state(pk));
    const view = await viewKeyForWeek(TOKEN, t0);
    expect((await signIn(r, softPasskey(), view, "cred-9")).res.status).toBe(403);
    expect((await signIn(r, softPasskey(), view)).res.status).toBe(401);
  });

  it("red team, a stolen cookie: dead after 12 hours, and at once when its passkey is no longer enrolled", async () => {
    const { r, at } = relay(); const pk = softPasskey(); await push(r, state(pk));
    const view = await viewKeyForWeek(TOKEN, t0);
    const { cookie } = await signIn(r, pk, view);
    at(new Date(t0.getTime() + 12 * 3600e3 + 1000));
    expect((await r.fetch(req("/api/ask", { method: "POST", view, cookie, body: {} }))).status).toBe(401);

    const fresh = relay(); await push(fresh.r, state(pk));
    const s2 = await signIn(fresh.r, pk, view);
    await push(fresh.r, state(pk, [{ id: "cred-2", key: softPasskey() }]));
    expect((await fresh.r.fetch(req("/api/ask", { method: "POST", view, cookie: s2.cookie, body: {} }))).status).toBe(401);
  });

  it("red team, another site: sign-in and posts must come from the relay's own pages", async () => {
    const { r } = relay(); const pk = softPasskey(); await push(r, state(pk));
    const view = await viewKeyForWeek(TOKEN, t0);
    expect((await r.fetch(req("/api/session/options", { method: "POST", view, body: {}, origin: "https://evil.example" }))).status).toBe(403);
  });

  it("the approvals say whether this device has a session, so the page signs in before it posts (no 401 first)", async () => {
    const { r } = relay(); const pk = softPasskey(); await push(r, state(pk));
    const view = await viewKeyForWeek(TOKEN, t0);
    const read = async (cookie?: string) => ((await (await r.fetch(req("/api/approvals", { view, cookie }))).json()) as { session_active?: boolean }).session_active;
    expect(await read()).toBe(false);
    const { cookie } = await signIn(r, pk, view);
    expect(await read(cookie)).toBe(true);
    const off = relay(false); await push(off.r, state(pk));
    const plain = (await (await off.r.fetch(req("/api/approvals", { view: viewKey(TOKEN) }))).json()) as Record<string, unknown>;
    expect("session_active" in plain).toBe(false);
  });

  it("signing in has its own rate limit: it does not use up the approvals' budget, and is itself limited", async () => {
    const { r } = relay(); const pk = softPasskey(); await push(r, state(pk));
    const view = await viewKeyForWeek(TOKEN, t0);
    // Five sign-ins are ten posts; an approval after them is still heard (it may fail on its body, not on the limit).
    for (let i = 0; i < 5; i++) expect((await signIn(r, pk, view)).res.status).toBe(200);
    expect((await r.fetch(req("/api/assertions", { method: "POST", view, body: {} }))).status).not.toBe(429);
    // The sign-in endpoints themselves stop at the same ten posts an address gets in ten minutes.
    expect((await r.fetch(req("/api/session/options", { method: "POST", view, body: {} }))).status).toBe(429);
  });

  it("a sign-in whose two minutes have passed is refused, even unused (security review, 1 Nov)", async () => {
    const { r, at } = relay(); const pk = softPasskey(); await push(r, state(pk));
    const view = await viewKeyForWeek(TOKEN, t0);
    const { challenge } = (await (await r.fetch(req("/api/session/options", { method: "POST", view, body: {} }))).json()) as { challenge: string };
    const a = pk.assert("0x00", { challenge, origin: BASE, rpId: RP });
    at(new Date(t0.getTime() + 2 * 60_000 + 1000));
    const body = { challenge, credential: { id: "cred-1", response: { authenticatorData: b64u(a.authenticatorData), clientDataJSON: b64u(a.clientDataJSON), signature: b64u(a.signature) } } };
    expect((await r.fetch(req("/api/session", { method: "POST", view, body }))).status).toBe(401);
  });

  it("two sign-ins at once never move the stored counter backwards (security review, 1 Nov)", async () => {
    const { r, db } = relay(); const pk = softPasskey(); await push(r, state(pk));
    const view = await viewKeyForWeek(TOKEN, t0);
    const prepared = async () => {
      const { challenge } = (await (await r.fetch(req("/api/session/options", { method: "POST", view, body: {} }))).json()) as { challenge: string };
      const a = pk.assert("0x00", { challenge, origin: BASE, rpId: RP });
      return { challenge, credential: { id: "cred-1", response: { authenticatorData: b64u(a.authenticatorData), clientDataJSON: b64u(a.clientDataJSON), signature: b64u(a.signature) } } };
    };
    const first = await prepared(), second = await prepared(); // counters 1 and 2
    await Promise.all([r.fetch(req("/api/session", { method: "POST", view, body: second })), r.fetch(req("/api/session", { method: "POST", view, body: first }))]);
    expect((db.prepare("SELECT counter FROM cred_counters WHERE credential = 'cred-1'").get() as { counter: number }).counter).toBe(2);
  });

  it("under MFA a new passkey must be ES256, the only kind the Worker can check at sign-in (security review, 1 Nov)", async () => {
    const { r } = relay(); const pk = softPasskey();
    const db = openDb(":memory:");
    createProposal(db, { terms, createdBy: "support" }, t0);
    const { code } = openEnrolment(db, { rpId: RP, origin: BASE }, t0);
    const s = buildRelayState(db, { rpId: RP, relayToken: TOKEN, mfa: true }, t0);
    await push(r, s);
    const view = await viewKeyForWeek(TOKEN, t0);
    const res = await r.fetch(req("/api/enrol/options", { method: "POST", view, body: { code } }));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { pubKeyCredParams: unknown }).pubKeyCredParams).toEqual([{ type: "public-key", alg: -7 }]);
    void pk;
  });

  it("the sign-in paths answer 405, not 404, to a GET", async () => {
    const { r } = relay(); const pk = softPasskey(); await push(r, state(pk));
    const view = await viewKeyForWeek(TOKEN, t0);
    expect((await r.fetch(req("/api/session", { view }))).status).toBe(405);
    expect((await r.fetch(req("/api/session/options", { view }))).status).toBe(405);
  });

  it("with MFA off nothing changes: the fixed viewer key reads and posts as before", async () => {
    const { r } = relay(false); const pk = softPasskey(); await push(r, state(pk));
    expect((await r.fetch(req("/api/snapshot", { view: viewKey(TOKEN) }))).status).toBe(200);
    expect((await r.fetch(req("/api/ask", { method: "POST", view: viewKey(TOKEN), body: {} }))).status).not.toBe(401);
    expect((await r.fetch(req("/api/session/options", { method: "POST", view: viewKey(TOKEN), body: {} }))).status).toBe(404);
  });
});
