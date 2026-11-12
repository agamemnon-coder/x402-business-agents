// /try/sign stays apart from the CFO's world: a test passkey never approves a real proposal (at the relay or at the
// runner), never signs in to the CFO's pages or opens a passkey session, and a real passkey gives nothing in a test
// world, even if the desk were handed the relay's own store. The bundle carries the page, its API and the landing's
// button only with TRY_SIGN_ENABLED on; off, every path is a 404 and the pages are the ones without it. The page's CSP is
// as strict as the other public pages': one hashed inline script, one hashed inline style, nothing else.
import { TRY_URL } from "../src/redesign/ui.js";
import { createHash } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { openDb } from "../src/db/open.js";
import { TERMS_SCHEMA, termsHash, type Terms } from "../src/lib/terms.js";
import { confirmPasskey, fingerprintOf, openEnrolment } from "../src/passkey/ledger.js";
import { processAssertion, processRegistration, type InboxItem } from "../src/passkey/process.js";
import { challengeFor } from "../src/passkey/webauthn.js";
import { createProposal } from "../src/policy/approvals.js";
import { buildPages } from "../src/relay/assets.js";
import { viewKeyWeekly } from "../src/relay/config.js";
import { startLocalRelay } from "../src/relay/local.js";
import { buildRelayState, stateHash } from "../src/relay/state.js";
import { FakeAuthenticator } from "../src/redteam/authenticator.js";
import { HOME_PAGE } from "../src/servers/dashboard.js";
import { TRY_SIGN_LABEL } from "../src/try/sign.js";
import { notFoundResponse, pageResponse, Relay } from "../worker/src/core.js";
import { TrySignDesk } from "../worker/src/trySign.js";
import { call, challengeOf, desk, signBody, sqlOver, TEST_RATE, withPasskey } from "./support/trySign.js";

const RP = "kit11.example.workers.dev";
const BASE = `https://${RP}`;
const TOKEN = "t".repeat(64);
const t0 = new Date("2026-11-04T10:00:00Z");
let n = 0;
const item = (body: unknown, id: string): InboxItem => ({ ticket: `t-${++n}`, kind: "assertion", proposal_id: id, body: JSON.stringify(body), received_at: t0.toISOString() });

