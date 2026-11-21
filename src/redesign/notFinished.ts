// "What is not finished" and the judges' security questions (review, 21 Nov: a judge, a business owner, partners and a
// data reviewer asked for the limits in one place, and for short answers to the questions they asked that no page
// answered). Five lines, the same on /security (section #not-finished, which /proof links) and in the README and
// JUDGES.md (test/not-finished.test.ts holds them equal); the answers on /security (#judge-questions). Each line says
// only what a record or a doc says: the red team's figure is read from its record; the ASVS line is the doc's own words.

import { readFileSync } from "node:fs";
import { outLink, repoHref, repoText } from "./productPage.js";
import { esc, icon } from "./ui.js";

/** The anchor on /security that /proof links to: security#not-finished. */
export const NOT_FINISHED_ID = "not-finished";
export const NOT_FINISHED_TITLE = "What is not finished";
export const GO_LIVE_DOC = "docs/go-live.md";
export const ASVS_DOC = "docs/security/asvs-l2.md";
/** The ASVS doc's own first words, which the line and the answer below rest on; a doc that no longer says them is an error. */
export const ASVS_SAYS = "A self-assessment, not a certification and not an audit.";
export const RED_TEAM_RECORD = "docs/redteam/rerun-2026-11-20.json";

/** The five lines, as plain text (the README and JUDGES.md carry them with their links). */
export const NOT_FINISHED: readonly { id: string; line: string; doc?: string }[] = [
  { id: "review", line: "No independent security review yet: the OWASP ASVS Level 2 assessment is a self-assessment, and no third party has tested its security.", doc: ASVS_DOC },
  { id: "money", line: "No production money: the Airwallex sandbox, Alta testnet and Airi's test card only; test money throughout." },
  { id: "approver", line: "No second human approver yet: one CFO passkey signs; where a run shows a second approver, it is simulated (a labelled test passkey)." },
  { id: "customers", line: "No customers: no pilots and no revenue yet." },
  { id: "go-live", line: "Before real money: every go-live requirement, with where it stands, is in docs/go-live.md.", doc: GO_LIVE_DOC },
];

/** The red team's newest full re-run, as its record has it. */
export function redTeamRerun(): { attempts: number; blocked: number; day: string; model: string | null } {
  const r = JSON.parse(readFileSync(new URL(`../../${RED_TEAM_RECORD}`, import.meta.url), "utf8")) as { attempts: number; blocked: number; ran_at: string; model: string | null };
  return { attempts: r.attempts, blocked: r.blocked, day: new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(r.ran_at)), model: r.model };
}

/** The judges' security questions, each answered in a few sentences from what is built and recorded. */
export function judgeQuestions(): { id: string; q: string; a: string; links: [string, string][] }[] {
  if (!repoText(ASVS_DOC).includes(ASVS_SAYS)) throw new Error(`${ASVS_DOC} no longer says: ${ASVS_SAYS}`);
  const rt = redTeamRerun();
  const all = rt.blocked === rt.attempts ? `all ${rt.attempts}` : `${rt.blocked} of ${rt.attempts}`;
  return [
    { id: "bypass", q: "Can an agent bypass Purser?", a: "Only routes connected to Purser are protected. An agent pays through the routes Purser governs (the company's Airwallex account, through Purser, and the agents' Alta mandates); a wallet, card or key it can reach outside Purser is not governed by it.", links: [[repoHref("docs/security.md"), "The threat model"]] },
    { id: "asvs", q: "Are you ASVS Level 2 certified?", a: `No: the document is ${ASVS_SAYS.charAt(0).toLowerCase()}${ASVS_SAYS.slice(1)} Claude wrote it for the maintainer from the code, and nobody independent has verified it.`, links: [[repoHref(ASVS_DOC), ASVS_DOC]] },
    { id: "redteam", q: `What does "${all} attacks stopped" mean?`, a: `The red team's re-run of ${rt.day}: our own scripted attacks, ${rt.model ? `with ${rt.model}` : "with no model"}, in a throwaway test world. ${all.charAt(0).toUpperCase()}${all.slice(1)} were stopped before anything moved. It is an internal test, not an independent penetration test.`, links: [[repoHref(RED_TEAM_RECORD), "The record"]] },
    { id: "cent", q: "What does the one-cent test prove, and what not?", a: "It proves that an approval signed over one set of terms is refused for any other: the amount changed by one cent after the CFO signed, refused on the signed hash before any transfer was made (test money, on /try). It does not prove who holds the passkey, that it was Face ID, or anything about a route outside Purser.", links: [["verify", "Check a proof file"]] },
  ];
}

export const NOT_FINISHED_CSS = `.nf { border-left: 4px solid var(--warn, #b54708); } .nf ul { margin: 6px 0 0; padding-left: 18px; display: grid; gap: 4px; }
.jq { display: grid; gap: 8px; } .jq details { border: 1px solid var(--border); border-radius: 12px; padding: 10px 12px; } .jq summary { font-weight: 650; cursor: pointer; }
.jq p { margin: 6px 0 0; }`;

/** /security's section: the five lines, then the judges' questions. */
export function notFinishedHtml(): string {
  const line = (x: (typeof NOT_FINISHED)[number]) => `<li id="nf-${x.id}">${esc(x.line)}${x.doc ? ` ${outLink(repoHref(x.doc), x.doc)}` : ""}</li>`;
  const qs = judgeQuestions().map((f) => `<details id="jq-${f.id}"><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p><div class="links">${f.links.map(([h, l]) => (/^https:/.test(h) ? outLink(h, l) : `<a href="${esc(h)}">${esc(l)} →</a>`)).join("")}</div></details>`).join("");
  return `<article class="pc card fd nf" id="${NOT_FINISHED_ID}"><h2><span class="ic">${icon("clock", 19)}</span>${esc(NOT_FINISHED_TITLE)}</h2><ul>${NOT_FINISHED.map(line).join("")}</ul></article>
<section class="jq" id="judge-questions" aria-labelledby="jq-h"><h2 id="jq-h">${esc("Questions judges ask")}</h2>${qs}</section>`;
}

/** The README's and JUDGES.md's block: the title in bold and the five lines, the docs linked relative to `base`. */
export function notFinishedMarkdown(base = ""): string {
  const md = (x: (typeof NOT_FINISHED)[number]) => (x.doc ? x.line.replace(new RegExp(`\\b${x.doc.replace(/[./]/g, "\\$&")}\\b`), `[${x.doc}](${base}${x.doc})`) + (x.line.includes(x.doc) ? "" : ` ([${x.doc}](${base}${x.doc}))`) : x.line);
  return [`**${NOT_FINISHED_TITLE}:**`, "", ...NOT_FINISHED.map((x) => `- ${md(x)}`)].join("\n");
}
