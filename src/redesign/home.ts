// Home: ONE story (home-story, 12 Nov, after seven jurors judged the live site). Top to bottom: the heading and what
// Purser is in one sentence; one button ("Try it yourself") with one reassurance line; the sentence every juror repeated
// (DIFFERENTIATORS[0]); the hero, which is also "how it works" in four steps and whose fourth step is the visitor's own
// real check (src/redesign/heroDemo.ts); ONE provenance line with the "What's real?" link; three proof rows, each one
// tap from the partner's own record; and the second and last button, "See the proof". No replay of the agents' run, no
// awards strip, no run counts, no second caveat: the full list of what is real stays in the footer's fold. Every id,
// amount and date is read from the run records (docs/demo/airwallex-run.json, docs/demo/main-run.json) and the hero's
// receipt (the published receipt of the approval of 7 November, src/redesign/heroReceipt.ts).

import { designPartnerHtml, DESIGN_PARTNER_URL, BUSINESS_CASE_LINK, BUSINESS_DOCS, CHAIN_TEST, CORE_SENTENCE, DIFFERENTIATORS, HERO, JUDGE_LINE, SMALL_COMPANY_DEMO_URL, WHAT_IT_IS, WHY_COMPANY, WHY_COMPANY_NOTE_LAST } from "../config/brand.js";
import type { Awx1Record } from "../awx/scenario.js";
import { agentRun, type AgentRun } from "./run.js";
import { AWX_RUN_FILE, AWX_RUN_STEPS_ID, awxRun } from "./awxRun.js";
import { metalStory, REPO_BLOB } from "./metalStory.js";
import { HERO_DEMO_CSS, HERO_DEMO_JS, heroDemoFacts, heroDemoHtml, heroProvenance } from "./heroDemo.js";
import { HERO_RECEIPT_FILE, heroReceipt } from "./heroReceipt.js";
import { VIC3_RUN_ID, vic3Run, type Vic3Record } from "./vic3Run.js";
import { esc, icon, MAIN_RUN_REAL, page, TRY_URL } from "./ui.js";
import { lifecycleSvg, VISUAL_CSS } from "../visuals/svg.js";
import { BUILT_WITH } from "../visuals/logos.js";
import { booksData } from "./booksPage.js";

