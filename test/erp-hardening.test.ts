// The independent review of the ERP connectors (PR #109), finding by finding: nothing is sent twice after a crash or a
// rate limit in the middle of a push, a draft left for a person stays with that person, a correction never posts a
// second credit note, Odoo 17 payments use Odoo 17's field, two runs never lose Exact's rotated refresh token, and a
// Retry-After that asks for hours is not slept on.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openDb } from "../src/db/open.js";
import { exactTokens, fileTokenStore } from "../src/erp/auth.js";
import { BusinessCentralConnector, type BcConfig } from "../src/erp/businessCentral.js";
import { ErpError, RecordingTransport, type ErpConnector, type HttpRequest, type HttpResponse, type PushProgress, type RefResolver } from "../src/erp/connector.js";
import { ExactConnector, type ExactConfig } from "../src/erp/exact.js";
import type { JournalEntry, ObjectKind, Payment, PurchaseInvoice, Vendor } from "../src/erp/model.js";
import { OdooConnector, type OdooConfig } from "../src/erp/odoo.js";
import { correct, ensureErpSchema, MAX_RETRY_AFTER_MS, resolve, syncAll, syncStatus } from "../src/erp/sync.js";
import { decodeCallForTest, type XmlValue } from "../src/erp/xmlrpc.js";
import { staticToken } from "../src/erp/auth.js";
import { sampleInvoice, sampleJournal, samplePayment, sampleVendor } from "./fakes/erp.js";

const noSleep = async () => {};
const json = (o: unknown, status = 200): HttpResponse => ({ status, headers: {}, body: JSON.stringify(o) });
const rateLimited = (): HttpResponse => ({ status: 429, headers: { "retry-after": "1" }, body: "" });

// ---------------------------------------------------------------------------------------------------------------
// Business Central, routed by path.
const BC_BASE = "https://api.businesscentral.dynamics.com/v2.0/contoso.onmicrosoft.com/production/api/v2.0/companies(c0c0c0c0-0000-0000-0000-000000000001)";
const bcConfig: BcConfig = {
  tenant: "contoso.onmicrosoft.com", environment: "production", companyId: "c0c0c0c0-0000-0000-0000-000000000001", localCurrency: "EUR",
  generalJournalId: "j-gen", paymentJournalId: "j-pay",
  vatCodes: { NL21: "VAT21", NL9: "VAT9", NL0: "VAT0", EU_RC: "EUREV", NONEU_RC: "IMPREV", EXEMPT: "NOVAT", NONE: "" }, glMap: {}, postInvoices: true,
};
const bcPath = (r: HttpRequest) => decodeURIComponent(r.url.slice(BC_BASE.length));
function bc(route: (req: HttpRequest, p: string) => HttpResponse | undefined) {
  const tr = new RecordingTransport((req) => {
    const p = bcPath(req);
    const out = route(req, p);
    if (out) return out;
    throw new Error(`unexpected ${req.method} ${p}`);
  });
  return { tr, c: new BusinessCentralConnector(bcConfig, tr, staticToken("bc")) };
}
const posts = (tr: RecordingTransport, prefix: string) => tr.sent.filter((r) => r.method === "POST" && bcPath(r).startsWith(prefix)).length;

