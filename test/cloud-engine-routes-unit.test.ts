// The engine's routes (cloud/src/engine/routes.ts) as the route table runs them, with the table's own helpers and a
// stand-in engine that answers what each case needs: what each route answers (status and body), what it refuses and
// in which words, what it tells the owners, and the storage it gives back when a document is not kept. The routes
// behind the cloud's real gates and the real engine run in test/cloud-engine.test.ts; these are the answers that one
// does not reach (a refusal of each kind, a cloud without an engine, the archive's file types).
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AuthError, type Caller } from "../cloud/src/auth.js";
import { ensureSchema } from "../cloud/src/app.js";
import { SlowDown, type EngineApi } from "../cloud/src/engine/api.js";
import { COOLING_OFF_HOURS, coolingOffMs, engineRoutes, TRY_COOLING_NOTE, type EngineCtx } from "../cloud/src/engine/routes.js";
import { sqliteSql } from "../cloud/src/node.js";
import { BadRequest } from "../cloud/src/read.js";
import { storageUse } from "../cloud/src/storageQuota.js";
import type { TenantDb } from "../cloud/src/tenant.js";

type Json = Record<string, unknown>;
const TENANT = "t_routesunit1", TRY = "t_try_routes01";

/** What the routes told the owners and the stage's wall. */
interface Heard { told: [string, Json][]; approved: Json[] }

function kit(heard: Heard, o: { approvedFails?: boolean } = {}) {
  return {
    json: (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }),
    err: (status: number, error: string) => new Response(JSON.stringify({ error }), { status, headers: { "content-type": "application/json" } }),
    body: async <T>(c: EngineCtx, schema: z.ZodType<T>) => schema.parse(await c.req.json()),
    approved: async (_c: EngineCtx, answer: { status: string }) => { heard.approved.push(answer as Json); if (o.approvedFails) throw new Error("the wall is down"); },
    tellOwners: async (_c: EngineCtx, kind: string, detail: Record<string, string | null>) => { heard.told.push([kind, detail]); },
  };
}

/** A company's rows as the routes read them: users, sign-in credentials and security events. */
interface Rows { users?: Json[]; credentials?: Json[]; security_events?: Json[]; failOne?: boolean }
function tenantDb(rows: Rows): TenantDb {
  const match = (r: Json, where: Json) => Object.entries(where).every(([k, v]) => (v && typeof v === "object" && "op" in (v as Json) ? String(r[k]) >= String((v as Json).v) : r[k] === v));
  return {
    one: async (table: string, where: Json) => { if (rows.failOne) throw new Error("the database is away"); return ((rows as Record<string, Json[]>)[table] ?? []).find((r) => match(r, where)) ?? null; },
    select: async (table: string, where: Json = {}) => ((rows as Record<string, Json[]>)[table] ?? []).filter((r) => match(r, where)),
    apply: async () => undefined,
    update: () => ({}),
  } as unknown as TenantDb;
}

const session = (tenantId = TENANT, user = "u_cfo"): Caller => ({ tenantId, kind: "session", principal: user, user, scopes: new Set(["read", "admin", "approve", "propose"]) as Caller["scopes"], role: "owner" });
const key = (tenantId = TENANT): Caller => ({ tenantId, kind: "key", principal: "k_1", user: "u_cfo", scopes: new Set(["read", "admin"]) as Caller["scopes"] });

interface Call { method: "GET" | "POST"; path: string; params?: string[]; body?: unknown; query?: string; caller?: Caller; rows?: Rows; engine?: Partial<EngineApi> | null; env?: Partial<EngineCtx["env"]>; heard?: Heard; approvedFails?: boolean }
async function run(o: Call): Promise<{ status: number; json: Json; res: Response; heard: Heard }> {
  const heard = o.heard ?? { told: [], approved: [] };
  const routes = engineRoutes<EngineCtx>(kit(heard, { approvedFails: o.approvedFails }));
  const route = routes.find((r) => r.method === o.method && r.path === o.path);
  if (!route) throw new Error(`no route ${o.method} ${o.path}`);
  const url = new URL(`https://cloud.test${o.path}${o.query ?? ""}`);
  const req = new Request(url, { method: o.method, ...(o.body !== undefined ? { body: JSON.stringify(o.body), headers: { "content-type": "application/json" } } : {}) });
  const engine = o.engine === null ? undefined : () => (o.engine ?? {}) as EngineApi;
  const c: EngineCtx = {
    env: { rpId: "cloud.test", origin: "https://cloud.test", ...(engine ? { engine } : {}), ...o.env },
    req, url, params: o.params ?? [], caller: o.caller ?? session(), db: tenantDb(o.rows ?? { users: [{ id: "u_cfo", display_name: "Carla CFO" }] }), now: new Date("2026-11-20T10:00:00Z"),
  };
  const res = await route.run(c);
  const text = await res.clone().text();
  let json: Json = {};
  try { json = JSON.parse(text) as Json; } catch { /* a file */ }
  return { status: res.status, json, res, heard };
}

