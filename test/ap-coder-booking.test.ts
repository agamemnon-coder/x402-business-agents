// Booking from the Coder's enforced coding (src/ap/books.ts accrualEntries, src/ledger/feed.ts syncLedger), behind the
// flag KIT11_AP_AGENTS=on. With the flag off nothing of it runs: the last block pins that path to what it was.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ibanSha } from "../src/agents/invoice.js";
import { accrualEntries, apJournal, codedAccrual, CsvFileSink, journalCsv, reversalEntries, type ApEntry } from "../src/ap/books.js";
import { codeInvoice } from "../src/ap/coderAgent.js";
import { ingestDocument, type InboxDeps } from "../src/ap/inbox.js";
import type { Asker } from "../src/ap/read.js";
import { apInvoice, apInvoices, setStatus, type ApInvoiceRow } from "../src/ap/store.js";
import { openDb, type DB } from "../src/db/open.js";
import { fromCents, toCents } from "../src/lib/money.js";
import { verifyLedger } from "../src/ledger/core.js";
import { syncLedger } from "../src/ledger/feed.js";
import { trialBalance, vatOverview } from "../src/ledger/reports.js";
import { DE, EN, NL } from "./fakes/apInvoices.js";
import { scriptedCoder } from "./fakes/coderClient.js";
import { pdfOf } from "./fakes/pdf.js";

const now = new Date("2026-11-08T10:00:00Z");
const parserOnly: Asker = { ask: async (_a, fallback) => ({ value: fallback(), source: "fallback", model: null, note: "no key" }) } as Asker;

/** A supplier on file, so its invoice is checked clean and booked. */
function onFile(db: DB, id: string, name: string, iban: string, bic: string): void {
  db.prepare("INSERT INTO beneficiaries (beneficiary_id, name, iban_last4, iban_sha256, bic, currency, method) VALUES (?, ?, ?, ?, ?, 'EUR', 'SWIFT')").run(id, name, iban.slice(-4), ibanSha(iban), bic);
}

let dir: string;
let db: DB;
beforeEach(() => {
  dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "ap-coder-"));
  db = openDb(":memory:");
  onFile(db, "ben_bergtex", "Bergtex Textil GmbH", "DE89370400440532013000", "COBADEFFXXX");
  onFile(db, "ben_zeeland", "Zeeland Verpakkingen B.V.", "NL91ABNA0417164300", "ABNANL2A");
  onFile(db, "ben_lagerhaus", "Lagerhaus Nord GmbH", "DE75512108001245126199", "BYLADEM1001");
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

interface LedgerRow { source_key: string; description: string; entry_doc: string | null; line_no: number; account: string; debit_cents: number; credit_cents: number; currency: string; cost_centre: string | null; vat_code: string | null; vat_cents: number | null; party: string | null; due_date: string | null; doc_ref: string | null; memo: string | null }
/** One posted line as one line of text: everything the ledger stores on it. */
const compact = (l: LedgerRow) => `${l.source_key} #${l.line_no} ${l.account} D${l.debit_cents} C${l.credit_cents} ${l.currency} cc=${l.cost_centre} vat=${l.vat_code}:${l.vat_cents} party=${l.party} due=${l.due_date} ref=${l.doc_ref} entry=${l.description} / ${l.entry_doc} memo=${l.memo}`;
const ledgerLines = (d: DB) => d.prepare(`SELECT e.source_key, e.description, e.doc_ref AS entry_doc, l.line_no, l.account, l.debit_cents, l.credit_cents, l.currency, l.cost_centre, l.vat_code, l.vat_cents, l.party, l.due_date, l.doc_ref, l.memo
  FROM ledger_lines l JOIN ledger_entries e ON e.entry_id = l.entry_id ORDER BY e.entry_id, l.line_no`).all() as LedgerRow[];

