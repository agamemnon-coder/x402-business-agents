// The relay Worker's logic, run in Node over an in-memory SQLite (the Durable Object's SQL API has the same shape).
// The relay stores what the runner pushes and queues what the phone submits; it can refuse early, never approve.
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { openDb } from "../src/db/open.js";
import { canonicalTerms, rejectionSha256, sha256Hex, TERMS_SCHEMA, termsHash, type Terms } from "../src/lib/terms.js";
import { openEnrolment, recordPasskey } from "../src/passkey/ledger.js";
import { createProposal } from "../src/policy/approvals.js";
import { buildRelayState, stateHash, type RelayState } from "../src/relay/state.js";
import { viewKey } from "../src/relay/config.js";
import { pageResponse, Relay, type Pages, type Sql } from "../worker/src/core.js";

const RP = "kit11.example.workers.dev";
const BASE = `https://${RP}`;
const TOKEN = "t".repeat(64);
const t0 = new Date("2026-10-30T14:00:00Z");
const terms: Terms = { schema: TERMS_SCHEMA, kind: "refund_batch", proposal_id: "P-0001", expires_at: "2026-10-30T14:10:00Z", total: "0.60" };
const HASH = termsHash(terms);

function sqlOver(db: Database.Database): Sql {
  return {
    exec(query, ...bindings) {
      const st = db.prepare(query);
      const rows = st.reader ? st.all(...bindings) : (st.run(...bindings), []);
      return { toArray: () => rows };
    },
  };
}

function relay() {
  let clock = t0;
  const r = new Relay(sqlOver(new Database(":memory:")), { relayToken: TOKEN, now: () => clock });
  return { r, at: (iso: string) => { clock = new Date(iso); } };
}

/** A runner ledger with P-0001 waiting; `enrolled` pins passkey cred-1, otherwise an enrolment window is open. */
function runnerState(opts: { enrolled: boolean }): { state: RelayState; code: string } {
  const db = openDb(":memory:");
  createProposal(db, { terms, createdBy: "support" }, t0);
  const { window, code } = openEnrolment(db, { rpId: RP, origin: BASE }, t0);
  if (opts.enrolled) recordPasskey(db, { window, credentialId: "cred-1", publicKey: "pk", counter: 0, transports: null, aaguid: null, registrationJson: "{}", label: "max" }, t0);
  return { state: buildRelayState(db, { rpId: RP, relayToken: TOKEN }, t0), code };
}

const json = async (res: Response) => (await res.json()) as Record<string, unknown>;
const sync = (r: Relay, body: unknown, token = TOKEN) =>
  r.fetch(new Request(`${BASE}/api/runner/sync`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body) }));
const push = (r: Relay, state: RelayState, acks: unknown[] = []) => sync(r, { state_hash: stateHash(state), state, acks });
const VIEW = { "x-kit11-view": viewKey(TOKEN) };
const post = (r: Relay, path: string, body: unknown, headers: Record<string, string> = {}) =>
  r.fetch(new Request(`${BASE}${path}`, { method: "POST", headers: { origin: BASE, "content-type": "application/json", ...VIEW, ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) }));
const get = (r: Relay, path: string, headers: Record<string, string> = VIEW) => r.fetch(new Request(`${BASE}${path}`, { headers }));
const clientData = (over: Record<string, unknown> = {}) =>
  Buffer.from(JSON.stringify({ type: "webauthn.get", challenge: Buffer.from(HASH, "hex").toString("base64url"), origin: BASE, crossOrigin: false, ...over })).toString("base64url");
const assertion = (over: Record<string, unknown> = {}, cd = clientData()) =>
  ({ proposal_id: "P-0001", terms_sha256: HASH, credential: { id: "cred-1", rawId: "cred-1", type: "public-key", response: { clientDataJSON: cd, authenticatorData: "AA", signature: "AA" }, clientExtensionResults: {} }, ...over });

