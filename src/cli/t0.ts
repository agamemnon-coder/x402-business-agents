// npm run t0 -- accounts                         our chart next to T:0's: which accounts exist, are postable and of the right type
// npm run t0 -- push [--rate USD=0.92] [--dry-run]   post the books (npm run books) to T:0 as manual journal entries
// npm run t0 -- compare [--rate USD=0.92] [--from YYYY-MM-DD] [--to YYYY-MM-DD]   T:0's P&L against our books, per account
// Reads T0_API_KEY from the environment (a key from T:0 Connections > API Keys); without it, says what is missing and
// sends nothing. The ledger is KIT11_DB. --rate is units of T:0's functional currency per unit of another currency,
// one rate for every date. Posted entries are recorded in the ledger's t0_postings table, so a re-run skips them.
// docs/t0.md has the account mapping and what to set up in T:0 first.

import { parseArgs } from "node:util";
import { books, type Posting } from "../accounting/books.js";
import {
  buildEntries, compareOwnEntries, functionalCurrency, pushBooks, resolveAccounts, T0Client, t0AccountType, type T0Entry,
} from "../accounting/t0.js";
import { CHART } from "../config/gl.js";
import { T0_MAP_VERSION, T0_SANDBOX_MAP } from "../config/t0Map.js";
import { openDb, type DB } from "../db/open.js";
import { redactSecrets } from "../lib/redact.js";

const USAGE = "usage: npm run t0 -- accounts | push [--rate CUR=rate ...] [--dry-run] [--map sandbox] | compare [--rate CUR=rate ...] [--map sandbox]; --map sandbox uses src/config/t0Map.ts for our codes T:0 lacks";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { rate: { type: "string", multiple: true }, "dry-run": { type: "boolean" }, from: { type: "string" }, to: { type: "string" }, map: { type: "string" } },
});
const cmd = positionals[0];
if (cmd !== "accounts" && cmd !== "push" && cmd !== "compare") {
  console.log(USAGE);
  process.exit(cmd ? 1 : 0);
}

function chartTable(): void {
  console.log("Accounts to create in T:0 (account_number = our code):");
  for (const [code, name] of Object.entries(CHART)) console.log(`  ${code}  ${(t0AccountType(code) ?? "?").padEnd(26)} ${name}`);
}

const key = process.env.T0_API_KEY?.trim();
if (!key) {
  console.log("T0_API_KEY is not set: nothing was sent to T:0.");
  console.log("To post Purser's books to T:0:");
  console.log("  1. In T:0, Connections > API Keys: create a key with customer_api:read and customer_api:post_journal_entries.");
  console.log("  2. Create our chart in T:0 (npm run t0 -- accounts lists it), account_number = our code, active and postable.");
  console.log("  3. Set the entity's functional currency and First Month of Books in T:0.");
  console.log("  4. export T0_API_KEY=<the key>, then npm run t0 -- accounts, then npm run t0 -- push --dry-run.");
  if (cmd === "accounts") chartTable();
  process.exit(0);
}

const client = new T0Client({ apiKey: key, baseUrl: process.env.T0_BASE_URL || undefined, entity: process.env.T0_ENTITY || undefined });

function rates(): (date: string, cur: string) => number | undefined {
  const m = new Map<string, number>();
  for (const r of values.rate ?? []) {
    const hit = /^([A-Za-z]{3})=(\d+(?:\.\d+)?)$/.exec(r);
    if (!hit || Number(hit[2]) <= 0) throw new Error(`--rate ${r}: expected CUR=rate, e.g. USD=0.92`);
    m.set(hit[1]!.toUpperCase(), Number(hit[2]));
  }
  return (_date, cur) => m.get(cur);
}

if (values.map !== undefined && values.map !== "sandbox") throw new Error(`--map ${values.map}: only "sandbox" exists`);
const fallback = values.map === "sandbox" ? T0_SANDBOX_MAP : undefined;

async function entriesFor(postings: Posting[]): Promise<{ entries: T0Entry[]; currency: string; numbers: Map<string, string> }> {
  const { currency, atomsPerUnit } = await functionalCurrency(client);
  const { map, warnings, numbers, labels } = resolveAccounts(await client.listGlAccounts(), postings.map((p) => p.account), { fallback });
  for (const w of warnings) console.log(`WARNING  ${w}`);
  if (fallback) console.log(`Account map: sandbox v${T0_MAP_VERSION} (${[...numbers].filter(([c, n]) => c !== n).map(([c, n]) => `${c}>${n}`).join(" ")})`);
  return { entries: buildEntries(postings, map, currency, rates(), { atomsPerUnit, labels }), currency, numbers };
}

function postedTable(db: DB): Set<string> {
  db.exec("CREATE TABLE IF NOT EXISTS t0_postings (je_number TEXT PRIMARY KEY, stable_id TEXT NOT NULL, t0_id TEXT NOT NULL, idempotency_key TEXT NOT NULL, posted_at TEXT NOT NULL)");
  return new Set((db.prepare("SELECT je_number FROM t0_postings").all() as { je_number: string }[]).map((r) => r.je_number));
}

