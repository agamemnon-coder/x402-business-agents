// Home: ONE story (home-story, 12 Nov, after seven jurors judged the live site). Top to bottom: the heading and what
// Purser is in one sentence; one button ("Try it yourself") with one reassurance line; the sentence every juror repeated
// (now carried by the demo); the hero, which is also "how it works" in four steps and whose fourth step is the visitor's own
// real check (src/redesign/heroDemo.ts); ONE provenance line with the "What's real?" link; three proof rows, each one
// tap from the partner's own record; and the second and last button, "See the proof". No replay of the agents' run, no
// awards strip, no run counts, no second caveat: the full list of what is real stays in the footer's fold. Every id,
// amount and date is read from the run records (docs/demo/airwallex-run.json, docs/demo/main-run.json) and the hero's
// receipt (the published receipt of the approval of 7 November, src/redesign/heroReceipt.ts).

import { designPartnerHtml, DESIGN_PARTNER_URL, BUSINESS_CASE_LINK, BUSINESS_DOCS, CAVEAT_LINE, CHAIN_TEST, CORE_SENTENCE, HERO, JUDGE_LINE, SMALL_COMPANY_DEMO_URL, WHY_COMPANY, WHY_COMPANY_NOTE_LAST } from "../config/brand.js";
import type { Awx1Record } from "../awx/scenario.js";
import { agentRun, type AgentRun } from "./run.js";
import { AWX_RUN_FILE, AWX_RUN_STEPS_ID, awxRun } from "./awxRun.js";
import { metalStory, REPO_BLOB } from "./metalStory.js";
import { heroDemoFacts } from "./heroDemo.js";
import { FLOW_NOTE, HERO_FLOW_CSS, heroFlowHtml } from "./heroFlow.js";
import { VIC3_RUN_ID, vic3Run, type Vic3Record } from "./vic3Run.js";
import { esc, icon, MAIN_RUN_REAL, page, TRY_URL } from "./ui.js";
import { COUNT_JS, STATS_CSS, statsHtml, type Stat } from "./stats.js";
import { split } from "./run.js";
import { ownersRun, ownersSteps, type OwnersRun } from "./metalOnchain.js";
import { booksData } from "./booksPage.js";

