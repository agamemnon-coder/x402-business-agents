// The Moneybird connector (src/erp/moneybird.ts) against a stand-in administration that checks every request against
// Moneybird's own OpenAPI request schemas (test/fakes/moneybird.ts). No live calls here: what the live API answered to
// the first pull of a sandbox administration (12 November 2026) is replayed from a fixture, at the end of this file.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { CHART } from "../src/config/gl.js";
import { openDb } from "../src/db/open.js";
import { staticToken } from "../src/erp/auth.js";
import { readCallLog } from "../src/erp/callBudget.js";
import { runErpCli } from "../src/erp/cli.js";
import { ErpError, RecordingTransport } from "../src/erp/connector.js";
import { liveConnector, missingSettings } from "../src/erp/registry.js";
import { MONEYBIRD_ENDPOINTS, MONEYBIRD_SANDBOX_ADMINISTRATION, moneybirdConfigFromEnv, MoneybirdConnector, moneybirdEndpoint, moneybirdRetryAfterMs, parseMoneybirdJson, toMoney, type MoneybirdConfig } from "../src/erp/moneybird.js";
import { syncAll, type SyncItem } from "../src/erp/sync.js";
import { FakeMoneybird, LEDGER, OPENAPI_VERSION, TAX, type LedgerAccount, type TaxRate } from "./fakes/moneybird.js";
import { sampleInvoice, sampleJournal, samplePayment, sampleVendor, TEST_IBAN } from "./fakes/erp.js";

const noSleep = async () => {};
const PROJECT = "458026356994737301";
/** A call log in a folder of its own, removed when the file's tests are done. */
const made: string[] = [];
const callLog = () => { const dir = mkdtempSync(join(tmpdir(), "erp-mb-")); made.push(dir); return join(dir, "calls.jsonl"); };
afterAll(() => { for (const dir of made) rmSync(dir, { recursive: true, force: true }); });

function setup(o: { token?: string; cfg?: Partial<MoneybirdConfig> } = {}) {
  const fake = new FakeMoneybird();
  const cfg: MoneybirdConfig = {
    baseUrl: "https://moneybird.com/api/v2", administrationId: fake.admin, baseCurrency: "EUR",
    taxRates: { NL21: TAX[0]!.id, NL9: TAX[1]!.id, NL0: TAX[2]!.id }, glMap: {}, projects: { CC100: PROJECT }, ignoreCostCentres: false, ...o.cfg,
  };
  const c = new MoneybirdConnector(cfg, fake.transport, staticToken(o.token ?? fake.token));
  return { fake, c, db: openDb(":memory:") };
}
const all = (): SyncItem[] => [
  { kind: "vendor", object: sampleVendor() }, { kind: "invoice", object: sampleInvoice() },
  { kind: "payment", object: samplePayment() }, { kind: "journal", object: sampleJournal() },
];
const json = (b: unknown) => JSON.parse(b as string) as Record<string, Record<string, unknown>>;

