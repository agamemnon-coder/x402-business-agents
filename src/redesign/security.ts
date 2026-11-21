// /security, "Security and trust". Since 21 Nov (the owner: "we still have a lot of old things on the new page"): only
// what is current. Top to bottom: the architecture with its controls, each linked to its code (./securityArch.ts);
// "What we did, with evidence", each figure from its committed record (./securityEvidence.ts: the zero-trust harness and
// the hostile model are items there now); the limits of this build ("If the approver is unavailable", in the doc's own
// words, and "Not yet"); the CI checks (./ciChecks.ts).
// Removed on 21 Nov, as superseded or said twice: the layers diagram and its two charts (the architecture and the
// evidence show the same, newer), the eleven control cards (each control is on the architecture now, with its code), and
// the red team's rounds of 30 Oct, 31 Oct and 2 Nov (red team v2, 19 Nov, is the evidence item). Review, 21 Nov: "What is
// not finished" and the judges' questions (./notFinished.ts, #not-finished, which /proof links). Nothing here is typed in:
// a doc that no longer says a quoted line is an error, never a guess. No script.

import { existingDoc, foldHtml, outLink, productPage, repoHref, repoText } from "./productPage.js";
import { esc, icon } from "./ui.js";
import { CI_CSS, ciChecksHtml } from "./ciChecks.js";
import { ARCH_CSS, archHtml } from "./securityArch.js";
import { EVIDENCE_CSS, evidenceHtml, evidenceItems, securityEvidence, type EvGroup } from "./securityEvidence.js";
import { NOT_FINISHED_CSS, notFinishedHtml } from "./notFinished.js";

export { existingDoc };

