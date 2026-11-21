// T:0 on /books (21 Nov, the owner: "merge them: the books page, with T:0 in it"; /t0 answers 301 to /books since).
// Before that /t0 (owner, 12 Nov): Purser's books in T:0's general ledger, told from the run records alone. What Purser sends (one
// journal entry per entry of its books, its proof in the memo, a stable id so nothing is posted twice), what ran live
// (the 95 entries of the main run's books on 10 November, read back with 0 differences, then T:0's own statements; the
// platform run's 2 entries the same day; the refused attempts of 3 and 5 November), the differences as recorded, and what
// is not done. Every figure and id is read here from the records; a record that is missing or changed leaves its line out.

import { readFileSync } from "node:fs";
import { PLATFORM_FACTS_FILE, PLATFORM_RUN_FILE } from "./airwallexProducts.js";
import { REPO_BLOB } from "./metalStory.js";
import { altaWords } from "../ui/formerly.js";
import { esc } from "./ui.js";
import { T0_CLOSE_CSS, t0CloseFacts, t0CloseTileHtml } from "./t0CloseTile.js";
import { T0_READBACK_FILE } from "../accounting/t0Readback.js";

export const T0_JOURNAL_RECORD = "docs/runs/2026-11-10-t0-journal-sandbox.md";
export const T0_FIRST_RECORD = "docs/runs/2026-11-03-t0-sandbox.md";
export const T0_SECOND_RECORD = "docs/runs/2026-11-05-t0-live.md";
export const T0_DOC = "docs/t0.md";
/** The read-back's run log (14 Nov), beside its JSON (T0_READBACK_FILE): the newest T:0 record, which the page leads with. */
export const T0_READBACK_RECORD = T0_READBACK_FILE.replace(/\.json$/, ".md");
/**
 * What Purser uses T:0 for (19 Nov, the owner: "say plainly"), as the code does it: src/accounting/t0.ts posts the
 * double-entry books as manual journal entries, each with a stable je_number and an idempotency key (never twice);
 * T0Client.listJournalEntries reads them back; src/ledger/close.ts closeMonthWhenT0Agrees locks a month only when
 * src/accounting/closeGate.ts finds T:0 agreeing to the cent.
 */
export const T0_USE = "Purser uses T:0's sandbox as an outside general ledger: it posts its double-entry books there as journal entries, never twice, reads them back, and locks a month only when T:0 agrees to the cent.";
/** The page's label: every run on it is T:0's shared sandbox entity, with test data. */
export const T0_LABEL = "T:0 sandbox, test data";

const read = (file: string): string | null => { try { return readFileSync(new URL(`../../${file}`, import.meta.url), "utf8"); } catch { return null; } };

export interface T0Account { account: string; code: string; name: string; ours: string; t0: string; our?: string }
export interface T0Journal {
  posted: number; day: string; firstId: string; differences: number; built: number; debits: string; secondPush: { posted: number; skipped: number } | null;
  accounts: T0Account[];
  /** The record's sample entries: Purser's id, what it is, T:0's id. */
  samples: { ours: string; what: string; t0: string }[];
  statements: { assets: string; liabilities: string; equity: string; difference: string; financing: string } | null;
}
/** The posting of 10 November, its read-back and T:0's statements, from its run record. */
export function t0Journal(md: string | null): T0Journal | null {
  if (!md) return null;
  const head = /(\d+) journal entries posted to T:0's shared sandbox entity on (\d{1,2} \w{3}) \(first (je_prod_\w+)\)/.exec(md);
  const diff = /(\d+) `PUR-` entries are in T:0 and we built (\d+); there are (\d+) differences/.exec(md);
  const debits = /debits equal to credits: ([\d,.]+) USD each/.exec(md);
  if (!head || !diff || !debits) return null;
  const second = /posted (\d+) and skipped (\d+)/.exec(md);
  // T:0's account names, from the record's trial balance ("| 11120 Operating Checking Account #2 | 1200 ... | ... |").
  const rows = [...md.matchAll(/^\| (\d{5}) ([^|(][^|]*?) \| ([^|]+?) \| [^|]+ \|$/gm)], names = new Map(rows.map((m) => [m[1]!, m[2]!])), ourOf = new Map(rows.map((m) => [m[1]!, m[3]!]));
  const accounts = [...md.matchAll(/^\| (\d{5}) \(([^)]+)\) \| (-?[\d,.]+) \| (-?[\d,.]+) \|$/gm)].map((m) => ({ account: `${m[1]} (${m[2]})`, code: m[1]!, name: names.get(m[1]!) ?? m[1]!, ...(ourOf.has(m[1]!) ? { our: ourOf.get(m[1]!)! } : {}), ours: m[3]!, t0: m[4]! }));
  const samples = [...md.matchAll(/^\| `(PUR-[0-9a-f]+)` \(([^)]+)\) \| `(je_prod_\w+)` \|$/gm)].map((m) => ({ ours: m[1]!, what: m[2]!, t0: m[3]! }));
  const bs = /Balance sheet balances[^|]*\| Yes: ([\d,.]+) = ([\d,.]+) \+ ([\d,.]+) USD, difference ([\d.]+)/.exec(md);
  const fin = /Cash flow, financing activities \| ([\d,.]+) USD: exactly the owner funding/.exec(md);
  return {
    posted: Number(head[1]), day: head[2]!, firstId: head[3]!, differences: Number(diff[3]), built: Number(diff[2]), debits: debits[1]!,
    secondPush: second ? { posted: Number(second[1]), skipped: Number(second[2]) } : null, accounts, samples,
    statements: bs && fin ? { assets: bs[1]!, liabilities: bs[2]!, equity: bs[3]!, difference: bs[4]!, financing: fin[1]! } : null,
  };
}

