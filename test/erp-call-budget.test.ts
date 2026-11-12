// The ERP call budget of a live run (src/erp/callBudget.ts; Moneybird sandbox, 12 November): the owner approves a
// number of requests, every request is written to one log before it is sent (a retry and a lookup too), the request
// that would go over is never sent, and a run that reaches the number stops instead of marking everything failed.
// No network: the stand-in Moneybird administration answers (test/fakes/moneybird.ts).
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { openDb } from "../src/db/open.js";
import { staticToken } from "../src/erp/auth.js";
import { budgetedTransport, callsByEndpoint, endpointOf, ErpBudgetSpent, liveRefusals, liveTransport, readCallLog } from "../src/erp/callBudget.js";
import { ErpError, RecordingTransport, type Transport } from "../src/erp/connector.js";
import { MoneybirdConnector, type MoneybirdConfig } from "../src/erp/moneybird.js";
import { syncAll, syncStatus, type SyncItem } from "../src/erp/sync.js";
import { sampleInvoice, sampleJournal, samplePayment, sampleVendor } from "./fakes/erp.js";
import { FakeMoneybird, TAX } from "./fakes/moneybird.js";
import { LIVE_KEYS } from "./support/noNetwork.js";

const noSleep = async () => {};
const made: string[] = [];
const tmp = () => { const dir = mkdtempSync(join(tmpdir(), "erp-budget-")); made.push(dir); return dir; };
afterAll(() => { for (const dir of made) rmSync(dir, { recursive: true, force: true }); });
const REPO = resolve(import.meta.dirname, "..");

function moneybird(fake: FakeMoneybird, transport: Transport, token = fake.token) {
  const cfg: MoneybirdConfig = { baseUrl: "https://moneybird.com/api/v2", administrationId: fake.admin, baseCurrency: "EUR", taxRates: { NL21: TAX[0]!.id, NL9: TAX[1]!.id, NL0: TAX[2]!.id }, glMap: {}, projects: {}, ignoreCostCentres: true };
  return new MoneybirdConnector(cfg, transport, staticToken(token));
}
const all = (): SyncItem[] => [
  { kind: "vendor", object: sampleVendor() }, { kind: "invoice", object: sampleInvoice() },
  { kind: "payment", object: samplePayment() }, { kind: "journal", object: sampleJournal() },
];

