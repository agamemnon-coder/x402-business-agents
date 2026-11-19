// Booked journal entries and contacts to Exact Online and Xero (src/workplace/accounting.ts, src/workplace/xero.ts),
// against mocks of their REST APIs with request shapes from the references: Exact's crm/Accounts and
// generaljournalentry/GeneralJournalEntries (OData v2), Xero's Contacts and ManualJournals with xero-tenant-id and
// Idempotency-Key. Exact Online's connector is the existing one (src/erp/exact.ts), reused unchanged. No network.
// Built and tested against a mock; needs the owner's OAuth app to run live.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { apJournal } from "../src/ap/books.js";
import { ingestDocument } from "../src/ap/inbox.js";
import type { Asker } from "../src/ap/read.js";
import { openDb } from "../src/db/open.js";
import { memoryTokenStore, staticToken } from "../src/erp/auth.js";
import { RecordingTransport, redactRequest, type HttpRequest, type HttpResponse } from "../src/erp/connector.js";
import { ExactConnector, type ExactConfig } from "../src/erp/exact.js";
import { validateJournal } from "../src/erp/model.js";
import type { MoneybirdConnector } from "../src/erp/moneybird.js";
import { journalsFromApEntries, pushBooked, type BooksPush } from "../src/workplace/accounting.js";
import { contactNumberOf, narrationOf, XeroConnector, xeroConfigFromEnv, xeroError, xeroTenants, xeroTokens, type XeroConfig } from "../src/workplace/xero.js";
import { NL } from "./fakes/apInvoices.js";
import { sampleJournal, sampleVendor } from "./fakes/erp.js";
import { pdfOf } from "./fakes/pdf.js";

const TENANT = "3f2a1b9c-1d2e-4f5a-8b9c-0d1e2f3a4b5c";
const XERO = "https://api.xero.com/api.xro/2.0";
const json = (j: unknown, status = 200): HttpResponse => ({ status, headers: { "content-type": "application/json" }, body: JSON.stringify(j) });
const body = (r: HttpRequest) => JSON.parse(r.body as string) as Record<string, unknown>;
const cfg: XeroConfig = { tenantId: TENANT, baseUrl: XERO, baseCurrency: "EUR", glMap: { "6800": "404", "1200": "090" }, journalStatus: "DRAFT" };