const CSS = `/* Home, enterprise pass (the owner, 12 Nov): an 8 px grid, 1120 px wide, neutral greys and one accent. */
main.ent .wrap { max-width: 1120px; }
main.ent section { padding: 96px 0; border-top: 1px solid var(--border); }
main.ent section.e-hero { padding: 72px 0 88px; border-top: 0; }
.eyebrow { margin: 0 0 8px; font-size: 13px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: var(--accent); }
.e-h { margin: 0; font-size: clamp(28px, 3.2vw, 40px); line-height: 1.15; font-weight: 760; letter-spacing: -.02em; max-width: 22em; }
.e-sub { margin: 16px 0 0; font-size: 18px; line-height: 1.5; color: var(--muted); max-width: 36em; }
/* The hero: words and buttons on the left, the product card on the right. */
.e-hero .wrap { display: grid; gap: 48px; align-items: center; }
.e-hero .h-hero { font-size: clamp(40px, 5vw, 60px); line-height: 1.04; letter-spacing: -.03em; } .e-hero .h-hero span { display: block; }
@media (min-width: 1040px) { .e-hero .wrap { grid-template-columns: minmax(0, 1fr) minmax(0, 540px); gap: 56px; } .e-hero .h-hero { font-size: clamp(44px, 4vw, 54px); } .e-hero .h-hero span { white-space: nowrap; } }
.e-hero .what { margin: 24px 0 0; font-size: 20px; line-height: 1.5; color: var(--muted); max-width: 30em; }
.ctas { margin: 32px 0 0; display: flex; flex-wrap: wrap; gap: 12px; }
.btn.big { height: 56px; font-size: 17px; padding: 0 28px; }
.btn.ghost { background: transparent; }
.btn.ghost:hover { border-color: var(--text); }
.reassure { margin: 16px 0 0; font-size: 15px; color: var(--muted); }
.trust { margin: 40px 0 0; padding-top: 24px; border-top: 1px solid var(--border); display: flex; flex-wrap: wrap; align-items: center; gap: 16px 24px; }
.trust span { width: 100%; font-size: 13px; font-weight: 650; letter-spacing: .06em; text-transform: uppercase; color: var(--faint); }
.trust img { height: 20px; width: auto; filter: brightness(0); opacity: .45; }
.trust img.tall { height: 22px; }
@media (max-width: 640px) { .trust { gap: 12px 14px; } .trust img { height: 16px; } .trust img.tall { height: 18px; } }
:root[data-theme="dark"] .trust img { filter: brightness(0) invert(1); opacity: .5; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) .trust img { filter: brightness(0) invert(1); opacity: .5; } }
@media (max-width: 640px) {
  main.ent section { padding: 64px 0; } main.ent section.e-hero { padding: 40px 0 56px; }
  .ctas .btn { width: 100%; justify-content: center; }
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
.e-more { margin: 32px 0 0; display: flex; flex-wrap: wrap; gap: 12px; }
p.next { margin: 24px 0 0; font-size: 15.5px; color: var(--muted); max-width: 44em; } p.next a { color: var(--accent); font-weight: 650; text-decoration: none; display: inline-flex; align-items: center; min-height: 44px; white-space: nowrap; }
/* Scroll-in: sections rise in once as they come into view; nothing moves for a reader who prefers less motion. */
@media (prefers-reduced-motion: no-preference) {
  .js-reveal .reveal { opacity: 0; transform: translateY(16px); transition: opacity .6s ease, transform .6s ease; }
  .js-reveal .reveal.in { opacity: 1; transform: none; }
}
section.band { padding: 60px 0; border-top: 1px solid var(--border); }
.sechead { display: flex; flex-wrap: wrap; align-items: end; justify-content: space-between; gap: 12px; margin-bottom: 26px; }
.sechead .pill { white-space: normal; }`;

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
  var els = document.querySelectorAll(".reveal");
  var io = new IntersectionObserver(function (es) { es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } }); }, { rootMargin: "0px 0px -8% 0px" });
  document.documentElement.classList.add("js-reveal");
  els.forEach(function (el) { io.observe(el); });
})();`;

/**
 * "Why this is a company" (section D, 6 Nov): five lines from docs/business/, each linked to its page, under one note
 * that says it is not validated (WHY_COMPANY, WHY_COMPANY_NOTE).
 */
export function whyCompanyHtml(): string {
  return `<section class="band" aria-labelledby="h-company"><div class="wrap">
  <div class="sechead"><h2 class="h-sec" id="h-company">Why this is a company</h2></div>
  <ul class="company">${WHY_COMPANY.map((l) => `<li><b>${esc(l.label)}:</b> ${esc(l.text)}</li>`).join("")}</ul>
  <p class="clink"><a href="${esc(BUSINESS_DOCS)}" target="_blank" rel="noopener">${esc(BUSINESS_CASE_LINK)}</a></p>
  <p class="cnote">${esc(WHY_COMPANY_NOTE_LAST)}</p>
</div></section>`;
}

/** The heading's markup: HERO's two sentences, each its own line (A10: the break comes after "spend.", never mid-sentence). */
export function homeHeadingHtml(): string {
  const [first, ...rest] = HERO.split(/(?<=\.)\s+/);
  return `<h1 class="h-hero"><span>${esc(first!)}</span> <span>${esc(rest.join(" "))}</span></h1>`;
}
/** Home's first button, word for word: where the Try tab goes. */
export const START = "Try it live";
/** The hero's one sentence under the heading (the owner, 12 Nov: one sentence). WHAT_IT_IS stays the README's and the form's. */
export const HOME_SUB = "Over its limit, an agent asks; you sign the exact terms with Face ID.";
/**
 * The one line under it, saying only what the page behind the button does. Since 12 Nov the button opens the hands-on
 * demo on Purser Cloud (TRY_URL): a test company of your own on test money, deleted after 24 hours (its start page says
 * "Test money · deleted after 24 h"). The same line with /try/sign in the bundle or not; both keys kept for the callers.
 */
export const REASSURE = { sign: "Your own test company, deleted after 24 hours.", world: "Your own test company, deleted after 24 hours." } as const;
/** The link in the provenance line: it opens the footer's fold of the same name. */
export const WHATS_REAL = "What's real?";
export const LOCKS_HEAD = "Each lock, on record";
export const FLOW_HEAD = "Claude agents decide. Code and the rails enforce.";
export const FEATURES_HEAD = "Agents do the work. The CFO keeps the say.";
/** Four features, one line each; each says only what the runs and the code show (see /proof). */
export const FEATURES = [
  { icon: "scan-face", title: "Face ID on the exact terms", text: "Above a limit, the CFO signs amount, payee and account. Change one cent and it fails." },
  { icon: "shield-check", title: "Limits in code, not prompts", text: "Claude agents read and propose; Purser's code holds the limits." },
  { icon: "ban", title: "Rails that refuse too", text: "Airwallex, Metal and Visa via Airi apply their own controls." },
  { icon: "file-check", title: "Booked and checkable", text: "Every payment is booked; its signed receipt checks offline." },
] as const;
/** The records behind the stat row (test/home-story.test.ts checks each figure against them). */
export const STAT_RECORDS = "docs/runs/2026-11-12-faceid-onchain.json docs/demo/main-run.json docs/demo/airwallex-run.json docs/runs/2026-11-12-vic-3.json";
export const STAT_NOTE = "Each figure from a sandbox or testnet record.";
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
  { verb: "Sign", who: "You, with Face ID" },
  { verb: "Pay", who: "Payer agent (Claude) proposes, the rail and code enforce", evals: AP_EVALS },
];
export const WORKS_WITH = "Works with";
function aboutHtml(): string {
  return `<p class="eyebrow">${esc(ABOUT_HEAD)}</p>
  <h2 class="e-h reveal" id="about">${esc(FLOW_HEAD)}</h2>
  <ol class="flow reveal">${AGENT_FLOW.map((f) => `<li${f.verb === "Sign" ? ' class="you"' : ""}><b>${esc(f.verb)}</b><span>${esc(f.who)}${f.evals ? ` (<a href="${esc(f.evals)}" target="_blank" rel="noopener">see evals</a>)` : ""}</span></li>`).join("")}</ol>
