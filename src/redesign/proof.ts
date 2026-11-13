// Proof (mega-prompt v4, C5 and D3; the jury's order, 12 Nov): everything from the played run (the main run, 3 Nov),
// compact. It opens with "What Purser guarantees"; then the three partner cards (Airwallex, Metal, Claude), each with its
// strongest claim as its one link in sight and its live proof folded; then the run's label with its numbers (four tiles:
// decisions by Claude, payments by code, Airwallex's own figure, the stops by cause); then one closed line each for the
// Airi runs, Airwallex read back, every check (who stopped what, the Face ID decisions: one number, from the run's
// ledger), the business and the Archive; the utility links last. Nothing typed in by hand.

import { COUNT_JS } from "./stats.js";
import { LIFE_TITLE, REFUSALS_TITLE, VISUAL_CSS, lifecycleSvg, refusalsSvg } from "../visuals/svg.js";
import { TWO_LOCKS_LOG, airwallexHold, railRefusals } from "../visuals/facts.js";
import { ownersRun, ownersSteps, type OwnersRun } from "./metalOnchain.js";
import { SUMMARY_CSS, detailsFold, type SummaryCard } from "./summary.js";
import { SCALE_CSS, scaleBandHtml, scaleStats } from "./scale.js";
import { VIC3_RUN_FILE, vic3Lead, vic3Run, vic3Summary, type Vic3Record } from "./vic3Run.js";
import { MOTION_JS } from "../ui/motion.js";
import { runTimes, runTimesLine } from "./runTimes.js";
import { REPO_BLOB } from "./metalStory.js";
import { SIGNED_FILES, VERIFY_CSS, VERIFY_TERMS_JS, signedByRun, verifyList } from "./verifyTerms.js";
import { VAULT_TREE_RECORD } from "../vault/treeSvg.js";
import { T0_JOURNAL_RECORD, t0Journal } from "./t0Page.js";
import { whyCompanyHtml } from "./home.js";
import { readFileSync } from "node:fs";
import { CFO_VIEW_LINK, CFO_VIEW_URL, CHAIN_TEST, FILM_LINK, FILM_URL, SECOND_APPROVER, SPLIT_LINE } from "../config/brand.js";
import { agentRun, faceIdDecisions, faceIdLine, family, letThroughOf, ownTap, payments, sandboxRails, runName, split, metalDetail, stopFigure, stopStory, stopSub, stops, stopsLine, tapRun, type AgentRun, type Ev, type RunRecord, type StopStory, type Tile } from "./run.js";
import { AWX_CONTROLS_ID, READBACK_CSS, cardControlRows, cardsReadback, controlsShortHtml, hashBlockHtml, hashTravel } from "./airwallexProof.js";
import { AIRI_CSS, airiRunBlock } from "./airiRun.js";
import { vic2RunBlock } from "./vic2Run.js";
import { awxRunBlock } from "./awxRun.js";
import { esc, icon, page } from "./ui.js";
import { GUARANTEES_CSS, guaranteesHtml } from "./guarantees.js";
import { LEAD_CSS, leadHtml, proofLeads, type Lead } from "./proofLead.js";
import { TRACE_LINK, TRACE_URL } from "./trace.js";
import { PACK_LINK, PACK_NAME } from "../accounting/monthPack.js";

const readJson = <T>(p: string): T => JSON.parse(readFileSync(new URL(`../../${p}`, import.meta.url), "utf8")) as T;
/** "3 Nov": a record's day, as the run's label writes it. */
const shortDay = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(iso));

