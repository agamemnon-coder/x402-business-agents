// npm run ledger -- <command>: Purser's own books (docs/ledger.md).
//   sync                         post every movement Purser recorded that is not in the ledger yet (each once)
//   trial [--date YYYY-MM-DD]    trial balance
//   pnl [--year YYYY]            profit and loss for a year (default: this year, up to today)
//   balance [--date YYYY-MM-DD]  balance sheet; must balance in every currency
//   vat --quarter 2026Q4         overview for the Dutch VAT return (not a filing)
//   ageing receivables|payables [--date YYYY-MM-DD]
//   cash | stock
//   close --month 2026-11 | close --year 2026
//   export --csv | export --json
//   verify                       recompute the ledger's hash chain
//   serve [--port 4500]          the read-only page on 127.0.0.1
// Test money only. Amounts are in each line's own currency.

import { openDb } from "../db/open.js";
import { fromCents } from "../lib/money.js";
import { closeMonth, closeYear } from "../ledger/close.js";
import { verifyLedger } from "../ledger/core.js";
import { exportCsv, exportJson } from "../ledger/export.js";
import { syncLedger } from "../ledger/feed.js";
import { ledgerApp } from "../ledger/serve.js";
import { ageing, balanceSheet, cashByCurrency, profitAndLoss, trialBalance, vatOverview } from "../ledger/reports.js";
import { stockOnHand } from "../ledger/stock.js";
import { fileIntoLocalVault } from "../vault/build.js";

const [cmd = "help", ...rest] = process.argv.slice(2);
const flag = (name: string) => { const i = rest.indexOf(`--${name}`); return i >= 0 ? rest[i + 1] : undefined; };
const money = (c: number) => (c < 0 ? `-${fromCents(-c)}` : fromCents(c));
const today = new Date().toISOString().slice(0, 10);
const thisQuarter = () => { const d = new Date(); return `${d.getUTCFullYear()}Q${Math.floor(d.getUTCMonth() / 3) + 1}`; };

const db = openDb();

switch (cmd) {
  case "sync": {
    const r = syncLedger(db);
    console.log(`posted ${r.posted} new entries; ${r.already} were already in the ledger`);
    break;
  }
  case "trial": {
    for (const t of trialBalance(db, flag("date"))) console.log(`${t.account}  ${t.name.padEnd(46)} ${t.currency.padEnd(5)} Dr ${money(t.debit_cents).padStart(12)}  Cr ${money(t.credit_cents).padStart(12)}  ${money(t.balance_cents).padStart(12)}`);
    break;
  }
  case "pnl": {
    const year = Number(flag("year") ?? today.slice(0, 4));
    for (const [cur, p] of Object.entries(profitAndLoss(db, { from: `${year}-01-01`, to: `${year}-12-31` }))) {
      console.log(`${cur}: revenue ${money(p.revenue_cents)}, expenses ${money(p.expense_cents)}, result ${money(p.result_cents)}`);
      for (const a of p.accounts) console.log(`  ${a.account}  ${a.name.padEnd(46)} ${money(a.cents).padStart(12)}`);
    }
    break;
  }
  case "balance": {
    for (const [cur, b] of Object.entries(balanceSheet(db, flag("date") ?? today))) {
      console.log(`${cur}: assets ${money(b.assets_cents)} = liabilities ${money(b.liabilities_cents)} + equity ${money(b.equity_cents)} + open result ${money(b.result_cents)} (${b.balanced ? "balances" : "DOES NOT BALANCE"})`);
    }
    break;
  }
  case "vat": {
    const v = vatOverview(db, flag("quarter") ?? thisQuarter());
    console.log(`VAT ${v.quarter} (${v.from} to ${v.to}). ${v.notice}`);
    for (const [r, x] of Object.entries(v.rubrics)) console.log(`  ${r.padEnd(3)} base ${money(x.base_cents).padStart(12)}  VAT ${money(x.vat_cents).padStart(12)}`);
    console.log(`  5a owed ${money(v.owed_5a_cents)}, 5b input VAT ${money(v.input_5b_cents)}, 5c balance ${money(v.balance_5c_cents)}`);
    console.log(`  lines with no VAT code yet: ${v.uncoded_lines}; VAT-coded lines in another currency: ${v.other_currency_lines}`);
    break;
  }
  case "ageing": {
    const kind = rest[0] === "payables" ? "payables" : "receivables";
    for (const i of ageing(db, kind, flag("date") ?? today).items) console.log(`${i.party.padEnd(30)} ${i.doc_ref.padEnd(16)} ${i.currency} ${money(i.open_cents).padStart(12)}  due ${i.due_date ?? "-"}  ${i.bucket}`);
    break;
  }
  case "cash": {
    for (const c of cashByCurrency(db)) console.log(`${c.account} ${c.currency.padEnd(5)} ${money(c.balance_cents).padStart(12)}`);
    break;
  }
  case "stock": {
    for (const s of stockOnHand(db)) console.log(`${s.sku.padEnd(12)} ${s.name.padEnd(30)} ${String(s.qty).padStart(6)}  ${s.currency} ${money(s.value_cents)} (average ${money(s.average_cents)})`);
    break;
  }
  case "close": {
    const month = flag("month");
    const year = flag("year");
    if (month) console.log(closeMonth(db, month, "cli").locked ? `${month} is closed` : `${month} was already closed`);
    else if (year) { const r = closeYear(db, Number(year), "cli"); console.log(`${year} closed${r.entry_id ? ` (closing entry ${r.entry_id})` : ""}; months locked: ${r.locked_months.join(", ")}`); }
    else { console.error("close --month YYYY-MM | close --year YYYY"); process.exitCode = 2; }
    // A closed period gets its month report, VAT overview or year report in the vault (unless KIT11_VAULT=off).
    if (month || year) console.log(await fileIntoLocalVault(db));
    break;
  }
  case "export": {
    process.stdout.write(rest.includes("--json") ? exportJson(db) : exportCsv(db));
    break;
  }
  case "verify": {
    const r = verifyLedger(db);
    if (r.ok) console.log(`ledger verified: ${r.entries} entries, head ${r.head}`);
    else { console.error(`ledger chain broken at entry ${r.entry_id}: ${r.reason}`); process.exitCode = 1; }
    break;
  }
  case "serve": {
    const port = Number(flag("port") ?? process.env.KIT11_LEDGER_PORT ?? 4500);
    // The Host check of the payables and vault pages (src/ledger/serve.ts).
    ledgerApp(db).listen(port, "127.0.0.1", () => console.log(`Purser's books (read-only): http://127.0.0.1:${port}/`));
    break;
  }
  default:
    console.log("npm run ledger -- sync | trial | pnl | balance | vat --quarter 2026Q4 | ageing receivables|payables | cash | stock | close --month 2026-11 | close --year 2026 | export --csv|--json | verify | serve");
}
