// Purser Cloud against the security review of 8 November (PR #110): each test is one attack that worked before the fix.
// A sync key making itself owner through a pushed passkey; one sign-in assertion giving several sessions; a closed
// company's session; keys created by keys outliving an erasure; an admin-only key exporting everything; unthrottled
// failed sign-ins; a changed audit row keeping its old hash; a ledger entry unbalanced through float rounding; 500s for
// bad input; orphan document bytes after a refused push; a malformed date that blocks the purge; unlimited inbound mail.
import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { auditRowHash, ledgerEntryHash, GENESIS } from "../cloud/src/chains.js";
import { receiveEmail, type InboundEmail } from "../cloud/src/mail.js";
import { softPasskey } from "../src/metal/softPasskey.js";
import { ORIGIN, RP, testCloud, type TestCloud, type TestTenant } from "./support/cloud.js";

const b64u = (u: Uint8Array) => Buffer.from(u).toString("base64url");
const NOW = "2026-11-08T12:00:00.000Z";

let c: TestCloud;
let t: TestTenant;
beforeEach(async () => { c = testCloud({ rate: { perMinute: 100_000, signInPerMinute: 100_000, failedAuthPerMinute: 100_000 } }); t = await c.tenant("acme"); });
afterEach(() => c.close());

/** A software passkey for a person: x, y and a fresh credential id. */
function passkey() {
  const pk = softPasskey();
  return {
    pk, credential_id: b64u(crypto.getRandomValues(new Uint8Array(16))),
    x: Buffer.from(pk.key.qx.slice(2), "hex").toString("base64url"), y: Buffer.from(pk.key.qy.slice(2), "hex").toString("base64url"),
    assertion(challenge: string, origin = ORIGIN) {
      const a = pk.assert("0x00", { challenge, origin, rpId: RP });
      return { authenticatorData: b64u(a.authenticatorData), clientDataJSON: b64u(a.clientDataJSON), signature: b64u(a.signature) };
    },
  };
}

/** The first owner's passkey, as the test company's first run enrolled it. */
function ownerKey(): ReturnType<typeof passkey> {
  const { pk, credential_id } = t.ownerPasskey;
  return { pk, credential_id, x: "", y: "", assertion(challenge: string, origin = ORIGIN) {
    const a = pk.assert("0x00", { challenge, origin, rpId: RP });
    return { authenticatorData: b64u(a.authenticatorData), clientDataJSON: b64u(a.clientDataJSON), signature: b64u(a.signature) };
  } };
}

/** The owner-issued enrolment, then the person's own passkey enrolled with it. */
async function enrol(userId: string, issuer = t.key) {
  const e = await c.req("POST", `/v1/users/${userId}/enrolment`, { key: issuer });
  if (e.status !== 201) return { status: e.status, json: e.json, key: null };
  const key = passkey();
  const token = e.json.token as string;
  const r = await c.req("POST", "/v1/auth/enrol", { body: { tenant: "acme", enrolment_id: e.json.enrolment_id, token, credential_id: key.credential_id, x: key.x, y: key.y, assertion: key.assertion(token) } });
  return { status: r.status, json: r.json, key, token, enrolmentId: e.json.enrolment_id as string };
}

async function login(key: ReturnType<typeof passkey>) {
  const ch = (await c.req("POST", "/v1/auth/challenge", { body: { tenant: "acme" } })).json as { challenge_id: string; challenge: string };
  const body = { tenant: "acme", challenge_id: ch.challenge_id, credential_id: key.credential_id, assertion: key.assertion(ch.challenge) };
  return { body, res: await c.req("POST", "/v1/auth/login", { body }) };
}

async function user(role: "owner" | "cfo" | "accountant" | "viewer", by = t.key): Promise<string> {
  return (await c.req("POST", "/v1/users", { key: by, body: { display_name: `A ${role}`, role } })).json.id as string;
}

