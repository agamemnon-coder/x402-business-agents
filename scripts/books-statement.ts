// npm run books:statement: the files behind /books (owner, 12 Nov), written into docs/assets/books/ and committed.
//
// 1. The balance sheet and P&L of the Moneybird sandbox run's test company (docs/runs/2026-11-12-moneybird-sandbox.md):
//    its books rebuilt with the run's own code, on its own date (src/erp/sandboxWorld.ts: buildSandboxWorld at the
//    world-build step's start, then recodeSandboxInvoice as the run's world-recode step did). Before anything is written,
//    every purchase invoice is checked against the record's read-back rows (Purser's side): net, VAT and total to the
//    cent, and the paid one paid. A difference stops the script: nothing on the page is a figure the record contradicts.
//    The statement is the vault's own year data (src/vault/data.ts yearData); the PDF is drawn from the same file, through the
//    same view as /books (src/vault/statementPdf.ts). The cash chart's points are the bank balance after each entry.
// 2. "Invoices, sorted by Claude": the Coder agent's codings from the 12 November eval (docs/evals/coder.json), for the
//    cases Claude coded right on account, VAT code and cost centre; each invoice's supplier, number, date and total read
//    from the case's own text by Purser's parser, and its place in the vault computed by src/vault/layout.ts.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseApFallback } from "../src/ap/reading.js";
import { openDb } from "../src/db/open.js";
import { buildSandboxWorld, recodeSandboxInvoice, SANDBOX_COMPANY } from "../src/erp/sandboxWorld.js";
import { CODER_CASES } from "../src/evals/coderCases.js";
import { isBank } from "../src/ledger/accounts.js";
import { yearData } from "../src/vault/data.js";
import { invoicePath } from "../src/vault/layout.js";
import { statementPdf, statementView, type BooksStatementFile } from "../src/vault/statementPdf.js";

const RECORD = "docs/runs/2026-11-12-moneybird-sandbox.json";
const OUT = "docs/assets/books";
export const STATEMENT_DAY = "2026-11-12";

const record = JSON.parse(readFileSync(RECORD, "utf8")) as { reconciliation: { rows: { role: string; number: string; purser: { net: string; vat: string; gross: string; state: string } }[] }; calls: { by_step: { step: string; started_at: string }[] } };
const at = (step: string) => new Date(record.calls.by_step.find((s) => s.step === step)!.started_at);

const dir = mkdtempSync(join(tmpdir(), "books-"));
try {
  const db = openDb(join(dir, "ledger.sqlite"));
  const world = await buildSandboxWorld(db, join(dir, "world"), at("world-build"));
  recodeSandboxInvoice(db, undefined, undefined, at("world-recode"));
  // The record's read-back, Purser's side: every invoice equal to the rebuilt books.
  for (const r of record.reconciliation.rows.filter((x) => x.role === "invoice")) {
    const inv = world.invoices.find((i) => i.number === r.number);
    if (!inv) throw new Error(`${r.number}: in the record, not in the rebuilt books`);
    const got = { net: inv.net, vat: inv.vat, gross: inv.total }, want = { net: r.purser.net, vat: r.purser.vat, gross: r.purser.gross };
    if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`${r.number}: rebuilt ${JSON.stringify(got)}, record ${JSON.stringify(want)}`);
    if ((r.purser.state === "paid") !== (world.paid.invoice.startsWith(r.number))) throw new Error(`${r.number}: paid in one, not the other`);
  }
  const year = yearData(db, Number(STATEMENT_DAY.slice(0, 4)));
  // The bank balance after each entry that moves it, in posting order: the cash chart's points, read from the ledger itself.
  const moves = db.prepare(`SELECT e.entry_id AS id, e.posting_date AS day, e.description AS what, l.account AS account, l.currency AS currency, l.debit_cents - l.credit_cents AS cents
    FROM ledger_entries e JOIN ledger_lines l ON l.entry_id = e.entry_id ORDER BY e.posting_date, e.entry_id, l.line_no`).all() as { id: number; day: string; what: string; account: string; currency: string; cents: number }[];
  const cash: { day: string; what: string; currency: string; balance_cents: number }[] = [];
  let bal = 0;
  for (const m of moves.filter((x) => isBank(x.account) && x.currency === "EUR")) { bal += m.cents; cash.push({ day: m.day, what: m.what, currency: m.currency, balance_cents: bal }); }
  db.close();

  // Invoices sorted by Claude: the eval's right codings, each in its vault folder.
  const coder = JSON.parse(readFileSync("docs/evals/coder.json", "utf8")) as { ran_at: string; rows: { case: string; model: string; enforced: { source: string; lines: { account: string; vat_code: string | null; cost_centre: string | null }[] } | null; correct: Record<string, boolean> | null }[] };
  const sorted = coder.rows
    .filter((r) => r.model === "claude-haiku-5-5" && r.enforced?.source === "claude" && r.correct && Object.values(r.correct).every(Boolean) && r.enforced.lines.length === 1 && r.enforced.lines[0]!.vat_code)
    .flatMap((r) => {
      const c = CODER_CASES.find((x) => x.id === r.case);
      if (!c) return [];
      const p = parseApFallback(c.text);
      if (!p.vendor || !p.invoice_no || !/^\d{4}-\d{2}-\d{2}$/.test(p.issue_date) || !p.total) return [];
      const l = r.enforced!.lines[0]!;
      const path = invoicePath("Test company", { vendor: p.vendor, invoice_no: p.invoice_no, date: p.issue_date, currency: p.currency || "EUR", total: p.total, blocked: false }, "en");
      const reason = (r as { raw?: { reason?: string } }).raw?.reason ?? null;
      return [{ case: r.case, model: r.model, path: path.split("/").slice(1), supplier: p.vendor, number: p.invoice_no, date: p.issue_date, currency: p.currency || "EUR", total: p.total, account: l.account, vat: l.vat_code, cost_centre: l.cost_centre, reason }];
    })
    .slice(0, 6);

  mkdirSync(OUT, { recursive: true });
  const pdfName = `books-balance-sheet-${STATEMENT_DAY}.pdf`;
  const file: BooksStatementFile = {
    company: SANDBOX_COMPANY, day: STATEMENT_DAY, record: RECORD, pdf: pdfName,
    invoices_checked: record.reconciliation.rows.filter((x) => x.role === "invoice").length,
    balance: year.balance, pnl: year.pnl, cash,
    sorted: { eval: "docs/evals/coder.json", ran_at: coder.ran_at, rows: sorted },
  };
  // The PDF from the same file the page reads, through the same view: the two cannot disagree.
  const view = statementView(file);
  if (!view || !view.balances) throw new Error("the statement does not balance: nothing written");
  writeFileSync(join(OUT, pdfName), await statementPdf(view));
  writeFileSync(join(OUT, `statement-${STATEMENT_DAY}.json`), `${JSON.stringify({ note: "Written by npm run books:statement (scripts/books-statement.ts). Do not edit.", ...file }, null, 2)}\n`);
  console.log(`wrote ${OUT}/${pdfName} and statement-${STATEMENT_DAY}.json: ${year.balance.map((b) => `${b.currency} assets ${b.assets}, balanced ${b.balanced}`).join("; ")}; ${sorted.length} sorted invoices`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
