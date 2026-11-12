// Retention, end to end on the store the Worker uses: a person's erasure removes their personal data and keeps the
// books; a closed company's rows and documents stay until seven full years after its last record and are then purged,
// documents and mail included, and no other company's. With npm run test:d1 this runs on D1 and on R2 itself
// (workerd's local R2); otherwise on better-sqlite3 and a directory.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { receiveEmail } from "../cloud/src/mail.js";
import { purgeExpired } from "../cloud/src/privacy.js";
import { r2Blobs } from "../cloud/src/store.js";
import { TENANT_TABLES } from "../cloud/src/tenant.js";
import { seedTreasury } from "../src/agents/euroBill.js";
import { ingestDocument } from "../src/ap/inbox.js";
import type { Asker } from "../src/ap/read.js";
import { pushToCloud } from "../src/cloudsync/client.js";
import { openDb } from "../src/db/open.js";
import { EN } from "./fakes/apInvoices.js";
import { FakeAirwallex } from "./fakes/airwallex.js";
import { emlWith, pdfOf } from "./fakes/pdf.js";
import { testCloud, type TestCloud } from "./support/cloud.js";

const parserOnly: Asker = { ask: async (_a, fallback) => ({ value: fallback(), source: "fallback", model: null, note: "no key" }) } as Asker;
const NOW = new Date("2026-11-08T12:00:00Z");
const DOMAIN = "in.purser.test";
let c: TestCloud, dir: string;

beforeEach(() => {
  c = testCloud();
  if (globalThis.__cloudR2) c.env.blobs = r2Blobs(globalThis.__cloudR2);
  dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "cloud-retention-"));
});
afterEach(() => { c.close(); rmSync(dir, { recursive: true, force: true }); });

async function company(slug: string) {
  const t = await c.tenant(slug);
  const db = openDb(":memory:");
  const awx = new FakeAirwallex();
  await seedTreasury(db, awx, awx);
  await ingestDocument(db, { dir, reader: parserOnly, now: () => NOW }, { bytes: await pdfOf(EN), filename: `${slug}.pdf`, source: "upload" });
  await pushToCloud(db, { url: "https://cloud.test", key: t.key, fetch: c.fetch }, NOW);
  const raw = emlWith(await pdfOf(`${EN}\n${slug}`), "mail.pdf");
  const m = { from: "billing@bergtex.example", to: `${slug}@${DOMAIN}`, raw: new Uint8Array(raw), rawSize: raw.length, setReject() {} };
  expect(await receiveEmail(c.env.sql, c.env.blobs, m, { domain: DOMAIN, now: NOW })).toMatchObject({ queued: true });
  return t;
}
const rows = async (tenantId: string) => {
  let n = 0;
  for (const t of TENANT_TABLES) n += (await c.env.sql.first<{ n: number }>(`SELECT COUNT(*) AS n FROM ${t} WHERE tenant_id = ?`, [tenantId]))!.n;
  return n;
};

describe("retention on the Worker's own stores", () => {
  it("erasing a person removes their name, e-mail and passkeys, and keeps every document and record", async () => {
    const t = await company("northwind");
    const u = (await c.req("POST", "/v1/users", { key: t.key, body: { display_name: "Accountant Person", email: "acc@example.test", role: "accountant" } })).json.id as string;
    const docsBefore = await c.env.blobs.list(`t/${t.id}/`);
    const before = await rows(t.id);
    expect((await c.req("POST", `/v1/users/${u}/erase`, { key: t.key })).status).toBe(200);
    expect(JSON.stringify((await c.req("GET", "/v1/export", { key: t.key })).json)).not.toMatch(/Accountant Person|acc@example\.test/);
    expect(await c.env.blobs.list(`t/${t.id}/`)).toEqual(docsBefore);
    expect(await rows(t.id)).toBe(before + 1); // the erasure's own record
  });

  it("a closed company is purged only after seven full years, documents and mail included, and no other company", async () => {
    const t = await company("northwind");
    const other = await company("other");
    expect((await c.env.blobs.list(`t/${t.id}/`)).length).toBeGreaterThanOrEqual(2); // a document and a mail
    expect((await c.req("POST", "/v1/close", { key: t.key })).json).toMatchObject({ purge_after: "2033-12-31" });
    expect(await purgeExpired(c.env.sql, c.env.blobs, new Date("2033-12-31T23:00:00Z"))).toEqual([]);
    expect(await rows(t.id)).toBeGreaterThan(0);
    expect(await purgeExpired(c.env.sql, c.env.blobs, new Date("2034-01-01T00:30:00Z"))).toEqual([t.id]);
    expect(await rows(t.id)).toBe(0);
    expect(await c.env.blobs.list(`t/${t.id}/`)).toEqual([]);
    expect(await rows(other.id)).toBeGreaterThan(0);
    expect((await c.env.blobs.list(`t/${other.id}/`)).length).toBeGreaterThanOrEqual(2);
    // A second run finds nothing more to do.
    expect(await purgeExpired(c.env.sql, c.env.blobs, new Date("2034-06-01T00:00:00Z"))).toEqual([]);
  });
});
