// Home leads with Purser Cloud (the owner, 20 Nov: "Purser Cloud becomes the company's product"): what it is for a
// company, an explainer of the money flow (src/redesign/moneyFlow.ts, read from /try's two proof files), how to start
// (try it, look around as a guest, run a pilot), then the 60-second proof judges need (the demo, /try, /proof, /verify,
// one real /try run and the three sponsor tracks, each with its record). Below that, as before:
// Home: ONE story (home-story, 12 Nov, after seven jurors judged the live site). Top to bottom: the heading and what
// Purser is in one sentence; one button ("Try it yourself") with one reassurance line; the sentence every juror repeated
// (now carried by the demo); the hero, which is also "how it works" in four steps and whose fourth step is the visitor's own
// real check (src/redesign/heroDemo.ts); ONE provenance line with the "What's real?" link; three proof rows, each one
// tap from the partner's own record; and the second and last button, "See the proof". No replay of the agents' run, no
// awards strip, no run counts, no second caveat: the full list of what is real stays in the footer's fold. Every id,
// amount and date is read from the run records (docs/demo/airwallex-run.json, docs/demo/main-run.json) and the hero's
// receipt (the published receipt of the approval of 7 November, src/redesign/heroReceipt.ts).

import { AWX_HOME_BADGE_CSS, awxHomeBadgeHtml } from "./awxLive.js";
import { VISA_REUSE_ID } from "./visaStory.js";
import { AWX_HOME_LINE, FILM_LINK, FILM_URL, IDEA, designPartnerHtml, DESIGN_PARTNER_URL, BUSINESS_CASE_LINK, BUSINESS_DOCS, CAVEAT_LINE, CHAIN_TEST, CORE_SENTENCE, HERO, SMALL_COMPANY_DEMO_URL, WHY_COMPANY, WHY_COMPANY_NOTE_LAST } from "../config/brand.js";
import type { Awx1Record } from "../awx/scenario.js";
import { agentRun, payments, split, type AgentRun } from "./run.js";
import { AWX_RUN_FILE, AWX_RUN_STEPS_ID, awxRun } from "./awxRun.js";
import { metalStory, REPO_BLOB } from "./metalStory.js";
import { heroDemoFacts } from "./heroDemo.js";
import { FLOW_NOTE, HERO_FLOW_CSS, heroFlowHtml, VAT_THEN } from "./heroFlow.js";
import { vic3Run, type Vic3Record } from "./vic3Run.js";
import { countOf, esc, icon, MAIN_RUN_REAL, page, TRY_URL } from "./ui.js";
import { COUNT_JS, STATS_CSS, statsHtml, type Stat } from "./stats.js";
import { homeScaleStats, SCALE_CSS, SCALE_SOURCES } from "./scale.js";
import { ownersRun, ownersSteps, type OwnersRun } from "./metalOnchain.js";
import { booksData } from "./booksPage.js";
import { SITE_URL } from "../ui/meta.js";
import { NEGOTIATE_URL, PURSER_CLOUD_URL } from "../ui/more.js";
import { MONEY_FLOW_CSS, MONEY_FLOW_RECORDS, moneyFlowFacts, moneyFlowHtml } from "./moneyFlow.js";
import { ASSET_VERSIONS, versioned, type VersionedAsset } from "../ui/assetVersions.js";

/** The hub of every connection Purser has, each labelled, with a quickstart (docs/integrations/README.md); in Home's footer. */
export const CONNECT_HUB_DOC = "docs/integrations/README.md", CONNECT_HUB_LABEL = "Connect to anything";

