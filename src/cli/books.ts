// npm run books                 the trial balance, cash moved per bank account and spend per cost centre (double entry)
// npm run books -- --csv        every posting (debit and credit) as CSV for an ERP or a bookkeeper
// npm run books -- --json       the whole finance view as JSON
// Read-only. Amounts are integer cents in each currency; debits equal credits per currency.

import { books, booksCsv, booksJson } from "../accounting/books.js";
import { openDb } from "../db/open.js";
import { fromCents } from "../lib/money.js";

const b = books(openDb());
const arg = process.argv[2];
const money = (c: number) => (c < 0 ? `-${fromCents(-c)}` : fromCents(c));
if (arg === "--csv") process.stdout.write(booksCsv(b.postings));
else if (arg === "--json") process.stdout.write(booksJson(b));
else {
  console.log(`Trial balance (${b.postings.length} postings; ${b.balanced ? "debits equal credits in every currency" : "NOT BALANCED"})`);
  for (const t of b.trial) console.log(`  ${t.account}  ${t.name.padEnd(46)} ${t.currency.padEnd(5)} Dr ${fromCents(t.debit_cents).padStart(12)}  Cr ${fromCents(t.credit_cents).padStart(12)}`);
  console.log("Cash moved through Purser (not balances: opening balances are not booked)");
  for (const c of b.cash) console.log(`  ${c.account}  ${c.name.padEnd(46)} ${c.currency.padEnd(5)} ${money(c.moved_cents).padStart(12)}`);
  console.log("Spend per cost centre");
  for (const s of b.spend) console.log(`  ${s.cost_centre}  ${s.name.padEnd(46)} ${s.currency.padEnd(5)} ${money(s.cents).padStart(12)}`);
}