describe("the ERP call budget", () => {
  it("names an endpoint by its host and path, without object ids or the query", () => {
    expect(endpointOf("https://moneybird.com/api/v2/503585935808530148/documents/purchase_invoices/503585935808530999/payments.json?x=1")).toBe("moneybird.com/api/v2/{id}/documents/purchase_invoices/{id}/payments.json");
    expect(endpointOf("https://moneybird.com/api/v2/503585935808530148/contacts.json?per_page=100&page=2")).toBe("moneybird.com/api/v2/{id}/contacts.json");
    expect(endpointOf("https://start.exactonline.nl/api/v1/1000000/crm/Accounts(guid'3f2504e0-4f89-11d3-9a0c-0305e82c3301')?$select=ID")).toBe("start.exactonline.nl/api/v1/{id}/crm/Accounts(guid'{id}')");
    expect(endpointOf("https://api.businesscentral.dynamics.com/v2.0/contoso.onmicrosoft.com/production/api/v2.0/companies(c0c0c0c0-0000-0000-0000-000000000001)/vendors")).toBe("api.businesscentral.dynamics.com/v2.0/contoso.onmicrosoft.com/production/api/v2.0/companies({id})/vendors");
    expect(endpointOf("https://example.odoo.com/xmlrpc/2/object")).toBe("example.odoo.com/xmlrpc/2/object");
  });

  it("writes every request to the log before it is sent, as {at, method, endpoint}, and never sends the one over the budget", async () => {
    const file = join(tmp(), "calls.jsonl");
    const fake = new FakeMoneybird();
    const seenAtSend: number[] = [];
    // The stand-in looks at the log the moment a request reaches it: the line is already there.
    const inner: Transport = { send: (req) => { seenAtSend.push(readCallLog(file).length); return fake.transport.send(req); } };
    const c = moneybird(fake, budgetedTransport(inner, { budget: 3, file, now: () => new Date("2026-11-12T10:00:00.000Z") }));
    await c.pullChartOfAccounts();
    await c.pullVendors();
    await c.pullTaxRates();
    expect(seenAtSend).toEqual([1, 2, 3]);
    const refused = await c.pushVendor(sampleVendor()).catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(ErpBudgetSpent);
    expect((refused as Error).message).toMatch(/budget of 3 is spent.*POST moneybird\.com\/api\/v2\/\{id\}\/contacts\.json was not sent/);
    // Not sent: the administration never saw it, and a refused request is not one whose answer was lost.
    expect(fake.transport.sent).toHaveLength(3);
    expect(fake.contacts.size).toBe(0);
    expect(refused).not.toBeInstanceOf(ErpError);
    expect(readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l) as unknown)).toEqual([
      { at: "2026-11-12T10:00:00.000Z", method: "GET", endpoint: "moneybird.com/api/v2/{id}/ledger_accounts.json" },
      { at: "2026-11-12T10:00:00.000Z", method: "GET", endpoint: "moneybird.com/api/v2/{id}/contacts.json" },
      { at: "2026-11-12T10:00:00.000Z", method: "GET", endpoint: "moneybird.com/api/v2/{id}/tax_rates.json" },
    ]);
    expect(callsByEndpoint(readCallLog(file))).toEqual([
      { endpoint: "GET moneybird.com/api/v2/{id}/ledger_accounts.json", calls: 1 }, { endpoint: "GET moneybird.com/api/v2/{id}/contacts.json", calls: 1 }, { endpoint: "GET moneybird.com/api/v2/{id}/tax_rates.json", calls: 1 },
    ]);
    // Nothing secret in the log: no token, no body, no query.
    expect(readFileSync(file, "utf8")).not.toMatch(/test-token|Bearer|per_page|authorization/i);
  });

  it("counts a retry and a lookup like any other request", async () => {
    const file = join(tmp(), "calls.jsonl");
    const fake = new FakeMoneybird();
    // A revoked token: the connector tries once more with a fresh one. Both requests left this machine, both count.
    const revoked = moneybird(fake, budgetedTransport(fake.transport, { budget: 10, file }), "revoked");
    await expect(revoked.pullChartOfAccounts()).rejects.toThrow(/HTTP 401/);
    expect(readCallLog(file)).toHaveLength(2);
    // A lookup (is this supplier already there?) counts too.
    const c = moneybird(fake, budgetedTransport(fake.transport, { budget: 10, file }));
    expect(await c.findExisting("vendor", sampleVendor(), { vendor: () => null, invoice: () => null })).toBeNull();
    expect(readCallLog(file).map((l) => `${l.method} ${l.endpoint}`)).toEqual([
      "GET moneybird.com/api/v2/{id}/ledger_accounts.json", "GET moneybird.com/api/v2/{id}/ledger_accounts.json", "GET moneybird.com/api/v2/{id}/contacts/customer_id/PURSER-V-1.json",
    ]);
  });

  it("is one count for every process of the run: the log on disk is the count", async () => {
    const file = join(tmp(), "calls.jsonl");
    const fake = new FakeMoneybird();
    const a = moneybird(fake, budgetedTransport(fake.transport, { budget: 2, file }));
    const b = moneybird(fake, budgetedTransport(fake.transport, { budget: 2, file }));
    await a.pullChartOfAccounts();
    await b.pullChartOfAccounts();
    await expect(a.pullChartOfAccounts()).rejects.toBeInstanceOf(ErpBudgetSpent);
    await expect(b.pullChartOfAccounts()).rejects.toBeInstanceOf(ErpBudgetSpent);
    expect(fake.transport.sent).toHaveLength(2);
  });

  it("lets a connector name its own endpoints in the log", async () => {
    const file = join(tmp(), "calls.jsonl");
    const t = budgetedTransport(new RecordingTransport(() => ({ status: 200, headers: {}, body: "[]" })), { budget: 1, file, endpoint: (req) => `named ${new URL(req.url).pathname}` });
    await t.send({ method: "GET", url: "https://moneybird.com/api/v2/1/tax_rates.json", headers: {} });
    expect(readCallLog(file)[0]!.endpoint).toBe("named /api/v2/1/tax_rates.json");
  });

  it("refuses a budget that is not a whole number, and sends nothing when the log cannot be read or written", async () => {
    const dir = tmp();
    const inner = new RecordingTransport(() => ({ status: 200, headers: {}, body: "[]" }));
    expect(() => budgetedTransport(inner, { budget: 1.5, file: join(dir, "x.jsonl") })).toThrow(/not a call budget/);
    expect(() => budgetedTransport(inner, { budget: -1, file: join(dir, "x.jsonl") })).toThrow(/not a call budget/);
    const req = { method: "GET" as const, url: "https://moneybird.com/api/v2/1/tax_rates.json", headers: {} };
    await expect(budgetedTransport(inner, { budget: 5, file: join(dir, "no-such-folder", "calls.jsonl") }).send(req)).rejects.toThrow(/ENOENT/);
    writeFileSync(join(dir, "broken.jsonl"), "not json\n");
    await expect(budgetedTransport(inner, { budget: 5, file: join(dir, "broken.jsonl") }).send(req)).rejects.toThrow();
    expect(inner.sent).toHaveLength(0);
  });
});