async function key(scopes: string[], by = t.key, extra: Record<string, unknown> = {}): Promise<string> {
  const r = await c.req("POST", "/v1/keys", { key: by, body: { name: scopes.join("+"), scopes, ...extra } });
  if (r.status !== 201) throw new Error(JSON.stringify(r.json));
  return r.json.api_key as string;
}

describe("passkeys: a sync key cannot become owner", () => {
  it("refuses any credential in a sync push, and no credential is stored", async () => {
    const sync = await key(["sync"]);
    const k = passkey();
    const r = await c.req("POST", "/v1/sync", { key: sync, body: { credentials: [{ credential_id: k.credential_id, user_id: t.owner, x: k.x, y: k.y, counter: 0 }] } });
    expect(r.status).toBe(400);
    expect(await c.env.sql.first("SELECT 1 FROM credentials WHERE credential_id = ?", [k.credential_id])).toBeNull();
    expect((await login(k)).res.status).toBe(401);
  });

  it("enrols a person only with an owner-issued, single-use, short-lived enrolment that a sync key cannot ask for", async () => {
    const cfo = await user("cfo");
    const sync = await key(["sync"]);
    expect((await c.req("POST", `/v1/users/${cfo}/enrolment`, { key: sync })).status).toBe(403);
    const ok = await enrol(cfo);
    expect(ok.status).toBe(201);
    const s = await login(ok.key!);
    expect(s.res.status).toBe(200);
    expect(s.res.json.role).toBe("cfo");
    // The same enrolment again, with another passkey: used.
    const again = passkey();
    const reuse = await c.req("POST", "/v1/auth/enrol", { body: { tenant: "acme", enrolment_id: ok.enrolmentId, token: ok.token, credential_id: again.credential_id, x: again.x, y: again.y, assertion: again.assertion(ok.token!) } });
    expect(reuse.status).toBe(401);
    // An enrolment past its time.
    const late = await c.req("POST", `/v1/users/${cfo}/enrolment`, { key: t.key });
    c.clock.now = new Date(c.clock.now.getTime() + 31 * 60_000);
    const k3 = passkey();
    const token = late.json.token as string;
    expect((await c.req("POST", "/v1/auth/enrol", { body: { tenant: "acme", enrolment_id: late.json.enrolment_id, token, credential_id: k3.credential_id, x: k3.x, y: k3.y, assertion: k3.assertion(token) } })).status).toBe(401);
  });

  it("needs the enrolment's secret and a signature by the new passkey over it", async () => {
    const cfo = await user("cfo");
    const e = await c.req("POST", `/v1/users/${cfo}/enrolment`, { key: t.key });
    const k = passkey();
    const token = e.json.token as string;
    const wrongToken = await c.req("POST", "/v1/auth/enrol", { body: { tenant: "acme", enrolment_id: e.json.enrolment_id, token: "x".repeat(43), credential_id: k.credential_id, x: k.x, y: k.y, assertion: k.assertion("x".repeat(43)) } });
    expect(wrongToken.status).toBe(401);
    const e2 = await c.req("POST", `/v1/users/${cfo}/enrolment`, { key: t.key });
    const other = passkey();
    // Signed by another key than the one being enrolled: refused.
    const t2 = e2.json.token as string;
    const forged = await c.req("POST", "/v1/auth/enrol", { body: { tenant: "acme", enrolment_id: e2.json.enrolment_id, token: t2, credential_id: k.credential_id, x: k.x, y: k.y, assertion: other.assertion(t2) } });
    expect(forged.status).toBe(401);
    expect(token).not.toBe(t2);
  });

  it("an owner's passkey: once an owner has one (the first run), only a signed-in owner may start another, not an admin key", async () => {
    const first = { key: ownerKey() };
    const second = await user("owner");
    expect((await c.req("POST", `/v1/users/${second}/enrolment`, { key: t.key })).status).toBe(403);
    const ownerSession = (await login(first.key!)).res.json.session as string;
    expect((await enrol(second, ownerSession)).status).toBe(201);
  });
});

