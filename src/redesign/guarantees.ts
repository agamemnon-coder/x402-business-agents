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

export const GUARANTEES_CSS = `.gtee { margin: 22px 0 6px; }
.gtee h2 { font-size: 22px; font-weight: 760; margin: 0 0 4px; }
.gtee > p { margin: 0 0 12px; color: var(--muted); font-size: 15px; }
.gtee ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
@media (min-width: 900px) { .gtee ul { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
.gtee li { padding: 12px 14px; border: 1px solid var(--border); border-radius: 14px; background: var(--surface); min-width: 0; }
.gtee li b { display: block; font-size: 16.5px; line-height: 1.35; }
.gtee .by { display: inline-block; margin: 4px 0 2px; font-size: 13px; font-weight: 650; color: var(--accent); }
.gtee details { margin-top: 2px; font-size: 14.5px; color: var(--muted); }
.gtee summary { cursor: pointer; color: var(--muted); }
.gtee details p { margin: 6px 0 0; }
.gtee a { color: var(--accent); font-weight: 600; text-decoration: none; overflow-wrap: anywhere; }
.gtee .ev { display: block; margin-top: 4px; font-size: 14.5px; }`;

const ext = (href: string) => /^https:\/\//.test(href);
const link = (href: string, label: string) => `<a href="${esc(href)}"${ext(href) ? ' target="_blank" rel="noopener"' : ""}>${esc(label)}${ext(href) ? " ↗" : ""}</a>`;

/** The block: each promise in sight with who enforces it and its evidence; how, the file and the test folded. */
export function guaranteesHtml(rows: readonly Guarantee[] = GUARANTEES): string {
  return `<section class="gtee" id="${GUARANTEES_ID}" aria-labelledby="h-gtee"><h2 id="h-gtee">${icon("shield-check", 20)} ${esc(GUARANTEES_HEADING)}</h2>
<ul>${rows.map((g) => `<li id="${g.id}"><b>${esc(g.promise)}</b><span class="by">${esc(g.by)}</span><span class="ev">${link(g.evidence.href, g.evidence.label)}</span>
<details><summary>${esc("How")}</summary><p>${esc(g.how)}</p><p>${link(`${REPO_BLOB}${g.source}`, g.source)} · ${link(`${REPO_BLOB}${g.test}`, g.test)}</p></details></li>`).join("")}</ul></section>`;
}