const CSS = `/* The deep proof, one closed line each (Max, 7 Nov: less text in sight). */
details.deep { margin-top: 14px; border-top: 1px solid var(--border); }
details.deep > summary { cursor: pointer; list-style: none; display: flex; align-items: center; justify-content: space-between; min-height: 56px; font-size: 20px; font-weight: 750; letter-spacing: -.01em; }
details.deep > summary::-webkit-details-marker { display: none; }
details.deep > summary::after { content: "▾"; font-size: 16px; color: var(--accent); } details.deep[open] > summary::after { content: "▴"; }
details.deep h2.sec { display: none; }
.cnote { margin: 12px 0 0; font-size: 13.5px; color: var(--muted); max-width: 60em; }
.clink { margin: 14px 0 0; } .clink a { color: var(--accent); font-weight: 650; text-decoration: none; }
.company { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; max-width: 60em; }
.company li { font-size: 17px; line-height: 1.45; border-left: 3px solid var(--accent); padding-left: 12px; }
.company a { color: var(--accent); font-weight: 600; text-decoration: none; white-space: nowrap; }
details.deep section.band { padding: 8px 0 20px; border-top: 0; } details.deep section.band .wrap { padding: 0; } details.deep .sechead { display: none; }
/* The jury's order (12 Nov): the heading, then the guarantees at once; the partners; the run's label with its numbers. */
.proofp { padding: 18px 0 24px; }
.proofp h1 { font-size: clamp(30px, 3vw, 40px); font-weight: 740; letter-spacing: -.02em; margin: 8px 0 16px; }
.proofp > .wrap { max-width: 1120px; }
.proofp [id] { scroll-margin-top: 80px; }
.runline { margin: 26px 0 10px; }
.split { margin: 0 0 14px; font-size: clamp(17px, 1.8vw, 21px); font-weight: 650; max-width: 46em; }
.nums { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
@media (min-width: 900px) { .nums { grid-template-columns: repeat(4, minmax(0, 1fr)); } }
.num { padding: 14px 16px; text-decoration: none; display: flex; flex-direction: column; gap: 2px; transition: border-color .2s; }
.num:hover { border-color: var(--accent); }
.num .v { font-size: clamp(30px, 3vw, 40px); font-weight: 780; letter-spacing: -.03em; font-variant-numeric: tabular-nums; line-height: 1.05; }
.num .l { font-size: 15px; font-weight: 650; color: var(--muted); line-height: 1.3; }
.num .note, .more p.note, .pcard p.note { font-size: 14px; font-weight: 500; color: var(--muted); line-height: 1.35; margin-top: 4px; }
/* The stops by cause, under their figure: one short line each. */
.num .parts { display: grid; gap: 1px; margin-top: 6px; font-size: 14px; font-weight: 500; color: var(--muted); line-height: 1.35; }
.num .parts b { color: var(--text); font-weight: 700; font-variant-numeric: tabular-nums; }
.num.claude .v { color: var(--claude); } .num.code .v { color: var(--metal); } .num.awx .v { color: var(--awx); } .num.stop .v { color: var(--bad); }
h2.sec { font-size: clamp(22px, 2.2vw, 28px); font-weight: 750; margin: 24px 0 10px; }
.partners { display: grid; gap: 10px; align-items: start; }
@media (min-width: 900px) { .partners { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
/* A partner card, closed: its name, its strongest claim as its one link, and the fold's header in the name's row. */
.pcard { position: relative; padding: 14px 18px; display: flex; flex-direction: column; gap: 6px; }
.pcard .ph { display: flex; align-items: center; gap: 10px; min-height: 28px; }
.pcard .ph .logo { height: 30px; padding: 0 10px; }
.pcard .ph .logo + h3 { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.pcard .ph h3 { font-size: 19px; }
/* The card's main claim reads as a link, the same on all three cards (review 12 Nov): the accent colour, an accent underline. */
.pcard > ul.lead a.c { font-size: 16.5px; color: var(--accent); text-decoration-color: color-mix(in srgb, var(--accent) 45%, transparent); }
.pcard > ul.lead a.c:hover { text-decoration-color: var(--accent); }
.pcard .what { font-size: 16.5px; }
.pcard > details.fold { border-top: 0; padding-top: 0; }
.pcard > details.fold > summary { position: absolute; top: 6px; right: 14px; min-height: 44px; font-size: 15px; }
.pcard > details.fold[open] { border-top: 1px solid var(--border); margin-top: 6px; padding-bottom: 2px; }
.pcard > details.fold > :not(summary) { margin: 10px 0 0; }
.facts { display: flex; flex-wrap: wrap; gap: 6px; }
.fact { font: 650 14px/1.35 Inter, system-ui, sans-serif; padding: 4px 10px; border-radius: 999px; background: var(--sunken); color: var(--text); }
.fact b { font-variant-numeric: tabular-nums; }
.logo { display: inline-flex; align-items: center; height: 34px; padding: 0 12px; border-radius: 10px; background: #fff; border: 1px solid var(--border); flex: none; }
.logo.dark { background: #191919; border-color: #191919; } .logo img { display: block; height: 15px; width: auto; }
.logo.txt { background: var(--surface); color: var(--text); font-weight: 750; font-size: 14px; white-space: nowrap; }
details.fold { border-top: 1px solid var(--border); padding-top: 6px; }
details.fold > summary { cursor: pointer; font-weight: 650; font-size: 15.5px; color: var(--accent); list-style: none; display: flex; align-items: center; gap: 6px; min-height: 44px; }
details.fold > summary::-webkit-details-marker { display: none; }
details.fold > summary::after { content: "▾"; font-size: 14px; }
details.fold[open] > summary::after { content: "▴"; }
ul.pl { list-style: none; margin: 6px 0 4px; padding: 0; display: grid; gap: 8px; }
ul.pl li { font-size: 15.5px; line-height: 1.45; border-left: 3px solid var(--border); padding-left: 11px; overflow-wrap: anywhere; }
ul.pl li.no { border-left-color: var(--bad); } ul.pl li.ok { border-left-color: var(--ok); } ul.pl li.face { border-left-color: var(--accent); }
ul.pl small { display: block; color: var(--faint); font-size: 14px; }
ul.pl code { font: 600 14.5px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; overflow-wrap: anywhere; }
abbr[title] { text-decoration: underline dotted; text-underline-offset: 3px; cursor: help; }
a.pf { color: var(--accent); font-weight: 600; text-decoration: none; font-size: 15px; }
.claim { margin: 0; font-size: 15.5px; line-height: 1.5; border-left: 4px solid var(--accent); padding: 4px 0 4px 12px; }
.open { font-size: 15px; font-weight: 650; color: var(--accent); text-decoration: none; display: inline-flex; align-items: center; gap: 4px; }
.more { display: grid; gap: 12px; }
@media (min-width: 900px) { .more { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
.more .card { padding: 16px 20px; scroll-margin-top: 80px; display: grid; gap: 6px; align-content: start; }
.more h3 { font-size: 18px; margin: 0; display: flex; align-items: center; gap: 8px; }
.more h3 .n { font-variant-numeric: tabular-nums; color: var(--accent); white-space: nowrap; flex: none; }
.more p { margin: 0; color: var(--muted); font-size: 15.5px; }
/* The archive, its own closed line: one link a row. */
#archive ul.pl { margin: 4px 4px 16px; gap: 0; } #archive ul.pl li { border-left: 0; padding-left: 0; }
#archive ul.pl a.pf { display: flex; align-items: center; min-height: 44px; padding-block: 0; }
/* The utility links, last: one quiet row. */
.util { display: flex; flex-wrap: wrap; gap: 0 22px; margin-top: 14px; padding-top: 10px; border-top: 1px solid var(--border); }
.util .open { color: var(--muted); font-weight: 600; min-height: 44px; } .util .open:hover { color: var(--accent); }
${READBACK_CSS}
${AIRI_CSS}
${LEAD_CSS}
/* Tap targets on a phone or a tablet (jury, 12 Nov): every link and every fold header at least 44 px high. A link in a
 * line of text grows by padding above and below, which moves no line; a link or header that is a box gets the height. */
@media (max-width: 899px) {
  :where(.proofp) a { padding-block: 15px; }
  :where(.proofp) summary { min-height: 44px; }
  .proofp .open, .proofp ul.lead .ks a { display: inline-flex; align-items: center; min-height: 44px; padding-block: 0; }
  .proofp ul.lead .ks { gap: 0 14px; }
  /* A link that is a filled pill ("5 of 5 checks pass"): the same pill, inside a clear border that makes up the height. */
  .proofp a.awm { border: solid transparent; border-width: 9px 0; background-clip: padding-box; margin-block: -9px -5px; }
}`;

const JS = `
// A link to a part behind a closed line (#faceid, #airi-run, #archive, say) opens every fold around it, also a fold
// inside a fold, and a card's own folds; then it is scrolled to. On load and when the hash changes (the tiles).
(function () {
  var open = function () {
    var t = location.hash && document.getElementById(location.hash.slice(1));
    if (!t) return;
    for (var d = t; d; d = d.parentElement) if (d.tagName === "DETAILS") d.open = true;
    if (t.classList.contains("card")) t.querySelectorAll("details").forEach(function (x) { x.open = true; });
    (t.getClientRects().length ? t : t.closest("details") || t).scrollIntoView();
  };
  open(); window.addEventListener("hashchange", open);
})();`;

/** Plain words, with the raw code (a refusal code, a proposal id) kept in a tooltip. */
const CODES: [RegExp, (m: RegExpExecArray) => string][] = [
  [/\bmandate_cap_exceeded\b:?/, () => "over the mandate's cap"], [/\bmandate_revoked\b/, () => "old mandate revoked"], [/\bfee_unknown\b/, () => "fee could not be priced"],
  [/\bLIMIT_EXCEEDED\b/, () => "over the card's limit"], [/\bMERCHANT_CATEGORY_NOT_ALLOWED\b/, () => "wrong kind of shop"], [/\bP-0*(\d+)\b/, (m) => `proposal ${m[1]}`],
];
export function plain(text: string): string {
  let out = "", rest = text;
  for (;;) {
    let best: { i: number; m: RegExpExecArray; f: (m: RegExpExecArray) => string } | null = null;
    for (const [re, f] of CODES) { const m = re.exec(rest); if (m && (!best || m.index < best.i)) best = { i: m.index, m, f }; }
    if (!best) return out + esc(rest);
    out += `${esc(rest.slice(0, best.i))}<abbr title="${esc(best.m[0].replace(/:$/, ""))}">${esc(best.f(best.m))}</abbr>`;
    rest = rest.slice(best.i + best.m[0].length);
  }
}
const li = (text: string, tone = "", link?: { label: string; href: string | null } | null, sub?: string) =>
  `<li class="${tone}">${plain(text)}${link ? ` ${link.href ? `<a class="pf" href="${esc(link.href)}" target="_blank" rel="noopener">${esc(link.label)} ↗</a>` : `<small>${plain(link.label)}</small>`}` : ""}${sub ? `<small>${plain(sub)}</small>` : ""}</li>`;
/**
 * The purchase let through to Metal (main run), in one clean line: who refused what, at what price, over which cap,
 * with the code as written; both layers in one line (CHAIN_TEST: Purser refuses first; with that check off once, Metal
 * refused anyway; jury review, 6 Nov, #8). The run's Defense-in-depth label says the same again, so it is not shown
 * beside it (jury review, 7 Nov, #13); it stays in the run's ledger row.
 */