describe("a cloud without an engine", () => {
  it("answers 404 on every engine route", async () => {
    for (const r of engineRoutes<EngineCtx>(kit({ told: [], approved: [] }))) {
      const out = await run({ method: r.method, path: r.path, params: ["AP-0001"], engine: null });
      expect(out.status, r.path).toBe(404);
      expect(out.json.error).toBe("the engine is not switched on for this cloud");
    }
  });
});

describe("the cooling-off of a new approval key", () => {
  it("72 hours unless set; a set value that is not a number or below zero is the default; never under 24 hours in production; 0 on /try", () => {
    expect(coolingOffMs({}, TENANT)).toBe(COOLING_OFF_HOURS * 3_600_000);
    expect(coolingOffMs({ approvalKeyCoolingHours: -1 }, TENANT)).toBe(COOLING_OFF_HOURS * 3_600_000);
    expect(coolingOffMs({ approvalKeyCoolingHours: Number.NaN }, TENANT)).toBe(COOLING_OFF_HOURS * 3_600_000);
    expect(coolingOffMs({ approvalKeyCoolingHours: 2 }, TENANT)).toBe(2 * 3_600_000);
    expect(coolingOffMs({ approvalKeyCoolingHours: 2, production: true }, TENANT)).toBe(24 * 3_600_000);
    expect(coolingOffMs({ approvalKeyCoolingHours: 48, production: true }, TENANT)).toBe(48 * 3_600_000);
    expect(coolingOffMs({ approvalKeyCoolingHours: 48, production: true }, TRY)).toBe(0);
  });

  it("GET /v1/engine: the caller's own key (or none), and the cooling-off with the /try note only where it is 0", async () => {
    const st = { mode: "test_money", passkeys: [{ person: "u_other" }, { person: "u_cfo", credential_id: "c1" }] };
    const mine = await run({ method: "GET", path: "/v1/engine", engine: { status: async () => st } as Partial<EngineApi> });
    expect(mine.json).toMatchObject({ my_passkey: { person: "u_cfo", credential_id: "c1" }, cooling_off: { hours: 72 } });
    expect(mine.json.cooling_off).not.toHaveProperty("note");
    const none = await run({ method: "GET", path: "/v1/engine", caller: session(TRY), engine: { status: async () => ({ mode: "test_money" }) } as Partial<EngineApi> });
    expect(none.json).toMatchObject({ my_passkey: null, cooling_off: { hours: 0, note: TRY_COOLING_NOTE } });
  });
});

describe("POST /v1/engine/documents", () => {
  const pdf = Buffer.from("%PDF-1.4 a small invoice").toString("base64");

  it("refuses what is not standard padded base64, and a document over 15 MB before decoding it", async () => {
    const upload = async () => { throw new Error("must not be asked"); };
    for (const base64 of ["abc", "ab-_", "a=bc"]) {
      await expect(run({ method: "POST", path: "/v1/engine/documents", body: { filename: "x.pdf", base64 }, engine: { upload } as Partial<EngineApi> })).rejects.toThrow(BadRequest);
    }
    const big = "A".repeat(4 * Math.ceil((15 * 1024 * 1024 + 3) / 3));
    await expect(run({ method: "POST", path: "/v1/engine/documents", body: { filename: "x.pdf", base64: big }, engine: { upload } as Partial<EngineApi> })).rejects.toThrow(/larger than 15 MB/);
  });

  it("decodes in pieces, passes the mime when given, and keeps a stored document's bytes in the quota; a duplicate gives them back", async () => {
    const sql = sqliteSql(":memory:");
    await ensureSchema(sql);
    const seen: { bytes: Uint8Array; filename: string; mime?: string }[] = [];
    const body = Buffer.alloc(70_000, 7);
    const upload = async (doc: { bytes: Uint8Array; filename: string; mime?: string }) => { seen.push(doc); return seen.length === 1 ? { kind: "invoice", sha256: "s", invoice: null } : { kind: "duplicate_document", sha256: "s", invoice: null }; };
    const first = await run({ method: "POST", path: "/v1/engine/documents", body: { filename: "a.pdf", mime: "application/pdf", base64: body.toString("base64") }, engine: { upload } as unknown as Partial<EngineApi>, env: { sql } });
    expect(first.status).toBe(200);
    expect(Buffer.from(seen[0]!.bytes).equals(body)).toBe(true);
    expect(seen[0]!.mime).toBe("application/pdf");
    expect(await storageUse(sql, TENANT)).toMatchObject({ bytes: 70_000, files: 1 });
    const dup = await run({ method: "POST", path: "/v1/engine/documents", body: { filename: "a.pdf", base64: body.toString("base64") }, engine: { upload } as unknown as Partial<EngineApi>, env: { sql } });
    expect(dup.json.kind).toBe("duplicate_document");
    expect(seen[1]).not.toHaveProperty("mime");
    expect(await storageUse(sql, TENANT)).toMatchObject({ bytes: 70_000, files: 1 });
    sql.close();
  });

  it("what the inbox refuses is a 400 in its own words; anything else fails the request; the quota is given back either way", async () => {
    const sql = sqliteSql(":memory:");
    await ensureSchema(sql);
    const refused = { upload: async () => { throw new Error("x.txt is not a PDF, a photo (JPEG or PNG) or an e-mail (.eml); nothing was filed"); } } as unknown as Partial<EngineApi>;
    await expect(run({ method: "POST", path: "/v1/engine/documents", body: { filename: "x.txt", base64: pdf }, engine: refused, env: { sql } })).rejects.toThrow(BadRequest);
    const broken = { upload: async () => { throw new Error("the disk is full"); } } as unknown as Partial<EngineApi>;
    await expect(run({ method: "POST", path: "/v1/engine/documents", body: { filename: "x.pdf", base64: pdf }, engine: broken, env: { sql } })).rejects.toThrow("the disk is full");
    const thrownString = { upload: async () => { throw "a string, nothing was filed"; } } as unknown as Partial<EngineApi>;
    await expect(run({ method: "POST", path: "/v1/engine/documents", body: { filename: "x.pdf", base64: pdf }, engine: thrownString, env: { sql } })).rejects.toThrow(/a string, nothing was filed/);
    expect(await storageUse(sql, TENANT)).toMatchObject({ bytes: 0, files: 0 });
    // A give-back that fails itself does not hide the inbox's refusal.
    const flaky = { ...sql, run: async (q: string, p?: (string | number | null)[]) => { if (/^UPDATE storage_use SET bytes = MAX/.test(q)) throw new Error("D1 is away"); return sql.run(q, p); } };
    await expect(run({ method: "POST", path: "/v1/engine/documents", body: { filename: "x.txt", base64: pdf }, engine: refused, env: { sql: flaky } })).rejects.toThrow(/nothing was filed/);
    // Without the cloud's database at hand nothing is reserved, and the refusal is the same.
    await expect(run({ method: "POST", path: "/v1/engine/documents", body: { filename: "x.txt", base64: pdf }, engine: refused })).rejects.toThrow(BadRequest);
    sql.close();
  });
});

