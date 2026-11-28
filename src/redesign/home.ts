// Home, 21 Nov (Max: "We have enormously many headings on the homepage. Make it clean, tighter and prettier. Make real
// use of animations and visuals."): one short story in six parts, each a single heading at most.
//   1. The hero: Purser Cloud, for companies; the heading and the idea in one sentence; two buttons, "Start the judge
//      tour" and "Try it"; the sandbox line; beside it the product card, one /try run of its sample invoice playing on a
//      loop (src/redesign/heroFlow.ts).
//   2. The integrations band: the marks of what Purser connects to, drifting (src/redesign/integrations.ts).
//   2b. Works where your AI already works (the owner, 21 Nov): one animated flow, your AI to Purser to the money to the books.
//   3. The agents: four tiles, sourcing and negotiation, payables, treasury, support; each agent's own card and limit as
//      Airwallex read them back, each tile one link.
//   4. One proof row: a changed cent, Airwallex's decline, Alta's on-chain refusal, Visa's reused credential; each value
//      from its record, each tile one tap from it.
//   5. The judge tour's map: seven stops (src/redesign/tour.ts), the bar that walks them on every page of the tour.
//   6. How to start, in three steps: try it, look around as a guest, run a pilot.
// Cut on 21 Nov, each still on the site: the 60-second proof and its sponsor tracks (the proof row and the tour), the
// six controls and the flow of five steps (/security, /proof), the security review's links (/security, /privacy,
// the footer), every connection with its label (the band's link to the hub), the stat row and the core run's line
// (/proof, /alta). Every id, amount and date is read from the run records; nothing is typed in.

import { HOME_PREMIUM_CSS } from "../ui/premium.js";
import { readFileSync } from "node:fs";
import { VISA_REUSE_ID } from "./visaStory.js";
import { FILM_URL, CAVEAT_LINE, CHAIN_TEST, CORE_SENTENCE, DESIGN_PARTNER_URL, designPartnerHtml, BUSINESS_CASE_LINK, BUSINESS_DOCS, HERO, IDEA, WHY_COMPANY, WHY_COMPANY_NOTE_LAST } from "../config/brand.js";
import type { Awx1Record } from "../awx/scenario.js";
import { agentRun, type AgentRun } from "./run.js";
import { AWX_RUN_FILE, AWX_RUN_STEPS_ID, awxRun } from "./awxRun.js";
import { metalStory, REPO_BLOB } from "./metalStory.js";
import { heroDemoFacts } from "./heroDemo.js";
import { VAT_THEN } from "./heroFlow.js";
import { VIC3_RUN_FILE, VIC4_FILE, vic3Run, type Vic3Record } from "./vic3Run.js";
import { esc, icon, MAIN_RUN_REAL, page, TRY_URL } from "./ui.js";
import { SITE_URL } from "../ui/meta.js";
import { NEGOTIATE_URL, PURSER_CLOUD_MCP, PURSER_CLOUD_URL } from "../ui/more.js";
import { MONEY_FLOW_RECORDS, moneyFlowFacts, type MoneyFlowFacts } from "./moneyFlow.js";
import { LOGO_BAND_CSS, LOGO_BAND_JS, logoBandHtml } from "./integrations.js";
import { TOUR_ID, TOUR_MAP_CSS, TOUR_START_HREF, tourMapHtml } from "./tour.js";
import { HERO_WAVE_CSS, HERO_WAVE_HTML, HERO_WAVE_JS, WORKFLOW_JS, WORKFLOW_RECORD, heroStatsHtml, workflowHtml } from "./heroWave.js";

/** The hub of every connection Purser has, each labelled, with a quickstart (docs/integrations/README.md); in Home's footer. */
export const CONNECT_HUB_DOC = "docs/integrations/README.md", CONNECT_HUB_LABEL = "Connect to anything";