export function letThroughLi(r: RunRecord, e: Extract<Ev, { k: "money" }>, prefix = "Refused by Metal: "): string {
  const cap = letThroughOf(r)?.cap ?? "";
  const link = e.proof.href ? ` <a class="pf" href="${esc(e.proof.href)}" target="_blank" rel="noopener">${esc(e.proof.label)} ↗</a>` : "";
  return `<li class="no">${esc(`${prefix}${e.what} at ${e.amount}${cap ? `, over the cap at the time, ${cap}` : ""} `)}(<code>${esc(e.refused?.code ?? "mandate_cap_exceeded")}</code>); nothing moved.${link}<small>${esc(CHAIN_TEST)}</small></li>`;
}
/** A failed licence attempt and what followed, from the run's ledger: "The first licence transfer (P-0005) was refused …". */
export function earlierLine(e: Extract<Ev, { k: "money" }>): string {
  const id = /\((P-\d+)\)/.exec(e.what)?.[1] ?? "";
  return `The first licence transfer${id ? ` (${id})` : ""} was refused by the sandbox (${e.refused?.code ?? ""}; nothing paid); it is not a limit.${e.retried ? ` It was proposed again as ${e.retried.id}, approved with Face ID and ${e.retried.status || "paid"} at ${e.retried.at.slice(11, 16)} UTC.` : ""}`;
}
/**
 * A planted instruction the record caught, in plain words (jury review, 7 Nov, #14), its count and its document's kind
 * from the record's own reason ("An incoming document (dispute) contains 1 line aimed at the AI; …"). The planted text
 * itself is not repeated. Falls back to the reason without the quote when the record says it another way.
 */