describe("Moneybird connector", () => {
  it("is checked against Moneybird's own OpenAPI file", () => {
    expect(OPENAPI_VERSION).toMatch(/^v2-\d{8}-/);
  });

  it("sends a supplier, its invoice with the PDF, the payment and a journal entry, each in Moneybird's own shape", async () => {
    const { fake, c, db } = setup();
    const res = await syncAll(db, c, all(), { sleep: noSleep });
    expect(res.map((r) => [r.kind, r.outcome])).toEqual([["vendor", "pushed"], ["invoice", "pushed"], ["payment", "pushed"], ["journal", "pushed"]]);
    expect(fake.refused).toEqual([]);

    const contact = json(fake.posts("/contacts")[0]!.body).contact!;
    expect(contact).toEqual({ company_name: "Bergtex Textil GmbH", customer_id: "PURSER-V-1", tax_number: "DE123456789", bank_account: TEST_IBAN, country: "DE" });

    const pi = json(fake.posts("/documents/purchase_invoices.json")[0]!.body).purchase_invoice!;
    const contactId = [...fake.contacts.keys()][0]!;
    expect(pi).toMatchObject({ contact_id: contactId, reference: "BT-2026-0042", date: "2026-11-02", due_date: "2026-12-02", currency: "EUR", prices_are_incl_tax: false });
    expect(pi.details_attributes).toEqual([
      { description: "Rain jackets, 40 pieces", price: "1000.00", amount: 1, tax_rate_id: TAX[0]!.id, ledger_account_id: LEDGER[0]!.id, project_id: PROJECT },
      { description: "Printed catalogues", price: "200.00", amount: 1, tax_rate_id: TAX[1]!.id, ledger_account_id: LEDGER[1]!.id },
    ]);
    // Moneybird's own totals are the invoice's, to the cent.
    const inv = [...fake.invoices.values()][0]!;
    expect([inv.total_price_excl_tax, inv.total_price_incl_tax]).toEqual(["1200.0", "1428.0"]);
    expect(fake.attachments).toHaveLength(1);
    expect(fake.attachments[0]).toMatchObject({ invoiceId: inv.id, filename: "BT-2026-0042.pdf", contentType: "application/pdf" });
    expect([...fake.attachments[0]!.bytes]).toEqual([0x25, 0x50, 0x44, 0x46]);

    const pay = json(fake.posts(`/documents/purchase_invoices/${inv.id}/payments`)[0]!.body).payment!;
    expect(pay).toEqual({ payment_date: "2026-11-20", price: "1428.00", transaction_identifier: "03360bfa-afce-457b-89d1-e1097fbe3985" });
    expect(inv.state).toBe("paid");

    const gj = json(fake.posts("/documents/general_journal_documents")[0]!.body).general_journal_document!;
    expect(gj).toEqual({ reference: "Purser JE-1", date: "2026-11-20", general_journal_document_entries_attributes: [
      { ledger_account_id: LEDGER[2]!.id, description: "Bank and transfer fees", debit: "13.42", credit: "0.00" },
      { ledger_account_id: LEDGER[3]!.id, description: "Airwallex EUR", debit: "0.00", credit: "13.42" },
    ] });

    // Moneybird's ids are past 2^53: they are kept as Moneybird wrote them, never rounded through a float.
    expect(res[1]!.externalId).toBe(inv.id);
    expect(inv.id).toMatch(/^\d{18}$/);
    expect(fake.posts().every((r) => r.url.endsWith(".json"))).toBe(true);
  });

  it("sends nothing twice: a second run finds everything unchanged and makes no request", async () => {
    const { fake, c, db } = setup();
    await syncAll(db, c, all(), { sleep: noSleep });
    const before = fake.transport.sent.length;
    const again = await syncAll(db, c, all(), { sleep: noSleep });
    expect(again.map((r) => r.outcome)).toEqual(["unchanged", "unchanged", "unchanged", "unchanged"]);
    expect(fake.transport.sent.length).toBe(before);
  });

  it("an answer lost after Moneybird created the invoice: the next try finds it by supplier and reference, no second invoice", async () => {
    const { fake, c, db } = setup();
    fake.plan((r) => r.method === "POST" && r.url.endsWith("/documents/purchase_invoices.json"), "drop-after-doing");
    const res = await syncAll(db, c, [{ kind: "vendor", object: sampleVendor() }, { kind: "invoice", object: { ...sampleInvoice(), pdf: undefined } }], { sleep: noSleep });
    expect(res[1]).toMatchObject({ kind: "invoice", outcome: "found_existing" });
    expect(fake.invoices.size).toBe(1);
    expect(fake.posts("/documents/purchase_invoices.json")).toHaveLength(1);
  });

  it("an invoice found that way without its PDF, or with other totals, goes to a person: nothing is guessed or sent twice", async () => {
    const { fake, c, db } = setup();
    fake.plan((r) => r.method === "POST" && r.url.endsWith("/documents/purchase_invoices.json"), "drop-after-doing");
    const res = await syncAll(db, c, all().slice(0, 3), { sleep: noSleep });
    expect(res[1]).toMatchObject({ kind: "invoice", outcome: "needs_review" });
    expect(res[1]!.detail).toMatch(/PDF is not attached/);
    expect(res[2]!.outcome).toBe("waiting");
    expect(fake.invoices.size).toBe(1);

    const s = setup();
    s.fake.vatOf = (net, pct) => Math.floor((net * pct) / 100) + 1;
    s.fake.plan((r) => r.method === "POST" && r.url.endsWith("/documents/purchase_invoices.json"), "drop-after-doing");
    const r2 = await syncAll(s.db, s.c, [{ kind: "vendor", object: sampleVendor() }, { kind: "invoice", object: { ...sampleInvoice(), pdf: undefined } }], { sleep: noSleep });
    expect(r2[1]!.outcome).toBe("needs_review");
    expect(r2[1]!.detail).toMatch(/totals.*1428\.02/);
  });

  it("a supplier whose answer was lost is found again by Purser's own customer id", async () => {
    const { fake, c, db } = setup();
    fake.plan((r) => r.method === "POST" && r.url.endsWith("/contacts.json"), "drop-after-doing");
    const res = await syncAll(db, c, all().slice(0, 1), { sleep: noSleep });
    expect(res[0]).toMatchObject({ outcome: "found_existing" });
    expect(fake.contacts.size).toBe(1);
  });

  it("refuses a ledger account Moneybird does not have, naming it, and sends no invoice", async () => {
    const { fake, c, db } = setup();
    const inv = sampleInvoice();
    inv.lines[1] = { ...inv.lines[1]!, glAccount: "6123" };
    const res = await syncAll(db, c, [{ kind: "vendor", object: sampleVendor() }, { kind: "invoice", object: inv }], { sleep: noSleep });
    expect(res[1]!.outcome).toBe("failed");
    expect(res[1]!.detail).toMatch(/6123.*ERP_MONEYBIRD_GL_MAP/);
    expect(fake.posts("/documents/purchase_invoices.json")).toHaveLength(0);
  });

  it("refuses a ledger account Moneybird does not allow on purchase invoices", async () => {
    const { fake, c, db } = setup();
    const inv = sampleInvoice();
    inv.lines[0] = { ...inv.lines[0]!, glAccount: "1200", costCentre: undefined };
    const res = await syncAll(db, c, [{ kind: "vendor", object: sampleVendor() }, { kind: "invoice", object: inv }], { sleep: noSleep });
    expect(res[1]!.detail).toMatch(/1200.*purchase invoice/);
    expect(fake.posts("/documents/purchase_invoices.json")).toHaveLength(0);
  });

  it("maps a Purser account to a Moneybird ledger account by id when the setting says so (an account without a code)", async () => {
    const { fake, c, db } = setup({ cfg: { glMap: { "6900": LEDGER[4]!.id } } });
    await syncAll(db, c, all().slice(0, 2), { sleep: noSleep });
    const d = json(fake.posts("/documents/purchase_invoices.json")[0]!.body).purchase_invoice!.details_attributes as { ledger_account_id: string }[];
    expect(d[1]!.ledger_account_id).toBe(LEDGER[4]!.id);
  });

  it("refuses a VAT treatment with no Moneybird tax rate, or one mapped to a sales rate, and sends nothing", async () => {
    const { fake, c, db } = setup();
    const inv = sampleInvoice();
    inv.lines[1] = { ...inv.lines[1]!, vatCode: "EU_RC", vatCents: 0 };
    inv.totals = { netCents: 120_000, vatCents: 21_000, grossCents: 141_000 };
    const res = await syncAll(db, c, [{ kind: "vendor", object: sampleVendor() }, { kind: "invoice", object: inv }], { sleep: noSleep });
    expect(res[1]!.detail).toMatch(/EU_RC.*ERP_MONEYBIRD_TAX_RATES/);

    const s = setup({ cfg: { taxRates: { NL21: TAX[3]!.id, NL9: TAX[1]!.id } } });
    const r2 = await syncAll(s.db, s.c, all().slice(0, 2), { sleep: noSleep });
    expect(r2[1]!.detail).toMatch(new RegExp(`${TAX[3]!.id}.*not a purchase invoice rate`));
    expect(fake.posts("/documents/purchase_invoices.json")).toHaveLength(0);
    expect(s.fake.posts("/documents/purchase_invoices.json")).toHaveLength(0);
  });

  it("refuses a cost centre with no Moneybird project, unless cost centres are left out on purpose", async () => {
    const { c, db } = setup({ cfg: { projects: {} } });
    const res = await syncAll(db, c, all().slice(0, 2), { sleep: noSleep });
    expect(res[1]!.detail).toMatch(/CC100.*ERP_MONEYBIRD_PROJECTS/);
    const s = setup({ cfg: { projects: {}, ignoreCostCentres: true } });
    const ok = await syncAll(s.db, s.c, all().slice(0, 2), { sleep: noSleep });
    expect(ok[1]!.outcome).toBe("pushed");
    expect(json(s.fake.posts("/documents/purchase_invoices.json")[0]!.body).purchase_invoice!.details_attributes).not.toContainEqual(expect.objectContaining({ project_id: expect.anything() }));
  });

  it("puts an invoice whose total Moneybird computes differently aside for a person, and pays nothing against it", async () => {
    const { fake, c, db } = setup();
    // 100.50 at 21% is 21.105: Purser has the invoice's 21.11; this administration rounds down to 21.10.
    fake.vatOf = (net, pct) => Math.floor((net * pct) / 100);
    const inv = sampleInvoice();
    inv.lines = [{ description: "Gloves", glAccount: "6200", vatCode: "NL21", netCents: 10_050, vatCents: 2_111, costCentre: "CC100" }];
    inv.totals = { netCents: 10_050, vatCents: 2_111, grossCents: 12_161 };
    const res = await syncAll(db, c, [{ kind: "vendor", object: sampleVendor() }, { kind: "invoice", object: inv }, { kind: "payment", object: { ...samplePayment(), amountCents: 12_161 } }], { sleep: noSleep });
    expect(res[1]).toMatchObject({ outcome: "needs_review" });
    expect(res[1]!.detail).toMatch(/121\.60.*121\.61/);
    expect(res[1]!.externalId).toBe([...fake.invoices.keys()][0]);
    expect(res[2]!.outcome).toBe("waiting");
    expect(fake.attachments).toHaveLength(1);
  });

  it("a wrong or revoked token is an auth failure, tried once more with a fresh token and then left", async () => {
    const { fake, c, db } = setup({ token: "revoked" });
    const res = await syncAll(db, c, all().slice(0, 1), { sleep: noSleep });
    expect(res[0]!.outcome).toBe("failed");
    expect(res[0]!.detail).toMatch(/^auth: .*HTTP 401.*access token revoked/);
    expect(fake.posts("/contacts")).toHaveLength(2);
  });

  it("waits as long as a 429 says (seconds), then goes on", async () => {
    const { fake, c, db } = setup();
    fake.plan((r) => r.method === "POST" && r.url.endsWith("/contacts.json"), { status: 429, headers: { "retry-after": "7" }, body: '{"error":"Too many requests","symbolic":{}}' });
    const slept: number[] = [];
    const res = await syncAll(db, c, all().slice(0, 1), { sleep: async (ms) => { slept.push(ms); } });
    expect(res[0]!.outcome).toBe("pushed");
    expect(slept).toEqual([7000]);
    expect(fake.contacts.size).toBe(1);
  });

  it("reads a Retry-After given as a moment (Unix seconds or an HTTP date) as the wait until then", () => {
    const now = Date.parse("2026-11-10T12:00:00Z");
    expect(moneybirdRetryAfterMs({ "retry-after": String(now / 1000 + 90) }, now)).toBe(90_000);
    expect(moneybirdRetryAfterMs({ "retry-after": "Tue, 10 Nov 2026 12:00:30 GMT" }, now)).toBe(30_000);
    expect(moneybirdRetryAfterMs({ "retry-after": "12" }, now)).toBe(12_000);
    expect(moneybirdRetryAfterMs({}, now)).toBeUndefined();
  });

  it("a 500 on the invoice is retried, after asking Moneybird whether it already holds it: one invoice", async () => {
    const { fake, c, db } = setup();
    fake.plan((r) => r.method === "POST" && r.url.endsWith("/documents/purchase_invoices.json"), { status: 500, headers: {}, body: '{"error":"Internal server error","symbolic":{}}' });
    fake.plan((r) => r.method === "GET" && r.url.includes("/ledger_accounts.json"), { status: 503, headers: {}, body: "" });
    const res = await syncAll(db, c, all().slice(0, 2), { sleep: noSleep });
    expect(res.map((r) => r.outcome)).toEqual(["pushed", "pushed"]);
    expect(fake.invoices.size).toBe(1);
    const gets = fake.transport.sent.filter((r) => r.method === "GET" && r.url.includes("/documents/purchase_invoices.json"));
    expect(gets.length).toBeGreaterThanOrEqual(1);
    expect(new URL(gets[0]!.url).searchParams.get("filter")).toBe(`contact_id:${[...fake.contacts.keys()][0]}`);
  });

  it("a 500 that keeps coming fails the push with Moneybird's own words", async () => {
    const { fake, c, db } = setup();
    for (let i = 0; i < 5; i++) fake.plan((r) => r.method === "POST" && r.url.endsWith("/contacts.json"), { status: 502, headers: {}, body: '{"error":"Bad gateway","symbolic":{}}' });
    const res = await syncAll(db, c, all().slice(0, 1), { sleep: noSleep, maxAttempts: 3 });
    expect(res[0]!.outcome).toBe("failed");
    expect(res[0]!.detail).toMatch(/server: .*HTTP 502: Bad gateway/);
  });

  it("refuses a payment in another currency than the administration's: Moneybird needs its amount in EUR too", async () => {
    const { fake, c, db } = setup();
    await syncAll(db, c, all().slice(0, 2), { sleep: noSleep });
    const res = await syncAll(db, c, [{ kind: "payment", object: { ...samplePayment(), currency: "USD" } }], { sleep: noSleep });
    expect(res[0]!.outcome).toBe("failed");
    expect(res[0]!.detail).toMatch(/USD.*price_base/);
    expect(fake.posts().filter((r) => r.url.endsWith("/payments.json"))).toHaveLength(0);
  });

  it("cancels a sent invoice with a purchase invoice of the same lines, negative, whose totals Moneybird confirms", async () => {
    const { fake, c, db } = setup();
    const res = await syncAll(db, c, all().slice(0, 2), { sleep: noSleep });
    const refs = { vendor: () => [...fake.contacts.keys()][0]!, invoice: () => res[1]!.externalId! };
    const id = await c.pushCreditNote({ ...sampleInvoice(), pdf: undefined }, res[1]!.externalId!, refs);
    const pi = json(fake.posts("/documents/purchase_invoices.json")[1]!.body).purchase_invoice!;
    expect(pi.reference).toBe("BT-2026-0042 (credit note)");
    expect((pi.details_attributes as { price: string }[]).map((d) => d.price)).toEqual(["-1000.00", "-200.00"]);
    expect(fake.invoices.get(id)!.total_price_incl_tax).toBe("-1428.0");
    expect(fake.refused).toEqual([]);
  });

  it("reads whether an invoice is paid from Moneybird's state", async () => {
    const { c, db } = setup();
    const res = await syncAll(db, c, all().slice(0, 2), { sleep: noSleep });
    const ext = res[1]!.externalId!;
    const refs = { vendor: () => null, invoice: () => ext };
    expect(await c.pullPaymentStatus(sampleInvoice(), ext, refs)).toBe("unpaid");
    await c.pushPayment({ ...samplePayment(), amountCents: 50_000 }, refs);
    expect(await c.pullPaymentStatus(sampleInvoice(), ext, refs)).toBe("partial");
    await c.pushPayment({ ...samplePayment(), id: "PAY-2", amountCents: 92_800 }, refs);
    expect(await c.pullPaymentStatus(sampleInvoice(), ext, refs)).toBe("paid");
  });

  it("pulls the ledger accounts (with their ids, for the mapping), the tax rates and the suppliers, page by page", async () => {
    const { fake, c } = setup();
    for (let i = 0; i < 120; i++) await c.pushVendor({ ...sampleVendor(), id: `V-${i}`, name: `Supplier ${i}`, iban: undefined });
    const vendors = await c.pullVendors();
    expect(vendors).toHaveLength(120);
    const accounts = await c.pullChartOfAccounts();
    expect(accounts).toContainEqual({ code: "6200", name: "Inkoop", externalId: LEDGER[0]!.id, note: "direct_costs; purchase invoices, journal entries" });
    expect(accounts).toContainEqual({ code: "", name: "Software", externalId: LEDGER[4]!.id, note: "expenses; purchase invoices" });
    expect(accounts).toContainEqual({ code: "1200", name: "Airwallex EUR", externalId: LEDGER[3]!.id, note: "current_assets; journal entries" });
    expect(await c.pullTaxRates()).toContainEqual({ id: TAX[0]!.id, name: "21% btw", percentage: "21.0", type: "purchase_invoice" });
    expect(fake.transport.sent.filter((r) => r.url.includes("/contacts.json") && r.method === "GET").length).toBe(2);
  });
});