const CSS = `/* Home, 21 Nov: six parts on an 8 px grid, 1120 px wide, neutral greys and one accent; one heading per part. */
main.ent .wrap { max-width: 1120px; }
main.ent section { padding: 104px 0; }
main.ent section + section { border-top: 0; background-image: linear-gradient(90deg, transparent, var(--border) 18%, var(--border) 82%, transparent); background-size: 100% 1px; background-repeat: no-repeat; }
.eyebrow { margin: 0 0 14px; font: 600 12.5px/1.4 var(--mono); letter-spacing: .16em; text-transform: uppercase; color: var(--accent); }
.eyebrow:not(.cloud)::before { content: ""; display: inline-block; width: 22px; height: 1px; margin-right: 12px; vertical-align: .3em; background: linear-gradient(90deg, transparent, currentColor); }
.e-cen .eyebrow:not(.cloud)::after { content: ""; display: inline-block; width: 22px; height: 1px; margin-left: 12px; vertical-align: .3em; background: linear-gradient(90deg, currentColor, transparent); }
.e-h { margin: 0; font-size: clamp(30px, 3.6vw, 48px); line-height: 1.06; font-weight: 760; letter-spacing: -.035em; max-width: 20em; background: linear-gradient(180deg, var(--text) 40%, color-mix(in srgb, var(--text) 74%, var(--bg))) 0 0 / 100% 1.06em repeat-y; -webkit-background-clip: text; background-clip: text; color: transparent; }
/* One surface for every card on Home: a hairline border, a lit top edge, the same radius. */
ul.agents > li, ul.prow a, ol.steps3 > li:not(.pilot), .af-n:not(.af-purser) { background: linear-gradient(180deg, color-mix(in srgb, var(--accent) 4%, var(--surface)), var(--surface)); border-color: var(--border); box-shadow: var(--hi), 0 1px 2px rgba(16, 24, 40, .05), 0 24px 48px -36px rgba(0, 0, 0, .5); }
.e-sub { margin: 14px 0 0; font-size: 18px; line-height: 1.5; color: var(--muted); max-width: 36em; }
.e-cen { text-align: center; } .e-cen .e-h, .e-cen .e-sub { margin-left: auto; margin-right: auto; }
.btn.big { height: 54px; font-size: 16.5px; padding: 0 24px; gap: 8px; }
.btn.ghost:hover { border-color: color-mix(in srgb, var(--accent) 55%, var(--glass-line)); }

/* 1. The hero: the words, three figures and three buttons on the left; the Workflow card on the right; the product card
   from one /try run under both; the blue wave behind (src/redesign/heroWave.ts). */
main.ent section.e-hero { position: relative; padding: 88px 0 80px; overflow: hidden; }
.e-hero .h-hero span + span { filter: drop-shadow(0 6px 28px color-mix(in srgb, var(--accent) 35%, transparent)); }
/* The product card in a frame of its own: a pane of glass, lit from below. */
.e-hero .wrap { position: relative; display: grid; gap: 40px; align-items: center; }
.e-hero .wf { width: 100%; max-width: 500px; justify-self: center; }
@media (min-width: 1040px) { .e-hero .wrap { grid-template-columns: minmax(0, 1fr) minmax(0, 480px); column-gap: 56px; } .e-hero .wf { justify-self: end; } main.ent section.e-hero { padding: 56px 0 72px; } }
.e-biz { align-items: center; } .e-partner a { color: var(--accent); font-weight: 650; text-decoration: none; display: inline-flex; align-items: center; min-height: 44px; }
.e-hero p.cloud { margin: 0 0 24px; display: inline-flex; align-items: center; gap: 8px; padding: 7px 14px; border-radius: 999px; background: var(--glass); border: 1px solid color-mix(in srgb, var(--accent) 32%, transparent); box-shadow: 0 0 28px -8px var(--glow); letter-spacing: .16em; }
.e-hero p.cloud::before { content: ""; width: 7px; height: 7px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 10px var(--accent); }
.e-hero .h-hero { font-size: clamp(42px, 5.6vw, 64px); line-height: 1.02; letter-spacing: -.04em; font-weight: 790; } .e-hero .h-hero span { display: block; }
@media (min-width: 1040px) { .e-hero .h-hero { font-size: clamp(54px, 5vw, 72px); } .e-hero .h-hero span { white-space: nowrap; } }
.e-hero .h-hero span + span { background: var(--grad-text); -webkit-background-clip: text; background-clip: text; color: transparent; }
.e-hero .what { margin: 22px 0 0; font-size: 19.5px; line-height: 1.5; color: var(--muted); max-width: 30em; }
.e-tourgo { margin-top: 28px; }
/* The hierarchy (Max, 21 Nov): Try the one primary, the film the clear secondary, Pilot a quiet text link. */
.ctas .btn.pilot { background: none; border-color: transparent; box-shadow: none; padding: 0 10px; color: var(--muted); }
.ctas .btn.pilot:hover { color: var(--text); border-color: transparent; transform: none; }
.ctas .btn.pilot .i { transition: transform .2s ease; } .ctas .btn.pilot:hover .i { transform: translateX(3px); }
.ctas { margin: 32px 0 0; display: flex; flex-wrap: wrap; gap: 12px; }
.reassure { margin: 16px 0 0; display: flex; align-items: center; gap: 8px; font-size: 14.5px; color: var(--muted); }
.reassure .i { color: var(--ok); }
@media (prefers-reduced-motion: no-preference) {
  .e-hero .copy > * { animation: h-up .7s cubic-bezier(.2, .7, .2, 1) both; }
  .e-hero .copy > :nth-child(2) { animation-delay: .06s; } .e-hero .copy > :nth-child(3) { animation-delay: .12s; } .e-hero .copy > :nth-child(4) { animation-delay: .18s; } .e-hero .copy > :nth-child(5) { animation-delay: .24s; } .e-hero .copy > :nth-child(6) { animation-delay: .3s; }
  .e-hero .wf { animation: h-card 1s cubic-bezier(.2, .7, .2, 1) .1s both; }
}
@keyframes h-up { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
@keyframes h-card { from { opacity: 0; transform: translateY(24px) scale(.98); } to { opacity: 1; transform: none; } }
.hf-note { margin: 12px 0 0; font-size: 13.5px; color: var(--faint); }
.hf-note a { color: var(--accent); display: inline-flex; align-items: center; min-height: 44px; }

/* 2. The band, between the hero and the agents. */
main.ent section.e-band { padding: 40px 0 36px; background: var(--surface); }

/* 3. The agents: four tiles, each in its agent's colour, its own card as a chip. */
ul.agents { list-style: none; margin: 48px 0 0; padding: 0; display: grid; gap: 16px; }
@media (min-width: 720px) { ul.agents { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (min-width: 1100px) { ul.agents { grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 20px; } }
ul.agents > li { --ag: var(--accent); position: relative; display: flex; flex-direction: column; padding: 24px; border: 1px solid var(--border); border-radius: 20px; background: var(--surface); box-shadow: 0 1px 2px rgba(16, 24, 40, .04); overflow: hidden; transition: transform .25s ease, box-shadow .25s ease, border-color .25s ease; }
ul.agents > li::before { content: ""; position: absolute; inset: 0 0 auto 0; height: 120px; background: linear-gradient(180deg, color-mix(in srgb, var(--ag) 12%, transparent), transparent); pointer-events: none; }
ul.agents > li.ag-sourcing { --ag: var(--a-sourcing); } ul.agents > li.ag-support { --ag: var(--a-support); } ul.agents > li.ag-treasury { --ag: var(--a-treasury); } ul.agents > li.ag-payables { --ag: var(--ok); }
ul.agents > li:hover { border-color: color-mix(in srgb, var(--ag) 50%, var(--border)); box-shadow: 0 18px 40px -24px color-mix(in srgb, var(--ag) 70%, transparent); }
@media (prefers-reduced-motion: no-preference) { ul.agents > li:hover { transform: translateY(-3px); } }
ul.agents .ag-i { position: relative; width: 48px; height: 48px; border-radius: 14px; display: grid; place-items: center; color: var(--ag); background: var(--surface); border: 1px solid color-mix(in srgb, var(--ag) 30%, var(--border)); box-shadow: 0 6px 16px -10px color-mix(in srgb, var(--ag) 80%, transparent); }
ul.agents b.ag-t { position: relative; display: block; margin: 18px 0 8px; font-size: 19px; font-weight: 740; letter-spacing: -.015em; }
ul.agents p { position: relative; margin: 0; font-size: 15px; line-height: 1.5; color: var(--muted); flex: 1; }
ul.agents .ag-chip { margin: 18px 0 0; display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px; font-size: 13.5px; color: var(--muted); }
ul.agents .ag-chip .card { display: inline-flex; align-items: center; gap: 6px; padding: 5px 10px; border-radius: 999px; border: 1px solid var(--border); background: var(--sunken); color: var(--text); font-family: var(--mono, ui-monospace, monospace); font-size: 13px; box-shadow: none; }
ul.agents .ag-chip .card .i { color: var(--ag); }
ul.agents .steps { display: flex; flex-wrap: wrap; gap: 4px; }
ul.agents .steps span { padding: 4px 8px; border-radius: 8px; background: var(--sunken); font-size: 12.5px; font-weight: 650; color: var(--muted); }
ul.agents .steps span.you { background: var(--ag); color: var(--surface); }
ul.agents a.go { position: static; margin-top: 14px; display: inline-flex; align-items: center; gap: 6px; min-height: 44px; width: fit-content; color: var(--ag); font-size: 15px; font-weight: 680; text-decoration: none; }
/* The whole tile is its link (it lifts like one); its card chip opens its own record above it. */
ul.agents a.go::after { content: ""; position: absolute; inset: 0; border-radius: 20px; }
ul.agents a.ag-rec, ul.agents .ag-chip .steps { position: relative; z-index: 1; }
ul.agents a.ag-rec { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 6px 8px; min-height: 44px; color: inherit; text-decoration: none; } ul.agents a.ag-rec:hover .card { border-color: var(--ag); }
ul.agents a.go:hover, ul.agents a.go:focus-visible { text-decoration: underline; text-underline-offset: 3px; }
@media (prefers-reduced-motion: no-preference) { ul.agents a.go .i { transition: transform .2s ease; } ul.agents a.go:hover .i { transform: translateX(3px); } }
p.fine { margin: 20px 0 0; font-size: 13.5px; color: var(--faint); }

/* 4. One proof row: four tiles, each a link to its record. */
ul.prow { list-style: none; margin: 48px 0 0; padding: 0; display: grid; gap: 16px; }
@media (min-width: 720px) { ul.prow { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (min-width: 1100px) { ul.prow { grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 20px; } }
ul.prow a { --pc: var(--accent); height: 100%; box-sizing: border-box; display: flex; flex-direction: column; gap: 8px; padding: 22px 22px 18px; border: 1px solid var(--border); border-radius: 20px; background: var(--surface); color: var(--text); text-decoration: none; transition: border-color .2s ease, box-shadow .2s ease; }
ul.prow li.p-awx a { --pc: var(--awx); } ul.prow li.p-alta a { --pc: var(--metal); } ul.prow li.p-visa a { --pc: #1a1f71; } ul.prow li.p-cent a { --pc: var(--bad); }
:root[data-theme="dark"] ul.prow li.p-visa a { --pc: #8fa3ff; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) ul.prow li.p-visa a { --pc: #8fa3ff; } }
ul.prow a:hover, ul.prow a:focus-visible { border-color: var(--pc); box-shadow: 0 16px 36px -24px var(--pc); }
ul.prow .pk { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: var(--pc); }
ul.prow .pv { font-size: 30px; line-height: 1.1; font-weight: 780; letter-spacing: -.025em; font-variant-numeric: tabular-nums; }
ul.prow .pd { font-size: 14.5px; line-height: 1.45; color: var(--muted); flex: 1; }
ul.prow .pr { margin-top: 6px; display: flex; align-items: center; gap: 6px; font-size: 13px; color: var(--faint); }
ul.prow .pr code { font-family: var(--mono, ui-monospace, monospace); font-size: 12.5px; color: var(--pc); }
ul.prow .tag { margin-left: auto; padding: 2px 8px; border-radius: 999px; background: var(--sunken); color: var(--muted); font-size: 12px; font-weight: 650; white-space: nowrap; }
.e-more { margin: 36px 0 0; display: flex; flex-wrap: wrap; gap: 12px; }
.e-cen .e-more { justify-content: center; }

/* 6. How to start: three steps on one line that draws itself, the third the pilot. */
ol.steps3 { list-style: none; margin: 56px 0 0; padding: 0; display: grid; gap: 16px; position: relative; }
@media (min-width: 900px) { ol.steps3 { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 24px; } }
ol.steps3 > li { position: relative; display: flex; flex-direction: column; align-items: flex-start; padding: 28px 24px 22px; border: 1px solid var(--border); border-radius: 22px; background: var(--surface); box-shadow: 0 1px 2px rgba(16, 24, 40, .04); }
ol.steps3 > li.pilot { border-color: transparent; background: linear-gradient(var(--surface), var(--surface)) padding-box, linear-gradient(135deg, var(--accent), var(--a-support), var(--a-treasury)) border-box; border: 1.5px solid transparent; box-shadow: 0 24px 48px -28px var(--glow); }
ol.steps3 .si { position: relative; width: 56px; height: 56px; border-radius: 18px; display: grid; place-items: center; color: #fff; background: var(--grad); box-shadow: 0 10px 24px -12px var(--glow); }
ol.steps3 .si em { position: absolute; right: -8px; top: -8px; width: 24px; height: 24px; border-radius: 50%; display: grid; place-items: center; background: var(--surface); color: var(--text); border: 1px solid var(--border); font: 750 12.5px/1 Inter, system-ui, sans-serif; font-style: normal; }
ol.steps3 b.st { margin: 20px 0 6px; font-size: 20px; font-weight: 750; letter-spacing: -.015em; }
ol.steps3 p { margin: 0; font-size: 15px; line-height: 1.5; color: var(--muted); }
ol.steps3 .go { margin-top: auto; padding-top: 16px; display: flex; flex-wrap: wrap; gap: 4px 16px; }
ol.steps3 .go a, ol.steps3 p.partner a { color: var(--accent); font-weight: 680; font-size: 15px; text-decoration: none; display: inline-flex; align-items: center; gap: 6px; min-height: 44px; }
ol.steps3 .go a:hover, ol.steps3 p.partner a:hover { text-decoration: underline; text-underline-offset: 3px; }
ol.steps3 p.partner { margin: 0; color: inherit; }
ol.steps3 .tagline { margin: 10px 0 0; display: inline-flex; align-items: center; gap: 6px; padding: 3px 10px; border-radius: 999px; background: var(--sunken); font-size: 12.5px; font-weight: 650; color: var(--muted); }
@media (min-width: 900px) {
  ol.steps3::before { content: ""; position: absolute; top: 55px; left: calc(16.66% + 4px); right: calc(16.66% + 4px); height: 2px; background: repeating-linear-gradient(90deg, var(--border) 0 8px, transparent 8px 14px); z-index: 0; }
  ol.steps3 > li { z-index: 1; }
}
@media (prefers-reduced-motion: no-preference) {
  ol.steps3 .si { transition: transform .3s cubic-bezier(.2, .7, .2, 1); }
  ol.steps3 > li:hover .si { transform: translateY(-3px) rotate(-4deg); }
}
p.ask { margin: 28px 0 0; font-size: 15px; color: var(--muted); }
p.ask a { color: var(--accent); font-weight: 650; text-decoration: none; display: inline-flex; align-items: center; gap: 6px; min-height: 44px; }
p.ask a:hover { text-decoration: underline; }

/* Scroll-in: a part still below the screen once the reader scrolls rises in as it comes into view; every part is shown
   by default (no blank part for a screenshot or no script); nothing moves for a reader who prefers less motion. */
@media (prefers-reduced-motion: no-preference) {
  .reveal.pre { opacity: 0; transform: translateY(18px); transition: opacity .6s ease, transform .6s cubic-bezier(.2, .7, .2, 1); }
  .reveal.pre.in { opacity: 1; transform: none; }
  ul.agents > li.reveal.pre:nth-child(2), ul.prow > li.reveal.pre:nth-child(2), ol.steps3 > li.reveal.pre:nth-child(2) { transition-delay: .08s; }
  ul.agents > li.reveal.pre:nth-child(3), ul.prow > li.reveal.pre:nth-child(3), ol.steps3 > li.reveal.pre:nth-child(3) { transition-delay: .16s; }
  ul.agents > li.reveal.pre:nth-child(4), ul.prow > li.reveal.pre:nth-child(4) { transition-delay: .24s; }
}
@media (max-width: 640px) {
  main.ent section { padding: 64px 0; } main.ent section.e-hero { padding: 22px 0 48px; } main.ent section.e-band { padding: 28px 0 24px; }
  /* A phone (Max, 21 Nov): a compact hero, Try large, the other two small side by side, the Workflow card early. */
  .e-hero .wrap { gap: 28px; }
  .e-hero p.cloud { margin-bottom: 14px; padding: 5px 11px; font-size: 11px; letter-spacing: .14em; }
  .e-hero .h-hero { font-size: clamp(34px, 9.6vw, 40px); }
  .e-hero .what { display: none; }
  ul.hstats { margin-top: 16px; } ul.hstats b { font-size: 24px; }
  .ctas { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 8px; margin-top: 18px; }
  .ctas .btn { width: 100%; justify-content: center; }
  .ctas .btn.primary { grid-column: 1 / -1; }
  .ctas .btn.ghost { height: 44px; min-height: 44px; padding: 0 10px; font-size: 14.5px; gap: 6px; }
  main.ent .e-hero .ctas .btn.ghost { min-height: 44px; }
  .reassure { margin-top: 12px; font-size: 13.5px; }
  .e-sub { font-size: 16.5px; }
  ul.agents { margin-top: 32px; } ul.agents > li { padding: 20px; }
  ul.prow { margin-top: 32px; } ul.prow .pv { font-size: 26px; }
  ol.steps3 { margin-top: 36px; } ol.steps3 > li { display: grid; grid-template-columns: 48px minmax(0, 1fr); column-gap: 16px; padding: 20px 18px 14px; }
  ol.steps3 .si { grid-row: 1 / span 4; width: 48px; height: 48px; border-radius: 14px; } ol.steps3 .si .i { width: 22px; height: 22px; }
  ol.steps3 b.st { margin: 2px 0 4px; font-size: 18px; } ol.steps3 .tagline { justify-self: start; } ol.steps3 .go { padding-top: 8px; }
  .e-hero::before { inset: -10% -40% auto 20%; height: 60%; opacity: .7; }
  .e-more .btn { flex: 1 1 100%; justify-content: center; min-width: 0; max-width: 100%; white-space: normal; height: auto; min-height: 54px; padding-top: 12px; padding-bottom: 12px; text-align: center; line-height: 1.25; }
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
  // "What's real?" (the card's note) opens the footer's fold of the same name.
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
 * that says it is not validated (WHY_COMPANY, WHY_COMPANY_NOTE). On /proof.
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
 * The idea in one sentence (15 Nov, Founder's and Judges' Choice: one sharp idea, understood in 10 seconds). The same
 * sentence opens the README (test/first-screen.test.ts holds the two equal).
 */
export const HOME_SUB = IDEA;
/** Purser Cloud first (the owner, 20 Nov); 21 Nov (Max: "it's for companies in general"), not only finance teams; the
 * owner's concept (21 Nov): "PURSER CLOUD · FOR COMPANIES", in capitals by its style. */
export const CLOUD_EYEBROW = "Purser Cloud · for companies";
/**
 * The hero's three buttons (the owner's concept, 21 Nov: "clear Try / Demo / Pilot actions"): the hands-on demo
 * (TRY_URL, the one primary), the film, and the three steps to a pilot on this page. The judge tour's button
 * (src/redesign/tour.ts) moved to the judge tour's own part, under its map.
 */
export const TOUR_BUTTON = "Start the judge tour";
export const START = "Try it";
export const WATCH_BUTTON = "Watch the demo";
export const PILOT_CTA = "Start a pilot";
/** "What is not finished" (review, 21 Nov), in Home's footer: /security's own list. */
export const NOT_FINISHED = ["security#not-finished", "What is not finished"] as const;
// Site audit, 20 Nov (finding 6.3): a short sandbox disclosure beside the buttons.
export const SANDBOX_NOTE = "Sandbox demo: test money, no real settlement.";
/** The line under the buttons, with /try/sign in the bundle or not (both keys kept for the callers). */
export const REASSURE = { sign: SANDBOX_NOTE, world: SANDBOX_NOTE } as const;
/** The link in the card's note: it opens the footer's fold of the same name. */
export const WHATS_REAL = "What's real?";

/** The emergency stop's drill (20 Nov, the Airwallex sandbox, a labelled virtual test passkey). */
export const STOP_DRILL_RECORD = "docs/runs/2026-11-20-stop-drill.json", STOP_DRILL_DOC = "docs/runs/2026-11-20-stop-drill.md";
const repoFile = (f: string) => readFileSync(new URL(`../../${f}`, import.meta.url), "utf8");

interface StopStep { id: string; pass: boolean; facts?: { changed?: unknown; failure_reason?: string } | null }
interface StopDrill { test_money?: boolean; cards: { agent: string }[]; passes: { stopped: unknown; timings?: { fully_blocked_ms?: number } | null; steps: StopStep[] }[] }
export interface StopFacts { agents: number; seconds: string; passes: number }
/**
 * From the stop drill's record: every pass whose stop was pulled (stop.pull passed, every agent's card changed) and whose
 * checks after it all blocked, at least one a charge Airwallex declined as CARD_INACTIVE; the time from the stop to all
 * blocked, as each pass measured it (review, 21 Nov: the record has two such passes, 3.50 s and 3.35 s; one of them
 * stopped later on an unrelated step, which the drill's own page says). "3.4–3.5" for two, "3.4" for one.
 */
export function stopDrillFacts(rec: StopDrill | null = (() => { try { return JSON.parse(repoFile(STOP_DRILL_RECORD)) as StopDrill; } catch { return null; } })()): StopFacts | null {
  if (!rec?.test_money) return null;
  const ok = rec.passes.flatMap((p) => {
    const pull = p.steps.find((s) => s.id === "stop.pull" && s.pass);
    const blocked = p.steps.filter((s) => s.id.startsWith("blocked."));
    const changed = pull?.facts?.changed, ms = p.timings?.fully_blocked_ms;
    if (!pull || !blocked.length || !blocked.every((s) => s.pass) || !Array.isArray(changed) || changed.length !== rec.cards.length || typeof ms !== "number") return [];
    if (!blocked.some((s) => s.id === "blocked.charge" && s.facts?.failure_reason === "CARD_INACTIVE")) return [];
    return [{ agents: changed.length, ms }];
  });
  if (!ok.length) return null;
  const lo = Math.min(...ok.map((p) => p.ms)) / 1000, hi = Math.max(...ok.map((p) => p.ms)) / 1000;
  const seconds = lo.toFixed(1) === hi.toFixed(1) ? lo.toFixed(1) : `${lo.toFixed(1)}–${hi.toFixed(1)}`;
  return { agents: ok[0]!.agents, seconds, passes: ok.length };
}

/**
 * Works where your AI already works (the owner, 21 Nov: Airwallex's own app is in ChatGPT now, so "position Purser as
 * the control layer for exactly that"; "think like a business": plain words, one animated flow, no jargon on the first
 * screen). One flow of four steps, said for a business owner: your AI (ChatGPT, Claude, Cursor and any client of
 * Purser's MCP server) reads and proposes; Purser holds the limits in code and you sign above them with a passkey; the
 * rails pay; the books post to T:0. What Airwallex did is said as its own release notes say it (AgentOS in ChatGPT,
 * "New at Airwallex: November 2026 Edition", 12 Nov); Purser does not plug into Airwallex's app. The protocol, the
 * address and the Airwallex read-only server (built, not yet run live: cloud/src/connections.ts) are in the small print.
 */
export const AI_ID = "ai";
export const AI_HEAD = "Works where your AI already works.";
export const AI_SUB = "Airwallex now reaches agents in ChatGPT. Purser adds the controls a company needs around them.";
/** Purser Cloud's page with each AI's set-up (cloud/src/claude/routes.ts serves /connect-ai). */
export const AI_CONNECT_URL = `${PURSER_CLOUD_URL}connect-ai`;
export const AI_AIRWALLEX_MCP = `${PURSER_CLOUD_URL}mcp/airwallex`;
/** 21 Nov (Max: "add a connect to GitHub and Claude"): connect Claude (or another AI) to Purser, and the code on GitHub. */
export const CONNECT_CLAUDE = "Connect Claude";
export const GITHUB_BUTTON = "The code on GitHub";
export const REPO_URL = "https://github.com/agamemnon-coder/x402-business-agents";
export interface AiStep { key: string; icon: string; title: string; what: string; marks?: readonly { file: string; name: string }[]; tags?: readonly string[] }
export const AI_STEPS: readonly AiStep[] = [
  { key: "ai", icon: "sparkles", title: "Your AI", what: "Reads and proposes", marks: [{ file: "brand-chatgpt.svg", name: "ChatGPT" }, { file: "brand-claude.svg", name: "Claude" }, { file: "brand-cursor.svg", name: "Cursor" }] },
  { key: "purser", icon: "feather", title: "Purser", what: "Checks every payment", tags: ["Limits in code", "Your passkey above"] },
  { key: "rails", icon: "landmark", title: "The money", what: "Moves inside them", tags: ["Airwallex", "Alta", "Card"] },
  { key: "books", icon: "database", title: "The books", what: "Booked, read back", tags: ["T:0"] },
];
export function aiFlowHtml(): string {
  const step = (s: AiStep, i: number) => `<li class="af-n af-${s.key}"><span class="af-i">${icon(s.icon, 20)}</span><b>${esc(s.title)}</b><small>${esc(s.what)}</small>${s.marks ? `<span class="af-m">${s.marks.map((m) => `<img src="assets/${m.file}" alt="${esc(m.name)}" width="24" height="24" decoding="async">`).join("")}<em>+ any</em></span>` : ""}${s.tags ? `<span class="af-t">${s.tags.map((t) => `<i>${esc(t)}</i>`).join("")}</span>` : ""}${i < AI_STEPS.length - 1 ? '<span class="af-c" aria-hidden="true"><span></span></span>' : ""}</li>`;
  return `<p class="eyebrow">${esc("How it works")}</p>
  <h2 class="e-h" id="h-ai">${esc(AI_HEAD)}</h2>
  <p class="e-sub">${esc(AI_SUB)}</p>
  <ol class="aflow" aria-label="${esc("From your AI to your books: your AI proposes, Purser holds the limits and you sign above them, the money moves, the books are booked")}">${AI_STEPS.map(step).join("")}</ol>
  <p class="af-fine">${esc("Any MCP client:")} <code>${esc(PURSER_CLOUD_MCP.replace(/^https:\/\//, ""))}</code> ${esc("(demo company, read only). Airwallex sandbox reader: built, not yet run live.")} <a href="${esc(AI_CONNECT_URL)}" target="_blank" rel="noopener">${esc("Set-up for each AI")}${icon("external-link", 14)}</a></p>`;
}
const AI_CSS = `
/* Works where your AI already works: four steps on one line, a dot running between them. */
ol.aflow { list-style: none; margin: 48px 0 0; padding: 0; display: grid; gap: 14px; }
@media (min-width: 900px) { ol.aflow { grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 40px; } }
.af-n { position: relative; display: flex; flex-direction: column; align-items: flex-start; gap: 4px; padding: 22px 20px; border: 1px solid var(--border); border-radius: 20px; background: var(--surface); box-shadow: 0 1px 2px rgba(16, 24, 40, .04); }
.af-n b { margin-top: 12px; font-size: 18px; font-weight: 740; letter-spacing: -.01em; }
.af-n small { font-size: 14.5px; color: var(--muted); line-height: 1.4; }
.af-i { width: 44px; height: 44px; border-radius: 13px; display: grid; place-items: center; background: var(--accent-soft); color: var(--accent); }
.af-purser { border-color: transparent; background: linear-gradient(var(--surface), var(--surface)) padding-box, linear-gradient(135deg, var(--accent), var(--a-support)) border-box; border: 1.5px solid transparent; box-shadow: 0 18px 40px -24px var(--glow); }
.af-purser .af-i { background: var(--text); color: var(--bg); }
.af-m { margin-top: 10px; display: flex; align-items: center; gap: 6px; }
.af-m img { width: 30px; height: 30px; padding: 5px; box-sizing: border-box; border-radius: 9px; background: #ffffff; border: 1px solid #e4e7ec; }
.af-m em { font-style: normal; font-size: 12.5px; font-weight: 650; color: var(--faint); margin-left: 2px; }
.af-t { margin-top: 10px; display: flex; flex-wrap: wrap; gap: 6px; }
.af-t i { font-style: normal; padding: 3px 9px; border-radius: 999px; background: var(--sunken); font-size: 12.5px; font-weight: 650; color: var(--muted); }
.af-purser .af-t i { background: var(--accent-soft); color: var(--accent); }
/* The connector: a line to the next step, a dot running along it (down on a phone, across from 900 px). */
.af-c { position: absolute; left: 41px; top: 100%; width: 2px; height: 14px; background: var(--border); overflow: hidden; }
.af-c span { position: absolute; left: -2px; top: -6px; width: 6px; height: 6px; border-radius: 50%; background: var(--accent); }
@media (min-width: 900px) { .af-c { left: 100%; top: 43px; width: 40px; height: 2px; } .af-c span { top: -2px; left: -6px; } }
@media (prefers-reduced-motion: no-preference) {
  .af-c span { animation: af-down 2.4s ease-in-out infinite; }
  .af-n:nth-child(2) .af-c span { animation-delay: .8s; } .af-n:nth-child(3) .af-c span { animation-delay: 1.6s; }
  .af-purser .af-i { animation: af-pulse 2.4s ease-in-out infinite; }
}
@media (prefers-reduced-motion: no-preference) and (min-width: 900px) { .af-c span { animation-name: af-across; } }
@keyframes af-down { 0% { transform: translateY(0); } 60%, 100% { transform: translateY(20px); } }
@keyframes af-across { 0% { transform: translateX(0); } 60%, 100% { transform: translateX(46px); } }
@keyframes af-pulse { 0%, 100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--accent) 45%, transparent); } 50% { box-shadow: 0 0 0 9px transparent; } }
p.af-fine { margin: 24px 0 0; font-size: 13.5px; line-height: 1.6; color: var(--faint); max-width: 60em; }
p.af-fine code { font-family: var(--mono, ui-monospace, monospace); font-size: 12.5px; color: var(--muted); }
p.af-fine a { color: var(--accent); font-weight: 650; text-decoration: none; display: inline-flex; align-items: center; gap: 5px; min-height: 44px; }
p.af-fine a:hover { text-decoration: underline; }
@media (max-width: 899px) { .af-n { display: grid; grid-template-columns: 44px minmax(0, 1fr); column-gap: 14px; row-gap: 2px; align-items: center; padding: 16px; } .af-i { grid-row: 1 / span 2; } .af-n b { margin: 0; font-size: 17px; } .af-m, .af-t { grid-column: 2; margin-top: 6px; } }
`;

export interface RosterAgent { id: string; name: string; last4: string; currency: string; perTx: string; monthly: string; altaCap: string | null }
/**
 * The three agents, each with its own card and limits as Airwallex returned them (awx-1's read-back) and, where the
 * core run's record has it, its mandate cap on Alta. No card read back: no roster.
 */
export function agentRoster(awx: Awx1Record | null = awxRun(), run: AgentRun = agentRun()): RosterAgent[] {
  const agents = ((run.record as unknown as { snapshot?: { agents?: { id: string; name: string; mandate?: { cap?: string } }[] } }).snapshot?.agents) ?? [];
  const name = (id: string) => agents.find((a) => a.id === id)?.name ?? `${id[0]!.toUpperCase()}${id.slice(1)} agent`;
  return (awx?.cards ?? []).flatMap((c) => {
    const rb = c.read_back as { per_tx?: unknown; monthly?: unknown; currency?: unknown; last4?: unknown; status?: unknown };
    if (typeof rb.per_tx !== "string" || typeof rb.monthly !== "string" || typeof rb.currency !== "string" || typeof rb.last4 !== "string" || rb.status !== "ACTIVE") return [];
    const cap = agents.find((a) => a.id === c.agent)?.mandate?.cap;
    return [{ id: c.agent, name: name(c.agent), last4: rb.last4, currency: rb.currency, perTx: rb.per_tx, monthly: rb.monthly, altaCap: typeof cap === "string" ? cap : null }];
  });
}
export const ROSTER_RECORDS = "docs/demo/airwallex-run.json docs/demo/main-run.json";
/** Under the tiles: what the card chips are. */
export const ROSTER_NOTE = "Each card and its limit as Airwallex read them back (sandbox).";

/**
 * The agents (Max, 21 Nov: "I don't see the negotiation agents and other features we have"): four tiles. Sourcing with
 * the negotiation on /try/negotiate; the payables chain (src/ap/: reader, checker, coder, payer; the CFO signs); Treasury
 * with the stop drill; Support. Each job in the words of src/config/brand.ts AGENT_DISPLAY; a card chip only from the
 * Airwallex read-back; the stop's figure only from its record.
 */
export const AGENTS_EYEBROW = "The agents";
export const AGENTS_HEAD = "Agents for every money job. You keep the signature.";
export const NEGOTIATE_BUTTON = "See them negotiate";
export interface AgentTile { id: "sourcing" | "payables" | "treasury" | "support"; icon: string; title: string; text: string; href: string; link: string; external?: boolean; rec?: string; steps?: readonly string[] }
/** The payables chain's five steps and who takes each (src/ap/: the reader, the checker, the coder and the payer; you sign). */
export const PAYABLES_STEPS = ["Read", "Check", "Code", "Sign", "Pay"] as const;
export const PAYABLES_WHO: Readonly<Record<(typeof PAYABLES_STEPS)[number], string>> = { Read: "Reader agent (Claude)", Check: "Checker agent (Claude) decides, code enforces the limits", Code: "Coder agent (Claude) books account and VAT", Sign: "You, with a passkey", Pay: "Payer agent (Claude) proposes, the rail and code enforce" };
export function agentTiles(stop: StopFacts | null = stopDrillFacts()): AgentTile[] {
  const words = ["no", "one", "two", "three", "four", "five"];
  return [
    { id: "sourcing", icon: "package", title: "Sourcing and negotiation", text: "Buys data per query over x402, under its Alta mandate. Two agents negotiate a deal; code holds the limits, you sign it.", href: NEGOTIATE_URL, link: NEGOTIATE_BUTTON, external: true },
    { id: "payables", icon: "receipt", title: "Payables", text: "Reads, checks and books each supplier invoice. Above the limit you sign the exact terms with a passkey.", href: TRY_URL, link: "Try it", steps: PAYABLES_STEPS },
    { id: "treasury", icon: "landmark", title: "Treasury", text: `Watches spending, sweeps earnings to Airwallex, pays in EUR after your sign-off.${stop ? ` One signed stop froze all ${words[stop.agents] ?? stop.agents} agents' cards in ${stop.seconds} s${stop.passes > 1 ? ` (${words[stop.passes] ?? stop.passes} passes)` : ""}.` : ""}`, href: stop ? `${REPO_BLOB}${STOP_DRILL_DOC}` : "agents/treasury", link: stop ? "The stop drill" : "Its run", external: !!stop, ...(stop ? { rec: STOP_DRILL_RECORD } : {}) },
    { id: "support", icon: "headphones", title: "Support", text: "Refunds customers when a dispute holds, inside its own card limit and its mandate on Alta.", href: "agents/support", link: "Its run" },
  ];
}
export function agentsHtml(tiles: AgentTile[] = agentTiles(), roster: RosterAgent[] = agentRoster()): string {
  const card = (id: string) => {
    const a = roster.find((r) => r.id === id);
    // The card and its limit open the record Airwallex read them back into (Max, 21 Nov: every figure to its source).
    return a ? `<a class="ag-rec" href="${esc(`${REPO_BLOB}${ROSTER_RECORDS.split(" ")[0]}`)}" target="_blank" rel="noopener" title="${esc(ROSTER_NOTE)}"><span class="card">${icon("credit-card", 14)}••${esc(a.last4)}</span><span>${esc(`${a.currency} ${a.perTx} a purchase`)}</span></a>` : "";
  };
  const chip = (t: AgentTile) => t.steps ? `<span class="steps">${t.steps.map((s) => `<span title="${esc(PAYABLES_WHO[s as keyof typeof PAYABLES_WHO] ?? s)}"${s === "Sign" ? ' class="you"' : ""}>${esc(s)}</span>`).join("")}</span>` : card(t.id);
  return `<ul class="agents">${tiles.map((t) => {
    const c = chip(t);
    return `<li class="reveal ag-${t.id}"${t.rec ? ` data-rec="${esc(t.rec)}"` : !t.steps && c ? ` data-rec="${esc(ROSTER_RECORDS)}"` : ""}><span class="ag-i">${icon(t.icon, 22)}</span><b class="ag-t">${esc(t.title)}</b><p>${esc(t.text)}</p>${c ? `<span class="ag-chip">${c}</span>` : ""}<a class="go" href="${esc(t.href)}"${t.external ? ' target="_blank" rel="noopener"' : ""}>${esc(t.link)}${icon(t.external ? "external-link" : "arrow-right", 16)}</a></li>`;
  }).join("")}</ul>${roster.length ? `<p class="fine" data-rec="${esc(ROSTER_RECORDS)}">${esc(ROSTER_NOTE)}</p>` : ""}`;
}

export interface ProofRow { partner: "Airwallex" | "Alta" | "Visa"; title: string; text: string; icon: string; id: string; full: string; href: string; external: boolean; /** The record the row is read from. */ rec: string; /** Airwallex's row: the declined charge and the card's limit, as the record holds them. */ charge?: { currency: string; amount: string; limit: string } }

/**
 * The three partner proofs, every value from a run record; a row whose record lacks a piece drops out.
 * 1. Airwallex declined an agent's card over its limit (the Airwallex-only run: the declined charge and the card's
 *    limit as Airwallex returned it), to the site's section with Airwallex's record of it.
 * 2. Alta refused a purchase on chain (the main run), to the transaction on Alta's testnet explorer.
 * 3. Visa Intelligent Commerce: a reused credential refused by Purser, which the sandbox had accepted (vic-4, vic-3), to /visa.
 */
export function proofRows(run: AgentRun = agentRun(), awx: Awx1Record | null = awxRun(), vic3: Vic3Record | null = vic3Run()): ProofRow[] {
  const rows: ProofRow[] = [];
  const steps = `airwallex#${AWX_RUN_STEPS_ID}`;
  const cents = (a: string) => Math.round(Number(a) * 100);
  const limitOf = (agent: string) => String(awx?.cards.find((c) => c.agent === agent)?.read_back.per_tx ?? "");
  const decline = awx?.card_transactions.find((t) => !t.approved && !!t.decline_code && !!limitOf(t.agent) && cents(t.amount) > cents(limitOf(t.agent)));
  if (decline) rows.push({ partner: "Airwallex", title: "Airwallex declined the card", text: `${decline.currency} ${decline.amount} over a ${limitOf(decline.agent)} limit.`, icon: "ban", id: `${decline.id.slice(0, 8)}…`, full: decline.id, href: steps, external: false, rec: AWX_RUN_FILE, charge: { currency: decline.currency, amount: decline.amount, limit: limitOf(decline.agent) } });
  const refusal = metalStory(run.record).refusal;
  const tx = /\/tx\/(0x[0-9a-f]{64})$/.exec(refusal?.proof.href ?? "")?.[1];
  if (refusal && tx && refusal.code === "mandate_cap_exceeded") rows.push({ partner: "Alta", title: "Alta refused it on chain", text: "Over its cap.", icon: "link-2", id: refusal.proof.label, full: tx, href: refusal.proof.href!, external: true, rec: run.file });
  // Visa Intelligent Commerce (Visa judge, 14 Nov: the outcome was buried): a reused credential, refused by Purser's
  // credential check before any Airwallex call (vic-4 F2, docs/runs/2026-11-13-vic-4.json), where the Airi/Airwallex
  // sandbox had accepted it (vic-3); to /visa's section that sets the two side by side.
  const f2 = vic3?.purchases.find((p) => p.step === "F2" && p.outcome?.code === "PURSER_CREDENTIAL_ALREADY_USED" && p.calls.airwallex === 0 && p.mandate_id);
  if (f2?.mandate_id) rows.push({ partner: "Visa", title: "Visa: reused credential refused", text: "Purser binds each credential to one purchase.", icon: "credit-card", id: `${f2.mandate_id.slice(0, 10)}…`, full: f2.mandate_id, href: `visa#${VISA_REUSE_ID}`, external: false, rec: `${VIC4_FILE} ${VIC3_RUN_FILE}` });
  return rows;
}

/** The proof row (21 Nov): the changed cent first (the idea itself, /try's two proof files), then the three partners. */
export const PROOF_EYEBROW = "Proof";
export const PROOF_HEAD = "Every claim, one tap from its record.";
export const PROOF_BUTTON = "See all the proof";
export const VERIFY_BUTTON = "Verify a payment yourself";
export const VERIFY_URL = "/verify";
export interface ProofTile { cls: string; key: string; icon: string; value: string; text: string; tag: string; href: string; external?: boolean; rec?: string; id?: string }
export function proofTiles(rows: ProofRow[] = proofRows(), mf: MoneyFlowFacts | null = moneyFlowFacts(), verifyUrl = VERIFY_URL): ProofTile[] {
  const out: ProofTile[] = [];
  if (mf?.cent) out.push({ cls: "p-cent", key: "Passkey", icon: "scan-face", value: `+${mf.cent.currency} 0.01`, text: "changed after the CFO signed: the signature broke and nothing was paid.", tag: "test money", href: verifyUrl || "proof", rec: MONEY_FLOW_RECORDS.join(" ") });
  const by = (p: ProofRow["partner"]) => rows.find((r) => r.partner === p);
  const a = by("Airwallex"), m = by("Alta"), v = by("Visa");
  if (a?.charge) out.push({ cls: "p-awx", key: "Airwallex", icon: "ban", value: `${a.charge.currency} ${a.charge.amount}`, text: `declined: an agent's card charge over its ${a.charge.currency} ${a.charge.limit} limit.`, tag: "sandbox", href: a.href, id: a.id, rec: a.rec });
  if (m) out.push({ cls: "p-alta", key: "Alta", icon: "link-2", value: "Over cap", text: "refused on chain by Alta, with our own check off for a test.", tag: "testnet", href: m.href, external: true, id: m.id, rec: m.rec });
  if (v) out.push({ cls: "p-visa", key: "Visa", icon: "credit-card", value: "Reused", text: "a credential used twice: refused before any Airwallex call.", tag: "sandbox", href: v.href, id: v.id, rec: v.rec });
  return out;
}
export function proofRowHtml(tiles: ProofTile[] = proofTiles()): string {
  if (!tiles.length) return "";
  return `<ul class="prow">${tiles.map((t) => `<li class="reveal ${t.cls}"${t.rec ? ` data-rec="${esc(t.rec)}"` : ""}><a href="${esc(t.href)}"${t.external ? ' target="_blank" rel="noopener"' : ""}><span class="pk">${icon(t.icon, 16)}${esc(t.key)}</span><span class="pv">${esc(t.value)}</span><span class="pd">${esc(t.text)}</span><span class="pr">${t.id ? `${icon(t.external ? "external-link" : "file-check", 13)}<code>${esc(t.id)}</code>` : `${icon("shield-check", 13)}${esc("Verify it")}`}<span class="tag">${esc(t.tag)}</span></span></a></li>`).join("")}</ul>`;
}

/** The judge tour's part (src/redesign/tour.ts): the map of its seven stops. */
export const TOUR_EYEBROW = "For judges";
export const TOUR_HEAD = "The judge tour";
export const TOUR_SUB = "Seven stops. A bar at the foot of each page takes you to the next.";

/**
 * How to start (Max, 21 Nov: "'Try a pilot': what a long, boring page… The steps need to be prettier; it's the small
 * details"): three steps, an icon and one line each, one link each (the pilot adds the design-partner link). As Purser
 * Cloud works today (cloud/src/console.ts, docs/cloud.md): /try makes a test company that the sweep deletes after 24 hours
 * (cloud/src/try/sweep.ts); "Try as guest" opens the demo company read only, with no passkey and no e-mail (POST
 * /v1/auth/guest); a pilot company is created by Purser (POST /v1/admin/tenants), which hands over a starter key; its
 * owner makes a passkey at #/start. The deployment runs on test money; no customer is claimed.
 */
export const PILOT_BUTTON = "Run a pilot";
/** Purser Cloud's console on its test-money deployment: the demo company as a guest, and a new company's first run. */
export const CLOUD_GUEST_URL = `${PURSER_CLOUD_URL}#/guest`;
export const CLOUD_SETUP_URL = `${PURSER_CLOUD_URL}#/start`;
export interface StartStep { icon: string; title: string; text: string; tag: string; links: { href: string; label: string; external?: boolean }[]; pilot?: boolean }
export const START_STEPS: readonly StartStep[] = [
  { icon: "zap", title: "Try it now", text: "Your own test company: an agent proposes, you sign with a passkey.", tag: "2 minutes · deleted after 24 h", links: [{ href: TRY_URL, label: "Open /try" }] },
  { icon: "layout-dashboard", title: "Explore the console", text: "Purser Cloud with its demo company, as a guest. No sign-up.", tag: "Read only", links: [{ href: CLOUD_GUEST_URL, label: "Open the console", external: true }] },
  { icon: "rocket", title: PILOT_BUTTON, text: "We set up your company and send a starter key; you add your passkey.", tag: "Test money · no real payments yet", links: [{ href: CLOUD_SETUP_URL, label: "Have a starter key?", external: true }], pilot: true },
];
/**
 * The route from Home to /business (Max, 21 Nov: "a clearly visible route from Home to the commercial value
 * proposition", not only More and the footer): one button under the three steps, where the pilot is; outside the hero.
 */
export const BUSINESS_BUTTON = "For companies: the 30-day pilot";
export const BUSINESS_HREF = "business";

/**
 * "Ask Purser" (the owner, 20 Nov): a chat on Purser Cloud at /ask, built there; Home only links it, no chat code here.
 */
export const ASK_URL = `${PURSER_CLOUD_URL}ask`;
export const ASK_LABEL = "Ask Purser";
export function askHtml(url: string = ASK_URL): string {
  return `<p class="ask">${esc("Questions first?")} <a href="${esc(url)}" target="_blank" rel="noopener">${esc(ASK_LABEL)}${icon("external-link", 16)}</a></p>`;
}

const dayMonth = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(iso));

/**
 * opts.trySign: the bundle also carries /try/sign (TRY_SIGN_ENABLED); the buttons are the same either way.
 * opts.verifyUrl: /verify, once the site serves it ("" points the cent's tile at /proof).
 */
export function homePage(run: AgentRun = agentRun(), opts: { trySign?: boolean; partnerUrl?: string; verifyUrl?: string } = {}): string {
  const verifyUrl = opts.verifyUrl ?? VERIFY_URL;
  const awx = awxRun(), facts = heroDemoFacts(awx);
  const rows = proofRows(run, awx);
  const mf = moneyFlowFacts();
  const body = `<main class="ent">
<section class="e-hero">${HERO_WAVE_HTML}<div class="wrap">
  <div class="copy">
    <p class="eyebrow cloud">${esc(CLOUD_EYEBROW)}</p>
    ${homeHeadingHtml()}
    <p class="what">${esc(HOME_SUB)}</p>
    ${heroStatsHtml()}
    <div class="ctas"><a class="btn primary big start" href="${TRY_URL}">${esc(START)}${icon("arrow-right", 18)}</a><a class="btn big ghost film" href="${esc(FILM_URL)}" target="_blank" rel="noopener">${icon("play", 16)}${esc(WATCH_BUTTON)}</a><a class="btn big ghost pilot" href="${BUSINESS_HREF}">${esc(PILOT_CTA)}${icon("arrow-right", 16)}</a></div>
  </div>
  ${workflowHtml()}
</div></section>
<section class="e-band" aria-label="Integrations"><div class="wrap">
  ${logoBandHtml()}
</div></section>
<section class="e-ai" id="${AI_ID}" aria-labelledby="h-ai"><div class="wrap">
  ${aiFlowHtml()}
  <div class="e-more"><a class="btn big" href="${esc(AI_CONNECT_URL)}" target="_blank" rel="noopener">${icon("sparkles", 18)}${esc(CONNECT_CLAUDE)}</a><a class="btn big ghost" href="${esc(REPO_URL)}" target="_blank" rel="noopener">${icon("external-link", 18)}${esc(GITHUB_BUTTON)}</a></div>
</div></section>
<section class="e-agents" aria-labelledby="h-agents"><div class="wrap">
  <p class="eyebrow">${esc(AGENTS_EYEBROW)}</p>
  <h2 class="e-h" id="h-agents">${esc(AGENTS_HEAD)}</h2>
  ${agentsHtml()}
  <div class="e-more e-biz"><a class="btn big" href="${BUSINESS_HREF}">${icon("building-2", 18)}${esc(BUSINESS_BUTTON)}${icon("arrow-right", 18)}</a><span class="e-partner">${designPartnerHtml(opts.partnerUrl ?? DESIGN_PARTNER_URL)}</span></div>
  ${askHtml()}
</div></section>
<section class="e-proof" aria-labelledby="h-proof"><div class="wrap">
  <p class="eyebrow">${esc(PROOF_EYEBROW)}</p>
  <h2 class="e-h" id="h-proof">${esc(PROOF_HEAD)}</h2>
  ${proofRowHtml(proofTiles(rows, mf, verifyUrl))}
  <div class="e-more"><a class="btn big primary" href="proof">${esc(PROOF_BUTTON)}${icon("arrow-right", 18)}</a>${verifyUrl ? `<a class="btn big ghost" href="${esc(verifyUrl)}">${icon("shield-check", 18)}${esc(VERIFY_BUTTON)}</a>` : ""}</div>
</div></section>
<section class="e-tour" id="${TOUR_ID}" aria-labelledby="h-tour"><div class="wrap">
  <p class="eyebrow">${esc(TOUR_EYEBROW)}</p>
  <h2 class="e-h" id="h-tour">${esc(TOUR_HEAD)}</h2>
  <p class="e-sub">${esc(TOUR_SUB)}</p>
  ${tourMapHtml()}
  <div class="e-more e-tourgo"><a class="btn big tour" href="${esc(TOUR_START_HREF)}" data-tour-start>${icon("route", 18)}${esc(TOUR_BUTTON)}</a></div>
</div></section>
</main>`;
  // The full list behind the card's note: what the card is (one /try run), the cent and the partners' tiles, the main run.
  const refusedAt = run.events.find((e) => e.k === "money")?.at ?? run.record.snapshot.flows[0]?.at ?? "";
  const real = [
    "Purser Cloud's public deployment (purser-try.max-31b.workers.dev) runs on test money. As a guest its console shows a demo company made from demo data, read only; a pilot company is created by Purser and set up with the starter key it hands over. No customer uses it yet.",
    `The Workflow card: /try's sample invoice (Bergtex Textil GmbH, BTX-2026-21). Its supplier, amount, due date, account, Claude's reading and the three booking lines: one /try run of its sample invoice on the live demo, 13 November, with Claude on: Claude Haiku 5.5 read that invoice, and the Checker, Coder and Payer agents ran on it, each request id in the record (docs/runs/2026-11-13-try-sample.json). Test money, a simulated bank, a test passkey.${VAT_THEN ? ` ${VAT_THEN}` : ""}`,
    `The Workflow card's hold, signature, payment and refusal: run 1 of ${WORKFLOW_RECORD} (the live /try on an iPhone profile, 21 November, a software test passkey): its EUR 120.00 invoice paid within the agent's limit, the EUR 1,850.00 one held for the CFO, signed, and paid through the Airwallex sandbox (SCHEDULED, then PAID, the signed hash in Airwallex's transfer record); then the signed amount changed to EUR 1,850.01, refused, no transfer added. Test money.`,
    ...(mf?.cent ? [`The changed cent: /try's two proof files (${MONEY_FLOW_RECORDS.join(", ")}), from the live /try of 15 November: ${mf.amount} to ${mf.vendor}, signed with a passkey and paid on /try's simulated bank; then the same terms one cent higher (${mf.cent.currency} ${mf.cent.asked}), refused because the signature is over other terms, and nothing paid. A test company, test money.`] : []),
    ...(awx && facts ? [`The Airwallex figure: the Airwallex-only run (${awx.run}) of ${facts.date}. ${CAVEAT_LINE} ${awx.note}`] : []),
    `The Alta figure: the main run${refusedAt ? ` of ${dayMonth(refusedAt)}` : ""}. ${CHAIN_TEST}`,
    "The integrations band: the connections Purser Cloud's hub lists, each with its own label there (live, sandbox, testnet, a format export, or built and not yet run live).",
    "Airwallex in ChatGPT: Airwallex's own release notes (\"New at Airwallex: November 2026 Edition\", 12 November) say its AgentOS is available in ChatGPT. Purser does not connect to Airwallex's app; an AI reaches Purser through Purser's own MCP server, which reads the demo company and proposes, never approves. The read-only Airwallex sandbox server (/mcp/airwallex) is built; no live read is on record yet. T:0: the runner posts Purser's journal entries to T:0's shared sandbox entity and reads them back.",
    ...MAIN_RUN_REAL,
  ];
  return page({
    // Final jury, 13 Nov: / and /home serve this page; /home is its one canonical address.
    title: "Purser", description: `${HERO} ${CORE_SENTENCE}`, canonical: `${SITE_URL}/home`, tab: "home", css: CSS + HERO_WAVE_CSS + LOGO_BAND_CSS + AI_CSS + TOUR_MAP_CSS + HOME_PREMIUM_CSS, body, js: JS + HERO_WAVE_JS + WORKFLOW_JS + LOGO_BAND_JS, stage: false,
    // 20 Nov (the owner: "Purser connects to everything and everyone, findable"): the hub of every connection, in the footer.
    links: [[`${REPO_BLOB}${CONNECT_HUB_DOC}`, CONNECT_HUB_LABEL], [NOT_FINISHED[0], NOT_FINISHED[1]]],
    real,
    source: `Source: a /try run of its sample invoice, /try's two proof files (${MONEY_FLOW_RECORDS.join(", ")}), ${AWX_RUN_FILE} and ${run.file} (${run.name}).`,
  });
}