/** An amount as the record writes it ("-21,140,636.23") in cents, so sums are exact. */
const cents = (s: string): number => Math.round(Number(s.replace(/,/g, "")) * 100);
/** Assets equal liabilities plus equity, to the cent, computed here from the record's three figures. */
export const balances = (s: NonNullable<T0Journal["statements"]>): boolean => cents(s.assets) === cents(s.liabilities) + cents(s.equity) && cents(s.difference) === 0;
/** T:0's financing line equals our owner funding: the credit on equity (T:0 32000) in our own books. */
export const ownerFunding = (j: T0Journal): boolean => {
  const eq = j.accounts.find((a) => a.code === "32000");
  return !!(eq && j.statements && cents(eq.ours) === -cents(j.statements.financing));
};

export interface T0Platform { entries: string[]; refusedCode: string | null }
/** The platform run's entries in T:0 (10 November): its facts' ids, and the post T:0 refused first. */
export function t0Platform(factsJson: string | null, md: string | null): T0Platform | null {
  if (!factsJson) return null;
  let facts: { t0_entries?: unknown }[];
  try { facts = JSON.parse(factsJson) as { t0_entries?: unknown }[]; } catch { return null; }
  const entries = facts.flatMap((f) => Array.isArray(f.t0_entries) ? f.t0_entries.filter((x): x is string => typeof x === "string" && /^je_prod_\w+$/.test(x)) : []);
  return entries.length ? { entries, refusedCode: /refused the first post[^.]*\((\d{3} CAPI\d+)\)/.exec(md ?? "")?.[1] ?? null } : null;
}

/** The refused attempts before the posting: the code each record states. */
export function t0Refusals(first: string | null, second: string | null): { day: string; code: string; why: string; record: string }[] {
  const out: { day: string; code: string; why: string; record: string }[] = [];
  if (first && /`403 CAPI71`/.test(first)) out.push({ day: "3 Nov", code: "403", why: "the shared key could read, not post", record: T0_FIRST_RECORD });
  if (second && /`401 CAPI11`/.test(second)) out.push({ day: "5 Nov", code: "401", why: "the new key was not accepted", record: T0_SECOND_RECORD });
  return out;
}

export interface T0Data { journal: T0Journal | null; platform: T0Platform | null; refusals: ReturnType<typeof t0Refusals> }
export const t0Data = (): T0Data => ({
  journal: t0Journal(read(T0_JOURNAL_RECORD)),
  platform: t0Platform(read(PLATFORM_FACTS_FILE), read(PLATFORM_RUN_FILE)),
  refusals: t0Refusals(read(T0_FIRST_RECORD), read(T0_SECOND_RECORD)),
});

