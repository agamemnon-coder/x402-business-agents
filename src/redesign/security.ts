// /security, "Security and trust". Since 21 Nov, later (Max: "security page is still not upgraded"), in /proof's
// design language: the hero over the site's wave (src/ui/wave.ts) with one strong line and four figures, each a link to
// its record; how a payment is guarded, the trust boundaries with each control linked to its code (./securityArch.ts);
// six categories (./securityCategories.ts: approval, limits, agents and keys, money, testing, data), each one line, its
// figures as tiles (every item of ./securityEvidence.ts and a few of the evidence wall's tiles, each read from its
// record), its controls as chips and its depth folded; the limits of this build last ("Not yet" and "What is not
// finished", ./notFinished.ts, #not-finished, which /proof links). "If the approver is unavailable" is the approval
// category's fold (#unavailable). Nothing here is typed in: a doc that no longer says a quoted line is an error, never a
// guess. One script: the wave.

import { PRODUCT_CSS, existingDoc, foldHtml, outLink, repoHref, repoText } from "./productPage.js";
import { esc, icon, page } from "./ui.js";
import { ARCH_CSS, archHtml } from "./securityArch.js";
import { EV_TAG_WORDS, evidenceItems, itemHref, securityEvidence, type EvGroup } from "./securityEvidence.js";
import { CATEGORIES_CSS, categoriesHtml, categoryNavHtml, securityCategories, type SecCategory } from "./securityCategories.js";
import { NOT_FINISHED_CSS, notFinishedHtml } from "./notFinished.js";
import { picon } from "./proofIcons.js";
import { waveScript } from "../ui/wave.js";

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

/** The four figures in the hero, each an evidence item of the page (its id), in this order. */
export const HERO_ITEMS: readonly { id: string; icon: string; label?: string }[] = [
  { id: "e-zerotrust", icon: "layers", label: "attacks on the payment path stopped" },
  { id: "c-try-cent", icon: "cent", label: "one-cent changes refused after approval" },
  { id: "e-redteam", icon: "shield", label: "attacks on the /try API held" },
  { id: "c-dafny", icon: "badge-check", label: "Dafny proof obligations verified, 0 errors" },
];
export const SECURITY_H1 = "Security and trust";

/** The hero: the wave behind it, the label, the heading, the lead (its first sentence the strong line), four figures. */
export function heroHtml(lead: string, cs: SecCategory[]): string {
  const all = cs.flatMap((c) => c.items);
  const stats = HERO_ITEMS.map((h) => {
    const i = all.find((x) => x.id === h.id);
    if (!i) throw new Error(`/security: no figure ${h.id} for the hero`);
    return { ...h, i };
  });
  const cut = lead.indexOf(". ") + 1;
  const li = ({ icon: ic, label, i }: (typeof stats)[number]) => `<li data-stat="${esc(i.id)}" data-rec="${esc(i.rec)}"><a href="${esc(itemHref(i))}" target="_blank" rel="noopener"><span class="sxs-ic" aria-hidden="true">${picon(ic, 22)}</span><span class="sxs-t"><b class="sxs-f">${esc(i.fig)}</b><span class="sxs-l">${esc(label ?? i.label)}</span><span class="sxs-k">${esc(EV_TAG_WORDS[i.tag])}</span></span></a></li>`;
  return `<section class="sxh" aria-labelledby="sxh-h">
<canvas class="sx-wave" aria-hidden="true"></canvas>
<div class="wrap">
<p class="sxh-pill"><span class="pill note">${icon("info", 14)}${esc("Sandbox and testnet only")}</span>${outLink(repoHref(CONTROLS_MATRIX), "Every risk, its control and its test")}</p>
<h1 id="sxh-h">${esc(SECURITY_H1)}</h1>
<p class="lead"><b class="sx-strong">${esc(lead.slice(0, cut))}</b> <span>${esc(lead.slice(cut + 1))}</span></p>
<ul class="sxstats" aria-label="${esc("Four figures from the records")}">${stats.map(li).join("")}</ul>
</div>
</section>`;
}