/** A Dutch invoice with two lines at two rates: 21% of 100.00 and 9% of 200.00 is 39.00. */
const TWO_RATES = `Zeeland Verpakkingen B.V.
BTW-nummer: NL123456789B01
Factuur
Factuurnummer: ZV-4480
Factuurdatum: 05-11-2026
Vervaldatum: 19-11-2026
Omschrijving                 Bedrag
Verpakkingsmateriaal 21%     € 100,00
Vakliteratuur 9%             € 200,00
Subtotaal € 300,00
BTW € 39,00
Totaal te betalen € 339,00
IBAN: NL91 ABNA 0417 1643 00
BIC: ABNANL2A`;
/** Four lines at 21%: two of them for the same account and cost centre. */
const FOUR_LINES = `Zeeland Verpakkingen B.V.
BTW-nummer: NL123456789B01
Factuur
Factuurnummer: ZV-4490
Factuurdatum: 06-11-2026
Vervaldatum: 20-11-2026
Omschrijving                   Bedrag
Softwarelicentie               € 100,00
Reiskosten monteur             € 50,00
Softwarelicentie uitbreiding   € 30,00
Vracht                         € 20,00
Subtotaal € 200,00
BTW 21% € 42,00
Totaal te betalen € 242,00
IBAN: NL91 ABNA 0417 1643 00
BIC: ABNANL2A`;
/** A German supplier's invoice without VAT that says the buyer owes it. */
const REVERSE_EU = `Bergtex Textil GmbH
Textilweg 4, 72760 Reutlingen
USt-IdNr.: DE123456789
INVOICE BTX-2026-30
Invoice date: 6 November 2026
Due date: 20 November 2026
Total due EUR 1,850.00
Steuerschuldnerschaft des Leistungsempfängers (reverse charge).
IBAN: DE89 3704 0044 0532 0130 00
BIC: COBADEFFXXX`;

type Line = { line_no: number; account: string; vat_code: string | null; cost_centre: string | null };
/** Files the document as the inbox does (flag off, nothing booked), then codes it with a scripted agent's answer. */
async function coded(text: string, lines: Line[] | null, reason = "Booked by what each line is for, as the chart of accounts says."): Promise<ApInvoiceRow> {
  vi.stubEnv("KIT11_AP_AGENTS", "");
  const out = await ingestDocument(db, { dir, reader: parserOnly, now: () => now }, { bytes: await pdfOf(text), filename: `${text.length}.pdf`, source: "upload" });
  if (out.kind !== "invoice") throw new Error(out.kind);
  expect([out.invoice.status, out.invoice.findings]).toEqual(["ready", []]);
  if (lines) await codeInvoice(db, out.invoice, text, { client: scriptedCoder([[{ name: "code_invoice", input: { lines, reason } }]]), now: () => now });
  return apInvoice(db, out.invoice.id)!;
}
/** An entry as the tests read it: the account, the two sides, and what a coded net line adds. */
const brief = (e: ApEntry) => [e.account, e.debit, e.credit, e.cost_centre ?? "", e.vat_code ?? "", e.vat_cents ?? "", e.memo.split(": ").slice(1).join(": ")].join("|");
const balanced = (es: ApEntry[]) => es.reduce((s, e) => s + (e.debit ? toCents(e.debit) : 0) - (e.credit ? toCents(e.credit) : 0), 0) === 0;
const posted = (d: DB) => d.prepare("SELECT l.account, l.debit_cents AS d, l.credit_cents AS c, l.cost_centre AS cc, l.vat_code AS code, l.vat_cents AS vat FROM ledger_lines l JOIN ledger_entries e ON e.entry_id = l.entry_id WHERE e.reverses IS NULL ORDER BY e.entry_id, l.line_no").all();