describe("1. a crash after the ERP accepted an object", () => {
  it("a row a crashed run left pending (attempts 0) makes the next run look first: nothing is posted twice", async () => {
    const db = openDb(":memory:");
    const calls: string[] = [];
    const c = minimalConnector({ find: async () => { calls.push("find"); return "ext-v-earlier"; }, push: async () => { calls.push("push"); return "ext-v-new"; } });
    ensureErpSchema(db);
    db.prepare("INSERT INTO erp_sync (connector, kind, object_id, status, attempts, updated_at) VALUES ('exact', 'vendor', 'V-1', 'pending', 0, '2026-11-08T00:00:00Z')").run();
    const res = await syncAll(db, c, [{ kind: "vendor", object: sampleVendor() }], { sleep: noSleep });
    expect(res[0]).toMatchObject({ outcome: "found_existing", externalId: "ext-v-earlier" });
    expect(calls).toEqual(["find"]);
  });

  it("a lookup that fails is retried as a lookup, never answered by sending the object blind", async () => {
    const db = openDb(":memory:");
    ensureErpSchema(db);
    db.prepare("INSERT INTO erp_sync (connector, kind, object_id, status, attempts, updated_at) VALUES ('exact', 'vendor', 'V-1', 'failed', 1, '2026-11-08T00:00:00Z')").run();
    const calls: string[] = [];
    let n = 0;
    const c = minimalConnector({
      find: async () => { calls.push("find"); if (++n <= 3) throw new ErpError("server", "502", { retryable: true, status: 502 }); return null; },
      push: async () => { calls.push("push"); return "x"; },
    });
    const res = await syncAll(db, c, [{ kind: "vendor", object: sampleVendor() }], { sleep: noSleep, maxAttempts: 3 });
    expect(res[0]!.outcome).toBe("failed");
    expect(calls).toEqual(["find", "find", "find"]);
  });
});

describe("2. a push made of several requests", () => {
  it("Business Central: a 429 on the second invoice line resumes with that line; no second header, no repeated first line", async () => {
    const db = openDb(":memory:");
    let lines = 0;
    const { tr, c } = bc((req, p) => {
      if (req.method === "POST" && p === "/vendors") return json({ id: "v-1" }, 201);
      if (req.method === "POST" && p === "/purchaseInvoices") return json({ id: "pi-1" }, 201);
      if (req.method === "POST" && p === "/purchaseInvoices(pi-1)/purchaseInvoiceLines") return ++lines === 2 ? rateLimited() : json({ id: `line-${lines}` }, 201);
      if (req.method === "POST" && p === "/attachments") return json({ id: "att-1" }, 201);
      if (req.method === "PATCH") return json({});
      if (req.method === "GET" && p.startsWith("/purchaseInvoices(pi-1)?")) return json({ totalAmountIncludingTax: 1428 });
      if (req.method === "POST" && p === "/purchaseInvoices(pi-1)/Microsoft.NAV.post") return { status: 204, headers: {}, body: "" };
      return undefined;
    });
    const res = await syncAll(db, c, [{ kind: "vendor", object: sampleVendor() }, { kind: "invoice", object: sampleInvoice() }], { sleep: noSleep });
    expect(res[1]).toMatchObject({ outcome: "pushed", externalId: "pi-1" });
    expect(posts(tr, "/purchaseInvoices")).toBe(1 + 3 + 1); // one header, lines 1, 2 (429), 2 again, and the post action
    expect(tr.sent.filter((r) => r.method === "POST" && bcPath(r) === "/purchaseInvoices")).toHaveLength(1);
    expect(tr.sent.filter((r) => r.method === "POST" && bcPath(r).endsWith("/purchaseInvoiceLines"))).toHaveLength(3);
    expect(syncStatus(db, "bc").find((r) => r.kind === "invoice")).toMatchObject({ status: "synced", progress_json: null });
  });

  it("Business Central: a 429 on the second journal line does not post the first line again", async () => {
    const db = openDb(":memory:");
    let n = 0;
    const { tr, c } = bc((req, p) => (req.method === "POST" && p === "/journals(j-gen)/journalLines" ? (++n === 2 ? rateLimited() : json({ id: `jl-${n}` }, 201)) : undefined));
    const res = await syncAll(db, c, [{ kind: "journal", object: sampleJournal() }], { sleep: noSleep });
    expect(res[0]!.outcome).toBe("pushed");
    expect(tr.sent.filter((r) => r.method === "POST")).toHaveLength(sampleJournal().lines.length + 1);
  });

  it("Exact: a 429 on the bank account does not create a second supplier", async () => {
    const db = openDb(":memory:");
    let banks = 0;
    const tr = new RecordingTransport((req) => {
      if (req.url.endsWith("/crm/Accounts")) return json({ d: { ID: "11111111-2222-3333-4444-555555555555" } }, 201);
      if (req.url.endsWith("/crm/BankAccounts")) return ++banks === 1 ? rateLimited() : json({ d: { ID: "bank-1" } }, 201);
      throw new Error(`unexpected ${req.method} ${req.url}`);
    });
    const c = new ExactConnector(exactConfig, tr, staticToken("tok"));
    const res = await syncAll(db, c, [{ kind: "vendor", object: sampleVendor() }], { sleep: noSleep });
    expect(res[0]!.outcome).toBe("pushed");
    expect(tr.sent.filter((r) => r.url.endsWith("/crm/Accounts"))).toHaveLength(1);
    expect(tr.sent.filter((r) => r.url.endsWith("/crm/BankAccounts"))).toHaveLength(2);
  });

  it("an answer lost on the header: the header found but its lines missing goes to a person, never 'synced'", async () => {
    const db = openDb(":memory:");
    ensureErpSchema(db);
    db.prepare("INSERT INTO erp_sync (connector, kind, object_id, external_id, status, attempts, updated_at) VALUES ('bc', 'vendor', 'V-1', 'v-1', 'synced', 1, '2026-11-08T00:00:00Z')").run();
    db.prepare("UPDATE erp_sync SET pushed_hash = 'x', pushed_json = '{}'").run();
    let header = false;
    const { c } = bc((req, p) => {
      if (req.method === "POST" && p === "/purchaseInvoices") { header = true; return { status: 504, headers: {}, body: "" }; }
      if (req.method === "GET" && p.startsWith("/purchaseInvoices?")) return json({ value: header ? [{ id: "pi-lost" }] : [] });
      if (req.method === "GET" && p.startsWith("/purchaseInvoices(pi-lost)/purchaseInvoiceLines")) return json({ value: [] });
      return undefined;
    });
    const res = await syncAll(db, c, [{ kind: "invoice", object: sampleInvoice() }], { sleep: noSleep });
    expect(res[0]).toMatchObject({ outcome: "needs_review", externalId: "pi-lost" });
    expect(res[0]!.detail).toMatch(/lines/);
    expect(syncStatus(db, "bc").find((r) => r.kind === "invoice")!.status).toBe("needs_review");
  });
});

