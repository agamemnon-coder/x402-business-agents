// npm run t0:reports [-- --from <saved responses.json>]: T:0's Balance Sheet and P&L for November 2026 against every
// journal line T:0 holds and against Purser's books as recorded on 10 Nov (src/accounting/t0Reports.ts). Read only, on
// T:0's shared sandbox entity. Writes docs/runs/2026-11-19-t0-reports.json and .md: per account the three figures, the
// count of other teams' entries (never their content), and each GET's path and HTTP status; no key, header or token.

import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { T0Client, T0Error, type T0BalanceSheet, type T0JournalEntry, type T0ProfitLoss } from "../src/accounting/t0.js";
import { reconcileReports } from "../src/accounting/t0Reports.js";

const { values } = parseArgs({ options: { from: { type: "string" }, out: { type: "string", default: "docs/runs/2026-11-19-t0-reports" } } });
const ENTITY = "entity_prod_ieEAMzvhgtHalvsm";
const Q = { start_date: "2026-11-01", end_date: "2026-11-30", period_type: "monthly" as const };

const calls: { at: string; method: string; path: string; status: number }[] = [];
let bs: T0BalanceSheet, pl: T0ProfitLoss;
const entries: T0JournalEntry[] = [];
let readAt = new Date().toISOString();
if (values.from) {
  const saved = JSON.parse(readFileSync(values.from, "utf8")) as { bs: T0BalanceSheet; pl: T0ProfitLoss; entries: T0JournalEntry[]; read_at: string; calls: typeof calls };
  ({ bs, pl } = saved); entries.push(...saved.entries); readAt = saved.read_at; calls.push(...saved.calls);
} else {
  const key = process.env.T0_API_KEY;
  if (!key) throw new Error("T0_API_KEY is not set (or pass --from)");
  const noting: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const res = await fetch(input, init);
    calls.push({ at: new Date().toISOString(), method: (init?.method ?? "GET").toUpperCase(), path: url.pathname, status: res.status });
    return res;
  };
  const client = new T0Client({ apiKey: key, entity: ENTITY, fetch: noting });
  try {
    bs = await client.balanceSheet(Q);
    pl = await client.profitLoss(Q);
    for await (const e of client.listJournalEntries({ dateTo: Q.end_date })) entries.push(e);
  } catch (e) {
    // Refused (a revoked key, a missing scope): recorded as it came, code and T:0's own words; nothing is concluded.
    if (!(e instanceof T0Error)) throw e;
    const blocked = { run: "t0-reports", read_at: readAt, entity: ENTITY, query: Q, blocked: { status: e.status, code: e.code, detail: String(e.detail ?? "").slice(0, 300) }, calls };
    writeFileSync(`${values.out}.json`, `${JSON.stringify(blocked, null, 2)}\n`);
    writeFileSync(`${values.out}.md`, [
      "# T:0's reports against its journal and Purser's books, 2026-11-19: blocked",
      "",
      `**Not run:** T:0 refused the first read with ${e.status} ${e.code}: "${blocked.blocked.detail}". Nothing was read and nothing is concluded; no access control was worked around.`,
      "",
      "`npm run t0:reports` (scripts/t0-reports.ts, src/accounting/t0Reports.ts) is ready: the three-way check (T:0's Balance Sheet and P&L per account = every journal line T:0 holds = Purser's entries plus other teams'; Purser's entries = Purser's books of 10 Nov) is unit-tested on stand-ins (test/t0-reports.test.ts). It needs a new T:0 key (Connections > API keys, customer_api:read).",
      "",
      "| # | Time | Call | HTTP |",
      "|---|---|---|---|",
      ...calls.map((c, i) => `| ${i + 1} | ${c.at.slice(11, 23)} | \`${c.method} ${c.path}\` | ${c.status} |`),
      "",
    ].join("\n"));
    console.error(`BLOCKED  T:0 answered ${e.status} ${e.code}; wrote ${values.out}.json and .md`);
    process.exit(3);
  }
}
const r = reconcileReports(bs, pl, entries);
const money = (c: number | null) => (c == null ? "–" : `${c < 0 ? "-" : ""}${Math.floor(Math.abs(c) / 100).toLocaleString("en-US")}.${String(Math.abs(c) % 100).padStart(2, "0")}`);
const record = {
  run: "t0-reports", read_at: readAt, entity: ENTITY, sandbox: "T:0 shared sandbox entity (test data)", query: Q, reporting_currency: bs.reporting_currency,
  why: "T:0's own Balance Sheet and P&L, account by account, against the sum of every journal line T:0 holds there, of which Purser's entries (je_number PUR-) against Purser's books as recorded on 10 Nov. Other teams' entries are counted per account, never copied.",
  balance_sheet_balances: r.balanceSheetBalances, period: r.period, entries: r.entries, agree: r.agree, of: r.accounts.length,
  accounts: r.accounts.map((a) => ({ account: a.account, our_codes: a.label, type: a.type, books_net_debit: money(a.books), t0_purser_entries: money(a.t0Ours), t0_other_entries: money(a.t0Others), t0_report: money(a.report), books_agree: a.booksAgree, report_agrees: a.reportAgrees })),
  calls,
};
writeFileSync(`${values.out}.json`, `${JSON.stringify(record, null, 2)}\n`);
writeFileSync(`${values.out}.md`, [
  "# T:0's reports against its journal and Purser's books, 2026-11-19",
  "",
  `**Result:** ${r.agree} of ${r.accounts.length} accounts agree three ways${r.balanceSheetBalances === null ? "" : `; T:0's balance sheet ${r.balanceSheetBalances ? "balances" : "does NOT balance"} (assets = liabilities + equity)`}. T:0 sandbox, test data. Read only: ${calls.length} GETs, no write.`,
  "",
  "`npm run t0:reports` (scripts/t0-reports.ts, src/accounting/t0Reports.ts). The machine-readable record is docs/runs/2026-11-19-t0-reports.json.",
  `The 14 Nov read-back checked T:0's journal entries against Purser's books; this checks one level up: T:0's computed Balance Sheet (cumulative to ${Q.end_date}) and P&L (${r.period}) per account = the sum of every journal line T:0 holds there = Purser's ${r.entries.ours} entries plus other teams' ${r.entries.others}; and Purser's entries = Purser's books as recorded on 10 Nov (src/accounting/recordedChecks.ts). Net debit, ${bs.reporting_currency}.`,
  "",
  "| T:0 account (our codes) | Type | Purser's books | Purser's entries in T:0 | Other teams' entries | T:0's report | Books = entries | Report = all entries |",
  "|---|---|---|---|---|---|---|---|",
  ...record.accounts.map((a) => `| ${a.our_codes} | ${a.type || "–"} | ${a.books_net_debit} | ${a.t0_purser_entries} | ${a.t0_other_entries} | ${a.t0_report} | ${a.books_agree ? "yes" : "**no**"} | ${a.report_agrees ? "yes" : "**no**"} |`),
  "",
  "## Calls (UTC; no key, header or token)",
  "",
  "| # | Time | Call | HTTP |",
  "|---|---|---|---|",
  ...calls.map((c, i) => `| ${i + 1} | ${c.at.slice(11, 23)} | \`${c.method} ${c.path}\` | ${c.status} |`),
  "",
  "Other teams' entries on the shared entity are summed per account to explain T:0's totals; their content is not copied.",
  "",
].join("\n"));
console.log(`${values.out}: ${r.agree} of ${r.accounts.length} accounts agree; balance sheet balances: ${r.balanceSheetBalances}; ${r.entries.ours} Purser entries, ${r.entries.others} others; ${calls.length} calls`);
