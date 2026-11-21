// /books, the ledger half (21 Nov, the owner: "merge them: the books page, with T:0 in it, explained well with visuals,
// architecture and animations", and "a small demo that shows a cent must not be changed, otherwise the balance sheet
// doesn't add up any more"). Two blocks:
//   1. How a payment reaches the books: payment on its rail → a PURPAY- journal entry in T:0 at payment time → the
//      reconcile check against the rail. Every figure is read from the partner-rails run record of 20 Nov
//      (docs/runs/2026-11-20-partner-rails.json, npm run partner-rails); a record that is missing or not in its shape
//      leaves the block out.
//   2. "Change one cent": the test company's balance sheet as recorded (the same view as the statement above it), and a
//      script that adds or takes one cent on one line, in the browser only, so the sheet goes out of balance and the
//      checks turn red. Labelled as a demo; the real close check on T:0's read-back sits beside it (./t0CloseTile.ts).
// CSS animation only where it explains (a dot travelling the path); still under prefers-reduced-motion.

import { readFileSync } from "node:fs";
import { REPO_BLOB } from "./metalStory.js";
import { countOf, esc, icon } from "./ui.js";
import type { StatementLine, StatementView } from "../vault/statementPdf.js";

export const RAILS_FILE = "docs/runs/2026-11-20-partner-rails.json";
export const RAILS_RECORD = "docs/runs/2026-11-20-partner-rails.md";

/** What the page shows of one payment of the 20 Nov run. */
export interface RailPayment { key: string; rail: string; railName: string; counterparty: string; amount: string; currency: string; je: string; t0Id: string; ms: number; checks: number; ok: boolean }
export interface RailsRun { day: string; payments: RailPayment[]; rails: number; ok: boolean }

/** The rails in words: the record's own names, shortened. */
export const RAIL_NAMES: Record<string, string> = { airwallex_card: "Visa card · Airwallex", airwallex_transfer: "Airwallex transfer", metal: "Alta testnet" };

interface RailsJson {
  started_at: string;
  payments: { key: string; rail: string; amount: string; currency: string; counterparty: string; t0?: { status: string; je_number: string; t0_id: string; ms_after_settled: number } }[];
  reconcile: { ok: boolean; rows: { je_number: string; ok: boolean; checks: unknown[] }[] };
}

/** The 20 Nov run as the page shows it; null when the record is missing, or a payment is unbooked or unnamed. */
export function railsRun(text: string | null = readRepo(RAILS_FILE)): RailsRun | null {
  if (!text) return null;
  let r: RailsJson;
  try { r = JSON.parse(text) as RailsJson; } catch { return null; }
  if (!Array.isArray(r.payments) || !r.payments.length || !r.reconcile || !Array.isArray(r.reconcile.rows)) return null;
  const payments: RailPayment[] = [];
  for (const p of r.payments) {
    const row = r.reconcile.rows.find((x) => x.je_number === p.t0?.je_number);
    if (!p.t0 || p.t0.status !== "booked" || !/^PURPAY-[0-9a-f]+$/.test(p.t0.je_number) || !RAIL_NAMES[p.rail] || !row) return null;
    payments.push({ key: p.key, rail: p.rail, railName: RAIL_NAMES[p.rail]!, counterparty: p.counterparty.replace(/\s*\(test payee\)$/, ""), amount: p.amount, currency: p.currency, je: p.t0.je_number, t0Id: p.t0.t0_id, ms: p.t0.ms_after_settled, checks: row.checks.length, ok: row.ok });
  }
  return { day: r.started_at, payments, rails: new Set(payments.map((p) => p.rail)).size, ok: r.reconcile.ok && payments.every((p) => p.ok) };
}
function readRepo(file: string): string | null { try { return readFileSync(new URL(`../../${file}`, import.meta.url), "utf8"); } catch { return null; } }

const DAY = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(iso));
const secs = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const rec = (file: string, label: string) => `<a class="bl-rec" href="${esc(`${REPO_BLOB}${file}`)}" target="_blank" rel="noopener">${esc(label)} ↗</a>`;
/** "1,234.56" from cents, with a true minus sign: the same as the statement's (./booksPage.ts money). */
const amt = (cents: number) => { const a = Math.abs(cents); return `${cents < 0 ? "−" : ""}${Math.floor(a / 100).toLocaleString("en-US")}.${String(a % 100).padStart(2, "0")}`; };

