// Home's hero (the owner, 12 Nov: "cleaner, more enterprise"): one payment's flow drawn in HTML and SVG, in one wide
// card, playing on a 12 s loop. An invoice slides in, the reader reads it and its fields tick, the check says ready to
// pay, a Face ID ring closes and the signed hash shows, then it is paid and the ledger lines slide in.
//
// Every value is from one /try run of the sample invoice "A clean invoice from a supplier on file" on the live
// deployment with Claude on (13 Nov, docs/runs/2026-11-13-try-sample.json): the supplier, number, amount, due date,
// account ending, the signed terms' hash and the three booking lines. Claude Haiku 5.5 read that invoice (read_by
// claude:claude-haiku-5-5), which is what the chip names; Purser's code holds the limits, and the chip says so.
// Test money, a simulated bank.
//
// CSS only. The final state is the default: with reduced motion (or no animation support) the whole flow stands.

import { readFileSync } from "node:fs";
import { esc, icon } from "./ui.js";

/** The record of that run: every value the card shows is read from it. */
export const TRY_SAMPLE_RECORD = "docs/runs/2026-11-13-try-sample.json";
interface TrySample { mode: { reader: string; reader_model?: string }; invoice: { supplier: string; number: string; currency: string; total: string; due: string; account_ending: string }; signed: { terms_hash_prefix: string }; booked: { account: string; name: string; debit: string | null; credit: string | null }[] }
const rec = JSON.parse(readFileSync(new URL(`../../${TRY_SAMPLE_RECORD}`, import.meta.url), "utf8")) as TrySample;
const money = (a: string) => Number(a).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const cur = rec.invoice.currency;
export const FLOW = {
  supplier: rec.invoice.supplier, number: rec.invoice.number, amount: `${cur} ${money(rec.invoice.total)}`, due: rec.invoice.due, account: `…${rec.invoice.account_ending}`,
  hash: `${rec.signed.terms_hash_prefix}…`,
  ledger: rec.booked.map((l) => ({ code: l.account, name: l.name, debit: l.debit ? `${cur} ${money(l.debit)}` : "", credit: l.credit ? `${cur} ${money(l.credit)}` : "" })),
};

/** The step labels above the card, a few words each. */
export const FLOW_STEPS = ["Invoice", "Read", "Check", "Sign", "Paid"] as const;
export const FLOW_NOTE = "A /try run of its sample invoice, test money.";

const LOOP = 12;

/** The reader chip names who read the recorded invoice: Claude only when the record says Claude read it. */
export const READER_CHIP = rec.mode.reader === "claude" ? "Claude reader" : "Reader: Purser's code";

export function heroFlowHtml(): string {
  const f = FLOW;
  const field = (k: string, v: string, i: number) => `<div class="hf-row hf-t${i}"><dt>${esc(k)}</dt><dd>${esc(v)}<span class="hf-tick">${icon("check", 14)}</span></dd></div>`;
  return `<figure class="hf" data-rec="${TRY_SAMPLE_RECORD}" aria-label="${esc(`One payment in Purser: an invoice from ${f.supplier}, ${f.amount}, comes in; the reader reads it; the check says ready to pay; the CFO signs the exact terms with Face ID; it is paid and booked. Values from a /try run.`)}">
  <ol class="hf-steps" aria-hidden="true">${FLOW_STEPS.map((s, i) => `<li class="hf-s${i}">${esc(s)}</li>`).join("")}</ol>
  <div class="hf-card" aria-hidden="true">
    <div class="hf-inv">
      <div class="hf-head"><span class="hf-doc">${icon("file-check", 16)}</span><div><b>${esc(f.supplier)}</b><small>${esc(`Invoice ${f.number}`)}</small></div></div>
      <p class="hf-amt">${esc(f.amount)}</p>
      <dl>${field("Payee", f.supplier, 0)}${field("Amount", f.amount, 1)}${field("Due", f.due, 2)}${field("Account", f.account, 3)}</dl>
    </div>
    <div class="hf-side">
      <p class="hf-chip hf-reader"><span class="hf-dot"></span><b>${esc(READER_CHIP)}</b><small>Payee, amount, account</small></p>
      <p class="hf-chip hf-check">${icon("shield-check", 16)}<b>Checker: ready to pay</b><small>Purser's code holds the limits</small></p>
      <div class="hf-sign">
        <svg class="hf-ring" viewBox="0 0 48 48" width="48" height="48"><circle class="hf-ring-bg" cx="24" cy="24" r="21"/><circle class="hf-ring-fg" cx="24" cy="24" r="21"/></svg>
        <span class="hf-face">${icon("scan-face", 22)}</span>
        <p class="hf-pill"><b>Signed</b> · <code>${esc(`hash ${f.hash}`)}</code></p>
      </div>
      <div class="hf-paid">
        <p class="hf-paid-h"><span>${icon("check", 14)}</span><b>Paid</b><small>simulated bank</small></p>
        <table class="hf-led"><tbody>${f.ledger.map((l, i) => `<tr class="hf-l${i}"><th>${esc(l.code)}</th><td>${esc(l.name)}</td><td>${esc(l.debit || l.credit)}<small>${l.debit ? "Dr" : "Cr"}</small></td></tr>`).join("")}</tbody></table>
      </div>
    </div>
  </div>
</figure>`;
}