describe("sessions", () => {
  it("one sign-in assertion sent three times at once gives one session", async () => {
    const cfo = await user("cfo");
    const k = (await enrol(cfo)).key!;
    const ch = (await c.req("POST", "/v1/auth/challenge", { body: { tenant: "acme" } })).json as { challenge_id: string; challenge: string };
    const body = { tenant: "acme", challenge_id: ch.challenge_id, credential_id: k.credential_id, assertion: k.assertion(ch.challenge) };
    const all = await Promise.all([1, 2, 3].map(() => c.req("POST", "/v1/auth/login", { body })));
    expect(all.filter((r) => r.status === 200)).toHaveLength(1);
  });

  it("a closed company's sessions end at once; a person's sign-out ends their session", async () => {
    const own = ownerKey();
    const s = (await login(own)).res.json.session as string;
    expect((await c.req("GET", "/v1/me", { key: s })).status).toBe(200);
    expect((await c.req("POST", "/v1/auth/logout", { key: s })).status).toBe(200);
    expect((await c.req("GET", "/v1/me", { key: s })).status).toBe(401);
    const s2 = (await login(own)).res.json.session as string;
    expect((await c.req("POST", "/v1/close", { key: s2 })).status).toBe(200);
    expect((await c.req("GET", "/v1/export", { key: s2 })).status).toBe(401);
    expect((await c.req("POST", "/v1/keys", { key: s2, body: { name: "late", scopes: ["read"] } })).status).toBe(401);
  });
});

describe("API keys", () => {
  it("erasing a person revokes every key behind them, also keys made by their keys", async () => {
    const owner2 = await user("owner");
    const own1 = ownerKey();
    const ownerSession = (await login(own1)).res.json.session as string;
    const k2 = (await enrol(owner2, ownerSession)).key!;
    const s2 = (await login(k2)).res.json.session as string;
    const k1 = await key(["read", "admin"], s2);
    const kk = await key(["read", "admin"], k1);
    expect((await c.req("GET", "/v1/users", { key: kk })).status).toBe(200);
    expect((await c.req("POST", `/v1/users/${owner2}/erase`, { key: t.key })).status).toBe(200);
    expect((await c.req("GET", "/v1/users", { key: k1 })).status).toBe(401);
    expect((await c.req("GET", "/v1/users", { key: kk })).status).toBe(401);
  });

  it("every key expires: 90 days by default, or what it was made with", async () => {
    expect((await c.req("POST", "/v1/keys", { key: t.key, body: { name: "x", scopes: ["read"], expires_in_days: 9999 } })).status).toBe(400);
    const plain = await key(["read"]);
    const short = await key(["read"], t.key, { expires_in_days: 7 });
    c.clock.now = new Date(c.clock.now.getTime() + 8 * 86_400_000);
    expect((await c.req("GET", "/v1/invoices", { key: short })).status).toBe(401);
    expect((await c.req("GET", "/v1/invoices", { key: plain })).status).toBe(200);
    c.clock.now = new Date(c.clock.now.getTime() + 83 * 86_400_000);
    expect((await c.req("GET", "/v1/invoices", { key: plain })).status).toBe(401);
    // The company's first key too: an owner makes a new one before then.
    expect((await c.req("GET", "/v1/invoices", { key: t.key })).status).toBe(401);
  });

  it("an admin-only key cannot export the company's data", async () => {
    const admin = await key(["admin"]);
    expect((await c.req("GET", "/v1/export", { key: admin })).status).toBe(403);
    expect((await c.req("GET", "/v1/export", { key: t.key })).status).toBe(200);
  });
});