describe("paying and the proposals", () => {
  const invoice = async (id: string) => (id === "AP-0001" ? { id } : null);
  it("pay: 404 for no invoice, 409 in the engine's words, the proposal; with the company's own limit, alone, settled and the sandbox's note", async () => {
    expect((await run({ method: "POST", path: "/v1/engine/invoices/{id}/pay", params: ["AP-0009"], engine: { invoice } as unknown as Partial<EngineApi> })).status).toBe(404);
    const refused = await run({ method: "POST", path: "/v1/engine/invoices/{id}/pay", params: ["AP-0001"], engine: { invoice, propose: async () => ({ ok: false, reason: "the invoice is held" }) } as unknown as Partial<EngineApi> });
    expect(refused).toMatchObject({ status: 409, json: { error: "the invoice is held" } });
    const filed = await run({ method: "POST", path: "/v1/engine/invoices/{id}/pay", params: ["AP-0001"], engine: { invoice, propose: async () => ({ ok: true, proposal: { id: "P-1" } }) } as unknown as Partial<EngineApi> });
    expect(filed.json).toEqual({ proposal: { id: "P-1" } });
    const alone = await run({ method: "POST", path: "/v1/engine/invoices/{id}/pay", params: ["AP-0001"], engine: { invoice, propose: async () => ({ ok: true, proposal: { id: "P-2" }, alone: { limit: "250.00" } }) } as unknown as Partial<EngineApi> });
    expect(alone.json).toEqual({ proposal: { id: "P-2" }, alone: { limit: "250.00" }, settled: null });
    const paid = await run({ method: "POST", path: "/v1/engine/invoices/{id}/pay", params: ["AP-0001"], engine: { invoice, propose: async () => ({ ok: true, proposal: { id: "P-3" }, alone: { limit: "250.00" }, settled: { fed: true }, airwallex_payout: { source: "simulated", reason: "switched_off" } }) } as unknown as Partial<EngineApi> });
    expect(paid.json).toMatchObject({ settled: { fed: true }, airwallex_payout: { reason: "switched_off" } });
  });

  it("a proposal: 404 or the proposal; retry: 404, retried, or 409 with why not", async () => {
    const proposal = async (id: string) => (id === "P-1" ? { id } : null);
    expect((await run({ method: "GET", path: "/v1/engine/proposals/{id}", params: ["P-9"], engine: { proposal } as unknown as Partial<EngineApi> })).status).toBe(404);
    expect((await run({ method: "GET", path: "/v1/engine/proposals/{id}", params: ["P-1"], engine: { proposal } as unknown as Partial<EngineApi> })).json).toEqual({ proposal: { id: "P-1" } });
    expect((await run({ method: "POST", path: "/v1/engine/proposals/{id}/retry", params: ["P-9"], engine: { proposal } as unknown as Partial<EngineApi> })).status).toBe(404);
    expect((await run({ method: "POST", path: "/v1/engine/proposals/{id}/retry", params: ["P-1"], engine: { proposal, retry: async () => ({ status: "retried", message: "paid" }) } as unknown as Partial<EngineApi> })).status).toBe(200);
    expect((await run({ method: "POST", path: "/v1/engine/proposals/{id}/retry", params: ["P-1"], engine: { proposal, retry: async () => ({ status: "nothing", message: "already paid" }) } as unknown as Partial<EngineApi> })).json).toEqual({ error: "already paid" });
  });

  it("approve: a session only; 404 for no proposal; a key in its cooling-off is a 403 told to the owners; a /try approval holds and tells the wall, whose failure is not the visitor's", async () => {
    const proposal = async (id: string) => (id === "P-1" ? { id } : null);
    const body = { terms_sha256: "a".repeat(64), credential: { id: "c" } };
    await expect(run({ method: "POST", path: "/v1/engine/proposals/{id}/approve", params: ["P-1"], caller: key(), body, engine: { proposal } as unknown as Partial<EngineApi> })).rejects.toThrow(AuthError);
    expect((await run({ method: "POST", path: "/v1/engine/proposals/{id}/approve", params: ["P-2"], body, engine: { proposal } as unknown as Partial<EngineApi> })).status).toBe(404);
    const asked: Json[] = [];
    const cooling = await run({ method: "POST", path: "/v1/engine/proposals/{id}/approve", params: ["P-1"], body, engine: { proposal, approve: async (a: Json) => { asked.push(a); return { status: "refused", code: "cooling_off", message: "this key is still cooling off" }; } } as unknown as Partial<EngineApi> });
    expect(cooling).toMatchObject({ status: 403, json: { code: "cooling_off", status: "refused", cooling_until: null, error: "this key is still cooling off" } });
    expect(cooling.heard.told).toEqual([["approval.refused_cooling_off", { person: "u_cfo", proposal: "P-1", cooling_until: null }]]);
    expect(asked[0]).not.toHaveProperty("hold");
    const ok = await run({ method: "POST", path: "/v1/engine/proposals/{id}/approve", params: ["P-1"], body, engine: { proposal, approve: async () => ({ status: "approved", message: "paid" }) } as unknown as Partial<EngineApi> });
    expect(ok).toMatchObject({ status: 200, json: { status: "approved" } });
    expect(ok.heard.approved).toEqual([]);
    const tryAsked: Json[] = [];
    const held = await run({ method: "POST", path: "/v1/engine/proposals/{id}/approve", params: ["P-1"], caller: session(TRY), body, approvedFails: true, engine: { proposal, approve: async (a: Json) => { tryAsked.push(a); return { status: "approved", message: "held for Pay" }; } } as unknown as Partial<EngineApi> });
    expect(held.status).toBe(200);
    expect(tryAsked[0]).toMatchObject({ hold: true, proposal_id: "P-1" });
    expect(held.heard.approved).toEqual([{ status: "approved", message: "held for Pay" }]);
  });
});