const CSS = `/* Home, enterprise pass (the owner, 12 Nov): an 8 px grid, 1120 px wide, neutral greys and one accent. */
main.ent .wrap { max-width: 1120px; }
main.ent section { padding: 112px 0; border-top: 1px solid var(--border); }
main.ent section.e-hero { padding: 88px 0 72px; border-top: 0; }
.eyebrow { margin: 0 0 8px; font-size: 13px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: var(--accent); }
.e-h { margin: 0; font-size: clamp(28px, 3.2vw, 40px); line-height: 1.15; font-weight: 760; letter-spacing: -.02em; max-width: 22em; }
.e-sub { margin: 16px 0 0; font-size: 18px; line-height: 1.5; color: var(--muted); max-width: 36em; }
/* The hero: words and buttons on the left, the product card on the right. */
.e-hero .wrap { display: grid; gap: 48px; align-items: center; }
.e-hero .h-hero { font-size: clamp(40px, 5vw, 60px); line-height: 1.04; letter-spacing: -.03em; } .e-hero .h-hero span { display: block; }
@media (min-width: 1040px) { .e-hero .wrap { grid-template-columns: minmax(0, 1fr) minmax(0, 460px); gap: 56px; } .e-hero .h-hero { font-size: clamp(44px, 4vw, 54px); } .e-hero .h-hero span { white-space: nowrap; } }
.e-hero .what { margin: 24px 0 0; font-size: 20px; line-height: 1.5; color: var(--muted); max-width: 30em; }
.ctas { margin: 32px 0 0; display: flex; flex-wrap: wrap; gap: 12px; }
.btn.big { height: 56px; font-size: 17px; padding: 0 28px; }
.btn.ghost { background: transparent; }
.btn.ghost:hover { border-color: var(--text); }
.reassure { margin: 16px 0 0; font-size: 15px; color: var(--muted); }
/* The x402 line (jury, 17 Nov), a 44 px target like every link on Home. */
.x402l { margin: 8px 0 0; font-size: 15px; line-height: 1.4; max-width: 36em; }
.x402l a { color: var(--accent); font-weight: 650; text-decoration: none; display: inline-flex; align-items: center; gap: 6px; min-height: 44px; }
/* Live measurement, 15 Nov: the two links wrap flush left on a phone (a margin indented the trailer on its own line). */
.walk { margin: 4px 0 0; font-size: 15px; display: flex; flex-wrap: wrap; column-gap: 14px; }
.walk a.film { color: var(--accent); font-weight: 650; text-decoration: none; display: inline-flex; gap: 6px; align-items: center; min-height: 44px; }
/* The proof line (15 Nov): what it runs on and three measured figures, under the idea. */
.proofl { margin: 14px 0 0; font-size: 15px; line-height: 1.6; color: var(--muted); max-width: 36em; }
.proofl a { color: inherit; text-decoration: none; border-bottom: 1px dotted var(--faint); white-space: nowrap; }
/* Each figure is a 44 px target, like every link on Home (test/browser/homeStory.ts). */
.proofl a { display: inline-flex; align-items: center; gap: .3em; min-height: 44px; border-bottom: 0; text-decoration: underline dotted var(--faint); text-underline-offset: 4px; }
.proofl { line-height: 1.3; }
.proofl a:hover, .proofl a:focus-visible { color: var(--accent); border-color: var(--accent); }
.proofl b { color: var(--text); font-weight: 700; font-variant-numeric: tabular-nums; }
.proofl .dot { color: var(--faint); }
.trust { margin: 40px 0 0; padding-top: 24px; border-top: 1px solid var(--border); display: flex; flex-wrap: wrap; align-items: center; gap: 16px 12px; }
.trust span { width: 100%; font-size: 13px; font-weight: 650; letter-spacing: .06em; text-transform: uppercase; color: var(--faint); }
/* 14 Nov (owner): the partners' official files again, each unaltered on its own white tile in both themes (size only;
   no filter, no recolour, no crop). The Airwallex, Alta and Visa files are dark marks with no light version; Claude's
   is its own slate variant for light grounds (docs/assets/logos/SOURCES.md). */
.trust .tile { width: auto; display: inline-flex; align-items: center; justify-content: center; height: 44px; padding: 0 12px; background: #ffffff; border: 1px solid #e4e7ec; border-radius: 10px; }
.trust .tile img { display: block; height: 18px; width: auto; }
.trust .tile.tname.visa { font-size: 13px; font-weight: 650; }
.trust .tile.tname { font-size: 16px; font-weight: 750; line-height: 1; color: #111827; letter-spacing: -.01em; text-transform: none; }
.trust .tile img.alta { height: 22px; }
.trust .tile img.visa { height: 14px; }
.trust small { width: 100%; margin-top: -8px; font-size: 12.5px; color: var(--faint); }
@media (max-width: 640px) { .trust { gap: 8px; } .trust .tile { height: 32px; padding: 0 7px; border-radius: 8px; } .trust .tile img { height: 13px; } .trust .tile.tname { font-size: 13px; } .trust .tile.tname.visa { font-size: 12px; } .trust .tile img.alta { height: 16px; } .trust .tile img.visa { height: 11px; } }
@media (max-width: 640px) {
  main.ent section { padding: 64px 0; } main.ent section.e-hero { padding: 40px 0 56px; }
  .ctas .btn { width: 100%; justify-content: center; }
  /* 15 Nov: three buttons stacked; the two secondary ones a little lower, so the reassurance line stays on a 360 x 780 first screen. */
  .ctas .btn.ghost { height: 48px; font-size: 16px; }
  .e-hero .what { font-size: 18px; }
}
/* Four features: an icon, a title, one line. */
ul.feat { list-style: none; margin: 48px 0 0; padding: 0; display: grid; gap: 16px; }
@media (min-width: 640px) { ul.feat { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (min-width: 1040px) { ul.feat { grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 24px; } }
ul.feat li { padding: 24px; border: 1px solid var(--border); border-radius: 16px; background: var(--surface); box-shadow: 0 1px 2px rgba(16, 24, 40, .04); }
ul.feat .fi { width: 40px; height: 40px; border-radius: 10px; display: grid; place-items: center; background: var(--accent-soft); color: var(--accent); }
ul.feat b { display: block; margin: 16px 0 8px; font-size: 17px; font-weight: 700; letter-spacing: -.01em; }
ul.feat p { margin: 0; font-size: 15px; line-height: 1.5; color: var(--muted); }
/* Who decides, who enforces: a stepper across on a wide screen, a list on a phone. */
ol.flow { list-style: none; margin: 48px 0 0; padding: 0; display: grid; gap: 16px; counter-reset: flow; }
ol.flow li { counter-increment: flow; position: relative; display: grid; grid-template-columns: 40px minmax(0, 1fr); column-gap: 16px; row-gap: 4px; align-items: center; }
ol.flow li::before { content: counter(flow); grid-row: 1 / span 2; align-self: start; width: 40px; height: 40px; border-radius: 50%; display: grid; place-items: center; border: 1px solid var(--border); background: var(--surface); color: var(--text); font-size: 15px; font-weight: 700; }
ol.flow li.you::before { background: var(--accent); border-color: var(--accent); color: #fff; }
ol.flow b { font-size: 17px; font-weight: 700; }
ol.flow span { font-size: 15px; line-height: 1.5; color: var(--muted); }
ol.flow a { color: var(--accent); font-size: 13px; font-weight: 650; white-space: nowrap; }
/* A thumb's size to tap (44 px), with the line as it was: the padding is taken back by the margin. */
ol.flow a { display: inline-block; padding-block: 14px; margin-block: -14px; line-height: 16px; }
@media (min-width: 900px) {
  ol.flow { grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 24px; }
  ol.flow li { grid-template-columns: 1fr; row-gap: 8px; align-items: start; align-content: start; }
  ol.flow li::before { grid-row: auto; margin-bottom: 8px; }
  ol.flow li:not(:last-child)::after { content: ""; position: absolute; top: 20px; left: 52px; right: -12px; height: 1px; background: var(--border); }
}
/* The stat row: every figure from a run record, counting up once in view. */
main.ent ul.stats { margin-top: 48px; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; }
main.ent ul.stats li { padding: 20px; border-radius: 16px; }
main.ent ul.stats b { font-size: 32px; }
.statnote { margin: 16px 0 0; font-size: 14px; color: var(--faint); }
/* Jury, 17 Nov (390 px): the note under the five steps sat flush against step 5; 32 px clears its 44 px link target. */
.statnote.flownote { margin-top: 32px; }
.statnote.visal a { display: inline-flex; align-items: center; min-height: 44px; } /* a tap target of 44 px (Visa line, 14 Nov) */
.kit11 { margin: 20px 0 0; max-width: 46em; font-size: 15.5px; line-height: 1.5; color: var(--muted); }
.kit11 b { color: var(--text); font-weight: 650; }
.kit11 a.film { color: var(--accent); font-weight: 650; text-decoration: none; display: flex; width: fit-content; align-items: center; min-height: 44px; white-space: nowrap; }
.e-more { margin: 32px 0 0; display: flex; flex-wrap: wrap; gap: 12px; }
/* The design-partner link (set 20 Nov, the owner): a tap target of 44 px, like every link on Home. */
p.partner { margin: 16px 0 0; font-weight: 650; }
p.partner a { color: var(--accent); display: inline-flex; align-items: center; min-height: 44px; }
p.next { margin: 24px 0 0; font-size: 15.5px; color: var(--muted); max-width: 44em; } p.next a { color: var(--accent); font-weight: 650; text-decoration: none; display: inline-flex; align-items: center; min-height: 44px; white-space: nowrap; }
/* Scroll-in: a section still below the screen once the reader scrolls rises in as it comes into view. Every section is
   shown by default (jury, 13 Nov: no blank part for a reader who has not scrolled, a screenshot or no script); nothing
   moves for a reader who prefers less motion. */
@media (prefers-reduced-motion: no-preference) {
  .reveal.pre { opacity: 0; transform: translateY(16px); transition: opacity .6s ease, transform .6s ease; }
  .reveal.pre.in { opacity: 1; transform: none; }
}
section.band { padding: 60px 0; border-top: 1px solid var(--border); }
.sechead { display: flex; flex-wrap: wrap; align-items: end; justify-content: space-between; gap: 12px; margin-bottom: 26px; }
.sechead .pill { white-space: normal; }
/* Purser Cloud first (the owner, 20 Nov): the product's name over the heading. */
.e-hero p.cloud { margin: 0 0 16px; display: inline-flex; align-items: center; gap: 8px; padding: 6px 12px; border-radius: 999px; background: var(--accent-soft); letter-spacing: .06em; }
.e-hero p.cloud .i { flex: none; }
/* On a phone the two secondary buttons share a row under the primary one, so the line under them stays on a 360 x 780
   first screen with the product's name above the heading. */
@media (max-width: 640px) {
  .ctas { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 10px; }
  .ctas .btn.primary { grid-column: 1 / -1; }
  .ctas .btn.ghost { padding: 0 8px; font-size: 15px; gap: 6px; }
  .e-hero p.cloud { margin-bottom: 12px; padding: 4px 10px; font-size: 12px; }
}
/* The proof line's figures rise in once, on load, by a wipe: every frame shows the record's own figure in its own colours. */
.proofl a b { display: inline-block; }
@media (prefers-reduced-motion: no-preference) {
  .proofl a b { animation: fig-in .7s cubic-bezier(.2, .7, .2, 1) both; }
  .proofl a:nth-of-type(2) b { animation-delay: .12s; } .proofl a:nth-of-type(3) b { animation-delay: .24s; }
}
@keyframes fig-in { from { clip-path: inset(0 0 100% 0); transform: translateY(6px); } to { clip-path: inset(0 0 0 0); transform: none; } }
/* How to start: three cards, the third the pilot. */
ol.starts { list-style: none; margin: 40px 0 0; padding: 0; display: grid; gap: 16px; counter-reset: st; }
@media (min-width: 900px) { ol.starts { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 24px; } }
ol.starts > li { counter-increment: st; display: flex; flex-direction: column; padding: 24px; border: 1px solid var(--border); border-radius: 16px; background: var(--surface); box-shadow: 0 1px 2px rgba(16, 24, 40, .04); }
ol.starts > li.pilot { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent), 0 12px 32px -16px rgba(79, 70, 229, .35); }
ol.starts .sh { display: flex; align-items: center; gap: 12px; }
ol.starts .sh::before { content: counter(st); width: 32px; height: 32px; flex: none; border-radius: 50%; display: grid; place-items: center; background: var(--accent-soft); color: var(--accent); font-size: 14px; font-weight: 750; }
ol.starts li.pilot .sh::before { background: var(--accent); color: var(--surface); }
ol.starts b { font-size: 18px; font-weight: 720; letter-spacing: -.01em; }
ol.starts p.st { margin: 12px 0 0; font-size: 15px; line-height: 1.5; color: var(--muted); }
ol.starts .go { margin-top: auto; padding-top: 12px; display: flex; flex-wrap: wrap; column-gap: 18px; }
ol.starts .go a, ol.starts p.partner a { color: var(--accent); font-weight: 650; text-decoration: none; display: inline-flex; align-items: center; gap: 6px; min-height: 44px; }
ol.starts .go a:hover, ol.starts p.partner a:hover { text-decoration: underline; }
ol.starts p.partner { margin: 0; }
/* The 60-second proof: four numbered ways in beside one real /try run, then the sponsor tracks. */
.pathgrid { margin: 40px 0 0; display: grid; gap: 32px; align-items: start; }
@media (min-width: 1040px) { .pathgrid { grid-template-columns: minmax(0, 1fr) minmax(0, 540px); gap: 56px; } }
ol.path { list-style: none; margin: 0; padding: 0; display: grid; gap: 12px; }
ol.path a { display: grid; grid-template-columns: 40px minmax(0, 1fr) auto; gap: 14px; align-items: center; min-height: 64px; padding: 12px 18px; border: 1px solid var(--border); border-radius: 14px; background: var(--surface); color: var(--text); text-decoration: none; transition: border-color .2s ease, transform .2s ease; }
ol.path a:hover { border-color: var(--accent); }
@media (prefers-reduced-motion: no-preference) { ol.path a:hover { transform: translateX(2px); } }
ol.path .pn { width: 40px; height: 40px; border-radius: 50%; display: grid; place-items: center; background: var(--accent-soft); color: var(--accent); font-weight: 750; }
ol.path li:first-child .pn { background: var(--accent); color: var(--surface); }
ol.path b { display: block; font-size: 17px; font-weight: 700; } ol.path small { display: block; font-size: 14px; color: var(--muted); }
ol.path .i { color: var(--accent); }
h3.h-tracks { margin: 56px 0 0; font-size: 13px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: var(--faint); }
ul.tracks { list-style: none; margin: 16px 0 0; padding: 0; display: grid; gap: 16px; }
@media (min-width: 900px) { ul.tracks { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 24px; } }
ul.tracks li { display: flex; flex-direction: column; padding: 20px 24px 12px; border: 1px solid var(--border); border-radius: 16px; background: var(--surface); }
ul.tracks a.trk { display: inline-flex; align-items: center; gap: 6px; min-height: 44px; font-size: 19px; font-weight: 740; color: var(--text); text-decoration: none; letter-spacing: -.01em; }
ul.tracks a.trk .i { color: var(--accent); } ul.tracks a.trk:hover { color: var(--accent); }
ul.tracks p { margin: 4px 0 0; font-size: 15px; line-height: 1.5; color: var(--muted); }
ul.tracks a.rec { margin-top: auto; padding-top: 4px; display: inline-flex; align-items: center; gap: 6px; min-height: 44px; font-size: 14px; color: var(--accent); font-weight: 650; text-decoration: none; }
ul.tracks a.rec code { font-family: var(--mono, ui-monospace, monospace); font-size: 13px; }
ul.tracks a.rec:hover { text-decoration: underline; }
.e-path .x402l { margin-top: 24px; }
/* The refined pass (the owner, 20 Nov: "clean and enterprise-grade: fewer elements, more whitespace, one strong hero").
   The proof line is a quiet strip of three figures under one label; the hero's three buttons are one row on a wide
   screen; the partners' row is one slim line under the whole hero; the product card in the 60-second proof stands
   still in its final state, so the explainer is the one thing that moves. */
.proofl { margin: 32px 0 0; display: grid; grid-template-columns: repeat(3, auto); justify-content: start; align-items: stretch; max-width: none; line-height: 1.3; }
.proofl .lead { grid-column: 1 / -1; margin-bottom: 10px; font-size: 12.5px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: var(--faint); }
.proofl .dot { display: none; }
.proofl a { flex-direction: column; align-items: flex-start; justify-content: flex-start; gap: 2px; max-width: 13em; padding: 0 20px; border-left: 1px solid var(--border); font-size: 13.5px; color: var(--muted); text-decoration: none; white-space: normal; }
.proofl a:first-of-type { padding-left: 0; border-left: 0; }
.proofl a b { font-size: 26px; line-height: 1.1; font-weight: 750; letter-spacing: -.02em; }
.proofl a:hover b, .proofl a:focus-visible b { color: var(--accent); }
.e-hero .ctas { margin-top: 36px; gap: 10px; }
.e-hero .ctas .btn.big { height: 50px; padding: 0 16px; font-size: 15.5px; }
.e-hero .trust { grid-column: 1 / -1; margin: 16px 0 0; padding-top: 28px; }
@media (min-width: 1040px) { .e-hero .trust { flex-wrap: nowrap; gap: 12px; } .e-hero .trust span:first-child { width: auto; margin-right: 12px; } .e-hero .trust small { width: auto; margin: 0 0 0 auto; } }
.e-path .hf *, .e-path .hf .hf-steps li { animation: none !important; }
p.ask { margin: 32px 0 0; font-size: 15.5px; color: var(--muted); }
p.ask a { color: var(--accent); font-weight: 650; text-decoration: none; display: inline-flex; align-items: center; gap: 6px; min-height: 44px; }
p.ask a:hover { text-decoration: underline; }
@media (max-width: 640px) {
  .proofl { margin-top: 24px; grid-template-columns: repeat(3, minmax(0, 1fr)); } .proofl a { padding: 0 10px; font-size: 12.5px; max-width: none; } .proofl a b { font-size: 22px; } .e-hero .ctas { margin-top: 28px; }
  .e-hero .ctas .btn.big { height: 48px; padding: 0 8px; font-size: 15px; } .e-hero .ctas .btn.primary { height: 54px; font-size: 16.5px; }
}`;

