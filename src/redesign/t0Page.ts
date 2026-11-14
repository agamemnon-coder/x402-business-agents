// /t0 (owner, 12 Nov): Purser's books in T:0's general ledger, told from the run records alone. What Purser sends (one
// journal entry per entry of its books, its proof in the memo, a stable id so nothing is posted twice), what ran live
// (the 95 entries of the main run's books on 10 November, read back with 0 differences, then T:0's own statements; the
// platform run's 2 entries the same day; the refused attempts of 3 and 5 November), the differences as recorded, and what
// is not done. Every figure and id is read here from the records; a record that is missing or changed leaves its line out.

import { readFileSync } from "node:fs";
import { PLATFORM_FACTS_FILE, PLATFORM_RUN_FILE } from "./airwallexProducts.js";
import { REPO_BLOB } from "./metalStory.js";
import { esc, icon } from "./ui.js";

export const T0_JOURNAL_RECORD = "docs/runs/2026-11-10-t0-journal-sandbox.md";
export const T0_FIRST_RECORD = "docs/runs/2026-11-03-t0-sandbox.md";
export const T0_SECOND_RECORD = "docs/runs/2026-11-05-t0-live.md";
export const T0_DOC = "docs/t0.md";
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

export const T0_CSS = `.t0r { padding: 16px 18px; display: grid; gap: 4px; }
.t0r h2 { font-size: 19px; line-height: 1.25; margin: 0 0 4px; }
.t0r ul { margin: 0; padding: 0; list-style: none; display: grid; gap: 2px; }
.t0r li { font-size: 15.5px; line-height: 1.45; padding: 6px 0; border-top: 1px solid var(--border); overflow-wrap: anywhere; }
.t0r li:first-child { border-top: 0; }
.t0p a.pf { display: inline-flex; align-items: center; min-height: 44px; }
.t0p ul.stats { margin: 0; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); }
@media (max-width: 520px) { .t0p ul.stats { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
.t0p ul.stats small a.pf { display: flex; width: max-content; font-size: 13.5px; min-height: 44px; }
.t0p .t0flow { padding: 14px; }
table.t0a { width: 100%; border-collapse: collapse; font-size: 14.5px; font-variant-numeric: tabular-nums; table-layout: auto; }
table.t0a th, table.t0a td { text-align: left; padding: 6px 8px 6px 0; border-top: 1px solid var(--border); overflow-wrap: anywhere; }
table.t0a thead th { font-size: 13px; color: var(--muted); font-weight: 600; } table.t0a tbody th { font-weight: 400; } table.t0a tbody th small { display: block; font-size: 12.5px; color: var(--muted); }
table.t0a tbody th { overflow-wrap: break-word; }
table.t0a td.ok { color: var(--ok); white-space: nowrap; }
table.t0a .n { text-align: right; white-space: nowrap; overflow-wrap: normal; } table.t0a th.c, table.t0a td.c { width: 2em; text-align: center; }
.t0bs { display: grid; gap: 4px; }
.t0bs .eq { margin: 0; font-size: 16px; font-weight: 650; font-variant-numeric: tabular-nums; }
.t0bs p { margin: 0; font-size: 15.5px; line-height: 1.45; }
.t0p .folds { min-width: 0; }
@media (prefers-reduced-motion: no-preference) {
  .t0flow .node { animation: t0-lit 6s ease-in-out infinite; }
  .t0flow .node:nth-child(3) { animation-delay: 1.5s; } .t0flow .node:nth-child(5) { animation-delay: 3s; } .t0flow .node:nth-child(7) { animation-delay: 4.5s; }
}
@keyframes t0-lit { 0%, 30%, 100% { box-shadow: inset 0 0 0 1px transparent; } 8%, 22% { box-shadow: inset 0 0 0 2px var(--accent); } }
@media (max-width: 700px) { .t0p a.pf { padding: 0; vertical-align: middle; max-width: 100%; } .t0p a.open { min-height: 44px; } table.t0a { font-size: 12.5px; } }`;

const link = (file: string, label: string) => `<a class="pf" href="${esc(`${REPO_BLOB}${file}`)}" target="_blank" rel="noopener">${esc(label)} ↗</a>`;
const li = (t: string) => `<li>${esc(t)}</li>`;
const node = (ic: string, title: string, sub: string, tone = "") => `<div class="node ${tone}"><span class="ic">${icon(ic, 22)}</span><b>${esc(title)}</b><span>${esc(sub)}</span></div>`;
const arrow = `<span class="arrow" aria-hidden="true">${icon("arrow-right", 22)}</span>`;
/** Table rows: T:0's account, ours, T:0's; a check only where the two are the same, to the cent. */
export const t0Rows = (accounts: Pick<T0Account, "code" | "name" | "ours" | "t0" | "our">[], codes = false): string => accounts.map((a) => {
  const same = cents(a.ours) === cents(a.t0);
  return `<tr><th scope="row">${esc(codes ? `${a.code} ${a.name}` : a.name)}${codes && a.our ? `<small>${esc(`ours: ${a.our}`)}</small>` : ""}</th><td class="n">${esc(a.ours)}</td><td class="n">${esc(a.t0)}</td><td class="c${same ? " ok" : ""}">${same ? '<span role="img" aria-label="same">✓</span>' : esc("differs")}</td></tr>`;
}).join("");
const head = `<thead><tr><th scope="col">${esc("Account")}</th><th scope="col" class="n">${esc("Ours")}</th><th scope="col" class="n">T:0</th><th scope="col" class="c" aria-label="Same"></th></tr></thead>`;