describe("viewer key (M2)", () => {
  it("serves no data and takes no submission without the viewer key; the runner's own route keeps its token", async () => {
    const { r } = relay();
    const { state } = runnerState({ enrolled: true });
    expect((await push(r, state)).status).toBe(200);
    for (const path of ["/api/snapshot", "/api/approvals", "/api/tickets/t-1"]) {
      for (const headers of [{}, { "x-kit11-view": "0".repeat(32) }, { "x-kit11-view": TOKEN }] as Record<string, string>[]) {
        const res = await get(r, path, headers);
        expect(res.status).toBe(401);
        expect(JSON.stringify(await json(res))).not.toContain("P-0001");
      }
    }
    expect((await post(r, "/api/assertions", assertion(), { "x-kit11-view": "" })).status).toBe(401);
    expect((await get(r, "/api/snapshot")).status).toBe(200);
  });

  it("is derived from the relay token, so the Worker needs no new secret, and differs from it", () => {
    expect(viewKey(TOKEN)).toMatch(/^[0-9a-f]{32}$/);
    expect(TOKEN).not.toContain(viewKey(TOKEN));
    expect(viewKey("other")).not.toBe(viewKey(TOKEN));
  });
});

describe("runner sync", () => {
  it("needs the relay token", async () => {
    const { r } = relay();
    const { state } = runnerState({ enrolled: true });
    expect((await r.fetch(new Request(`${BASE}/api/runner/sync`, { method: "POST", body: "{}" }))).status).toBe(401);
    expect((await sync(r, { state_hash: stateHash(state), state }, "wrong")).status).toBe(401);
    expect((await sync(r, { state_hash: stateHash(state), state }, `${TOKEN}x`)).status).toBe(401);
    expect((await push(r, state)).status).toBe(200);
    expect((await get(r, "/api/runner/sync")).status).toBe(405);
  });

  it("serves the snapshot and the approvals from the last state, with the runner's freshness", async () => {
    const { r, at } = relay();
    const { state } = runnerState({ enrolled: false });
    expect((await get(r, "/api/snapshot")).status).toBe(503);
    expect(await json(await push(r, state))).toEqual({ need_state: false, inbox: [], hooks: [] });
    const snap = await json(await get(r, "/api/snapshot"));
    expect(snap).toMatchObject({ audit: { intact: true }, relay: { synced_at: t0.toISOString(), age_ms: 0 } });
    expect(snap).not.toHaveProperty("approvals");
    const approvalsRes = await get(r, "/api/approvals");
    const text = await approvalsRes.text();
    expect(JSON.parse(text)).toMatchObject({ proposals: [{ proposal_id: "P-0001", terms_sha256: HASH }], passkey: { rp_id: RP, credentials: [] }, enrolment_open: true });
    expect(text).not.toContain(state.enrolment!.code_mac);
    at("2026-10-30T14:00:20Z");
    expect(await json(await get(r, "/api/snapshot"))).toMatchObject({ relay: { age_ms: 20000 } });
  });

  it("asks for the whole state when its copy is missing or different", async () => {
    const { r } = relay();
    const { state } = runnerState({ enrolled: true });
    expect(await json(await sync(r, { state_hash: stateHash(state) }))).toMatchObject({ need_state: true });
    await push(r, state);
    expect(await json(await sync(r, { state_hash: stateHash(state) }))).toMatchObject({ need_state: false });
    expect(await json(await sync(r, { state_hash: "0".repeat(64) }))).toMatchObject({ need_state: true });
  });
});