/**
 * Home is served at "/" too (worker/src/core.ts). The CFO's viewer link opens "/" with its key after the "#" (never sent
 * to a server), and a device that opened it keeps the key (kit11.view, as src/dashboard/page.html stores it): either
 * goes on to the dashboard, "#" and all, by the same patterns the dashboard reads. The key leaves this page's address at
 * once, as it does on the dashboard. A guest stays on Home, and the Home tab (/home) is always Home.
 */
export const CFO_FORWARD_JS = `
(function () {
  try {
    if (location.pathname.slice(-1) !== "/") return;
    var h = location.hash;
    // 12 Nov (owner): only the CFO's own link (its key after "#") opens the dashboard; a device that merely kept a key
    // from an earlier link stays on Home, like every visitor.
    if (!/(?:^#|&)(?:view=[0-9a-f]{32}|runner=[A-Za-z0-9_-]{80,200})(?:&|$)/.test(h)) return;
    if (h) try { history.replaceState(null, "", location.pathname + location.search); } catch (e) {}
    location.replace("./?dashboard" + h);
  } catch (e) {}
})();`;

const JS = `${CFO_FORWARD_JS}
(function () {
  // "What's real?" (the provenance line) opens the footer's fold of the same name.
  var real = document.getElementById("real");
  var open = function () { if (real) real.open = true; };
  if (location.hash === "#real") open();
  document.querySelectorAll("[data-real]").forEach(function (a) { a.addEventListener("click", open); });
})();
(function () {
  // Scroll-in: only with IntersectionObserver and no wish for less motion; otherwise everything is simply shown.
  if (!("IntersectionObserver" in window) || !window.matchMedia || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  var els = [].slice.call(document.querySelectorAll(".reveal"));
  var io = new IntersectionObserver(function (es) { es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } }); }, { rootMargin: "0px 0px -8% 0px" });
  // Only once the reader scrolls, and only what is then still out of sight below: it is never hidden while in view.
  function arm() {
    removeEventListener("scroll", arm);
    els.forEach(function (el) { if (el.getBoundingClientRect().top > innerHeight) { el.classList.add("pre"); io.observe(el); } });
  }
  addEventListener("scroll", arm, { passive: true });
})();`;