export const LEDGER_CSS = `.lg { padding: 20px; display: grid; gap: 16px; min-width: 0; }
.lg h2 { margin: 0; font-size: 21px; line-height: 1.25; letter-spacing: -.01em; display: flex; flex-wrap: wrap; align-items: center; gap: 8px 10px; }
.lg .bl-sub { margin: 0; color: var(--muted); font-size: 15px; line-height: 1.45; max-width: 48em; }
.bl-tag { font-size: 12.5px; font-weight: 650; color: var(--muted); border: 1px solid var(--border); border-radius: 999px; padding: 2px 9px; white-space: nowrap; }
.bl-tag.demo { color: var(--accent); border-color: var(--accent); }
a.bl-rec { font-size: 14px; font-weight: 600; color: var(--accent); text-decoration: none; white-space: nowrap; display: inline-flex; align-items: center; min-height: 24px; }
/* The path: three stages, two links with a travelling dot. */
ol.bl-flow { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: minmax(0, 1fr) 56px minmax(0, 1fr) 56px minmax(0, 1fr); align-items: stretch; }
.bl-st { position: relative; display: grid; gap: 6px; align-content: start; padding: 16px; border-radius: 16px; background: var(--sunken); border: 1px solid var(--border); min-width: 0; }
.bl-st .n { position: absolute; top: 12px; right: 14px; font-size: 12px; font-weight: 750; color: var(--muted); font-variant-numeric: tabular-nums; }
.bl-st .ic { width: 40px; height: 40px; border-radius: 12px; display: grid; place-items: center; background: var(--surface); color: var(--accent); border: 1px solid var(--border); }
.bl-st.t0 .ic { background: #0b0d12; color: #fff; border-color: #0b0d12; font-weight: 800; font-size: 14px; letter-spacing: -.02em; }
.bl-st.ok .ic { color: var(--ok); }
:root[data-theme="dark"] .bl-st.t0 .ic { background: #fff; color: #0b0d12; border-color: #fff; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) .bl-st.t0 .ic { background: #fff; color: #0b0d12; border-color: #fff; } }
.bl-st b { font-size: 16px; line-height: 1.3; }
.bl-st a.fig { color: inherit; text-decoration: none; outline: none; padding: 8px 0; margin: -8px 0; } .bl-st a.fig::after { content: ""; position: absolute; inset: 0; border-radius: 16px; }
.bl-st:has(a.fig:hover), .bl-st:has(a.fig:focus-visible) { border-color: var(--accent); } .bl-st:has(a.fig:focus-visible) { outline: 2px solid var(--accent); outline-offset: 2px; }
.bl-st .fig { font-size: 26px; font-weight: 780; letter-spacing: -.02em; font-variant-numeric: tabular-nums; line-height: 1.1; }
.bl-st .fig small { font-size: 14px; font-weight: 600; color: var(--muted); letter-spacing: 0; }
.bl-st span.s { font-size: 14px; color: var(--muted); line-height: 1.4; }
.bl-st code, .bl-pay code { font: 600 13px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; overflow-wrap: anywhere; }
li.bl-ln { position: relative; display: grid; place-items: center; }
li.bl-ln::before { content: ""; position: absolute; left: 6px; right: 6px; top: 50%; height: 2px; background: var(--border); }
li.bl-ln::after { content: ""; position: absolute; right: 4px; top: calc(50% - 5px); border: 5px solid transparent; border-left-color: var(--border); border-right: 0; }
li.bl-ln i { position: absolute; top: calc(50% - 6px); left: 6px; width: 12px; height: 12px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 0 4px var(--accent-soft); opacity: 0; }
li.bl-ln.l2 i { background: var(--ok); box-shadow: 0 0 0 4px var(--ok-soft); }
@media (prefers-reduced-motion: no-preference) {
  li.bl-ln i { animation: bl-x 4s cubic-bezier(.45,0,.2,1) infinite; } li.bl-ln.l2 i { animation-delay: 2s; }
  .bl-st { animation: bl-lit 4s ease-in-out infinite; } .bl-st.s2 { animation-delay: 1.3s; } .bl-st.s3 { animation-delay: 3.3s; }
}
@keyframes bl-x { 0% { left: 6px; opacity: 0; } 10% { opacity: 1; } 45% { left: calc(100% - 18px); opacity: 1; } 55%, 100% { left: calc(100% - 18px); opacity: 0; } }
@keyframes bl-lit { 0%, 12%, 100% { border-color: var(--border); } 4%, 9% { border-color: var(--accent); } }
@media (max-width: 760px) {
  ol.bl-flow { grid-template-columns: minmax(0, 1fr); }
  li.bl-ln { height: 34px; }
  li.bl-ln::before { left: 50%; right: auto; top: 4px; bottom: 4px; width: 2px; height: auto; }
  li.bl-ln::after { right: auto; left: calc(50% - 4px); top: auto; bottom: 2px; border: 5px solid transparent; border-top-color: var(--border); border-bottom: 0; }
  li.bl-ln i { left: calc(50% - 6px); top: 2px; }
  @keyframes bl-x { 0% { top: 2px; opacity: 0; } 10% { opacity: 1; } 45% { top: 20px; opacity: 1; } 55%, 100% { top: 20px; opacity: 0; } }
}
/* The run, payment by payment. */
ul.bl-pay { list-style: none; margin: 0; padding: 0; display: grid; }
ul.bl-pay li { display: grid; grid-template-columns: 170px minmax(0, 1fr) auto auto; gap: 4px 14px; align-items: center; padding: 10px 0; border-top: 1px solid var(--border); font-size: 14.5px; }
ul.bl-pay .rl { font-size: 13px; font-weight: 650; border-radius: 999px; padding: 3px 10px; background: var(--sunken); justify-self: start; white-space: nowrap; }
ul.bl-pay .rl.metal { color: var(--metal); } ul.bl-pay .rl.awx { color: var(--awx); }
ul.bl-pay .who { min-width: 0; overflow-wrap: anywhere; } ul.bl-pay .who b { font-variant-numeric: tabular-nums; margin-right: 8px; }
ul.bl-pay .je { color: var(--muted); }
ul.bl-pay .t { font-variant-numeric: tabular-nums; color: var(--muted); white-space: nowrap; }
ul.bl-pay .ok { display: inline-flex; gap: 4px; align-items: center; color: var(--ok); font-weight: 700; white-space: nowrap; }
@media (max-width: 760px) { ul.bl-pay li { grid-template-columns: auto minmax(0, 1fr) auto; } ul.bl-pay .who { grid-column: 1 / -1; order: -1; } ul.bl-pay .t { justify-self: end; } }
/* The demo. */
.lgd { display: grid; gap: 14px; }
.lgd-eq { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px 12px; font-size: 15px; color: var(--muted); }
.lgd-eq a { display: inline-block; padding: 8px 0; margin: -8px 0; color: inherit; text-decoration: none; } .lgd-eq a b { border-bottom: 1px dashed var(--border); } .lgd-eq a:hover b, .lgd-eq a:focus-visible b { border-bottom-color: var(--accent); }
.lgd-eq b { color: var(--text); font-size: clamp(19px, 2.2vw, 24px); font-weight: 780; letter-spacing: -.02em; font-variant-numeric: tabular-nums; }
.lgd-eq .op { font-size: 22px; font-weight: 700; color: var(--text); }
.lgd-eq .op.no { color: var(--bad); }
.lgd-bars { display: grid; gap: 6px; }
.lgd-bars .row { display: grid; grid-template-columns: 92px minmax(0, 1fr); align-items: center; gap: 10px; font-size: 13.5px; color: var(--muted); }
.lgd-bars svg { display: block; width: 100%; height: 18px; border-radius: 6px; background: var(--sunken); }
.lgd-bars rect { stroke: var(--surface); stroke-width: 2px; vector-effect: non-scaling-stroke; transition: fill .35s ease; }
.lgd-bars rect.a { fill: color-mix(in srgb, var(--accent) 70%, var(--surface)); } .lgd-bars rect.a.a2 { fill: color-mix(in srgb, var(--accent) 45%, var(--surface)); } .lgd-bars rect.a.a3 { fill: color-mix(in srgb, var(--accent) 25%, var(--surface)); }
.lgd-bars rect.l { fill: color-mix(in srgb, var(--awx, #ff4f42) 60%, var(--surface)); } .lgd-bars rect.e { fill: color-mix(in srgb, var(--ok) 60%, var(--surface)); }
.lgd-bars rect.hot { fill: var(--bad); }
.lgd-lines { display: flex; flex-wrap: wrap; gap: 8px; }
.lgd-lines button { font: inherit; font-size: 14px; min-height: 44px; padding: 6px 12px; border-radius: 10px; border: 1px solid var(--border); background: var(--surface); color: var(--text); cursor: pointer; display: inline-flex; gap: 8px; align-items: baseline; }
.lgd-lines button b { font-variant-numeric: tabular-nums; }
.lgd-lines button[aria-pressed="true"] { border-color: var(--accent); box-shadow: inset 0 0 0 1px var(--accent); }
.lgd-lines button.chg b { color: var(--bad); }
.lgd-ctl { display: flex; flex-wrap: wrap; gap: 8px; }
.lgd-ctl button { font: inherit; font-weight: 650; min-height: 44px; padding: 8px 16px; border-radius: 10px; border: 1px solid var(--border); background: var(--sunken); color: var(--text); cursor: pointer; }
.lgd-ctl button.go { background: var(--accent); border-color: var(--accent); color: #fff; }
.lgd button:focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; }
ul.lgd-checks { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
ul.lgd-checks li { display: flex; gap: 10px; align-items: center; padding: 10px 12px; border-radius: 12px; background: var(--ok-soft); color: var(--ok); font-weight: 650; font-size: 15px; transition: background-color .3s ease, color .3s ease; }
ul.lgd-checks li .x { margin-left: auto; font-weight: 600; font-size: 13.5px; font-variant-numeric: tabular-nums; }
ul.lgd-checks li.no { background: var(--bad-soft); color: var(--bad); }
ul.lgd-checks li .i2, ul.lgd-checks li .w2 { display: none; } ul.lgd-checks li.no .i1, ul.lgd-checks li.no .w1 { display: none; } ul.lgd-checks li.no .i2 { display: inline-flex; } ul.lgd-checks li.no .w2 { display: inline; }
.lgd-st { margin-left: auto; align-self: center; font-size: 14px; font-weight: 750; color: var(--ok); background: var(--ok-soft); border-radius: 999px; padding: 4px 12px; }
.lgd-st.no { color: #fff; background: var(--bad); }
.lgd-note { margin: 0; font-size: 14px; color: var(--muted); }
@media (prefers-reduced-motion: no-preference) { ul.lgd-checks li.no { animation: lgd-shake .35s ease 1; } }
@keyframes lgd-shake { 25% { transform: translateX(-3px); } 75% { transform: translateX(3px); } }
@media (prefers-reduced-motion: reduce) { .lgd-bars rect, ul.lgd-checks li { transition: none; } }`;

