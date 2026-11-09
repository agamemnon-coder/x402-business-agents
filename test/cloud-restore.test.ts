// Backups: a company's export is a complete backup. Imported into a fresh database (another Purser Cloud, or the same
// one after a loss) it gives back every row of every table and every document, and both hash chains still verify.
// Runs on better-sqlite3 and, with npm run test:d1, on D1.
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { importTenant, RestoreRefused, verifyChains } from "../cloud/src/restore.js";
import { TENANT_TABLES } from "../cloud/src/tenant.js";
import { seedTreasury } from "../src/agents/euroBill.js";
import { ingestDocument } from "../src/ap/inbox.js";
import type { Asker } from "../src/ap/read.js";
import { audit } from "../src/audit/log.js";
import { pushToCloud } from "../src/cloudsync/client.js";
import { openDb, type DB } from "../src/db/open.js";
import { postEntry } from "../src/ledger/core.js";
import { EN, NL } from "./fakes/apInvoices.js";
import { FakeAirwallex } from "./fakes/airwallex.js";
import { pdfOf } from "./fakes/pdf.js";
import { testCloud, type TestCloud } from "./support/cloud.js";

const parserOnly: Asker = { ask: async (_a, fallback) => ({ value: fallback(), source: "fallback", model: null, note: "no key" }) } as Asker;
const NOW = new Date("2026-11-08T12:00:00Z");
let a: TestCloud, b: TestCloud, db: DB, dir: string;
let t: { id: string; key: string; owner: string };

beforeEach(async () => {
  a = testCloud(); b = testCloud();
  dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "cloud-restore-"));
  db = openDb(":memory:");
  t = await a.tenant("northwind");
  const awx = new FakeAirwallex();
  await seedTreasury(db, awx, awx);
  await ingestDocument(db, { dir, reader: parserOnly, now: () => NOW }, { bytes: await pdfOf(EN), filename: "bergtex.pdf", source: "upload" });
  await ingestDocument(db, { dir, reader: parserOnly, now: () => NOW }, { bytes: await pdfOf(NL), filename: "zeeland.pdf", source: "upload" });
  postEntry(db, { date: "2026-10-09", description: "Software", created_by: "test", lines: [
    { account: "6100", debit: 5_000, currency: "EUR", vat_code: "P21", vat_cents: 1_050 }, { account: "1510", debit: 1_050, currency: "EUR" }, { account: "1200", credit: 6_050, currency: "EUR" }] }, NOW);
  audit(db, "human", "test.note", "x", { note: "kept through a restore" }, NOW);
  await pushToCloud(db, { url: "https://cloud.test", key: t.key, fetch: a.fetch }, NOW);
  await a.req("POST", "/v1/users", { key: t.key, body: { display_name: "Accountant", email: "acc@example.test", role: "accountant" } });
});
afterEach(() => { a.close(); b.close(); rmSync(dir, { recursive: true, force: true }); });

async function backup(): Promise<{ data: Record<string, unknown>; docs: Record<string, Uint8Array> }> {
  const data = (await a.req("GET", "/v1/export", { key: t.key })).json as Record<string, unknown>;
  const docs: Record<string, Uint8Array> = {};
  for (const d of data.documents_to_fetch as { sha256: string; path: string }[]) docs[d.sha256] = new Uint8Array(await (await a.req("GET", d.path, { key: t.key })).res.arrayBuffer());
  return { data, docs };
}
/** Rows without their company: the tenant id (also inside a blob's key) is the one thing a restore changes. */
const strip = (rows: unknown, tenantId: string) => JSON.parse(JSON.stringify((rows as Record<string, unknown>[]).map((r) => { const c = { ...r }; delete c.tenant_id; return c; })).split(tenantId).join("T")) as unknown;

describe("export → import round trip", () => {
  it("gives back every table, every document and both hash chains, in a fresh database", async () => {
    const before = await backup();
    expect(await verifyChains(before.data)).toBeNull();
    const target = await b.tenant("northwind-restored");
    const r = await importTenant(b.env.sql, b.env.blobs, before.data, before.docs, { tenantId: target.id, now: NOW });
    expect(r.documents).toBe(2);
    const after = (await b.req("GET", "/v1/export", { key: target.key })).json as Record<string, unknown>;
    // The fresh company's own owner and first key are its own; everything the backup held is back, row for row.
    for (const table of TENANT_TABLES) {
      if (["users", "api_keys", "credentials", "enrolments", "push_log"].includes(table)) continue;
      expect({ table, rows: strip(after[table], target.id) }).toEqual({ table, rows: strip(before.data[table], t.id) });
    }
    const people = (after.users as { display_name: string }[]).map((u) => u.display_name).sort();
    expect(people).toEqual(expect.arrayContaining(["Accountant", "Owner"]));
    expect(await verifyChains(after)).toBeNull();
    for (const [sha, bytes] of Object.entries(before.docs)) {
      const got = await b.req("GET", `/v1/documents/${sha}`, { key: target.key });
      expect(createHash("sha256").update(Buffer.from(await got.res.arrayBuffer())).digest("hex")).toBe(sha);
      expect(bytes.length).toBeGreaterThan(0);
    }
    // The reports in the restored company equal the original's.
    for (const p of ["/v1/reports/trial?to=2026-12-31", "/v1/reports/vat?quarter=2026Q4", "/v1/insights"]) {
      expect((await b.req("GET", p, { key: target.key })).json).toEqual((await a.req("GET", p, { key: t.key })).json);
    }
  });

  it("refuses a backup whose chain was changed, a missing document, and a company that already holds data", async () => {
    const good = await backup();
    const tampered = structuredClone(good.data);
    (tampered.audit_rows as { payload_json: string }[])[0]!.payload_json = '{"edited":true}';
    const target = await b.tenant("restored");
    await expect(importTenant(b.env.sql, b.env.blobs, tampered, good.docs, { tenantId: target.id, now: NOW })).rejects.toThrow(RestoreRefused);
    const missing = { ...good.docs };
    delete missing[Object.keys(missing)[0]!];
    await expect(importTenant(b.env.sql, b.env.blobs, good.data, missing, { tenantId: target.id, now: NOW })).rejects.toThrow(/document/);
    const wrongBytes = Object.fromEntries(Object.entries(good.docs).map(([k]) => [k, new Uint8Array([1, 2, 3])]));
    await expect(importTenant(b.env.sql, b.env.blobs, good.data, wrongBytes, { tenantId: target.id, now: NOW })).rejects.toThrow(/do not match its hash/);
    await importTenant(b.env.sql, b.env.blobs, good.data, good.docs, { tenantId: target.id, now: NOW });
    await expect(importTenant(b.env.sql, b.env.blobs, good.data, good.docs, { tenantId: target.id, now: NOW })).rejects.toThrow(/already holds/);
  });
});