describe("Moneybird money and ids", () => {
  it("writes whole cents as an exact decimal string, never through a float", () => {
    expect(toMoney(1)).toBe("0.01");
    expect(toMoney(10)).toBe("0.10");
    expect(toMoney(-5)).toBe("-0.05");
    expect(toMoney(0)).toBe("0.00");
    expect(toMoney(123_456_789_012)).toBe("1234567890.12");
    expect(() => toMoney(1.5)).toThrow(/whole cents/);
  });

  it("reads ids past 2^53 as the digits Moneybird sent", () => {
    const o = parseMoneybirdJson('{"id":458026356994737217,"contact_id":458026356994737219,"price":"1.0","note":"{\\"id\\": 458026356994737217}","n":3}') as Record<string, unknown>;
    expect(o).toEqual({ id: "458026356994737217", contact_id: "458026356994737219", price: "1.0", note: '{"id": 458026356994737217}', n: 3 });
  });
});

describe("Moneybird settings", () => {
  it("needs a token, the administration and the tax rate map; names only what is missing", () => {
    expect(missingSettings("moneybird", {})).toEqual(["ERP_MONEYBIRD_TOKEN", "ERP_MONEYBIRD_ADMINISTRATION_ID", "ERP_MONEYBIRD_TAX_RATES"]);
    const cfg = moneybirdConfigFromEnv({ ERP_MONEYBIRD_TOKEN: "x", ERP_MONEYBIRD_ADMINISTRATION_ID: "123456789012345678", ERP_MONEYBIRD_TAX_RATES: '{"NL21":"458026356994737121"}' });
    expect(cfg).toMatchObject({ baseUrl: "https://moneybird.com/api/v2", administrationId: "123456789012345678", baseCurrency: "EUR", taxRates: { NL21: "458026356994737121" }, ignoreCostCentres: false });
  });

  it("refuses a malformed administration id, tax rate id or VAT treatment", () => {
    const base = { ERP_MONEYBIRD_TOKEN: "x", ERP_MONEYBIRD_TAX_RATES: '{"NL21":"1"}' };
    expect(() => moneybirdConfigFromEnv({ ...base, ERP_MONEYBIRD_ADMINISTRATION_ID: "my-company" })).toThrow(/ERP_MONEYBIRD_ADMINISTRATION_ID/);
    expect(() => moneybirdConfigFromEnv({ ...base, ERP_MONEYBIRD_ADMINISTRATION_ID: "1", ERP_MONEYBIRD_TAX_RATES: '{"NL21":"21%"}' })).toThrow(/ERP_MONEYBIRD_TAX_RATES.*NL21/);
    expect(() => moneybirdConfigFromEnv({ ...base, ERP_MONEYBIRD_ADMINISTRATION_ID: "1", ERP_MONEYBIRD_TAX_RATES: '{"BTW21":"1"}' })).toThrow(/BTW21/);
  });

  it("is in the CLI: listed with what it misses, and a dry run prints the requests without the token", async () => {
    const lines: string[] = [];
    const db = openDb(":memory:");
    expect(await runErpCli(["list"], { db, env: { ERP_MONEYBIRD_TOKEN: "aaaa-bbbb-aaaa-bbbb" }, out: (l) => lines.push(l) })).toBe(0);
    expect(lines.join("\n")).toMatch(/moneybird\s+Moneybird: not set up \(missing ERP_MONEYBIRD_ADMINISTRATION_ID, ERP_MONEYBIRD_TAX_RATES\)/);
    const dry: string[] = [];
    const items = () => all();
    expect(await runErpCli(["sync", "--connector", "moneybird", "--dry-run"], { db, env: { ERP_MONEYBIRD_TOKEN: "aaaa-bbbb-aaaa-bbbb" }, out: (l) => dry.push(l), items })).toBe(0);
    const text = [...lines, ...dry].join("\n");
    expect(text).toMatch(/Example settings/);
    expect(text).toMatch(/POST https:\/\/moneybird\.com\/api\/v2\/\d+\/documents\/purchase_invoices\.json/);
    expect(text).not.toMatch(/aaaa-bbbb-aaaa-bbbb/);
  });
});

