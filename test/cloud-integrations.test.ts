// The console's "Koppelingen" card reads GET /v1/integrations: where the company's Moneybird link stands, from what the
// runner's ERP sync wrote into the audit log (and pushed to the cloud). Never connected until a live sync has run; a dry
// run writes nothing. Owners only, and never another company's.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { consolePage } from "../cloud/src/console.js";
import { pushToCloud } from "../src/cloudsync/client.js";
import { openDb, type DB } from "../src/db/open.js";
import { staticToken } from "../src/erp/auth.js";
import { MoneybirdConnector } from "../src/erp/moneybird.js";
import { syncAll } from "../src/erp/sync.js";
import { MESSAGES } from "../src/ui/i18n.js";
import { sampleInvoice, sampleVendor } from "./fakes/erp.js";
import { FakeMoneybird, TAX } from "./fakes/moneybird.js";
import { ORIGIN, RP, testCloud, type TestCloud } from "./support/cloud.js";

let c: TestCloud;
let db: DB;
let tenant: { id: string; key: string; owner: string; session: string };
const target = () => ({ url: "https://cloud.test", key: tenant.key, fetch: c.fetch });
const NOW = new Date("2026-11-08T12:00:00Z");

beforeEach(async () => { c = testCloud(); db = openDb(":memory:"); tenant = await c.tenant("northwind"); });
afterEach(() => c.close());

function moneybird(fake: FakeMoneybird) {
  return new MoneybirdConnector({ baseUrl: "https://moneybird.com/api/v2", administrationId: fake.admin, baseCurrency: "EUR", taxRates: { NL21: TAX[0]!.id, NL9: TAX[1]!.id }, glMap: {}, projects: {}, ignoreCostCentres: true }, fake.transport, staticToken(fake.token));
}

describe("GET /v1/integrations", () => {
  it("says Moneybird is not connected while nothing was sent to it", async () => {
    const r = await c.req("GET", "/v1/integrations", { key: tenant.key });
    expect(r.status).toBe(200);
    expect(r.json.connectors).toEqual([{ connector: "moneybird", status: "not_connected", last_sync_at: null, sent: 0, failed: 0, to_check: 0, last_error: null }]);
  });

  it("a dry run leaves it not connected: nothing was written", async () => {
    const fake = new FakeMoneybird();
    await syncAll(db, moneybird(fake), [{ kind: "vendor", object: sampleVendor() }], { dryRun: true, sleep: async () => {}, now: () => NOW });
    await pushToCloud(db, target(), NOW);
    const r = await c.req("GET", "/v1/integrations", { key: tenant.key });
    expect((r.json.connectors as { status: string }[])[0]!.status).toBe("not_connected");
  });

  it("is connected after a sync, with the moment and what was sent; a failure since then is counted and named", async () => {
    const fake = new FakeMoneybird();
    await syncAll(db, moneybird(fake), [{ kind: "vendor", object: sampleVendor() }, { kind: "invoice", object: sampleInvoice() }], { sleep: async () => {}, now: () => NOW });
    await pushToCloud(db, target(), NOW);
    let r = await c.req("GET", "/v1/integrations", { key: tenant.key });
    expect((r.json.connectors as unknown[])[0]).toEqual({ connector: "moneybird", status: "connected", last_sync_at: NOW.toISOString(), sent: 2, failed: 0, to_check: 0, last_error: null });

    const later = new Date("2026-11-09T08:30:00Z");
    const bad = { ...sampleInvoice(), id: "INV-2", number: "BT-2026-0043" };
    bad.lines = bad.lines.map((l, i) => (i === 1 ? { ...l, glAccount: "6123" } : l));
    await syncAll(db, moneybird(fake), [{ kind: "invoice", object: bad }], { sleep: async () => {}, now: () => later });
    await pushToCloud(db, target(), later);
    r = await c.req("GET", "/v1/integrations", { key: tenant.key });
    const m = (r.json.connectors as Record<string, unknown>[])[0]!;
    expect(m).toMatchObject({ status: "attention", last_sync_at: later.toISOString(), sent: 2, failed: 1, to_check: 0 });
    expect(m.last_error).toMatch(/6123/);
  });

  it("is for owners: a read-only key is refused", async () => {
    const k = await c.req("POST", "/v1/keys", { key: tenant.session, body: { name: "viewer", scopes: ["read"] } });
    expect(k.status).toBe(201);
    expect((await c.req("GET", "/v1/integrations", { key: k.json.api_key as string })).status).toBe(403);
  });

  it("shows only the company's own link", async () => {
    const other = await c.tenant("zeeland");
    const fake = new FakeMoneybird();
    await syncAll(db, moneybird(fake), [{ kind: "vendor", object: sampleVendor() }], { sleep: async () => {}, now: () => NOW });
    await pushToCloud(db, target(), NOW);
    const r = await c.req("GET", "/v1/integrations", { key: other.key });
    expect((r.json.connectors as { status: string }[])[0]!.status).toBe("not_connected");
  });
});

describe("the Koppelingen card", () => {
  it("is on the settings page, reads /v1/integrations and has its words in Dutch and English", () => {
    const html = consolePage("n", { origin: ORIGIN, rpId: RP, mailDomain: "" });
    expect(html).toContain("/v1/integrations");
    for (const k of ["cs.int.title", "cs.int.lede", "cs.int.moneybird", "cs.int.status.not_connected", "cs.int.status.connected", "cs.int.status.attention", "cs.int.last_sync", "cs.int.sent", "cs.int.failed", "cs.int.to_check", "cs.int.how"] as const) {
      expect(MESSAGES.nl[k], k).toBeTruthy();
      expect(MESSAGES.en[k], k).toBeTruthy();
    }
    expect(MESSAGES.nl["cs.int.title"]).toBe("Koppelingen");
  });
});