describe("3. a draft left for a person", () => {
  it("stays with the person: later runs neither mark it synced nor send it again, its payment waits, and a person resolves it", async () => {
    const db = openDb(":memory:");
    const { tr, c } = bc((req, p) => {
      if (req.method === "POST" && p === "/vendors") return json({ id: "v-1" }, 201);
      if (req.method === "POST" && p === "/purchaseInvoices") return json({ id: "pi-2" }, 201);
      if (req.method === "POST" && p.endsWith("/purchaseInvoiceLines")) return json({ id: "l" }, 201);
      if (req.method === "POST" && p === "/attachments") return json({ id: "att-1" }, 201);
      if (req.method === "PATCH") return json({});
      if (req.method === "GET" && p.startsWith("/purchaseInvoices(pi-2)?")) return json({ totalAmountIncludingTax: 1500 });
      if (req.method === "GET" && p.startsWith("/purchaseInvoices?")) return json({ value: [{ id: "pi-2" }] });
      if (req.method === "POST" && p === "/vendorPayments") return json({ id: "pay-1" }, 201);
      return undefined;
    });
    const items = [{ kind: "vendor" as const, object: sampleVendor() }, { kind: "invoice" as const, object: sampleInvoice() }, { kind: "payment" as const, object: samplePayment() }];
    const first = await syncAll(db, c, items, { sleep: noSleep });
    expect(first.map((r) => `${r.kind}:${r.outcome}`)).toEqual(["vendor:pushed", "invoice:needs_review", "payment:waiting"]);
    expect(first[1]).toMatchObject({ externalId: "pi-2" });
    const sentBefore = tr.sent.length;
    const second = await syncAll(db, c, items, { sleep: noSleep });
    expect(second.map((r) => `${r.kind}:${r.outcome}`)).toEqual(["vendor:unchanged", "invoice:needs_review", "payment:waiting"]);
    expect(tr.sent.length).toBe(sentBefore); // nothing sent, nothing looked up
    // A person fixed the tax codes and posted it in Business Central.
    resolve(db, "bc", "invoice", sampleInvoice().id, "synced", "accountant");
    const third = await syncAll(db, c, items, { sleep: noSleep });
    expect(third.map((r) => `${r.kind}:${r.outcome}`)).toEqual(["vendor:unchanged", "invoice:unchanged", "payment:pushed"]);
    const ev = db.prepare("SELECT payload_json FROM audit_log WHERE event = 'erp.resolved'").get() as { payload_json: string };
    expect(JSON.parse(ev.payload_json)).toMatchObject({ by: "accountant", as: "synced", external_id: "pi-2" });
  });
});