describe("a live ERP run", () => {
  const good = () => ({ ERP_LIVE_GO: "yes", ERP_CALL_BUDGET: "6", ERP_CALL_LOG: join(tmp(), "calls.jsonl") });

  it("needs the owner's go, a call budget and a call log outside the repository, all three", () => {
    expect(liveRefusals(good())).toEqual([]);
    expect(liveRefusals({})).toEqual([
      "ERP_LIVE_GO=yes (the owner's go for this run)",
      "ERP_CALL_BUDGET (the approved number of requests, a whole number)",
      "ERP_CALL_LOG (a file outside the repository that counts them)",
    ]);
    expect(liveRefusals({ ...good(), ERP_LIVE_GO: "true" })).toEqual(["ERP_LIVE_GO=yes (the owner's go for this run)"]);
    expect(liveRefusals({ ...good(), ERP_CALL_BUDGET: "many" })).toEqual(["ERP_CALL_BUDGET (the approved number of requests, a whole number)"]);
    expect(liveRefusals({ ...good(), ERP_CALL_BUDGET: "4.5" })).toHaveLength(1);
  });

  it("refuses a call log inside the repository (run data is never committed), but not a folder beside it", () => {
    expect(liveRefusals({ ...good(), ERP_CALL_LOG: join(REPO, "data", "calls.jsonl") })).toEqual(["ERP_CALL_LOG (a file outside the repository that counts them)"]);
    expect(liveRefusals({ ...good(), ERP_CALL_LOG: "calls.jsonl" }, REPO)).toHaveLength(1);
    // A sibling folder whose name starts with the repository's is outside it.
    expect(liveRefusals({ ...good(), ERP_CALL_LOG: `${REPO}-keys/moneybird-1/calls.jsonl` })).toEqual([]);
  });

  it("builds no transport without them: nothing is called, and the message names what is missing, never a value", () => {
    const inner = new RecordingTransport(() => ({ status: 200, headers: {}, body: "[]" }));
    expect(() => liveTransport({ ERP_CALL_BUDGET: "6" }, inner)).toThrow(/ERP_LIVE_GO=yes.*ERP_CALL_LOG.*nothing was called/);
    const env = good();
    const t = liveTransport(env, inner);
    expect(existsSync(env.ERP_CALL_LOG)).toBe(false);
    expect(t).not.toBe(inner);
    expect(inner.sent).toHaveLength(0);
  });

  it("is never switched on by the test suite's own environment", () => {
    for (const k of ["ERP_LIVE_GO", "ERP_CALL_BUDGET", "ERP_CALL_LOG"]) {
      expect(LIVE_KEYS).toContain(k);
      expect(process.env[k], k).toBeUndefined();
    }
  });
});

