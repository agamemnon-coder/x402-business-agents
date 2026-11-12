// The Moneybird sandbox run's test world (src/erp/sandboxWorld.ts) through the whole ERP link, offline: built with the
// real engine on stand-in rails, sent through the connector to a stand-in administration that carries the sandbox
// administration's real chart and tax rates (as its API listed them on 12 November 2026) and checks every request
// against Moneybird's own OpenAPI request schemas, then corrected, read back, reconciled to the cent and sent again.
// No network: this is the rehearsal of the live run, and it stays as its regression test. The last part holds the live
// run's record and its page (docs/runs/2026-11-12-moneybird-sandbox.*) to what Moneybird answered that day.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDb, type DB } from "../src/db/open.js";
import { WORLD } from "../src/e2e/world.js";
import { staticToken } from "../src/erp/auth.js";
import { runErpCli } from "../src/erp/cli.js";
import type { JournalEntry, Payment, PurchaseInvoice, Vendor } from "../src/erp/model.js";
import { validate } from "../src/erp/model.js";
import { RecordingTransport } from "../src/erp/connector.js";
import { MONEYBIRD_BASE_URL, moneybirdCallName, MoneybirdConnector, type MoneybirdConfig } from "../src/erp/moneybird.js";
import { cents, reconcile, type Reconciliation } from "../src/erp/readback.js";
import { buildRunRecord, runRecordMarkdown, type RunRecord, type RunStep } from "../src/erp/runRecord.js";
import { buildSandboxWorld, LOW_VAT_INVOICE, PAID_INVOICE, RECODED_INVOICE, recodeSandboxInvoice, SANDBOX_COMPANY, sandboxInvoices, type SandboxWorldSummary } from "../src/erp/sandboxWorld.js";
import { ledgerItems } from "../src/erp/source.js";
import { correct, syncAll, syncStatus } from "../src/erp/sync.js";
import { FakeMoneybird, type LedgerAccount, type TaxRate } from "./fakes/moneybird.js";

const noSleep = async () => {};
interface Answer { method: string; url: string; status: number; headers: Record<string, string>; body: string }
const SANDBOX = JSON.parse(readFileSync(resolve(import.meta.dirname, "fixtures/moneybird/sandbox-2026-11-12.json"), "utf8")) as { answers: Answer[] };
const realLedger = JSON.parse(SANDBOX.answers.find((a) => a.url.includes("/ledger_accounts.json"))!.body) as LedgerAccount[];
const realTax = JSON.parse(SANDBOX.answers.find((a) => a.url.includes("/tax_rates.json"))!.body) as TaxRate[];
const NOTES = readFileSync(resolve(import.meta.dirname, "../docs/runs/2026-11-12-moneybird-sandbox.md"), "utf8");

/** The run's two maps, from the names in the run notes and the ids in the pulled answers (as the run's settings were built). */
function mapsFromNotes(): Pick<MoneybirdConfig, "taxRates" | "glMap"> {
  const taxRates: Record<string, string> = {};
  for (const m of NOTES.matchAll(/^\| `([A-Z0-9_]+)` \| ([^|`]+) \| (purchase_invoice) \|$/gm)) taxRates[m[1]!] = realTax.find((t) => t.name === m[2]!.trim() && t.tax_rate_type === m[3])!.id;
  const glMap: Record<string, string> = {};
  for (const m of NOTES.matchAll(/^\| `(\d{4})` [^|]+ \| ([^|`]+) \| [^|]+ \|$/gm)) glMap[m[1]!] = realLedger.find((l) => l.name === m[2]!.trim())!.id;
  return { taxRates, glMap };
}
const account = (name: string) => realLedger.find((l) => l.name === name)!.id;

let dir: string;
let db: DB;
let world: SandboxWorldSummary;
let fake: FakeMoneybird;
const connector = () => new MoneybirdConnector({ baseUrl: "https://moneybird.com/api/v2", administrationId: fake.admin, baseCurrency: "EUR", projects: {}, ignoreCostCentres: true, ...mapsFromNotes() }, fake.transport, staticToken(fake.token));

beforeAll(async () => {
  dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "erp-sandbox-world-"));
  db = openDb(join(dir, "ledger.db"));
  world = await buildSandboxWorld(db, join(dir, "world"));
  fake = new FakeMoneybird({ ledger: realLedger, tax: realTax });
}, 60_000);
afterAll(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });

describe("the sandbox run's test world", () => {
  it("is one fixture company with the fixtures' four invoices: suppliers, numbers and net amounts kept, one at 9% VAT", () => {
    expect(world.company).toBe(SANDBOX_COMPANY);
    expect(SANDBOX_COMPANY).toBe("Bakkerij De Test (fake)");
    const fixtures = WORLD.flatMap((c) => c.invoices);
    expect(world.invoices.map((i) => `${i.number}.pdf`)).toEqual(fixtures.map((f) => f.filename));
    for (const [i, inv] of world.invoices.entries()) {
      expect(fixtures[i]!.text.split("\n")[0]).toBe(inv.supplier);
      expect(fixtures[i]!.text).toContain(`Subtotaal € ${inv.net.replace(".", ",")}`);
    }
    // The one change, said out loud: the fixtures hold no invoice at the low rate.
    expect(fixtures.every((f) => f.text.includes("BTW 21%"))).toBe(true);
    expect(sandboxInvoices().filter((s) => s.changed).map((s) => s.filename)).toEqual([`${LOW_VAT_INVOICE}.pdf`]);
    expect(world.invoices.map((i) => [i.number, i.net, i.vat, i.total, i.status])).toEqual([
      ["ZV-5001", "4.00", "0.84", "4.84", "waiting_cfo"], ["MM-2026-114", "3.00", "0.27", "3.27", "waiting_cfo"], ["VE-889", "2.00", "0.42", "2.42", "paid"], ["OD-77", "5.00", "1.05", "6.05", "waiting_cfo"],
    ]);
    expect(world.paid).toMatchObject({ invoice: expect.stringContaining(PAID_INVOICE) as string, amount: "EUR 2.42" });
  });

  it("feeds the ERP four suppliers, four invoices with their PDF, the one payment and the card purchase as a journal entry", () => {
    const items = ledgerItems(db);
    expect(items.map((i) => i.kind)).toEqual(["vendor", "vendor", "vendor", "vendor", "invoice", "invoice", "invoice", "invoice", "payment", "journal"]);
    for (const i of items) expect({ id: i.object.id, errs: validate(i.kind, i.object) }).toEqual({ id: i.object.id, errs: [] });
    const invoices = items.filter((i) => i.kind === "invoice").map((i) => i.object as PurchaseInvoice);
    expect(Object.fromEntries(invoices.map((i) => [i.number, i.lines.map((l) => l.vatCode).join()]))).toEqual({ "ZV-5001": "NL21", "MM-2026-114": "NL9", "VE-889": "NL21", "OD-77": "NL21" });
    for (const inv of invoices) {
      expect(inv.pdf?.fileName).toBe(`${inv.number}.pdf`);
      expect(Buffer.from(inv.pdf!.bytes.subarray(0, 5)).toString("latin1")).toBe("%PDF-");
    }
    for (const v of items.filter((i) => i.kind === "vendor").map((i) => i.object as Vendor)) expect(v.name).toMatch(/\(test\)$/);
    const pay = items.find((i) => i.kind === "payment")!.object as Payment;
    expect(pay).toMatchObject({ amountCents: 242, currency: "EUR", bankAccount: "1200" });
    const j = items.find((i) => i.kind === "journal")!.object as JournalEntry;
    expect(j.lines.map((l) => [l.glAccount, l.debitCents, l.creditCents])).toEqual([["6100", 1999, 0], ["1200", 0, 1999]]);
  });

  it("an inbox invoice whose stored file is gone goes to the ERP without a PDF, not with a broken one", () => {
    const copy = openDb(":memory:");
    for (const t of ["beneficiaries", "invoices", "ap_documents", "ap_invoices"]) {
      const rows = db.prepare(`SELECT * FROM ${t}`).all() as Record<string, unknown>[];
      for (const r of rows) copy.prepare(`INSERT INTO ${t} (${Object.keys(r).join(", ")}) VALUES (${Object.keys(r).map(() => "?").join(", ")})`).run(...Object.values(r));
    }
    copy.prepare("UPDATE ap_documents SET path = path || '.gone'").run();
    const invoices = ledgerItems(copy).filter((i) => i.kind === "invoice").map((i) => i.object as PurchaseInvoice);
    expect(invoices).toHaveLength(4);
    expect(invoices.every((i) => i.pdf === undefined)).toBe(true);
    copy.close();
  });
});