describe("4. a correction", () => {
  it("posts the credit note once, even when the replacement fails and the correction is run again", async () => {
    const db = openDb(":memory:");
    const sent: string[] = [];
    let failNext = true;
    let n = 0;
    const c = minimalConnector({
      find: async () => null,
      push: async () => `ext-${++n}`,
      invoice: async () => { sent.push("invoice"); if (sent.filter((x) => x === "invoice").length === 2 && failNext) { failNext = false; throw new ErpError("conflict", "vendor invoice number exists", { status: 409 }); } return `ext-i-${++n}`; },
      credit: async () => { sent.push("credit"); return `ext-c-${++n}`; },
    });
    await syncAll(db, c, [{ kind: "vendor", object: sampleVendor() }, { kind: "invoice", object: sampleInvoice() }], { sleep: noSleep });
    const changed = sampleInvoice();
    changed.lines[0]!.netCents += 1000;
    changed.lines[0]!.vatCents += 210;
    changed.totals = { netCents: changed.totals.netCents + 1000, vatCents: changed.totals.vatCents + 210, grossCents: changed.totals.grossCents + 1210 };
    await syncAll(db, c, [{ kind: "invoice", object: changed }], { sleep: noSleep });
    await expect(correct(db, c, { kind: "invoice", object: changed })).rejects.toThrow(/exists/);
    const fixed = await correct(db, c, { kind: "invoice", object: changed });
    expect(fixed.outcome).toBe("corrected");
    expect(sent.filter((x) => x === "credit")).toHaveLength(1);
  });
});