describe("passkey approvals from the phone", () => {
  it("queues one only for a waiting, unexpired proposal, its exact hash and the pinned passkey", async () => {
    const { r, at } = relay();
    await push(r, runnerState({ enrolled: true }).state);
    const ok = await post(r, "/api/assertions", assertion());
    expect(ok.status).toBe(202);
    expect((await json(ok)).ticket).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect((await post(r, "/api/assertions", assertion({ terms_sha256: "0".repeat(64) }))).status).toBe(409);
    expect((await post(r, "/api/assertions", assertion({ proposal_id: "P-0002" }))).status).toBe(409);
    expect((await post(r, "/api/assertions", assertion({ credential: { ...assertion().credential, id: "someone-else" } }))).status).toBe(403);
    expect((await post(r, "/api/assertions", assertion({ credential: "nope" }))).status).toBe(400);
    at("2026-10-30T14:10:00Z");
    expect((await post(r, "/api/assertions", assertion())).status).toBe(409);
  });

  it("refuses a signature made for other terms, another site or another ceremony before queueing it", async () => {
    const { r } = relay();
    await push(r, runnerState({ enrolled: true }).state);
    for (const cd of [clientData({ challenge: Buffer.alloc(32).toString("base64url") }), clientData({ origin: "https://evil.example" }), clientData({ type: "webauthn.create" }), "bm90IGpzb24"]) {
      expect((await post(r, "/api/assertions", assertion({}, cd), { "cf-connecting-ip": `10.9.${cd.length}.1` })).status).toBe(400);
    }
    expect((await post(r, "/api/assertions", assertion())).status).toBe(202);
  });

  it("refuses a body by its declared size before reading it", async () => {
    const { r } = relay();
    await push(r, runnerState({ enrolled: true }).state);
    expect((await post(r, "/api/assertions", assertion(), { "content-length": "5000000" })).status).toBe(413);
  });

  it("counts an IPv6 /64 as one address", async () => {
    const { r } = relay();
    await push(r, runnerState({ enrolled: true }).state);
    for (let i = 0; i < 10; i++) await post(r, "/api/assertions", assertion({ terms_sha256: "1".repeat(64) }), { "cf-connecting-ip": `2001:db8:0:0::${i + 1}` });
    expect((await post(r, "/api/assertions", assertion(), { "cf-connecting-ip": "2001:db8::ffff" })).status).toBe(429);
    expect((await post(r, "/api/assertions", assertion(), { "cf-connecting-ip": "2001:db8:0:1::1" })).status).toBe(202);
  });

  it("refuses other sites, oversized bodies and floods", async () => {
    const { r } = relay();
    await push(r, runnerState({ enrolled: true }).state);
    expect((await post(r, "/api/assertions", assertion(), { origin: "https://evil.example" })).status).toBe(403);
    expect((await r.fetch(new Request(`${BASE}/api/assertions`, { method: "POST", headers: VIEW, body: JSON.stringify(assertion()) }))).status).toBe(403);
    expect((await post(r, "/api/assertions", { ...assertion(), pad: "x".repeat(20_000) })).status).toBe(413);
    for (let i = 0; i < 3; i++) expect((await post(r, "/api/assertions", assertion(), { "cf-connecting-ip": `10.0.0.${i}` })).status).toBe(202);
    expect((await post(r, "/api/assertions", assertion(), { "cf-connecting-ip": "10.0.0.9" })).status).toBe(429);
  });

  it("limits one address to ten submissions in ten minutes", async () => {
    const { r, at } = relay();
    await push(r, runnerState({ enrolled: true }).state);
    const ip = { "cf-connecting-ip": "192.0.2.7" };
    for (let i = 0; i < 10; i++) expect((await post(r, "/api/assertions", assertion({ terms_sha256: "1".repeat(64) }), ip)).status).toBe(409);
    expect((await post(r, "/api/assertions", assertion(), ip)).status).toBe(429);
    at("2026-10-30T14:10:01Z");
    expect((await post(r, "/api/assertions", assertion({ terms_sha256: "1".repeat(64) }), ip)).status).toBe(409);
  });

  it("queues a rejection only when it signs the rejection hash, and shows the verdict 'rejected'", async () => {
    const { r } = relay();
    const { state } = runnerState({ enrolled: true });
    await push(r, state);
    const rejectCd = clientData({ challenge: Buffer.from(rejectionSha256(HASH), "hex").toString("base64url") });
    // An approval signature labelled as a rejection, and a rejection signature sent as an approval, are refused here.
    expect((await post(r, "/api/assertions", assertion({ decision: "REJECTED" }))).status).toBe(400);
    expect((await post(r, "/api/assertions", assertion({}, rejectCd), { "cf-connecting-ip": "10.2.0.1" })).status).toBe(400);
    expect((await post(r, "/api/assertions", assertion({ decision: "MAYBE" }, rejectCd), { "cf-connecting-ip": "10.2.0.2" })).status).toBe(400);
    const sent = await post(r, "/api/assertions", assertion({ decision: "REJECTED" }, rejectCd), { "cf-connecting-ip": "10.2.0.3" });
    expect(sent.status).toBe(202);
    const { ticket } = (await json(sent)) as { ticket: string };
    await push(r, state, [{ ticket, status: "rejected", message: "P-0001 rejected" }]);
    expect(await json(await get(r, `/api/tickets/${ticket}`))).toMatchObject({ status: "rejected", message: "P-0001 rejected" });
  });

  it("hands the queue to the runner and shows the runner's verdict on the ticket", async () => {
    const { r } = relay();
    const { state } = runnerState({ enrolled: true });
    await push(r, state);
    const { ticket } = (await json(await post(r, "/api/assertions", assertion()))) as { ticket: string };
    expect(await json(await get(r, `/api/tickets/${ticket}`))).toMatchObject({ ticket, status: "queued", proposal_id: "P-0001" });
    const first = (await json(await push(r, state))) as { inbox: { ticket: string; kind: string; body: string }[] };
    expect(first.inbox).toEqual([expect.objectContaining({ ticket, kind: "assertion", proposal_id: "P-0001" })]);
    expect(JSON.parse(first.inbox[0]!.body)).toEqual(assertion());
    expect((await json(await push(r, state, [{ ticket, status: "approved", message: "P-0001 approved" }]))).inbox).toEqual([]);
    expect(await json(await get(r, `/api/tickets/${ticket}`))).toMatchObject({ status: "approved", message: "P-0001 approved" });
    await push(r, state, [{ ticket, status: "executed", message: "P-0001 executed" }]);
    expect(await json(await get(r, `/api/tickets/${ticket}`))).toMatchObject({ status: "executed" });
    expect((await get(r, "/api/tickets/nope")).status).toBe(404);
  });

  it("forgets answered tickets after an hour and unanswered ones after thirty minutes", async () => {
    const { r, at } = relay();
    const { state } = runnerState({ enrolled: true });
    await push(r, state);
    const a = ((await json(await post(r, "/api/assertions", assertion()))) as { ticket: string }).ticket;
    const b = ((await json(await post(r, "/api/assertions", assertion(), { "cf-connecting-ip": "10.1.1.1" }))) as { ticket: string }).ticket;
    await push(r, state, [{ ticket: a, status: "refused", message: "no" }]);
    at("2026-10-30T14:30:01Z");
    await push(r, state);
    expect((await get(r, `/api/tickets/${b}`)).status).toBe(404);
    expect((await get(r, `/api/tickets/${a}`)).status).toBe(200);
    at("2026-10-30T15:00:01Z");
    await push(r, state);
    expect((await get(r, `/api/tickets/${a}`)).status).toBe(404);
  });
});