describe("a sync that reaches the call budget", () => {
  it("stops: the object it was sending fails with the reason, the rest is not tried, and a later run finishes without sending anything twice", async () => {
    const file = join(tmp(), "calls.jsonl");
    const fake = new FakeMoneybird();
    const db = openDb(":memory:");
    // 4 requests: the supplier, the tax rates, the ledger accounts, the invoice. The PDF would be the fifth.
    const first = await syncAll(db, moneybird(fake, budgetedTransport(fake.transport, { budget: 4, file })), all(), { sleep: noSleep });
    expect(first.map((r) => [r.kind, r.outcome])).toEqual([["vendor", "pushed"], ["invoice", "failed"], ["payment", "waiting"], ["journal", "waiting"]]);
    expect(first[1]!.detail).toMatch(/call budget of 4 is spent.*attachments\.json was not sent/);
    // The payment waits for its invoice, as always; the journal entry, which waits for nothing, is simply not tried.
    expect(first[2]!.detail).toMatch(/invoice INV-1 is not in the ERP yet/);
    expect(first[3]!.detail).toMatch(/not tried.*call budget/);
    expect(fake.transport.sent).toHaveLength(4);
    expect(readCallLog(file)).toHaveLength(4);
    expect(fake.attachments).toHaveLength(0);
    const rows = syncStatus(db, "moneybird");
    expect(rows.map((r) => [r.kind, r.status])).toEqual([["invoice", "failed"], ["vendor", "synced"]]);
    // The invoice's first step is kept, so the next run goes on with the PDF and makes no second invoice.
    expect(JSON.parse(rows[0]!.progress_json!)).toHaveProperty("invoice", [...fake.invoices.keys()][0]);

    const second = await syncAll(db, moneybird(fake, budgetedTransport(fake.transport, { budget: 20, file })), all(), { sleep: noSleep });
    expect(second.map((r) => [r.kind, r.outcome])).toEqual([["vendor", "unchanged"], ["invoice", "pushed"], ["payment", "pushed"], ["journal", "pushed"]]);
    expect(fake.invoices.size).toBe(1);
    expect(fake.contacts.size).toBe(1);
    expect(fake.attachments).toHaveLength(1);
    expect(fake.posts("/documents/purchase_invoices.json")).toHaveLength(1);
    expect(readCallLog(file)).toHaveLength(fake.transport.sent.length);
  });

  it("does not mistake a refused check for an invoice that is there only in part: it stops, and no person is asked to look", async () => {
    const file = join(tmp(), "calls.jsonl");
    const fake = new FakeMoneybird();
    const db = openDb(":memory:");
    // The answer to the invoice is lost; the lookup finds it (request 5); the check that it is complete would be the sixth.
    fake.plan((r) => r.method === "POST" && r.url.endsWith("/documents/purchase_invoices.json"), "drop-after-doing");
    const res = await syncAll(db, moneybird(fake, budgetedTransport(fake.transport, { budget: 5, file })), all().slice(0, 3), { sleep: noSleep });
    expect(res.map((r) => [r.kind, r.outcome])).toEqual([["vendor", "pushed"], ["invoice", "failed"], ["payment", "waiting"]]);
    expect(res[1]!.detail).toMatch(/call budget of 5 is spent/);
    expect(syncStatus(db, "moneybird").find((r) => r.kind === "invoice")!.status).toBe("failed");
    expect(fake.transport.sent).toHaveLength(5);
  });

  it("stops a lookup too: nothing is sent blind when the budget ends before Moneybird could be asked", async () => {
    const file = join(tmp(), "calls.jsonl");
    const fake = new FakeMoneybird();
    const db = openDb(":memory:");
    // An earlier run left the supplier's row without an answer, so this run asks Moneybird first; the budget is already spent.
    fake.plan((r) => r.method === "POST" && r.url.endsWith("/contacts.json"), { status: 400, headers: {}, body: '{"error":"refused once","symbolic":{}}' });
    await syncAll(db, moneybird(fake, budgetedTransport(fake.transport, { budget: 1, file })), all().slice(0, 1), { sleep: noSleep });
    const res = await syncAll(db, moneybird(fake, budgetedTransport(fake.transport, { budget: 1, file })), all().slice(0, 2), { sleep: noSleep });
    expect(res.map((r) => [r.kind, r.outcome])).toEqual([["vendor", "failed"], ["invoice", "waiting"]]);
    expect(res[0]!.detail).toMatch(/call budget of 1 is spent.*was not sent/);
    expect(fake.transport.sent).toHaveLength(1);
    expect(fake.contacts.size).toBe(0);
  });
});