describe("the accrual of a coded invoice", () => {
  it("two rates: a debit per line group with its VAT code and its share of the VAT, the VAT to 1510, the total to 2100", async () => {
    const inv = await coded(TWO_RATES, [{ line_no: 1, account: "6200", vat_code: "P21", cost_centre: "CC100" }, { line_no: 2, account: "6100", vat_code: "P9", cost_centre: null }]);
    expect(inv.coding).toMatchObject({ source: "claude", status: "coded" });
    expect(codedAccrual(inv)).toBe(true);
    const es = accrualEntries(inv);
    expect(es.map(brief)).toEqual(["6200|100.00||CC100|P21|2100|", "6100|200.00||CC300|P9|1800|", "1510|39.00|||||input VAT", "2100||339.00||||"]);
    expect(es.every((e) => e.event === "accrual" && e.date === "2026-11-05" && e.invoice_id === inv.id && e.currency === "EUR" && e.doc_sha256 === inv.doc_sha256)).toBe(true);
    expect(es.map((e) => e.account_name)).toEqual(["Goods from the manufacturer", "Software subscriptions (company cards)", "Input VAT receivable (supplier invoices)", "Accounts payable (supplier invoices)"]);
    expect(balanced(es)).toBe(true);
    // The CSV keeps its columns: what the ledger needs travels on the entries, not in the file.
    expect(journalCsv(es).split("\n")[1]).toBe(`2026-11-05,${inv.id},accrual,6200,Goods from the manufacturer,100.00,,EUR,Zeeland Verpakkingen B.V. invoice ZV-4480,${inv.doc_sha256}`);

    expect(syncLedger(db, now)).toEqual({ posted: 1, already: 0, reversed: 0 });
    expect(posted(db)).toEqual([
      { account: "6200", d: 10000, c: 0, cc: "CC100", code: "P21", vat: 2100 },
      { account: "6100", d: 20000, c: 0, cc: "CC300", code: "P9", vat: 1800 },
      { account: "1510", d: 3900, c: 0, cc: null, code: null, vat: null },
      { account: "2100", d: 0, c: 33900, cc: null, code: null, vat: null },
    ]);
    // The 2100 line names the document and its due date, as before; the posting keeps its key.
    expect(db.prepare("SELECT e.source_key, l.doc_ref, l.due_date, l.party FROM ledger_lines l JOIN ledger_entries e ON e.entry_id = l.entry_id WHERE l.account = '2100'").get())
      .toEqual({ source_key: `ap-accrual|${inv.id}`, doc_ref: "ZV-4480 · Zeeland Verpakkingen B.V.", due_date: "2026-11-19", party: "Zeeland Verpakkingen B.V." });
    expect(vatOverview(db, "2026Q4")).toMatchObject({ input_5b_cents: 3900, owed_5a_cents: 0, uncoded_lines: 0 });
    expect(verifyLedger(db).ok).toBe(true);
    expect(syncLedger(db, now)).toEqual({ posted: 0, already: 1, reversed: 0 });
  });

  it("reverse charge: the VAT the company owes itself is input VAT and VAT owed, and nothing extra goes to the supplier", async () => {
    const inv = await coded(REVERSE_EU, [{ line_no: 1, account: "6200", vat_code: "PRC_EU", cost_centre: null }]);
    expect(inv.coding).toMatchObject({ source: "claude", status: "coded", vat_cents: 0, lines: [{ vat_code: "PRC_EU", vat_cents: 0 }] });
    const es = accrualEntries(inv);
    expect(es.map(brief)).toEqual(["6200|1850.00||CC300|PRC_EU|38850|", "1510|388.50|||||input VAT, reverse charge", "2210||388.50||||VAT owed, reverse charge", "2100||1850.00||||"]);
    expect(es[2]!.account_name).toBe("Output VAT (charged to customers)");
    expect(balanced(es)).toBe(true);
    syncLedger(db, now);
    expect(posted(db)).toEqual([
      { account: "6200", d: 185000, c: 0, cc: "CC300", code: "PRC_EU", vat: 38850 },
      { account: "1510", d: 38850, c: 0, cc: null, code: null, vat: null },
      { account: "2210", d: 0, c: 38850, cc: null, code: null, vat: null },
      { account: "2100", d: 0, c: 185000, cc: null, code: null, vat: null },
    ]);
    // The overview counts it in its rubric (4b) and in 5b: owed and reclaimed in the same return.
    const v = vatOverview(db, "2026Q4");
    expect(v.rubrics["4b"]).toEqual({ base_cents: 185000, vat_cents: 38850 });
    expect(v).toMatchObject({ owed_5a_cents: 38850, input_5b_cents: 38850, balance_5c_cents: 0, uncoded_lines: 0 });

    // The reversal takes back every line, the reverse charge included.
    const back = reversalEntries(inv, "2026-11-20");
    expect(back.map(brief)).toEqual(["6200||1850.00|CC300|PRC_EU|38850|reversed, the CFO rejected the payment", "1510||388.50||||input VAT, reverse charge: reversed, the CFO rejected the payment", "2210|388.50|||||VAT owed, reverse charge: reversed, the CFO rejected the payment", "2100|1850.00|||||reversed, the CFO rejected the payment"]);
    expect(balanced(back)).toBe(true);
    // In the stored ledger a rejected invoice's posting is reversed, and every account is back at zero.
    setStatus(db, inv.id, "rejected", "human", { reason: "test" }, now);
    expect(syncLedger(db, now)).toEqual({ posted: 0, already: 0, reversed: 1 });
    expect(trialBalance(db).every((r) => r.debit_cents === r.credit_cents)).toBe(true);
    expect(verifyLedger(db).ok).toBe(true);
  });

  // final-polish, 13 Nov: a German supplier's 19% left without a code by the Coder (its codes are the Dutch return's) is
  // coded by the books from the supplier's own German VAT id, as the engine's own accrual is: PF_DE19 on 1515, never on
  // 1510, so 1510 stays equal to box 5b. Before, it sat on 1510 while 5b counted none of it.
  it("no VAT code on a German supplier's 19%: the agent's account stands, and the books code its VAT as German, on 1515", async () => {
    onFile(db, "ben_lagerhaus2", "Lagerhaus Nord GmbH", "DE75512108001245126199", "BYLADEM1001");
    const inv = await coded(DE, [{ line_no: 1, account: "6200", vat_code: null, cost_centre: "CC100" }]);
    expect(inv.coding).toMatchObject({ source: "claude", status: "needs_review", lines: [{ vat_code: null, vat_cents: 19000 }] });
    const es = accrualEntries(inv);
    expect(es.map(brief)).toEqual(["6200|1000.00||CC100|PF_DE19|19000|", "1515|190.00|||||foreign VAT to reclaim", "2100||1190.00||||"]);
    syncLedger(db, now);
    expect(posted(db)[0]).toEqual({ account: "6200", d: 100000, c: 0, cc: "CC100", code: "PF_DE19", vat: 19000 });
    expect(vatOverview(db, "2026Q4")).toMatchObject({ input_5b_cents: 0, uncoded_lines: 0, foreign_vat: { vat_cents: 19000 } });
  });

  it("no VAT code and no foreign VAT id: the line stays uncoded for a person, its VAT on 1510 as before", async () => {
    const inv = await coded(NL, [{ line_no: 1, account: "6200", vat_code: null, cost_centre: "CC100" }]);
    const es = accrualEntries(inv);
    expect(Object.hasOwn(es[0]!, "vat_code") || Object.hasOwn(es[0]!, "vat_cents")).toBe(false);
    expect(es.some((e) => e.account === "1515")).toBe(false);
    syncLedger(db, now);
    expect(vatOverview(db, "2026Q4")).toMatchObject({ input_5b_cents: 0, uncoded_lines: 1 });
  });

  it("several accounts and cost centres: lines with the same account, cost centre and VAT code are one debit, in the order they first appear", async () => {
    const inv = await coded(FOUR_LINES, [
      { line_no: 1, account: "6100", vat_code: "P21", cost_centre: null }, { line_no: 2, account: "6300", vat_code: "P21", cost_centre: "CC500" },
      { line_no: 3, account: "6100", vat_code: "P21", cost_centre: null }, { line_no: 4, account: "6300", vat_code: "P21", cost_centre: null },
    ]);
    expect(inv.coding!.lines.map((l) => [l.description, l.net_cents, l.vat_cents])).toEqual([["Softwarelicentie", 10000, 2100], ["Reiskosten monteur", 5000, 1050], ["Softwarelicentie uitbreiding", 3000, 630], ["Vracht", 2000, 420]]);
    const es = accrualEntries(inv);
    expect(es.map(brief)).toEqual(["6100|130.00||CC300|P21|2730|", "6300|50.00||CC500|P21|1050|", "6300|20.00||CC300|P21|420|", "1510|42.00|||||input VAT", "2100||242.00||||"]);
    expect(balanced(es)).toBe(true);
    syncLedger(db, now);
    expect(vatOverview(db, "2026Q4")).toMatchObject({ input_5b_cents: 4200, uncoded_lines: 0 });
    expect(verifyLedger(db).ok).toBe(true);
  });

  it("an accrual the ledger posted before the coding was stored is reversed and posted again with the coding, even when the amounts are the same", async () => {
    vi.stubEnv("KIT11_AP_AGENTS", "");
    const out = await ingestDocument(db, { dir, reader: parserOnly, now: () => now }, { bytes: await pdfOf(NL), filename: "nl.pdf", source: "upload" });
    if (out.kind !== "invoice") throw new Error(out.kind);
    syncLedger(db, now);
    expect(posted(db)[0]).toEqual({ account: "6900", d: 40000, c: 0, cc: "CC300", code: "P21", vat: 8400 });
    await codeInvoice(db, out.invoice, NL, { client: scriptedCoder([[{ name: "code_invoice", input: { lines: [{ line_no: 1, account: "6900", vat_code: "P21", cost_centre: "CC100" }], reason: "Packaging material is booked as other supplier invoices." } }]]), now: () => now });
    expect(syncLedger(db, now)).toEqual({ posted: 1, already: 0, reversed: 1 });
    expect(db.prepare("SELECT source_key FROM ledger_entries WHERE reverses IS NULL ORDER BY entry_id").all()).toEqual([{ source_key: "ap-accrual|AP-0001" }, { source_key: "ap-accrual|AP-0001@v2" }]);
    expect(trialBalance(db).find((r) => r.account === "2100")).toMatchObject({ credit_cents: 48400 + 48400, debit_cents: 48400 });
    expect(syncLedger(db, now)).toEqual({ posted: 0, already: 1, reversed: 0 });
    expect(verifyLedger(db).ok).toBe(true);
  });

  it("without a coding, or with one that has no lines or is not this invoice's, the accrual is the engine's own, exactly", async () => {
    const inv = await coded(NL, null);
    const engine = accrualEntries(inv);
    expect(engine.map(brief)).toEqual(["6900|400.00|||||", "1510|84.00|||||input VAT", "2100||484.00||||"]);
    expect(engine.some((e) => "cost_centre" in e || "vat_code" in e || "vat_cents" in e)).toBe(false);
    const coding = { status: "coded" as const, source: "claude" as const, overridden_by: null, refused_because: null, review: null, reason: "x", net_cents: 40000, vat_cents: 8400, total_cents: 48400, lines: [{ line_no: 1, account: "6200", vat_code: "P21", cost_centre: "CC300", net_cents: 40000, vat_cents: 8400 }] };
    expect(codedAccrual({ ...inv, coding })).toBe(true);
    const not = [
      { ...coding, lines: [] },
      { ...coding, total_cents: 48401 },
      { ...coding, lines: [{ ...coding.lines[0]!, net_cents: 39999 }] },
      { ...coding, lines: [{ ...coding.lines[0]!, account: "1200" }] },
      { ...coding, lines: [{ ...coding.lines[0]!, account: "6999" }] },
      { ...coding, lines: [{ ...coding.lines[0]!, vat_code: "S21" }] },
      { ...coding, lines: [{ ...coding.lines[0]!, vat_code: "P19" }] },
      { ...coding, lines: [{ ...coding.lines[0]!, cost_centre: "" }] },
      { ...coding, lines: [{ ...coding.lines[0]!, vat_cents: -1, net_cents: 48401 }] },
    ];
    for (const c of not) {
      expect(codedAccrual({ ...inv, coding: c })).toBe(false);
      expect(accrualEntries({ ...inv, coding: c })).toEqual(engine);
    }
  });

  it("an invoice whose VAT is its whole total is booked as the engine books it: the amount as an expense, never all to input VAT", async () => {
    const ALL_TAX = `Zeeland Verpakkingen B.V.
BTW-nummer: NL123456789B01
Factuur
Factuurnummer: ZV-4500
Factuurdatum: 05-11-2026
Vervaldatum: 19-11-2026
Subtotaal € 0,00
BTW € 100,00
Totaal te betalen € 100,00
IBAN: NL91 ABNA 0417 1643 00
BIC: ABNANL2A`;
    const inv = await coded(ALL_TAX, null);
    const engine = accrualEntries(inv);
    expect(engine.map(brief)).toEqual(["6900|100.00|||||", "2100||100.00||||"]);
    // Code's fallback (no client) and an agent that leaves the VAT code to a person both give a line of net 0 and VAT 100.00.
    for (const client of [null, scriptedCoder([[{ name: "code_invoice", input: { lines: [{ line_no: 1, account: "6200", vat_code: null, cost_centre: null }], reason: "Booked as goods." } }]])]) {
      const d = openDb(":memory:");
      onFile(d, "ben_zeeland", "Zeeland Verpakkingen B.V.", "NL91ABNA0417164300", "ABNANL2A");
      const out = await ingestDocument(d, { dir, reader: parserOnly, now: () => now }, { bytes: await pdfOf(ALL_TAX), filename: "all-tax.pdf", source: "upload" });
      if (out.kind !== "invoice") throw new Error(out.kind);
      await codeInvoice(d, out.invoice, ALL_TAX, { client, now: () => now });
      const row = apInvoice(d, out.invoice.id)!;
      expect(row.coding!.lines.map((l) => [l.net_cents, l.vat_cents])).toEqual([[0, 10000]]);
      expect(codedAccrual(row)).toBe(false);
      expect(accrualEntries(row).map(brief)).toEqual(["6900|100.00|||||", "2100||100.00||||"]);
      syncLedger(d, now);
      expect(posted(d).map((l) => (l as { account: string }).account)).toEqual(["6900", "2100"]);
    }
  });
});

