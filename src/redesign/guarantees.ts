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
  /** One more link, folded with "How": the question a promise leaves open, answered on another page. */
  more?: { label: string; href: string };
}

export const GUARANTEES: readonly Guarantee[] = [
  {
    id: "g-terms", promise: "Beyond the limits, money moves only on the CFO's signature over the exact terms.", by: "Purser's code + the CFO",
    how: "The CFO's passkey (Face ID) signs the hash of the exact terms; the runner checks the signature and the hash before it pays. Single use, it expires.",
    source: "src/policy/approvals.ts", test: "test/approvals.test.ts",
    evidence: { label: "Main run: the CFO's Face ID decisions", href: "proof#faceid" },
    // The panel's review, 12 Nov: a promise that hangs on one person's signature must say what happens without that
    // person. /security answers it in five lines (its fold "unavailable", read from docs/security.md).
    more: { label: "If the approver is unavailable", href: "security#unavailable" },
  },
  {
    id: "g-cards", promise: "An agent's card cannot spend over the CFO's limit.", by: "Airwallex",
    how: "The CFO policy's limits, merchant categories, currency and end date are written to each agent's card as Airwallex's own controls and read back.",
    source: "src/policy/cards.ts", test: "test/cards.test.ts",
    evidence: { label: "Airwallex-only run: Airwallex's own decline", href: "airwallex#awx-1-steps" },
  },
  {
    id: "g-visa", promise: "A Visa card purchase above the limit waits for the CFO's Face ID.", by: "Purser's code + the CFO",
    how: "Visa Intelligent Commerce through Airwallex's Airi: Purser asks Airi for a Visa credential for one purchase only after the CFO signed the exact terms, and refuses a merchant the CFO does not allow before Airi is asked.",
    source: "src/airi/purchase.ts", test: "test/airi-purchase.test.ts",
    evidence: { label: "The Airi run (Airwallex sandbox, test card): paid after Face ID", href: "visa" },
  },
  {
    id: "g-chain", promise: "An agent cannot pay past its on-chain budget.", by: "Alta (on chain)",
    how: "A mandate per agent: a cap per payment, a total budget, one payee and an end date; Alta's facilitator refuses anything outside it.",
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

export const GUARANTEES_CSS = `/* What Purser guarantees, as a light list (the owner, 13 Nov: /proof "enterprise level", no dark slab): one row per
 * promise, numbered; who enforces it in a small neutral pill; the evidence as the row's one link; how, the file and the
 * test folded under the row. Wide: promise | enforced by | evidence. Narrow: the three stacked. */
.gtee { margin: 0 0 28px; counter-reset: g; }
.gtee h2 { display: flex; align-items: center; gap: 8px; margin: 0 0 12px; font-size: 20px; font-weight: 720; letter-spacing: -.01em; color: var(--text); }
.gtee h2 .i { color: var(--muted); }
.gtee ul { list-style: none; margin: 0; padding: 0; border: 1px solid var(--border); border-radius: 14px; background: var(--surface); overflow: hidden; }
.gtee .gh { display: grid; grid-template-columns: 28px minmax(0, 1fr) 190px minmax(0, 260px); column-gap: 16px; padding: 0 19px 8px; font-size: 12px; font-weight: 650; letter-spacing: .04em; text-transform: uppercase; color: var(--faint); }
.gtee .gh span:first-child { grid-column: 2; }
.gtee li { counter-increment: g; display: grid; grid-template-columns: 28px minmax(0, 1fr) 190px minmax(0, 260px); column-gap: 16px; row-gap: 2px; align-items: baseline; padding: 14px 18px; border-top: 1px solid var(--border); min-width: 0; }
.gtee li:first-child { border-top: 0; }
.gtee li::before { content: counter(g); grid-column: 1; grid-row: 1; font: 650 13px/1.5 Inter, system-ui, sans-serif; color: var(--faint); font-variant-numeric: tabular-nums; }
.gtee li b { grid-column: 2; grid-row: 1; font-size: 15px; line-height: 1.45; font-weight: 600; color: var(--text); }
.gtee .by { grid-column: 3; grid-row: 1; justify-self: start; display: inline-block; padding: 2px 9px; border-radius: 999px; border: 1px solid var(--border); background: var(--sunken); font: 600 12.5px/1.5 Inter, system-ui, sans-serif; color: var(--muted); white-space: normal; }
.gtee .ev { grid-column: 4; grid-row: 1; font-size: 14px; line-height: 1.45; }
.gtee a { color: var(--accent); font-weight: 600; text-decoration: none; overflow-wrap: anywhere; }
.gtee a:hover { text-decoration: underline; }
.gtee details { grid-column: 2 / -1; grid-row: 2; font-size: 14px; color: var(--muted); }
.gtee summary { cursor: pointer; width: fit-content; color: var(--muted); font-weight: 600; font-size: 13px; }
.gtee details p { margin: 6px 0 0; line-height: 1.5; max-width: 62em; }
.gtee .src { display: flex; flex-wrap: wrap; gap: 6px; }
.gtee .src a { display: inline-block; padding: 2px 8px; border-radius: 6px; border: 1px solid var(--border); background: var(--sunken); color: var(--text); font: 500 12.5px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
@media (max-width: 899px) {
  .gtee .gh { display: none; }
  .gtee li { grid-template-columns: 22px minmax(0, 1fr); column-gap: 10px; padding: 12px 14px; }
  .gtee .by { grid-column: 2; grid-row: 2; margin-top: 6px; }
  .gtee .by::before { content: "Enforced by "; font-weight: 500; }
  .gtee .ev { grid-column: 2; grid-row: 3; }
  .gtee details { grid-column: 2; grid-row: 4; }
  .gtee .ev a, .gtee summary { display: inline-flex; align-items: center; min-height: 44px; }
  .gtee summary::before { content: "▸"; margin-right: 6px; }
  .gtee details[open] summary::before { content: "▾"; }
  .gtee .src a { padding-block: 3px; border-width: 10px 0; border-color: transparent; background-clip: padding-box; box-shadow: inset 0 0 0 1px var(--border); }
}`;

const ext = (href: string) => /^https:\/\//.test(href);
const link = (href: string, label: string) => `<a href="${esc(href)}"${ext(href) ? ' target="_blank" rel="noopener"' : ""}>${esc(label)}${ext(href) ? " ↗" : ""}</a>`;

/** Who enforces it, as the pill's colour: Airwallex, the chain, or Purser (its code, the CFO). */
const byKind = (by: string) => (/^Airwallex/.test(by) ? "airwallex" : /^Alta/.test(by) ? "metal" : "purser");

/** The block: each promise in sight with who enforces it and its evidence; how, the file and the test folded. */
export function guaranteesHtml(rows: readonly Guarantee[] = GUARANTEES): string {
  return `<section class="gtee" id="${GUARANTEES_ID}" aria-labelledby="h-gtee"><h2 id="h-gtee">${icon("shield-check", 20)} ${esc(GUARANTEES_HEADING)}</h2>
<div class="gh" aria-hidden="true"><span>${esc("Guarantee")}</span><span>${esc("Enforced by")}</span><span>${esc("Evidence")}</span></div>
<ul>${rows.map((g) => `<li id="${g.id}" data-by="${byKind(g.by)}"><b>${esc(g.promise)}</b><span class="by">${esc(g.by)}</span><span class="ev">${link(g.evidence.href, g.evidence.label)}</span>
<details><summary>${esc("How")}</summary><p>${esc(g.how)}</p>${g.more ? `<p>${link(g.more.href, g.more.label)}</p>` : ""}<p class="src">${link(`${REPO_BLOB}${g.source}`, g.source)} ${link(`${REPO_BLOB}${g.test}`, g.test)}</p></details></li>`).join("")}</ul></section>`;
}