describe("failed sign-ins and keys are throttled per address", () => {
  it("answers 429 after the limit of failures, before looking the key up", async () => {
    c.close();
    c = testCloud({ rate: { perMinute: 100_000, signInPerMinute: 100_000, failedAuthPerMinute: 5 } });
    t = await c.tenant("acme");
    const bad = `pck_k${"A".repeat(12)}_${"B".repeat(43)}`;
    const from = (ip: string) => ({ "cf-connecting-ip": ip });
    const codes: number[] = [];
    for (let i = 0; i < 7; i++) codes.push((await c.req("GET", "/v1/invoices", { key: bad, headers: from("203.0.113.9") })).status);
    expect(codes.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(codes.slice(5)).toEqual([429, 429]);
    // Another address is not held back.
    expect((await c.req("GET", "/v1/invoices", { key: t.key, headers: from("198.51.100.4") })).status).toBe(200);
    c.clock.now = new Date(c.clock.now.getTime() + 61_000);
    expect((await c.req("GET", "/v1/invoices", { key: t.key, headers: from("203.0.113.9") })).status).toBe(200);
  });
});

const line = (n: number, account: string, d: number, cr: number) => ({ line_no: n, account, debit_cents: d, credit_cents: cr, currency: "EUR", cost_centre: null, vat_code: null, vat_cents: null, party: null, due_date: null, doc_ref: null, memo: null });
async function entry(id: number, prev: string, lines: ReturnType<typeof line>[], date = "2026-11-01") {
  const e = { entry_id: id, posting_date: date, doc_date: date, description: "x", source_key: null, doc_ref: null, doc_sha256: null, created_by: "t", reverses: null, created_at: NOW, prev_hash: prev, entry_hash: "", lines };
  e.entry_hash = await ledgerEntryHash(e);
  return e;
}
async function row(seq: number, prev: string, payload: Record<string, unknown>) {
  const r = { seq, ts: NOW, actor: "human", event: "test.note", subject: "x", payload_json: JSON.stringify(payload), prev_hash: prev, row_hash: "" };
  r.row_hash = await auditRowHash(r);
  return r;
}

describe("the push", () => {
  it("refuses a held audit row that comes back changed under its old hash", async () => {
    const r1 = await row(1, GENESIS, { note: "original" });
    expect((await c.req("POST", "/v1/sync", { key: t.key, body: { audit_rows: [r1] } })).status).toBe(200);
    const changed = { ...r1, payload_json: JSON.stringify({ note: "rewritten" }) };
    const r = await c.req("POST", "/v1/sync", { key: t.key, body: { audit_rows: [changed] } });
    expect(r.status).toBe(409);
  });

  it("refuses an entry unbalanced by a cent through float rounding, and absurd amounts", async () => {
    const huge = await entry(1, GENESIS, [line(1, "1200", 9007199254740991, 0), line(2, "1200", 2, 0), line(3, "4000", 0, 9007199254740991), line(4, "4000", 0, 1)]);
    const r = await c.req("POST", "/v1/sync", { key: t.key, body: { ledger_entries: [huge] } });
    expect(r.status).toBe(400);
    expect(await c.env.sql.first("SELECT 1 FROM ledger_entries")).toBeNull();
  });

  it("answers bad input with 4xx, never 500", async () => {
    expect((await c.req("GET", "/v1/invoices/%E0%A4%A", { key: t.key })).status).toBe(400);
    const badPayload = { seq: 1, ts: NOW, actor: "human", event: "x", subject: null, payload_json: "{not json", prev_hash: GENESIS, row_hash: "a".repeat(64) };
    expect((await c.req("POST", "/v1/sync", { key: t.key, body: { audit_rows: [badPayload] } })).status).toBe(400);
    const sameLine = await entry(1, GENESIS, [line(1, "1200", 100, 0), line(1, "4000", 0, 100)]);
    expect((await c.req("POST", "/v1/sync", { key: t.key, body: { ledger_entries: [sameLine] } })).status).toBe(422);
    const v = { id: "v1", name: "A", status: "active", updated_at: NOW, body: { a: 1 } };
    const dup = await c.req("POST", "/v1/sync", { key: t.key, body: { vendors: [v, { ...v, body: { a: 2 } }] } });
    expect(dup.status).toBe(422);
    expect(dup.json.error).toMatch(/twice/);
  });

  it("a refused push leaves no document bytes behind", async () => {
    const bytes = Buffer.from("%PDF-1.4 an invoice");
    const sha = (await import("node:crypto")).createHash("sha256").update(bytes).digest("hex");
    const unbalanced = await entry(1, GENESIS, [line(1, "1200", 100, 0), line(2, "4000", 0, 99)]);
    const r = await c.req("POST", "/v1/sync", { key: t.key, body: { documents: [{ sha256: sha, filename: "a.pdf", mime: "application/pdf", base64: bytes.toString("base64") }], ledger_entries: [unbalanced] } });
    expect(r.status).toBe(422);
    const blobs = join(c.dir, "blobs");
    const files = existsSync(blobs) ? readdirSync(blobs, { recursive: true }).map(String).filter((f) => f.endsWith(sha)) : [];
    expect(files).toEqual([]);
    expect(await c.env.blobs.list(`t/${t.id}/`)).toEqual([]);
  });

  it("refuses a date that is not a date, so a closed company's purge day is always a real day", async () => {
    const bytes = Buffer.from("%PDF-1.4 x");
    const sha = (await import("node:crypto")).createHash("sha256").update(bytes).digest("hex");
    const inv = { id: "AP-1", vendor: "V", invoice_no: "1", due_date: "2026-11-30", currency: "EUR", total: "1.00", status: "ready", doc_sha256: sha, received_at: "x", updated_at: NOW, body: {} };
    const doc = { sha256: sha, filename: "a.pdf", mime: "application/pdf", base64: bytes.toString("base64") };
    expect((await c.req("POST", "/v1/sync", { key: t.key, body: { documents: [doc], invoices: [inv] } })).status).toBe(400);
    expect((await c.req("POST", "/v1/sync", { key: t.key, body: { documents: [doc], invoices: [{ ...inv, received_at: "2027-02-31T10:00:00Z" }] } })).status).toBe(400);
    expect((await c.req("POST", "/v1/sync", { key: t.key, body: { documents: [doc], invoices: [{ ...inv, received_at: "2026-11-02T10:00:00.000Z" }] } })).status).toBe(200);
    // A stray row with a bad date (written before this check) still leaves a real purge day.
    await c.env.sql.run("UPDATE invoices SET received_at = 'x' WHERE tenant_id = ?", [t.id]);
    const closed = await c.req("POST", "/v1/close", { key: t.key });
    expect(closed.json.purge_after).toMatch(/^\d{4}-12-31$/);
  });
});

describe("inbound mail", () => {
  it("takes at most the company's daily quota of messages and bytes", async () => {
    const msg = (n: number, size = 100): InboundEmail & { rejected: string | null } => {
      const raw = new Uint8Array(Buffer.from(`Subject: ${n}\r\n\r\n${"x".repeat(size)}`));
      const m = { from: "a@b.example", to: "acme@in.test", raw, rawSize: raw.length, rejected: null as string | null, setReject(r: string) { m.rejected = r; } };
      return m;
    };
    const opts = { domain: "in.test", now: c.clock.now, quota: { messagesPerDay: 3, bytesPerDay: 10_000 } };
    for (let i = 0; i < 3; i++) expect((await receiveEmail(c.env.sql, c.env.blobs, msg(i), opts)).queued).toBe(true);
    const fourth = msg(4);
    expect((await receiveEmail(c.env.sql, c.env.blobs, fourth, opts)).queued).toBe(false);
    expect(fourth.rejected).toMatch(/quota/);
    // The next day the quota is fresh; one message bigger than the bytes left is refused.
    const next = { ...opts, now: new Date(c.clock.now.getTime() + 86_400_000) };
    const big = msg(5, 20_000);
    expect((await receiveEmail(c.env.sql, c.env.blobs, big, next)).queued).toBe(false);
    expect(big.rejected).toMatch(/quota/);
    expect((await receiveEmail(c.env.sql, c.env.blobs, msg(6), next)).queued).toBe(true);
  });
});