describe("policy changes from the phone", () => {
  const policyTerms = (over: Record<string, unknown> = {}) => canonicalTerms({
    schema: TERMS_SCHEMA, kind: "policy_change", proposal_id: "C-0a1b2c3d", expires_at: "2026-10-30T14:10:00Z",
    changes: [{ key: "cap.sourcing", label: "Sourcing agent: most per payment", from: "", to: "0.03" }], reason: "r", ...over,
  } as Terms);
  const submission = (canonical: string, hash = sha256Hex(canonical), id = "cred-1") => ({
    canonical, terms_sha256: hash,
    credential: { id, rawId: id, type: "public-key", response: { clientDataJSON: Buffer.from(JSON.stringify({ type: "webauthn.get", challenge: Buffer.from(hash, "hex").toString("base64url"), origin: BASE })).toString("base64url"), authenticatorData: "AA", signature: "AA" }, clientExtensionResults: {} },
  });

  it("queues a signed policy change for the runner, and refuses what cannot be one", async () => {
    const { r } = relay();
    const { state } = runnerState({ enrolled: true });
    await push(r, state);
    const ok = await post(r, "/api/policy", submission(policyTerms()));
    expect(ok.status).toBe(202);
    const ip = (n: number) => ({ "cf-connecting-ip": `10.7.0.${n}` });
    expect((await post(r, "/api/policy", submission(policyTerms(), "0".repeat(64)), ip(1))).status).toBe(400);
    expect((await post(r, "/api/policy", submission(policyTerms({ proposal_id: "P-0009" })), ip(2))).status).toBe(400);
    expect((await post(r, "/api/policy", submission(policyTerms({ kind: "invoice_payment" })), ip(3))).status).toBe(400);
    expect((await post(r, "/api/policy", submission(policyTerms(), undefined, "stranger"), ip(4))).status).toBe(403);
    const inbox = ((await json(await push(r, state))) as { inbox: { kind: string; proposal_id: string }[] }).inbox;
    expect(inbox).toEqual([expect.objectContaining({ kind: "policy", proposal_id: "C-0a1b2c3d" })]);
  });
});