`;
}

export interface ProofRow { partner: "Airwallex" | "Metal" | "Visa"; title: string; text: string; icon: string; id: string; full: string; href: string; external: boolean }

/**
 * The three proof rows, every value from a run record; a row whose record lacks a piece drops out.
 * 1. Airwallex declined an agent's card over its limit (the Airwallex-only run: the declined charge and the card's
 *    limit as Airwallex returned it), to the site's section with Airwallex's record of it.
 * 2. Metal refused a purchase on chain (the main run), to the transaction on Metal's testnet explorer.
 * 3. Visa Intelligent Commerce: the hash the CFO signed, read back equal at Airi and Airwallex (vic-3), to /visa.
 * The CFO's own row (the signed hash in Airwallex's record) left Home on 12 Nov to keep it under 180 words: the hero
 * shows that same approval and its hash, and step 3 says the hash is in Airwallex's record.
 */
export function proofRows(run: AgentRun = agentRun(), awx: Awx1Record | null = awxRun(), vic3: Vic3Record | null = vic3Run()): ProofRow[] {
  const rows: ProofRow[] = [];
  const steps = `airwallex#${AWX_RUN_STEPS_ID}`;
  const cents = (a: string) => Math.round(Number(a) * 100);
  const limitOf = (agent: string) => String(awx?.cards.find((c) => c.agent === agent)?.read_back.per_tx ?? "");
  const decline = awx?.card_transactions.find((t) => !t.approved && !!t.decline_code && !!limitOf(t.agent) && cents(t.amount) > cents(limitOf(t.agent)));
  if (decline) rows.push({ partner: "Airwallex", title: "Airwallex declined the card", text: `${decline.currency} ${decline.amount} over a ${limitOf(decline.agent)} limit.`, icon: "ban", id: `${decline.id.slice(0, 8)}…`, full: decline.id, href: steps, external: false });
  const refusal = metalStory(run.record).refusal;
  const tx = /\/tx\/(0x[0-9a-f]{64})$/.exec(refusal?.proof.href ?? "")?.[1];
  if (refusal && tx && refusal.code === "mandate_cap_exceeded") rows.push({ partner: "Metal", title: "Metal refused it on chain", text: "Over its cap.", icon: "link-2", id: refusal.proof.label, full: tx, href: refusal.proof.href!, external: true });
  // Visa Intelligent Commerce (vic-3, 12 Nov): purchase B, above the CFO's limit, paid after Face ID; the signed hash read
  // back equal in Airi's mandate and in Airwallex's PaymentIntent (docs/runs/2026-11-12-vic-3.json), to /visa's block.
  const b = vic3?.purchases.find((p) => p.step === "B" && p.outcome?.status === "succeeded" && p.read_back.mandate?.equal && p.read_back.payment_intent?.equal && p.payment_intent_id);
  if (b?.payment_intent_id) rows.push({ partner: "Visa", title: "Visa: hash read back", text: "Equal at Airi and Airwallex.", icon: "credit-card", id: `${b.payment_intent_id.slice(0, 10)}…`, full: b.payment_intent_id, href: `visa#${VIC3_RUN_ID}`, external: false });
  return rows;
}