describe("the sandbox run, rehearsed on the administration's real chart and tax rates", () => {
  let rec: Reconciliation;

  it("the first sync sends everything in 16 requests, each in Moneybird's own shape, on ids the pull listed", async () => {
    const res = await syncAll(db, connector(), ledgerItems(db), { sleep: noSleep });
    expect(res.map((r) => r.outcome)).toEqual(Array.from({ length: 10 }, () => "pushed"));
    expect(fake.refused).toEqual([]);
    expect(fake.transport.sent.map((r) => `${r.method} ${fake.path(r).replace(/\?.*/, "").replace(/\d{6,}/, "{id}")}`)).toEqual([
      "POST /contacts.json", "POST /contacts.json", "POST /contacts.json", "POST /contacts.json",
      "GET /tax_rates.json", "GET /ledger_accounts.json",
      "POST /documents/purchase_invoices.json", "POST /documents/purchase_invoices/{id}/attachments.json",
      "POST /documents/purchase_invoices.json", "POST /documents/purchase_invoices/{id}/attachments.json",
      "POST /documents/purchase_invoices.json", "POST /documents/purchase_invoices/{id}/attachments.json",
      "POST /documents/purchase_invoices.json", "POST /documents/purchase_invoices/{id}/attachments.json",
      "POST /documents/purchase_invoices/{id}/payments.json", "POST /documents/general_journal_documents.json",
    ]);
    // A contact carries a name and Purser's own id for it: no e-mail address, no bank account.
    for (const r of fake.posts("/contacts.json")) expect(Object.keys((JSON.parse(r.body as string) as { contact: object }).contact).sort()).toEqual(["company_name", "customer_id"]);
    const invoices = [...fake.invoices.values()];
    expect(invoices.map((i) => [i.reference, i.total_price_excl_tax, i.total_price_incl_tax, i.state, i.attachments.length])).toEqual([
      ["MM-2026-114", "3.0", "3.27", "open", 1], ["OD-77", "5.0", "6.05", "open", 1], ["VE-889", "2.0", "2.42", "paid", 1], ["ZV-5001", "4.0", "4.84", "open", 1],
    ]);
    const rate = (name: string) => realTax.find((t) => t.name === name && t.tax_rate_type === "purchase_invoice")!.id;
    expect(invoices.map((i) => i.details.map((d) => d.tax_rate_id).join())).toEqual([rate("9% btw"), rate("21% btw"), rate("21% btw"), rate("21% btw")]);
    expect(new Set(invoices.flatMap((i) => i.details.map((d) => d.ledger_account_id)))).toEqual(new Set([account("Algemene kosten")]));
    expect([...fake.journals.values()][0]!.entries.map((e) => [e.ledger_account_id, e.debit, e.credit])).toEqual([[account("Algemene kosten"), "19.99", "0.00"], [account("Financiële rekeningen"), "0.00", "19.99"]]);
  });

  it("a person moves an invoice to another account: the sync sends nothing and asks for a correction; the correction sends a credit note and the new version", async () => {
    const before = fake.transport.sent.length;
    const moved = recodeSandboxInvoice(db);
    expect(moved).toMatchObject({ from: "6900", to: "6300" });
    const res = await syncAll(db, connector(), ledgerItems(db), { sleep: noSleep });
    expect(res.filter((r) => r.outcome !== "unchanged").map((r) => [r.id, r.outcome])).toEqual([[moved.ledgerId, "needs_correction"]]);
    expect(fake.transport.sent.length).toBe(before);

    const item = ledgerItems(db).find((i) => i.kind === "invoice" && i.object.id === moved.ledgerId)!;
    const out = await correct(db, connector(), item);
    expect(out.outcome).toBe("corrected");
    expect(fake.transport.sent.slice(before).map((r) => `${r.method} ${fake.path(r).replace(/\?.*/, "").replace(/\d{6,}/, "{id}")}`)).toEqual([
      "GET /tax_rates.json", "GET /ledger_accounts.json", "POST /documents/purchase_invoices.json", "POST /documents/purchase_invoices.json", "POST /documents/purchase_invoices/{id}/attachments.json",
    ]);
    const docs = [...fake.invoices.values()].filter((i) => i.reference.startsWith(RECODED_INVOICE));
    expect(docs.map((i) => [i.reference, i.total_price_incl_tax, i.details[0]!.ledger_account_id])).toEqual([
      ["OD-77", "6.05", account("Algemene kosten")], ["OD-77 (credit note)", "-6.05", account("Algemene kosten")], ["OD-77", "6.05", account("Vervoerskosten")],
    ]);
    const logged = JSON.parse((db.prepare("SELECT payload_json FROM audit_log WHERE event = 'erp.corrected'").get() as { payload_json: string }).payload_json) as Record<string, unknown>;
    expect(logged).toMatchObject({ credited_net_cents: 500, credited_vat_cents: 105, credited_gross_cents: 605, replaced: docs[0]!.id, credit_note: docs[1]!.id, external_id: docs[2]!.id });
  });

  it("read back, every document equals the ledger to the cent: six documents, no difference", async () => {
    const before = fake.transport.sent.length;
    const c = connector();
    rec = await reconcile(db, "moneybird", (id) => c.readPurchaseInvoice(id));
    expect(fake.transport.sent.length - before).toBe(6);
    expect(rec.not_compared).toEqual([]);
    expect(rec.rows.map((r) => [r.role, r.number, r.purser.net, r.purser.vat, r.purser.gross, r.purser.paid, r.purser.state, r.erp.state, r.erp.attachments, r.differences])).toEqual([
      ["invoice", "MM-2026-114", "3.00", "0.27", "3.27", "0.00", "open", "open", 1, []],
      ["invoice", "OD-77", "5.00", "1.05", "6.05", "0.00", "open", "open", 1, []],
      ["replaced", "OD-77", "5.00", "1.05", "6.05", "-", "-", "open", 1, []],
      ["credit_note", "OD-77", "-5.00", "-1.05", "-6.05", "-", "-", "open", 0, []],
      ["invoice", "VE-889", "2.00", "0.42", "2.42", "2.42", "paid", "paid", 1, []],
      ["invoice", "ZV-5001", "4.00", "0.84", "4.84", "0.00", "open", "open", 1, []],
    ]);
    expect(rec).toMatchObject({ documents: 6, differences: 0 });
    for (const r of rec.rows) expect(r.erp).toMatchObject({ net: r.purser.net, vat: r.purser.vat, gross: r.purser.gross });
  });

  it("names every difference with both amounts when the ERP holds something else", async () => {
    const c = connector();
    const paid = [...fake.invoices.values()].find((i) => i.reference === "VE-889")!;
    const open = [...fake.invoices.values()].find((i) => i.reference === "ZV-5001")!;
    const kept = { state: paid.state, payments: paid.payments, total: open.total_price_incl_tax, attachments: open.attachments };
    paid.state = "open"; paid.payments = []; open.total_price_incl_tax = "4.85"; open.attachments = [];
    const bad = await reconcile(db, "moneybird", (id) => c.readPurchaseInvoice(id));
    paid.state = kept.state; paid.payments = kept.payments; open.total_price_incl_tax = kept.total; open.attachments = kept.attachments;
    expect(bad.rows.find((r) => r.number === "VE-889")!.differences).toEqual(["paid: Purser 2.42, the ERP 0.00", "state: Purser paid, the ERP open"]);
    expect(bad.rows.find((r) => r.number === "ZV-5001")!.differences).toEqual(["VAT: Purser 0.84, the ERP 0.85", "gross: Purser 4.84, the ERP 4.85", "the PDF is not attached in the ERP"]);
    expect(bad.differences).toBe(5);
  });

  it("the same sync again sends nothing: every object is unchanged", async () => {
    const before = fake.transport.sent.length;
    const res = await syncAll(db, connector(), ledgerItems(db), { sleep: noSleep });
    expect(res.map((r) => r.outcome)).toEqual(Array.from({ length: 10 }, () => "unchanged"));
    expect(fake.transport.sent.length).toBe(before);
    expect(syncStatus(db, "moneybird").every((r) => r.status === "synced")).toBe(true);
  });

  it("the run record is built from the call log, the audit log, the steps and the read-back, and its page is generated from it", () => {
    const at = (s: number) => new Date(Date.UTC(2026, 10, 12, 12, 0, s)).toISOString();
    const E = `moneybird.com/api/v2/${fake.admin}`;
    const calls = [
      { at: at(1), method: "POST", endpoint: `${E}/contacts.json` }, { at: at(2), method: "POST", endpoint: `${E}/documents/purchase_invoices.json` },
      { at: at(31), method: "GET", endpoint: `${E}/documents/purchase_invoices/{id}.json` },
    ];
    const steps: RunStep[] = [{ step: "sync", started_at: at(0), ended_at: at(10), exit: 0 }, { step: "sync again", started_at: at(20), ended_at: at(25), exit: 0 }, { step: "read back", started_at: at(30), ended_at: at(40), exit: 0 }];
    const r = buildRunRecord(db, { connector: "moneybird", administration: fake.admin, sandboxOnly: true, calls, approved: 44, steps, reconciliation: rec, idempotencyStep: "sync again" });
    expect(r.calls).toMatchObject({ approved: 44, used: 3, outside_steps: 0, off_the_list: 0 });
    expect(r.calls.by_step.map((s) => [s.step, s.calls])).toEqual([["sync", 2], ["sync again", 0], ["read back", 1]]);
    expect(r.idempotency).toEqual({ step: "sync again", requests: 0 });
    // The stand-in is not the sandbox administration, so that label is not earned here; the other two are.
    expect(r.labels).toEqual(["test data", "no e-mail sent"]);
    expect(r.sent.map((s) => s.event)).toEqual([...Array.from({ length: 10 }, () => "erp.pushed"), "erp.needs_correction", "erp.corrected"]);
    expect(r.sent.every((s) => s.event === "erp.needs_correction" || /^\d+$/.test(s.external_id ?? ""))).toBe(true);
    expect(r.objects).toHaveLength(10);
    // A request to anything off the connector's list takes the "no e-mail sent" label away.
    const off = buildRunRecord(db, { connector: "moneybird", administration: fake.admin, sandboxOnly: true, calls: [...calls, { at: at(3), method: "PATCH", endpoint: `${E}/sales_invoices/{id}/send_invoice.json` }], approved: 44, steps, reconciliation: null });
    expect(off.calls.off_the_list).toBe(1);
    expect(off.labels).toEqual(["test data"]);
    const md = runRecordMarkdown(r);
    expect(md).toContain("**Requests: 3 of the 44 approved.**");
    expect(md).toContain("**Read back and reconciled: 0 differences in 6 documents.**");
    expect(md).toContain('**The same sync run again (step "sync again") made 0 requests.**');
    expect(md).toContain("| credit note | OD-77 |");
  });

  it("the CLI prints the record, and its dry run shows the same 16 requests on the run's own maps without sending", async () => {
    const lines: string[] = [];
    const log = join(dir, "calls.jsonl");
    writeFileSync(log, "");
    const env = { ERP_CALL_LOG: log, ERP_CALL_BUDGET: "44", ERP_MONEYBIRD_TOKEN: "placeholder", ERP_MONEYBIRD_ADMINISTRATION_ID: "503585935808530148", ERP_MONEYBIRD_SANDBOX_ONLY: "on", ERP_MONEYBIRD_IGNORE_COST_CENTRES: "on",
      ERP_MONEYBIRD_TAX_RATES: JSON.stringify(mapsFromNotes().taxRates), ERP_MONEYBIRD_GL_MAP: JSON.stringify(mapsFromNotes().glMap) };
    expect(await runErpCli(["record", "--connector", "moneybird"], { db, env, out: (l) => lines.push(l) })).toBe(0);
    expect(JSON.parse(lines.join("\n"))).toMatchObject({ connector: "moneybird", administration: "503585935808530148", calls: { approved: 44, used: 0 }, labels: ["Moneybird sandbox administration", "test data", "no e-mail sent"] });

    // A fresh copy of the world's feed, nothing sent yet: the dry run takes the run's own ids at their word.
    const fresh = openDb(":memory:");
    const items = ledgerItems(db);
    lines.length = 0;
    expect(await runErpCli(["sync", "--connector", "moneybird", "--dry-run"], { db: fresh, env, out: (l) => lines.push(l), items: () => items })).toBe(0);
    fresh.close();
    expect(lines[0]).toBe("Dry run for Moneybird: nothing is sent.");
    expect(lines).toContain("16 requests would be sent:");
    expect(lines.filter((l) => / pushed$/.test(l))).toHaveLength(10);
    const shown = lines.join("\n");
    expect(shown).toContain(`"ledger_account_id":"${account("Vervoerskosten")}"`);
    expect(shown).toContain(`"tax_rate_id":"${mapsFromNotes().taxRates.NL9}"`);
    expect(shown).not.toContain("placeholder");
    expect(readFileSync(log, "utf8")).toBe("");
  });
});

