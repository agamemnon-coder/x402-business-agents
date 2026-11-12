// Master list 655: Purser's suppliers, bills and payments written to T:0 with POST /v1/records, against a fake T:0 in
// this process (no network). Every write needs the CFO's signed approval of the batch; a re-run makes 0 writes; a 429 and
// a lost answer are retried without a second record. The request shapes are assumed (docs/t0.md).
import { describe, expect, it } from "vitest";
import { approvalFor, batchSha256, pendingRecords, plannedRecords, RecordsRefused, T0RecordsClient, writeRecords, type T0RecordRequest } from "../src/accounting/t0Records.js";
import { termsHash, TERMS_SCHEMA, type Terms } from "../src/lib/terms.js";
import type { DB } from "../src/db/open.js";
import { vaultWorld } from "./fakes/vaultWorld.js";

const KEY = "t0-test-key-not-real";

/** A fake T:0: keeps records by idempotency key, and can answer 429 or drop the answer after writing. */
function fakeT0(script: ("429" | "lose" | "500")[] = []) {
  const byKey = new Map<string, { id: string; record_type: string; external_ref: string; body: T0RecordRequest }>();
  const calls: { method: string; path: string; auth: string | null }[] = [];
  let n = 0;
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    calls.push({ method: init?.method ?? "GET", path: url.pathname + url.search, auth: new Headers(init?.headers).get("authorization") });
    if (init?.method === "GET") {
      const ref = url.searchParams.get("external_ref");
      return Response.json({ data: [...byKey.values()].filter((r) => r.external_ref === ref).map(({ body: _b, ...r }) => r) });
    }
    const key = new Headers(init?.headers).get("x-idempotency-key")!;
    const body = JSON.parse(String(init?.body)) as T0RecordRequest;
    const step = script.shift();
    if (step === "429") return new Response(JSON.stringify({ error_code: "RATE" }), { status: 429, headers: { "retry-after": "1" } });
    if (step === "500") return new Response("{}", { status: 500 });
    let rec = byKey.get(key);
    if (rec) return Response.json({ error_code: "CAPI34" }, { status: 409 });
    rec = { id: `rec_${++n}`, record_type: body.record_type, external_ref: body.external_ref, body };
    byKey.set(key, rec);
    if (step === "lose") throw new TypeError("fetch failed: the connection was reset");
    return Response.json({ id: rec.id, record_type: rec.record_type, external_ref: rec.external_ref });
  };
  return { fetch, byKey, calls, posts: () => calls.filter((c) => c.method === "POST").length };
}

const client = (f: ReturnType<typeof fakeT0>) => new T0RecordsClient({ apiKey: KEY, baseUrl: "https://t0.fake.invalid", fetch: f.fetch, sleep: async () => {} });

/** The CFO's approval of a batch, as the ledger holds a signed proposal (approved with the passkey in a real run). */
function approveBatch(db: DB, batch: string, id = "P-T0-1"): string {
  const terms = { schema: TERMS_SCHEMA, kind: "t0_records", proposal_id: id, expires_at: "2026-12-31T00:00:00Z", batch_sha256: batch } as unknown as Terms;
  const hash = termsHash(terms);
  const at = "2026-11-12T10:00:00.000Z";
  db.prepare("INSERT INTO proposals (proposal_id, kind, terms_json, terms_sha256, created_by, status, expires_at, created_at) VALUES (?, 't0_records', ?, ?, 'test', 'APPROVED', ?, ?)").run(id, JSON.stringify(terms), hash, terms.expires_at, at);
  db.prepare("INSERT INTO approvals (proposal_id, decision, approved_sha256, approver, method, typed_prefix, created_at) VALUES (?, 'APPROVED', ?, 'cfo', 'passkey', ?, ?)").run(id, hash, hash.slice(0, 8), at);
  return hash;
}