/** How a payment reaches the books: the path and the 20 Nov run, payment by payment. */
export function railsHtml(r: RailsRun | null = railsRun()): string {
  if (!r) return "";
  const lo = Math.min(...r.payments.map((p) => p.ms)), hi = Math.max(...r.payments.map((p) => p.ms));
  // Each step leads to the run's record (21 Nov, Max: "no dead zones, and every figure goes somewhere"): its figure is
  // the link, and it covers the step.
  const st = (n: number, cls: string, ic: string, title: string, fig: string, sub: string) => `<li class="bl-st ${cls} s${n}"><span class="n">${n}</span><span class="ic">${ic}</span><b>${esc(title)}</b><a class="fig" href="${esc(`${REPO_BLOB}${RAILS_RECORD}`)}" target="_blank" rel="noopener">${fig}</a><span class="s">${sub}</span></li>`;
  const flow = `<ol class="bl-flow" aria-label="${esc("A payment settles on its rail, is booked in T:0 as a PURPAY- journal entry at once, then is reconciled against the rail")}">
${st(1, "", icon("credit-card", 22), "Payment settles", `${r.payments.length}<small> payments · ${r.rails} rails</small>`, esc("Visa card and transfer on Airwallex, a payment on Alta (formerly Metal) testnet."))}
<li class="bl-ln" aria-hidden="true"><i></i></li>
${st(2, "t0", "T:0", "Journal entry in T:0", `${esc(secs(lo))}–${esc(secs(hi))}<small> later</small>`, `${esc("One entry per payment, id ")}<code>PURPAY-</code>${esc(", never posted twice.")}`)}
<li class="bl-ln l2" aria-hidden="true"><i></i></li>
${st(3, "ok", icon("circle-check", 22), "Reconciled with the rail", `${esc(countOf(r.payments.filter((p) => p.ok).length, r.payments.length))}<small> agree</small>`, esc("Rail amount = T:0 amount = the books, line by line."))}
</ol>`;
  const tone = (rail: string) => (rail === "metal" ? "metal" : "awx");
  const rows = r.payments.map((p) => `<li><span class="rl ${tone(p.rail)}">${esc(p.railName)}</span><span class="who"><b>${esc(`${p.currency} ${p.amount}`)}</b>${esc(p.counterparty)} <code class="je" title="${esc(`T:0 ${p.t0Id}`)}">${esc(p.je.slice(0, 15))}…</code></span><span class="t">${esc(`+${secs(p.ms)}`)}</span><span class="ok">${icon("check", 15)}${esc(`${p.checks} checks`)}</span></li>`).join("");
  return `<section class="card lg" id="how" aria-labelledby="bl-how">
<h2 id="bl-how">${esc("How a payment reaches the books")}<span class="bl-tag">${esc(`Run of ${DAY(r.day)} · sandbox · test money`)}</span></h2>
${flow}
<ul class="bl-pay">${rows}</ul>
<p class="bl-sub">${esc("Each line: the rail, the payment, its T:0 entry, the time from settlement to entry, and the reconcile checks that passed.")} ${rec(RAILS_RECORD, "record")}</p>
</section>`;
}

