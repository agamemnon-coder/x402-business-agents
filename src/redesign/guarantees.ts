// What Purser guarantees, one row each (competitive review, 10 Nov): the promise, who enforces it, the source file, the
// test that holds it in CI, and the live evidence (or, said so, the red team on stand-ins). Taken from
// docs/controls-matrix.md; test/guarantees.test.ts checks every file and test named here exists. No figures: the
// figures live on the pages each row links to.

import { REPO_BLOB } from "./metalStory.js";
import { esc, icon } from "./ui.js";

export interface Guarantee {
  id: string;
  promise: string;
  /** Who refuses: Airwallex, the chain, Purser's code, the CFO. */
  by: string;
  how: string;
  source: string;
  test: string;
  evidence: { label: string; href: string };
}

export const GUARANTEES: readonly Guarantee[] = [
  {
    id: "g-terms", promise: "Beyond the limits, money moves only on the CFO's signature over the exact terms.", by: "Purser's code + the CFO",
    how: "The CFO's passkey (Face ID) signs the hash of the exact terms; the runner checks the signature and the hash before it pays. Single use, it expires.",
    source: "src/policy/approvals.ts", test: "test/approvals.test.ts",
    evidence: { label: "Main run: the CFO's Face ID decisions", href: "proof#faceid" },
  },
  {
    id: "g-cards", promise: "An agent's card cannot spend over the CFO's limit.", by: "Airwallex",
    how: "The CFO policy's limits, merchant categories, currency and end date are written to each agent's card as Airwallex's own controls and read back.",
    source: "src/policy/cards.ts", test: "test/cards.test.ts",
    evidence: { label: "Airwallex-only run: Airwallex's own decline", href: "airwallex#awx-1-steps" },
  },
  {
    id: "g-visa", promise: "A Visa card purchase above the limit waits for the CFO's Face ID.", by: "Purser's code + the CFO",
    how: "Visa Intelligent Commerce through Airwallex's Airi: Purser asks Airi for a single-use Visa credential only after the CFO signed the exact terms, and refuses a merchant the CFO does not allow before Airi is asked.",
    source: "src/airi/purchase.ts", test: "test/airi-purchase.test.ts",
    evidence: { label: "The Airi run (Airwallex sandbox, test card): paid after Face ID", href: "visa" },
  },
  {
    id: "g-chain", promise: "An agent cannot pay past its on-chain budget.", by: "Metal (on chain)",
    how: "A mandate per agent: a cap per payment, a total budget, one payee and an end date; Metal's facilitator refuses anything outside it.",
    source: "src/policy/mandates.ts", test: "test/executors-mandate.test.ts",
    evidence: { label: "Main run: a purchase refused on chain (our own check switched off once to test it)", href: "metal" },
  },
  {
    id: "g-once", promise: "An invoice is paid once.", by: "Purser's code",
    how: "Invoice numbers are normalised (case, spaces, dashes) and an invoice already handled is refused before anything moves.",
    source: "src/agents/euroBill.ts", test: "test/invoice-duplicate-key.test.ts",
    evidence: { label: "Red team, in a test world: a renamed duplicate refused", href: `${REPO_BLOB}test/invoice-duplicate-key.test.ts` },
  },
  {
    id: "g-keys", promise: "No key, token or credential reaches Claude.", by: "Purser's code",
    how: "The agents call tools; the keys stay with the code that pays, and the prompts carry none of them.",
    source: "src/claude/tools.ts", test: "test/adversarial.test.ts",
    evidence: { label: "Main run: every Claude decision and its tools", href: "claude" },
  },
  {
    id: "g-log", promise: "The record cannot be changed quietly.", by: "Purser's code",
    how: "Every step goes into an append-only, hash-chained audit log; changing one line breaks the chain, and anyone can check it offline.",
    source: "src/audit/log.ts", test: "test/audit.test.ts",
    evidence: { label: "Check it yourself: the offline verify", href: `${REPO_BLOB}README.md#verify-it-yourself-in-3-commands` },
  },
];