// When each piece appears, as a share of the loop; it stays until the loop fades out at 95%.
const AT: Record<string, number> = {
  "hf-inv": 2, "hf-reader": 12, "hf-t0 .hf-tick": 18, "hf-t1 .hf-tick": 21, "hf-t2 .hf-tick": 24, "hf-t3 .hf-tick": 27,
  "hf-check": 36, "hf-sign": 48, "hf-pill": 62, "hf-paid": 70, "hf-l0": 75, "hf-l1": 79, "hf-l2": 83,
};
// Which step label is lit, from-to.
const LIT: [number, number][] = [[0, 12], [12, 36], [36, 48], [48, 70], [70, 96]];
const key = (s: string) => s.replace(/[^a-z0-9]/g, "");

export const HERO_FLOW_CSS = `
.hf { margin: 0; }
.hf-steps { list-style: none; margin: 0 0 12px; padding: 0; display: flex; gap: 6px; flex-wrap: wrap; }
.hf-steps li { font-size: 13px; font-weight: 650; letter-spacing: .02em; color: var(--faint); padding: 4px 10px; border-radius: 999px; border: 1px solid var(--border); }
.hf-steps li:last-child { color: var(--accent); border-color: var(--accent); }
.hf-card { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 16px; padding: 18px; border: 1px solid var(--border); border-radius: 16px; background: var(--surface); box-shadow: 0 1px 2px rgba(16, 24, 40, .04), 0 12px 32px -12px rgba(16, 24, 40, .14); }
.hf-inv { border: 1px solid var(--border); border-radius: 12px; padding: 14px; background: var(--bg); }
.hf-head { display: flex; gap: 10px; align-items: center; }
.hf-head b { display: block; font-size: 15px; } .hf-head small { display: block; font-size: 13px; color: var(--muted); }
.hf-doc { width: 32px; height: 32px; border-radius: 8px; display: grid; place-items: center; background: var(--sunken); color: var(--muted); flex: none; }
.hf-amt { margin: 14px 0 8px; font-size: 26px; font-weight: 750; letter-spacing: -.02em; font-variant-numeric: tabular-nums; }
.hf-inv dl { margin: 0; }
.hf-row { display: flex; justify-content: space-between; gap: 8px; padding: 7px 0; border-top: 1px solid var(--border); font-size: 14px; }
.hf-row dt { color: var(--muted); } .hf-row dd { margin: 0; font-weight: 600; display: inline-flex; align-items: center; gap: 6px; text-align: right; }
.hf-tick { color: var(--ok); display: inline-flex; }
.hf-side { display: grid; gap: 10px; align-content: start; }
.hf-chip { margin: 0; display: grid; grid-template-columns: auto 1fr; column-gap: 8px; align-items: center; padding: 10px 12px; border: 1px solid var(--border); border-radius: 12px; background: var(--bg); }
.hf-chip b { font-size: 14px; } .hf-chip small { grid-column: 2; font-size: 13px; color: var(--muted); }
.hf-reader b { color: var(--claude); } .hf-dot { width: 10px; height: 10px; border-radius: 50%; background: var(--claude); box-shadow: 0 0 0 4px var(--claude-soft); }
.hf-check { color: var(--ok); } .hf-check b { color: var(--text); }
.hf-sign { display: grid; grid-template-columns: 48px 1fr; align-items: center; column-gap: 10px; position: relative; padding: 8px 12px; border: 1px solid var(--border); border-radius: 12px; background: var(--bg); }
.hf-ring { grid-area: 1 / 1; transform: rotate(-90deg); }
.hf-ring circle { fill: none; stroke-width: 3; } .hf-ring-bg { stroke: var(--border); } .hf-ring-fg { stroke: var(--accent); stroke-dasharray: 132; stroke-dashoffset: 0; stroke-linecap: round; }
.hf-face { grid-area: 1 / 1; display: grid; place-items: center; color: var(--accent); }
.hf-pill { margin: 0; font-size: 14px; } .hf-pill code { font-size: 13px; color: var(--muted); }
.hf-paid { padding: 10px 12px; border: 1px solid var(--border); border-radius: 12px; background: var(--bg); }
.hf-paid-h { margin: 0 0 6px; display: flex; align-items: center; gap: 8px; font-size: 15px; }
.hf-paid-h span { width: 22px; height: 22px; border-radius: 50%; display: grid; place-items: center; background: var(--ok); color: #fff; }
.hf-paid-h small { font-size: 13px; color: var(--muted); font-weight: 500; }
.hf-led { width: 100%; border-collapse: collapse; font-size: 14px; font-variant-numeric: tabular-nums; }
.hf-led th, .hf-led td { padding: 5px 0; border-top: 1px solid var(--border); text-align: left; font-weight: 500; }
.hf-led th { font-family: var(--mono, ui-monospace, monospace); font-size: 13px; color: var(--muted); width: 3.4em; }
.hf-led td:nth-child(2) { white-space: nowrap; } .hf-led td:nth-child(3) { text-align: right; padding-left: 8px; white-space: nowrap; } .hf-led td small { margin-left: 6px; font-size: 12px; color: var(--faint); }
@media (max-width: 640px) { .hf-card { grid-template-columns: minmax(0, 1fr); padding: 14px; } }
@media (prefers-reduced-motion: no-preference) {
${Object.entries(AT).map(([sel]) => `  .hf .${sel} { animation: hf-${key(sel)} ${LOOP}s ease-out infinite; }`).join("\n")}
  .hf .hf-ring-fg { animation: hf-ring ${LOOP}s ease-in-out infinite; }
${LIT.map((_, i) => `  .hf .hf-s${i} { animation: hf-lit${i} ${LOOP}s linear infinite; }`).join("\n")}
}
${Object.entries(AT).map(([sel, at]) => `@keyframes hf-${key(sel)} { 0%, ${at}% { opacity: 0; transform: translateY(8px); } ${at + 4}%, 94% { opacity: 1; transform: none; } 99%, 100% { opacity: 0; transform: none; } }`).join("\n")}
@keyframes hf-ring { 0%, 50% { stroke-dashoffset: 132; } 60%, 94% { stroke-dashoffset: 0; } 99%, 100% { stroke-dashoffset: 132; } }
${LIT.map(([a, b], i) => `@keyframes hf-lit${i} { 0%, ${Math.max(0, a - 0.5)}% { color: var(--faint); border-color: var(--border); } ${a}%, ${b - 0.5}% { color: var(--accent); border-color: var(--accent); } ${b}%, 100% { color: var(--faint); border-color: var(--border); } }`).join("\n")}
p.hf-note { margin: 10px 0 0; font-size: 14px; color: var(--muted); }
p.hf-note a { color: var(--accent); font-weight: 650; display: inline-flex; align-items: center; min-height: 44px; }
`;