/**
 * "Why this is a company" (section D, 6 Nov): five lines from docs/business/, each linked to its page, under one note
 * that says it is not validated (WHY_COMPANY, WHY_COMPANY_NOTE).
 */
export function whyCompanyHtml(): string {
  return `<section class="band" aria-labelledby="h-company"><div class="wrap">
  <div class="sechead"><h2 class="h-sec" id="h-company">Why this is a company</h2></div>
  <ul class="company">${WHY_COMPANY.map((l) => `<li data-rec="${esc(`docs/business/${l.page}`)}"><b>${esc(l.label)}:</b> ${esc(l.text)}</li>`).join("")}</ul>
  <p class="clink"><a href="${esc(BUSINESS_DOCS)}" target="_blank" rel="noopener">${esc(BUSINESS_CASE_LINK)}</a></p>
  <p class="cnote" data-rec="docs/business/README.md">${esc(WHY_COMPANY_NOTE_LAST)}</p>
</div></section>`;
}

/** The heading's markup: HERO's two sentences, each its own line (A10: the break comes after "spend.", never mid-sentence). */
export function homeHeadingHtml(): string {
  const [first, ...rest] = HERO.split(/(?<=\.)\s+/);
  return `<h1 class="h-hero"><span>${esc(first!)}</span> <span>${esc(rest.join(" "))}</span></h1>`;
}
/**
 * Home's first button, word for word: the hands-on demo, where the Try tab goes (TRY_URL). 13 Nov (owner): the product
 * tour is gone, so the first button is the demo again, as before it; the second is the proof (PROOF_BUTTON).
 */
export const START = "Try it in 2 minutes";
/**
 * The idea in one sentence (15 Nov, Founder's and Judges' Choice: one sharp idea, understood in 10 seconds). The same
 * sentence opens the README (test/first-screen.test.ts holds the two equal).
 */
export const HOME_SUB = IDEA;
/** The hero's secondary buttons: the film, then "Verify a payment yourself" (/verify, live since #364; opts.verifyUrl "" hides it). */
export const FILM_BUTTON = "Watch the demo";
export const VERIFY_BUTTON = "Verify a payment yourself";
export const VERIFY_URL = "/verify";
/** The proof line's first words; its figures are Home's three measured ones (src/redesign/scale.ts homeScaleStats). */
// Site audit, 20 Nov (finding 6.3): "test money" moved from this line to the one under the buttons (SANDBOX_NOTE), beside
// the primary button; it is still said once outside the fold.
export const PROOF_LEAD = ["Built on Airwallex"] as const;
/** The proof line: what it runs on, then three figures, each a link to its source; none without its record. */
// 15 Nov: these three figures used to sit in a band in the records section; they lead the hero now, and /proof keeps
// the full strip (src/redesign/scale.ts).
export function proofLineHtml(stats = homeScaleStats()): string {
  const fmt = (n: number) => n.toLocaleString("en-GB");
  // Each figure with its source's own title (the tests' "passed, skipped" wording, test/tests-title.test.ts); the line
  // names its records (data-rec), as the band did: test/home-story.test.ts holds the figures to them.
  const figs = stats.map((s) => `<a href="${esc(s.href)}" title="${esc(s.title)}"${s.external ? ' target="_blank" rel="noopener"' : ""}><b>${esc(fmt(s.n))}</b> ${esc(s.label)}</a>`);
  return `<p class="proofl" data-rec="${esc(SCALE_SOURCES)}">${[...PROOF_LEAD.map((w) => `<span class="lead">${esc(w)}</span>`), ...figs].join('<span class="dot" aria-hidden="true"> · </span>')}</p>`;
}
/**
 * The one line under the buttons, saying only what the page behind the first one does: the hands-on demo (TRY_URL) is a
 * sandbox demo on test money, with no real settlement (its start page adds that the test company is deleted after 24
 * hours). The same line with /try/sign in the bundle or not; both keys kept for the callers.
 */
// Partner scan, 14 Nov: Visa named in full in "Works with" takes a row on a phone, so "test money" moves up into this line.
// 15 Nov: "test money" is said once outside the fold, in the hero's proof line, so this line no longer repeats it; "own"
// went with the Verify button, to keep Home within its 378 words.
// Site audit, 20 Nov (finding 6.3): a short sandbox disclosure beside the primary button.
export const SANDBOX_NOTE = "Sandbox demo: test money, no real settlement.";
// It replaces "Your test company, deleted after 24 hours." (the start of /try says that), so the line fits the first screen
// at 360 px and Home stays within its words.
export const REASSURE = { sign: SANDBOX_NOTE, world: SANDBOX_NOTE } as const;
/** The link in the provenance line: it opens the footer's fold of the same name. */
export const WHATS_REAL = "What's real?";
export const LOCKS_HEAD = "Each lock, on record";
export const FLOW_HEAD = "Claude agents decide. Code and the rails enforce.";
export const FEATURES_HEAD = "Agents do the work. The CFO keeps the say.";
/** What Claude adds, from the worst-case run (docs/worst-case-ai.md, "What code alone sends to the CFO"). */
// Jury, 17 Nov: one plain before/after, from the same record (docs/evals/scorecard-2026-11-15.json: the seven cases the
// script arm sent to the CFO, each held by the Purser arm with Claude reading, in both runs).
export const CLAUDE_ADDS = "Offline eval: code alone sent seven invoices to the CFO it should have held; with Claude, Purser held all seven.";
/** Four features, one line each; each says only what the runs and the code show (see /proof). */
export const FEATURES = [
  // Jury panel, 15 Nov: the hero already says a changed cent breaks the signature; this card keeps the terms.
  // Jury, 17 Nov: "passkey", not "Face ID": several runs were signed with test passkeys, and the check proves a passkey.
  { icon: "scan-face", title: "Passkey on the exact terms", text: "Above a limit, the CFO signs the exact terms." },
  // Jury panel, 15 Nov ("what does Claude add?"): docs/worst-case-ai.md, its figure word for word (test/home-about.test.ts).
  { icon: "shield-check", title: "What Claude adds", text: CLAUDE_ADDS },
  { icon: "ban", title: "Rails that refuse too", text: "Airwallex, Alta and Visa via Airi apply their own controls." },
  { icon: "file-check", title: "Booked and checkable", text: "Every payment is booked; its signed receipt checks offline." },
] as const;
/**
 * /try/negotiate on Home (Max, 15 Nov): one card under the features, its page's own headline word for word
 * (cloud/src/try/negotiatePage.ts; test/home-negotiate.test.ts keeps the two the same) and one button to watch it.
 */
