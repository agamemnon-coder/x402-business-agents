// Closing a month: the month pack (src/ledger/pack.ts, one PDF) and the accountant's export of the month's journal
// (src/ledger/accountantExport.ts, CSV and JSON). Every figure is the ledger's report functions' own; the output is the
// same bytes for the same ledger and clock; a locked month stays as it was; each entry says where it comes from; the
// vault files all three for a closed month, once; the payables server serves them read-only.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { request } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { seedTreasury } from "../src/agents/euroBill.js";
import { ingestDocument } from "../src/ap/inbox.js";
import { payApInvoice, syncPayments } from "../src/ap/pay.js";
import { pdfText } from "../src/ap/pdfText.js";
import type { Asker } from "../src/ap/read.js";
import { apInvoices } from "../src/ap/store.js";
import { COMPANY } from "../src/config/brand.js";
import { openDb, type DB } from "../src/db/open.js";
import { executeInvoicePayment } from "../src/executors/invoicePayment.js";
import { accountantCsv, accountantExport, accountantJson } from "../src/ledger/accountantExport.js";
import { closeMonth } from "../src/ledger/close.js";
import { postEntry } from "../src/ledger/core.js";
import { purchaseInvoice, settleOpenItem } from "../src/ledger/documents.js";
import { syncLedger } from "../src/ledger/feed.js";
import { monthPack, periodState } from "../src/ledger/pack.js";
import { ageing, balanceSheet, profitAndLoss, trialBalance, vatOverview } from "../src/ledger/reports.js";
import { decide } from "../src/policy/approvals.js";
import { payablesApp } from "../src/servers/payables.js";
import { syncVault } from "../src/vault/build.js";
import { monthPackPdf } from "../src/vault/pdf.js";
import { LocalSink } from "../src/vault/sink.js";
import { EN } from "./fakes/apInvoices.js";
import { FakeAirwallex } from "./fakes/airwallex.js";
import { pdfOf } from "./fakes/pdf.js";

const parserOnly: Asker = { ask: async (_a, fallback) => ({ value: fallback(), source: "fallback", model: null, note: "no key" }) } as Asker;
const MONTH = "2026-11";
const MADE = new Date("2026-12-01T08:00:00Z");

let dir: string;
let db: DB;
let awx: FakeAirwallex;
let paidInvoice: string;

/**
 * November: an inbox invoice paid through Airwallex (stand-in) after the CFO's approval, and two documents posted
 * directly: one at 21% and 9% (paid), one from another EU country with the VAT reverse-charged (still open).
 */
