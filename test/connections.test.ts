// Connections to other systems (13 Nov), read and export only. It holds: a runner's push raises payment.paid,
// approval.needed and books.closed on the company's signed webhook, once, for a change that push made (a backlog's paid
// invoices and a replayed push raise nothing); each event reads as a Slack or Teams message (a format); supplier
// invoices and journals export as CSV in Xero's, QuickBooks Online's and Exact Online's import columns (format exports,
// RFC 4180, no formula injection); the read API has its own OpenAPI; and the catalogue labels every connection honestly.
import { createHmac } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chatMessage, connectionsCatalogue, type BusinessEvent } from "../cloud/src/connections.js";
import { seedTreasury } from "../src/agents/euroBill.js";
import { ingestDocument } from "../src/ap/inbox.js";
import type { Asker } from "../src/ap/read.js";
import { pushToCloud } from "../src/cloudsync/client.js";
import { openDb, type DB } from "../src/db/open.js";
import { postEntry } from "../src/ledger/core.js";
import { EN, NL } from "./fakes/apInvoices.js";
import { FakeAirwallex } from "./fakes/airwallex.js";
import { pdfOf } from "./fakes/pdf.js";
import { ORIGIN, testCloud, type TestCloud } from "./support/cloud.js";

const parserOnly: Asker = { ask: async (_a, fallback) => ({ value: fallback(), source: "fallback", model: null, note: "no key" }) } as Asker;
const NOW = new Date("2026-11-08T12:00:00Z");
let c: TestCloud, db: DB, dir: string;
let tenant: { id: string; key: string; owner: string };
const target = () => ({ url: ORIGIN, key: tenant.key, fetch: c.fetch });
let sent: { url: string; headers: Record<string, string>; body: string }[] = [];

beforeEach(async () => {
  c = testCloud();
  dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "connections-"));
  db = openDb(":memory:");
  tenant = await c.tenant("northwind");
  const awx = new FakeAirwallex();
  await seedTreasury(db, awx, awx);
  await ingestDocument(db, { dir, reader: parserOnly, now: () => NOW }, { bytes: await pdfOf(EN), filename: "bergtex.pdf", source: "upload" });
  await ingestDocument(db, { dir, reader: parserOnly, now: () => NOW }, { bytes: await pdfOf(NL), filename: "zeeland.pdf", source: "upload" });
  postEntry(db, { date: "2026-10-09", description: "Software", created_by: "test", lines: [
    { account: "6100", debit: 5_000, currency: "EUR", vat_code: "P21", vat_cents: 1_050 }, { account: "1510", debit: 1_050, currency: "EUR" }, { account: "1200", credit: 6_050, currency: "EUR" }] }, NOW);
  sent = [];
  c.env.outbound = async (url, init) => { sent.push({ url, headers: init.headers as Record<string, string>, body: String(init.body) }); return new Response("ok", { status: 200 }); };
  c.env.retryDelayMs = 0;
});
afterEach(() => { c.close(); rmSync(dir, { recursive: true, force: true }); });

const events = () => sent.map((s) => JSON.parse(s.body) as { type: string; data: Record<string, string> }).filter((e) => !e.type.startsWith("alert") && !e.type.startsWith("security"));
const ids = () => db.prepare("SELECT id, status FROM ap_invoices ORDER BY id").all() as { id: string; status: string }[];

describe("webhook events from a runner's push", () => {
  it("raise approval.needed and payment.paid once, for changes this push made, signed with the webhook's secret", async () => {
    const secret = (await c.req("POST", "/v1/webhook", { key: tenant.key, body: { url: "https://hooks.example/purser" } })).json.secret as string;
    await pushToCloud(db, target(), NOW);
    expect(events()).toEqual([]);
    const [a, b] = ids();
    db.prepare("UPDATE ap_invoices SET status = 'waiting_cfo', updated_at = ? WHERE id = ?").run("2026-11-08T13:00:00.000Z", a!.id);
    await pushToCloud(db, target(), NOW);
    expect(events()).toEqual([{ id: expect.stringMatching(/^evt_/), type: "approval.needed", created_at: NOW.toISOString(), data: expect.objectContaining({ invoice_id: a!.id, currency: "EUR", approve_in: `${ORIGIN}/#/invoices`, note: expect.stringMatching(/Only the CFO approves/) }) }]);
    db.prepare("UPDATE ap_invoices SET status = 'paid', updated_at = ? WHERE id = ?").run("2026-11-08T14:00:00.000Z", a!.id);
    await pushToCloud(db, target(), NOW);
    expect(events().map((e) => [e.type, e.data.invoice_id])).toEqual([["approval.needed", a!.id], ["payment.paid", a!.id]]);
    // The same push again changes nothing and raises nothing.
    await pushToCloud(db, target(), NOW);
    expect(events()).toHaveLength(2);
    expect(b).toBeTruthy();
    // Each delivery is signed: t=<seconds>,v1=HMAC-SHA256(secret, `${t}.${body}`).
    for (const s of sent) {
      const [, t, v1] = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(s.headers["x-purser-signature"]!)!;
      expect(createHmac("sha256", secret).update(`${t}.${s.body}`).digest("hex")).toBe(v1);
    }
    // No name of a supplier or a person travels in an event.
    expect(sent.map((s) => s.body).join(" ")).not.toMatch(/Bergtex|Zeeland/);
  });

  it("does not announce a backlog's already-paid invoices on the first push, and raises books.closed for a year-end close", async () => {
    await c.req("POST", "/v1/webhook", { key: tenant.key, body: { url: "https://hooks.example/purser" } });
    db.prepare("UPDATE ap_invoices SET status = 'paid'").run();
    await pushToCloud(db, target(), NOW);
    expect(events()).toEqual([]);
    const { closeYear } = await import("../src/ledger/close.js");
    closeYear(db, 2026, "test", new Date("2027-01-05T09:00:00Z"));
    await pushToCloud(db, target(), NOW);
    expect(events()).toEqual([expect.objectContaining({ type: "books.closed", data: expect.objectContaining({ year: "2026", entry_hash: expect.stringMatching(/^[0-9a-f]{64}$/), link: `${ORIGIN}/#/books` }) })]);
    await pushToCloud(db, target(), NOW);
    expect(events()).toHaveLength(1);
  });
});