export const NEGOTIATE_HEAD = "Two agents negotiate. Code holds the limits. You sign the deal.";
export const NEGOTIATE_BUTTON = "See them negotiate";
export function negotiateCardHtml(href: string = NEGOTIATE_URL): string {
  return `<div class="negf reveal"><span class="fi">${icon("users", 22)}</span><b class="negt">${esc(NEGOTIATE_HEAD)}</b><a class="btn big ghost" href="${esc(href)}">${esc(NEGOTIATE_BUTTON)}${icon("arrow-right", 18)}</a></div>`;
}
const NEGOTIATE_CSS = `
.negf { margin: 24px 0 0; padding: 24px; display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 18px; border: 1px solid var(--border); border-radius: 16px; background: var(--surface); box-shadow: 0 1px 2px rgba(16, 24, 40, .04); }
.negf .fi { width: 44px; height: 44px; border-radius: 12px; display: grid; place-items: center; background: var(--accent-soft); color: var(--accent); }
.negf b { display: block; font-size: 19px; line-height: 1.3; font-weight: 720; }
@media (max-width: 720px) { .negf { grid-template-columns: 1fr; padding: 20px; } .negf .btn { justify-self: start; } }
`;

/** The records behind the stat row (test/home-story.test.ts checks each figure against them). */
export const STAT_RECORDS = "docs/runs/2026-11-12-faceid-onchain.json docs/demo/main-run.json docs/demo/airwallex-run.json docs/runs/2026-11-13-vic-4.json";
export const STAT_NOTE = "All runs and test companies on record, counted at build.";
/**
 * Which agents these are, and how they fit with the Kit 11 run's (review, 13 Nov: two sets of agents on one site read as
 * one; competitor review, 17 Nov: say outright that it is one engine, under the same limits, as the core run below, whose
 * agents Sourcing, Support and Treasury trade data; Home names no kit and keeps its word budget, so the line stays short).
 */
export const AGENT_SETS_NOTE = "Same engine, same limits: these pay invoices; the core run's agents trade data.";

/**
 * The Kit 11 core run in one line (review, 13 Nov: Home told only the payables story): the main run of 3 Nov, its
 * company, its Alta payments, Claude's decisions and the purchase Alta refused on chain, each from the main run's
 * record; then the walkthrough (FILM_URL, FILM_LINK; no duration in the words since 14 Nov, owner).
 */
/** The film's link on Home: no "Watch" (Home names no replay; home-story, 12 Nov). */
export const FILM_HOME = "The film";
export function kit11Html(run: AgentRun = agentRun()): string {
  const st = metalStory(run.record), sp = split(run.record), r = st.refusal;
  const company = (run.record as { company?: unknown }).company;
  if (!st.payments.total || !sp.decisions) return "";
  // "The core run" says which run; its day stays (jury, 17 Nov: the words "the main run" went for the caveat below).
  const who = `${run.record.run.replace(/^the main run, /, "")}${typeof company === "string" ? `, ${company}` : ""}`;
  // Jury, 17 Nov: #24 with the caveat /alta and /proof give (CHAIN_TEST): our own check was off for that one test.
  return `<p class="kit11" data-rec="${esc(run.file)}"><b>${esc("The core run")}</b> ${esc(`(${who}; agents Sourcing, Support, Treasury): ${st.payments.total} Alta testnet payments, ${countOf(sp.byClaude, sp.decisions, true)} decisions by Claude${r ? `; with our own check off for a test, Alta refused purchase #${r.seq} on chain` : ""}.`)} <a class="film" href="${esc(FILM_URL)}" target="_blank" rel="noopener">${esc(FILM_HOME)}&nbsp;↗</a></p>`;
}
/**
 * Kit 11's fit, under the hero (jury, 17 Nov: x402 sat only in the footer, agents getting paid only on /alta): one line
 * to /alta, shown only when the main run's record has the agents both paying (supplier purchases) and paid (sales) per
 * request on Alta, earnings swept to Airwallex, and an Airwallex payout. Home names no kit (A10).
 */
export const X402_LINE = "Agents with mandates on Alta pay and get paid over x402; Airwallex moves the fiat.";
export function x402LineHtml(run: AgentRun = agentRun()): string {
  const p = payments(run.record);
  if (!p.sales || !p.purchases || !p.sweeps || !p.transfers) return "";
  return `<p class="x402l" data-rec="${esc(run.file)}"><a href="alta">${esc(X402_LINE)}${icon("arrow-right", 16)}</a></p>`;
}
/** Home's second and last button. */
export const PROOF_BUTTON = "See the proof";
/** The fold at the end of Home (the owner, 12 Nov, for the Founder's award): no new page, no menu item, no person. */
export const ABOUT_HEAD = "About Purser";

/**
 * About Purser (the owner, 12 Nov): five steps, who decides and who enforces. A step is marked Claude only where a run
 * record or an eval shows it ran: the reader read the invoices in live sandbox runs (7 and 10 Nov,
 * docs/runs/2026-11-07-awx-1.md and 2026-11-10-platform-e2e.md); the Coder agent coded them with live Claude calls in
 * the chain soak (docs/runs/2026-11-12-chain-soak.md, the bank a stand-in there); the Checker and the Payer agents
 * (src/ap/checkerAgent.ts and payerAgent.ts, behind KIT11_AP_AGENTS) have run in evals only (docs/agent-evals.md,
 * docs/evals/ap-agents.json), so their steps link the evals. No customer, pilot or revenue is claimed.
 */
export interface FlowStep { verb: string; who: string; evals?: string }
const AP_EVALS = `${REPO_BLOB}docs/agent-evals.md#the-payables-agents-the-checker-and-the-payer-with-real-models`;
export const AGENT_FLOW: readonly FlowStep[] = [
  { verb: "Read", who: "Claude reader agent" },
  { verb: "Check", who: "Checker agent (Claude) decides, code enforces the limits", evals: AP_EVALS },
  { verb: "Code", who: "Coder agent (Claude) books account and VAT" },
  { verb: "Sign", who: "You, with a passkey" },
  { verb: "Pay", who: "Payer agent (Claude) proposes, the rail and code enforce", evals: AP_EVALS },
];
export const WORKS_WITH = "Works with";
/** Beside the partners' marks (review, 13 Nov); the whole line is in every page's "What's real?" (ui.ts MARKS_NOTE). */
export const NO_ENDORSEMENT = "No endorsement implied";
/** Visa in the "Works with" row and the Visa line (partner scan, 14 Nov): what Purser used, said in full. */
export const VISA_WORKS_WITH = "Visa Intelligent Commerce via Airwallex Airi (sandbox)";
function aboutHtml(): string {
  return `<p class="eyebrow">${esc(ABOUT_HEAD)}</p>
  <h2 class="e-h reveal" id="about">${esc(FLOW_HEAD)}</h2>
  <ol class="flow reveal">${AGENT_FLOW.map((f) => `<li${f.verb === "Sign" ? ' class="you"' : ""}><b>${esc(f.verb)}</b><span>${esc(f.who)}${f.evals ? ` (<a href="${esc(f.evals)}" target="_blank" rel="noopener">see evals</a>)` : ""}</span></li>`).join("")}</ol>
  <p class="statnote flownote">${esc(AGENT_SETS_NOTE)}</p>
`;
}

export interface ProofRow { partner: "Airwallex" | "Alta" | "Visa"; title: string; text: string; icon: string; id: string; full: string; href: string; external: boolean; /** Airwallex's row: the declined charge and the card's limit, as the record holds them. */ charge?: { currency: string; amount: string; limit: string } }