describe("the approval passkey", () => {
  const credential = { id: "new-key" };

  it("start: a key is refused; a person whose row is gone is refused; the relying party and the person otherwise", async () => {
    await expect(run({ method: "POST", path: "/v1/engine/passkey/start", caller: key(), engine: {} })).rejects.toThrow(/a key cannot/);
    await expect(run({ method: "POST", path: "/v1/engine/passkey/start", rows: { users: [] }, engine: {} })).rejects.toThrow(/no longer valid/);
    const s = await run({ method: "POST", path: "/v1/engine/passkey/start", engine: { passkeyStart: async () => ({ challenge: "ch", code: "c1", exclude: [] }) } as unknown as Partial<EngineApi> });
    expect(s.json).toEqual({ challenge: "ch", code: "c1", rp: { id: "cloud.test", name: "Purser" }, user: { id: "u_cfo", name: "Carla CFO", displayName: "Carla CFO" }, exclude: [] });
  });

  it("finish: endorsement required is a 409 with the challenge; a refused endorsement a 403 told to the owners; any other refusal a 409", async () => {
    const need = await run({ method: "POST", path: "/v1/engine/passkey/finish", body: { code: "c1", credential }, engine: { passkeyFinish: async () => ({ ok: false, code: "endorsement_required", reason: "another key is active", endorse: { challenge: "endorse-me" } }) } as unknown as Partial<EngineApi> });
    expect(need).toMatchObject({ status: 409, json: { code: "endorsement_required", endorse: { challenge: "endorse-me" } } });
    const bad = await run({ method: "POST", path: "/v1/engine/passkey/finish", body: { code: "c1", credential, endorsement: { id: "old" } }, engine: { passkeyFinish: async () => ({ ok: false, code: "endorsement_refused", reason: "the endorsement does not verify" }) } as unknown as Partial<EngineApi> });
    expect(bad).toMatchObject({ status: 403, json: { code: "endorsement_refused" } });
    expect(bad.heard.told).toEqual([["approval_key.refused", { person: "u_cfo", code: "endorsement_refused", reason: "the endorsement does not verify" }]]);
    const other = await run({ method: "POST", path: "/v1/engine/passkey/finish", body: { code: "c1", credential }, engine: { passkeyFinish: async () => ({ ok: false, code: "expired", reason: "the enrolment window closed" }) } as unknown as Partial<EngineApi> });
    expect(other).toMatchObject({ status: 409, json: { error: "the enrolment window closed" } });
  });

  it("finish with a co-signature from no owner of this company: the engine hears the refusal and refuses the key", async () => {
    const calls: Json[] = [];
    const passkeyFinish = async (a: Json) => { calls.push(a); return calls.length === 1 ? { ok: false, code: "endorsement_required", reason: "another key is active", endorse: { challenge: "endorse-me" } } : { ok: false, code: "endorsement_refused", reason: String(a.cosignRefused) }; };
    const cosign = { credential_id: "nobody-1234", assertion: { authenticatorData: "a", clientDataJSON: "b", signature: "c" } };
    const r = await run({ method: "POST", path: "/v1/engine/passkey/finish", body: { code: "c1", credential, cosign }, engine: { passkeyFinish } as unknown as Partial<EngineApi> });
    expect(r.status).toBe(403);
    expect(calls[1]).toMatchObject({ cosignRefused: "a co-signature must come from another owner of this company, with their own passkey" });
    expect(calls[1]).not.toHaveProperty("cosigned");
    // The co-signer's own credential, or one of an owner who is erased or not an owner, is refused the same way.
    for (const rows of [
      { users: [{ id: "u_cfo", display_name: "Carla CFO" }], credentials: [{ credential_id: "nobody-1234", user_id: "u_cfo", x: "x", y: "y", counter: 0 }] },
      { users: [{ id: "u_cfo", display_name: "Carla CFO" }, { id: "u_gone", role: "owner", erased_at: "2026-11-01" }], credentials: [{ credential_id: "nobody-1234", user_id: "u_gone", x: "x", y: "y", counter: 0 }] },
      { users: [{ id: "u_cfo", display_name: "Carla CFO" }, { id: "u_view", role: "viewer", erased_at: null }], credentials: [{ credential_id: "nobody-1234", user_id: "u_view", x: "x", y: "y", counter: 0 }] },
    ]) {
      calls.length = 0;
      await run({ method: "POST", path: "/v1/engine/passkey/finish", body: { code: "c1", credential, cosign }, rows, engine: { passkeyFinish } as unknown as Partial<EngineApi> });
      expect(calls[1]).toMatchObject({ cosignRefused: expect.stringMatching(/another owner of this company/) });
    }
  });

  it("a co-signature the database cannot check fails the request: it is not taken for a refusal", async () => {
    let n = 0;
    const passkeyFinish = async () => (++n === 1 ? { ok: false, code: "endorsement_required", reason: "r", endorse: { challenge: "e" } } : { ok: true });
    const rows: Rows = { users: [{ id: "u_cfo", display_name: "Carla CFO" }] };
    const db = tenantDb(rows);
    const heard: Heard = { told: [], approved: [] };
    const route = engineRoutes<EngineCtx>(kit(heard)).find((r) => r.path === "/v1/engine/passkey/finish")!;
    const body = { code: "c1", credential, cosign: { credential_id: "someone-1234", assertion: { authenticatorData: "a", clientDataJSON: "b", signature: "c" } } };
    const c: EngineCtx = {
      env: { rpId: "cloud.test", origin: "https://cloud.test", engine: () => ({ passkeyFinish } as unknown as EngineApi) }, url: new URL("https://cloud.test/v1/engine/passkey/finish"), params: [], caller: session(), now: new Date("2026-11-20T10:00:00Z"),
      req: new Request("https://cloud.test/v1/engine/passkey/finish", { method: "POST", body: JSON.stringify(body) }),
      db: { ...db, select: db.select, one: async (table: string, where: Json) => { if (table === "credentials") throw new Error("the database is away"); return db.one(table as never, where as never); } } as unknown as TenantDb,
    };
    await expect(route.run(c)).rejects.toThrow("the database is away");
  });

  it("finish: the new key and the key it replaced are told to every owner; a /try key's answer carries the cooling note", async () => {
    const out = { ok: true, credential_id: "abcdefghijklmnop", how: "endorsed", by: "u_old", cooling_until: "2026-11-23T10:00:00Z", replaced: "zyxwvutsrqponmlk" };
    const r = await run({ method: "POST", path: "/v1/engine/passkey/finish", body: { code: "c1", credential, endorsement: { id: "old" } }, engine: { passkeyFinish: async () => out } as unknown as Partial<EngineApi> });
    expect(r.json).toEqual({ credential_id: "abcdefghijklmnop", how: "endorsed", cooling_until: "2026-11-23T10:00:00Z" });
    expect(r.heard.told.map(([k]) => k)).toEqual(["approval_key.added", "approval_key.replaced"]);
    expect(r.heard.told[1]![1]).toMatchObject({ credential: "abcdefghijkl", replaced: "zyxwvutsrqpo" });
    const t = await run({ method: "POST", path: "/v1/engine/passkey/finish", caller: session(TRY), body: { code: "c1", credential }, engine: { passkeyFinish: async () => ({ ...out, replaced: null }) } as unknown as Partial<EngineApi> });
    expect(t.json).toMatchObject({ cooling_note: TRY_COOLING_NOTE });
    expect(t.heard.told.map(([k]) => k)).toEqual(["approval_key.added"]);
    // The company's first key carries no note, even on /try.
    const first = await run({ method: "POST", path: "/v1/engine/passkey/finish", caller: session(TRY), body: { code: "c1", credential }, engine: { passkeyFinish: async () => ({ ...out, how: "first", replaced: null }) } as unknown as Partial<EngineApi> });
    expect(first.json).not.toHaveProperty("cooling_note");
  });

  it("a recovery two platform admins issued stands for one new key, named with them; a recovery already used, or none, does not", async () => {
    const heardArgs: Json[] = [];
    const passkeyFinish = async (a: Json) => { heardArgs.push(a); return { ok: false, code: "x", reason: "stop" }; };
    const done = { kind: "recovery.completed", actor: "u_cfo", at: "2026-11-19T10:00:00Z", detail_json: JSON.stringify({ recovery_key: "rk_1" }) };
    const issued = { kind: "recovery.issued", actor: "ops", at: "2026-11-19T09:00:00Z", detail_json: JSON.stringify({ recovery_key: "rk_1", requested_by: "ops-first", approved_by: "ops-second" }) };
    const users = [{ id: "u_cfo", display_name: "Carla CFO" }];
    await run({ method: "POST", path: "/v1/engine/passkey/finish", body: { code: "c1", credential }, rows: { users, security_events: [done, issued] }, engine: { passkeyFinish } as unknown as Partial<EngineApi> });
    expect(heardArgs[0]).toMatchObject({ recovered: { by: "recovery rk_1 (platform admins ops-first and ops-second)" } });
    // Issued without both names, or not found: the recovery's key alone.
    await run({ method: "POST", path: "/v1/engine/passkey/finish", body: { code: "c1", credential }, rows: { users, security_events: [done] }, engine: { passkeyFinish } as unknown as Partial<EngineApi> });
    expect(heardArgs[1]).toMatchObject({ recovered: { by: "recovery rk_1" } });
    const noKey = { ...done, detail_json: "{}" };
    await run({ method: "POST", path: "/v1/engine/passkey/finish", body: { code: "c1", credential }, rows: { users, security_events: [noKey] }, engine: { passkeyFinish } as unknown as Partial<EngineApi> });
    expect(heardArgs[2]).toMatchObject({ recovered: { by: "recovery " } });
    const halfIssued = { ...issued, detail_json: JSON.stringify({ recovery_key: "rk_1", requested_by: "ops-first" }) };
    await run({ method: "POST", path: "/v1/engine/passkey/finish", body: { code: "c1", credential }, rows: { users, security_events: [done, halfIssued] }, engine: { passkeyFinish } as unknown as Partial<EngineApi> });
    expect(heardArgs[3]).toMatchObject({ recovered: { by: "recovery rk_1" } });
    heardArgs.splice(3, 1);
    // Used already for a key.
    const used = { kind: "approval_key.added", actor: "u_cfo", at: "2026-11-19T11:00:00Z", detail_json: JSON.stringify({ how: "recovery" }) };
    await run({ method: "POST", path: "/v1/engine/passkey/finish", body: { code: "c1", credential }, rows: { users, security_events: [done, issued, used] }, engine: { passkeyFinish } as unknown as Partial<EngineApi> });
    expect(heardArgs[3]).not.toHaveProperty("recovered");
    // With an endorsement, the recovery is not looked at.
    await run({ method: "POST", path: "/v1/engine/passkey/finish", body: { code: "c1", credential, endorsement: { id: "e" } }, rows: { users, security_events: [done, issued] }, engine: { passkeyFinish } as unknown as Partial<EngineApi> });
    expect(heardArgs[4]).not.toHaveProperty("recovered");
    expect(heardArgs[4]).toMatchObject({ endorsement: { id: "e" } });
  });
});