/**
 * First on record (jury pass, 13 Nov): Face ID verified on chain. The passkey account on Metal testnet
 * (docs/runs/<date>-faceid-onchain.json): every limit change ran only after all its owners' passkeys signed, checked by
 * the account itself; a payment over the cap was refused on chain, and paid after both signed the raise. The second
 * signer is a virtual test passkey, and the tile says so. No record, or no refusal followed by a raise: no tile.
 */
export function faceIdTile(owners: OwnersRun | null = ownersRun()): Stat[] {
  if (!owners) return [];
  const steps = ownersSteps(owners.rec);
  const refused = steps.findIndex((s) => s.key === "refused");
  const raised = steps.findIndex((s, i) => i > refused && s.key === "replace");
  if (refused < 0 || raised < 0) return [];
  const all = owners.rec.owners.length, virtual = owners.rec.owners.filter((o) => o.virtual).length;
  // The stand-in in sight: the co-signer is a virtual test passkey (the CFO's device is as the owner stated it).
  return [{ n: owners.rec.threshold, suf: ` of ${all}`, label: `Face ID verified on chain${virtual ? "; co-signer a test key" : ""}`, icon: "scan-face", tone: "ok" }];
}

/**
 * The stat row (the owner, 12 Nov: one strong stat row), every figure from a run record: Claude's decisions in the main
 * run (its agent_stats), Metal payments in the main run, the card Airwallex declined over its limit (the Airwallex-only
 * run) and the Visa read-backs (vic-3). A figure whose record lacks it drops out.
 */
export function homeStats(run: AgentRun, rows: ProofRow[] = proofRows(run), owners: OwnersRun | null = ownersRun()): Stat[] {
  const sp = split(run.record), pay = metalStory(run.record).payments;
  const awx = rows.find((r) => r.partner === "Airwallex"), m = awx ? /^(\w+) ([\d.]+) over a ([\d.]+) limit/.exec(awx.text) : null;
  return [
    ...faceIdTile(owners),
    ...(sp.decisions ? [{ n: sp.byClaude, label: `Claude decisions in the main run, ${sp.fallbacks} ${sp.fallbacks === 1 ? "fallback" : "fallbacks"}`, icon: "bot" }] : []),
    ...(pay.total ? [{ n: pay.total, label: "Metal payments, each its own transaction", icon: "link-2", tone: "ok" as const }] : []),
    ...(m ? [{ n: Number(m[2]), dec: 2, pre: `${m[1]} `, label: `declined by Airwallex over a ${m[1]} ${m[3]} card limit`, icon: "ban", tone: "bad" as const }] : []),
    ...(rows.some((r) => r.partner === "Visa") ? [{ n: 2, suf: " of 2", label: "Visa: signed hash read back equal at Airi and Airwallex", icon: "credit-card", tone: "ok" as const }] : []),
  ];
}

