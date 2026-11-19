// T:0's reports against its journal and Purser's books (src/accounting/t0Reports.ts), on stand-in reports and entries:
// three ways agreeing, other teams' entries explaining a report total, a cent off on either side, the P&L read for its
// period only, and a balance sheet that does not balance. No network.

import { describe, expect, it } from "vitest";
import { OUR_ACCOUNTS, reconcileReports, reportBalances } from "../src/accounting/t0Reports.js";
import type { T0BalanceSheet, T0JournalEntry, T0ProfitLoss } from "../src/accounting/t0.js";

const P = { id: "p11", label: "Nov 2026", start_date: "2026-11-01", end_date: "2026-11-30" };
const TYPES: Record<string, string> = { "11120": "asset", "11210": "asset", "11410": "asset", "11999": "asset", "32000": "equity", "42000": "income", "51200": "expense", "63410": "expense", "63700": "expense" };
const atoms = (cents: number) => cents * 10_000; // atoms_per_unit 1,000,000

/** One entry per account, with the books' own net debit, balanced against equity in one entry of Purser's. */
function purserEntries(adjust: Record<string, number> = {}): T0JournalEntry[] {
  const lines = OUR_ACCOUNTS.map((a) => ({ account: a.account, cents: a.oursNetDebitCents + (adjust[a.account] ?? 0) }));
  return [{
    id: "je1", je_number: "PUR-1", entry_date: "2026-11-03", memo: null, source: "manual", currency: "USD", transaction_currency: null, atoms_per_unit: 1_000_000, total_debit_atoms: 0, total_credit_atoms: 0, status: "posted",
    lines: lines.map((l, i) => ({ id: `l${i}`, account_id: `a${l.account}`, account_number: l.account, account_name: l.account, account_type: TYPES[l.account]!, line_type: l.cents >= 0 ? "debit" as const : "credit" as const, amount_atoms: atoms(Math.abs(l.cents)), transaction_amount_atoms: null, memo: null })),
  }];
}
const other = (date: string, account: string, cents: number): T0JournalEntry => ({
  id: `o${account}${date}`, je_number: "JE-OTHER", entry_date: date, memo: null, source: "manual", currency: "USD", transaction_currency: null, atoms_per_unit: 1_000_000, total_debit_atoms: 0, total_credit_atoms: 0, status: "posted",
  lines: [{ id: "x", account_id: `a${account}`, account_number: account, account_name: account, account_type: TYPES[account]!, line_type: cents >= 0 ? "debit" : "credit", amount_atoms: atoms(Math.abs(cents)), transaction_amount_atoms: null, memo: null }],
});

/** The reports T:0 would compute from these entries (credit-normal accounts shown as credit balances). */
function reports(entries: T0JournalEntry[], o: { off?: Record<string, number>; unbalanced?: boolean } = {}): { bs: T0BalanceSheet; pl: T0ProfitLoss } {
  const net = new Map<string, number>(), netP = new Map<string, number>();
  for (const e of entries) for (const l of e.lines) {
    const c = (l.line_type === "debit" ? 1 : -1) * (l.amount_atoms / 10_000);
    net.set(l.account_number!, (net.get(l.account_number!) ?? 0) + c);
    if (e.entry_date >= P.start_date) netP.set(l.account_number!, (netP.get(l.account_number!) ?? 0) + c);
  }
  const shown = (acct: string, m: Map<string, number>) => atoms(((m.get(acct) ?? 0) + (o.off?.[acct] ?? 0)) * (/^(asset|expense)/.test(TYPES[acct]!) ? 1 : -1));
  const kid = (acct: string, m: Map<string, number>) => ({ account_id: `a${acct}`, account_number: acct, name: acct, is_postable: true, balances: { [P.id]: shown(acct, m) } });
  const bsAccts = Object.keys(TYPES).filter((a) => /^(asset|equity)/.test(TYPES[a]!)), plAccts = Object.keys(TYPES).filter((a) => !/^(asset|equity)/.test(TYPES[a]!));
  const head = { periods: [P], reporting_currency: "USD", atoms_per_unit: 1_000_000 };
  const assets = bsAccts.filter((a) => TYPES[a] === "asset").reduce((s, a) => s + shown(a, net), 0);
  return {
    bs: { ...head, sections: [
      { account_type: "asset", label: "Assets", balances: { [P.id]: assets }, children: bsAccts.filter((a) => TYPES[a] === "asset").map((a) => kid(a, net)) },
      { account_type: "liability", label: "Liabilities", balances: { [P.id]: 0 }, children: [] },
      { account_type: "equity", label: "Equity", balances: { [P.id]: o.unbalanced ? assets - 1 : assets }, children: [kid("32000", net)] },
    ] },
    pl: { ...head, sections: [{ key: "all", label: "All", balances: {}, children: plAccts.map((a) => kid(a, netP)) }] },
  };
}

describe("T:0's reports, its journal and Purser's books", () => {
  it("agree three ways on every account, with other teams' entries explaining T:0's totals", () => {
    const entries = [...purserEntries(), other("2026-11-03", "11120", 12_345), other("2026-11-03", "51200", 100), other("2026-10-15", "63410", 999)];
    const { bs, pl } = reports(entries);
    const r = reconcileReports(bs, pl, entries);
    expect(r.agree).toBe(9);
    expect(r.entries).toEqual({ ours: 1, others: 3 });
    expect(r.accounts.find((a) => a.account === "11120")).toMatchObject({ t0Others: 12_345, booksAgree: true, reportAgrees: true });
    // October's entry on an expense account is outside the November P&L: not counted there.
    expect(r.accounts.find((a) => a.account === "63410")).toMatchObject({ t0Others: 0, reportAgrees: true });
  });
  it("names a cent between the books and Purser's entries, and a cent between the report and the entries", () => {
    const entries = purserEntries({ "63700": 1 });
    const { bs, pl } = reports(entries, { off: { "11410": 1 } });
    const r = reconcileReports(bs, pl, entries);
    expect(r.accounts.find((a) => a.account === "63700")).toMatchObject({ booksAgree: false, reportAgrees: true });
    expect(r.accounts.find((a) => a.account === "11410")).toMatchObject({ booksAgree: true, reportAgrees: false });
    expect(r.agree).toBe(7);
  });
  it("reports a balance sheet that does not balance", () => {
    const entries = purserEntries();
    const { bs, pl } = reports(entries, { unbalanced: true });
    expect(reconcileReports(bs, pl, entries).balanceSheetBalances).toBe(false);
    expect(reconcileReports(reports(entries).bs, pl, entries).balanceSheetBalances).toBe(true);
  });
  it("reads nested report accounts by number", () => {
    const m = reportBalances([{ balances: {}, children: [{ account_id: "p", account_number: "1", name: "p", is_postable: false, balances: { x: 5 }, own_balances: { x: 0 }, children: [{ account_id: "c", account_number: "2", name: "c", is_postable: true, balances: { x: 5 } }] }] }], "x");
    expect([...m]).toEqual([["1", 0], ["2", 5]]);
  });
});