export function plantedLine(reason: string): string {
  const m = /document \(([a-z ]+)\) contains (\d+) lines? aimed at the AI/.exec(reason);
  if (!m) return reason.replace(/: "[\s\S]*$/, "");
  const n = Number(m[2]);
  return n === 1 ? `A line aimed at the AI in the ${m[1]} document was treated as data and changed nothing.` : `${n} lines aimed at the AI in the ${m[1]} document were treated as data and changed nothing.`;
}
/** A separate labelled line below a figure, in its own words (codes kept as written). */
const noteHtml = (note: string | undefined, tag = "p") => (note ? `<${tag} class="note">${esc(note)}</${tag}>` : "");
export const fold = (summary: string, items: string[], open = false) => items.length ? `<details class="fold"${open ? " open" : ""}><summary>${esc(summary)}</summary><ul class="pl">${items.join("")}</ul></details>` : "";
const fact = (v: string, l: string) => `<span class="fact"><b>${esc(v)}</b> ${esc(l)}</span>`;
/** Partner names as text, never a brand logo (Max, 7 Nov: "overal alleen tekst"). */
/**
 * The partner pages' marks (owner, 12 Nov: logos as images, on his stated permission, docs/evidence/logo-permissions.md):
 * the official files in src/ui/logos, unchanged, served as /assets/logo-*; on a white chip (Claude's white letters on a
 * dark one), the name in alt. A mark names a service Purser uses, never an endorsement.
 */
const mark = (file: string, name: string, w: number, dark = false) => `<span class="logo${dark ? " dark" : ""}"><img src="assets/${file}" alt="${name}" width="${w}" height="15"></span>`;
/** /proof's partner cards (owner, 12 Nov: "each partner card with its logo"): the same marks, beside the name (alt empty: the name is the heading). T:0 has no logo file: its name alone. */
const CARD_MARK: Record<string, string> = {
  airwallex: mark("logo-airwallex.png", "", 109), visa: mark("logo-visa.png", "", 46), metal: mark("logo-metal.svg", "", 48), claude: mark("logo-claude.png", "", 69, true),
};
export const LOGO = {
  metal: mark("logo-metal.svg", "Metal", 48),
  airwallex: mark("logo-airwallex.png", "Airwallex", 109),
  claude: mark("logo-claude.png", "Claude", 69, true),
  visa: mark("logo-visa.png", "Visa", 46),
};

/**
 * The live proof of each partner, as list items: shared by Proof's cards and the partner pages. Without `tap`, the
 * separate TAP run's decline is left out of Airwallex's (Max's last round, item 2: on /proof TAP is the footer link only).
 */
export function partnerProof(run: AgentRun, o: { tap?: boolean } = {}): Record<"metal" | "airwallex" | "visa" | "claude", string[]> {
  const s = run.record.snapshot;
  const money = run.events.filter((e): e is Extract<Ev, { k: "money" }> => e.k === "money");
  const tap = tapRun(), own = ownTap(run.record);
  const mandates = run.events.filter((e): e is Extract<Ev, { k: "mandate" }> => e.k === "mandate");
  const tapDecline = o.tap === false ? undefined : tap?.steps.find((x) => !x.approved);
  return {
    metal: [
      ...money.filter((e) => e.refused?.by === "recorded").map((e) => li(`Refused · recorded on chain: ${e.amount} test USD to ${e.what}, ${e.refused!.code ?? ""}. Purser refused it before signing; Metal recorded the same refusal on chain`, "no", e.proof)),
      ...money.filter((e) => e.refused?.by === "metal").map((e) => (e.letThrough ? letThroughLi(run.record, e) : li(`Refused by Metal: ${e.what}, ${e.refused!.reason}; nothing moved`, "no", e.proof.href ? e.proof : null))),
      ...mandates.map((m) => li(`New mandate on chain after two signatures: ${m.agent[0]!.toUpperCase()}${m.agent.slice(1)} agent, cap ${m.cap}, budget ${m.budget}`, "ok", m.proof)),
      ...s.rails.metal.filter((r) => !/^Refused|^Mandate replaced/.test(r.what)).map((r) => li(`${r.what}: ${r.detail}`, "", r.proof)),
    ],
    airwallex: [
      ...sandboxRails(s.rails.airwallex).map((r) => li(`${r.what}: ${r.detail}`, "", r.proof)),
      ...(tapDecline ? [li(`The limit, enforced by Airwallex (${tap!.label}): EUR ${tapDecline.amount} declined, ${tapDecline.reason ?? ""}`, "no", { label: `Airwallex ${tapDecline.txId.slice(0, 8)}… · read back with GET: status ${tapDecline.getStatus}${tapDecline.getStatus === "FAILED" ? " (Airwallex's decline)" : ""}`, href: null })] : []),
      ...money.filter((e) => e.rail === "airwallex" && e.refused?.by === "airwallex-sandbox").map((e) => li(`${earlierLine(e)}`, "no", null)),
    ],
    visa: [
      // The played run's own TAP-signed buy (main run), then the separate TAP run of 2 November, labelled as that run.
      ...(own ? [li(`In this run: the Sourcing agent (${family(own.model)}) bought the ${own.plan} plan at ${own.merchant}, EUR ${own.amount}; our layer verified both TAP signatures (${own.sig1}, ${own.sig2}); the agent's Airwallex card ····${own.last4} was approved by Airwallex`, "ok", { label: `Airwallex ${own.txId.slice(0, 8)}…`, href: null })] : []),
      ...(tap ? tap.steps.map((x) => li(
        `${tap.label}: ${x.model ? `the Sourcing agent (${family(x.model)}) picked the card rail` : "code tried one purchase over the card's limit"}: Visa's reference proxy answered ${x.proxyStatus}, our layer verified both signatures (${x.sig1}, ${x.sig2}); the Airwallex card (brand as Airwallex returns it: ${x.brand}) was ${x.approved ? "approved" : `declined by Airwallex (${x.reason})`}, EUR ${x.amount}`,
        x.approved ? "ok" : "no", { label: `Airwallex ${x.txId.slice(0, 8)}… · read back with GET: ${x.getStatus}`, href: null })) : []),
    ],
    claude: s.agent_stats.map((a) => li(`${a.agent[0]!.toUpperCase()}${a.agent.slice(1)} agent on ${family(a.models[0])}: ${a.by_claude} of ${a.decisions} decisions by Claude, ${a.fallback} ${a.fallback === 1 ? "fallback" : "fallbacks"}, ${a.claude_calls} calls, USD ${(a.cost_usd_micros / 1e6).toFixed(4)}`, "ok")),
  };
}

/**
 * The partner cards (the jury's order, 12 Nov): the name, then the partner's strongest proof as the card's one link in
 * sight, one tap from the partner's own record (the first lead of proofLeads: its numbers from its record); behind the
 * card's fold the two or three numbers, the other claims, one line, the live proof and a link to the partner's page.
 * A partner without a lead shows its fold only.
 */
// ── Visa and T:0 on /proof (owner, 12 Nov: "T:0 and Visa are missing"), each from its own dated run record. ──

/** Visa Intelligent Commerce via Airwallex's Airi, the run of 12 Nov (vic-3): its purchase above the limit, in the record's words. */
export const VIC3_RECORD = VIC3_RUN_FILE;
interface Vic3 { mode: string; label: string; started_at: string; purchases: { step: string; what: string; request?: { amount: string; currency: string }; outcome?: { status?: string; code?: string; by?: string } }[] }
export function vic3(): Vic3 | null {
  try { const r = JSON.parse(readFileSync(new URL(`../../${VIC3_RECORD}`, import.meta.url), "utf8")) as Vic3; return r.mode === "live" ? r : null; } catch { return null; }
}
function visaCardParts(r: Vic3 | null): { lead: Lead[]; what: string; facts: string; items: string[] } | null {
  const b = r?.purchases.find((x) => x.step === "B" && x.outcome?.status === "succeeded" && x.request);
  if (!r || !b?.request) return null;
  const refused = r.purchases.filter((x) => x.outcome?.status === "refused" && /^purser/.test(x.outcome.by ?? "") && x.outcome.code !== "PURSER_NO_TAP");
  const neg = r.purchases.filter((x) => /^F\d$/.test(x.step));
  const guarded = neg.filter((x) => /^PURSER_CREDENTIAL_/.test(x.outcome?.code ?? ""));
  return {
    // One line in sight (owner, 12 Nov); the record's own words for the purchase in the fold.
    lead: [{ text: `${b.request.currency} ${b.request.amount} above the CFO's limit, paid after Face ID`, href: "visa" }],
    what: `Visa Intelligent Commerce via Airwallex's Airi, ${dayOf(r.started_at)}: ${b.request.currency} ${b.request.amount} ${b.what}. ${r.label[0]!.toUpperCase()}${r.label.slice(1)}.`,
    facts: fact(`${b.request.currency} ${b.request.amount}`, "paid after Face ID") + (refused.length ? fact(String(refused.length), "refused by Purser before any Airi call") : ""),
    items: [
      ...(guarded.length ? [li(`A reused credential, our own planted misuse (${guarded.map((x) => x.step).join(", ")}): refused by Purser's credential check before any call to Airi or Airwallex`, "ok")]
        : neg.length ? [li(`Negative test, our own planted misuse (${neg.map((x) => x.step).join(", ")}): not refused by the Airi/Airwallex sandbox; only Purser enforces the binding here`, "no")] : []),
      li("The run record", "", { label: VIC3_RECORD.replace(/\.json$/, ".md"), href: `${REPO_BLOB}${VIC3_RECORD.replace(/\.json$/, ".md")}` }),
    ],
  };
}
function t0CardParts(): { lead: Lead[]; what: string; facts: string; items: string[] } | null {
  let md: string | null = null;
  try { md = readFileSync(new URL(`../../${T0_JOURNAL_RECORD}`, import.meta.url), "utf8"); } catch { /* no record */ }
  const j = t0Journal(md);
  if (!j) return null;
  return {
    lead: [{ text: `${j.posted} journal entries in T:0's ledger, ${j.differences} differences`, href: "t0" }],
    what: `Purser's books of the main run, posted to T:0's shared sandbox entity on ${j.day} and read back line by line. Test data.`,
    facts: fact(String(j.posted), "entries posted") + fact(String(j.differences), "differences") + fact(`${j.debits} USD`, "debits equal credits"),
    items: [li("The run record", "", { label: T0_JOURNAL_RECORD.replace(/^docs\/runs\//, ""), href: `${REPO_BLOB}${T0_JOURNAL_RECORD}` })],
  };
}
const dayOf = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(iso));

export function partnerCards(run: AgentRun, lead: Record<"airwallex" | "metal" | "claude", Lead[]> = proofLeads(run.record)): string {
  const s = run.record.snapshot, p = partnerProof(run, { tap: false }), st = stops(run.record), sp = split(run.record), pay = payments(run.record);
  const money = run.events.filter((e): e is Extract<Ev, { k: "money" }> => e.k === "money");
  const onChain = money.filter((e) => e.rail === "metal" && !e.refused).reduce((n, e) => n + e.count, 0);
  const mandates = run.events.filter((e) => e.k === "mandate").length;
  const awx = money.filter((e) => e.rail === "airwallex" && !e.refused).length;
  // Max, 7 Nov: 2–3 short facts each with its number in bold, no brackets or jargon. Names as text, never a brand logo.
  // In the fold the first claim is not said twice: only its note stays there, or the claim itself when it has links of
  // its own (each card's anchor).
  const visa = visaCardParts(vic3()), t0 = t0CardParts();
  const leads: Record<string, Lead[]> = { ...lead, ...(visa ? { visa: visa.lead } : {}), ...(t0 ? { t0: t0.lead } : {}) };
  // A card from a separate run names its record (data-rec): its figures are that record's, not the main run's.
  const recOf: Record<string, string> = { visa: VIC3_RECORD, t0: T0_JOURNAL_RECORD };
  const card = (id: "metal" | "airwallex" | "claude" | "visa" | "t0", name: string, what: string, facts: string, items: string[], extra = "") => {
    const [first, ...rest] = leads[id] ?? [];
    return `<article class="pcard card" id="${id}"${recOf[id] ? ` data-rec="${recOf[id]}"` : ""}><div class="ph">${CARD_MARK[id] ?? ""}<h3>${esc(name)}</h3></div>${first ? leadHtml([{ text: first.text, href: first.href }]) : ""}<details class="fold"><summary>Show the live proof</summary><div class="facts">${facts}</div>${first?.note && !first.links?.length ? `<p class="note">${esc(first.note)}</p>` : ""}${leadHtml(first?.links?.length ? leads[id]! : rest)}<p class="what">${esc(what)}</p>${extra}${items.length ? `<ul class="pl">${items.join("")}</ul>` : ""}<a class="open" href="${id}">More<span class="vh"> about ${esc(name)}</span> ${icon("arrow-right", 14)}</a></details></article>`;
  };
  const cardsMatch = /^(\d+ of \d+) cards carry the CFO's policy$/.exec(lead.airwallex.find((l) => / cards carry the CFO's policy$/.test(l.text))?.text ?? "");
  // Owner, 12 Nov: Airwallex, Visa, Metal, T:0, Claude (before: in the README's order, jury review, 7 Nov, #12: Airwallex, Metal, Claude). (The signed hash was the Airwallex card's
  // first chip since 7 Nov, #12; it is the card's main link now, from the same two read-backs.)
  return `<div class="partners">
${card("airwallex", "Airwallex", "Earnings booked once final, the euro licence by SWIFT (sandbox, settlement simulated), cards with limits the bank enforces.", fact(String(awx), "movements at Airwallex") + (cardsMatch ? fact(cardsMatch[1]!, "cards carry the CFO's limits") : "") + (st.airwallex ? fact(String(st.airwallex), "declined by Airwallex") : ""), p.airwallex)}
${visa ? card("visa", "Visa", visa.what, visa.facts, visa.items) : ""}
${card("metal", "Metal", "Each agent's limit is a mandate on chain; payments per query over x402.", fact(String(onChain), "payments on chain") + fact(String(st.metal), "refused by Metal at the limit") + fact(String(mandates), "limits replaced on chain"), p.metal, (st.revoked ? `<p class="note">${esc(`${st.revoked} refused by Metal because its mandate had just been replaced.`)}</p>` : "") + (pay.sums && pay.onChain === onChain ? `<p class="note">${esc(`${pay.onChainLine}.`)}</p>` : ""))}
${t0 ? card("t0", "T:0", t0.what, t0.facts, t0.items) : ""}
${card("claude", "Claude", `The agents decide with Claude: ${run.agents.map((a) => `${a.short} on ${a.family}`).join(", ")}.`, fact(`${sp.byClaude}/${sp.decisions}`, "decisions by Claude") + fact(String(s.agent_stats.reduce((n, a) => n + a.claude_calls, 0)), "calls to Claude, each logged"), p.claude)}
</div>`;
}

function moreCards(run: AgentRun): string {
  const r = run.record, s = r.snapshot;
  const money = run.events.filter((e): e is Extract<Ev, { k: "money" }> => e.k === "money");
  const faces = run.events.filter((e): e is Extract<Ev, { k: "face" }> => e.k === "face");
  const story = stopStory(r);
  // Every stop the figure counts, by who stopped it (stopStory), each with its proof where there is one.
  const skipped = s.refusals.filter((x) => x.agent === "sourcing" && /own buy policy/.test(x.reason)).map((x) => /#(\d+)/.exec(x.reason)?.[1]).filter(Boolean).map(Number).sort((a, b) => a - b);
  const range = skipped.length > 1 && skipped[skipped.length - 1]! - skipped[0]! === skipped.length - 1 ? `#${skipped[0]}–#${skipped[skipped.length - 1]}` : skipped.map((n) => `#${n}`).join(", ");
  const stopItems = [
    ...(story.claude ? [li(`By a buy rule Claude set: the Sourcing agent (Claude) set a buy rule; code applied it to ${story.claude} overpriced stock check${story.claude === 1 ? "" : "s"}${range ? ` (${range})` : ""}; nothing signed, the customer not charged`, "no")] : []),
    ...money.filter((e) => e.refused?.by === "recorded").map((e) => li(`By Metal: ${e.amount} test USD over the mandate's cap; Purser refused it before signing and Metal recorded the same refusal on chain`, "no", e.proof)),
    ...money.filter((e) => e.refused?.by === "metal" && e.refused.code !== "mandate_revoked").map((e) => (e.letThrough ? letThroughLi(r, e, "By Metal: ") : li(`By Metal: ${e.what}, ${e.refused!.reason} (${e.refused!.code ?? ""})`, "no", e.proof.href ? e.proof : null))),
    ...money.filter((e) => e.refused?.code === "mandate_revoked").map((e) => li(`By Metal: ${e.what}, refused by Metal's facilitator because its mandate had just been replaced (mandate_revoked; no transaction)`, "no", e.proof.href ? e.proof : null)),
    ...faces.filter((f) => f.status === "REJECTED").map((f) => li(`By the CFO with Face ID: ${f.id} · ${f.title} rejected`, "no")),
    ...s.refusals.filter((x) => /planted instruction/i.test(x.what)).map((x) => li(plantedLine(x.reason), "no")),
  ];
  // One Face ID number from one source (faceIdDecisions): the proposals the CFO decided with the CFO's passkey, from the run's ledger.
  const faceItems = faces.map((f) => li(`${f.id} · ${f.title}: ${f.status === "COSIGNED" ? `1 of 2 signatures, by ${f.signers[0]}` : `${f.status === "REJECTED" ? "rejected" : "approved"} by ${f.signers.join(" and ")}${f.signers.length > 1 ? ` (${f.signers.length} of ${f.signers.length} signatures)` : ""}`}`, "face", null, f.signers.length > 1 ? SECOND_APPROVER : undefined));
  const earlier = money.filter((e) => e.earlier);
  // The red team (final review, 4 Nov: "39/39 attacks failed" read as all prevented): those stopped before anything
  // moved, apart from those found only afterwards; the later run Proof summarises with its scope, the latest linked.
  const rt = readJson<{ ran_at: string; model: string; runs_per_case: number; summary: { runs: number; held: number }; results: { id: string }[] }>("docs/evals/autonomy-redteam.json");
  const red = readJson<{ ran_at: string; attempts: number; results: { caught?: string; title: string }[] }>("docs/redteam/report.json");
  const night = readJson<{ ran_at: string; model: string }>("docs/redteam/night-2026-11-02.json");
  const stoppedBefore = red.results.filter((x) => x.caught === "before").length;
  const after = red.results.filter((x) => x.caught === "after").map((x) => x.title.replace(/^./, (c) => c.toLowerCase()));
  const dayLong = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(iso));
  const t = s.traces.find((x) => x.agent === "support" && x.task.startsWith("dispute"));
  const checked = t ? new Set(t.steps.filter((x) => x.tool === "verify_order").map((x) => JSON.stringify(x.input))).size : 0;
  const refunded = money.filter((e) => e.agent === "support" && /refund/i.test(e.what) && !e.refused).length;
  const box = (id: string, ic: string, h: string, n: string, p: string, inner: string, link?: [string, string]) => `<div class="card" id="${id}"><h3>${icon(ic, 18)}${n ? `<span class="n">${esc(n)}</span>` : ""}${esc(h)}</h3><p>${plain(p)}</p>${inner}${link ? `<a class="open" href="${esc(link[1])}">${esc(link[0])} ${icon("arrow-right", 14)}</a>` : ""}</div>`;
  return `<div class="more">
${box("stops", "ban", stopSub(story), stopFigure(story), `${stopsLine(story)}${story.metal && metalDetail(story) ? ` Metal's ${story.metal}: ${metalDetail(story)}.` : ""}`, fold("Show each one", stopItems))}
${box("faceid", "scan-face", faceIdLine(faceIdDecisions(r), faces.length).label, String(faceIdDecisions(r)), `Proposals the CFO decided on the phone${faces.some((f) => f.status === "COSIGNED") ? "; the mandate change needed a second signature too" : ""}. ${SECOND_APPROVER}`, fold(`Show the ${faces.length} signatures: ${faceIdDecisions(r)} decisions + ${faces.length - faceIdDecisions(r)} co-signature${faces.length - faceIdDecisions(r) === 1 ? "" : "s"}`, faceItems))}
${earlier.length ? box("earlier", "rotate-ccw", "earlier attempt, nothing paid", String(earlier.length), "The sandbox could not price the fee: nothing paid, not a limit.", fold("Show what followed", earlier.map((e) => li(earlierLine(e), "no", { label: e.proof.label, href: null })))) : ""}
${box("dispute", "users", "orders disputed", String(checked), `${checked - refunded} proven valid · ${refunded} wrong data, refunded.`, "", ["Watch the dispute", "watch?scene=2"])}
${box("redteam", "shield-check", "attacks stopped", `${stoppedBefore}/${red.attempts}`, `${after.length ? `${after.length} more detected afterwards, not prevented (${after.join("; ")}). ` : ""}${dayLong(red.ran_at)}, a test world on simulated rails.`, fold("Later runs", [
  li(`${dayLong(rt.ran_at)}, against the agent loop: ${rt.summary.held} of ${rt.summary.runs} runs held (${new Set(rt.results.map((x) => x.id)).size} attacks, ${rt.runs_per_case} runs each; the Sourcing agent on ${family(rt.model)}, simulated rails).`, rt.summary.held === rt.summary.runs ? "ok" : "no"),
  `<li>${esc(`${dayLong(night.ran_at)}, Claude ${family(night.model)} as the attacker:`)} <a class="pf" href="https://github.com/agamemnon-coder/x402-business-agents/blob/main/docs/runs/2026-11-02-night-batch.md#5-red-team-opus-as-the-attacker" target="_blank" rel="noopener">the night batch's report, with what got through ↗</a></li>`,
]))}
${box("health", "database", "audit rows", String(s.audit.rows), `Hash chain ${s.audit.intact ? "intact" : "broken"} (${runName(r)}).`, "", ["Open the CFO dashboard", "./?autonomy"])}
</div>`;
}

/**
 * The Archive, its own closed line at the end of Proof (12 Nov; before: a card inside "Every check"): the replay of the
 * played run first, its name and day from the record, then the earlier runs and tools, kept as they were.
 */
function archiveFold(run: AgentRun): string {
  const links: [string, string][] = [
    ["replay", `Replay of ${run.name}, ${shortDay(run.recordedAt)}`],
    ["./?recorded", "The CFO dashboard of the earlier recorded run (30 October)"], ["metal/report", "The Dispute desk's evidence report (30 October)"],
    ["film", "The earlier animation (30 October)"], ["month", "A month in 90 seconds (simulated)"], ["lab", "The Scenario Lab"],
  ];
  return `<details class="deep" id="archive"><summary>Archive</summary><ul class="pl">${links.map(([href, label]) => `<li><a class="pf" href="${esc(href)}">${esc(label)}</a></li>`).join("")}</ul></details>`;
}

/**
 * The stops by cause, for the stops tile: one part per cause that is not 0, in the sentence's order (stopParts). The
 * parts sum to the story's total, the record's own count: `other` is whatever no cause names, so nothing is hidden.
 */
export function stopBreakdown(st: StopStory): { value: number; label: string }[] {
  return [
    { value: st.claude, label: "by a buy rule Claude set" },
    { value: st.metal, label: "by Metal" },
    { value: st.cfo, label: "by the CFO" },
    { value: st.planted, label: `planted instruction${st.planted === 1 ? "" : "s"} flagged` },
    { value: st.other, label: "other" },
  ].filter((x) => x.value !== 0);
}

/** The finish (Max, 10 Nov: "same level as the homepage"): the run's label as a clear honest tag, each figure with its
 * colour as a top line, the partner cards lifting on hover, the folds as clear rows. Style only; no words change. */
const POLISH = `
.runline .pill.run { background: color-mix(in srgb, var(--awx) 12%, var(--surface)); color: var(--text); border: 1px solid color-mix(in srgb, var(--awx) 40%, var(--border)); font-weight: 650; }
.runline .pill.run .i { color: var(--awx); }
.nums .num { position: relative; overflow: hidden; border-radius: 18px; background: linear-gradient(180deg, color-mix(in srgb, var(--sunken) 60%, var(--surface)), var(--surface) 70%); transition: border-color .2s ease-out, transform .2s ease-out; }
.nums .num::before { content: ""; position: absolute; left: 0; right: 0; top: 0; height: 3px; background: var(--text); opacity: .7; }
.nums .num.claude::before { background: var(--claude); } .nums .num.code::before { background: var(--metal); } .nums .num.awx::before { background: var(--awx); } .nums .num.stop::before { background: var(--bad); }
.nums .num:hover { transform: translateY(-2px); }
.partners .pcard { transition: border-color .2s ease-out, transform .2s ease-out; }
.partners .pcard:hover { border-color: color-mix(in srgb, var(--accent) 45%, var(--border)); transform: translateY(-2px); }
.facts .fact { border: 1px solid var(--border); }
details.deep > summary { padding: 0 4px; border-radius: 12px; }
details.deep > summary:hover { background: var(--sunken); }
details.deep > summary::after { display: grid; place-items: center; width: 28px; height: 28px; border-radius: 50%; background: var(--accent-soft); }
@media (prefers-reduced-motion: reduce) { .nums .num, .partners .pcard { transition: none; } .nums .num:hover, .partners .pcard:hover { transform: none; } }`;

/**
 * Airwallex, read back (section B): the hash the CFO signed beside the one Airwallex returns with the transfer, and each
 * agent's card controls as Airwallex returns them beside the CFO policy, from the dated GET-only records in docs/runs.
 */
export function readBack(run: AgentRun): string {
  const h = hashTravel(run.record), cards = cardsReadback(), rows = cards ? cardControlRows(run.record, cards) : [];
  // awx-1 (7 Nov): the separate Airwallex-only run, dated and labelled, under the main run's read-backs. (The Airi run,
  // Visa Intelligent Commerce, is in sight under the partners since 7 Nov: airiRunBlock in proofPage.)
  const awx1 = awxRunBlock(undefined, { short: true });
  if (!h && !rows.length && !awx1) return "";
  return `<h2 class="sec" id="airwallex-readback">Airwallex, read back</h2>
  <div class="awrb two">${hashBlockHtml(h)}${cards ? controlsShortHtml(rows, cards.rec.read_at, cards.file) : ""}</div>${awx1 ? `
  <div class="awrb">${awx1}</div>` : ""}`;
}

// ── The visuals (owner, 12 Nov: "more visuals and animations"), from src/visuals: one payment's life, animated where
// the viewer allows motion, and the three rails each holding a payment on their own. Their figures are the visuals'
// own records (src/visuals/facts.ts, held by test/visuals.test.ts); the wide drawing on a wide screen, the tall one on a
// phone. Then, folded: each signed approval checked in this browser (src/redesign/verifyTerms.ts) with the Face ID to
// paid times (src/redesign/runTimes.ts), and the vault's folders (docs/media/vault-tree-*.svg, computed from layout.ts).

// On a wide screen the two drawings sit under the guarantees; on a phone they come last, before the utility links, so
// the folds keep their place on the first screens (test/browser/pages.check.ts).
const lifeVisual = (layout: "wide" | "tall") => `<article class="pvis pv-${layout}" data-rec="src/visuals/facts.ts" aria-label="${esc(LIFE_TITLE)}">${lifecycleSvg(layout)}</article>`;
function railsVisual(layout: "wide" | "tall"): string {
  const rails = railRefusals();
  if (!rails.length) return "";
  const href = (path: string) => `${REPO_BLOB}${path}`;
  // One line per card in the drawing; the full account of each, with its figures, in the fold under it.
  const fold = `<details class="fold"><summary>${esc("What each rail did, in full")}</summary><ul>${rails.map((r) => `<li><b>${esc(r.name)}</b>: ${esc(r.what)}${r.note ? ` ${esc(r.note)}` : ""}</li>`).join("")}</ul></details>`;
  return `<article class="pvis pv-${layout} rails" data-rec="src/visuals/facts.ts" aria-label="${esc(REFUSALS_TITLE)}">${refusalsSvg(rails, href, layout)}${fold}</article>`;
}
function checkItYourself(): string {
  const signed = signedByRun();
  const items = ["awx-1", "platform-e2e-1", "main-1"].flatMap((k) => (signed[k] ?? []).filter((x) => x.terms));
  const t = runTimes(), line = runTimesLine(t);
  return `<article class="vfa" data-rec="${esc(Object.values(SIGNED_FILES).join(" "))}"><h3>Check a signature yourself</h3><p class="q">Each button hashes the stored terms here, in your browser, and compares the result with the hash the passkey signed.</p>${verifyList(items)}${line ? `<p class="q">${esc(line)} <a class="pf" href="runs">Every run</a></p>` : ""}</article>`;
}
const vaultTree = () => `<article class="vault" data-rec="${VAULT_TREE_RECORD}"><h3>Where every document is filed</h3><picture><source srcset="assets/vault-tree-dark.svg" media="(prefers-color-scheme: dark)"><img src="assets/vault-tree-light.svg" width="505" height="438" alt="The vault's folders: company, year, quarter, then Inkoopfacturen (invoices), Betalingen (payments) and Rapporten (reports), as src/vault/layout.ts files them"></picture><p class="q">Computed from the code (src/vault/layout.ts), with the two invoices of the 7 November run.</p></article>`;
/** A tile's figure ("24", "3 of 3", "16 stops") with its leading number as a count-up (src/redesign/stats.ts COUNT_JS). */
const countUpValue = (v: string) => {
  const m = /^(\d+)(.*)$/.exec(v);
  return m ? `<span data-count="${m[1]}" data-dec="0">${esc(m[1]!)}</span>${esc(m[2]!)}` : esc(v);
};
const PROOF_VISUAL_CSS = `.proofp .pvis { margin: 18px 0 22px; } .proofp .pvis.pv-tall { display: none; }
@media (max-width: 999px) { .proofp .pvis.pv-wide { display: none; } .proofp .pvis.pv-tall { display: block; max-width: 420px; margin: 18px auto; } }
.proofp .vault img { display: block; max-width: 100%; height: auto; margin: 8px 0; }`;

const dayShortUtc = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${iso.slice(0, 10)}T12:00:00Z`));