export const GUARANTEES_ID = "guarantees";
export const GUARANTEES_HEADING = "What Purser guarantees";

export const GUARANTEES_CSS = `/* The guarantees on the dark stage of Home's demo card (Max, 10 Nov: "same level as the homepage"): numbered cards, who
 * enforces each as a coloured pill, the evidence as the card's one link, how, the file and the test folded as mono chips. */
.gtee { --g-bg: #0b0d18; --g-ink: #eef0ff; --g-dim: #a7adc8; --g-line: rgba(255,255,255,.08); --g-acc: #a49fff;
  position: relative; isolation: isolate; margin: 22px 0 10px; padding: 22px 20px 20px; border-radius: 24px; color: var(--g-ink); overflow: hidden; counter-reset: g;
  background: radial-gradient(110% 80% at 90% 0%, rgba(139,133,255,.26), transparent 55%), radial-gradient(80% 60% at 0% 100%, rgba(255,138,76,.13), transparent 60%), var(--g-bg);
  border: 1px solid rgba(255,255,255,.07); box-shadow: 0 1px 0 rgba(255,255,255,.06) inset, 0 30px 60px -30px rgba(20,16,80,.55); }
.gtee::before { content: ""; position: absolute; inset: 0; z-index: -1; pointer-events: none; background-image: linear-gradient(rgba(255,255,255,.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.03) 1px, transparent 1px); background-size: 28px 28px; mask-image: radial-gradient(80% 70% at 60% 30%, #000, transparent); -webkit-mask-image: radial-gradient(80% 70% at 60% 30%, #000, transparent); }
.gtee h2 { display: flex; align-items: center; gap: 10px; font-size: clamp(22px, 2.2vw, 28px); font-weight: 760; letter-spacing: -.01em; margin: 0 0 16px; color: var(--g-ink); }
.gtee h2 .i { color: var(--g-acc); }
.gtee ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
@media (min-width: 900px) { .gtee ul { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
.gtee li { counter-increment: g; position: relative; display: flex; flex-direction: column; gap: 8px; padding: 16px 16px 14px 56px; border: 1px solid var(--g-line); border-radius: 16px; background: rgba(255,255,255,.035); min-width: 0; transition: border-color .2s ease-out, background .2s ease-out; }
.gtee li:hover { border-color: rgba(164,159,255,.45); background: rgba(139,133,255,.07); }
.gtee li::before { content: counter(g); position: absolute; left: 16px; top: 15px; width: 26px; height: 26px; display: grid; place-items: center; border-radius: 50%; font: 750 13px/1 Inter, system-ui, sans-serif; color: #0b0d18; background: linear-gradient(180deg, #b6b2ff, #8b85ff); }
.gtee li b { display: block; font-size: 16.5px; line-height: 1.38; font-weight: 700; color: var(--g-ink); }
.gtee .by { align-self: start; display: inline-flex; align-items: center; gap: 6px; padding: 3px 10px; border-radius: 999px; font: 650 12.5px/1.3 Inter, system-ui, sans-serif; color: #d9dbff; background: rgba(139,133,255,.16); border: 1px solid rgba(139,133,255,.3); }
.gtee .by::before { content: "Enforced by"; color: var(--g-dim); font-weight: 600; }
.gtee li[data-by="airwallex"] .by { color: #ffc3a3; background: rgba(255,138,76,.14); border-color: rgba(255,138,76,.35); }
.gtee li[data-by="metal"] .by { color: #8ff0e2; background: rgba(45,212,191,.12); border-color: rgba(45,212,191,.35); }
.gtee a { color: var(--g-acc); font-weight: 650; text-decoration: none; overflow-wrap: anywhere; }
.gtee a:hover { text-decoration: underline; }
.gtee .ev { display: block; font-size: 14.5px; line-height: 1.4; }
.gtee details { font-size: 14.5px; color: var(--g-dim); border-top: 1px solid var(--g-line); padding-top: 6px; }
.gtee summary { cursor: pointer; color: var(--g-dim); font-weight: 600; }
.gtee details p { margin: 6px 0 0; line-height: 1.45; }
.gtee .src { display: flex; flex-wrap: wrap; gap: 6px; }
.gtee .src a { display: inline-block; padding: 3px 9px; border-radius: 8px; background: rgba(255,255,255,.06); border: 1px solid var(--g-line); color: #d9dbff; font: 600 12.5px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
@media (max-width: 640px) { .gtee { padding: 16px 10px 10px; border-radius: 20px; } .gtee h2 { margin: 0 4px 12px; } }
/* A phone or a tablet (jury, 12 Nov: the guarantees start the page and the page is half as long): the same card, more
 * compact. The number beside the promise; under it who enforces it with "How" at the end of the same row (the fold opens
 * under that row), then the evidence. Every link and "How" is at least 44 px high to tap: a link in a line of text grows
 * by padding above and below, which moves no line; the file chips grow by a clear border around the same chip. */
@media (max-width: 899px) {
  .gtee ul { gap: 8px; }
  .gtee li { display: grid; grid-template-columns: minmax(0, 1fr); gap: 4px; padding: 12px 12px 10px; }
  .gtee li::before { left: 12px; top: 11px; }
  .gtee li b { min-height: 24px; padding-left: 36px; }
  .gtee .by { grid-area: 2 / 1; justify-self: start; margin-top: 3px; max-width: calc(100% - 56px); }
  .gtee details { grid-area: 2 / 1; border-top: 0; padding-top: 0; }
  .gtee summary { width: fit-content; margin: -7px 0 -7px auto; padding: 11px 0 11px 10px; line-height: 22px; }
  .gtee details[open] summary { margin-bottom: 0; }
  .gtee details p { margin: 2px 0 0; }
  .gtee .ev { grid-row: 3; }
  .gtee .ev a { padding-block: 14px; }
  .gtee .src { gap: 0 6px; margin-top: -4px; }
  .gtee .src a { padding: 3px 9px; border: solid transparent; border-width: 10px 0; border-radius: 8px / 18px; background-clip: padding-box; box-shadow: inset 0 0 0 1px var(--g-line); }
}
@media (prefers-reduced-motion: reduce) { .gtee li { transition: none; } }`;