beforeEach(async () => {
  dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "ledger-pack-"));
  db = openDb(":memory:");
  awx = new FakeAirwallex();
  await seedTreasury(db, awx, awx);
  const now = new Date();
  const out = await ingestDocument(db, { dir, reader: parserOnly, now: () => now }, { bytes: await pdfOf(EN), filename: "en.pdf", source: "upload" });
  if (out.kind !== "invoice") throw new Error(out.kind);
  paidInvoice = out.invoice.id;
  const plan = await payApInvoice(db, awx, paidInvoice, now);
  if (plan.kind !== "proposed") throw new Error(plan.reason);
  decide(db, { proposalId: plan.proposal.proposal_id, decision: "APPROVED", typedPrefix: plan.proposal.terms_sha256.slice(0, 8), approver: "cfo", method: "cli" }, now);
  await executeInvoicePayment(db, awx, awx, plan.proposal.proposal_id);
  await syncPayments(db, { now: () => now });
  syncLedger(db, now);
  purchaseInvoice(db, { supplier: "Test Supplier B.V.", doc_ref: "TS-1", date: "2026-11-05", due_date: "2026-12-05", currency: "EUR", created_by: "test", lines: [{ account: "6100", net_cents: 10_000, vat_code: "P21" }, { account: "6200", net_cents: 20_000, vat_code: "P9" }] });
  purchaseInvoice(db, { supplier: "EU Supplier GmbH", doc_ref: "EU-7", date: "2026-11-06", due_date: "2026-12-06", currency: "EUR", created_by: "test", lines: [{ account: "6900", net_cents: 50_000, vat_code: "PRC_EU" }] });
  settleOpenItem(db, { kind: "pay", party: "Test Supplier B.V.", doc_ref: "TS-1", amount_cents: 33_900, currency: "EUR", bank: "1200", date: "2026-11-20", created_by: "test", source_key: "pay:TS-1" });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("the month pack", () => {
  it("holds the report functions' own figures, to the cent", () => {
    const p = monthPack(db, MONTH);
    expect(p.period).toMatchObject({ month: MONTH, from: "2026-11-01", to: "2026-11-30", locked: false });
    expect(p.trial).toEqual(trialBalance(db, "2026-11-30"));
    expect(p.pnl).toEqual(profitAndLoss(db, { from: "2026-11-01", to: "2026-11-30" }));
    expect(p.balance).toEqual(balanceSheet(db, "2026-11-30"));
    // Nothing is posted after November here, so the quarter up to the month's end is the whole quarter.
    expect(p.vat).toEqual(vatOverview(db, "2026Q4"));
    expect(p.payables).toEqual(ageing(db, "payables", "2026-11-30"));
    // The reverse charge counts in 4b and 5b; the two Dutch rates in 5b; the open payable is the EU supplier's.
    expect(p.vat.rubrics["4b"]).toEqual({ base_cents: 50_000, vat_cents: 10_500 });
    expect(p.vat.input_5b_cents).toBe(2_100 + 1_800 + 10_500);
    expect(p.payables.items.map((i) => [i.party, i.doc_ref, i.open_cents])).toContainEqual(["EU Supplier GmbH", "EU-7", 50_000]);
    expect(Object.values(p.balance).every((b) => b.balanced)).toBe(true);
  });

  it("counts the VAT of the quarter only up to the month's end, so a later entry never changes a month's pack", () => {
    const before = monthPack(db, MONTH);
    purchaseInvoice(db, { supplier: "Test Supplier B.V.", doc_ref: "TS-2", date: "2026-12-03", due_date: "2027-01-03", currency: "EUR", created_by: "test", lines: [{ account: "6100", net_cents: 10_000, vat_code: "P21" }] });
    expect(monthPack(db, MONTH)).toEqual(before);
    expect(vatOverview(db, "2026Q4").input_5b_cents).toBe(before.vat.input_5b_cents + 2_100);
  });

  it("is one PDF with the five parts; its VAT part says it is a preparation, not a filing", async () => {
    const en = (await pdfText(await monthPackPdf(COMPANY, monthPack(db, MONTH), "en"))).text.replace(/\s+/g, " ");
    for (const words of ["Month pack 2026-11", "Trial balance", "Profit and loss", "Balance sheet on", "VAT overview 2026-Q4", "Preparation, not a filing", "Open payables", "This period is not closed yet"]) expect(en).toContain(words);
    expect(en).toContain("EUR 144.00"); // 5b: 21.00 + 18.00 + 105.00
    expect(en).toContain("EU Supplier GmbH");
    const nl = (await pdfText(await monthPackPdf(COMPANY, monthPack(db, MONTH), "nl"))).text.replace(/\s+/g, " ");
    expect(nl).toContain("Voorbereiding, geen aangifte");
    expect(nl).toContain("Maandpakket 2026-11");
  });

  it("is the same bytes for the same ledger, and so is the export", async () => {
    const a = await monthPackPdf(COMPANY, monthPack(db, MONTH), "nl");
    const b = await monthPackPdf(COMPANY, monthPack(db, MONTH), "nl");
    expect(Buffer.compare(a, b)).toBe(0);
    expect(accountantCsv(accountantExport(db, MONTH))).toBe(accountantCsv(accountantExport(db, MONTH)));
    expect(accountantJson(accountantExport(db, MONTH), MADE)).toBe(accountantJson(accountantExport(db, MONTH), MADE));
  });
});