/** The T:0 section's style on /books: the wordmark, two figures, the close check and the folds. */
export const T0_CSS = `${T0_CLOSE_CSS}
.t0s { padding: 20px; display: grid; gap: 14px; min-width: 0; }
.t0s .t0hd { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; }
.t0s .t0hd h2 { margin: 0; font-size: 21px; line-height: 1.25; letter-spacing: -.01em; }
.t0mark { display: inline-flex; align-items: center; height: 34px; padding: 0 12px; border-radius: 9px; background: #0b0d12; color: #fff; font-weight: 800; font-size: 17px; letter-spacing: -.02em; flex: none; }
:root[data-theme="dark"] .t0mark { background: #fff; color: #0b0d12; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) .t0mark { background: #fff; color: #0b0d12; } }
.t0s .t0what { margin: 0; font-size: 15.5px; line-height: 1.5; color: var(--muted); max-width: 50em; }
.t0s .noend { font-size: 13px; color: var(--muted); }
ul.t0n { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
ul.t0n li { position: relative; display: grid; gap: 2px; padding: 14px 16px; border-radius: 14px; background: var(--sunken); border: 1px solid transparent; }
ul.t0n a.t0f { display: block; padding: 8px 0; margin: -8px 0; color: inherit; text-decoration: none; outline: none; } ul.t0n a.t0f::after { content: ""; position: absolute; inset: 0; border-radius: 14px; }
ul.t0n li small a { position: relative; z-index: 1; }
ul.t0n li:has(a.t0f:hover), ul.t0n li:has(a.t0f:focus-visible) { border-color: var(--accent); } ul.t0n li:has(a.t0f:focus-visible) { outline: 2px solid var(--accent); outline-offset: 2px; }
ul.t0n b { font-size: clamp(26px, 3vw, 34px); font-weight: 780; letter-spacing: -.02em; font-variant-numeric: tabular-nums; line-height: 1.1; }
ul.t0n li.ok b { color: var(--ok); }
ul.t0n small { font-size: 14px; color: var(--muted); line-height: 1.35; }
ul.t0n a.pf { font-size: 14px; }
.t0s .t0c { border-radius: 14px; box-shadow: none; }
table.t0a { width: 100%; border-collapse: collapse; font-size: 14px; font-variant-numeric: tabular-nums; }
table.t0a th, table.t0a td { text-align: left; padding: 6px 8px 6px 0; border-top: 1px solid var(--border); overflow-wrap: anywhere; }
table.t0a thead th { font-size: 13px; color: var(--muted); font-weight: 600; } table.t0a tbody th { font-weight: 400; } table.t0a tbody th small { display: block; font-size: 12.5px; color: var(--muted); }
table.t0a td.ok { color: var(--ok); white-space: nowrap; }
table.t0a .n { text-align: right; white-space: nowrap; overflow-wrap: normal; } table.t0a th.c, table.t0a td.c { width: 2em; text-align: center; }
@media (max-width: 560px) { table.t0a { font-size: 12.5px; } ul.t0n { grid-template-columns: minmax(0, 1fr); } }`;

const link = (file: string, label: string) => `<a class="pf" href="${esc(`${REPO_BLOB}${file}`)}" target="_blank" rel="noopener">${esc(label)} ↗</a>`;
const li = (t: string) => `<li>${esc(t)}</li>`;
/** Table rows: T:0's account, ours, T:0's; a check only where the two are the same, to the cent. */
export const t0Rows = (accounts: Pick<T0Account, "code" | "name" | "ours" | "t0" | "our">[], codes = false): string => accounts.map((a) => {
  const same = cents(a.ours) === cents(a.t0);
  return `<tr><th scope="row">${esc(codes ? `${a.code} ${a.name}` : a.name)}${codes && a.our ? `<small>${esc(`ours: ${altaWords(a.our)}`)}</small>` : ""}</th><td class="n">${esc(a.ours)}</td><td class="n">${esc(a.t0)}</td><td class="c${same ? " ok" : ""}">${same ? '<span role="img" aria-label="same">✓</span>' : esc("differs")}</td></tr>`;
}).join("");
const head = `<thead><tr><th scope="col">${esc("Account")}</th><th scope="col" class="n">${esc("Ours")}</th><th scope="col" class="n">T:0</th><th scope="col" class="c" aria-label="Same"></th></tr></thead>`;

const DAY = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(iso));
/** The T:0 wordmark as text: no T:0 logo file is on record (docs/evidence/logo-permissions.md). */
export const T0_MARK = '<span class="t0mark" role="img" aria-label="T:0">T:0</span>';
/**
 * /books' T:0 section (21 Nov; /t0 until then, which now answers 301 to /books): what Purser uses T:0 for, two figures,
 * the independent close check with its button, and the accounts, the history and the ids folded.
 */