describe("with the flag off, nothing of the Coder runs and the books are what they were (pinned at 70863a9a)", () => {
  it("the same documents give the same journal CSV, ledger entries and audit events, with no coding and no coder call", async () => {
    vi.stubEnv("KIT11_AP_AGENTS", "");
    const coder = scriptedCoder([]);
    const deps: InboxDeps = { dir, reader: parserOnly, now: () => now, sink: new CsvFileSink(join(dir, "journal.csv")), coder };
    for (const [text, name] of [[EN, "en.pdf"], [NL, "nl.pdf"], [DE, "de.pdf"]] as const) await ingestDocument(db, deps, { bytes: await pdfOf(text), filename: name, source: "upload" });
    syncLedger(db, now);

    // No coder call, no coding, no decision row; a row without a coding is the object it was (no extra key).
    expect(coder.asked).toBe(0);
    expect(db.prepare("SELECT COUNT(*) AS n FROM ap_codings").get()).toEqual({ n: 0 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE event IN ('ap.coded', 'agent.run', 'agent.tool')").get()).toEqual({ n: 0 });
    const rows = apInvoices(db);
    expect(rows.map((r) => [r.id, r.status, Object.hasOwn(r, "coding")])).toEqual([["AP-0001", "ready", false], ["AP-0002", "ready", false], ["AP-0003", "ready", false]]);
    expect(Object.keys(rows[0]!).sort().join(",")).toBe(KEYS);

    // The engine's own accrual, written out here as it was: net to the row's account, the tax to 1510, the total to 2100.
    const engine = rows.flatMap((r) => {
      const total = toCents(r.total), tax = toCents(r.tax);
      const memo = `${r.vendor} invoice ${r.invoice_no}`;
      const row = (account: string, name: string, debit: number, credit: number, m: string) => [r.issue_date, r.id, "accrual", account, name, debit ? fromCents(debit) : "", credit ? fromCents(credit) : "", r.currency, m, r.doc_sha256].join(",");
      return [row(r.gl_account, NAMES[r.gl_account]!, total - tax, 0, memo), (r.vendor === "Zeeland Verpakkingen B.V." ? row("1510", "Input VAT receivable (supplier invoices)", tax, 0, `${memo}: input VAT`) : row("1515", "Foreign VAT to reclaim (EU refund)", tax, 0, `${memo}: foreign VAT to reclaim`)), row("2100", "Accounts payable (supplier invoices)", 0, total, memo)];
    });
    const csv = journalCsv(apJournal(db));
    expect(csv).toBe(`date,invoice_id,event,account,account_name,debit,credit,currency,memo,doc_sha256\n${engine.join("\n")}\n`);
    expect(readFileSync(join(dir, "journal.csv"), "utf8")).toBe(csv);
    // The same CSV, pinned as text (the document hashes left out: they are the PDFs' own).
    expect(csv.split("\n").map((l) => l.split(",").slice(0, 9).join(",")).join("\n")).toBe(PINNED_CSV);
    expect(ledgerLines(db).map(compact)).toEqual(PINNED_LEDGER);
    const events = db.prepare("SELECT actor, event, subject, payload_json FROM audit_log ORDER BY seq").all() as { actor: string; event: string; subject: string | null; payload_json: string }[];
    expect(events.map((e) => `${e.actor} ${e.event} ${e.subject} ${e.payload_json.replace(/[0-9a-f]{64}/g, "(sha)")}`)).toEqual(PINNED_EVENTS);
  });
});

const NAMES: Record<string, string> = { "6200": "Goods from the manufacturer", "6900": "Other supplier invoices" };
// Everything below was written by the code at commit 70863a9a, before the Coder was wired in, from these three documents.
const KEYS = "bic,classified_by,cost_centre,credit_accepted_at,credit_accepted_by,currency,doc_kind,doc_sha256,due_date,findings,gl_account,gl_rule,iban_last4,id,invoice_no,issue_date,paid_at,proposal_id,read_by,reading,received_at,review_by,review_note,status,subtotal,tax,total,updated_at,vendor";
const PINNED_CSV = `date,invoice_id,event,account,account_name,debit,credit,currency,memo
2026-11-02,AP-0001,accrual,6200,Goods from the manufacturer,1554.62,,EUR,Bergtex Textil GmbH invoice BTX-2026-21
2026-11-02,AP-0001,accrual,1515,Foreign VAT to reclaim (EU refund),295.38,,EUR,Bergtex Textil GmbH invoice BTX-2026-21: foreign VAT to reclaim
2026-11-02,AP-0001,accrual,2100,Accounts payable (supplier invoices),,1850.00,EUR,Bergtex Textil GmbH invoice BTX-2026-21
2026-11-03,AP-0002,accrual,6900,Other supplier invoices,400.00,,EUR,Zeeland Verpakkingen B.V. invoice ZV-4471
2026-11-03,AP-0002,accrual,1510,Input VAT receivable (supplier invoices),84.00,,EUR,Zeeland Verpakkingen B.V. invoice ZV-4471: input VAT
2026-11-03,AP-0002,accrual,2100,Accounts payable (supplier invoices),,484.00,EUR,Zeeland Verpakkingen B.V. invoice ZV-4471
2026-11-04,AP-0003,accrual,6900,Other supplier invoices,1000.00,,EUR,Lagerhaus Nord GmbH invoice LN-2026-0815
2026-11-04,AP-0003,accrual,1515,Foreign VAT to reclaim (EU refund),190.00,,EUR,Lagerhaus Nord GmbH invoice LN-2026-0815: foreign VAT to reclaim
2026-11-04,AP-0003,accrual,2100,Accounts payable (supplier invoices),,1190.00,EUR,Lagerhaus Nord GmbH invoice LN-2026-0815
`;
const PINNED_LEDGER = [
  // 13 Nov: the German supplier's 19% is coded as foreign VAT from its own VAT id (src/ap/books.ts foreignVat), on its own
  // row of the VAT overview, never Dutch input tax (Bergtex and Lagerhaus Nord, both German); the only change to these books.
  // Code review 13 Nov: their VAT is booked to 1515 (foreign VAT to reclaim, EU refund), so 1510 holds only what 5b reclaims.
  "ap-accrual|AP-0001 #1 6200 D155462 C0 EUR cc=CC300 vat=PF_DE19:29538 party=Bergtex Textil GmbH due=null ref=null entry=Bergtex Textil GmbH invoice BTX-2026-21 (received) / BTX-2026-21 · Bergtex Textil GmbH memo=Bergtex Textil GmbH invoice BTX-2026-21",
  "ap-accrual|AP-0001 #2 1515 D29538 C0 EUR cc=null vat=null:null party=Bergtex Textil GmbH due=null ref=null entry=Bergtex Textil GmbH invoice BTX-2026-21 (received) / BTX-2026-21 · Bergtex Textil GmbH memo=Bergtex Textil GmbH invoice BTX-2026-21: foreign VAT to reclaim",
  "ap-accrual|AP-0001 #3 2100 D0 C185000 EUR cc=null vat=null:null party=Bergtex Textil GmbH due=2026-11-16 ref=BTX-2026-21 · Bergtex Textil GmbH entry=Bergtex Textil GmbH invoice BTX-2026-21 (received) / BTX-2026-21 · Bergtex Textil GmbH memo=Bergtex Textil GmbH invoice BTX-2026-21",
  "ap-accrual|AP-0002 #1 6900 D40000 C0 EUR cc=CC300 vat=P21:8400 party=Zeeland Verpakkingen B.V. due=null ref=null entry=Zeeland Verpakkingen B.V. invoice ZV-4471 (received) / ZV-4471 · Zeeland Verpakkingen B.V. memo=Zeeland Verpakkingen B.V. invoice ZV-4471",
  "ap-accrual|AP-0002 #2 1510 D8400 C0 EUR cc=null vat=null:null party=Zeeland Verpakkingen B.V. due=null ref=null entry=Zeeland Verpakkingen B.V. invoice ZV-4471 (received) / ZV-4471 · Zeeland Verpakkingen B.V. memo=Zeeland Verpakkingen B.V. invoice ZV-4471: input VAT",
  "ap-accrual|AP-0002 #3 2100 D0 C48400 EUR cc=null vat=null:null party=Zeeland Verpakkingen B.V. due=2026-11-17 ref=ZV-4471 · Zeeland Verpakkingen B.V. entry=Zeeland Verpakkingen B.V. invoice ZV-4471 (received) / ZV-4471 · Zeeland Verpakkingen B.V. memo=Zeeland Verpakkingen B.V. invoice ZV-4471",
  "ap-accrual|AP-0003 #1 6900 D100000 C0 EUR cc=CC300 vat=PF_DE19:19000 party=Lagerhaus Nord GmbH due=null ref=null entry=Lagerhaus Nord GmbH invoice LN-2026-0815 (received) / LN-2026-0815 · Lagerhaus Nord GmbH memo=Lagerhaus Nord GmbH invoice LN-2026-0815",
  "ap-accrual|AP-0003 #2 1515 D19000 C0 EUR cc=null vat=null:null party=Lagerhaus Nord GmbH due=null ref=null entry=Lagerhaus Nord GmbH invoice LN-2026-0815 (received) / LN-2026-0815 · Lagerhaus Nord GmbH memo=Lagerhaus Nord GmbH invoice LN-2026-0815: foreign VAT to reclaim",
  "ap-accrual|AP-0003 #3 2100 D0 C119000 EUR cc=null vat=null:null party=Lagerhaus Nord GmbH due=2026-11-18 ref=LN-2026-0815 · Lagerhaus Nord GmbH entry=Lagerhaus Nord GmbH invoice LN-2026-0815 (received) / LN-2026-0815 · Lagerhaus Nord GmbH memo=Lagerhaus Nord GmbH invoice LN-2026-0815",
];
const PINNED_EVENTS = [
  "system ap.received AP-0001 {\"classified_by\":\"rules\",\"currency\":\"EUR\",\"doc_kind\":\"invoice\",\"doc_sha256\":\"(sha)\",\"filename\":\"en.pdf\",\"findings\":[],\"invoice_no\":\"BTX-2026-21\",\"read_by\":\"parser\",\"source\":\"upload\",\"status\":\"ready\",\"total\":\"1850.00\",\"vendor\":\"Bergtex Textil GmbH\"}",
  "system ap.received AP-0002 {\"classified_by\":\"rules\",\"currency\":\"EUR\",\"doc_kind\":\"invoice\",\"doc_sha256\":\"(sha)\",\"filename\":\"nl.pdf\",\"findings\":[],\"invoice_no\":\"ZV-4471\",\"read_by\":\"parser\",\"source\":\"upload\",\"status\":\"ready\",\"total\":\"484.00\",\"vendor\":\"Zeeland Verpakkingen B.V.\"}",
  "system ap.received AP-0003 {\"classified_by\":\"rules\",\"currency\":\"EUR\",\"doc_kind\":\"invoice\",\"doc_sha256\":\"(sha)\",\"filename\":\"de.pdf\",\"findings\":[],\"invoice_no\":\"LN-2026-0815\",\"read_by\":\"parser\",\"source\":\"upload\",\"status\":\"ready\",\"total\":\"1190.00\",\"vendor\":\"Lagerhaus Nord GmbH\"}",
];