/** The wave behind the heading: few points, quiet (as on /proof). */
export const SECURITY_WAVE_JS = waveScript({ selector: "canvas.sx-wave", placement: "hero", density: 0.5, intensity: 0.7 });

export const SECURITY_CSS = `main.secp { padding: 0 0 24px; }
.secp .wrap { max-width: 1240px; }
.secp > .wrap { display: grid; gap: 18px; }
.secp [id] { scroll-margin-top: 120px; }
.secp > section.sxh { position: relative; isolation: isolate; overflow: hidden; padding: 30px 0 26px; }
.sxh::before { content: ""; position: absolute; inset: 0; z-index: -2; pointer-events: none; -webkit-mask-image: linear-gradient(180deg, #000 60%, transparent); mask-image: linear-gradient(180deg, #000 60%, transparent); background:
  radial-gradient(50% 70% at 82% 0%, color-mix(in srgb, var(--accent) 20%, transparent), transparent 70%),
  radial-gradient(35% 60% at 8% 100%, color-mix(in srgb, var(--accent-ink) 12%, transparent), transparent 70%); }
canvas.sx-wave { position: absolute; inset: 0; z-index: -1; width: 100%; height: 100%; pointer-events: none; opacity: .55;
  -webkit-mask-image: linear-gradient(180deg, transparent 0%, #000 30%, #000 70%, transparent 100%); mask-image: linear-gradient(180deg, transparent 0%, #000 30%, #000 70%, transparent 100%); }
@media (prefers-color-scheme: light) { :root:not([data-theme="dark"]) canvas.sx-wave { opacity: .3; } }
:root[data-theme="light"] canvas.sx-wave { opacity: .3; }
.sxh-pill { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 16px; margin: 0; }
.sxh-pill a.pf { min-height: 44px; }
.sxh h1 { font-size: clamp(38px, 4.4vw, 60px); font-weight: 780; letter-spacing: -.03em; line-height: 1.02; margin: 6px 0 10px; }
.sxh .lead { margin: 0 0 22px; max-width: 44em; font-size: clamp(16px, 1.4vw, 18.5px); line-height: 1.5; color: var(--muted); }
.sxh .lead .sx-strong { display: block; margin-bottom: 4px; font-size: clamp(20px, 2vw, 26px); font-weight: 720; letter-spacing: -.015em; line-height: 1.25; color: var(--text); }
ul.sxstats { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; }
ul.sxstats a { display: flex; align-items: center; gap: 16px; min-height: 44px; height: 100%; box-sizing: border-box; padding: 18px 20px; border: 1px solid var(--glass-line, var(--border)); border-radius: 18px;
  background: linear-gradient(180deg, color-mix(in srgb, var(--surface) 86%, transparent), color-mix(in srgb, var(--surface) 70%, transparent)); -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px);
  color: inherit; text-decoration: none; box-shadow: var(--hi, none); transition: border-color .2s, transform .2s; }
ul.sxstats a:hover, ul.sxstats a:focus-visible { border-color: color-mix(in srgb, var(--accent) 55%, var(--border)); transform: translateY(-1px); }
.sxs-ic { flex: none; display: grid; place-items: center; width: 52px; height: 52px; border-radius: 14px; background: var(--accent-soft); color: var(--accent); }
.sxs-t { display: flex; flex-direction: column; align-items: flex-start; gap: 3px; min-width: 0; }
.sxs-f { font-size: clamp(26px, 2.3vw, 34px); font-weight: 780; letter-spacing: -.025em; line-height: 1.05; font-variant-numeric: tabular-nums; }
.sxs-l { font-size: 14.5px; line-height: 1.35; color: var(--muted); }
.sxs-k { font-size: 14px; font-weight: 650; color: var(--accent); }
@media (max-width: 1100px) { ul.sxstats { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 560px) {
  .secp > section.sxh { padding: 16px 0 14px; }
  .sxh h1 { margin: 2px 0 8px; }
  .sxh .lead { margin-bottom: 16px; }
  ul.sxstats { gap: 8px; }
  ul.sxstats a { flex-direction: column; align-items: flex-start; gap: 8px; padding: 12px; border-radius: 14px; }
  .sxs-ic { width: 38px; height: 38px; border-radius: 11px; } .sxs-ic svg { width: 18px; height: 18px; }
  .sxs-f { font-size: 24px; } .sxs-l { font-size: 14px; }
}
.sc-legend { margin: -6px 0 0; font-size: 14px; line-height: 1.45; color: var(--muted); }
/* The limits of this build, last: what is not in place, and what is not finished. */
.sec-lim { display: grid; gap: 16px; grid-template-columns: minmax(0, 1fr); align-items: stretch; }
@media (min-width: 1000px) { .sec-lim { grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr); } }
.sec-lim > .card { margin: 0; }
.sec-lim .pc p { font-size: 15.5px; }
.sec-lim .pc.notyet-c, .sec-lim .nf { border-left: 4px solid var(--warn, #b54708); }
.sec-lim .nf { padding: 20px; display: flex; flex-direction: column; gap: 6px; }
.sec-lim .nf h2 { font-size: 17px; font-weight: 700; } .sec-lim .nf h2 .ic { width: 36px; height: 36px; border-radius: 11px; display: grid; place-items: center; background: var(--sunken); color: var(--accent); flex: none; }
.sec-lim .nf ul { font-size: 15.5px; line-height: 1.45; }
.sec-lim .nf details.jq { margin-top: auto; }
.sec-lim .nf .jq details { margin-top: 6px; } .sec-lim .nf .jq summary { min-height: 44px; display: flex; align-items: center; }`;

