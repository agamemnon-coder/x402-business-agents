// Purser Cloud's inbound e-mail (Cloudflare Email Routing → the Worker's email handler → stored and queued → the
// runner files it through the inbox), and privacy: export, erasure of a person, closing a company and the 7-year
// retention before anything is purged.
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { receiveEmail, slugOf, type InboundEmail } from "../cloud/src/mail.js";
import { purgeDay, purgeExpired } from "../cloud/src/privacy.js";
import { seedTreasury } from "../src/agents/euroBill.js";
import type { Asker } from "../src/ap/read.js";
import { apInvoices } from "../src/ap/store.js";
import { pullMail, pushToCloud } from "../src/cloudsync/client.js";
import { openDb, type DB } from "../src/db/open.js";
import { EN } from "./fakes/apInvoices.js";
import { FakeAirwallex } from "./fakes/airwallex.js";
import { emlWith, pdfOf } from "./fakes/pdf.js";
import { testCloud, type TestCloud } from "./support/cloud.js";

const parserOnly: Asker = { ask: async (_a, fallback) => ({ value: fallback(), source: "fallback", model: null, note: "no key" }) } as Asker;
const DOMAIN = "in.purser.test";

let c: TestCloud;
let t: { id: string; key: string; owner: string };
let dir: string;
let db: DB;
beforeEach(async () => {
  c = testCloud();
  t = await c.tenant("northwind");
  dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "cloud-mail-"));
  db = openDb(":memory:");
  const awx = new FakeAirwallex();
  await seedTreasury(db, awx, awx);
});
afterEach(() => { c.close(); rmSync(dir, { recursive: true, force: true }); });

function message(to: string, raw: Buffer): InboundEmail & { rejected: string | null } {
  const m = { from: "billing@bergtex.example", to, raw: new Uint8Array(raw), rawSize: raw.length, rejected: null as string | null, setReject(r: string) { m.rejected = r; } };
  return m;
}

describe("inbound e-mail", () => {
  it("maps an address to its company, plus-addressing included, and nothing else", () => {
    expect(slugOf("northwind@in.purser.test", DOMAIN)).toBe("northwind");
    expect(slugOf("Northwind+invoices@IN.PURSER.TEST", DOMAIN)).toBe("northwind");
    expect(slugOf("northwind@evil.test", DOMAIN)).toBeNull();
    expect(slugOf("../etc@in.purser.test", DOMAIN)).toBeNull();
  });

  it("is stored and queued once, the runner files its PDF through the inbox, and marks it done", async () => {
    const raw = emlWith(await pdfOf(EN), "BTX-2026-21.pdf");
    const m = message(`northwind@${DOMAIN}`, raw);
    expect(await receiveEmail(c.env.sql, c.env.blobs, m, { domain: DOMAIN, now: c.clock.now })).toMatchObject({ queued: true });
    expect(m.rejected).toBeNull();
    expect(await receiveEmail(c.env.sql, c.env.blobs, message(`northwind@${DOMAIN}`, raw), { domain: DOMAIN, now: c.clock.now })).toMatchObject({ queued: false, reason: "already received" });
    const queued = (await c.req("GET", "/v1/mail", { key: t.key })).json.items as { id: string }[];
    expect(queued).toHaveLength(1);

    const filed = await pullMail(db, { dir, reader: parserOnly, now: () => c.clock.now }, { url: "https://cloud.test", key: t.key, fetch: c.fetch });
    expect(filed).toEqual([{ id: queued[0]!.id, status: "done", note: "1 attachment(s) filed" }]);
    expect(apInvoices(db).map((i) => i.invoice_no)).toEqual(["BTX-2026-21"]);
    expect((await c.req("GET", "/v1/mail", { key: t.key })).json.items).toEqual([]);
    // And back up: the invoice the e-mail brought is in the cloud after the next push.
    await pushToCloud(db, { url: "https://cloud.test", key: t.key, fetch: c.fetch }, c.clock.now);
    expect(((await c.req("GET", "/v1/invoices", { key: t.key })).json.items as unknown[]).length).toBe(1);
  });

  it("refuses an unknown address, another domain, a closed company and a message too large", async () => {
    for (const to of [`nobody@${DOMAIN}`, "northwind@elsewhere.test"]) {
      const m = message(to, Buffer.from("Subject: x\r\n\r\nhi"));
      await receiveEmail(c.env.sql, c.env.blobs, m, { domain: DOMAIN, now: c.clock.now });
      expect(m.rejected, to).toBe("unknown address");
    }
    const big = { ...message(`northwind@${DOMAIN}`, Buffer.from("x")), rawSize: 30 * 1024 * 1024 };
    let reason = "";
    big.setReject = (r: string) => { reason = r; };
    await receiveEmail(c.env.sql, c.env.blobs, big, { domain: DOMAIN, now: c.clock.now });
    expect(reason).toMatch(/too large/);
    await c.req("POST", "/v1/close", { key: t.key });
    const m = message(`northwind@${DOMAIN}`, Buffer.from("Subject: x\r\n\r\nhi"));
    await receiveEmail(c.env.sql, c.env.blobs, m, { domain: DOMAIN, now: c.clock.now });
    expect(m.rejected).toBe("unknown address");
  });
});

