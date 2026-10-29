// End to end in one process: the runner syncs with the relay Worker's logic, and a software authenticator plays the
// phone (it posts exactly what the page posts). Enrol, approve, execute once; a second option refused; a late
// signature recorded as too late; a signature that waits while the runner is offline.
import { viewKey } from "../src/relay/config.js";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { buildPolicyTerms, bytesToB64url, canonicalize, checkOption, hexToBytes, sha256Hex, type PhoneProposal } from "../src/approve/client.js";
import { openDb, type DB } from "../src/db/open.js";
import { TERMS_SCHEMA, type Terms } from "../src/lib/terms.js";
import { openEnrolment } from "../src/passkey/ledger.js";
import { createProposal } from "../src/policy/approvals.js";
import { RelayRunner } from "../src/relay/runner.js";
import { Relay } from "../worker/src/core.js";
import { FakeAuthenticator } from "./fakes/authenticator.js";

const RP = "kit11.example.workers.dev";
const BASE = `https://${RP}`;
const TOKEN = "e2e-token";
const VIEW = { "x-kit11-view": viewKey(TOKEN) };
const t0 = new Date("2026-10-30T14:00:00Z");

const steps = [{ order: "1", agent: "treasury", cap: "4.00", budget: "4.00", payees: ["0x00000000000000000000000000000000000000e1"], replaces_credential_hash: "0xaa", credential_hash: "0x01", spent_at_proposal: "0.00" }];
const option = (id: string, opt: string, price: string, margin: string): Terms => ({
  schema: TERMS_SCHEMA, kind: "mandate_replace", proposal_id: id, expires_at: "2026-10-30T15:00:00Z",
  option: opt, query_price: price, upstream_price: "0.04", margin, total_budget: "20.00", steps,
});
const refund: Terms = {
  schema: TERMS_SCHEMA, kind: "refund_batch", proposal_id: "P-0003", expires_at: "2026-10-30T14:05:00Z",
  customer: "0x00000000000000000000000000000000000000c1", refunds: [{ sale_id: "7", payment_id: "refund-7", to: "0x00000000000000000000000000000000000000c1", amount: "0.05" }], total: "0.05", reason: "wrong data",
};

function world() {
  let clock = t0;
  const now = () => clock;
  const db: DB = openDb(":memory:");
  createProposal(db, { terms: option("P-0001", "A", "0.05", "0.01"), createdBy: "treasury" }, t0);
  createProposal(db, { terms: option("P-0002", "B", "0.07", "0.03"), createdBy: "treasury" }, t0);
  createProposal(db, { terms: refund, createdBy: "support" }, t0);
  const rdb = new Database(":memory:");
  const relay = new Relay({ exec: (q, ...b) => { const st = rdb.prepare(q); const rows = st.reader ? st.all(...b) : (st.run(...b), []); return { toArray: () => rows }; } }, { relayToken: TOKEN, now });
  const executed: string[] = [];
  const runner = new RelayRunner({
    db, cfg: { url: BASE, origin: BASE, rpId: RP, token: TOKEN }, now, log: () => {},
    fetch: ((url: string | URL | Request, init?: RequestInit) => relay.fetch(new Request(url, init))) as typeof fetch,
    execute: async (_db, id) => { executed.push(id); },
  });
  const phone = {
    get: async (path: string) => (await relay.fetch(new Request(`${BASE}${path}`, { headers: VIEW }))).json() as Promise<Record<string, unknown>>,
    post: async (path: string, body: unknown) => {
      const res = await relay.fetch(new Request(`${BASE}${path}`, { method: "POST", headers: { origin: BASE, "content-type": "application/json", ...VIEW }, body: JSON.stringify(body) }));
      return { status: res.status, body: (await res.json()) as Record<string, unknown> };
    },
  };
  return { db, relay, runner, phone, executed, at: (iso: string) => { clock = new Date(iso); } };
}

async function enrol(w: ReturnType<typeof world>, auth: FakeAuthenticator) {
  const { code } = openEnrolment(w.db, { rpId: RP, origin: BASE }, t0);
  await w.runner.syncOnce();
  const opts = await w.phone.post("/api/enrol/options", { code });
  expect(opts.status).toBe(200);
  const credential = auth.register({ challenge: String(opts.body.challenge), origin: BASE, rpId: RP });
  const sent = await w.phone.post("/api/enrol", { code, credential });
  expect(sent.status).toBe(202);
  await w.runner.syncOnce();
  await w.runner.syncOnce();
  expect(await w.phone.get(`/api/tickets/${String(sent.body.ticket)}`)).toMatchObject({ status: "enrolled" });
}

/** What the page does on "Confirm with Face ID": check the hash itself, sign it, post it. */
async function approveOnPhone(w: ReturnType<typeof world>, auth: FakeAuthenticator, id: string, counter: number) {
  const a = (await w.phone.get("/api/approvals")) as { proposals: PhoneProposal[] };
  const p = a.proposals.find((x) => x.proposal_id === id)!;
  expect((await checkOption(p)).ok).toBe(true);
  const credential = auth.sign({ challenge: bytesToB64url(hexToBytes(p.terms_sha256)), origin: BASE, rpId: RP, counter });
  return w.phone.post("/api/assertions", { proposal_id: id, terms_sha256: p.terms_sha256, credential });
}