/** The demo's lines: the balance sheet as recorded, each with its side; equity includes the year's result. */
export function demoLines(v: StatementView): { side: "a" | "l" | "e"; line: StatementLine }[] {
  return [
    ...v.assets.map((line) => ({ side: "a" as const, line })),
    ...v.liabilities.map((line) => ({ side: "l" as const, line })),
    ...v.equity.map((line) => ({ side: "e" as const, line })),
    { side: "e" as const, line: { name: "Result this year", cents: v.result } },
  ];
}

/** "Change one cent": the balance sheet as recorded; the script changes one line by a cent, in the browser only. */
export function demoHtml(v: StatementView): string {
  const lines = demoLines(v);
  const le = v.totalLiabilities + v.totalEquity;
  if (v.totalAssets !== le) return "";
  // Each side a bar of its lines, to one scale (the larger side); the script redraws them with the changed cents.
  // Two bars to one scale (total assets): assets by line; liabilities by line, then equity as one block (its lines net,
  // the year's loss included). The script redraws them with the changed cents.
  const rect = (cls: string, i: string, x: number, w: number) => `<rect class="${cls}" data-i="${i}" x="${x.toFixed(2)}" y="0" width="${w.toFixed(2)}" height="18"/>`;
  const W = (c: number) => (1000 * Math.max(0, c)) / v.totalAssets;
  const bars = (parts: [string, string, number][]) => { let x = 0; return `<svg viewBox="0 0 1000 18" preserveAspectRatio="none">${parts.map(([cls, i, c]) => { const r = rect(cls, i, x, W(c)); x += W(c); return r; }).join("")}</svg>`; };
  const assetBar = bars(lines.flatMap((l, i) => (l.side === "a" ? [[`a a${Math.min(3, i + 1)}`, String(i), l.line.cents] as [string, string, number]] : [])));
  const leBar = bars([...lines.flatMap((l, i) => (l.side === "l" ? [["l", String(i), l.line.cents] as [string, string, number]] : [])), ["e", "e", v.totalEquity]]);
  const chk = (id: string, yes: string, no: string) => `<li data-check="${id}"><span class="i1">${icon("circle-check", 18)}</span><span class="i2">${icon("octagon-x", 18)}</span><span class="w1">${esc(yes)}</span><span class="w2">${esc(no)}</span><span class="x"></span></li>`;
  return `<section class="card lg lgd" id="cent" aria-labelledby="bl-cent">
<h2 id="bl-cent">${esc("Change one cent")}<span class="bl-tag demo">${esc("Demo · in your browser only")}</span></h2>
<p class="bl-sub">${esc(`${v.company.replace(/\s*\(test company\)$/, "")}'s balance sheet as booked. Pick a line, change it by one cent.`)}</p>
<p class="lgd-eq" aria-live="polite"><span>${esc("Assets")}</span><a href="#bk-bs" title="${esc("The balance sheet as booked")}"><b data-sum="a">${esc(amt(v.totalAssets))}</b></a><span class="op" data-op>=</span><span>${esc("Liabilities + equity")}</span><a href="#bk-bs" title="${esc("The balance sheet as booked")}"><b data-sum="le">${esc(amt(le))}</b></a><span class="lgd-st" data-st>${esc("Balanced")}</span></p>
<div class="lgd-bars" aria-hidden="true"><div class="row" data-a><span>${esc("Assets")}</span>${assetBar}</div><div class="row" data-le><span>${esc("Liab. + equity")}</span>${leBar}</div></div>
<div class="lgd-lines" role="group" aria-label="${esc("Balance sheet lines")}">${lines.map((x, i) => `<button type="button" data-i="${i}" data-side="${x.side}" data-cents="${x.line.cents}" aria-pressed="${i === 0 ? "true" : "false"}">${esc(x.line.name)} <b>${esc(amt(x.line.cents))}</b></button>`).join("")}</div>
<div class="lgd-ctl"><button type="button" class="go" data-d="1">${esc("+ 1 cent")}</button><button type="button" data-d="-1">${esc("− 1 cent")}</button><button type="button" data-reset>${esc("Reset")}</button></div>
<ul class="lgd-checks">${chk("bal", "Balance sheet balances", "Balance sheet does not balance")}${chk("de", "Debits equal credits", "Debits do not equal credits")}${chk("rec", "Matches the books as booked", "Differs from the books as booked")}</ul>
<p class="lgd-note">${esc("Nothing is saved or sent. In Purser a changed cent is refused at the signature, and T:0 keeps a month with one open.")}</p>
</section>`;
}

/** The demo's script: no data but the page's own buttons; sums in whole cents. */
export const DEMO_JS = `(function () {
var box = document.getElementById("cent"); if (!box) return;
var btns = [].slice.call(box.querySelectorAll(".lgd-lines button"));
var base = btns.map(function (b) { return Number(b.getAttribute("data-cents")); }), now = base.slice(), sel = 0;
var fmt = function (c) { var a = Math.abs(c); return (c < 0 ? "\\u2212" : "") + Math.floor(a / 100).toLocaleString("en-US") + "." + String(a % 100).padStart(2, "0"); };
function draw() {
  var a = 0, le = 0;
  btns.forEach(function (b, i) { if (b.getAttribute("data-side") === "a") a += now[i]; else le += now[i]; b.querySelector("b").textContent = fmt(now[i]); b.classList.toggle("chg", now[i] !== base[i]); b.setAttribute("aria-pressed", i === sel ? "true" : "false"); });
  var scale = Math.max(a, le);
  var eq = function (f) { return btns.reduce(function (n, b, i) { return b.getAttribute("data-side") === "e" ? f(n, i) : n; }, 0); };
  var val = function (k) { return k === "e" ? eq(function (n, i) { return n + now[i]; }) : now[Number(k)]; };
  var changed = function (k) { return k === "e" ? eq(function (n, i) { return n + (now[i] !== base[i] ? 1 : 0); }) > 0 : now[Number(k)] !== base[Number(k)]; };
  ["[data-a]", "[data-le]"].forEach(function (q) { var x = 0; [].slice.call(box.querySelectorAll(q + " rect")).forEach(function (r) { var w = 1000 * Math.max(0, val(r.getAttribute("data-i"))) / scale; r.setAttribute("x", x.toFixed(2)); r.setAttribute("width", w.toFixed(2)); x += w; r.classList.toggle("hot", changed(r.getAttribute("data-i"))); }); });
  var off = a - le, bad = off !== 0, diff = now.reduce(function (n, c, i) { return n + Math.abs(c - base[i]); }, 0);
  box.querySelector('[data-sum="a"]').textContent = fmt(a); box.querySelector('[data-sum="le"]').textContent = fmt(le);
  var op = box.querySelector("[data-op]"); op.textContent = bad ? "\\u2260" : "="; op.classList.toggle("no", bad);
  var st = box.querySelector("[data-st]"); st.textContent = bad ? "Out of balance by " + fmt(Math.abs(off)) : "Balanced"; st.classList.toggle("no", bad);
  [["bal", bad, "off by " + fmt(Math.abs(off))], ["de", bad, "off by " + fmt(Math.abs(off))], ["rec", diff !== 0, diff ? "the month cannot close" : ""]].forEach(function (c) {
    var li = box.querySelector('[data-check="' + c[0] + '"]'); li.classList.toggle("no", c[1]); li.querySelector(".x").textContent = c[1] ? c[2] : "";
  });
}
btns.forEach(function (b, i) { b.addEventListener("click", function () { sel = i; draw(); }); });
[].slice.call(box.querySelectorAll("[data-d]")).forEach(function (b) { b.addEventListener("click", function () { now[sel] += Number(b.getAttribute("data-d")); draw(); }); });
box.querySelector("[data-reset]").addEventListener("click", function () { now = base.slice(); draw(); });
})();`;
