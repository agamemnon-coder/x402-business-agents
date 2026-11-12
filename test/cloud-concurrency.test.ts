// Purser Cloud under concurrent writes for one company: two Worker isolates can run a push, a mail delivery, a key
// revoke or an erasure at the same moment, and D1 has no transaction across requests. Each test holds every write
// batch at a barrier until all racers have read their state, then lets them commit one after another: the worst case.
// The loser must get a clear 409 (or a harmless "already received"), nothing is written twice, the chains never fork,
// and a retry succeeds.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { receiveEmail, type InboundEmail } from "../cloud/src/mail.js";
import type { Sql } from "../cloud/src/store.js";
import { seedTreasury } from "../src/agents/euroBill.js";
import { ingestDocument } from "../src/ap/inbox.js";
import type { Asker } from "../src/ap/read.js";
import { apInvoices } from "../src/ap/store.js";
import { audit } from "../src/audit/log.js";
import { batchesFor, pullMail } from "../src/cloudsync/client.js";
import { openDb, type DB } from "../src/db/open.js";
import { EN, NL } from "./fakes/apInvoices.js";
import { FakeAirwallex } from "./fakes/airwallex.js";
import { emlWith, pdfOf } from "./fakes/pdf.js";
import { testCloud, type TestCloud } from "./support/cloud.js";

const parserOnly: Asker = { ask: async (_a, fallback) => ({ value: fallback(), source: "fallback", model: null, note: "no key" }) } as Asker;
const NOW = new Date("2026-11-08T12:00:00Z");
const DOMAIN = "in.purser.test";

/**
 * Wraps the cloud's Sql: once armed, every write batch waits until `n` batches are waiting, then they commit one by
 * one: those `first` picks before the others, otherwise in arrival order.
 */
type Stmts = Parameters<Sql["batch"]>[0];
function barrier(sql: Sql) {
  let want = 0;
  let first: (b: Stmts) => boolean = () => false;
  const waiting: { stmts: Stmts; done: (e?: unknown) => void }[] = [];
  const wrapped: Sql = {
    all: (s, p) => sql.all(s, p), first: (s, p) => sql.first(s, p), run: (s, p) => sql.run(s, p), exec: (s) => sql.exec(s),
    batch: (stmts) => {
      if (want === 0) return sql.batch(stmts);
      return new Promise<void>((resolve, reject) => {
        waiting.push({ stmts, done: (e) => (e ? reject(e) : resolve()) });
        if (waiting.length < want) return;
        want = 0;
        const run = [...waiting.filter((w) => first(w.stmts)), ...waiting.filter((w) => !first(w.stmts))];
        waiting.length = 0;
        void (async () => { for (const w of run) { try { await sql.batch(w.stmts); w.done(); } catch (e) { w.done(e); } } })();
      });
    },
  };
  return { sql: wrapped, arm(n: number, pick: (b: Stmts) => boolean = () => false) { want = n; first = pick; } };
}

let c: TestCloud;
let gate: ReturnType<typeof barrier>;
let db: DB;
let dir: string;
let tenant: { id: string; key: string; owner: string };
const count = async (t: string) => (await c.env.sql.first<{ n: number }>(`SELECT COUNT(*) AS n FROM ${t} WHERE tenant_id = ?`, [tenant.id]))!.n;

beforeEach(async () => {
  c = testCloud();
  gate = barrier(c.env.sql);
  c.env.sql = gate.sql;
  dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "cloud-race-"));
  db = openDb(":memory:");
  tenant = await c.tenant("northwind");
  const awx = new FakeAirwallex();
  await seedTreasury(db, awx, awx);
  await ingestDocument(db, { dir, reader: parserOnly, now: () => NOW }, { bytes: await pdfOf(EN), filename: "bergtex.pdf", source: "upload" });
  audit(db, "human", "test.note", "x", { note: "one" }, NOW);
});
afterEach(() => { c.close(); rmSync(dir, { recursive: true, force: true }); });

const state = async (key = tenant.key) => (await c.req("GET", "/v1/sync/state", { key })).json as unknown as Parameters<typeof batchesFor>[1];
const push = (b: unknown, key = tenant.key) => c.req("POST", "/v1/sync", { key, body: b });
/** Every batch the runner would send, as one push (documents and rows together), so a race is about one request. */
type Batch = Record<string, unknown[]>;
const all = (bs: Record<string, unknown>[]): Batch => {
  const out: Batch = {};
  for (const b of bs) for (const [k, v] of Object.entries(b)) out[k] = [...(out[k] ?? []), ...(v as unknown[])];
  return out;
};

