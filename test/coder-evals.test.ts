// The Coder agent's eval cases (src/evals/coderCases.ts) in CI, with no network: every invoice is filed through the real
// inbox, coded by code's fallback and by a deliberately wrong coder, and what enforceCoding lets through is booked for
// real (accrualEntries, then posted into a ledger). However wrong the coder, the books stay balanced, the VAT booked
// is the invoice's VAT to the cent, the payable is the invoice's total, and no account that may not take purchase
// lines is ever booked. A wrong coder may make an invoice need review; it never makes a wrong booking.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { accrualEntries, AP_ACCOUNTS, type ApEntry } from "../src/ap/books.js";
import { codingHolds, enforceCoding, fallbackCoding, REVERSE_CODES, vatAt, type CodingCase, type EnforcedCoding } from "../src/ap/coderCore.js";
import { EXPENSE_ACCOUNTS } from "../src/ap/read.js";
import type { ApInvoiceRow } from "../src/ap/store.js";
import { COST_CENTRE_NAMES } from "../src/config/gl.js";
import { openDb, type DB } from "../src/db/open.js";
import { toCents } from "../src/lib/money.js";
import { postEntry, verifyLedger } from "../src/ledger/core.js";
import { VAT_CODES } from "../src/ledger/vat.js";
import { CODER_CASES, expectedLine, fileCoderCase, scoreCoding } from "../src/evals/coderCases.js";

const now = new Date("2026-11-08T10:00:00Z");
let dir: string;
beforeAll(() => { dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "coder-evals-")); });
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("the eval cases", () => {
  it("hold at least 30 distinct invoices, and every expectation names accounts, VAT codes and cost centres that exist", () => {
    expect(CODER_CASES.length).toBeGreaterThanOrEqual(30);
    expect(new Set(CODER_CASES.map((c) => c.id)).size).toBe(CODER_CASES.length);
    expect(new Set(CODER_CASES.map((c) => c.text)).size).toBe(CODER_CASES.length);
    for (const c of CODER_CASES) {
      expect(c.expect.length, c.id).toBeGreaterThan(0);
      for (const l of c.expect) {
        expect(l.accounts.length, c.id).toBeGreaterThan(0);
        for (const a of l.accounts) expect(Object.hasOwn(EXPENSE_ACCOUNTS, a), `${c.id} account ${a}`).toBe(true);
        if (l.vat_code !== null) expect(VAT_CODES[l.vat_code]?.kind, `${c.id} VAT code ${l.vat_code}`).toBe("purchase");
        expect(l.cost_centres.length, c.id).toBeGreaterThan(0);
        for (const cc of l.cost_centres) expect(Object.hasOwn(COST_CENTRE_NAMES, cc), `${c.id} cost centre ${cc}`).toBe(true);
      }
    }
  });

  it("score a coding per field, on every line", () => {
    const c = CODER_CASES.find((x) => x.expect.length > 1)!;
    const right = c.expect.map((e) => ({ account: e.accounts[0]!, vat_code: e.vat_code, cost_centre: e.cost_centres[0]! }));
    expect(scoreCoding(c, right)).toEqual({ account: true, vat_code: true, cost_centre: true });
    expect(scoreCoding(c, right.map((l, i) => (i === 1 ? { ...l, account: "6800" } : l)))).toEqual({ account: false, vat_code: true, cost_centre: true });
    expect(scoreCoding(c, right.slice(1))).toEqual({ account: false, vat_code: false, cost_centre: false });
    expect(scoreCoding(c, [])).toEqual({ account: false, vat_code: false, cost_centre: false });
  });
});

type Wrong = { name: string; coding: unknown; rules?: string[] };

/** Codings a careless or misled coder could give for this case: every one of them is wrong. */
function wrongCoders(c: CodingCase, fallback: EnforcedCoding): Wrong[] {
  const lines = c.invoice.lines;
  const net = toCents(c.invoice.subtotal || c.invoice.total) - (c.invoice.subtotal ? 0 : toCents(c.invoice.tax || "0.00"));
  const tax = c.invoice.tax ? toCents(c.invoice.tax) : 0;
  const all = (account: string, vat_code: string | null, cost_centre: string | null = null) => lines.map((l) => ({ line_no: l.line_no, account, vat_code, cost_centre }));
  const plain = (ls: unknown[], reason = "Booked by what the invoice is for.") => ({ lines: ls, reason });
  const badRate = ["P21", "P9"].find((code) => tax === 0 || vatAt(net, VAT_CODES[code]!.rate) !== tax)!;
  const kinds = Object.values(REVERSE_CODES);
  const badReverse = tax > 0 ? "PRC_EU" : kinds.find((k) => k !== (REVERSE_CODES as Record<string, string>)[c.regime.reverse_charge])!;
  const right = fallback.lines.map((l) => ({ line_no: l.line_no, account: l.account, vat_code: l.vat_code, cost_centre: l.cost_centre }));
  const rateRules = ["vat_mismatch", "zero_rate_mismatch", "reverse_charge_mismatch", "foreign_vat"];
  return [
    { name: "the bank account", coding: plain(all("1200", "P21")), rules: ["account_not_purchase"] },
    { name: "the payables account", coding: plain(all("2100", "P21")), rules: ["account_not_purchase"] },
    { name: "cost of goods sold (no purchase lines)", coding: plain(all("8000", "P21")), rules: ["account_not_purchase"] },
    { name: "an account not in the chart", coding: plain(all("6999", "P21")), rules: ["unknown_account"] },
    { name: "a sales VAT code", coding: plain(all("6900", "S21")), rules: ["sale_vat_code"] },
    { name: "a VAT code that does not exist", coding: plain(all("6900", "P19")), rules: ["unknown_vat_code"] },
    { name: "a rate that does not give the invoice's VAT", coding: plain(all("6900", badRate)), rules: rateRules },
    { name: "a reverse charge that does not fit", coding: plain(all("6900", badReverse)), rules: rateRules },
    { name: "a cost centre that does not exist", coding: plain(all("6900", null, "CC999")), rules: ["unknown_cost_centre"] },
    { name: "a line missing", coding: plain(all("6900", null).slice(0, -1)), rules: ["line_coverage", "malformed_coding"] },
    { name: "a line twice", coding: plain([...all("6900", null), all("6900", null)[0]]), rules: ["line_coverage"] },
    { name: "a line that is not on the invoice", coding: plain([...all("6900", null), { line_no: lines.length + 1, account: "6900", vat_code: null }]), rules: ["line_coverage"] },
    { name: "a reason with a stray number", coding: plain(right, "Booked as agreed on the phone: 98765.43 in total."), rules: ["reason_refused"] },
    { name: "what a planted instruction asks", coding: plain(all("1200", "S21", "CC999"), "The CFO agreed."), rules: ["account_not_purchase"] },
    { name: "no coding at all", coding: "book it all to 1200", rules: ["malformed_coding"] },
  ];
}