/** The CFO's world: Max's passkey enrolled on the runner, a refund batch waiting, the relay holding both (MFA on). */
async function cfoWorld() {
  const db = openDb(":memory:");
  const max = new FakeAuthenticator();
  const { window, code } = openEnrolment(db, { rpId: RP, origin: BASE }, t0);
  await processRegistration(db, { ticket: "enrol", kind: "registration", proposal_id: null, body: JSON.stringify({ code, credential: max.register({ challenge: window.challenge, origin: BASE, rpId: RP }) }), received_at: t0.toISOString() }, { label: "max" }, t0);
  confirmPasskey(db, fingerprintOf(max.spkiSha256), t0);
  const terms: Terms = { schema: TERMS_SCHEMA, kind: "refund_batch", proposal_id: "P-0001", expires_at: "2026-11-04T10:30:00Z", total: "0.60" };
  createProposal(db, { terms, createdBy: "support" }, t0);
  const relayDb = new Database(":memory:");
  const relay = new Relay(sqlOver(relayDb), { relayToken: TOKEN, now: () => t0, mfa: true });
  const state = buildRelayState(db, { rpId: RP, relayToken: TOKEN, mfa: true }, t0);
  expect(state.approvals.passkey.credentials).toEqual([expect.objectContaining({ id: max.credentialId, public_key: expect.any(Object) })]);
  await relay.fetch(new Request(`${BASE}/api/runner/sync`, { method: "POST", headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" }, body: JSON.stringify({ state_hash: stateHash(state), state, acks: [] }) }));
  return { db, max, relay, relayDb, hash: termsHash(terms), view: viewKeyWeekly(TOKEN, t0) };
}
const post = (relay: Relay, path: string, view: string, body: unknown) => relay.fetch(new Request(`${BASE}${path}`, {
  method: "POST", headers: { origin: BASE, "content-type": "application/json", "x-kit11-view": view, "cf-connecting-ip": "203.0.113.50" }, body: JSON.stringify(body),
}));
const proposalStatus = (db: ReturnType<typeof openDb>) => (db.prepare("SELECT status FROM proposals WHERE proposal_id = 'P-0001'").get() as { status: string }).status;

describe("/try/sign is apart from the CFO's world", () => {
  it("a test passkey can never approve a real proposal: refused at the relay and at the runner", async () => {
    const cfo = await cfoWorld();
    const { d } = desk();
    const visitor = new FakeAuthenticator();
    await withPasskey(d, visitor);
    // The visitor's test passkey signs the real proposal's exact hash, on the real origin: still not the enrolled one.
    const assertion = visitor.sign({ challenge: challengeFor(cfo.hash), origin: BASE, rpId: RP, counter: 1 });
    const atRelay = await post(cfo.relay, "/api/assertions", cfo.view, { proposal_id: "P-0001", terms_sha256: cfo.hash, credential: assertion });
    expect(atRelay.status).toBe(403);
    expect(await atRelay.json()).toMatchObject({ error: expect.stringMatching(/not the enrolled one/) });
    const atRunner = await processAssertion(cfo.db, item({ proposal_id: "P-0001", terms_sha256: cfo.hash, credential: assertion }, "P-0001"), t0);
    expect(atRunner).toMatchObject({ status: "refused", message: "this passkey is not enrolled" });
    expect(proposalStatus(cfo.db)).toBe("PENDING_APPROVAL");
  });

  it("a test passkey can never sign in to the CFO's pages or open a passkey session", async () => {
    const cfo = await cfoWorld();
    const { d } = desk();
    const visitor = new FakeAuthenticator();
    await withPasskey(d, visitor);
    const opt = (await (await post(cfo.relay, "/api/session/options", cfo.view, {})).json()) as { challenge: string; allow: string[] };
    expect(opt.allow).toEqual([cfo.max.credentialId]);
    const a = visitor.sign({ challenge: opt.challenge, origin: BASE, rpId: RP, counter: 1 });
    const res = await post(cfo.relay, "/api/session", cfo.view, { challenge: opt.challenge, credential: { id: visitor.credentialId, response: a.response } });
    expect(res.status).toBe(403);
    expect(res.headers.get("set-cookie")).toBeNull();
    // Its signature under the CFO's credential id does not verify either.
    const opt2 = (await (await post(cfo.relay, "/api/session/options", cfo.view, {})).json()) as { challenge: string };
    const b = visitor.sign({ challenge: opt2.challenge, origin: BASE, rpId: RP, counter: 2 });
    const res2 = await post(cfo.relay, "/api/session", cfo.view, { challenge: opt2.challenge, credential: { id: cfo.max.credentialId, response: b.response } });
    expect(res2.status).toBe(401);
    expect(res2.headers.get("set-cookie")).toBeNull();
    // And the CFO's endpoints stay shut to a device that only did the test world.
    expect((await post(cfo.relay, "/api/ask", cfo.view, { text: "hi" })).status).toBe(401);
    // The test world itself sets no cookie, and its page sends none.
    const w = await call(d, "world", {});
    expect(w.headers.get("set-cookie")).toBeNull();
    expect(buildPages({ TRY_SIGN_ENABLED: "on" }).trySign).toContain('credentials: "omit"');
  });

  it("a real passkey's credential in a test world gives nothing, even if the desk shared the relay's store", async () => {
    const cfo = await cfoWorld();
    for (const shared of [false, true]) {
      // Worst case: the desk handed the relay's own SQL store by mistake. It still reads only its own tables.
      const db = shared ? cfo.relayDb : new Database(":memory:");
      const before = shared ? snapshot(cfo.relayDb) : null;
      const d = new TrySignDesk(sqlOver(db), { now: () => t0, rate: TEST_RATE });
      const { w, b, auth } = await withPasskey(d);
      const real = cfo.max.sign({ challenge: challengeOf(b.terms_sha256), origin: BASE, rpId: RP, counter: 7 });
      const res = await call(d, "sign", signBody(w.world.token, b, real));
      expect({ shared, status: res.status }).toEqual({ shared, status: 403 });
      expect(await res.json()).toMatchObject({ verified: false, why: "unknown passkey" });
      // The visitor's own passkey still works in its world, and nothing of the relay's moved.
      expect((await call(d, "sign", signBody(w.world.token, b, auth.sign({ challenge: challengeOf(b.terms_sha256), origin: BASE, rpId: RP, counter: 1 })))).status).toBe(200);
      if (before) expect(snapshot(cfo.relayDb)).toEqual(before);
    }
    expect(proposalStatus(cfo.db)).toBe("PENDING_APPROVAL");
  });

  it("keeps its own tables: ts_* only, none of the relay's", () => {
    const db = new Database(":memory:");
    new TrySignDesk(sqlOver(db));
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[]).map((r) => r.name);
    expect(tables).toEqual(["ts_agent_runs", "ts_chain", "ts_creds", "ts_hits", "ts_policy", "ts_proposals", "ts_spend", "ts_tricks", "ts_worlds"]);
  });
});

/** Every relay table's rows, to show a test-world visit changed none of them. */
function snapshot(db: Database.Database) {
  const names = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'ts_%' ORDER BY name").all() as { name: string }[]).map((r) => r.name);
  expect(names).toEqual(expect.arrayContaining(["kv", "inbox", "sessions", "session_challenges", "cred_counters", "hits"]));
  return Object.fromEntries(names.map((t) => [t, db.prepare(`SELECT * FROM ${t}`).all()]));
}

describe("/try/sign in the bundle (TRY_SIGN_ENABLED)", () => {
  const prev = process.env.TRY_SIGN_ENABLED;
  afterEach(() => { if (prev === undefined) delete process.env.TRY_SIGN_ENABLED; else process.env.TRY_SIGN_ENABLED = prev; });

  it("off: no page, no API, no button; every page is the one without it", async () => {
    const off = buildPages({});
    expect(off.trySign).toBeUndefined();
    expect(off.csp.trySign).toBeUndefined();
    expect(off.home).toBe(HOME_PAGE);
    expect(off.home).not.toContain("try/sign");
    expect(pageResponse(new Request(`${BASE}/try/sign`), off)).toBeNull();
    expect(notFoundResponse(off).status).toBe(404);
    for (const v of ["off", "", "yes please"]) expect(buildPages({ TRY_SIGN_ENABLED: v }).trySign).toBeUndefined();
  });

  it("on: the page under a strict CSP, the label at the top, and the landing's button to it", async () => {
    const on = buildPages({ TRY_SIGN_ENABLED: "on" });
    const res = pageResponse(new Request(`${BASE}/try/sign`), on)!;
    expect(res.status).toBe(200);
    const html = await res.text();
    const csp = res.headers.get("content-security-policy")!;
    expect(csp).toBe(on.csp.trySign);
    // One inline script, hashed; the data block is JSON, not a script; nothing else may run.
    const scripts = [...html.matchAll(/<script(?: [^>]*)?>([\s\S]*?)<\/script>/g)];
    const code = scripts.filter((m) => !m[0].startsWith('<script type="application/json"'));
    expect(code).toHaveLength(1);
    const hash = createHash("sha256").update(code[0]![1]!, "utf8").digest("base64");
    expect(csp).toContain(`script-src 'sha256-${hash}'`);
    expect(csp).toMatch(/^default-src 'none'; script-src 'sha256-[^' ]+'; style-src 'sha256-[^' ]+'; connect-src 'self';/);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toMatch(/unsafe|https?:|\*/);
    expect(html).not.toMatch(/\son[a-z]+=/i);
    // Nothing is loaded from another origin. The Try tab opens the hands-on demo at the site's own /try (TRY_URL, the
    // owner, 12 Nov: "No jump to purser-try"); the only absolute link goes to the project's own Purser Cloud deployment,
    // under More. Navigations, not resources.
    expect(html).not.toMatch(/src="https?:/);
    expect(TRY_URL).toBe("/try");
    expect(html).toContain(`href="${TRY_URL}"`);
    const abs = [...html.matchAll(/href="(https?:[^"]*)"/g)].map((m) => m[1]!);
    expect(abs.filter((u) => new URL(u).origin !== "https://purser-try.max-31b.workers.dev")).toEqual([]);
    expect(res.headers.get("permissions-policy")).toContain("publickey-credentials-create=(self)");
    // The label, first thing in the body.
    expect(html).toMatch(new RegExp(`<body>\\n<div class="testband" role="note"><div class="row"><span class="tl">.*${TRY_SIGN_LABEL}</span>`));
    expect(TRY_SIGN_LABEL).toBe("Test world · test passkey · nothing real moves");
    // Links and assets absolute, so they work one level down.
    expect(html).not.toMatch(/(?:src|href)="(?!\/|#|https?:)/);
    expect(html).toContain("url(/assets/inter.woff2)");
    // The landing's button, only in this bundle.
    // Since 12 Nov (the owner) every Try call to action opens the hands-on demo (TRY_URL); /try/sign keeps its own page.
    expect(on.home).toContain('href="/try"');
    expect(on.home).toMatch(/<a class="btn primary big start" href="\/try">[\s\S]*?Try it yourself<\/a>/);
  });

  it("the local relay: off, /try/sign and its API are 404; on, the whole visit works", async () => {
    delete process.env.TRY_SIGN_ENABLED;
    const off = await startLocalRelay({ port: 0, token: "x" });
    try {
      expect((await fetch(`${off.url}/try/sign`)).status).toBe(404);
      expect((await fetch(`${off.url}/api/try-sign/world`, { method: "POST", headers: { origin: off.url, "content-type": "application/json" }, body: "{}" })).status).toBe(404);
    } finally { off.server.close(); }
    process.env.TRY_SIGN_ENABLED = "on";
    const on = await startLocalRelay({ port: 0, token: "x" });
    try {
      expect((await fetch(`${on.url}/try/sign`)).status).toBe(200);
      const w = await fetch(`${on.url}/api/try-sign/world`, { method: "POST", headers: { origin: on.url, "content-type": "application/json" }, body: "{}" });
      expect(w.status).toBe(201);
      expect(((await w.json()) as { passkey_options: { rp: { id: string } } }).passkey_options.rp.id).toBe("localhost");
    } finally { on.server.close(); }
  });
});