describe("4b. a correction whose answer never came", () => {
  const changedInvoice = () => {
    const changed = sampleInvoice();
    changed.lines[0]!.netCents += 1000;
    changed.lines[0]!.vatCents += 210;
    changed.totals = { netCents: changed.totals.netCents + 1000, vatCents: changed.totals.vatCents + 210, grossCents: changed.totals.grossCents + 1210 };
    return changed;
  };

  it("a lost credit note goes to a person, is not sent again until they say it is not in the ERP, then the correction finishes", async () => {
    const db = openDb(":memory:");
    const sent: string[] = [];
    let n = 0;
    let dropCredit = true;
    const c = minimalConnector({
      find: async () => null,
      push: async () => `ext-${++n}`,
      invoice: async () => { sent.push("invoice"); return `ext-i-${++n}`; },
      credit: async () => { sent.push("credit"); if (dropCredit) { dropCredit = false; throw new ErpError("network", "the connection dropped", { retryable: true }); } return `ext-c-${++n}`; },
    });
    await syncAll(db, c, [{ kind: "vendor", object: sampleVendor() }, { kind: "invoice", object: sampleInvoice() }], { sleep: noSleep });
    const changed = changedInvoice();
    await syncAll(db, c, [{ kind: "invoice", object: changed }], { sleep: noSleep });
    const parked = await correct(db, c, { kind: "invoice", object: changed });
    expect(parked).toMatchObject({ outcome: "needs_review", detail: expect.stringMatching(/no answer came to the credit note/) as string });
    expect(syncStatus(db, "exact").find((r) => r.kind === "invoice")).toMatchObject({ status: "needs_review", external_id: expect.stringMatching(/^ext-i-/) as string });
    await expect(correct(db, c, { kind: "invoice", object: changed })).rejects.toThrow(/may or may not hold it/);
    expect(sent).toEqual(["invoice", "credit"]);
    // "synced" needs the id the person found; "retry" says it is not there.
    expect(() => resolve(db, "exact", "invoice", changed.id, "synced", "accountant")).toThrow(/--external-id/);
    expect(resolve(db, "exact", "invoice", changed.id, "retry", "accountant").status).toBe("needs_correction");
    const fixed = await correct(db, c, { kind: "invoice", object: changed });
    expect(fixed.outcome).toBe("corrected");
    expect(sent).toEqual(["invoice", "credit", "credit", "invoice"]);
  });

  it("a lost reversal the person finds in the ERP is never posted again: the correction goes on with the new entry", async () => {
    const db = openDb(":memory:");
    const sent: string[] = [];
    let n = 0;
    const c = minimalConnector({ find: async () => null, push: async () => { sent.push("journal"); if (sent.length === 2) throw new ErpError("server", "502 from the gateway", { status: 502, retryable: true }); return `ext-j-${++n}`; } });
    await syncAll(db, c, [{ kind: "journal", object: sampleJournal() }], { sleep: noSleep });
    const changed = sampleJournal();
    changed.memo = `${changed.memo} (moved)`;
    await syncAll(db, c, [{ kind: "journal", object: changed }], { sleep: noSleep });
    expect(await correct(db, c, { kind: "journal", object: changed })).toMatchObject({ outcome: "needs_review" });
    resolve(db, "exact", "journal", changed.id, "synced", "accountant", undefined, "ext-j-found");
    const fixed = await correct(db, c, { kind: "journal", object: changed });
    expect(fixed).toMatchObject({ outcome: "corrected" });
    expect(sent).toHaveLength(3);
    const ev = JSON.parse((db.prepare("SELECT payload_json FROM audit_log WHERE event = 'erp.corrected'").get() as { payload_json: string }).payload_json) as Record<string, unknown>;
    expect(ev).toMatchObject({ credit_note: "ext-j-found", external_id: fixed.externalId });
  });
});