describe("two pushes at once", () => {
  it("the same push twice: one lands, the other gets 409, a retry changes nothing and nothing is doubled", async () => {
    const b = all(batchesFor(db, await state(), { now: NOW }));
    gate.arm(2);
    const [x, y] = await Promise.all([push(b), push(b)]);
    expect([x.status, y.status].sort()).toEqual([200, 409]);
    const loser = x.status === 409 ? x : y;
    expect(loser.json).toMatchObject({ code: "conflict", error: expect.stringMatching(/at the same time.*send it again/) });
    const again = await push(b);
    expect(again.status).toBe(200);
    for (const k of Object.values(again.json.applied as Record<string, { added: number; changed: number }>)) expect(k.added + k.changed).toBe(0);
    expect(await count("invoices")).toBe(1);
    expect(await count("documents")).toBe(1);
    expect(await count("audit_rows")).toBe((db.prepare("SELECT COUNT(*) AS n FROM audit_log").get() as { n: number }).n);
  });

  it("two different continuations of the audit chain: one lands, the chain never forks", async () => {
    const base = all(batchesFor(db, await state(), { now: NOW }));
    expect((await push(base)).status).toBe(200);
    const head = await state();
    // Two runners (or a replayed old one) each bring their own next row for the same place in the chain.
    const other = openDb(":memory:");
    for (const r of db.prepare("SELECT * FROM audit_log ORDER BY seq").all() as Record<string, unknown>[]) {
      other.prepare("INSERT INTO audit_log (seq, ts, actor, event, subject, payload_json, prev_hash, row_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .run(r.seq, r.ts, r.actor, r.event, r.subject, r.payload_json, r.prev_hash, r.row_hash);
    }
    audit(db, "human", "test.note", "a", { note: "runner A" }, NOW);
    audit(other, "human", "test.note", "b", { note: "runner B" }, NOW);
    const a = { audit_rows: all(batchesFor(db, head, { now: NOW })).audit_rows as { seq: number; row_hash: string }[] };
    const b = { audit_rows: all(batchesFor(other, head, { now: NOW })).audit_rows as { seq: number; row_hash: string }[] };
    expect(a.audit_rows).toHaveLength(1);
    expect(b.audit_rows).toHaveLength(1);
    gate.arm(2);
    const [x, y] = await Promise.all([push(a), push(b)]);
    expect([x.status, y.status].sort()).toEqual([200, 409]);
    const seq = a.audit_rows[0]!.seq;
    const rows = await c.env.sql.all<{ row_hash: string }>("SELECT row_hash FROM audit_rows WHERE tenant_id = ? AND seq = ?", [tenant.id, seq]);
    expect(rows).toHaveLength(1);
    // The winner's row is the one stored; the loser's retry is refused as a fork, never stored beside it.
    const winner = x.status === 200 ? a : b;
    const loser = x.status === 200 ? b : a;
    expect(rows[0]!.row_hash).toBe(winner.audit_rows[0]!.row_hash);
    expect((await push(loser)).status).toBe(409);
    expect(await count("audit_rows")).toBe(seq);
  });

  it("two new versions of the same invoice: one lands, the earlier version is kept once", async () => {
    const base = all(batchesFor(db, await state(), { now: NOW }));
    expect((await push(base)).status).toBe(200);
    const inv = base.invoices![0] as { id: string; body: Record<string, unknown> };
    const v = (status: string) => ({ invoices: [{ ...inv, status, body: { ...inv.body, status } }] });
    gate.arm(2);
    const [x, y] = await Promise.all([push(v("paid")), push(v("rejected"))]);
    expect([x.status, y.status].sort()).toEqual([200, 409]);
    expect(await count("object_history")).toBe(1);
    const row = await c.env.sql.first<{ version: number }>("SELECT version FROM invoices WHERE tenant_id = ? AND id = ?", [tenant.id, inv.id]);
    expect(row!.version).toBe(2);
  });
});

describe("a push racing a key revoke", () => {
  it("the revoke lands first: the push writes nothing and says why; a retry with the revoked key is refused", async () => {
    const made = await c.req("POST", "/v1/keys", { key: tenant.key, body: { name: "runner", scopes: ["sync"] } });
    const syncKey = made.json.api_key as string;
    const b = all(batchesFor(db, await state(syncKey), { now: NOW }));
    gate.arm(2, (b) => b.some((x) => x.sql.startsWith("UPDATE api_keys")));
    const pushing = push(b, syncKey);
    const revoking = c.req("DELETE", `/v1/keys/${made.json.id as string}`, { key: tenant.key });
    const [p, r] = await Promise.all([pushing, revoking]);
    expect(r.status).toBe(200);
    expect(p.status).toBe(409);
    expect(p.json.error).toMatch(/revoked or expired while this push ran/);
    expect(await count("invoices")).toBe(0);
    expect(await count("audit_rows")).toBe(0);
    expect((await push(b, syncKey)).status).toBe(401);
  });
});

describe("mail at once", () => {
  it("the same message delivered twice at once is queued once and counted once", async () => {
    const raw = new Uint8Array(emlWith(await pdfOf(EN), "BTX-2026-21.pdf"));
    const msg = (): InboundEmail => ({ from: "billing@bergtex.example", to: `northwind@${DOMAIN}`, raw, rawSize: raw.length, setReject() { /* not refused */ } });
    gate.arm(2);
    const out = await Promise.all([receiveEmail(c.env.sql, c.env.blobs, msg(), { domain: DOMAIN, now: NOW }), receiveEmail(c.env.sql, c.env.blobs, msg(), { domain: DOMAIN, now: NOW })]);
    expect(out.map((o) => o.queued).sort()).toEqual([false, true]);
    expect(out.find((o) => !o.queued)).toMatchObject({ reason: "already received" });
    expect(await count("inbound_mail")).toBe(1);
    const day = Math.floor(NOW.getTime() / 86_400_000) * 86_400;
    expect((await c.env.sql.first<{ count: number }>("SELECT count FROM rate_hits WHERE bucket = ? AND window_start = ?", [`mail:${tenant.id}`, day]))!.count).toBe(1);
  });

  it("two runs filing the same queued message at once file one invoice", async () => {
    const raw = new Uint8Array(emlWith(await pdfOf(NL), "zeeland.pdf"));
    await receiveEmail(c.env.sql, c.env.blobs, { from: "a@b.example", to: `northwind@${DOMAIN}`, raw, rawSize: raw.length, setReject() { /* not refused */ } }, { domain: DOMAIN, now: NOW });
    const t = { url: "https://cloud.test", key: tenant.key, fetch: c.fetch };
    const before = apInvoices(db).length;
    await Promise.all([pullMail(db, { dir, reader: parserOnly, now: () => NOW }, t), pullMail(db, { dir, reader: parserOnly, now: () => NOW }, t)]);
    expect(apInvoices(db).length).toBe(before + 1);
    expect((await c.req("GET", "/v1/mail", { key: tenant.key })).json.items).toEqual([]);
  });

  it("marking a message done is idempotent; flipping a filed message to refused is a conflict", async () => {
    const raw = new Uint8Array(emlWith(await pdfOf(NL), "zeeland.pdf"));
    const r = await receiveEmail(c.env.sql, c.env.blobs, { from: "a@b.example", to: `northwind@${DOMAIN}`, raw, rawSize: raw.length, setReject() { /* not refused */ } }, { domain: DOMAIN, now: NOW });
    const done = (status: string) => c.req("POST", `/v1/mail/${r.id!}/done`, { key: tenant.key, body: { status } });
    expect((await done("done")).status).toBe(200);
    expect((await done("done")).status).toBe(200);
    expect((await done("refused")).status).toBe(409);
  });
});

describe("people at once", () => {
  it("two owners erasing each other at once leave one owner, never none", async () => {
    const second = (await c.req("POST", "/v1/users", { key: tenant.key, body: { display_name: "Second Owner", role: "owner" } })).json.id as string;
    gate.arm(2);
    const [a, b] = await Promise.all([
      c.req("POST", `/v1/users/${second}/erase`, { key: tenant.key }),
      c.req("POST", `/v1/users/${tenant.owner}/erase`, { key: tenant.key }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect((a.status === 409 ? a : b).json.error).toMatch(/last owner/);
    const owners = await c.env.sql.first<{ n: number }>("SELECT COUNT(*) AS n FROM users WHERE tenant_id = ? AND role = 'owner' AND erased_at IS NULL", [tenant.id]);
    expect(owners!.n).toBe(1);
    expect(await count("erasures")).toBe(1);
  });
});