describe("the live run of 12 November 2026, as recorded", () => {
  interface Live { at: string; method: string; path: string; status: number; answer?: unknown; same_as_step_1?: boolean; rows?: number }
  const ADMIN = "503585935808530148";
  const LIVE = JSON.parse(readFileSync(resolve(import.meta.dirname, "fixtures/moneybird/sandbox-2026-11-12-sync.json"), "utf8")) as { answers: Live[] };
  const RECORD = JSON.parse(readFileSync(resolve(import.meta.dirname, "../docs/runs/2026-11-12-moneybird-sandbox.json"), "utf8")) as RunRecord;
  const rec = RECORD.reconciliation!;

  it("the record: within the approved number, nothing off the connector's list, no difference, nothing sent twice", () => {
    expect(RECORD.administration).toBe(ADMIN);
    expect(RECORD.labels).toEqual(["Moneybird sandbox administration", "test data", "no e-mail sent"]);
    expect(RECORD.calls.used).toBeLessThanOrEqual(RECORD.calls.approved);
    expect(RECORD.calls.by_endpoint.reduce((s, e) => s + e.calls, 0)).toBe(RECORD.calls.used);
    expect(RECORD.calls.off_the_list).toBe(0);
    for (const e of RECORD.calls.by_endpoint) expect(e.endpoint).not.toMatch(/send|mail|remind/i);
    // The requests outside step 2's steps are step 1's pull, and step 2's answers are all in the fixture.
    expect(RECORD.calls.outside_steps).toBe(SANDBOX.answers.length);
    expect(LIVE.answers).toHaveLength(RECORD.calls.used - SANDBOX.answers.length);
    expect(rec).toMatchObject({ differences: 0, not_compared: [] });
    expect(rec.rows.every((r) => r.differences.length === 0)).toBe(true);
    expect(RECORD.idempotency).toEqual({ step: "sync-again", requests: 0 });
    expect(RECORD.objects.every((o) => o.status === "synced" && /^\d{15,}$/.test(o.external_id ?? ""))).toBe(true);
    // No secret and nothing personal: no token, no header, no user id, no portal link.
    const text = JSON.stringify(RECORD) + JSON.stringify(LIVE.answers);
    expect(text).not.toMatch(/bearer|authorization|user_id|sales_invoices_url|placeholder/i);
  });

  it("every live request was on the connector's list, in the sandbox administration, and was answered 200 or 201", () => {
    const cfg = { baseUrl: MONEYBIRD_BASE_URL, administrationId: ADMIN, sandboxOnly: true };
    const named = LIVE.answers.map((a) => `${a.method} ${moneybirdCallName({ method: a.method as "GET" | "POST", url: `${MONEYBIRD_BASE_URL}/${a.path}` }, cfg)}`);
    const counted = new Map<string, number>();
    for (const n of named) counted.set(n, (counted.get(n) ?? 0) + 1);
    // With step 1's three requests, these are the record's counts per endpoint.
    for (const a of SANDBOX.answers) { const n = `${a.method} ${moneybirdCallName({ method: a.method as "GET", url: a.url }, cfg)}`; counted.set(n, (counted.get(n) ?? 0) + 1); }
    expect(Object.fromEntries(counted)).toEqual(Object.fromEntries(RECORD.calls.by_endpoint.map((e) => [e.endpoint, e.calls])));
    expect(LIVE.answers.every((a) => a.status === 200 || a.status === 201)).toBe(true);
    // The lookups of step 2 got the lists of step 1 again.
    const lists = LIVE.answers.filter((a) => a.same_as_step_1 !== undefined);
    expect(lists.every((a) => a.same_as_step_1)).toBe(true);
    expect(NOTES).toContain(`all ${LIVE.answers.length} requests of step 2 were answered 200 or 201`);
    expect(NOTES).toContain(`each of the ${lists.length} later lookups got the same`);
  });

  it("the read-back, replayed from Moneybird's own answers, gives the record's reconciliation", async () => {
    const transport = new RecordingTransport((req) => {
      const path = req.url.slice(`${MONEYBIRD_BASE_URL}/`.length);
      const a = LIVE.answers.filter((x) => x.method === req.method && x.path === path).at(-1);
      if (!a) throw new Error(`not asked live: ${req.method} ${path}`);
      return { status: a.status, headers: {}, body: JSON.stringify(a.answer) };
    });
    const c = new MoneybirdConnector({ baseUrl: MONEYBIRD_BASE_URL, administrationId: ADMIN, baseCurrency: "EUR", projects: {}, ignoreCostCentres: true, sandboxOnly: true, ...mapsFromNotes() }, transport, staticToken("placeholder"));
    for (const row of rec.rows) {
      const d = await c.readPurchaseInvoice(row.external_id);
      const vat = d.grossCents! - d.netCents!;
      expect({ net: cents(d.netCents), vat: cents(vat), gross: cents(d.grossCents), paid: cents(d.payments.reduce((s, p) => s + p.cents!, 0)), state: d.state, attachments: d.attachments, payments: d.payments.length, reference: d.reference })
        .toEqual({ net: row.erp.net, vat: row.erp.vat, gross: row.erp.gross, paid: row.erp.paid, state: row.erp.state, attachments: row.erp.attachments, payments: row.erp.payments, reference: row.erp.reference });
      // The ledger account and tax rate on each line are ones the pull listed, where the run's maps point.
      for (const l of d.lines) {
        expect(realLedger.find((x) => x.id === l.ledgerAccountId)?.allowed_document_types).toContain("purchase_invoice");
        expect(realTax.find((x) => x.id === l.taxRateId)?.tax_rate_type).toBe("purchase_invoice");
      }
    }
    expect(transport.sent).toHaveLength(rec.documents);
    // What the world sends offline is what Moneybird held: the same six documents, the same amounts and states.
    const live = rec.rows.map((r) => [r.role, r.number, r.erp.net, r.erp.vat, r.erp.gross, r.erp.paid, r.erp.state, r.erp.attachments]);
    expect(live).toEqual([
      ["invoice", "MM-2026-114", "3.00", "0.27", "3.27", "0.00", "open", 1], ["invoice", "OD-77", "5.00", "1.05", "6.05", "0.00", "open", 1],
      ["replaced", "OD-77", "5.00", "1.05", "6.05", "0.00", "open", 1], ["credit_note", "OD-77", "-5.00", "-1.05", "-6.05", "0.00", "open", 0],
      ["invoice", "VE-889", "2.00", "0.42", "2.42", "2.42", "paid", 1], ["invoice", "ZV-5001", "4.00", "0.84", "4.84", "0.00", "open", 1],
    ]);
    // The moved invoice's new version is on the transport account; its first version and the credit note are not.
    const lineOf = (role: string) => rec.rows.find((r) => r.number === RECODED_INVOICE && r.role === role)!.erp.lines[0]!.ledger_account_id;
    expect([lineOf("invoice"), lineOf("replaced"), lineOf("credit_note")]).toEqual([account("Vervoerskosten"), account("Algemene kosten"), account("Algemene kosten")]);
  });

  it("what the answers taught: the payment's account, the attachment's answer, a contact with no address", () => {
    const of = (part: string, method = "POST") => LIVE.answers.filter((a) => a.method === method && a.path.split("?")[0]!.endsWith(part));
    const payment = of("/payments.json")[0]!.answer as { ledger_account_id: string; financial_account_id: string | null; transaction_identifier: string; price: string };
    expect(realLedger.find((l) => l.id === payment.ledger_account_id)?.name).toBe("Te rubriceren betalingen");
    expect(payment.financial_account_id).toBeNull();
    expect(of("/attachments.json").map((a) => [a.status, a.answer])).toEqual(Array.from({ length: 5 }, () => [200, "200"]));
    for (const a of of("/contacts.json")) expect(a.answer).toMatchObject({ email: "", send_invoices_to_email: "", delivery_method: "Email", bank_account: "" });
    const created = of("/documents/purchase_invoices.json").map((a) => a.answer as { reference: string; state: string });
    expect(created.map((x) => x.state)).toEqual(Array.from({ length: 6 }, () => "open"));
    expect(created.filter((x) => x.reference === RECODED_INVOICE)).toHaveLength(2);
  });

  it("the run notes carry the record's own tables and figures", () => {
    const block = /<!-- record:start -->\n([\s\S]*?)\n<!-- record:end -->/.exec(NOTES)?.[1];
    expect(block).toBe(runRecordMarkdown(RECORD));
    const count = (kind: string, event = "erp.pushed") => RECORD.sent.filter((s) => s.kind === kind && s.event === event).length;
    expect(NOTES).toContain(`${count("vendor")} suppliers, ${count("invoice")} purchase invoices with their PDF, ${count("payment")} payment, ${count("journal")} journal entry and ${count("invoice", "erp.corrected")} correction`);
    expect(NOTES).toContain(`all ${rec.documents} purchase invoices in Moneybird equal Purser's ledger to the cent:\n${rec.differences} differences`);
    expect(NOTES).toContain(`The same sync run again made ${RECORD.idempotency!.requests} requests. The run used ${RECORD.calls.used} of the ${RECORD.calls.approved} approved requests.`);
    expect(NOTES).toContain(`**Labels: ${RECORD.labels.join("; ")}.**`);
    expect(NOTES).toContain(`| Calls | ${RECORD.calls.used} of the ${RECORD.calls.approved} approved for the whole run.`);
    expect(NOTES).toContain(`The first part was capped at ${RECORD.calls.by_step.find((s) => s.step === "sync-1")!.calls} requests`);
    expect(NOTES).toContain(`The ${RECORD.calls.outside_steps} requests outside these steps are the pull of step 1.`);
    // The test world's table is the world's own.
    for (const i of world.invoices) expect(NOTES).toContain(`| \`${i.number}\` | ${i.supplier} | ${i.net} | ${i.vat} (${i.number === LOW_VAT_INVOICE ? 9 : 21}%) | ${i.total} |`);
    // The wording for other pages repeats the same figures.
    const wording = NOTES.slice(NOTES.indexOf("## Wording to apply"));
    expect(wording).toContain(`${rec.documents} purchase invoices read back, ${rec.differences} differences with the ledger; a second sync made ${RECORD.idempotency!.requests} requests; ${RECORD.calls.used} requests`);
    expect(wording).toContain(`| Stats | ${RECORD.calls.used} of ${RECORD.calls.approved} requests; ${rec.documents} documents reconciled; ${rec.differences} differences |`);
    expect(wording).not.toMatch(/certified by|endorsed by|approved by/i);
  });
});