describe("T:0 records", () => {
  it("plans each supplier once, each bookable bill and each paid payment, with keys that depend only on content", async () => {
    const w = await vaultWorld();
    const planned = plannedRecords(w.db);
    expect(planned.map((r) => r.request.record_type).sort()).toEqual(["bill", "payment", "supplier"]);
    expect(plannedRecords(w.db).map((r) => r.key)).toEqual(planned.map((r) => r.key));
    const pay = planned.find((r) => r.request.record_type === "payment")!.request.data as { rail_ref: string; amount: string };
    expect(pay.rail_ref).toBeTruthy();
    expect(new Set(planned.map((r) => r.key)).size).toBe(planned.length);
  }, 60_000);

  it("refuses without a signed approval of this batch, and sends nothing", async () => {
    const w = await vaultWorld();
    const f = fakeT0();
    await expect(writeRecords(w.db, client(f))).rejects.toThrow(RecordsRefused);
    await expect(writeRecords(w.db, client(f))).rejects.toThrow(/no signed approval names this batch/);
    // An approval of other records does not count either.
    approveBatch(w.db, "ab".repeat(32));
    await expect(writeRecords(w.db, client(f))).rejects.toThrow(/no signed approval names this batch/);
    expect(f.calls).toHaveLength(0);
    // Nor does the client post a record without the hash.
    await expect(client(f).post({ record_type: "supplier", external_ref: "x", data: { name: "x" }, approval_sha256: "" }, "k")).rejects.toThrow(RecordsRefused);
    expect(f.calls).toHaveLength(0);
  }, 60_000);

  it("refuses when the approval's stored terms changed after signing", async () => {
    const w = await vaultWorld();
    const batch = batchSha256(pendingRecords(w.db));
    const signed = approveBatch(w.db, batch);
    const row = w.db.prepare("SELECT terms_json FROM proposals WHERE proposal_id = 'P-T0-1'").get() as { terms_json: string };
    w.db.prepare("UPDATE proposals SET terms_json = ? WHERE proposal_id = 'P-T0-1'").run(row.terms_json.replace("2026-12-31", "2027-12-31"));
    expect(() => approvalFor(w.db, batch)).toThrow(`no longer hash to the signed hash ${signed}`);
  }, 60_000);

  it("writes each record once with the approval hash in the request, and a re-run makes 0 writes", async () => {
    const w = await vaultWorld();
    const n = pendingRecords(w.db).length;
    const signed = approveBatch(w.db, batchSha256(pendingRecords(w.db)));
    const f = fakeT0();
    const r = await writeRecords(w.db, client(f));
    expect(r).toMatchObject({ written: n, already: 0 });
    expect(f.byKey.size).toBe(n);
    for (const rec of f.byKey.values()) expect(rec.body.approval_sha256).toBe(signed);
    // The key travels only as the bearer token.
    expect(f.calls.every((c) => c.auth === `Bearer ${KEY}`)).toBe(true);
    const posts = f.posts();
    expect(await writeRecords(w.db, client(f))).toEqual({ written: 0, already: 0, records: [] });
    expect(f.posts()).toBe(posts);
    expect(pendingRecords(w.db)).toHaveLength(0);
  }, 60_000);

  it("retries a 429 and a 5xx, and resolves a lost answer by looking the record up: never a second record", async () => {
    const w = await vaultWorld();
    const n = pendingRecords(w.db).length;
    approveBatch(w.db, batchSha256(pendingRecords(w.db)));
    const f = fakeT0(["429", "lose", "500"]);
    const r = await writeRecords(w.db, client(f));
    expect(r.written + r.already).toBe(n);
    expect(r.already).toBe(1);
    expect(f.byKey.size).toBe(n);
    expect(new Set([...f.byKey.values()].map((x) => x.external_ref)).size).toBe(n);
  }, 60_000);

  it("takes a 409 replay as written when the record is there", async () => {
    const w = await vaultWorld();
    approveBatch(w.db, batchSha256(pendingRecords(w.db)));
    const f = fakeT0();
    const first = pendingRecords(w.db)[0]!;
    // T:0 already holds the first record (an earlier run that crashed before it was recorded here).
    const res = await client(f).post({ ...first.request, approval_sha256: "cd".repeat(32) }, first.key);
    expect(res.status).toBe(200);
    const r = await writeRecords(w.db, client(f));
    expect(r.already).toBe(1);
    expect(f.byKey.size).toBe(pendingRecords(w.db).length + r.written + r.already);
  }, 60_000);
});