/**
 * The three proof rows, every value from a run record; a row whose record lacks a piece drops out.
 * 1. Airwallex declined an agent's card over its limit (the Airwallex-only run: the declined charge and the card's
 *    limit as Airwallex returned it), to the site's section with Airwallex's record of it.
 * 2. Alta refused a purchase on chain (the main run), to the transaction on Alta's testnet explorer.
 * 3. Visa Intelligent Commerce: a reused credential refused by Purser, which the sandbox had accepted (vic-4, vic-3), to /visa.
 * The CFO's own row (the signed hash in Airwallex's record) left Home on 12 Nov to keep it under 180 words: the hero
 * shows that same approval and its hash, and step 3 says the hash is in Airwallex's record.
 */
export function proofRows(run: AgentRun = agentRun(), awx: Awx1Record | null = awxRun(), vic3: Vic3Record | null = vic3Run()): ProofRow[] {
  const rows: ProofRow[] = [];
  const steps = `airwallex#${AWX_RUN_STEPS_ID}`;
  const cents = (a: string) => Math.round(Number(a) * 100);
  const limitOf = (agent: string) => String(awx?.cards.find((c) => c.agent === agent)?.read_back.per_tx ?? "");
  const decline = awx?.card_transactions.find((t) => !t.approved && !!t.decline_code && !!limitOf(t.agent) && cents(t.amount) > cents(limitOf(t.agent)));
  if (decline) rows.push({ partner: "Airwallex", title: "Airwallex declined the card", text: `${decline.currency} ${decline.amount} over a ${limitOf(decline.agent)} limit.`, icon: "ban", id: `${decline.id.slice(0, 8)}…`, full: decline.id, href: steps, external: false, charge: { currency: decline.currency, amount: decline.amount, limit: limitOf(decline.agent) } });
  const refusal = metalStory(run.record).refusal;
  const tx = /\/tx\/(0x[0-9a-f]{64})$/.exec(refusal?.proof.href ?? "")?.[1];
  if (refusal && tx && refusal.code === "mandate_cap_exceeded") rows.push({ partner: "Alta", title: "Alta refused it on chain", text: "Over its cap.", icon: "link-2", id: refusal.proof.label, full: tx, href: refusal.proof.href!, external: true });
  // Visa Intelligent Commerce (Visa judge, 14 Nov: the outcome was buried): a reused credential, refused by Purser's
  // credential check before any Airwallex call (vic-4 F2, docs/runs/2026-11-13-vic-4.json), where the Airi/Airwallex
  // sandbox had accepted it (vic-3); to /visa's section that sets the two side by side.
  const f2 = vic3?.purchases.find((p) => p.step === "F2" && p.outcome?.code === "PURSER_CREDENTIAL_ALREADY_USED" && p.calls.airwallex === 0 && p.mandate_id);
  if (f2?.mandate_id) rows.push({ partner: "Visa", title: "Visa: reused credential refused", text: "Purser binds each credential to one purchase.", icon: "credit-card", id: `${f2.mandate_id.slice(0, 10)}…`, full: f2.mandate_id, href: `visa#${VISA_REUSE_ID}`, external: false });
  return rows;
}

/**
 * First on record (jury pass, 13 Nov): Face ID verified on chain. The passkey account on Alta testnet
 * (docs/runs/<date>-faceid-onchain.json): every limit change ran only after all its owners' passkeys signed, checked by
 * the account itself; a payment over the cap was refused on chain, and paid after both signed the raise. The second
 * signer is a virtual test passkey, and the tile says so. No record, or no refusal followed by a raise: no tile.
 */
/** "12 Nov", the day of an ISO time in UTC. */
const dayShort = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${iso.slice(0, 10)}T12:00:00Z`));

export function faceIdTile(owners: OwnersRun | null = ownersRun()): Stat[] {
  if (!owners) return [];
  const steps = ownersSteps(owners.rec);
  const refused = steps.findIndex((s) => s.key === "refused");
  const raised = steps.findIndex((s, i) => i > refused && s.key === "replace");
  if (refused < 0 || raised < 0) return [];
  const virtual = owners.rec.owners.filter((o) => o.virtual).length;
  // Its strongest number (the owner, 13 Nov): the limit changes the account ran on chain, each only after every passkey
  // signed. The stand-in in sight: the co-signer is a virtual test passkey (the CFO's device is as the owner stated it).
  const changes = steps.filter((s) => s.key === "bind" || s.key === "replace" || s.key === "revoke").length;
  // Plain words for a CFO (jury review, 13 Nov): how many passkeys signed each change, and which one is a test key.
  const words = ["no", "one", "two", "three", "four", "five"], w = (n: number) => words[n] ?? String(n);
  return [{ n: changes, label: `limit changes, each signed by ${w(owners.rec.threshold)} passkeys on chain (Alta testnet, ${dayShort(owners.rec.ran_at)}${virtual ? `; ${w(virtual)} a test key` : ""})`, icon: "scan-face", tone: "ok" }];
}

/**
 * The stat row (the owner, 12 Nov: one strong stat row), every figure from a run record: Claude's decisions in the main
 * run (its agent_stats), Alta payments in the main run, the card Airwallex declined over its limit (the Airwallex-only
 * run) and the Visa read-backs (vic-3). A figure whose record lacks it drops out.
 */
/**
 * The Visa outcome in one line (Visa judge, 14 Nov: "Purser refused reuse, Airi didn't" was buried), from the proof row
 * that the records hold (vic-4 F2, vic-3), to /visa's section that sets the two side by side. Nothing without the row.
 */
export function visaLineHtml(rows: ProofRow[]): string {
  const v = rows.find((r) => r.partner === "Visa");
  return v ? `<p class="statnote visal"><a href="${esc(v.href)}">${esc("Visa via Airwallex Airi: Purser binds each credential to one purchase; reuse refused.")}</a></p>` : "";
}

export function homeStats(_run: AgentRun, _rows: ProofRow[] = [], owners: OwnersRun | null = ownersRun()): Stat[] {
  // The owner, 13 Nov ("feels small"): the scale band under it (src/redesign/scale.ts) carries the figures of every run,
  // so the row keeps the one lock that leads: Face ID verified on chain. The main run's 24 decisions, its Alta
  // payments, Airwallex's decline and the Visa read-backs are on /proof, each from its record.
  return faceIdTile(owners);
}

/** The product for small companies, as docs/after-the-kit.md says it: its code in this repository, not live. */
export const NEXT_NEXT = "Next, not live yet: an invoice inbox for small companies, with the same passkey control.";
export const AFTER_KIT_URL = `${REPO_BLOB}docs/after-the-kit.md`;
/** One line and one link, only when the demo has a public https address (SMALL_COMPANY_DEMO_URL). */
export function nextHtml(url: string = SMALL_COMPANY_DEMO_URL): string {
  if (!/^https:\/\/[^\s"'<>]+$/.test(url)) return "";
  return `<p class="next">${esc(NEXT_NEXT)} <a href="${esc(url)}" target="_blank" rel="noopener">${esc("Open its demo")}\u00a0↗</a></p>`;
}

/**
 * Purser Cloud first (the owner, 20 Nov). The product's name over the heading; the hero's third button goes to "How to
 * start" on this page, whose third card is the pilot.
 */
export const CLOUD_EYEBROW = "Purser Cloud, for finance teams";
export const PILOT_BUTTON = "Start a pilot";
export const START_ID = "start";
export const START_HEAD = "From a two-minute test to a pilot";
/** Purser Cloud's console on its test-money deployment: the demo company as a guest, and a new company's first run. */
export const CLOUD_GUEST_URL = `${PURSER_CLOUD_URL}#/guest`;
export const CLOUD_SETUP_URL = `${PURSER_CLOUD_URL}#/start`;
/**
 * How to start, as Purser Cloud works today (cloud/src/console.ts, docs/cloud.md): /try makes a test company that the
 * sweep deletes after 24 hours (cloud/src/try/sweep.ts); "Try as guest" opens the demo company read only, with no
 * passkey and no e-mail (POST /v1/auth/guest); a pilot company is created by Purser (POST /v1/admin/tenants), which
 * hands over a starter key; its owner makes a passkey and connects where invoices arrive at #/start ("about two
 * minutes", the set-up page's own words). The deployment runs on test money; no customer is claimed.
 */