const CSS = `.hero { padding: 24px 0 36px; }
.hero .wrap { display: grid; gap: 20px; }
.hero .copy, .hero .show { min-width: 0; }
/* The heading: two sentences, two lines (jury panel, A10), never broken mid-sentence where there is room for one. */
.hero .h-hero { font-size: clamp(38px, 4.4vw, 58px); } .hero .h-hero span { display: block; }
@media (min-width: 1100px) { .hero { padding: 56px 0 56px; } .hero .wrap { grid-template-columns: minmax(0, 1fr) minmax(0, 560px); gap: 0 52px; align-items: center; } .hero .h-hero span { white-space: nowrap; } }
.hero .what { margin: 14px 0 0; font-size: 19px; line-height: 1.45; font-weight: 600; max-width: 34em; }
.btn.big { height: 56px; font-size: 17px; padding: 0 26px; }
.btn.big.start { margin-top: 18px; }
@media (max-width: 1099px) { .btn.big { width: 100%; justify-content: center; } }
.reassure { margin: 10px 0 0; font-size: 15px; color: var(--muted); text-wrap: balance; }
/* The sentence every juror repeated: it leads into the hero. */
.oneline { margin: 26px 0 0; padding-left: 13px; border-left: 3px solid var(--accent); font-size: 18px; line-height: 1.45; font-weight: 600; max-width: 30em; }
p.partner { margin: 14px 0 0; font-weight: 650; } p.partner a { color: var(--accent); display: inline-flex; align-items: center; min-height: 44px; }
/* The one provenance line, under the hero. */
.prov { margin: 12px 2px 0; font-size: 14.5px; line-height: 1.5; color: var(--muted); }
.prov a { display: flex; width: fit-content; align-items: center; min-height: 44px; color: var(--accent); font-weight: 650; }
/* The locks: one card each (an icon, a short title, one line, the id), one tap to the partner's own record. */
section.locks { padding: 56px 0 64px; border-top: 1px solid var(--border); }
section.locks .h-sec { font-size: clamp(26px, 2.8vw, 36px); }
ol.rows { list-style: none; margin: 24px 0 0; padding: 0; display: grid; gap: 14px; }
@media (min-width: 700px) { ol.rows { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; } }
@media (min-width: 1100px) { ol.rows { grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 18px; } }
a.row { position: relative; display: grid; gap: 6px; align-content: start; height: 100%; min-height: 44px; padding: 22px 22px 18px; border-radius: var(--r); border: 1px solid var(--border); background: var(--surface); box-shadow: var(--shadow); color: var(--text); text-decoration: none; transition: border-color .2s, transform .2s; }
a.row:hover { border-color: var(--accent); transform: translateY(-2px); }
a.row .ic { width: 44px; height: 44px; border-radius: 12px; display: grid; place-items: center; background: var(--accent-soft); color: var(--accent); margin-bottom: 8px; }
a.row .ic .i { width: 22px; height: 22px; }
a.row strong { font-size: 19px; font-weight: 720; letter-spacing: -.01em; line-height: 1.25; }
a.row span { font-size: 15.5px; color: var(--muted); line-height: 1.45; }
a.row code { font: 500 14px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--faint); margin-top: 4px; }
a.row > .i { position: absolute; top: 22px; right: 20px; color: var(--accent); }
.btn.big.more { margin-top: 28px; }
/* On a phone the three cards and their button fit one screen: the icon beside the text, less padding. */
@media (max-width: 899px) {
  section.locks { padding: 40px 0 48px; }
  ol.rows { margin-top: 18px; gap: 10px; }
  a.row { grid-template-columns: 40px minmax(0, 1fr); column-gap: 14px; row-gap: 2px; padding: 14px 40px 14px 14px; }
  a.row .ic { grid-column: 1; grid-row: 1 / span 3; align-self: start; width: 40px; height: 40px; margin: 0; }
  a.row strong, a.row span, a.row code { grid-column: 2; }
  a.row strong { font-size: 17px; } a.row code { margin-top: 0; }
  a.row > .i { top: 16px; right: 14px; }
  .btn.big.more { margin-top: 18px; }
}
/* About Purser: two sentences and the payment's life, then the partners' logos. */
section.about { padding: 56px 0 72px; border-top: 1px solid var(--border); }
section.about .h-sec { font-size: clamp(26px, 2.8vw, 36px); }
section.about p.lede { margin: 14px 0 0; font-size: 18px; line-height: 1.5; color: var(--muted); max-width: 40em; }
section.about .life { margin: 28px 0 0; }
section.about .life .pv-life-tall { display: none; }
@media (max-width: 640px) { section.about .life .pv-life-wide { display: none; } section.about .life .pv-life-tall { display: block; max-width: 420px; } }
.works { margin: 32px 0 0; display: flex; flex-wrap: wrap; align-items: center; gap: 12px 16px; }
.works span { font-size: 14px; font-weight: 650; letter-spacing: .04em; text-transform: uppercase; color: var(--faint); }
.works img { height: 40px; width: auto; max-width: 100%; display: block; }
@media (max-width: 640px) { .works img { height: auto; width: 100%; } }
/* Scroll-in: sections rise in once as they come into view; nothing moves for a reader who prefers less motion. */
@media (prefers-reduced-motion: no-preference) {
  .js-reveal .reveal { opacity: 0; transform: translateY(14px); transition: opacity .6s ease, transform .6s ease; }
  .js-reveal .reveal.in { opacity: 1; transform: none; }
  .js-reveal ol.rows li:nth-child(2) .reveal { transition-delay: .08s; } .js-reveal ol.rows li:nth-child(3) .reveal { transition-delay: .16s; } .js-reveal ol.rows li:nth-child(4) .reveal { transition-delay: .24s; }
}
p.next { margin: 18px 0 0; font-size: 15.5px; color: var(--muted); max-width: 44em; } p.next a { color: var(--accent); font-weight: 650; text-decoration: none; display: inline-flex; align-items: center; min-height: 44px; white-space: nowrap; }
section.band { padding: 60px 0; border-top: 1px solid var(--border); }
.sechead { display: flex; flex-wrap: wrap; align-items: end; justify-content: space-between; gap: 12px; margin-bottom: 26px; }
.sechead .pill { white-space: normal; }
@media (max-width: 899px) {
  section.band { padding: 44px 0; }
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
    var h = location.hash, kept = "";
    try { kept = localStorage.getItem("kit11.view") || ""; } catch (e) {}
    if (!kept && !/(?:^#|&)(?:view=[0-9a-f]{32}|runner=[A-Za-z0-9_-]{80,200})(?:&|$)/.test(h)) return;
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
export const START = "Try it yourself";
/**
 * The one line under it, saying only what the page behind the button does. Since 12 Nov the button opens the hands-on
 * demo on Purser Cloud (TRY_URL): a test company of your own on test money, deleted after 24 hours (its start page says
 * "Test money · deleted after 24 h"). The same line with /try/sign in the bundle or not; both keys kept for the callers.
 */
export const REASSURE = { sign: "Your own test company, deleted after 24 hours.", world: "Your own test company, deleted after 24 hours." } as const;
/** The link in the provenance line: it opens the footer's fold of the same name. */
export const WHATS_REAL = "What's real?";
export const LOCKS_HEAD = "Each lock, on record";
/** Home's second and last button. */
export const PROOF_BUTTON = "See the proof";
/** The fold at the end of Home (the owner, 12 Nov, for the Founder's award): no new page, no menu item, no person. */
export const ABOUT_HEAD = "About Purser";

/** About Purser (home-polish, 12 Nov): two sentences and the payment's life (src/visuals/svg.ts); the business, the
 * runs and the pricing are on their own pages (/pricing, /runs, /docs). No customer, pilot or revenue is claimed. */
export const ABOUT_LINES = [
  "Purser keeps AI agents inside limits a CFO signs.",
] as const;
export const WORKS_WITH = "Works with";
function aboutHtml(): string {
  const names = BUILT_WITH.map((l) => l.name);
  const alt = `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
  return `<h2 class="h-sec reveal" id="about">${esc(ABOUT_HEAD)}</h2>
  <p class="lede reveal">${ABOUT_LINES.map(esc).join(" ")}</p>
  <div class="life reveal">${lifecycleSvg("wide")}${lifecycleSvg("tall")}</div>
  <div class="works reveal"><span>${esc(WORKS_WITH)}</span><img src="assets/built-with.png" alt="${esc(alt)}" width="1010" height="80"></div>`;
}