describe("Moneybird guard: one administration, a fixed list of endpoints", () => {
  const cfgOf = (administrationId: string, sandboxOnly = false) => ({ baseUrl: "https://moneybird.com/api/v2", administrationId, sandboxOnly });
  const subset = JSON.parse(readFileSync(resolve(import.meta.dirname, "fixtures/moneybird/openapi-subset.json"), "utf8")) as { requests: Record<string, unknown> };

  it("lists every endpoint it can call, and none sends an e-mail, an invoice or a reminder to a contact", () => {
    expect(MONEYBIRD_ENDPOINTS.length).toBeGreaterThan(0);
    for (const e of MONEYBIRD_ENDPOINTS) {
      // Moneybird's sending endpoints are named for what they do (send_invoice, send_reminders, send_estimate, ...).
      expect(e, e).not.toMatch(/send|mail|remind|deliver|invit/i);
      // The purchase side: suppliers, the chart, tax rates, purchase invoices, journal documents. On the sales side
      // only one read (GET sales_invoices, for the collections agent): no estimates, recurring invoices or
      // subscriptions, and nothing on the sales side that Moneybird can send to a contact.
      expect(e, e).toMatch(/^((GET|POST) \/\{administration_id\}\/(contacts|ledger_accounts|tax_rates|documents\/purchase_invoices|documents\/general_journal_documents)[/{]|GET \/\{administration_id\}\/sales_invoices\{format\}$)/);
      // Nothing is changed or removed after it was sent: no PATCH, PUT or DELETE.
      expect(e, e).not.toMatch(/^(PATCH|PUT|DELETE) /);
    }
    // Every POST on the list is one whose body the tests check against Moneybird's own OpenAPI schema.
    expect(MONEYBIRD_ENDPOINTS.filter((e) => e.startsWith("POST ")).sort()).toEqual(Object.keys(subset.requests).sort());
  });

  it("makes no request that is not on the list, and the list holds nothing it never calls", async () => {
    const { fake, c, db } = setup();
    // Everything the connector does: a full sync, each lookup after a lost answer, the completeness check, the paid
    // state, a credit note, and the three pulls.
    await syncAll(db, c, all(), { sleep: noSleep });
    const refs = { vendor: () => [...fake.contacts.keys()][0]!, invoice: () => [...fake.invoices.keys()][0]! };
    for (const [kind, o] of [["vendor", sampleVendor()], ["invoice", sampleInvoice()], ["payment", samplePayment()], ["journal", sampleJournal()]] as const) await c.findExisting(kind, o, refs);
    await c.incomplete("invoice", sampleInvoice(), refs.invoice());
    await c.pullPaymentStatus(sampleInvoice(), refs.invoice(), refs);
    await c.pushCreditNote({ ...sampleInvoice(), pdf: undefined }, refs.invoice(), refs);
    await c.pullChartOfAccounts();
    await c.pullVendors();
    await c.pullTaxRates();
    await c.openSalesInvoices();
    const used = new Set(fake.transport.sent.map((r) => moneybirdEndpoint(r.method, r.url, cfgOf(fake.admin))));
    expect([...used].sort()).toEqual([...MONEYBIRD_ENDPOINTS].sort());
  });

  it("never sends a supplier's e-mail address: Moneybird has no address to deliver anything to", async () => {
    const { fake, c, db } = setup();
    expect(sampleVendor().email).toBe("billing@example.com");
    await syncAll(db, c, all(), { sleep: noSleep });
    for (const r of fake.transport.sent) {
      if (typeof r.body !== "string") continue;
      expect(r.body).not.toContain("billing@example.com");
      expect(r.body).not.toMatch(/"(email|send_invoices_to_email|send_estimates_to_email|send_invoices_to_attention|delivery_method)"/);
    }
  });

  it("names a request by its endpoint, and refuses one off the list or outside its administration", () => {
    const cfg = cfgOf("123456789012345678");
    const base = "https://moneybird.com/api/v2/123456789012345678";
    expect(moneybirdEndpoint("GET", `${base}/ledger_accounts.json`, cfg)).toBe("GET /{administration_id}/ledger_accounts{format}");
    expect(moneybirdEndpoint("GET", `${base}/tax_rates.json?per_page=100&page=1`, cfg)).toBe("GET /{administration_id}/tax_rates{format}");
    expect(moneybirdEndpoint("GET", `${base}/contacts/customer_id/PURSER-V%2F1.json`, cfg)).toBe("GET /{administration_id}/contacts/customer_id/{customer_id}{format}");
    expect(moneybirdEndpoint("POST", `${base}/documents/purchase_invoices/458026356994737217/payments.json`, cfg)).toBe("POST /{administration_id}/documents/purchase_invoices/{id}/payments{format}");
    for (const [method, url] of [
      ["PATCH", `${base}/sales_invoices/458026356994737217/send_invoice.json`],
      ["POST", `${base}/sales_invoices/send_reminders.json`],
      ["POST", `${base}/sales_invoices.json`],
      ["DELETE", `${base}/contacts/458026356994737217.json`],
      ["PATCH", `${base}/documents/purchase_invoices/458026356994737217.json`],
      ["GET", `${base}/documents/purchase_invoices/458026356994737217/send_invoice.json`],
      ["GET", `${base}/ledger_accounts`],
    ] as const) expect(() => moneybirdEndpoint(method, url, cfg), `${method} ${url}`).toThrow(/not an endpoint Purser.*nothing was sent/);
    for (const url of [
      "https://moneybird.com/api/v2/999999999999999999/ledger_accounts.json",
      `${base}/../999999999999999999/ledger_accounts.json`,
      `${base}/%2e%2e/999999999999999999/ledger_accounts.json`,
      "https://moneybird.example/api/v2/123456789012345678/ledger_accounts.json",
      "https://moneybird.com/api/v1/123456789012345678/ledger_accounts.json",
      "https://moneybird.com/api/v2/administrations.json",
    ]) expect(() => moneybirdEndpoint("GET", url, cfg), url).toThrow(/outside administration 123456789012345678.*nothing was sent/);
  });

  it("sends nothing when an id it was given would lead out of the administration or to another endpoint", async () => {
    const { fake, c } = setup();
    const elsewhere = "../../../999999999999999999/documents/purchase_invoices/1";
    const refs = { vendor: () => null, invoice: () => elsewhere };
    await expect(c.pullPaymentStatus(sampleInvoice(), elsewhere, refs)).rejects.toThrow(/outside administration/);
    await expect(c.pullPaymentStatus(sampleInvoice(), "1/send_invoice", refs)).rejects.toThrow(/not an endpoint/);
    await expect(c.pushPayment(samplePayment(), refs)).rejects.toThrow(/outside administration/);
    await expect(c.pullPaymentStatus(sampleInvoice(), "1/send_invoice", refs)).rejects.toBeInstanceOf(ErpError);
    expect(fake.transport.sent).toHaveLength(0);
  });

  it("with the sandbox guard on, takes no administration but the sandbox one, on Moneybird's own address", () => {
    const base = { ERP_MONEYBIRD_TOKEN: "x", ERP_MONEYBIRD_TAX_RATES: '{"NL21":"1"}', ERP_MONEYBIRD_SANDBOX_ONLY: "on" };
    expect(MONEYBIRD_SANDBOX_ADMINISTRATION).toBe("503585935808530148");
    expect(moneybirdConfigFromEnv({ ...base, ERP_MONEYBIRD_ADMINISTRATION_ID: "503585935808530148" })).toMatchObject({ administrationId: "503585935808530148", sandboxOnly: true });
    expect(() => moneybirdConfigFromEnv({ ...base, ERP_MONEYBIRD_ADMINISTRATION_ID: "123456789012345678" })).toThrow(/ERP_MONEYBIRD_SANDBOX_ONLY is on.*503585935808530148.*nothing was called/);
    expect(() => moneybirdConfigFromEnv({ ...base, ERP_MONEYBIRD_ADMINISTRATION_ID: "503585935808530148", ERP_MONEYBIRD_BASE_URL: "https://moneybird.example/api/v2" })).toThrow(/ERP_MONEYBIRD_SANDBOX_ONLY is on.*ERP_MONEYBIRD_BASE_URL/);
    // The switch is on or off; a value that only looks like "on" is refused rather than read as off.
    for (const v of ["true", "yes", "1", "ON"]) expect(() => moneybirdConfigFromEnv({ ...base, ERP_MONEYBIRD_SANDBOX_ONLY: v, ERP_MONEYBIRD_ADMINISTRATION_ID: "123456789012345678" }), v).toThrow(/ERP_MONEYBIRD_SANDBOX_ONLY must be on or off/);
    expect(moneybirdConfigFromEnv({ ...base, ERP_MONEYBIRD_SANDBOX_ONLY: "off", ERP_MONEYBIRD_ADMINISTRATION_ID: "123456789012345678" }).sandboxOnly).toBe(false);
    expect(moneybirdConfigFromEnv({ ERP_MONEYBIRD_TOKEN: "x", ERP_MONEYBIRD_TAX_RATES: '{"NL21":"1"}', ERP_MONEYBIRD_ADMINISTRATION_ID: "123456789012345678" }).sandboxOnly).toBe(false);
  });

  it("with the sandbox guard on, a connector pointed at another administration sends nothing", async () => {
    const { fake, c } = setup({ cfg: { sandboxOnly: true } });
    await expect(c.pullChartOfAccounts()).rejects.toThrow(/only the sandbox administration 503585935808530148.*nothing was sent/);
    await expect(c.pushVendor(sampleVendor())).rejects.toThrow(/only the sandbox administration/);
    expect(fake.transport.sent).toHaveLength(0);
    expect(() => moneybirdEndpoint("GET", "https://moneybird.com/api/v2/503585935808530148/ledger_accounts.json", cfgOf("503585935808530148", true))).not.toThrow();
  });

  it("live, writes each request to the call log under the administration it went to, object ids left out", async () => {
    const fake = new FakeMoneybird();
    const file = callLog();
    const env = { ERP_MONEYBIRD_TOKEN: fake.token, ERP_MONEYBIRD_ADMINISTRATION_ID: fake.admin, ERP_MONEYBIRD_TAX_RATES: JSON.stringify({ NL21: TAX[0]!.id, NL9: TAX[1]!.id }), ERP_MONEYBIRD_IGNORE_COST_CENTRES: "on", ERP_LIVE_GO: "yes", ERP_CALL_BUDGET: "20", ERP_CALL_LOG: file };
    const res = await syncAll(openDb(":memory:"), liveConnector("moneybird", env, fake.transport), all().slice(0, 3), { sleep: noSleep });
    expect(res.map((r) => r.outcome)).toEqual(["pushed", "pushed", "pushed"]);
    const a = `moneybird.com/api/v2/${fake.admin}`;
    expect(readCallLog(file).map((l) => `${l.method} ${l.endpoint}`)).toEqual([
      `POST ${a}/contacts.json`, `GET ${a}/tax_rates.json`, `GET ${a}/ledger_accounts.json`, `POST ${a}/documents/purchase_invoices.json`,
      `POST ${a}/documents/purchase_invoices/{id}/attachments.json`, `POST ${a}/documents/purchase_invoices/{id}/payments.json`,
    ]);
    expect(readCallLog(file)).toHaveLength(fake.transport.sent.length);
    // Without the go and the budget there is no live connector at all.
    expect(() => liveConnector("moneybird", { ...env, ERP_LIVE_GO: undefined }, fake.transport)).toThrow(/ERP_LIVE_GO=yes.*nothing was called/);
  });
});

// What the live API really answered (12 November 2026, the owner's sandbox administration; the run is in
// docs/runs/2026-11-12-moneybird-sandbox.md). The bodies are the text as received, so these tests read what the
// connector read live, and the stand-in below holds that administration's real chart and tax rates.
describe("Moneybird, the sandbox administration's real answers", () => {
  interface Answer { method: string; url: string; status: number; headers: Record<string, string>; body: string }
  const SANDBOX = JSON.parse(readFileSync(resolve(import.meta.dirname, "fixtures/moneybird/sandbox-2026-11-12.json"), "utf8")) as { answers: Answer[] };
  const answer = (part: string) => SANDBOX.answers.find((a) => a.url.includes(part))!;
  const realLedger = JSON.parse(answer("/ledger_accounts.json").body) as LedgerAccount[];
  const realTax = JSON.parse(answer("/tax_rates.json").body) as TaxRate[];
  const account = (name: string) => realLedger.find((l) => l.name === name)!.id;
  const rate = (name: string, type: string) => realTax.find((t) => t.name === name && t.tax_rate_type === type)!.id;
  const ADMIN = "503585935808530148";
  /** Answers each request with what Moneybird answered to exactly that request; anything else was never asked live. */
  const replay = () => new RecordingTransport((req) => {
    const a = SANDBOX.answers.find((x) => x.method === req.method && x.url === req.url);
    if (!a) throw new Error(`not asked live: ${req.method} ${req.url}`);
    return { status: a.status, headers: a.headers, body: a.body };
  });
  const onRealChart = (cfg: Partial<MoneybirdConfig>) => {
    const fake = new FakeMoneybird({ ledger: realLedger, tax: realTax });
    const c = new MoneybirdConnector({
      baseUrl: "https://moneybird.com/api/v2", administrationId: fake.admin, baseCurrency: "EUR", glMap: {}, projects: {}, ignoreCostCentres: true,
      taxRates: { NL21: rate("21% btw", "purchase_invoice"), NL9: rate("9% btw", "purchase_invoice") }, ...cfg,
    }, fake.transport, staticToken(fake.token));
    return { fake, c, db: openDb(":memory:") };
  };

  it("holds the three answers of the live pull: 27 ledger accounts, no contact, 5 tax rates, ids written as strings", () => {
    expect(SANDBOX.answers.map((a) => `${a.method} ${a.url} ${a.status}`)).toEqual([
      `GET https://moneybird.com/api/v2/${ADMIN}/ledger_accounts.json 200`,
      `GET https://moneybird.com/api/v2/${ADMIN}/contacts.json?per_page=100&page=1 200`,
      `GET https://moneybird.com/api/v2/${ADMIN}/tax_rates.json?per_page=100&page=1 200`,
    ]);
    expect(realLedger).toHaveLength(27);
    expect(answer("/contacts.json").body).toBe("[]");
    expect(realTax.map((t) => `${t.name} ${t.tax_rate_type}`)).toEqual(["21% btw sales_invoice", "9% btw sales_invoice", "0% btw sales_invoice", "21% btw purchase_invoice", "9% btw purchase_invoice"]);
    expect(answer("/ledger_accounts.json").body.startsWith('[{"id":"503585935947990807","administration_id":"503585935808530148","name":"Algemene kosten"')).toBe(true);
    // A list that pages says so with X-Total-Count and a Link header, empty when there is no next page; the chart does not page.
    expect(answer("/tax_rates.json").headers).toMatchObject({ link: "", "x-total-count": "5" });
    expect(answer("/contacts.json").headers).toMatchObject({ link: "", "x-total-count": "0" });
    expect(answer("/ledger_accounts.json").headers.link).toBeUndefined();
  });

  it("reads them as the live pull did: three requests, every id exact, and for each account where it may be used", async () => {
    const transport = replay();
    const lines: string[] = [];
    const file = callLog();
    const env = { ERP_MONEYBIRD_TOKEN: "placeholder", ERP_MONEYBIRD_ADMINISTRATION_ID: ADMIN, ERP_MONEYBIRD_SANDBOX_ONLY: "on", ERP_LIVE_GO: "yes", ERP_CALL_BUDGET: "6", ERP_CALL_LOG: file };
    expect(await runErpCli(["pull", "--connector", "moneybird", "--live"], { db: openDb(":memory:"), env, out: (l) => lines.push(l), transport })).toBe(0);
    expect(transport.sent.map((r) => r.url)).toEqual(SANDBOX.answers.map((a) => a.url));
    expect(lines[0]).toBe("27 accounts, 0 suppliers in Moneybird");
    expect(lines).toContain(`  account 46801.01  Algemene kosten  (expenses; purchase invoices, journal entries)  [id ${account("Algemene kosten")}]`);
    expect(lines).toContain(`  account 16011  Crediteuren  (current_liabilities; journal entries)  [id ${account("Crediteuren")}]`);
    expect(lines).toContain(`  account 81180.01  Omzet  (revenue; journal entries)  [id ${account("Omzet")}]`);
    expect(lines).toContain(`  tax rate 21% btw (21.0%, purchase_invoice)  [id ${rate("21% btw", "purchase_invoice")}]`);
    expect(lines).toContain(`  tax rate 0% btw (0.0%, sales_invoice)  [id ${rate("0% btw", "sales_invoice")}]`);
    expect(lines.filter((l) => l.startsWith("  account "))).toHaveLength(27);
    expect(lines.filter((l) => l.includes("purchase invoices"))).toHaveLength(realLedger.filter((l) => l.allowed_document_types.includes("purchase_invoice")).length);
    expect(lines.filter((l) => l.startsWith("  tax rate "))).toHaveLength(5);
    expect(lines.at(-1)).toBe("3 of 6 approved requests used");
    expect(account("Algemene kosten")).toBe("503585935947990807");
    expect(readCallLog(file).map((l) => l.endpoint)).toEqual([`moneybird.com/api/v2/${ADMIN}/ledger_accounts.json`, `moneybird.com/api/v2/${ADMIN}/contacts.json`, `moneybird.com/api/v2/${ADMIN}/tax_rates.json`]);
  });

  it("finds none of Purser's account codes in that chart: an invoice is refused, naming the account to map, until it is mapped", async () => {
    expect(realLedger.map((l) => l.account_id)).not.toContain("6200");
    const { fake, c, db } = onRealChart({});
    const res = await syncAll(db, c, all().slice(0, 2), { sleep: noSleep });
    expect(res[1]!.outcome).toBe("failed");
    expect(res[1]!.detail).toMatch(/no ledger account with code 6200.*ERP_MONEYBIRD_GL_MAP/);
    expect(fake.posts("/documents/purchase_invoices.json")).toHaveLength(0);

    // Mapped by name to "Algemene kosten", one of the accounts that chart allows on a purchase invoice.
    const mapped = onRealChart({ glMap: { "6200": account("Algemene kosten"), "6900": account("Algemene kosten") } });
    const ok = await syncAll(mapped.db, mapped.c, all().slice(0, 2), { sleep: noSleep });
    expect(ok.map((r) => r.outcome)).toEqual(["pushed", "pushed"]);
    const inv = [...mapped.fake.invoices.values()][0]!;
    expect(inv.details.map((d) => [d.ledger_account_id, d.tax_rate_id])).toEqual([[account("Algemene kosten"), rate("21% btw", "purchase_invoice")], [account("Algemene kosten"), rate("9% btw", "purchase_invoice")]]);
    expect([inv.total_price_excl_tax, inv.total_price_incl_tax]).toEqual(["1200.0", "1428.0"]);
  });

  it("refuses what that administration does not allow: creditors on an invoice line, and 0% VAT, which it has only as a sales rate", async () => {
    const creditors = onRealChart({ glMap: { "6200": account("Crediteuren"), "6900": account("Algemene kosten") } });
    const r1 = await syncAll(creditors.db, creditors.c, all().slice(0, 2), { sleep: noSleep });
    expect(r1[1]!.detail).toMatch(/Crediteuren \(Purser account 6200\) is not allowed on a purchase invoice/);

    expect(realTax.some((t) => t.tax_rate_type === "purchase_invoice" && Number(t.percentage) === 0)).toBe(false);
    const zero = onRealChart({ glMap: { "6200": account("Algemene kosten"), "6900": account("Algemene kosten") }, taxRates: { NL21: rate("21% btw", "purchase_invoice"), NL9: rate("9% btw", "purchase_invoice"), NL0: rate("0% btw", "sales_invoice") } });
    const inv = sampleInvoice();
    inv.lines[1] = { ...inv.lines[1]!, vatCode: "NL0", vatCents: 0 };
    inv.totals = { netCents: 120_000, vatCents: 21_000, grossCents: 141_000 };
    const r2 = await syncAll(zero.db, zero.c, [{ kind: "vendor", object: sampleVendor() }, { kind: "invoice", object: inv }], { sleep: noSleep });
    expect(r2[1]!.detail).toMatch(/0% btw, for NL0\) is a sales_invoice rate, not a purchase invoice rate/);
    expect(creditors.fake.posts("/documents/purchase_invoices.json")).toHaveLength(0);
    expect(zero.fake.posts("/documents/purchase_invoices.json")).toHaveLength(0);
  });

  it("is written up in run notes that say what the answers hold and map by names found in them", () => {
    const notes = readFileSync(resolve(import.meta.dirname, "../docs/runs/2026-11-12-moneybird-sandbox.md"), "utf8");
    const onInvoices = realLedger.filter((l) => l.allowed_document_types.includes("purchase_invoice"));
    // Every count in the notes is the answers' own.
    expect(notes).toContain(`| \`GET ledger_accounts.json\` | ${realLedger.length} ledger accounts |`);
    expect(notes).toContain("| `GET contacts.json` | 0 contacts |");
    expect(notes).toContain(`| \`GET tax_rates.json\` | ${realTax.length} tax rates |`);
    expect(notes).toContain(`${onInvoices.length} of the ${realLedger.length} accounts are allowed on a purchase invoice`);
    expect(notes).toContain(`All ${realLedger.filter((l) => l.allowed_document_types.includes("general_journal_document")).length} take a journal entry`);
    // The rate limit lines: 150 per window, one fewer left with each request, and "remaining" is the seconds until the reset.
    const h = SANDBOX.answers.map((a) => a.headers);
    expect(h.map((x) => x["ratelimit-limit"])).toEqual(["150", "150", "150"]);
    expect(notes).toContain(`\`RateLimit-RequestsRemaining\`: ${h.map((x) => x["ratelimit-requestsremaining"]).join(", ")})`);
    for (const x of h) expect(Math.abs(Number(x["ratelimit-reset"]) - Date.parse(x.date!) / 1000 - Number(x["ratelimit-remaining"]))).toBeLessThanOrEqual(1);
    expect(notes).toContain(`${SANDBOX.answers.length} of the 6 approved`);
    // The run used the list as it was then: every endpoint but the sales-invoice read added afterwards (12 November).
    expect(notes).toContain(`list of ${MONEYBIRD_ENDPOINTS.filter((e) => !e.includes("/sales_invoices")).length} endpoints`);
    expect(notes).toContain(`\`${ADMIN}\``);

    // The tax rate map names purchase rates that the administration has, each exactly once.
    const taxRows = [...notes.matchAll(/^\| `([A-Z0-9_]+)` \| ([^|`]+) \| (purchase_invoice|sales_invoice|general_journal_document) \|$/gm)].map((m) => ({ code: m[1]!, name: m[2]!.trim(), type: m[3]! }));
    expect(taxRows.map((r) => r.code)).toEqual(["NL21", "NL9"]);
    for (const r of taxRows) {
      expect(realTax.filter((t) => t.name === r.name && t.tax_rate_type === r.type), `${r.code}: ${r.name}`).toHaveLength(1);
      expect(r.type).toBe("purchase_invoice");
    }
    expect(Number(realTax.find((t) => t.id === rate(taxRows[0]!.name, "purchase_invoice"))!.percentage)).toBe(21);
    expect(Number(realTax.find((t) => t.id === rate(taxRows[1]!.name, "purchase_invoice"))!.percentage)).toBe(9);

    // The ledger account map: Purser's own account and name, a Moneybird account that exists once, allowed where it is used.
    const rows = [...notes.matchAll(/^\| `(\d{4})` ([^|]+) \| ([^|`]+) \| ([^|]+) \|$/gm)].map((m) => ({ code: m[1]!, purser: m[2]!.trim(), moneybird: m[3]!.trim(), uses: m[4]!.trim().split(", ") }));
    expect(rows.length).toBeGreaterThan(0);
    expect(new Set(rows.map((r) => r.code)).size).toBe(rows.length);
    for (const r of rows) {
      expect(CHART[r.code], r.code).toBe(r.purser);
      const hits = realLedger.filter((l) => l.name === r.moneybird);
      expect(hits, `${r.code}: ${r.moneybird}`).toHaveLength(1);
      for (const use of r.uses) {
        expect(["purchase invoices", "journal entries"]).toContain(use);
        expect(hits[0]!.allowed_document_types, `${r.moneybird} on ${use}`).toContain(use === "purchase invoices" ? "purchase_invoice" : "general_journal_document");
      }
    }
    // The fixtures the next step sends (test/fakes/erp.ts) use accounts that are on the map, where they are used.
    const mapped = (code: string, use: string) => rows.some((r) => r.code === code && r.uses.includes(use));
    for (const l of sampleInvoice().lines) expect(mapped(l.glAccount, "purchase invoices"), l.glAccount).toBe(true);
    for (const l of sampleJournal().lines) expect(mapped(l.glAccount, "journal entries"), l.glAccount).toBe(true);
  });

  it("takes a journal entry on that chart's accounts for money and costs", async () => {
    const { fake, c, db } = onRealChart({ glMap: { "6800": account("Algemene kosten"), "1200": account("Financiële rekeningen") } });
    const res = await syncAll(db, c, [{ kind: "journal", object: sampleJournal() }], { sleep: noSleep });
    expect(res[0]!.outcome).toBe("pushed");
    expect([...fake.journals.values()][0]!.entries.map((e) => e.ledger_account_id)).toEqual([account("Algemene kosten"), account("Financiële rekeningen")]);
  });
});