describe("the accountant's export", () => {
  it("has every entry posted in the month, and its lines add up to the month's movement per account", () => {
    const x = accountantExport(db, MONTH);
    expect(x.chain.ok).toBe(true);
    const posted = db.prepare("SELECT COUNT(*) AS n FROM ledger_entries WHERE posting_date BETWEEN '2026-11-01' AND '2026-11-30'").get() as { n: number };
    expect(x.entries).toHaveLength(posted.n);
    const moved = new Map<string, number>();
    for (const e of x.entries) for (const l of e.lines) {
      const k = `${l.account} ${l.currency}`;
      moved.set(k, (moved.get(k) ?? 0) + Math.round(Number(l.debit || 0) * 100) - Math.round(Number(l.credit || 0) * 100));
    }
    const end = trialBalance(db, "2026-11-30");
    const start = new Map(trialBalance(db, "2026-10-31").map((r) => [`${r.account} ${r.currency}`, r.balance_cents]));
    for (const r of end) expect(moved.get(`${r.account} ${r.currency}`) ?? 0, `${r.account} ${r.currency}`).toBe(r.balance_cents - (start.get(`${r.account} ${r.currency}`) ?? 0));
    // One CSV row per line.
    const csv = accountantCsv(x).trim().split("\n");
    expect(csv).toHaveLength(1 + x.entries.reduce((n, e) => n + e.lines.length, 0));
    expect(csv[0]).toBe("month,period_locked,entry,posting_date,doc_date,description,account,account_name,debit,credit,currency,cost_centre,vat_code,vat,party,doc_ref,source_key,doc_sha256,terms_sha256,payment_id,entry_hash");
  });

  it("says where each entry comes from: the document, the terms the CFO signed and the payment at Airwallex", () => {
    const x = accountantExport(db, MONTH);
    const inv = apInvoices(db).find((i) => i.id === paidInvoice)!;
    const approved = (db.prepare("SELECT approved_sha256 FROM approvals WHERE proposal_id = ?").get(inv.proposal_id) as { approved_sha256: string }).approved_sha256;
    const transfer = (db.prepare("SELECT transfer_id FROM transfers WHERE status = 'PAID'").get() as { transfer_id: string }).transfer_id;
    const accrual = x.entries.find((e) => e.source_key === `ap-accrual|${paidInvoice}`)!;
    expect(accrual).toMatchObject({ doc_sha256: inv.doc_sha256, terms_sha256: approved, payment_id: transfer });
    // The payment posts on the day it was paid (the executors run on the real clock): read the export of that month.
    const paidMonth = (db.prepare("SELECT posting_date FROM ledger_entries WHERE source_key LIKE 'transfer|%' ORDER BY entry_id LIMIT 1").get() as { posting_date: string }).posting_date.slice(0, 7);
    const payment = accountantExport(db, paidMonth).entries.find((e) => e.source_key.startsWith("transfer|") && e.lines.some((l) => l.account === "2100"))!;
    expect(payment).toMatchObject({ doc_sha256: inv.doc_sha256, terms_sha256: approved, payment_id: transfer });
    // A document posted without a stored file, and its payment: nothing to show, so nothing is shown.
    const posted = x.entries.find((e) => e.source_key === "purchase:Test Supplier B.V.:TS-1")!;
    expect(posted).toMatchObject({ doc_sha256: "", terms_sha256: "", payment_id: "" });
  });
});