describe("the second key and the CFO's rule for high-risk payments", () => {
  it("second-key policy: a session only; the proposal, or 409 in the engine's words", async () => {
    const changes = [{ key: "approval.second_key_eur", to: "5000" }];
    await expect(run({ method: "POST", path: "/v1/engine/policy/second-key", caller: key(), body: { changes }, engine: {} })).rejects.toThrow(AuthError);
    expect((await run({ method: "POST", path: "/v1/engine/policy/second-key", body: { changes }, engine: { proposeSecondKey: async () => ({ ok: true, proposal: { id: "P-7" } }) } as unknown as Partial<EngineApi> })).json).toEqual({ proposal: { id: "P-7" } });
    expect((await run({ method: "POST", path: "/v1/engine/policy/second-key", body: { changes }, engine: { proposeSecondKey: async () => ({ ok: false, reason: "not a setting" }) } as unknown as Partial<EngineApi> })).json).toEqual({ error: "not a setting" });
  });

  it("security key: start answers the challenge or 409; finish tells the owners of a new key, or 409", async () => {
    const start = await run({ method: "POST", path: "/v1/engine/security-key/start", engine: { securityKeyStart: async () => ({ ok: true, challenge: "ch", user_id: "uh", exclude: ["x"] }) } as unknown as Partial<EngineApi> });
    expect(start.json).toEqual({ challenge: "ch", user: { id: "uh", name: "Carla CFO", displayName: "Carla CFO" }, rp: { id: "cloud.test", name: "Purser" }, exclude: ["x"] });
    const noPasskey = await run({ method: "POST", path: "/v1/engine/security-key/start", engine: { securityKeyStart: async () => ({ ok: false, reason: "set up the approval passkey first" }) } as unknown as Partial<EngineApi> });
    expect(noPasskey).toMatchObject({ status: 409, json: { error: "set up the approval passkey first" } });
    const fin = await run({ method: "POST", path: "/v1/engine/security-key/finish", body: { credential: { id: "k" } }, engine: { securityKeyFinish: async () => ({ ok: true, credential_id: "0123456789abcdef" }) } as unknown as Partial<EngineApi> });
    expect(fin.json).toEqual({ credential_id: "0123456789abcdef" });
    expect(fin.heard.told).toEqual([["security_key.added", { person: "u_cfo", credential: "0123456789ab" }]]);
    const platform = await run({ method: "POST", path: "/v1/engine/security-key/finish", body: { credential: { id: "k" } }, engine: { securityKeyFinish: async () => ({ ok: false, reason: "a platform authenticator is not a security key" }) } as unknown as Partial<EngineApi> });
    expect(platform).toMatchObject({ status: 409, heard: { told: [] } });
  });
});