/** The body of /t0: three figures, the flow, the accounts and the balance sheet; the history and the ids folded. */
export function t0Body(d: T0Data, o: { logo: string; pill: string; proofHash?: string }): string {
  const j = d.journal, p = d.platform, s = j?.statements ?? null;
  const rec = `${T0_JOURNAL_RECORD}#read-back-and-second-push-10-nov-2-more-t0-calls`;
  const stat = (n: string, label: string, ic: string, href: string) => `<li class="ok"><span class="st-ic">${icon(ic, 20)}</span><b>${esc(n)}</b><small>${esc(label)} ${link(href, "record")}</small></li>`;
  const stats = j ? `<ul class="stats t0s">${stat(String(j.posted), `journal entries posted, ${j.day}`, "file-check", T0_JOURNAL_RECORD)}${stat(String(j.differences), "differences on read-back", "circle-check", rec)}${stat(`${j.debits} USD`, "debits, equal to credits", "landmark", rec)}</ul>` : "";
  const flow = j ? `<div class="flow card t0flow" role="img" aria-label="${esc("Purser's books are posted to T:0's general ledger, read back line by line, and match")}">${[node("file-check", "Purser's books", "double-entry"), arrow, node("database", "T:0's ledger", "posted"), arrow, node("arrow-left-right", "Read back", "every line"), arrow, node("circle-check", "Match", "to the cent", "ok")].join("")}</div>` : "";
  const lead = j?.accounts.length ? `<section class="t0r card" aria-labelledby="t0-acc"><h2 id="t0-acc">${esc("Per account, USD")}</h2><table class="t0a t0lead">${head}<tbody>${t0Rows(j.accounts.slice(0, 5))}</tbody></table>
  <p class="vbasis">${esc("Net debit; credits show as minus.")}</p>${j.accounts.length > 5 ? `<details class="fold"><summary>${esc("Show all accounts")}</summary><table class="t0a">${head}<tbody>${t0Rows(j.accounts, true)}</tbody></table></details>` : ""}</section>` : "";
  const bs = j && s && balances(s) ? `<section class="t0r card t0bs" aria-labelledby="t0-bs"><h2 id="t0-bs">${esc(`T:0's balance sheet, ${j.day}`)}</h2><p class="eq">${esc(`Assets ${s.assets} = liabilities ${s.liabilities} + equity ${s.equity} USD`)}</p><p>${esc("Shared entity: these totals include other teams.")}</p>${ownerFunding(j) ? `<p>${esc(`Financing, ${s.financing} USD, is only our owner funding.`)}</p>` : ""} ${link(`${T0_JOURNAL_RECORD}#t0s-own-statements-10-nov-0900-utc`, "record")}</section>` : "";
  const history = [
    ...d.refusals.map((r) => `<li>${esc(`${r.day}: refused, ${r.code}: ${r.why}.`)} ${link(r.record, "record")}</li>`),
    j ? `<li>${esc(`${j.day}: all ${j.posted} entries posted, one at a time, each with an idempotency key.`)} ${link(T0_JOURNAL_RECORD, "record")}</li>` : "",
    j?.secondPush ? li(`A second push posted ${j.secondPush.posted} and skipped ${j.secondPush.skipped}: re-running is safe.`) : "",
    p ? `<li>${esc(`10 Nov: the platform run booked ${p.entries.length} entries.`)} ${link(PLATFORM_RUN_FILE, "record")}</li>` : "",
  ].filter(Boolean);
  const notDone = [
    "Accounts are made in T:0's app; its API cannot create them.",
    "One rate per currency, given by us; no daily rate source yet.",
    ...(p?.refusedCode ? [`A supplier bill on T:0's payables account needs a T:0 vendor (refused, ${p.refusedCode.split(" ")[0]}).`] : []),
  ];
  const sends = [
    li("One journal entry per entry of Purser's books, debits equal to credits, dated by the movement's day."),
    li("Each line's memo carries its proof: the transaction hash, the clearing receipt or the Airwallex id."),
    li("A stable id per entry (PUR- and a hash of its content) and an idempotency key: a second push posts nothing twice."),
    li("Test money on Metal (*USDZ) is posted as USD, labelled in the memo; other currencies at the rate we give."),
    `<li>${link(T0_DOC, "How it works, and the account map")}</li>`,
  ];
  const ids = [j && !j.samples.some((x) => x.t0 === j.firstId) ? li(`First entry: ${j.firstId}.`) : "", ...(j?.samples ?? []).map((x) => li(`${x.ours} (${x.what}) is ${x.t0}.`)), ...(p ? [li(`Platform run: ${p.entries.join(", ")}.`)] : [])].filter(Boolean);
  const fold = (title: string, items: string[]) => items.length ? `<details class="fold"><summary>${esc(title)}</summary><ul class="pl">${items.join("")}</ul></details>` : "";
  return `<main class="pp t0p"><div class="wrap">
  <div class="phd">${o.logo}<span class="pill run">${esc(o.pill)}</span><h1>${esc("Our books, in a real ledger")}</h1></div>
  ${stats}
  ${flow}
  ${lead}
  ${bs}
  <p class="vbasis">${esc("T:0 is an outside ledger. It must agree with ours to the cent, so the CFO need not take our word.")}</p>
  <div class="folds card">${fold("How it got there", history)}${fold("Not done", notDone.map(li))}${fold("What Purser sends", sends)}${fold("The ids in T:0", ids)}</div>
  <a class="open" href="proof">All the proof</a>
</div></main>`;
}