describe("5. Odoo 17 and 18 payments", () => {
  const odooConfig: OdooConfig = {
    url: "https://acme.odoo.com", db: "acme", login: "purser@example.com", apiKey: "k", companyCurrency: "EUR",
    purchaseJournalId: 2, bankJournalIds: { "1200": 6 }, generalJournalId: 3, taxIds: { NL21: 21, NL9: 9, NL0: 0, EU_RC: 31, NONEU_RC: 32, EXEMPT: 0, NONE: 0 }, glMap: {}, post: false,
  };
  const xml = (v: string): HttpResponse => ({ status: 200, headers: {}, body: `<?xml version='1.0'?><methodResponse><params><param><value>${v}</value></param></params></methodResponse>` });
  function odoo(major: number) {
    const calls: { model: string; method: string; args: XmlValue[] }[] = [];
    const tr = new RecordingTransport((req) => {
      const call = decodeCallForTest(req.body as string);
      if (req.url.endsWith("/xmlrpc/2/common")) {
        if (call.method === "version") return xml(`<struct><member><name>server_version</name><value><string>${major}.0</string></value></member><member><name>server_version_info</name><value><array><data><value><int>${major}</int></value><value><int>0</int></value></data></array></value></member></struct>`);
        return xml("<int>2</int>");
      }
      const [, , , model, method, args] = call.params as [string, number, string, string, string, XmlValue[]];
      calls.push({ model, method, args });
      if (model === "res.currency") return xml("<array><data><value><int>1</int></value></data></array>");
      if (method === "search") return xml("<array><data></data></array>");
      return xml("<int>55</int>");
    });
    return { calls, c: new OdooConnector(odooConfig, tr) };
  }
  const refs = { vendor: () => "41", invoice: () => "77" };
  it("Odoo 17: the payment's reference goes in ref (memo exists only from 18.0), and it is found by ref", async () => {
    const { calls, c } = odoo(17);
    await c.pushPayment(samplePayment(), refs);
    const created = calls.find((x) => x.model === "account.payment" && x.method === "create")!.args[0] as Record<string, unknown>;
    expect(created.ref).toBe("Purser payment PAY-1");
    expect(created).not.toHaveProperty("memo");
    await c.findExisting("payment", samplePayment(), refs);
    expect(JSON.stringify(calls.find((x) => x.model === "account.payment" && x.method === "search")!.args)).toContain('"ref"');
  });
  it("Odoo 18: memo, as before", async () => {
    const { calls, c } = odoo(18);
    await c.pushPayment(samplePayment(), refs);
    const created = calls.find((x) => x.model === "account.payment" && x.method === "create")!.args[0] as Record<string, unknown>;
    expect(created.memo).toBe("Purser payment PAY-1");
    expect(created).not.toHaveProperty("ref");
  });
});

describe("6. Exact's token file", () => {
  const answer = (n: number) => ({ status: 200, headers: {}, body: JSON.stringify({ access_token: `access-${n}`, expires_in: "600", refresh_token: `refresh-${n}` }) });
  const dir = () => mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "erp-lock-"));

  it("two runs refreshing at once refresh once, and both use the same new token (the rotated refresh token is never lost)", async () => {
    const path = join(dir(), "exact.token.json");
    fileTokenStore(path).save({ refresh_token: "RT0" });
    let sent = 0;
    // The token endpoint answers slowly, so both runs are inside their refresh at the same time.
    const slow = { send: async (req: HttpRequest) => { sent++; const used = /refresh_token=([^&]+)/.exec(req.body as string)![1]; if (used !== "RT0") return { status: 400, headers: {}, body: JSON.stringify({ error: "invalid_grant" }) }; await new Promise((r) => setTimeout(r, 50)); return answer(sent); } };
    const a = exactTokens({ baseUrl: "https://start.exactonline.nl", clientId: "c", clientSecret: "s", store: fileTokenStore(path), transport: slow });
    const b = exactTokens({ baseUrl: "https://start.exactonline.nl", clientId: "c", clientSecret: "s", store: fileTokenStore(path), transport: slow });
    const [ta, tb] = await Promise.all([a.token(), b.token()]);
    expect(sent).toBe(1);
    expect(ta).toBe(tb);
    expect(fileTokenStore(path).load()!.refresh_token).toBe("refresh-1");
  });

  it("after a 401, invalidate never writes an old refresh token back over a newer one", async () => {
    const path = join(dir(), "exact.token.json");
    fileTokenStore(path).save({ access_token: "A0", expires_at: Date.now() + 500_000, refresh_token: "RT0" });
    const a = exactTokens({ baseUrl: "https://start.exactonline.nl", clientId: "c", clientSecret: "s", store: fileTokenStore(path), transport: new RecordingTransport(() => answer(9)) });
    await a.token();
    // Another run rotates meanwhile.
    fileTokenStore(path).save({ access_token: "A1", expires_at: Date.now() + 500_000, refresh_token: "RT1" });
    a.invalidate();
    expect(fileTokenStore(path).load()!.refresh_token).toBe("RT1");
  });

  it("a cut-off token file is a clear error that says to authorise Exact again", async () => {
    const path = join(dir(), "exact.token.json");
    writeFileSync(path, '{"refresh_token":"RT', { mode: 0o600 });
    const t = exactTokens({ baseUrl: "https://start.exactonline.nl", clientId: "c", clientSecret: "s", store: fileTokenStore(path), transport: new RecordingTransport(() => answer(1)) });
    const e = await t.token().catch((x: unknown) => x as ErpError);
    expect(e).toBeInstanceOf(ErpError);
    expect((e as ErpError).message).toMatch(/authorise Exact Online again/);
  });
});