/** The product for small companies, as docs/after-the-kit.md says it: its code in this repository, not live. */
export const NEXT_NEXT = "Next, not live yet: an invoice inbox for small companies, with the same Face ID control.";
export const AFTER_KIT_URL = `${REPO_BLOB}docs/after-the-kit.md`;
/** One line and one link, only when the demo has a public https address (SMALL_COMPANY_DEMO_URL). */
export function nextHtml(url: string = SMALL_COMPANY_DEMO_URL): string {
  if (!/^https:\/\/[^\s"'<>]+$/.test(url)) return "";
  return `<p class="next">${esc(NEXT_NEXT)} <a href="${esc(url)}" target="_blank" rel="noopener">${esc("Open its demo")}\u00a0↗</a></p>`;
}

const dayMonth = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(iso));

/**
 * opts.trySign: the bundle also carries /try/sign (TRY_SIGN_ENABLED), so the button leads there; otherwise to /try.
 * opts.receipt: another receipt for the hero (a file of the repository, or a parsed one); the committed one by default.
 */
export function homePage(run: AgentRun = agentRun(), opts: { trySign?: boolean; partnerUrl?: string; smallCompanyUrl?: string; receipt?: string | object } = {}): string {
  // The owner, 12 Nov: the button opens the hands-on demo on Purser Cloud (TRY_URL), with /try/sign in the bundle or not.
  const tryHref = TRY_URL;
  const awx = awxRun(), facts = heroDemoFacts(awx);
  const rows = proofRows(run, awx);
  const logos = [["logo-airwallex.png", "Airwallex", 2435, 334, ""], ["logo-visa.png", "Visa", 1920, 622, ""], ["logo-metal.svg", "Metal", 114, 36, ""], ["logo-claude.png", "Claude", 330, 72, "tall"]] as const;
  const body = `<main class="ent">
<section class="e-hero"><div class="wrap">
  <div class="copy">
    ${homeHeadingHtml()}
    <p class="what">${esc(HOME_SUB)}</p>
    <div class="ctas"><a class="btn primary big start" href="${tryHref}">${esc(START)}${icon("arrow-right", 18)}</a><a class="btn big ghost" href="proof">${esc(PROOF_BUTTON)}</a></div>
    <p class="reassure">${esc(opts.trySign ? REASSURE.sign : REASSURE.world)}</p>
    <div class="trust"><span>${esc(WORKS_WITH)}</span>${logos.map(([src, alt, w, h, cls]) => `<img${cls ? ` class="${cls}"` : ""} src="assets/${src}" alt="${esc(alt)}" width="${w}" height="${h}">`).join("")}</div>
  </div>
  <div class="show">${heroFlowHtml()}
    <p class="hf-note">${esc(FLOW_NOTE)} <a href="#real" data-real>${esc(WHATS_REAL)}</a></p></div>
</div></section>
<section class="e-feat" aria-labelledby="h-feat"><div class="wrap">
  <p class="eyebrow">Why Purser</p>
  <h2 class="e-h reveal" id="h-feat">${esc(FEATURES_HEAD)}</h2>
  <ul class="feat">${FEATURES.map((f) => `<li class="reveal"><span class="fi">${icon(f.icon, 20)}</span><b>${esc(f.title)}</b><p>${esc(f.text)}</p></li>`).join("")}</ul>
</div></section>
<section class="e-flow" aria-labelledby="about"><div class="wrap">
  ${aboutHtml()}
</div></section>
<section class="e-stats" aria-labelledby="h-locks"><div class="wrap">
  <p class="eyebrow">On record</p>
  <h2 class="e-h reveal" id="h-locks">${esc(LOCKS_HEAD)}</h2>
  <article class="e-statrec" data-rec="${esc(STAT_RECORDS)}">${statsHtml(homeStats(run, rows))}</article>
  <p class="statnote">${esc(STAT_NOTE)}</p>
  <div class="e-more"><a class="btn big primary" href="proof">${esc(PROOF_BUTTON)}${icon("arrow-right", 18)}</a>${booksCardHtml()}</div>
  ${nextHtml(opts.smallCompanyUrl ?? SMALL_COMPANY_DEMO_URL)}
  ${designPartnerHtml(opts.partnerUrl ?? DESIGN_PARTNER_URL)}
</div></section>
</main>`;
  // The full list behind the one provenance line: the main run's lines, the run the hero replays (its own note), what
  // step 4's receipt is (the file's own note), and the test behind the Metal row.
  const refusedAt = run.events.find((e) => e.k === "money")?.at ?? run.record.snapshot.flows[0]?.at ?? "";
  // What Home shows first (the hero and its two Airwallex rows), then the Metal row and the main run it comes from.
  const real = [
    "The hero's values (supplier, amount, due date, account, the signed hash and the three booking lines): one /try run of its sample invoice on the live demo, 13 November, with Claude on: Claude Haiku 5.5 read that invoice, and the Checker, Coder and Payer agents ran on it, each request id in the record (docs/runs/2026-11-13-try-sample.json). Test money, a simulated bank, a test passkey.",
    ...(awx && facts ? [`The Airwallex figure: the Airwallex-only run (${awx.run}) of ${facts.date}. ${CAVEAT_LINE} ${awx.note}`] : []),
    `The Metal figure: the main run${refusedAt ? ` of ${dayMonth(refusedAt)}` : ""}. ${CHAIN_TEST}`,
    ...MAIN_RUN_REAL,
  ];
  return page({
    title: "Purser", description: `${HERO} ${CORE_SENTENCE}`, tab: "home", css: CSS + STATS_CSS + HERO_FLOW_CSS, body, js: JS + COUNT_JS, stage: false,
    // The judge's tour: one quiet footer link, only where /judge exists.
    links: opts.trySign ? [["judge", JUDGE_LINE]] : [],
    real,
    source: `Source: a /try run of its sample invoice, ${AWX_RUN_FILE} and ${run.file} (${run.name}).`,
  });
}

/** One card for /books (owner, 12 Nov): one word, as Home's word budget allows (test/site-v4.test.ts); none without the statement. */
export function booksCardHtml(): string {
  if (!booksData().view) return "";
  return `<a class="btn big ghost" href="books">${icon("database", 18)}${esc("Books")}</a>`;
}