export interface StartStep { title: string; text: string; links: { href: string; label: string; external?: boolean }[]; pilot?: boolean }
export const START_STEPS: readonly StartStep[] = [
  { title: "Try it now", text: "Your own test company: an agent proposes, you sign with a passkey. Deleted after 24 hours.", links: [{ href: TRY_URL, label: "Open /try" }] },
  { title: "Look around as a guest", text: "The console with its demo company: read only, no sign-up.", links: [{ href: CLOUD_GUEST_URL, label: "Open the console", external: true }] },
  { title: "Run a pilot", text: "We set up your company and send a starter key; you add your passkey in about two minutes. Test money only; no real payments yet.", links: [{ href: CLOUD_SETUP_URL, label: "Set up with a starter key", external: true }], pilot: true },
];
export function startHtml(partnerUrl: string = DESIGN_PARTNER_URL): string {
  const link = (l: StartStep["links"][number]) => `<a href="${esc(l.href)}"${l.external ? ' target="_blank" rel="noopener"' : ""}>${esc(l.label)}${icon(l.external ? "external-link" : "arrow-right", 16)}</a>`;
  return `<p class="eyebrow">${esc("How to start")}</p>
  <h2 class="e-h reveal" id="h-start">${esc(START_HEAD)}</h2>
  <ol class="starts">${START_STEPS.map((st) => `<li class="reveal${st.pilot ? " pilot" : ""}"><span class="sh"><b>${esc(st.title)}</b></span><p class="st">${esc(st.text)}</p><div class="go">${st.pilot ? designPartnerHtml(partnerUrl) : ""}${st.links.map(link).join("")}</div></li>`).join("")}</ol>`;
}

/**
 * "Ask Purser" (the owner, 20 Nov): a chat on Purser Cloud at /ask, built there; Home only links it, no chat code here.
 */
export const ASK_URL = `${PURSER_CLOUD_URL}ask`;
export const ASK_LABEL = "Ask Purser";
export function askHtml(url: string = ASK_URL): string {
  return `<p class="ask">${esc("Questions first?")} <a href="${esc(url)}" target="_blank" rel="noopener">${esc(ASK_LABEL)}${icon("external-link", 16)}</a></p>`;
}

/** The 60-second proof (the owner, 20 Nov: "the path judges need"): the demo (3:15), /try, /proof, then /verify. */
export const PATH_HEAD = "The 60-second proof";
export const TRACKS_HEAD = "Sponsor tracks";
/** The demo, as the README's judges' path names it: FILM_LINK's duration, without its "Watch" (Home's one "Watch" is the hero's button). */
export const PATH_FILM = `The demo ${/\(\d+:\d\d\)$/.exec(FILM_LINK)?.[0] ?? ""}`.trim();
export function pathStepsHtml(tryHref: string, verifyUrl: string): string {
  const steps = [
    { href: FILM_URL, title: PATH_FILM, sub: "On YouTube", external: true },
    { href: tryHref, title: "Try it yourself", sub: "2 minutes, test money" },
    { href: "proof", title: PROOF_BUTTON, sub: "Every run, with its record" },
    ...(verifyUrl ? [{ href: verifyUrl, title: VERIFY_BUTTON, sub: "In your browser, no server call" }] : []),
  ];
  return `<ol class="path">${steps.map((p, i) => `<li><a href="${esc(p.href)}"${p.external ? ' target="_blank" rel="noopener"' : ""}><span class="pn">${i + 1}</span><span><b>${esc(p.title)}</b><small>${esc(p.sub)}</small></span>${icon(p.external ? "external-link" : "arrow-right", 18)}</a></li>`).join("")}</ol>`;
}
/**
 * The three sponsor tracks, Airwallex, Visa, Alta, in the owner's order: each its page and one outcome from the proof
 * rows (every value from a run record; a track whose row is missing drops out), with the link to that record.
 */
export interface Track { partner: ProofRow["partner"]; name: string; page: string; line: string; rec: { href: string; label: string; external: boolean } }
export function sponsorTracks(rows: ProofRow[]): Track[] {
  const by = (p: ProofRow["partner"]) => rows.find((r) => r.partner === p);
  const out: Track[] = [];
  const a = by("Airwallex"), v = by("Visa"), m = by("Alta");
  if (a?.charge) out.push({ partner: "Airwallex", name: "Airwallex", page: "airwallex", line: `Declined an agent's card charge of ${a.charge.currency} ${a.charge.amount} over its ${a.charge.currency} ${a.charge.limit} limit (sandbox).`, rec: { href: a.href, label: `Record ${a.id}`, external: a.external } });
  if (v) out.push({ partner: "Visa", name: "Visa", page: "visa", line: "Via Airwallex Airi (sandbox): Purser refused a reused credential before any Airwallex call.", rec: { href: v.href, label: `Record ${v.id}`, external: v.external } });
  if (m) out.push({ partner: "Alta", name: "Alta", page: "alta", line: "With our own check off for a test, Alta refused an over-cap purchase on chain (testnet).", rec: { href: m.href, label: m.id, external: m.external } });
  return out;
}
export function tracksHtml(rows: ProofRow[]): string {
  const t = sponsorTracks(rows);
  if (!t.length) return "";
  return `<h3 class="h-tracks" id="h-tracks">${esc(TRACKS_HEAD)}</h3>
  <ul class="tracks" aria-labelledby="h-tracks">${t.map((x) => `<li class="reveal"><a class="trk" href="${esc(x.page)}">${esc(x.name)}${icon("arrow-right", 18)}</a><p>${esc(x.line)}</p><a class="rec" href="${esc(x.rec.href)}"${x.rec.external ? ' target="_blank" rel="noopener"' : ""}>${icon(x.rec.external ? "external-link" : "file-check", 14)}<code>${esc(x.rec.label)}</code></a></li>`).join("")}</ul>`;
}

const dayMonth = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(iso));

/**
 * opts.trySign: the bundle also carries /try/sign (TRY_SIGN_ENABLED); the button opens the hands-on demo (/try) either way.
 * opts.receipt: another receipt for the hero (a file of the repository, or a parsed one); the committed one by default.
 */