describe("enrolment from the phone", () => {
  it("gives the creation options only for the right code, and closes after five wrong ones", async () => {
    const { r } = relay();
    const { state, code } = runnerState({ enrolled: false });
    await push(r, state);
    const wrong = await post(r, "/api/enrol/options", { code: "AAAA-AAAA" });
    expect(wrong.status).toBe(403);
    expect(await json(wrong)).toMatchObject({ attempts_left: 4 });
    const ok = await post(r, "/api/enrol/options", { code: code.toLowerCase() });
    expect(ok.status).toBe(200);
    expect(await json(ok)).toMatchObject({
      challenge: state.enrolment!.challenge, rp: { id: RP }, user: { id: state.enrolment!.user_id, name: "max" },
      authenticatorSelection: { userVerification: "required" }, attestation: "none",
      pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }], excludeCredentials: [],
    });
    const reg = await post(r, "/api/enrol", { code, credential: { id: "new", rawId: "new", type: "public-key", response: { clientDataJSON: "e30", attestationObject: "AA" }, clientExtensionResults: {} } });
    expect(reg.status).toBe(202);
    const inbox = ((await json(await push(r, state))) as { inbox: { kind: string }[] }).inbox;
    expect(inbox.map((i) => i.kind)).toEqual(["registration"]);
    for (let i = 0; i < 4; i++) await post(r, "/api/enrol/options", { code: "AAAA-AAAA" }, { "cf-connecting-ip": `10.2.0.${i}` });
    const locked = await post(r, "/api/enrol/options", { code }, { "cf-connecting-ip": "10.2.0.9" });
    expect(locked.status).toBe(403);
    expect(await json(locked)).toMatchObject({ error: expect.stringMatching(/too many/) });
  });

  it("keeps the five-try limit when wrong codes arrive at the same moment", async () => {
    const { r } = relay();
    const { state, code } = runnerState({ enrolled: false });
    await push(r, state);
    const answers = await Promise.all(Array.from({ length: 30 }, (_, i) => post(r, "/api/enrol/options", { code: "AAAA-AAAA" }, { "cf-connecting-ip": `10.3.${i}.1` })));
    const wrong = await Promise.all(answers.map(async (a) => (await a.json()) as { error: string }));
    expect(wrong.filter((w) => w.error === "wrong code").length).toBeLessThanOrEqual(5);
    expect((await post(r, "/api/enrol/options", { code }, { "cf-connecting-ip": "10.4.0.1" })).status).toBe(403);
  });

  it("says so when no enrolment is open", async () => {
    const { r } = relay();
    await push(r, runnerState({ enrolled: true }).state);
    expect((await post(r, "/api/enrol/options", { code: "AAAA-AAAA" })).status).toBe(409);
  });
});

describe("pages", () => {
  const pages: Pages = {
    dashboard: "<!doctype html><title>d</title>", month: "<!doctype html><title>m</title>", approve: "<!doctype html><title>a</title>", enrol: "<!doctype html><title>e</title>", policy: "<!doctype html><title>p</title>", client: "export {};", css: "body{}",
    csp: { dashboard: "default-src 'none'; script-src 'sha256-x'", month: "default-src 'none'; script-src 'sha256-m'", approve: "default-src 'none'; script-src 'self'", enrol: "default-src 'none'; script-src 'self'", policy: "default-src 'none'; script-src 'self'" },
  };
  const page = (path: string) => pageResponse(new Request(`${BASE}${path}`), pages);

  it("serves each page with its own CSP and the security headers", async () => {
    const d = page("/")!;
    expect(d.headers.get("content-security-policy")).toBe(pages.csp.dashboard);
    expect(await d.text()).toBe(pages.dashboard);
    expect(page("/approve/P-0001")!.headers.get("content-security-policy")).toBe(pages.csp.approve);
    expect(page("/enrol")!.headers.get("content-security-policy")).toBe(pages.csp.enrol);
    expect(await page("/policy")!.text()).toBe(pages.policy);
    expect(page("/month")!.headers.get("content-security-policy")).toBe(pages.csp.month);
    const js = page("/assets/approve.js")!;
    expect(js.headers.get("content-type")).toMatch(/^text\/javascript/);
    expect(page("/assets/approve.css")!.headers.get("content-type")).toMatch(/^text\/css/);
    for (const res of [d, js]) {
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      expect(res.headers.get("referrer-policy")).toBe("no-referrer");
      expect(res.headers.get("x-robots-tag")).toMatch(/noindex/);
      expect(res.headers.get("cache-control")).toBe("no-store");
    }
    expect(page("/approve/<script>")).toBeNull();
    expect(page("/nothing")).toBeNull();
    expect(pageResponse(new Request(`${BASE}/`, { method: "POST" }), pages)).toBeNull();
  });
});
