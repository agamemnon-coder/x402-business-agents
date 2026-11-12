// GET /v1/vault: the vault's index for a year, as the cloud holds it (one object per year beside the documents). Read
// with a company's own key, never another company's; a year without an index is said, not invented. No network.
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { vaultIndexKey } from "../cloud/src/sync.js";
import { testCloud, type TestCloud, type TestTenant } from "./support/cloud.js";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

let c: TestCloud;
let A: TestTenant;
let B: TestTenant;
const index = (company: string, files: unknown[]) => new TextEncoder().encode(JSON.stringify({ company, year: 2026, note: "Every file in this year.", files }));
const file = (path: string, kind: string, body: string) => ({ path, sha256: sha(body), bytes: body.length, kind, key: `${kind}:x`, data_sha256: sha(`data ${body}`), added_at: "2026-11-10T09:30:00.000Z" });

beforeAll(async () => {
  c = testCloud();
  A = await c.tenant("alder");
  B = await c.tenant("birch");
});
afterAll(() => c.close());

describe("GET /v1/vault", () => {
  it("says there is no vault yet when the company's runner has not filed one in the cloud", async () => {
    const r = await c.req("GET", "/v1/vault", { key: A.key });
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ years: [], year: null, company: null, note: null, files: [] });
  });

  it("serves the newest year's index, file by file, and says which files the cloud holds as documents", async () => {
    const files = [
      file("Alder/2026/2026-Q4/Inkoopfacturen/Bergtex/2026-10-02 BTX-1 EUR 10.00.pdf", "invoice", "one"),
      file("Alder/2026/2026-Q4/Betalingen/2026-10-05 Bergtex BTX-1.pdf", "receipt", "two"),
    ];
    await c.env.blobs.put(vaultIndexKey(A.id, 2025), index("Alder", []));
    await c.env.blobs.put(vaultIndexKey(A.id, 2026), index("Alder", files));
    // One of the two is stored as a document of the company (as a push stores it).
    await c.env.sql.run("INSERT INTO documents (tenant_id, sha256, filename, mime, size, blob_key, received_at) VALUES (?, ?, 'x.pdf', 'application/pdf', 3, 'k', '2026-11-10T09:30:00.000Z')", [A.id, sha("one")]);
    const r = await c.req("GET", "/v1/vault", { key: A.key });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ years: [2026, 2025], year: 2026, company: "Alder", note: "Every file in this year." });
    const got = r.json.files as { path: string; sha256: string; stored: boolean }[];
    expect(got.map((f) => f.path)).toEqual(files.map((f) => f.path).sort());
    expect(Object.fromEntries(got.map((f) => [f.sha256, f.stored]))).toEqual({ [sha("one")]: true, [sha("two")]: false });
    const older = await c.req("GET", "/v1/vault?year=2025", { key: A.key });
    expect(older.json).toMatchObject({ years: [2026, 2025], year: 2025, files: [] });
  });

  it("never shows one company another company's vault", async () => {
    const r = await c.req("GET", "/v1/vault", { key: B.key });
    expect(r.json).toEqual({ years: [], year: null, company: null, note: null, files: [] });
    expect(JSON.stringify(r.json)).not.toContain("Alder");
  });

  it("answers a year it does not hold with 404, a year that is not a year with 400, and nobody without a key", async () => {
    expect((await c.req("GET", "/v1/vault?year=2024", { key: A.key })).status).toBe(404);
    expect((await c.req("GET", "/v1/vault?year=twenty", { key: A.key })).status).toBe(400);
    expect((await c.req("GET", "/v1/vault")).status).toBe(401);
  });

  it("refuses an index that is not what the vault writes, rather than show it", async () => {
    await c.env.blobs.put(vaultIndexKey(B.id, 2026), index("Birch", [{ path: "x", sha256: "not a hash", bytes: 1, kind: "invoice", key: "k", added_at: "t" }]));
    const r = await c.req("GET", "/v1/vault", { key: B.key });
    expect(r.status).toBe(500);
    expect(JSON.stringify(r.json)).not.toContain("not a hash");
  });
});