/** A doc as running text: bold and code marks out and line breaks as spaces, so a sentence wrapped over lines reads as one. */
const flat = (path: string) => repoText(path).replace(/\*\*|`/g, "").replace(/\s+/g, " ");

/** A sentence a doc says, word for word; `about`, in our words, says what it is about where the quote alone does not. Throws when the doc no longer says it. */
export interface DocLine { doc: string; anchor: string; quote: string; about?: string }
export function docLine(l: DocLine): DocLine {
  if (!flat(l.doc).includes(l.quote)) throw new Error(`${l.doc} no longer says: ${l.quote}`);
  return l;
}
const quoted = (l: DocLine) => `${l.about ? `${esc(l.about)} ` : ""}“${esc(docLine(l).quote)}” ${outLink(repoHref(l.doc, l.anchor), l.doc)}`;

/** The "Not yet" line, and the docs' own sentences behind each part of it. */
export const NOT_YET_LINE = "No SOC 2 report, no ISO 27001 audit and no third-party penetration test yet; sandbox and testnet only; Purser's independent security review is pending.";
export const NOT_YET_SOURCES: readonly DocLine[] = [
  { doc: "docs/security.md", anchor: "#checks", quote: "No third-party penetration test has been run" },
  { doc: "docs/controls.md", anchor: "", quote: "This is not a SOC 2 report: no auditor has tested these controls, and the build runs on the Airwallex sandbox and Alta testnet only." },
  { doc: "docs/cloud.md", anchor: "#before-real-customer-data", about: "The SME product, still to do before real customer data:", quote: "An independent security review of this code after these fixes, and a red-team run against a deployed staging copy." },
];
export const NOT_IN_PLACE = { doc: "docs/controls.md", anchor: "#not-in-place-summary" };
/** The full matrix behind the page: each risk, its control, who enforces it, its test and its evidence. */
export const CONTROLS_MATRIX = "docs/controls-matrix.md";

/**
 * "If the approver is unavailable" (the panel's review, 12 Nov): what happens when the approver is away or loses the
 * phone, and who may enrol a new passkey. docs/security.md's section of that name, at most five lines, shown in the doc's
 * own words. `id` is the anchor other pages link to (security#unavailable: guarantee 1 on /proof).
 */
export const UNAVAILABLE = { id: "unavailable", doc: "docs/security.md", heading: "If the approver is unavailable", anchor: "#if-the-approver-is-unavailable" } as const;
/**
 * The section's lines, in the doc's order and words: bold and code marks out, and without the files and commands each
 * line names in brackets at its end (the doc keeps them; the page links the doc). Not one to five numbered lines, each
 * ending with what it cites: an error.
 */
export function unavailableLines(text: string = repoText(UNAVAILABLE.doc)): string[] {
  const body = new RegExp(`^## ${UNAVAILABLE.heading}\\n\\n([\\s\\S]*?)\\n(?=## |$(?![\\s\\S]))`, "m").exec(text)?.[1] ?? "";
  const lines = body.split("\n").filter((l) => l.trim());
  if (lines.length < 1 || lines.length > 5 || lines.some((l) => !/^\d\. \S[^\n]*[.!?] \(`[^\n]*\)$/.test(l))) throw new Error(`${UNAVAILABLE.doc}: "${UNAVAILABLE.heading}" must answer in one to five numbered lines, each ending with the files it cites`);
  return lines.map((l) => l.replace(/^\d\. /, "").replace(/ \(`[^\n]*\)$/, "").replace(/\*\*|`/g, "").trim());
}

/** What the attack tests ran on, in the footer's "What's real?". */
export const HARNESS_LINE = "Every attack ran in this repository's test harness: Purser's own code is the real code; Airwallex, Alta, the model and the phones are simulated. Nothing here attacked a live rail.";
/** What the architecture drawing is, in the footer's "What's real?". */
export const ARCH_REAL_LINE = "How a payment is guarded is a schematic: its moving dots illustrate one payment, they are not a recording; the evidence items below it link the runs.";

/**
 * The line under the heading (21 Nov): the three newest attack tests, each figure as its evidence item shows it, read
 * from the same records (./securityEvidence.ts).
 */
export function securityLead(groups: EvGroup[] = securityEvidence()): string {
  const by = (id: string) => {
    const it = evidenceItems(groups).find((x) => x.id === id);
    if (!it) throw new Error(`/security: no evidence item ${id}`);
    return it;
  };
  const zt = by("e-zerotrust"), rt = by("e-redteam");
  return `Five layers that do not trust each other. Attacked on purpose: ${zt.fig.toLowerCase()} attacks on the payment path stopped, ${rt.fig.toLowerCase()} attacks on the public API held.`;
}

export const SECURITY_CSS = `.sec-lim { display: grid; gap: 12px; grid-template-columns: minmax(0, 1fr); }
@media (min-width: 800px) { .sec-lim { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
.sec-lim .pc p { font-size: 15.5px; }
.sec-lim .pc.notyet-c { border-left: 4px solid var(--warn, #b54708); }`;

/** The limits of this build: when the approver is away (the doc's lines), and what is not in place yet. */
export function limitsHtml(): string {
  const away = unavailableLines().map((quote) => esc(docLine({ doc: UNAVAILABLE.doc, anchor: UNAVAILABLE.anchor, quote }).quote));
  return `<div class="sec-lim">
  <article class="pc card fd" id="s-away"><h2><span class="ic">${icon("scan-face", 19)}</span>${esc("When the approver is away")}</h2>
    <p>${esc("Nothing above the limits is paid without a signature; payments inside the limits go on.")}</p>
    ${foldHtml(UNAVAILABLE.heading, [...away, outLink(repoHref(UNAVAILABLE.doc, UNAVAILABLE.anchor), UNAVAILABLE.doc)]).replace('<details class="fold">', `<details class="fold" id="${UNAVAILABLE.id}">`)}</article>
  <article class="pc card fd notyet-c" id="s-notyet"><h2><span class="ic">${icon("clock", 19)}</span>${esc("Not yet")}</h2>
    <p>${esc(NOT_YET_LINE)}</p>
    ${foldHtml("Sources", [...NOT_YET_SOURCES.map(quoted), outLink(repoHref(NOT_IN_PLACE.doc, NOT_IN_PLACE.anchor), "What is not in place")])}</article>
</div>`;
}

export function securityPage(): string {
  const groups = securityEvidence();
  return productPage({
    key: "security", title: "Security and trust", h1: "Security and trust", label: "Sandbox and testnet only",
    lead: securityLead(groups),
    description: "How Purser guards company money: five layers and their controls, each linked to its code; what we did to break it, each with its record; the CI checks; and what is not in place yet. Sandbox and testnet only.",
    css: ARCH_CSS + EVIDENCE_CSS + CI_CSS + SECURITY_CSS + NOT_FINISHED_CSS,
    body: `<div class="links">${outLink(repoHref(CONTROLS_MATRIX), "Every risk, its control and its test")}</div>\n${archHtml()}\n${evidenceHtml(groups)}\n${limitsHtml()}\n${notFinishedHtml()}\n${ciChecksHtml()}`,
    source: "Source: docs/evidence/evidence-wall.json and the records each evidence item links, docs/zero-trust/report.json, and the docs each fold names.",
    real: [
      "Sandbox and testnet only: Airwallex's sandbox, Alta's testnet, test money.",
      HARNESS_LINE,
      ARCH_REAL_LINE,
      NOT_YET_LINE,
    ],
  });
}