export function homePage(run: AgentRun = agentRun(), opts: { trySign?: boolean; partnerUrl?: string; smallCompanyUrl?: string; receipt?: string | object; /** /verify, once the site serves it: the hero's third button. */ verifyUrl?: string } = {}): string {
  const verifyUrl = opts.verifyUrl ?? VERIFY_URL;
  // The owner, 12 Nov: the button opens the hands-on demo on Purser Cloud (TRY_URL), with /try/sign in the bundle or not.
  const tryHref = TRY_URL;
  const awx = awxRun(), facts = heroDemoFacts(awx);
  const rows = proofRows(run, awx);
  // The partners' official files (14 Nov, owner), served unaltered from src/ui/logos/ and docs/assets/logos/ as
  // /assets/logo-*; alt is the partner's name; each on its own white tile (CSS), never filtered.
  // Airwallex left this row on 14 Nov (owner): it is the platform, shown by the header's "Built on Airwallex" badge
  // (src/ui/builtOn.ts); the others work with it.
  const partners = [["", VISA_WORKS_WITH, 0, 0, "visa"], ["logo-alta.svg", "Alta (formerly Metal)", 475, 250, "alta"], ["logo-claude-slate.svg", "Claude", 184, 40, ""], ["", "T:0", 0, 0, "t0"]] as const;
  // 19 Nov (the owner: "we use T:0 too"): T:0, the outside ledger, as text on its tile like Visa (no T:0 mark is on file).
  // 14 Nov (owner): Visa as text on its tile, no logo image. Alta (formerly Metal, renamed 14 Nov): its header wordmark, shown with the Alta team's OK (docs/evidence/logo-permissions.md).
  const body = `<main class="ent">
<section class="e-hero"><div class="wrap">
  <div class="copy">
    <p class="eyebrow cloud">${icon("layout-dashboard", 14)}${esc(CLOUD_EYEBROW)}</p>
    ${homeHeadingHtml()}
    <p class="what">${esc(HOME_SUB)}</p>
    ${proofLineHtml()}
    <div class="ctas"><a class="btn primary big start" href="${tryHref}">${esc(START)}${icon("arrow-right", 18)}</a><a class="btn big ghost film" href="${esc(FILM_URL)}" target="_blank" rel="noopener">${icon("play", 18)}${esc(FILM_BUTTON)}</a><a class="btn big ghost pilot" href="#${START_ID}">${esc(PILOT_BUTTON)}</a></div>
    <p class="reassure">${esc(opts.trySign ? REASSURE.sign : REASSURE.world)}</p>
  </div>
  <div class="show">${moneyFlowHtml(moneyFlowFacts(), WHATS_REAL)}</div>
  <div class="trust"><span>${esc(WORKS_WITH)}</span>${partners.map(([src, alt, w, h, cls]) => src ? `<span class="tile"><img src="assets/${src in ASSET_VERSIONS ? versioned(src as VersionedAsset) : src}" alt="${esc(alt)}" width="${w}" height="${h}"${cls ? ` class="${cls}"` : ""}></span>` : `<span class="tile tname ${cls}">${esc(alt)}</span>`).join("")}<small>${esc(NO_ENDORSEMENT)}</small></div>
</div></section>
<section class="e-start" id="${START_ID}" aria-labelledby="h-start"><div class="wrap">
  ${startHtml(opts.partnerUrl ?? DESIGN_PARTNER_URL)}
  ${askHtml()}
</div></section>
<section class="e-path" aria-labelledby="h-path"><div class="wrap">
  <p class="eyebrow">${esc("For judges")}</p>
  <h2 class="e-h reveal" id="h-path">${esc(PATH_HEAD)}</h2>
  <div class="pathgrid">
    ${pathStepsHtml(tryHref, verifyUrl)}
    <div class="show">${heroFlowHtml()}
      <p class="hf-note">${esc(FLOW_NOTE)} <a href="#real" data-real>${esc(WHATS_REAL)}</a></p></div>
  </div>
  ${tracksHtml(rows)}
  ${x402LineHtml(run)}
</div></section>
<section class="e-feat" aria-labelledby="h-feat"><div class="wrap">
  <p class="eyebrow">Why Purser</p>
  <h2 class="e-h reveal" id="h-feat">${esc(FEATURES_HEAD)}</h2>
  <ul class="feat">${FEATURES.map((f) => `<li class="reveal"><span class="fi">${icon(f.icon, 20)}</span><b>${esc(f.title)}</b><p>${esc(f.text)}</p></li>`).join("")}</ul>
  ${negotiateCardHtml()}
</div></section>
<section class="e-flow" aria-labelledby="about"><div class="wrap">
  ${aboutHtml()}
</div></section>
<section class="e-stats" aria-labelledby="h-locks"><div class="wrap">
  <p class="eyebrow">On record</p>
  <h2 class="e-h reveal" id="h-locks">${esc(LOCKS_HEAD)}</h2>
  <article class="e-statrec" data-rec="${esc(STAT_RECORDS)}">${statsHtml(homeStats(run, rows))}</article>
  ${awxHomeBadgeHtml()}
  <p class="statnote visal"><a href="${tryHref}">${esc(AWX_HOME_LINE)}</a></p>
  ${kit11Html(run)}
  <div class="e-more"><a class="btn big primary" href="proof">${esc(PROOF_BUTTON)}${icon("arrow-right", 18)}</a>${booksCardHtml()}</div>
  ${nextHtml(opts.smallCompanyUrl ?? SMALL_COMPANY_DEMO_URL)}
</div></section>
</main>`;
  // The full list behind the one provenance line: the main run's lines, the run the hero replays (its own note), what
  // step 4's receipt is (the file's own note), and the test behind the Alta row.
  const refusedAt = run.events.find((e) => e.k === "money")?.at ?? run.record.snapshot.flows[0]?.at ?? "";
  // What Home shows first (the hero and its two Airwallex rows), then the Alta row and the main run it comes from.
  const mf = moneyFlowFacts();
  const real = [
    ...(mf ? [`The explainer's amount and fingerprints: /try's two proof files (${MONEY_FLOW_RECORDS.join(", ")}), from the live /try of 15 November: ${mf.amount} to ${mf.vendor}, signed with a passkey and paid on /try's simulated bank${mf.cent ? `; then the same terms with the amount one cent higher (${mf.cent.currency} ${mf.cent.asked}), refused because the signature is over other terms, and nothing paid` : ""}. A test company, test money. Purser's rails are Airwallex (sandbox) and Alta (testnet); /try also sends each payment it pays to the Airwallex sandbox as one transfer when the deployment's switch is on.`] : []),
    "Purser Cloud's public deployment (purser-try.max-31b.workers.dev) runs on test money. As a guest its console shows a demo company made from demo data, read only; a pilot company is created by Purser and set up with the starter key it hands over. No customer uses it yet.",
    `The hero's values (supplier, amount, due date, account, the signed hash and the three booking lines): one /try run of its sample invoice on the live demo, 13 November, with Claude on: Claude Haiku 5.5 read that invoice, and the Checker, Coder and Payer agents ran on it, each request id in the record (docs/runs/2026-11-13-try-sample.json). Test money, a simulated bank, a test passkey. Since 14 November /try also sends each payment it pays to the Airwallex sandbox as one transfer when the deployment's switch is on; this run came before that, so the card says simulated bank.${VAT_THEN ? ` ${VAT_THEN}` : ""}`,
    ...(awx && facts ? [`The Airwallex figure: the Airwallex-only run (${awx.run}) of ${facts.date}. ${CAVEAT_LINE} ${awx.note}`] : []),
    `The Alta figure: the main run${refusedAt ? ` of ${dayMonth(refusedAt)}` : ""}. ${CHAIN_TEST}`,
    ...MAIN_RUN_REAL,
  ];
  return page({
    // Final jury, 13 Nov: / and /home serve this page; /home is its one canonical address.
    title: "Purser", description: `${HERO} ${CORE_SENTENCE}`, canonical: `${SITE_URL}/home`, tab: "home", css: CSS + STATS_CSS + SCALE_CSS + HERO_FLOW_CSS + MONEY_FLOW_CSS + AWX_HOME_BADGE_CSS + NEGOTIATE_CSS, body, js: JS + COUNT_JS, stage: false,
    // 20 Nov (the owner: "Purser connects to everything and everyone, findable"): the hub of every connection, in the footer.
    links: [[`${REPO_BLOB}${CONNECT_HUB_DOC}`, CONNECT_HUB_LABEL]],
    real,
    source: `Source: a /try run of its sample invoice, /try's two proof files (${MONEY_FLOW_RECORDS.join(", ")}), ${AWX_RUN_FILE} and ${run.file} (${run.name}).`,
  });
}

/** One card for /books (owner, 12 Nov): one word, as Home's word budget allows (test/site-v4.test.ts); none without the statement. */
export function booksCardHtml(): string {
  if (!booksData().view) return "";
  return `<a class="btn big ghost" href="books">${icon("database", 18)}${esc("Books")}</a>`;
}