export function t0SectionHtml(d: T0Data, o: { endorse?: string; close?: ReturnType<typeof t0CloseFacts> } = {}): string {
  const j = d.journal, p = d.platform;
  if (!j) return "";
  const close = o.close === undefined ? t0CloseFacts() : o.close;
  // The figure is a link to its record, and it covers the tile (21 Nov, Max: "every figure goes somewhere").
  const stat = (n: string, label: string, href: string, ok = false) => `<li${ok ? ' class="ok"' : ""}><a class="t0f" href="${esc(`${REPO_BLOB}${href}`)}" target="_blank" rel="noopener"><b>${esc(n)}</b></a><small>${esc(label)} ${link(href, "record")}</small></li>`;
  const stats = `<ul class="t0n">${stat(String(j.posted), `journal entries posted to T:0, ${j.day}`, T0_JOURNAL_RECORD)}${close ? stat(String(close.check.problems.length), `differences when read back, ${DAY(close.readAt)}`, T0_READBACK_RECORD, close.check.agrees) : stat(String(j.differences), "differences on read-back", T0_JOURNAL_RECORD, j.differences === 0)}</ul>`;
  const funding = j.accounts.find((a) => a.code === "32000");
  const accounts = j.accounts.length ? `<details class="fold"><summary>${esc("The accounts, ours beside T:0's (USD)")}</summary><table class="t0a">${head}<tbody>${t0Rows(j.accounts, true)}</tbody></table><ul class="pl">${li("Net debit per account; credits show as minus.")}${funding ? li(`Sandbox amounts: the books open with the Airwallex sandbox's test balances, ${funding.ours.replace(/^-/, "")} USD of owner funding. No real money.`) : ""}${li(`Debits and credits: ${j.debits} USD each, the same as our books.`)}</ul></details>` : "";
  const sends = [
    li("One journal entry per entry of Purser's books, debits equal to credits, dated by the movement's day."),
    li("Each line's memo carries its proof: the transaction hash, the clearing receipt or the Airwallex id."),
    li("A stable id per entry (PUR- or PURPAY- and a hash of its content) and an idempotency key: a second push posts nothing twice."),
    `<li>${link(T0_DOC, "How it works, and the account map")}</li>`,
  ];
  const history = [
    `<li>${esc(`${j.day}: all ${j.posted} entries posted, one at a time, each with an idempotency key.`)} ${link(T0_JOURNAL_RECORD, "record")}</li>`,
    j.secondPush ? li(`A second push posted ${j.secondPush.posted} and skipped ${j.secondPush.skipped}: re-running is safe.`) : "",
    p ? `<li>${esc(`10 Nov: the platform run booked ${p.entries.length} entries.`)} ${link(PLATFORM_RUN_FILE, "record")}</li>` : "",
  ].filter(Boolean);
  const notDone = ["Accounts are made in T:0's app; its API cannot create them.", "One rate per currency, given by us; no daily rate source yet.", ...(p?.refusedCode ? [`A supplier bill on T:0's payables account needs a T:0 vendor (refused, ${p.refusedCode.split(" ")[0]}).`] : [])];
  const ids = [!j.samples.some((x) => x.t0 === j.firstId) ? li(`First entry: ${j.firstId}.`) : "", ...j.samples.map((x) => li(`${x.ours} (${altaWords(x.what)}) is ${x.t0}.`)), ...(p ? [li(`Platform run: ${p.entries.join(", ")}.`)] : [])].filter(Boolean);
  const fold = (title: string, items: string[]) => items.length ? `<details class="fold"><summary>${esc(title)}</summary><ul class="pl">${items.join("")}</ul></details>` : "";
  return `<section class="card t0s" id="t0" aria-labelledby="t0-h">
<div class="t0hd">${T0_MARK}<h2 id="t0-h">${esc("The ledger: T:0")}</h2><span class="pill run">${esc(T0_LABEL)}</span>${o.endorse ?? ""}</div>
<p class="t0what">${esc(T0_USE)}</p>
${stats}
${t0CloseTileHtml(close)}
<div class="folds">${accounts}${fold("What Purser sends", sends)}${fold("How it got there", history)}${fold("Next steps", notDone.map(li))}${fold("The ids in T:0", ids)}</div>
</section>`;
}