describe("Airwallex's actions", () => {
  const invoice = async (id: string) => (id === "AP-0001" ? { id } : null);
  const supplier = { how: "called the supplier on the number in our own records", street: "Main St 1", city: "Utrecht", postcode: "3511 AA" };

  it("a new supplier: a session only; 404 for no invoice; 201 with the proposal and the name check; 409 with the check when refused", async () => {
    await expect(run({ method: "POST", path: "/v1/engine/invoices/{id}/supplier", params: ["AP-0001"], caller: key(), body: supplier, engine: { invoice } as unknown as Partial<EngineApi> })).rejects.toThrow(AuthError);
    expect((await run({ method: "POST", path: "/v1/engine/invoices/{id}/supplier", params: ["AP-0002"], body: supplier, engine: { invoice } as unknown as Partial<EngineApi> })).status).toBe(404);
    const asked: Json[] = [];
    const ok = await run({ method: "POST", path: "/v1/engine/invoices/{id}/supplier", params: ["AP-0001"], body: supplier, engine: { invoice, addSupplier: async (_id: string, v: Json) => { asked.push(v); return { ok: true, proposal: { id: "P-5" }, name_check: { result: "match" } }; } } as unknown as Partial<EngineApi> });
    expect(ok).toMatchObject({ status: 201, json: { proposal: { id: "P-5" }, name_check: { result: "match" } } });
    expect(asked[0]).toEqual({ by: "Carla CFO", how: supplier.how, address: { street: "Main St 1", city: "Utrecht", postcode: "3511 AA" } });
    const no = await run({ method: "POST", path: "/v1/engine/invoices/{id}/supplier", params: ["AP-0001"], body: supplier, engine: { invoice, addSupplier: async () => ({ ok: false, reason: "the name does not match", name_check: { result: "no_match" } }) } as unknown as Partial<EngineApi> });
    expect(no).toMatchObject({ status: 409, json: { error: "the name does not match", name_check: { result: "no_match" } } });
  });

  it("pay all: 201 with what was planned; 409 with what was not, an empty list when the engine names none", async () => {
    const ok = await run({ method: "POST", path: "/v1/engine/batch", body: { invoice_ids: ["AP-0001", "AP-0002"] }, engine: { proposeBatch: async () => ({ ok: true, proposal: { id: "P-B" }, planned: ["AP-0001"], not_planned: [{ id: "AP-0002" }] }) } as unknown as Partial<EngineApi> });
    expect(ok).toMatchObject({ status: 201, json: { planned: ["AP-0001"] } });
    const none = await run({ method: "POST", path: "/v1/engine/batch", body: { invoice_ids: ["AP-0002"] }, engine: { proposeBatch: async () => ({ ok: false, reason: "none could be planned" }) } as unknown as Partial<EngineApi> });
    expect(none).toMatchObject({ status: 409, json: { error: "none could be planned", not_planned: [] } });
    const some = await run({ method: "POST", path: "/v1/engine/batch", body: { invoice_ids: ["AP-0002"] }, engine: { proposeBatch: async () => ({ ok: false, reason: "none", not_planned: [{ id: "AP-0002", why: "held" }] }) } as unknown as Partial<EngineApi> });
    expect(some.json.not_planned).toEqual([{ id: "AP-0002", why: "held" }]);
  });

  it("money in: a session only; 0.00 is refused; the amount in cents with a reference; 409 in the engine's words", async () => {
    await expect(run({ method: "POST", path: "/v1/engine/deposit", caller: key(), body: { amount: "25.00" }, engine: {} })).rejects.toThrow(AuthError);
    const zero = await run({ method: "POST", path: "/v1/engine/deposit", body: { amount: "0.00" }, engine: { depositIn: async () => { throw new Error("must not be asked"); } } as unknown as Partial<EngineApi> });
    expect(zero).toMatchObject({ status: 400, json: { error: "an amount above 0.00 and at most 500.00" } });
    const over = await run({ method: "POST", path: "/v1/engine/deposit", body: { amount: "999.99" }, engine: {} });
    expect(over.status).toBe(400);
    const asked: Json[] = [];
    const ok = await run({ method: "POST", path: "/v1/engine/deposit", body: { amount: "25.50" }, engine: { depositIn: async (a: Json) => { asked.push(a); return { ok: true, deposit_id: "d1", status: "SETTLED" }; } } as unknown as Partial<EngineApi> });
    expect(ok).toMatchObject({ status: 201, json: { deposit_id: "d1" } });
    expect(asked[0]).toMatchObject({ amountCents: 2550, payer: "Test customer (simulation)", reference: expect.stringMatching(/^PURSER-IN-[0-9A-Z]+$/) });
    expect((await run({ method: "POST", path: "/v1/engine/deposit", body: { amount: "25.50" }, engine: { depositIn: async () => ({ ok: false, reason: "the day's cap is used" }) } as unknown as Partial<EngineApi> })).json).toEqual({ error: "the day's cap is used" });
  });

  it("the Airwallex view and sync answer what the engine says", async () => {
    expect((await run({ method: "GET", path: "/v1/engine/airwallex", engine: { airwallex: async () => ({ airwallex: { on: false } }) } as unknown as Partial<EngineApi> })).json).toEqual({ airwallex: { on: false } });
    expect((await run({ method: "POST", path: "/v1/engine/sync", engine: { sync: async () => ({ fed: true }) } as unknown as Partial<EngineApi> })).json).toEqual({ fed: true });
  });
});

