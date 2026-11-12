// The Moneybird connector (src/erp/moneybird.ts) against a stand-in administration that checks every request against
// Moneybird's own OpenAPI request schemas (test/fakes/moneybird.ts). No live calls: there is no Moneybird account yet.
import { describe, expect, it } from "vitest";
import { openDb } from "../src/db/open.js";
import { staticToken } from "../src/erp/auth.js";
import { runErpCli } from "../src/erp/cli.js";
import { missingSettings } from "../src/erp/registry.js";
import { moneybirdConfigFromEnv, MoneybirdConnector, moneybirdRetryAfterMs, parseMoneybirdJson, toMoney, type MoneybirdConfig } from "../src/erp/moneybird.js";
import { syncAll, type SyncItem } from "../src/erp/sync.js";
import { FakeMoneybird, LEDGER, OPENAPI_VERSION, TAX } from "./fakes/moneybird.js";
import { sampleInvoice, sampleJournal, samplePayment, sampleVendor, TEST_IBAN } from "./fakes/erp.js";

const noSleep = async () => {};
const PROJECT = "458026356994737301";

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
    expect(accounts).toContainEqual({ code: "6200", name: "Inkoop", externalId: LEDGER[0]!.id });
    expect(accounts).toContainEqual({ code: "", name: "Software", externalId: LEDGER[4]!.id });
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