describe("chat message formats", () => {
  const ev: BusinessEvent[] = [
    { type: "approval.needed", data: { invoice_id: "AP-0005", amount: "1309.00", currency: "EUR", due_date: "2026-11-23", approve_in: `${ORIGIN}/#/invoices`, note: "" } },
    { type: "payment.paid", data: { invoice_id: "AP-0004", amount: "618.80", currency: "EUR", paid_at: "2026-11-07T15:00:02Z", proposal_id: "P-0008", link: `${ORIGIN}/#/invoices` } },
    { type: "books.closed", data: { year: "2026", entry_id: "40", posting_date: "2026-12-31", entry_hash: "a".repeat(64), link: `${ORIGIN}/#/books` } },
  ];
  it("reads each event as a Slack Block Kit message and a Teams Adaptive Card, with a button to Purser and no way to approve", () => {
    for (const e of ev) {
      const s = chatMessage(e, "slack") as { text: string; blocks: { type: string; elements?: { url?: string }[] }[] };
      expect(s.blocks.map((b) => b.type)).toEqual(["header", "section", "actions", "context"]);
      expect(s.blocks[2]!.elements![0]!.url).toMatch(/^https:\/\/cloud\.test\/#\//);
      const t = chatMessage(e, "teams") as { type: string; attachments: { contentType: string; content: { type: string; version: string; actions: { type: string; url: string }[] } }[] };
      expect(t.attachments[0]).toMatchObject({ contentType: "application/vnd.microsoft.card.adaptive", content: { type: "AdaptiveCard", version: "1.5" } });
      expect(t.attachments[0]!.content.actions.map((a) => a.type)).toEqual(["Action.OpenUrl"]);
      expect(JSON.stringify([s, t])).not.toMatch(/Action\.Submit|Action\.Execute|"approve"/);
    }
    expect((chatMessage(ev[0]!, "slack") as { text: string }).text).toMatch(/^Waiting for the CFO's Face ID: Invoice AP-0005, EUR 1309\.00, due 2026-11-23.*Only the CFO approves/);
  });
});

describe("accounting exports (CSV format exports)", () => {
  /** RFC 4180, as a spreadsheet reads it. */
  const parse = (t: string) => t.trimEnd().split("\r\n").map((line) => {
    const out: string[] = [];
    let cur = "", q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]!;
      if (q) { if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
      else if (ch === '"') q = true; else if (ch === ",") { out.push(cur); cur = ""; } else cur += ch;
    }
    out.push(cur);
    return out;
  });

  it("writes bills in Xero's, QuickBooks Online's and Exact Online's import columns, one row per invoice", async () => {
    await pushToCloud(db, target(), NOW);
    const n = ids().length;
    const want: Record<string, string[]> = {
      xero: ["*ContactName", "*InvoiceNumber", "*InvoiceDate", "*DueDate", "Description", "*Quantity", "*UnitAmount", "*AccountCode", "*TaxType", "TaxAmount", "Currency"],
      quickbooks: ["Bill No", "Supplier", "Bill Date", "Due Date", "Account", "Line Description", "Line Amount", "Line Tax Code", "Line Tax Amount", "Currency"],
    };
    for (const f of ["xero", "quickbooks", "exact"]) {
      const r = await c.req("GET", `/v1/export/csv/${f}/bills`, { key: tenant.key });
      expect(r.status).toBe(200);
      expect(r.res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
      expect(r.res.headers.get("content-disposition")).toBe(`attachment; filename="purser-bills-${f}.csv"`);
      const rows = parse(await r.res.text());
      if (want[f]) expect(rows[0]).toEqual(want[f]);
      expect(rows.length).toBe(n + 1);
      for (const row of rows) expect(row.length).toBe(rows[0]!.length);
      if (f === "xero") expect(rows[1]![2]).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
      if (f === "exact") { expect(rows[0]!.slice(0, 5)).toEqual(["Dagboek: Code", "Boekjaar", "Periode", "Boekstuknummer", "Omschrijving: Kopregel"]); expect(rows[0]).toHaveLength(31); }
    }
  });

  it("writes journals for Xero (debit +, credit −, narration on a journal's first line) and Exact (memoriaal), each balancing", async () => {
    await pushToCloud(db, target(), NOW);
    const xero = parse(await (await c.req("GET", "/v1/export/csv/xero/journals?from=2026-10-09&to=2026-10-09", { key: tenant.key })).res.text());
    expect(xero[0]).toEqual(["*Narration", "*Date", "Description", "*AccountCode", "*TaxRate", "*Amount"]);
    expect(xero.slice(1).map((r) => [r[0] !== "", r[3], r[5]])).toEqual([[true, "6100", "50.00"], [false, "1510", "10.50"], [false, "1200", "-60.50"]]);
    expect(xero[1]![1]).toBe("09/10/2026");
    const exact = parse(await (await c.req("GET", "/v1/export/csv/exact/journals?from=2026-10-09&to=2026-10-09", { key: tenant.key })).res.text());
    expect(exact[0]).toHaveLength(23);
    expect(exact.slice(1).reduce((s, r) => s + Number(r[10]), 0)).toBeCloseTo(0, 6);
    expect(new Set(exact.slice(1).map((r) => r[3])).size).toBe(1);
  });

  it("refuses an unknown format or kind, a bad day, and a key without the read scope sees nothing; a formula cannot ride in", async () => {
    for (const f of ["sage", "__proto__", "constructor", "toString"]) expect((await c.req("GET", `/v1/export/csv/${f}/bills`, { key: tenant.key })).status).toBe(404);
    expect((await c.req("GET", "/v1/export/csv/quickbooks/journals", { key: tenant.key })).json.error).toMatch(/quickbooks exports bills/);
    expect((await c.req("GET", "/v1/export/csv/xero/bills?from=9-11-2026", { key: tenant.key })).status).toBe(400);
    expect((await c.req("GET", "/v1/export/csv/xero/bills", { key: null })).status).toBe(401);
    db.prepare("UPDATE ap_invoices SET vendor = '=HYPERLINK(\"http://evil\")' WHERE id = ?").run(ids()[0]!.id);
    await pushToCloud(db, target(), NOW);
    const text = await (await c.req("GET", "/v1/export/csv/xero/bills", { key: tenant.key })).res.text();
    expect(text).not.toMatch(/(^|,)=HYPERLINK/m);
    expect(text).toContain(`"'=HYPERLINK(""http://evil"")"`);
  });
});

describe("the read API's OpenAPI, and the catalogue of connections", () => {
  it("lists only GETs a read-scoped key may call, the CSV exports among them", async () => {
    const spec = (await c.req("GET", "/v1/openapi.read.json")).json as { openapi: string; info: { title: string }; paths: Record<string, Record<string, { "x-purser-needs": string }>> };
    expect(spec.openapi).toBe("3.1.0");
    expect(spec.info.title).toBe("Purser Cloud read API");
    const ops = Object.entries(spec.paths).flatMap(([p, m]) => Object.entries(m).map(([verb, op]) => ({ p, verb, need: op["x-purser-needs"] })));
    expect(ops.length).toBeGreaterThan(10);
    expect(ops.every((o) => o.verb === "get" && o.need === "read")).toBe(true);
    expect(ops.map((o) => o.p)).toEqual(expect.arrayContaining(["/v1/invoices", "/v1/transactions", "/v1/reports/{name}", "/v1/export/csv/{format}/{kind}"]));
    // Every route it lists answers a read key.
    expect((await c.req("GET", "/v1/invoices", { key: tenant.key })).status).toBe(200);
  });

  it("labels each connection live, a format export, or built and not tested live; none moves money", async () => {
    const cat = (await c.req("GET", "/v1/connections")).json as ReturnType<typeof connectionsCatalogue>;
    expect(cat.rule).toMatch(/None moves money.*Face ID/);
    const by = Object.fromEntries(cat.connections.map((x) => [x.name, x.kind]));
    expect(by).toMatchObject({ "MCP server (Connect any AI)": "live", Webhooks: "live", Xero: "format export", "QuickBooks Online": "format export", "Exact Online (CSV)": "format export", "Slack and Microsoft Teams messages": "format export", "Exact Online (API)": "built, not tested live", "ISO 20022 pacs.008": "format export" });
    expect(cat.connections.every((x) => ["read", "export", "notify"].includes(x.direction))).toBe(true);
  });
});