describe("what the docs say about the Moneybird run", () => {
  const RECORD = JSON.parse(readFileSync(resolve(import.meta.dirname, "../docs/runs/2026-11-12-moneybird-sandbox.json"), "utf8")) as RunRecord;
  const flat = (file: string) => readFileSync(resolve(import.meta.dirname, "..", file), "utf8").replace(/\s+/g, " ");

  it("claims.md repeats the record's figures, and no page says more than ran", () => {
    const rec = RECORD.reconciliation!;
    const count = (kind: string, event = "erp.pushed") => RECORD.sent.filter((s) => s.kind === kind && s.event === event).length;
    expect(flat("docs/claims.md")).toContain(`${count("vendor")} suppliers, ${count("invoice")} purchase invoices with their PDF, ${count("payment")} payment, ${count("journal")} journal entry and ${count("invoice", "erp.corrected")} correction sent; ${rec.documents} purchase invoices read back, ${rec.differences} differences with the ledger to the cent; a second sync made ${RECORD.idempotency!.requests} requests; ${RECORD.calls.used} of ${RECORD.calls.approved} approved requests`);
    for (const f of ["docs/moneybird.md", "docs/erp.md", "docs/claims.md"]) {
      expect(flat(f), f).toMatch(/sandbox administration with test data/);
      expect(flat(f), f).not.toMatch(/certified|endorsed|approved by Moneybird/i);
    }
    expect(flat("docs/moneybird.md")).toMatch(/Not done: a real company's administration, OAuth for customers/);
    expect(flat("docs/erp.md")).toMatch(/Exact Online, Business Central and Odoo have not been tested against a live system yet/);
  });
});