/**
 * The four cards at the top of /proof (jury pass, 13 Nov), each from its record; a card whose record is missing drops
 * out. First, Face ID verified on chain: the passkey account on Metal testnet, its co-signer a labelled test key. Then
 * Airwallex's own hold, approved by a person and PAID (12 Nov); the Visa run as it ended for each purchase; and Claude's
 * decisions in the main run.
 */
/** The company a run record names (the main run: Northwind Outdoor), for the labels that say whose run a figure is. */
const companyOf = (run: AgentRun) => { const c = (run.record as { company?: unknown }).company; return typeof c === "string" ? c : ""; };

/** The 13 Nov run with the owner's own iPhone Face ID (review, 13 Nov): where it stands, from its log. */
const FACEID_AWX_LOG = "docs/runs/2026-11-13-airwallex-faceid.md", FACEID_AWX_DAY = "13 Nov";
const FACEID_AWX_REACHED = (() => { try { return /Read back with GET: `(IN_APPROVAL)`/.exec(readFileSync(new URL(`../../${FACEID_AWX_LOG}`, import.meta.url), "utf8"))?.[1] ?? null; } catch { return null; } })();

/**
 * The four cards on /proof (the owner, 13 Nov: "enterprise level"): one structure each, the same height, no icon: the
 * figure, a one-line title, its context (scope and day), and one link to where its record is shown, "Record".
 */