/** The limits of this build: what is not in place yet (with its sources), and what is not finished (#not-finished). */
export function limitsHtml(): string {
  return `<div class="sec-lim" id="limits">
  <article class="pc card fd notyet-c" id="s-notyet"><h2><span class="ic">${icon("clock", 19)}</span>${esc("Not yet")}</h2>
    <p>${esc(NOT_YET_LINE)}</p>
    ${foldHtml("Sources", [...NOT_YET_SOURCES.map(quoted), outLink(repoHref(NOT_IN_PLACE.doc, NOT_IN_PLACE.anchor), "What is not in place")])}</article>
  ${notFinishedHtml()}
</div>`;
}

export function securityPage(): string {
  const groups = securityEvidence();
  const away = unavailableLines().map((quote) => docLine({ doc: UNAVAILABLE.doc, anchor: UNAVAILABLE.anchor, quote }).quote);
  const cats = securityCategories({ away, awayLink: outLink(repoHref(UNAVAILABLE.doc, UNAVAILABLE.anchor), UNAVAILABLE.doc), groups });
  // 21 Nov (Max: "security page is still not upgraded"): /proof's design language. The hero over the wave with four
  // figures; how a payment is guarded (the trust boundaries); the six categories, each figure a tile to its record and
  // its depth folded; the limits of this build last.
  const body = `<main class="secp">
${heroHtml(securityLead(groups), cats)}
<div class="wrap">
  ${archHtml()}
  ${categoryNavHtml(cats)}
  <p class="sc-legend">${esc(LEGEND)}</p>
  ${categoriesHtml(cats)}
  ${limitsHtml()}
</div></main>`;
  return page({
    title: "Security and trust", tab: "security",
    description: "How Purser guards company money: the trust boundaries a payment passes, then approval, limits, agents and keys, money movement, testing and data, each figure linked to its record; and what is not in place yet. Sandbox and testnet only.",
    css: `${PRODUCT_CSS}\n${ARCH_CSS}\n${CATEGORIES_CSS}\n${SECURITY_CSS}\n${NOT_FINISHED_CSS}`,
    body, js: SECURITY_WAVE_JS, stage: false,
    source: "Source: docs/evidence/evidence-wall.json and the records each figure links, docs/zero-trust/report.json, docs/policy-opa.md, and the docs each fold names.",
    real: [
      "Sandbox and testnet only: Airwallex's sandbox, Alta's testnet, test money.",
      HARNESS_LINE,
      ARCH_REAL_LINE,
      NOT_YET_LINE,
    ],
  });
}

/** Under the categories' nav: what a tile is and what its tag says. */
export const LEGEND = "Tap a figure for its committed record; its tag says where it ran. Test money only.";