describe("the events and the archive", () => {
  it("events: whole numbers in range or a 400; 429 slow_down with retry_ms; any other failure fails the request", async () => {
    const asked: [number, number][] = [];
    const events = async (after: number, limit: number) => { asked.push([after, limit]); return { items: [], next: after }; };
    await run({ method: "GET", path: "/v1/engine/events", engine: { events } as unknown as Partial<EngineApi> });
    await run({ method: "GET", path: "/v1/engine/events", query: "?after=5&limit=200", engine: { events } as unknown as Partial<EngineApi> });
    expect(asked).toEqual([[0, 100], [5, 200]]);
    for (const q of ["?limit=0", "?limit=201", "?after=-1", "?after=1.5", "?limit="]) {
      await expect(run({ method: "GET", path: "/v1/engine/events", query: q, engine: { events } as unknown as Partial<EngineApi> }), q).rejects.toThrow(BadRequest);
    }
    const slow = await run({ method: "GET", path: "/v1/engine/events", engine: { events: async () => { throw new SlowDown(400, "slow down: at most 2 reads of the events a second"); } } as unknown as Partial<EngineApi> });
    expect(slow).toMatchObject({ status: 429, json: { code: "slow_down", retry_ms: 400 } });
    await expect(run({ method: "GET", path: "/v1/engine/events", engine: { events: async () => { throw new Error("the object is away"); } } as unknown as Partial<EngineApi> })).rejects.toThrow("the object is away");
  });

  it("vault: the files; one file as an attachment of its own type, named safely; 404 for no path, a path too long, or one the index does not list", async () => {
    const files = [{ path: "2026/a.pdf" }];
    expect((await run({ method: "GET", path: "/v1/engine/vault", engine: { vaultFiles: async () => files } as unknown as Partial<EngineApi> })).json).toEqual({ files });
    const kept: Record<string, Uint8Array> = { "2026/Bergtex GmbH/BTX 21.pdf": new Uint8Array([37, 80, 68, 70]), "2026/index.json": new Uint8Array([123, 125]), "2026/ledger.CSV": new Uint8Array([97]), "2026/raw.bin": new Uint8Array([1]), "2026/README": new Uint8Array([2]) };
    const vaultFile = async (p: string) => kept[p] ?? null;
    const get = (path: string) => run({ method: "GET", path: "/v1/engine/vault/file", query: `?path=${encodeURIComponent(path)}`, engine: { vaultFile } as unknown as Partial<EngineApi> });
    const pdf = await get("2026/Bergtex GmbH/BTX 21.pdf");
    expect(pdf.status).toBe(200);
    expect(pdf.res.headers.get("content-type")).toBe("application/pdf");
    expect(pdf.res.headers.get("content-disposition")).toBe('attachment; filename="BTX_21.pdf"');
    expect(pdf.res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(new Uint8Array(await pdf.res.arrayBuffer())).toEqual(new Uint8Array([37, 80, 68, 70]));
    expect((await get("2026/index.json")).res.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect((await get("2026/ledger.CSV")).res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect((await get("2026/raw.bin")).res.headers.get("content-type")).toBe("application/octet-stream");
    expect((await get("2026/README")).res.headers.get("content-type")).toBe("application/octet-stream");
    expect((await get("2026/missing.pdf")).status).toBe(404);
    expect((await get(`2026/${"x".repeat(1000)}.pdf`)).status).toBe(404);
    expect((await run({ method: "GET", path: "/v1/engine/vault/file", engine: { vaultFile } as unknown as Partial<EngineApi> })).json).toEqual({ error: "no file" });
  });
});