async function accounts(): Promise<void> {
  const entities = await client.listEntities();
  console.log(`Entity: ${entities.map((e) => `${e.name}${e.country ? ` (${e.country})` : ""}`).join(", ") || "(none listed)"}`);
  const chart = await client.listGlAccounts();
  let missing = 0;
  for (const [code, name] of Object.entries(CHART)) {
    const want = t0AccountType(code) ?? "?";
    const found = chart.filter((a) => a.account_number === code);
    const usable = found.filter((a) => a.is_active && a.is_postable);
    const status = !found.length ? "MISSING" : !usable.length ? "NOT POSTABLE" : usable.length > 1 ? "DUPLICATE" : usable[0]!.account_type !== want ? `TYPE ${usable[0]!.account_type}` : "ok";
    if (status !== "ok") missing++;
    console.log(`  ${code}  ${want.padEnd(26)} ${status.padEnd(14)} ${name}`);
  }
  console.log(missing ? `${missing} account(s) to fix in T:0 before a push` : "Every account in our chart is in T:0, postable, of the expected type");
}

async function push(): Promise<void> {
  const db = openDb();
  const b = books(db);
  if (!b.balanced) throw new Error("our books are not balanced (npm run books): nothing was sent");
  const { entries, currency } = await entriesFor(b.postings);
  if (values["dry-run"]) {
    for (const e of entries) {
      const r = e.request;
      console.log(`${e.jeNumber}  ${r.entry_date}  ${r.currency}${r.transaction_currency ? `/${r.transaction_currency}` : ""}  ${r.memo ?? ""}`);
      r.lines.forEach((l, i) => console.log(`    ${e.accounts[i]}  ${l.line_type.padEnd(6)} ${String(l.amount_atoms).padStart(10)}${l.transaction_amount_atoms !== undefined ? ` (${l.transaction_amount_atoms} ${r.transaction_currency})` : ""}  ${l.memo ?? ""}`));
    }
    console.log(`DRY RUN: ${entries.length} entries in ${currency} built; nothing was posted`);
    return;
  }
  const known = postedTable(db);
  const record = db.prepare("INSERT OR REPLACE INTO t0_postings (je_number, stable_id, t0_id, idempotency_key, posted_at) VALUES (?, ?, ?, ?, ?)");
  const r = await pushBooks(client, entries, known, (p, e) => record.run(p.je_number, p.stable_id, p.id, e.idempotencyKey, new Date().toISOString()));
  for (const p of r.posted) console.log(`POSTED   ${p.je_number}  T:0 ${p.id}`);
  for (const s of r.skipped) console.log(`SKIPPED  ${s.je_number}  ${s.reason}`);
  console.log(`${r.posted.length} posted, ${r.skipped.length} skipped, of ${entries.length} entries (${currency})`);
}

async function compare(): Promise<void> {
  const b = books(openDb());
  const dates = b.postings.map((p) => p.date.slice(0, 10)).sort();
  const from = values.from ?? dates[0], to = values.to ?? dates.at(-1);
  if (!from || !to) { console.log("No postings in our books: nothing to compare"); return; }
  const { entries, currency, numbers } = await entriesFor(b.postings);
  const inWindow = entries.filter((e) => e.request.entry_date >= from && e.request.entry_date <= to);
  const held: Awaited<ReturnType<T0Client["getJournalEntry"]>>[] = [];
  for await (const je of client.listJournalEntries({ dateFrom: from, dateTo: to, source: ["manual"] })) held.push(je);
  const c = compareOwnEntries(inWindow, numbers, held);
  const money = (atoms: number) => (atoms / 100).toFixed(2);
  console.log(`Our entries only (je_number PUR-), ${from} to ${to}, ${currency}, net debit minus credit: ours, T:0, difference`);
  console.log(`  ${c.entries_in_t0} PUR- entries in T:0, ${c.entries_ours} built from our books, ${c.foreign_entries} other manual entries in the window ignored`);
  for (const r of c.rows) console.log(`  ${r.account}  (ours ${r.ours_codes.join("+") || "-"}) ${money(r.ours_atoms).padStart(12)} ${money(r.t0_atoms).padStart(12)} ${r.diff_atoms ? money(r.diff_atoms).padStart(12) : ""}`);
  if (c.matches) console.log(`T:0 matches our Books line by line (${c.rows.length} mapped accounts, ${c.entries_in_t0} entries)`);
  else {
    console.log(`DIFFERENT: ${c.differences.length} account(s) differ (${c.differences.map((d) => d.account).join(", ")}); entries ours ${c.entries_ours}, in T:0 ${c.entries_in_t0}`);
    process.exitCode = 1;
  }
}

try {
  await (cmd === "accounts" ? accounts() : cmd === "push" ? push() : compare());
} catch (e) {
  console.error(redactSecrets(e instanceof Error ? e.message : String(e)));
  process.exitCode = 1;
}