describe("a locked month", () => {
  it("refuses new entries (they post in the next open month), and its pack and export say it is locked, by whom and when", async () => {
    const csvBefore = accountantCsv(accountantExport(db, MONTH));
    expect(csvBefore).toContain(",open,");
    expect(closeMonth(db, MONTH, "the CFO", new Date("2026-12-01T09:00:00Z")).locked).toBe(true);
    const state = periodState(db, MONTH);
    expect(state).toMatchObject({ locked: true, locked_month: MONTH, locked_by: "the CFO", locked_at: "2026-12-01T09:00:00.000Z" });
    const locked = accountantExport(db, MONTH);
    const csv = accountantCsv(locked);
    // A late item dated in November posts on the first day of December; November's export does not change.
    const late = postEntry(db, { date: "2026-11-15", description: "A late supplier fee", created_by: "test", lines: [{ account: "6800", debit: 500, currency: "EUR" }, { account: "1200", credit: 500, currency: "EUR" }] });
    expect(late.posting_date).toBe("2026-12-01");
    expect(accountantCsv(accountantExport(db, MONTH))).toBe(csv);
    expect(accountantExport(db, MONTH).entries).toEqual(locked.entries);
    expect(csv).toContain(",locked 2026-12-01 by the CFO,");
    expect(JSON.parse(accountantJson(locked, MADE))).toMatchObject({ period: { locked: true, locked_by: "the CFO" }, note: "The period is locked: nothing more is posted into it.", made_at: MADE.toISOString() });
    const text = (await pdfText(await monthPackPdf(COMPANY, monthPack(db, MONTH), "en"))).text.replace(/\s+/g, " ");
    expect(text).toContain("Closed: nothing more is posted into it");
    expect(text).toContain("the CFO");
    expect(text).not.toContain("This period is not closed yet");
  });

  it("is filed in the vault with its pack and both exports, once", async () => {
    closeMonth(db, MONTH, "the CFO", new Date("2026-12-01T09:00:00Z"));
    const root = join(dir, "vault");
    const sink = new LocalSink(root);
    const first = await syncVault(db, sink, { company: COMPANY, now: MADE, today: "2026-12-01" });
    const reports = first.added.filter((a) => a.path.includes("/Rapporten/")).map((a) => [a.kind, a.path.split("/").pop()]);
    expect(reports).toEqual(expect.arrayContaining([
      ["pack", "2026-11 Maandpakket.pdf"], ["export", "2026-11 Journaal voor de accountant.csv"], ["export", "2026-11 Journaal voor de accountant.json"],
    ]));
    const csvPath = first.added.find((a) => a.path.endsWith(".csv"))!.path;
    expect(readFileSync(join(root, csvPath), "utf8")).toBe(accountantCsv(accountantExport(db, MONTH)));
    const index = JSON.parse(readFileSync(join(root, COMPANY, "2026", "index.json"), "utf8")) as { files: { path: string; key: string }[] };
    expect(index.files.filter((f) => f.key === `pack:${MONTH}` || f.key.startsWith("export-"))).toHaveLength(3);
    // A later entry in December changes nothing filed for November.
    purchaseInvoice(db, { supplier: "Test Supplier B.V.", doc_ref: "TS-3", date: "2026-12-04", due_date: "2027-01-04", currency: "EUR", created_by: "test", lines: [{ account: "6100", net_cents: 1_000, vat_code: "P21" }] });
    expect((await syncVault(db, sink, { company: COMPANY, now: MADE, today: "2026-12-01" })).added).toEqual([]);
  });
});

describe("read-only on the payables server", () => {
  let base = "";
  let stop: () => void = () => {};
  const get = (path: string, host?: string) => new Promise<{ status: number; type: string; body: Buffer }>((resolve, reject) => {
    request(base + path, host ? { headers: { host } } : {}, (r) => {
      const chunks: Buffer[] = [];
      r.on("data", (c: Buffer) => chunks.push(c)).on("end", () => resolve({ status: r.statusCode ?? 0, type: String(r.headers["content-type"] ?? ""), body: Buffer.concat(chunks) }));
    }).on("error", reject).end();
  });
  beforeEach(async () => {
    const server = payablesApp(db, { inbox: { dir, reader: parserOnly, now: () => MADE }, rail: null }).listen(0, "127.0.0.1");
    await new Promise<void>((r) => server.once("listening", () => r()));
    stop = () => server.close();
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterEach(() => stop());

  it("serves the pack, the CSV and the JSON as the functions make them, refuses a bad month and a foreign host", async () => {
    const pdf = await get(`/api/payables/reports/${MONTH}/pack.pdf?lang=en`);
    expect(pdf).toMatchObject({ status: 200, type: expect.stringContaining("application/pdf") });
    expect(Buffer.compare(pdf.body, await monthPackPdf(process.env.KIT11_COMPANY ?? COMPANY, monthPack(db, MONTH), "en"))).toBe(0);
    const csv = await get(`/api/payables/reports/${MONTH}/journal.csv`);
    expect(csv).toMatchObject({ status: 200, type: expect.stringContaining("text/csv") });
    expect(csv.body.toString("utf8")).toBe(accountantCsv(accountantExport(db, MONTH)));
    const json = await get(`/api/payables/reports/${MONTH}/journal.json`);
    expect(json).toMatchObject({ status: 200, type: expect.stringContaining("application/json") });
    expect(json.body.toString("utf8")).toBe(accountantJson(accountantExport(db, MONTH), MADE));
    for (const bad of ["2026-13", "2026-1", "november", "2026-11-01"]) {
      const r = await get(`/api/payables/reports/${bad}/journal.csv`);
      expect(r.status, bad).toBe(400);
      expect(r.body.toString("utf8")).toContain("write the month as 2026-11");
    }
    expect((await get(`/api/payables/reports/${MONTH}/journal.csv`, "evil.example")).status).toBe(403);
  });
});