describe("7. smaller points", () => {
  it("Business Central: pricesIncludeTax (read-only in API v2.0) is not sent when creating an invoice or a credit memo", async () => {
    const { tr, c } = bc((req, p) => {
      if (req.method === "POST" && (p === "/purchaseInvoices" || p === "/purchaseCreditMemos")) return json({ id: "h-1" }, 201);
      if (req.method === "POST") return json({ id: "x" }, 201);
      if (req.method === "PATCH") return json({});
      if (req.method === "GET") return json({ totalAmountIncludingTax: 1428 });
      return undefined;
    });
    const refs = { vendor: () => "v-1", invoice: () => "pi-1" };
    await c.pushPurchaseInvoice(sampleInvoice(), refs);
    await c.pushCreditNote({ ...sampleInvoice(), pdf: undefined }, "pi-1", refs);
    for (const r of tr.sent.filter((x) => x.method === "POST" && /^\/purchase(Invoices|CreditMemos)$/.test(bcPath(x)))) expect(JSON.parse(r.body as string)).not.toHaveProperty("pricesIncludeTax");
  });

  it("a Retry-After longer than the cap is not slept on: the push fails, saying so", async () => {
    const db = openDb(":memory:");
    const slept: number[] = [];
    const c = minimalConnector({ find: async () => null, push: async () => { throw new ErpError("rate_limited", "429", { retryable: true, retryAfterMs: 86_400_000, status: 429 }); } });
    const res = await syncAll(db, c, [{ kind: "vendor", object: sampleVendor() }], { sleep: async (ms) => { slept.push(ms); } });
    expect(res[0]!.outcome).toBe("failed");
    expect(res[0]!.detail).toMatch(/86400 s/);
    expect(slept).toEqual([]);
    expect(MAX_RETRY_AFTER_MS).toBe(120_000);
  });
});

// ---------------------------------------------------------------------------------------------------------------
const exactConfig: ExactConfig = {
  baseUrl: "https://start.exactonline.nl", division: 123456, purchaseJournal: "60", bankJournals: { "1200": "20" }, generalJournal: "90",
  vatCodes: { NL21: "2", NL9: "1", NL0: "0", EU_RC: "6", NONEU_RC: "7", EXEMPT: "0", NONE: "0" }, glMap: {}, apAccount: "1600", documentType: 20, paymentSign: -1,
};

/** A connector whose every push is `push` (or the given override), and whose lookup is `find`. */
function minimalConnector(o: {
  find: (kind: ObjectKind) => Promise<string | null>;
  push: () => Promise<string>;
  invoice?: () => Promise<string>;
  credit?: () => Promise<string>;
}): ErpConnector {
  return {
    name: "exact",
    async pullChartOfAccounts() { return []; },
    async pullVendors() { return []; },
    findExisting: (kind: ObjectKind, _o: Vendor | PurchaseInvoice | Payment | JournalEntry, _r: RefResolver) => o.find(kind),
    pushVendor: (_v: Vendor, _p?: PushProgress) => o.push(),
    pushPurchaseInvoice: () => (o.invoice ?? o.push)(),
    pushCreditNote: () => (o.credit ?? o.push)(),
    pushPayment: () => o.push(),
    pushJournalEntry: () => o.push(),
    async pullPaymentStatus() { return "unknown"; },
  };
}