export function proofCardsHtml(cards: SummaryCard[]): string {
  if (!cards.length) return "";
  return `<ul class="sumc" data-look="metric" aria-label="${esc("Proof in four cards")}">${cards.map((c) => `<li${c.tone ? ` class="${c.tone}"` : ""}${c.rec ? ` data-rec="${esc(c.rec)}"` : ""}><a href="${esc(c.href)}"><b class="sc-f">${esc(c.fig)}</b><b class="sc-t">${esc(c.title)}</b><small>${esc(c.text)}</small><span class="sc-l">${esc("Record")} →</span></a></li>`).join("")}</ul>`;
}

export const PROOF_CARDS_CSS = `
ul.sumc[data-look="metric"] { grid-template-columns: repeat(4, minmax(0, 1fr)); grid-auto-rows: 1fr; gap: 12px; margin: 0 0 32px; }
@media (max-width: 1000px) { ul.sumc[data-look="metric"] { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 560px) { ul.sumc[data-look="metric"] { grid-template-columns: 1fr; grid-auto-rows: auto; } }
ul.sumc[data-look="metric"] a { display: flex; flex-direction: column; align-items: stretch; gap: 6px; padding: 18px 18px 16px; border-radius: 14px; }
ul.sumc[data-look="metric"] .sc-f { font-size: 26px; font-weight: 720; letter-spacing: -.02em; }
ul.sumc[data-look="metric"] .sc-t { font-size: 15px; font-weight: 650; line-height: 1.3; }
ul.sumc[data-look="metric"] small { margin: 0; flex: 1; font-size: 13.5px; line-height: 1.45; }
ul.sumc[data-look="metric"] .sc-l { margin-top: 8px; font-size: 13.5px; font-weight: 650; color: var(--accent); }
ul.sumc[data-look="metric"] a:hover .sc-l, ul.sumc[data-look="metric"] a:focus-visible .sc-l { text-decoration: underline; }
`;

