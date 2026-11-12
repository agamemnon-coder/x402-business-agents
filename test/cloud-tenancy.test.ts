// Purser Cloud keeps companies apart. Two companies push real data; with company A's owner key every route is tried
// against company B's objects: nothing of B is ever returned, changed or revoked (another company's object answers
// 404 exactly like a missing one), and B's data is untouched afterwards.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ROUTES } from "../cloud/src/app.js";
import { seedTreasury } from "../src/agents/euroBill.js";
import { ingestDocument } from "../src/ap/inbox.js";
import type { Asker } from "../src/ap/read.js";
import { pushToCloud } from "../src/cloudsync/client.js";
import { openDb } from "../src/db/open.js";
import { postEntry } from "../src/ledger/core.js";
import { EN, NL } from "./fakes/apInvoices.js";
import { FakeAirwallex } from "./fakes/airwallex.js";
import { pdfOf } from "./fakes/pdf.js";
import { testCloud, type TestCloud } from "./support/cloud.js";

const parserOnly: Asker = { ask: async (_a, fallback) => ({ value: fallback(), source: "fallback", model: null, note: "no key" }) } as Asker;
const NOW = new Date("2026-11-08T12:00:00Z");

let c: TestCloud;
let dir: string;
let A: { id: string; key: string; owner: string };
let B: { id: string; key: string; owner: string };
let bIds: Record<string, string>;
let bSnapshot: string;

async function company(text: string, key: string, sub: string) {
  const db = openDb(":memory:");
  const awx = new FakeAirwallex();
  await seedTreasury(db, awx, awx);
  await ingestDocument(db, { dir: join(dir, sub), reader: parserOnly, now: () => NOW }, { bytes: await pdfOf(text), filename: `${sub}.pdf`, source: "upload" });
  postEntry(db, { date: "2026-11-01", description: `${sub} sale`, created_by: "t", lines: [{ account: "1200", debit: 500, currency: "EUR" }, { account: "4000", credit: 500, currency: "EUR" }] }, NOW);
  await pushToCloud(db, { url: "https://cloud.test", key, fetch: c.fetch }, NOW);
}

const snapshot = async (tenantId: string) => {
  const tables = ["invoices", "vendors", "payments", "documents", "ledger_entries", "audit_rows", "users", "api_keys", "inbound_mail", "credentials"];
  const out: Record<string, unknown> = {};
  for (const t of tables) out[t] = await c.env.sql.all(`SELECT * FROM ${t} WHERE tenant_id = ? ORDER BY 1, 2`, [tenantId]);
  return JSON.stringify(out);
};

beforeAll(async () => {
  c = testCloud();
  dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "cloud-ten-"));
  A = await c.tenant("alpha");
  B = await c.tenant("bravo");
  await company(EN, A.key, "a");
  await company(NL, B.key, "b");
  // Both runners number their invoices AP-0001: ids are per company, so A's own AP-0001 is A's. Give B's a name A
  // does not have, so the probe below asks for B's object and only B's.
  await c.env.sql.run("UPDATE invoices SET id = 'AP-BRAVO-1' WHERE tenant_id = ?", [B.id]);
  const bInvoice = "AP-BRAVO-1";
  const bKey = (await c.req("POST", "/v1/keys", { key: B.key, body: { name: "bravo reader", scopes: ["read"] } })).json.id as string;
  await c.env.sql.run("INSERT INTO inbound_mail (tenant_id, id, blob_key, sha256, size, received_at, status) VALUES (?, 'm_bravo', 't/x/mail/y.eml', 'aa', 1, ?, 'queued')", [B.id, NOW.toISOString()]);
  bIds = { invoice: bInvoice, key: bKey, user: B.owner, mail: "m_bravo" };
  bSnapshot = await snapshot(B.id);
});
afterAll(() => { c.close(); rmSync(dir, { recursive: true, force: true }); });

describe("two companies", () => {
  it("each see only their own data in every list", async () => {
    for (const p of ["/v1/invoices", "/v1/vendors", "/v1/payments", "/v1/ledger/entries", "/v1/keys", "/v1/users", "/v1/mail"]) {
      const r = await c.req("GET", p, { key: A.key });
      expect(r.status, p).toBe(200);
      const text = JSON.stringify(r.json);
      expect(text, p).not.toContain(B.id);
      expect(text, p).not.toContain("Zeeland");
      expect(text, p).not.toContain("ZV-4471");
    }
    const exp = JSON.stringify((await c.req("GET", "/v1/export", { key: A.key })).json);
    expect(exp).not.toContain("Zeeland");
    expect(exp).not.toContain(B.id);
  });

  it("cannot read, change or revoke the other company's objects on any route that names one", async () => {
    // Every route that names an object ({id}); /v1/reports/{name} names a report, not an object. Platform admin routes
    // name a company and need the platform token, never a company's key (test/cloud-recovery.test.ts).
    const withId = ROUTES.filter((r) => r.path.includes("{id}") && r.need !== "platform");
    expect(withId.length).toBeGreaterThanOrEqual(6);
    for (const r of withId) {
      const id = r.path.includes("/keys/") ? bIds.key : r.path.includes("/users/") ? bIds.user : r.path.includes("/mail/") ? bIds.mail : bIds.invoice;
      const path = r.path.replace(/\{\w+\}/, id!);
      const res = await c.req(r.method, path, { key: A.key, ...(r.method === "POST" ? { body: r.path.endsWith("/done") ? { status: "done" } : {} } : {}) });
      expect([403, 404, 409], `${r.method} ${path}: ${res.status} ${JSON.stringify(res.json)}`).toContain(res.status);
      expect(JSON.stringify(res.json)).not.toContain("Zeeland");
    }
    // A report or the insight never mixes in the other company's ledger or invoices.
    const trial = JSON.stringify((await c.req("GET", "/v1/reports/trial", { key: A.key })).json);
    expect(trial).not.toContain(B.id);
  });

  it("leave the other company's data exactly as it was", async () => {
    expect(await snapshot(B.id)).toBe(bSnapshot);
    // And B's own key still reads B.
    const r = await c.req("GET", `/v1/invoices/${bIds.invoice!}`, { key: B.key });
    expect(r.status).toBe(200);
  });

  it("cannot push into the other company: a push lands in the caller's own company only", async () => {
    const before = await snapshot(B.id);
    const r = await c.req("POST", "/v1/sync", { key: A.key, body: { vendors: [{ id: "intruder", name: "Intruder", status: "active", updated_at: NOW.toISOString(), body: { tenant: B.id } }] } });
    expect(r.status).toBe(200);
    expect(await snapshot(B.id)).toBe(before);
    expect(await c.env.sql.first("SELECT tenant_id FROM vendors WHERE id = 'intruder'")).toEqual({ tenant_id: A.id });
  });
});