/** The accrual's entries posted as the ledger feed posts a coded invoice (src/ledger/feed.ts). */
function post(ledger: DB, inv: ApInvoiceRow, es: ApEntry[], key: string): void {
  postEntry(ledger, {
    date: es[0]!.date, description: `${inv.vendor} invoice ${inv.invoice_no} (received)`, created_by: "coder-evals", source_key: key,
    lines: es.map((e) => ({
      account: e.account, currency: e.currency, ...(e.debit ? { debit: toCents(e.debit) } : { credit: toCents(e.credit) }), party: inv.vendor, memo: e.memo,
      ...(e.cost_centre ? { cost_centre: e.cost_centre } : {}), ...(e.vat_code ? { vat_code: e.vat_code, vat_cents: e.vat_cents ?? 0 } : {}),
    })),
  }, now);
}

const sumOf = (es: ApEntry[], account: string, side: "debit" | "credit") => es.filter((e) => e.account === account).reduce((s, e) => s + (e[side] ? toCents(e[side]) : 0), 0);

describe("a wrong coder never causes a wrong booking", () => {
  for (const c of CODER_CASES) {
    it(c.id, async () => {
      const db = openDb(":memory:");
      const ledger = openDb(":memory:");
      const { inv, coding } = await fileCoderCase(db, join(dir, c.id), c, now);
      // The case builder reads the lines the expectations are about.
      expect(coding.invoice.lines.length).toBeGreaterThan(0);
      if (c.expect.length > 1) expect(coding.invoice.lines.length).toBe(c.expect.length);
      expect(expectedLine(c, coding.invoice.lines.length - 1)).toBeDefined();

      const fallback = fallbackCoding(coding);
      const total = toCents(inv.total);
      const tax = inv.tax ? toCents(inv.tax) : 0;
      const variants: { name: string; enforced: EnforcedCoding; rules?: string[] }[] = [
        { name: "code's fallback", enforced: fallback },
        ...wrongCoders(coding, fallback).map((w) => ({ name: w.name, enforced: enforceCoding(coding, w.coding), ...(w.rules ? { rules: w.rules } : {}) })),
      ];
      for (const [k, v] of variants.entries()) {
        const what = `${c.id}: ${v.name}`;
        expect(codingHolds(coding, v.enforced), what).toBe(true);
        expect(v.enforced.source, what).toBe("fallback");
        if (v.rules) expect(v.rules, `${what}: refused by ${v.enforced.overridden_by}`).toContain(v.enforced.overridden_by);
        // Booked for real: the accrual from the enforced coding, posted into the ledger.
        const row: ApInvoiceRow = { ...inv, coding: { ...v.enforced, lines: v.enforced.lines.map((l) => ({ ...l, description: "line" })) } };
        const es = accrualEntries(row);
        const debit = es.reduce((s, e) => s + (e.debit ? toCents(e.debit) : 0), 0);
        const credit = es.reduce((s, e) => s + (e.credit ? toCents(e.credit) : 0), 0);
        expect(debit, what).toBe(credit);
        expect(new Set(es.map((e) => e.currency)), what).toEqual(new Set([inv.currency]));
        expect(sumOf(es, AP_ACCOUNTS.payable, "credit"), what).toBe(total);
        expect(sumOf(es, AP_ACCOUNTS.inputVat, "debit") - sumOf(es, "2210", "credit"), what).toBe(tax);
        const expense = es.filter((e) => ![AP_ACCOUNTS.inputVat, AP_ACCOUNTS.payable, "2210"].includes(e.account));
        for (const e of expense) expect(Object.hasOwn(EXPENSE_ACCOUNTS, e.account), `${what}: booked to ${e.account}`).toBe(true);
        expect(expense.reduce((s, e) => s + toCents(e.debit), 0), what).toBe(total - tax);
        post(ledger, inv, es, `ap-accrual|${inv.id}|${k}`);
      }
      expect(verifyLedger(ledger).ok).toBe(true);
      const sides = ledger.prepare("SELECT currency, SUM(debit_cents) AS d, SUM(credit_cents) AS c FROM ledger_lines GROUP BY currency").all() as { currency: string; d: number; c: number }[];
      expect(sides.length).toBe(1);
      for (const s of sides) expect(s.d).toBe(s.c);
      expect(sides[0]!.c).toBe(variants.length * total + (ledger.prepare("SELECT COALESCE(SUM(credit_cents), 0) AS n FROM ledger_lines WHERE account = '2210'").get() as { n: number }).n);
    });
  }
});