export function proofSummary(run: AgentRun, o: { owners?: OwnersRun | null; vic3?: Vic3Record | null } = {}): SummaryCard[] {
  const out: SummaryCard[] = [];
  const owners = o.owners === undefined ? ownersRun() : o.owners;
  if (owners) {
    const steps = ownersSteps(owners.rec), at = steps.findIndex((x) => x.key === "refused");
    const refused = steps[at], paid = steps.slice(at + 1).find((x) => x.key === "paid");
    const virtual = owners.rec.owners.some((x) => x.virtual);
    // Its strongest number (the owner, 13 Nov): the limit changes the account ran, each only after every passkey signed.
    const changes = steps.filter((x) => x.key === "bind" || x.key === "replace" || x.key === "revoke").length;
    if (refused && paid) out.push({ icon: "scan-face", fig: `${changes} changes`, title: "Passkeys (P-256) verified on chain", tone: "ok", href: "metal#faceid-onchain", rec: owners.file,
      text: `Metal testnet, ${dayShortUtc(owners.rec.ran_at)}: each limit change only after ${owners.rec.threshold} of ${owners.rec.owners.length} passkeys signed${virtual ? "; co-signer a test key" : ""}.` });
  }
  const hold = airwallexHold(), ended = hold ? /then ([A-Z_]+)\.$/.exec(hold.short)?.[1] : undefined;
  // Its strongest number: the amount Airwallex held for a person, then paid.
  const held = hold ? /\((EUR [\d,]+\.\d\d)\)/.exec(hold.short)?.[1] : undefined;
  if (hold && ended) out.push({ icon: "landmark", fig: held ?? ended, title: `Held by Airwallex, then ${ended}`, tone: "ok", href: "#airwallex", rec: `${TWO_LOCKS_LOG} ${hold.record} ${FACEID_AWX_LOG}`, text: `Sandbox, ${dayShortUtc(hold.date)}: a test passkey signed in Purser, a person approved at Airwallex.${FACEID_AWX_REACHED ? ` The owner's own iPhone Face ID run (${FACEID_AWX_DAY}) reached ${FACEID_AWX_REACHED}.` : ""}` });
  const v3 = o.vic3 === undefined ? vic3Run() : o.vic3;
  // Its strongest number: the amount paid above the CFO's limit, only after Face ID (the run's other outcomes in the line).
  if (v3) {
    const s3 = vic3Summary(v3), fid = s3.paidFaceId[0]?.request;
    out.push({ icon: "credit-card", fig: fid ? `${fid.currency} ${fid.amount}` : `${s3.paid} paid`, title: "Visa via Airwallex's Airi, after Face ID", href: "visa", rec: VIC3_RUN_FILE, text: `Airwallex sandbox, test card, ${dayShortUtc(v3.started_at)}: ${vic3Lead(v3)}.` });
  }
  const sp = split(run.record);
  if (sp.decisions) out.push({ icon: "bot", fig: `${sp.byClaude}/${sp.decisions}`, title: "Claude decides, code enforces", href: "#claude", rec: run.file, text: `Decisions by Claude in ${run.record.run}${companyOf(run) ? ` (${companyOf(run)})` : ""}; ${sp.fallbacks} ${sp.fallbacks === 1 ? "fallback" : "fallbacks"}.` });
  return out;
}

export function proofPage(run: AgentRun = agentRun()): string {
  const r = run.record, sp = split(r), story = stopStory(r), pay = payments(r);
  // The Airi runs (7 Nov): Visa Intelligent Commerce via Airwallex's Airi, short: its outcomes and checks, then a link
  // to every id on /airwallex. In sight under the partners from 7 Nov; behind the first closed line since 12 Nov (the
  // jury's order and half the height on a phone); guarantee 3, at the top, links the Airi run on /visa.
  const airi = airiRunBlock(undefined, { short: true }) + vic2RunBlock(undefined, { short: true });
  // Airwallex's own figure (jury, 12 Nov): the agent cards whose controls, as Airwallex returns them, are the CFO's
  // policy (cardControlRows, from the dated read-back); without that read-back, the run's movements at Airwallex.
  const cards = cardsReadback(), rows = cards ? cardControlRows(r, cards) : [];
  const moved = run.events.filter((e) => e.k === "money" && e.rail === "airwallex" && !e.refused).length;
  // Four tiles. The Face ID decisions stay one number under #faceid ("Every check"), where guarantee 1 links.
  const nums: (Tile & { cls: string })[] = [
    { cls: "claude", value: String(sp.byClaude), label: `decisions by Claude (${sp.fallbacks} fallbacks)`, explain: "", href: "#claude" },
    // Second, so that on a phone the two short tiles share a row and the two with lines under them share the next.
    rows.length
      ? { cls: "awx", value: `${rows.filter((x) => x.match).length} of ${rows.length}`, label: "cards carry the CFO's policy as Airwallex's own controls", explain: "", href: `airwallex#${AWX_CONTROLS_ID}` }
      : { cls: "awx", value: String(moved), label: "movements at Airwallex", explain: "", href: "#airwallex" },
    // One canonical set (jury review, 6 Nov, #5): "86 Metal payments + 1 card charge", never 82 or 87 beside it.
    { cls: "code", value: String(pay.onChain), label: pay.canonical.replace(/^\d+ /, ""), explain: "", href: "#metal", ...(pay.sums ? { note: `${pay.metalParts} on Metal, all inside the limits.` } : {}) },
    // The stops by cause, summing to the figure (stopBreakdown). No TAP remark under the figures: TAP is on /visa.
    { cls: "stop", value: stopFigure(story), label: stopSub(story), explain: "", href: "#stops", parts: stopBreakdown(story).map((x) => ({ value: String(x.value), label: x.label })) },
  ];
  const tile = (n: Tile & { cls: string }) => `<a class="num card ${n.cls}" href="${esc(n.href)}"><span class="v">${countUpValue(n.value)}</span><span class="l">${esc(n.label)}</span>${noteHtml(n.note, "span")}${n.parts?.length ? `<span class="parts">${n.parts.map((x) => `<span><b>${esc(x.value)}</b> ${esc(x.label)}</span>`).join("")}</span>` : ""}</a>`;
  // Jury pass, 13 Nov: four cards, then everything else in one fold (far less visible text). Jury, 13 Nov (second round):
  // the first screen was too thin, so the guarantees are in sight again, under the cards; the rest stays folded.
  // The owner, 13 Nov: the scale first, a band of figures computed from the records (src/redesign/scale.ts).
  const body = `<main class="proofp"><div class="wrap">
  <h1>Proof</h1>
  ${scaleBandHtml(scaleStats(), "What ran, in numbers", { strip: true })}
  ${proofCardsHtml(proofSummary(run))}
  ${guaranteesHtml()}
  ${detailsFold("details", "All the proof: partners, numbers and every check", `${lifeVisual("wide")}
  ${railsVisual("wide")}
  <h2 class="sec">The partners</h2>
  ${partnerCards(run)}
  <div class="runline"><span class="pill run">${icon("database", 14)}${esc(run.label)}</span></div>
  <p class="split">${esc(SPLIT_LINE)}</p>
  <div class="nums">${nums.map(tile).join("")}</div>
  ${airi ? `<details class="deep"><summary>Visa Intelligent Commerce via Airwallex's Airi</summary><div class="awrb">${airi}</div></details>` : ""}
  <details class="deep"><summary>Airwallex, read back</summary>${readBack(run)}</details>
  <details class="deep"><summary>Every check</summary>${checkItYourself()}${moreCards(run)}</details>
  <details class="deep"><summary>Why this is a company</summary>${vaultTree()}${whyCompanyHtml()}</details>
  ${archiveFold(run)}
  ${lifeVisual("tall")}
  ${railsVisual("tall")}`)}
  <nav class="util" aria-label="More from this run"><a class="open" href="${FILM_URL}" target="_blank" rel="noopener">${icon("play", 14)}${esc(FILM_LINK)} ↗</a><a class="open" href="${CFO_VIEW_URL}">${icon("layout-dashboard", 14)}${esc(CFO_VIEW_LINK)}</a><a class="open" href="${TRACE_URL}">${icon("receipt", 14)}${esc(TRACE_LINK)}</a><a class="open" href="assets/${PACK_NAME}" download>${icon("file-check", 14)}${esc(PACK_LINK)}</a></nav>
</div></main>`;
  // No footer link to /visa since 12 Nov (before: "Extra, not an award entry", jury review, 6 Nov, #7): Visa is a
  // section of its own now ("Built on", the Airi run's fold); Home drops it too.
  return page({
    title: "Purser · Proof", description: "What Purser guarantees, each promise with who enforces it and its evidence, then each partner's strongest proof and the main run's numbers.", tab: "proof", css: CSS + GUARANTEES_CSS + POLISH + VISUAL_CSS + PROOF_VISUAL_CSS + VERIFY_CSS + SUMMARY_CSS + SCALE_CSS + PROOF_CARDS_CSS, body, js: `${JS}\n${VERIFY_TERMS_JS}\n${MOTION_JS}\n${COUNT_JS}`, stage: false,
    source: `Source: ${run.file} (${run.name}) and the run records in docs/runs and docs/evals.`,
  });
}