export interface ProofRow { partner: "Airwallex" | "Metal" | "Visa" | "The CFO"; title: string; text: string; icon: string; id: string; full: string; href: string; external: boolean }

/**
 * The three proof rows, every value from a run record; a row whose record lacks a piece drops out.
 * 1. Airwallex declined an agent's card over its limit (the Airwallex-only run: the declined charge and the card's
 *    limit as Airwallex returned it), to the site's section with Airwallex's record of it.
 * 2. Metal refused a purchase on chain (the main run), to the transaction on Metal's testnet explorer.
 * 3. The hash the CFO signed is in Airwallex's record of the payment the hero shows (the run's own verify line says
 *    so for that transfer), to the same section.
 */
export function proofRows(run: AgentRun = agentRun(), awx: Awx1Record | null = awxRun(), vic3: Vic3Record | null = vic3Run()): ProofRow[] {
  const rows: ProofRow[] = [];
  const steps = `airwallex#${AWX_RUN_STEPS_ID}`;
  const cents = (a: string) => Math.round(Number(a) * 100);
  const limitOf = (agent: string) => String(awx?.cards.find((c) => c.agent === agent)?.read_back.per_tx ?? "");
  const decline = awx?.card_transactions.find((t) => !t.approved && !!t.decline_code && !!limitOf(t.agent) && cents(t.amount) > cents(limitOf(t.agent)));
  if (decline) rows.push({ partner: "Airwallex", title: "Airwallex declined the card", text: `${decline.currency} ${decline.amount} over a ${decline.currency} ${limitOf(decline.agent)} limit.`, icon: "ban", id: `${decline.id.slice(0, 8)}…`, full: decline.id, href: steps, external: false });
  const refusal = metalStory(run.record).refusal;
  const tx = /\/tx\/(0x[0-9a-f]{64})$/.exec(refusal?.proof.href ?? "")?.[1];
  if (refusal && tx && refusal.code === "mandate_cap_exceeded") rows.push({ partner: "Metal", title: "Metal refused it on chain", text: "Over the agent's cap.", icon: "link-2", id: refusal.proof.label, full: tx, href: refusal.proof.href!, external: true });
  // Visa Intelligent Commerce (vic-3, 12 Nov): purchase B, above the CFO's limit, paid after Face ID; the signed hash read
  // back equal in Airi's mandate and in Airwallex's PaymentIntent (docs/runs/2026-11-12-vic-3.json), to /visa's block.
  const b = vic3?.purchases.find((p) => p.step === "B" && p.outcome?.status === "succeeded" && p.read_back.mandate?.equal && p.read_back.payment_intent?.equal && p.payment_intent_id);
  if (b?.payment_intent_id) rows.push({ partner: "Visa", title: "Visa: hash read back", text: "Equal at Airi and Airwallex.", icon: "credit-card", id: `${b.payment_intent_id.slice(0, 10)}…`, full: b.payment_intent_id, href: `visa#${VIC3_RUN_ID}`, external: false });
  const f = heroDemoFacts(awx);
  if (f?.inRecord) rows.push({ partner: "The CFO", title: "Your signature (Face ID)", text: "Hash in Airwallex's record.", icon: "file-check", id: `${f.hash.slice(0, 8)}…`, full: f.hash, href: steps, external: false });
  return rows;
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
  const awx = awxRun(), facts = heroDemoFacts(awx), receipt = heroReceipt(facts, opts.receipt ?? HERO_RECEIPT_FILE);
  const hero = heroDemoHtml(facts, receipt);
  const rows = proofRows(run, awx);
  const body = `<main>
<section class="hero"><div class="wrap">
  <div class="copy">
    ${homeHeadingHtml()}
    <p class="what">${esc(WHAT_IT_IS)}</p>
    <a class="btn primary big start" href="${tryHref}">${icon("scan-face", 18)}${esc(START)}</a>
    <p class="reassure">${esc(opts.trySign ? REASSURE.sign : REASSURE.world)}</p>
    <p class="oneline">${esc(DIFFERENTIATORS[0])}</p>
  </div>
  <div class="show">${hero}${hero && facts && receipt ? `
    <p class="prov">${esc(heroProvenance(facts, receipt).join(" "))} <a href="#real" data-real>${esc(WHATS_REAL)}</a></p>` : ""}</div>
</div></section>
<section class="locks" aria-labelledby="h-locks"><div class="wrap">
  <h2 class="h-sec reveal" id="h-locks">${esc(LOCKS_HEAD)}</h2>
  <ol class="rows">${rows.map((r) => `
    <li><a class="row reveal" href="${esc(r.href)}"${r.external ? ' target="_blank" rel="noopener"' : ""}><span class="ic">${icon(r.icon, 22)}</span><strong>${esc(r.title)}</strong><span>${esc(r.text)}</span><code title="${esc(r.full)}">${esc(r.id)}</code>${icon(r.external ? "external-link" : "arrow-right", 18)}</a></li>`).join("")}
  </ol>
  <a class="btn big more" href="proof">${esc(PROOF_BUTTON)}${icon("arrow-right", 18)}</a>
  ${booksCardHtml()}
  ${nextHtml(opts.smallCompanyUrl ?? SMALL_COMPANY_DEMO_URL)}
  ${designPartnerHtml(opts.partnerUrl ?? DESIGN_PARTNER_URL)}
</div></section>
<section class="about" aria-labelledby="about"><div class="wrap">
  ${aboutHtml()}
</div></section>
</main>`;
  // The full list behind the one provenance line: the main run's lines, the run the hero replays (its own note), what
  // step 4's receipt is (the file's own note), and the test behind the Metal row.
  const refusedAt = run.events.find((e) => e.k === "money")?.at ?? run.record.snapshot.flows[0]?.at ?? "";
  // What Home shows first (the hero and its two Airwallex rows), then the Metal row and the main run it comes from.
  const real = [
    ...(awx && facts ? [`The hero's steps 1 to 3 and the two Airwallex rows: the Airwallex-only run (${awx.run}) of ${facts.date}. ${awx.note}`] : []),
    ...(receipt ? [receipt.kind === "recorded" ? `The hero's step 4 checks the published receipt of this approval in your browser: ${receipt.note}` : `The hero's step 4: ${receipt.note}`] : []),
    `The Metal row: the main run${refusedAt ? ` of ${dayMonth(refusedAt)}` : ""}. ${CHAIN_TEST}`,
    ...MAIN_RUN_REAL,
  ];
  return page({
    title: "Purser", description: `${HERO} ${CORE_SENTENCE}`, tab: "home", css: CSS + VISUAL_CSS + (hero ? HERO_DEMO_CSS : ""), body, js: JS + (hero ? HERO_DEMO_JS : ""), stage: false,
    // The judge's tour: one quiet footer link, only where /judge exists.
    links: opts.trySign ? [["judge", JUDGE_LINE]] : [],
    ...(hero && receipt ? { data: receipt.data } : {}),
    real,
    source: `Source: ${AWX_RUN_FILE}, ${HERO_RECEIPT_FILE} and ${run.file} (${run.name}).`,
  });
}

/** One card for /books (owner, 12 Nov): one word, as Home's word budget allows (test/site-v4.test.ts); none without the T:0 record. */
export function booksCardHtml(): string {
  const j = booksData().journal;
  if (!j) return "";
  return `<ol class="rows books"><li><a class="row reveal" href="books"><span class="ic">${icon("database", 22)}</span><strong>${esc("Books")}</strong>${icon("arrow-right", 18)}</a></li></ol>`;
}