describe("privacy and retention", () => {
  it("exports everything the company holds, documents included, and no secret, not even a key's hash", async () => {
    const raw = emlWith(await pdfOf(EN));
    await receiveEmail(c.env.sql, c.env.blobs, message(`northwind@${DOMAIN}`, raw), { domain: DOMAIN, now: c.clock.now });
    await pullMail(db, { dir, reader: parserOnly, now: () => c.clock.now }, { url: "https://cloud.test", key: t.key, fetch: c.fetch });
    await pushToCloud(db, { url: "https://cloud.test", key: t.key, fetch: c.fetch }, c.clock.now);
    const exp = (await c.req("GET", "/v1/export", { key: t.key })).json as Record<string, unknown[]>;
    expect(exp.invoices).toHaveLength(1);
    expect(exp.audit_rows!.length).toBeGreaterThan(0);
    expect(JSON.stringify(exp)).not.toMatch(/secret_sha256|token_sha256/);
    // The documents are listed, each fetched on its own (one response never has to hold them all).
    const docs = exp.documents_to_fetch as { sha256: string; path: string }[];
    expect(docs).toHaveLength(1);
    const got = await c.req("GET", docs[0]!.path, { key: t.key });
    expect(got.status).toBe(200);
    expect(createHash("sha256").update(Buffer.from(await got.res.arrayBuffer())).digest("hex")).toBe(docs[0]!.sha256);
  });

  it("erases a person's personal data but keeps the books; the last owner cannot be erased", async () => {
    const u = (await c.req("POST", "/v1/users", { key: t.key, body: { display_name: "Some Accountant", email: "acc@example.test", role: "accountant" } })).json.id as string;
    const r = await c.req("POST", `/v1/users/${u}/erase`, { key: t.key });
    expect(r.status).toBe(200);
    const row = await c.env.sql.first<{ display_name: string; email: string | null; erased_at: string | null }>("SELECT display_name, email, erased_at FROM users WHERE id = ?", [u]);
    expect(row).toMatchObject({ display_name: "[erased]", email: null });
    expect(row!.erased_at).toBeTruthy();
    expect(JSON.stringify((await c.req("GET", "/v1/export", { key: t.key })).json)).not.toContain("acc@example.test");
    const last = await c.req("POST", `/v1/users/${t.owner}/erase`, { key: t.key });
    expect(last.status).toBe(409);
    expect(last.json.error).toMatch(/last owner/);
  });

  it("closes a company: access ends at once, records stay until seven full years after the last one, then go", async () => {
    await pushToCloud(db, { url: "https://cloud.test", key: t.key, fetch: c.fetch }, c.clock.now);
    const closed = await c.req("POST", "/v1/close", { key: t.key });
    expect(closed.json).toMatchObject({ purge_after: purgeDay("2026-11-08") });
    expect(purgeDay("2026-11-08")).toBe("2033-12-31");
    expect((await c.req("GET", "/v1/invoices", { key: t.key })).status).toBe(401);
    const left = async () => (await c.env.sql.first<{ n: number }>("SELECT COUNT(*) AS n FROM audit_rows WHERE tenant_id = ?", [t.id]))!.n;
    const before = await left();
    expect(before).toBeGreaterThan(0);
    expect(await purgeExpired(c.env.sql, c.env.blobs, new Date("2033-12-31T12:00:00Z"))).toEqual([]);
    expect(await left()).toBe(before);
    expect(await purgeExpired(c.env.sql, c.env.blobs, new Date("2034-01-01T12:00:00Z"))).toEqual([t.id]);
    expect(await left()).toBe(0);
    expect(await c.env.blobs.list(`t/${t.id}/`)).toEqual([]);
    expect(await c.env.sql.first("SELECT name FROM tenants WHERE id = ?", [t.id])).toEqual({ name: "[purged]" });
  });
});