describe("Xero: contacts and manual journals", () => {
  it("looks for the contact by Purser's number, then creates it with the tenant and an idempotency key", async () => {
    const tr = new RecordingTransport((req) => req.method === "GET" ? json({ Contacts: [] }) : json({ Id: "x", Status: "OK", Contacts: [{ ContactID: "bd2270c3-8706-4c11-9cfb-000b551c3f51", Name: "Bergtex Textil GmbH", ContactNumber: "PURSER-V-1" }] }));
    const x = new XeroConnector(cfg, tr, staticToken("xero-at"));
    const out = await pushBooked(x, { vendors: [sampleVendor()] });
    expect(out).toEqual([{ kind: "vendor", id: "V-1", outcome: "pushed", externalId: "bd2270c3-8706-4c11-9cfb-000b551c3f51" }]);
    const [find, create] = tr.sent;
    expect(decodeURIComponent(find!.url)).toBe(`${XERO}/Contacts?where=ContactNumber=="PURSER-V-1"`);
    expect(create).toMatchObject({ method: "POST", url: `${XERO}/Contacts` });
    expect(create!.headers).toMatchObject({ authorization: "Bearer xero-at", "xero-tenant-id": TENANT, "content-type": "application/json" });
    expect(create!.headers["idempotency-key"]).toMatch(/^purser-contact-V-1-[0-9a-f]{16}$/);
    expect(body(create!)).toEqual({ Contacts: [{ Name: "Bergtex Textil GmbH", ContactNumber: "PURSER-V-1", TaxNumber: "DE123456789", EmailAddress: "billing@example.com", BankAccountDetails: "DE89370400440532013000", DefaultCurrency: "EUR" }] });
    // Printed, the request carries no token and no full IBAN.
    expect(JSON.stringify(redactRequest(create!))).not.toMatch(/xero-at|DE89370400440532013000/);
  });

  it("books a journal entry as a DRAFT manual journal: debits positive, credits negative, accounts mapped, no tax", async () => {
    const tr = new RecordingTransport((req) => req.method === "GET" ? json({ ManualJournals: [] }) : json({ ManualJournals: [{ ManualJournalID: "a1b2c3d4-0000-4000-8000-000000000001", Narration: narrationOf(sampleJournal()), Status: "DRAFT" }] }));
    const out = await pushBooked(new XeroConnector(cfg, tr, staticToken("t")), { journals: [sampleJournal()] });
    expect(out[0]).toMatchObject({ outcome: "pushed", externalId: "a1b2c3d4-0000-4000-8000-000000000001" });
    expect(decodeURIComponent(tr.sent[0]!.url)).toBe(`${XERO}/ManualJournals?where=Narration=="SWIFT fee, Airwallex [Purser JE-1]"`);
    expect(body(tr.sent[1]!)).toEqual({ ManualJournals: [{ Narration: "SWIFT fee, Airwallex [Purser JE-1]", Date: "2026-11-20", Status: "DRAFT", LineAmountTypes: "NoTax", JournalLines: [
      { LineAmount: 13.42, AccountCode: "404", Description: "Bank and transfer fees" },
      { LineAmount: -13.42, AccountCode: "090", Description: "Airwallex EUR" },
    ] }] });
  });

  it("finds what a lost answer already made instead of sending it twice", async () => {
    const tr = new RecordingTransport((req) => req.url.includes("/Contacts") ? json({ Contacts: [{ ContactID: "bd2270c3-8706-4c11-9cfb-000b551c3f51" }] }) : json({ ManualJournals: [{ ManualJournalID: "a1b2c3d4-0000-4000-8000-000000000001", Narration: "SWIFT fee, Airwallex [Purser JE-1]" }] }));
    const out = await pushBooked(new XeroConnector(cfg, tr, staticToken("t")), { vendors: [sampleVendor()], journals: [sampleJournal()] });
    expect(out.map((o) => o.outcome)).toEqual(["found_existing", "found_existing"]);
    expect(tr.sent.every((r) => r.method === "GET")).toBe(true);
  });

  it("refuses a journal in another currency, one that does not balance, and keeps Xero's own words on a refusal", async () => {
    const tr = new RecordingTransport((req) => req.method === "GET" ? json({ ManualJournals: [] }) : json({ ErrorNumber: 10, Type: "ValidationException", Message: "A validation exception occurred", Elements: [{ ValidationErrors: [{ Message: "Account code '999' is not a valid code for this document." }] }] }, 400));
    const x = new XeroConnector(cfg, tr, staticToken("t"));
    const usd = { ...sampleJournal(), id: "JE-USD", currency: "USD" };
    const unbalanced = { ...sampleJournal(), id: "JE-2", lines: [sampleJournal().lines[0]!, { ...sampleJournal().lines[1]!, creditCents: 1 }] };
    const out = await pushBooked(x, { journals: [usd, unbalanced, { ...sampleJournal(), id: "JE-3" }] });
    expect(out[0]).toMatchObject({ outcome: "failed", detail: expect.stringMatching(/organisation's EUR only/) });
    expect(out[1]).toMatchObject({ outcome: "invalid", detail: expect.stringMatching(/does not balance/) });
    expect(out[2]).toMatchObject({ outcome: "failed", detail: expect.stringMatching(/validation: .*Account code '999' is not a valid code/) });
    expect(xeroError("not json")).toBe("");
  });

  it("refreshes with the rotating refresh token under the store, as HTTP Basic, and saves the new one first", async () => {
    let now = Date.parse("2026-11-19T09:00:00Z");
    const store = memoryTokenStore();
    let n = 0;
    const tr = new RecordingTransport((): HttpResponse => { n++; return json({ access_token: `at-${n}`, expires_in: 1800, refresh_token: `rt-${n}`, token_type: "Bearer" }); });
    const t = xeroTokens({ clientId: "cid", clientSecret: "csecret", store, seedRefreshToken: "rt-0", transport: tr, now: () => now });
    expect(await t.token()).toBe("at-1");
    expect(store.current()!.refresh_token).toBe("rt-1");
    expect(await t.token()).toBe("at-1");
    now += 1800_000;
    expect(await t.token()).toBe("at-2");
    expect(tr.sent[0]).toMatchObject({ method: "POST", url: "https://identity.xero.com/connect/token" });
    expect(tr.sent[0]!.headers.authorization).toBe(`Basic ${Buffer.from("cid:csecret").toString("base64")}`);
    expect(new URLSearchParams(tr.sent[1]!.body as string).get("refresh_token")).toBe("rt-1");
    expect(redactRequest(tr.sent[1]!).body).not.toContain("rt-1");
  });

  it("lists the organisations a token reaches, and reads its settings from the environment", async () => {
    const tr = new RecordingTransport(() => json([{ id: "e1eede29-f875-4a5d-8470-17f6a29a88b1", authEventId: "d99ecdfe-391d-43d2-b834-17636ba90e8d", tenantId: TENANT, tenantType: "ORGANISATION", tenantName: "Northwind Outdoor", createdDateUtc: "2026-11-19T09:00:00.0000000", updatedDateUtc: "2026-11-19T09:00:00.0000000" }]));
    expect(await xeroTenants(tr, staticToken("t"))).toEqual([{ tenantId: TENANT, type: "ORGANISATION", name: "Northwind Outdoor" }]);
    expect(tr.sent[0]!.url).toBe("https://api.xero.com/connections");
    expect(xeroConfigFromEnv({ ERP_XERO_TENANT_ID: TENANT, ERP_XERO_GL_MAP: '{"6800":"404"}' })).toMatchObject({ tenantId: TENANT, journalStatus: "DRAFT", baseCurrency: "EUR", glMap: { "6800": "404" } });
    expect(() => xeroConfigFromEnv({})).toThrow(/^ERP_XERO_TENANT_ID is not set$/);
    expect(() => xeroConfigFromEnv({ ERP_XERO_TENANT_ID: TENANT, ERP_XERO_JOURNAL_STATUS: "PAID" })).toThrow(/DRAFT or POSTED/);
    expect(() => new XeroConnector({ ...cfg, tenantId: "not-a-guid" }, tr, staticToken("t"))).toThrow(/not a GUID/);
    expect(contactNumberOf("V-1")).toBe("PURSER-V-1");
  });
});

describe("Exact Online: the existing connector, through the same push", () => {
  const BASE = "https://start.exactonline.nl/api/v1/123456";
  const config: ExactConfig = {
    baseUrl: "https://start.exactonline.nl", division: 123456, purchaseJournal: "60", bankJournals: { "1200": "20" }, generalJournal: "90",
    vatCodes: { NL21: "2", NL9: "1", NL0: "0", EU_RC: "6", NONEU_RC: "7", EXEMPT: "0", NONE: "0" }, glMap: {}, apAccount: "1600", paymentSign: -1,
  };
  const ok = (d: unknown, status = 200): HttpResponse => ({ status, headers: {}, body: JSON.stringify({ d }) });

  it("pushes a supplier as a crm/Accounts record and a journal entry as a GeneralJournalEntries record", async () => {
    const tr = new RecordingTransport((req) => {
      if (req.method === "GET" && req.url.startsWith(`${BASE}/financial/GLAccounts`)) return ok({ results: [{ ID: "aaaaaaaa-0000-0000-0000-000000006800", Code: "6800", Description: "Bankkosten" }, { ID: "aaaaaaaa-0000-0000-0000-000000001200", Code: "1200", Description: "Bank" }] });
      if (req.method === "GET") return ok({ results: [] });
      if (req.url.endsWith("/crm/Accounts")) return ok({ ID: "11111111-2222-3333-4444-555555555555" }, 201);
      if (req.url.endsWith("/crm/BankAccounts")) return ok({ ID: "bank-1" }, 201);
      if (req.url.endsWith("/generaljournalentry/GeneralJournalEntries")) return ok({ EntryID: "entry-guid" }, 201);
      throw new Error(`unexpected ${req.method} ${req.url}`);
    });
    const exact: BooksPush = new ExactConnector(config, tr, staticToken("exact-at"));
    const out = await pushBooked(exact, { vendors: [sampleVendor()], journals: [sampleJournal()] });
    expect(out.map((o) => [o.outcome, o.externalId])).toEqual([["pushed", "11111111-2222-3333-4444-555555555555"], ["pushed", "entry-guid"]]);
    const posts = tr.sent.filter((r) => r.method === "POST").map((r) => r.url.slice(BASE.length));
    expect(posts).toEqual(["/crm/Accounts", "/crm/BankAccounts", "/generaljournalentry/GeneralJournalEntries"]);
    expect(body(tr.sent.find((r) => r.url.endsWith("GeneralJournalEntries"))!)).toMatchObject({ JournalCode: "90", Currency: "EUR", GeneralJournalEntryLines: [{ AmountFC: 13.42 }, { AmountFC: -13.42 }] });
  });

  it("Moneybird's connector has the same shape (a compile-time check)", () => {
    const shape = (c: MoneybirdConnector): BooksPush => c;
    expect(typeof shape).toBe("function");
  });
});

describe("the payables journal as journal entries", () => {
  it("groups an invoice's accrual into one balanced entry, the same id each time", async () => {
    const dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "workplace-books-"));
    try {
      const db = openDb(":memory:");
      const parserOnly: Asker = { ask: async (_a, fallback) => ({ value: fallback(), source: "fallback", model: null, note: "no key" }) } as Asker;
      await ingestDocument(db, { dir, reader: parserOnly, now: () => new Date("2026-11-19T09:00:00Z") }, { bytes: await pdfOf(NL), filename: "zv.pdf", source: "upload" });
      const journals = journalsFromApEntries(apJournal(db));
      expect(journals.length).toBeGreaterThan(0);
      for (const j of journals) expect(validateJournal(j)).toEqual([]);
      expect(journals[0]!.id).toMatch(/^AP-0001-accrual-\d{4}-\d{2}-\d{2}$/);
      expect(journalsFromApEntries(apJournal(db))).toEqual(journals);
      const total = journals[0]!.lines.reduce((s, l) => s + l.creditCents, 0);
      expect(total).toBe(48_400);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
