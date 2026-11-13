// /t0 (owner, 12 Nov): Purser's books in T:0's general ledger, told from the run records alone. What Purser sends (one
// journal entry per entry of its books, its proof in the memo, a stable id so nothing is posted twice), what ran live
// (the 95 entries of the main run's books on 10 November, read back with 0 differences, then T:0's own statements; the
// platform run's 2 entries the same day; the refused attempts of 3 and 5 November), the differences as recorded, and what
// is not done. Every figure and id is read here from the records; a record that is missing or changed leaves its line out.

import { readFileSync } from "node:fs";
import { PLATFORM_FACTS_FILE, PLATFORM_RUN_FILE } from "./airwallexProducts.js";
import { REPO_BLOB } from "./metalStory.js";
import { countOf, esc } from "./ui.js";

export const T0_JOURNAL_RECORD = "docs/runs/2026-11-10-t0-journal-sandbox.md";
export const T0_FIRST_RECORD = "docs/runs/2026-11-03-t0-sandbox.md";
export const T0_SECOND_RECORD = "docs/runs/2026-11-05-t0-live.md";
export const T0_DOC = "docs/t0.md";
/** The page's label: every run on it is T:0's shared sandbox entity, with test data. */
export const T0_LABEL = "T:0 sandbox, test data";

const read = (file: string): string | null => { try { return readFileSync(new URL(`../../${file}`, import.meta.url), "utf8"); } catch { return null; } };

export interface T0Journal {
  posted: number; day: string; firstId: string; differences: number; built: number; debits: string; secondPush: { posted: number; skipped: number } | null;
  accounts: { account: string; ours: string; t0: string }[];
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
  const accounts = [...md.matchAll(/^\| (\d{5}) \(([^)]+)\) \| (-?[\d,.]+) \| (-?[\d,.]+) \|$/gm)].map((m) => ({ account: `${m[1]} (${m[2]})`, ours: m[3]!, t0: m[4]! }));
  const bs = /Balance sheet balances[^|]*\| Yes: ([\d,.]+) = ([\d,.]+) \+ ([\d,.]+) USD, difference ([\d.]+)/.exec(md);
  const fin = /Cash flow, financing activities \| ([\d,.]+) USD: exactly the owner funding/.exec(md);
  return {
    posted: Number(head[1]), day: head[2]!, firstId: head[3]!, differences: Number(diff[3]), built: Number(diff[2]), debits: debits[1]!,
    secondPush: second ? { posted: Number(second[1]), skipped: Number(second[2]) } : null, accounts,
    statements: bs && fin ? { assets: bs[1]!, liabilities: bs[2]!, equity: bs[3]!, difference: bs[4]!, financing: fin[1]! } : null,
  };
}

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
.t0r li b { font-weight: 700; }
.t0r a.pf, .t0p a.pf { display: inline-flex; align-items: center; min-height: 44px; }
table.t0a { width: 100%; border-collapse: collapse; font-size: 14.5px; font-variant-numeric: tabular-nums; table-layout: fixed; }
table.t0a th, table.t0a td { text-align: left; padding: 6px 8px 6px 0; border-top: 1px solid var(--border); overflow-wrap: anywhere; }
table.t0a th:first-child { width: 36%; }
.t0p .folds { min-width: 0; }
@media (max-width: 700px) { .t0p a.pf { padding: 0; vertical-align: middle; max-width: 100%; } .t0p a.open { min-height: 44px; } table.t0a { font-size: 12.5px; } }`;

const link = (file: string, label: string) => `<a class="pf" href="${esc(`${REPO_BLOB}${file}`)}" target="_blank" rel="noopener">${esc(label)} ↗</a>`;
const li = (t: string) => `<li>${esc(t)}</li>`;

/** The body of /t0: the numbers that ran live, what is not done; the details folded. */
export function t0Body(d: T0Data, o: { logo: string; pill: string; proofHash?: string }): string {
  const j = d.journal, p = d.platform;
  const ran = [
    j ? `<li><b>${esc(`${j.day}: ${j.posted} journal entries posted`)}</b>${esc(`, the main run's books, read back with ${j.differences} differences.`)} ${link(T0_JOURNAL_RECORD, "record")}</li>` : "",
    j?.statements ? `<li>${esc(`${j.day}: T:0's balance sheet balances to the cent; its financing line is our owner funding.`)} ${link(`${T0_JOURNAL_RECORD}#t0s-own-statements-10-nov-0900-utc`, "record")}</li>` : "",
    p ? `<li>${esc(`10 Nov: the platform run booked ${p.entries.length} entries.`)} ${link(PLATFORM_RUN_FILE, "record")}</li>` : "",
    ...d.refusals.map((r) => `<li>${esc(`${r.day}: refused, ${r.code}: ${r.why}.`)} ${link(r.record, "record")}</li>`),
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
  const diffs = j ? `<details class="fold"><summary>${esc(`Our books against T:0's, per account (${j.day})`)}</summary><table class="t0a"><thead><tr><th scope="col">T:0 account (ours)</th><th scope="col">Ours, net debit</th><th scope="col">T:0</th></tr></thead><tbody>${j.accounts.map((a) => `<tr><td>${esc(a.account)}</td><td>${esc(a.ours)}</td><td>${esc(a.t0)}</td></tr>`).join("")}</tbody></table><ul class="pl">${li(`${countOf(j.posted, j.built)} entries match; debits and credits ${j.debits} USD each, the same as our books.`)}${j.secondPush ? li(`A second push posted ${j.secondPush.posted} and skipped ${j.secondPush.skipped}: re-running is safe.`) : ""}${j.statements ? li(`Balance sheet: ${j.statements.assets} = ${j.statements.liabilities} + ${j.statements.equity} USD, difference ${j.statements.difference}. Cash flow, financing: ${j.statements.financing} USD, exactly our owner funding. The entity is shared with other teams, so these totals hold their entries too.`) : ""}</ul></details>` : "";
  const ids = [j ? li(`First entry: ${j.firstId}.`) : "", ...(p ? [li(`Platform run: ${p.entries.join(", ")}.`)] : [])].filter(Boolean);
  return `<main class="pp t0p"><div class="wrap">
  <div class="phd">${o.logo}<span class="pill run">${esc(o.pill)}</span><h1>${esc("Our books, in a real ledger")}</h1></div>
  <p class="line">${esc("Purser posts its books to T:0's general ledger, then reads them back, line by line.")}</p>
  ${ran.length ? `<section class="t0r card" aria-labelledby="t0-ran"><h2 id="t0-ran">${esc("What ran live")}</h2><ul>${ran.join("")}</ul></section>` : ""}
  <section class="t0r card" aria-labelledby="t0-not"><h2 id="t0-not">${esc("Not done")}</h2><ul>${notDone.map(li).join("")}</ul></section>
  <div class="folds card"><details class="fold"><summary>${esc("What Purser sends")}</summary><ul class="pl">${sends.join("")}</ul></details>${diffs}${ids.length ? `<details class="fold"><summary>${esc("The ids in T:0")}</summary><ul class="pl">${ids.join("")}</ul></details>` : ""}</div>
  <a class="open" href="proof">All the proof</a>
</div></main>`;
}