describe("phone approval through the relay", () => {
  it("enrols, approves the tapped option, executes it once, and refuses the other option", async () => {
    const w = world();
    const auth = new FakeAuthenticator();
    await enrol(w, auth);
    expect(await w.phone.get("/api/approvals")).toMatchObject({ passkey: { credentials: [{ id: auth.credentialId, label: "max" }] } });

    const sent = await approveOnPhone(w, auth, "P-0002", 1);
    expect(sent.status).toBe(202);
    const ticket = String(sent.body.ticket);
    expect(await w.phone.get(`/api/tickets/${ticket}`)).toMatchObject({ status: "queued" });
    await w.runner.syncOnce();
    await w.runner.idle();
    await w.runner.syncOnce();
    expect(await w.phone.get(`/api/tickets/${ticket}`)).toMatchObject({ status: "executed", message: "P-0002 executed" });
    expect(w.executed).toEqual(["P-0002"]);
    expect(w.db.prepare("SELECT method, approver FROM approvals").all()).toEqual([{ method: "passkey", approver: `max (passkey ${auth.credentialId.slice(0, 8)})` }]);

    // The approved option leaves the phone's list; its sibling is still listed until the executor supersedes it,
    // but the runner refuses it.
    const other = await approveOnPhone(w, auth, "P-0001", 2);
    expect(other.status).toBe(202);
    await w.runner.syncOnce();
    await w.runner.syncOnce();
    expect(await w.phone.get(`/api/tickets/${String(other.body.ticket)}`)).toMatchObject({ status: "refused", message: "another option, P-0002, was already approved" });
    expect(w.executed).toEqual(["P-0002"]);
  });

  it("records a signature the runner only sees after expiry as too late, and runs nothing", async () => {
    const w = world();
    const auth = new FakeAuthenticator();
    await enrol(w, auth);
    w.at("2026-10-30T14:04:50Z");
    const sent = await approveOnPhone(w, auth, "P-0003", 1);
    expect(sent.status).toBe(202);
    w.at("2026-10-30T14:05:01Z");
    await w.runner.syncOnce();
    await w.runner.syncOnce();
    expect(await w.phone.get(`/api/tickets/${String(sent.body.ticket)}`)).toMatchObject({ status: "too_late" });
    expect(w.executed).toEqual([]);
    expect(w.db.prepare("SELECT status FROM proposals WHERE proposal_id = 'P-0003'").get()).toEqual({ status: "EXPIRED" });
  });

  it("keeps a signature waiting while the runner is offline, and the dashboard calls the relay stale", async () => {
    const w = world();
    const auth = new FakeAuthenticator();
    await enrol(w, auth);
    const sent = await approveOnPhone(w, auth, "P-0002", 1);
    w.at("2026-10-30T14:00:40Z");
    expect(await w.phone.get(`/api/tickets/${String(sent.body.ticket)}`)).toMatchObject({ status: "queued" });
    expect(await w.phone.get("/api/snapshot")).toMatchObject({ relay: { age_ms: 40_000 } });
    await w.runner.syncOnce();
    await w.runner.idle();
    await w.runner.syncOnce();
    expect(await w.phone.get(`/api/tickets/${String(sent.body.ticket)}`)).toMatchObject({ status: "executed" });
  });

  it("answers a submission it could not process instead of leaving the phone waiting", async () => {
    const w = world();
    const auth = new FakeAuthenticator();
    await enrol(w, auth);
    const sent = await approveOnPhone(w, auth, "P-0002", 1);
    w.db.exec("DROP TABLE passkey_assertions");
    await w.runner.syncOnce();
    await w.runner.syncOnce();
    expect(await w.phone.get(`/api/tickets/${String(sent.body.ticket)}`)).toMatchObject({ status: "refused", message: expect.stringMatching(/could not process/) });
    expect(w.executed).toEqual([]);
  });

  it("changes the CFO policy from the phone with one Face ID, and runs the change once", async () => {
    const w = world();
    const auth = new FakeAuthenticator();
    await enrol(w, auth);
    const a = (await w.phone.get("/api/approvals")) as { policy: { key: string; label: string; value: string }[] };
    const cap = a.policy.find((e) => e.key === "cap.sourcing")!;
    const terms = buildPolicyTerms([{ key: cap.key, label: cap.label, from: cap.value, to: "0.03" }], "supplier prices rising", new Date("2026-10-30T14:00:00Z"), "0a1b2c3d");
    const canonical = canonicalize(terms);
    const hash = await sha256Hex(canonical);
    const sent = await w.phone.post("/api/policy", { canonical, terms_sha256: hash, credential: auth.sign({ challenge: bytesToB64url(hexToBytes(hash)), origin: BASE, rpId: RP, counter: 1 }) });
    expect(sent.status).toBe(202);
    await w.runner.syncOnce();
    await w.runner.idle();
    await w.runner.syncOnce();
    expect(await w.phone.get(`/api/tickets/${String(sent.body.ticket)}`)).toMatchObject({ status: "executed", message: "C-0a1b2c3d executed" });
    expect(w.executed).toEqual(["C-0a1b2c3d"]);
    expect(w.db.prepare("SELECT kind, status FROM proposals WHERE proposal_id = 'C-0a1b2c3d'").get()).toEqual({ kind: "policy_change", status: "APPROVED" });
  });

  it("pushes the state only when the ledger changed, and again in full if the relay lost it", async () => {
    const w = world();
    expect(await w.runner.syncOnce()).toMatchObject({ pushed: true });
    expect(await w.runner.syncOnce()).toMatchObject({ pushed: false });
    w.relay["sql"].exec("DELETE FROM kv");
    expect(await w.runner.syncOnce()).toMatchObject({ pushed: false });
    expect(await w.runner.syncOnce()).toMatchObject({ pushed: true });
    expect(await w.phone.get("/api/approvals")).toMatchObject({ proposals: [{ proposal_id: "P-0001" }, { proposal_id: "P-0002" }, { proposal_id: "P-0003" }] });
  });
});