const ext = (href: string) => /^https:\/\//.test(href);
const link = (href: string, label: string) => `<a href="${esc(href)}"${ext(href) ? ' target="_blank" rel="noopener"' : ""}>${esc(label)}${ext(href) ? " ↗" : ""}</a>`;

/** Who enforces it, as the pill's colour: Airwallex, the chain, or Purser (its code, the CFO). */
const byKind = (by: string) => (/^Airwallex/.test(by) ? "airwallex" : /^Metal/.test(by) ? "metal" : "purser");

/** The block: each promise in sight with who enforces it and its evidence; how, the file and the test folded. */
export function guaranteesHtml(rows: readonly Guarantee[] = GUARANTEES): string {
  return `<section class="gtee" id="${GUARANTEES_ID}" aria-labelledby="h-gtee"><h2 id="h-gtee">${icon("shield-check", 20)} ${esc(GUARANTEES_HEADING)}</h2>
<ul>${rows.map((g) => `<li id="${g.id}" data-by="${byKind(g.by)}"><b>${esc(g.promise)}</b><span class="by">${esc(g.by)}</span><span class="ev">${link(g.evidence.href, g.evidence.label)}</span>
<details><summary>${esc("How")}</summary><p>${esc(g.how)}</p><p class="src">${link(`${REPO_BLOB}${g.source}`, g.source)} ${link(`${REPO_BLOB}${g.test}`, g.test)}</p></details></li>`).join("")}</ul></section>`;
}
