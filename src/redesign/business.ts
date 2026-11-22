// /business, "For companies", and /one-pager, its printable sales sheet. Since 22 Nov (Max: "far too much text"; then
// "still too much, the demo duplicates Home"), /business is only the question, one line, one small animated visual
// (./businessVisuals.ts) and the pilot's sign-up form, which opens the visitor's own mail app with the fields filled in
// (pilotMailto, PILOT_JS): no network request, nothing stored. /one-pager keeps the whole story on one A4 page.
// Nothing is invented:
//   - every price on /one-pager is read from src/config/pricing.ts (pilot prices; nothing is on sale yet);
//   - its proof tiles are Home's, read from the run records (src/redesign/home.ts proofTiles);
//   - where the data lives is /privacy's own reading of the Workers' configs (src/redesign/privacy.ts residency);
//   - the pilot steps are how Purser Cloud starts a company today (docs/cloud.md); test money only;
//   - "never in the flow of funds" is docs/airwallex-platform.md's; the checks are src/ap/checkerCore.ts's (docs/claims.md).
// The first target customer and the accounting-firm channel are hypotheses (docs/business/model.md) and say so. Built on
// Airwallex; no partnership or endorsement is claimed. No competitor, customer, quote or founder is named.

import { CONTACT_EMAIL } from "../config/brand.js";
import { PRICING, PRICING_LINE, euro } from "../config/pricing.js";
import { SITE_URL } from "../ui/siteUrl.js";
import { CLOUD_SETUP_URL, START_STEPS, proofTiles, type ProofTile } from "./home.js";
import { PRICING_LEAD } from "./pricing.js";
import { residency } from "./privacy.js";
import { repoHref, siteLink } from "./productPage.js";
import { BUSINESS_LINE, BUSINESS_QUESTION, BUSINESS_VISUAL_CSS, demoFacts, pilotVisualHtml } from "./businessVisuals.js";
import { TRY_URL, esc, icon, page } from "./ui.js";

/** The pilot's mail: the footer's contact address, with a subject. */
export const PILOT_MAIL = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent("Purser Founding Partner Pilot")}`;
export const BUSINESS_LABEL = "Founding Partner Pilot · test money only";
/** The one-line position (Max, 21 Nov), said word for word wherever Purser is positioned. */
export const POSITION = "Purser is the CFO control plane for AI-initiated business payments: it checks the supplier, enforces the mandate, binds approval to the exact payment, and reconciles the result.";
/**
 * The 30-Day Founding Partner Pilot (Max, 21 Nov): an early-access design-partner programme beside the plans, not a
 * permanent free offer and not a discount; the plans and their pilot prices stay as they are. Sandbox and test money
 * until the go-live requirements (docs/go-live.md) are met; no production payments are promised before that.
 */
export const FOUNDING_NAME = "30-Day Founding Partner Pilot";
export const FOUNDING_CTA = "Become a Founding Partner";
// Review, 21 Nov: no scarcity or hype ("limited availability", "shape the future"): what the pilot is, plainly.
export const FOUNDING_TEXT = "Get 30 days of guided access to Purser: your agents do the routine payments, and a person approves every critical one.";
export const GO_LIVE_DOC = "docs/go-live.md";
export const FOUNDING_POINTS: readonly string[] = [
  "No credit card. No automatic conversion or billing.",
  "A defined onboarding and one clearly scoped financial workflow.",
  "Direct access to the team: your feedback shapes the product.",
  "Sandbox and test money until the go-live requirements are met.",
];
export const BUSINESS_H1 = "Let AI agents pay. Keep the CFO in control.";
export const BUSINESS_LEAD = POSITION;
export const ONE_PAGER_PATH = "one-pager";
/** Max, 21 Nov: a pilot runs only under a written agreement, and no real payment comes before the production checks. */
export const PILOT_AGREEMENT = "Pilots run only under a written agreement: scope, responsibilities, liability, privacy and access are agreed in writing beforehand. No real payments before the production checks are met.";
/** Max, 21 Nov: the first target group, said as a starting point and not as a proven segment. */
export const FIRST_TARGET = "Our first target group: EU companies of 20 to 200 employees using Airwallex, paying suppliers and software in several currencies, with a CFO, a fractional CFO or an accountant.";
export const FIRST_TARGET_NOTE = "A starting point, not a proven market segment. Other companies can still register interest.";
/** The "Try it" step's own tag on Home ("2 minutes · deleted after 24 h"). */
const TRY_TAG = START_STEPS[0]!.tag;

/** What changes for the company, each with where it is shown. */
export const OUTCOMES: readonly { icon: string; title: string; line: string; href: string; label: string }[] = [
  { icon: "scan-face", title: "The CFO signs the exact terms", line: "Over a limit, a payment waits for the CFO's Face ID. Change one cent and the signature breaks.", href: "verify", label: "Verify a payment" },
  { icon: "lock", title: "Limits live in the rails", line: "Airwallex card limits, Alta mandates on chain, Visa via Airwallex Airi. Not a prompt.", href: "proof", label: "The proof" },
  { icon: "file-check", title: "Checks before money leaves", line: "Duplicate or split invoices, changed bank details, instructions hidden in an invoice.", href: "security", label: "Security" },
  { icon: "receipt", title: "In the books at once", line: "Every payment posted with its proof (T:0), for you and your accountant.", href: "books", label: "Books" },
];

/** The pilot, as Purser Cloud starts a company today (docs/cloud.md). */
export const PILOT_STEPS: readonly { icon: string; title: string; line: string }[] = [
  { icon: "mail", title: "Write to us", line: "Tell us how you pay suppliers today." },
  { icon: "building-2", title: "We set up your company", line: "In Purser Cloud, with a starter key." },
  { icon: "scan-face", title: "Add your passkey", line: "Face ID on the CFO's phone." },
  { icon: "zap", title: "Run your workflow, 30 days", line: "Agents propose, the CFO signs. Test money." },
];

/** The buyer's first questions, each answered from what is built, with where to check it (the README carries the judges' ones word for word; /one-pager its "data" answer). */
export interface Faq { id: string; q: string; a: string; links: [string, string][] }
export function faqs(): Faq[] {
  // /privacy's reading of the configs: the database and the documents in the EU, the engine not pinned yet, AI and alerts opt-in.
  const z = Object.fromEntries(residency().map((r) => [r.id, r.zone]));
  if (z.db !== "eu" || z.docs !== "eu" || z.engine !== "open" || z.ai !== "out") throw new Error("/business: where the data lives no longer reads as /privacy has it");
  return [
    { id: "wrong", q: "What if the AI is wrong?", a: "It only proposes. Code checks every invoice and every payment against the limits the CFO signed; anything over them waits for the CFO's Face ID. If an agent tries anyway, the rail refuses: in test runs Airwallex declined a card charge over its limit, and Alta refused an over-cap payment on chain.", links: [["proof", "The proof"], ["security", "Security"]] },
    { id: "liable", q: "Who is liable for a payment?", a: `Your company stays the payer, from its own Airwallex account: Purser is never in the flow of funds. Each payment carries the CFO's signature over its exact terms, and a receipt anyone can verify. ${PILOT_AGREEMENT}`, links: [["verify", "Verify a receipt"], [repoHref(GO_LIVE_DOC), "The production checks"]] },
    { id: "data", q: "Where is my data?", a: "Purser Cloud's database and documents are in the EU (western Europe, EU jurisdiction); each company's engine and its logs are not pinned to a region yet. Claude and e-mail or WhatsApp alerts leave the EU only when switched on. Access, export and erasure are built in.", links: [["privacy", "Privacy"]] },
    { id: "bank", q: "Do I change banks?", a: "No. Purser works on your company's own Airwallex account, today with an API key you create there. Connecting by signing in at Airwallex is built, not live yet.", links: [["airwallex", "Airwallex"]] },
    { id: "cost", q: "What does it cost?", a: `The ${FOUNDING_NAME} is free, with no credit card and no automatic billing. After it, the plans: ${PRICING_LINE} ${PRICING_LEAD} These prices are not yet validated with customers.`, links: [["one-pager", "The plans"]] },
    // Review, 21 Nov: the questions a judge asks that the page did not answer yet. Short, and only what is built or
    // stated as a hypothesis; no other company named.
    { id: "bypass", q: "Can an agent bypass Purser?", a: "Only routes connected to Purser are protected. An agent pays through the routes Purser governs (the company's Airwallex account, through Purser, and the agents' Alta mandates); a wallet, card or key it can reach outside Purser is not governed by it.", links: [["security#not-finished", "What is not finished"]] },
    { id: "moat", q: "What is the moat if the code is open source?", a: "The code is MIT: anyone may run it. What a company would pay for is the hosted service: the rails kept current with Airwallex and Alta, the CFO's policy, passkeys and audit log operated for it, and support. A hypothesis, not tested with customers.", links: [[repoHref("docs/business/model.md"), "The business model"]] },
    { id: "tools", q: "Why not an existing spend or AP tool?", a: "They control a person with a card, or review an invoice after it is paid. Purser sits before the payment for an AI agent: code holds the agent's limit, and above it the CFO signs the exact terms, which the rail then carries.", links: [["proof", "The proof"]] },
    { id: "airwallex", q: "Why isn't this just Airwallex?", a: "Purser runs on Airwallex and uses its own controls. It adds what sits on top for agents: one CFO policy across Airwallex and Alta, a passkey over the exact terms before the API call, and a hash-chained audit log.", links: [["airwallex", "Airwallex"]] },
    { id: "start", q: "How long does it take to start?", a: `Try it yourself first: ${TRY_TAG}. A Founding Partner pilot starts with a defined onboarding: we set up your company and send a starter key, you add your passkey, and we scope one workflow with you. Then it runs for 30 days.`, links: [[TRY_URL, "Try it"], ["business#pilot", "The pilot"]] },
  ];
}

/** /one-pager's button: the browser's own print dialog, where "Save as PDF" is. */
export const PRINT_JS = `(function () { var b = document.getElementById("print"); if (b) { b.hidden = false; b.addEventListener("click", function () { window.print(); }); } })();`;

/** /one-pager's shared parts: its notes, the proof tiles and the plans. */
export const BUSINESS_CSS = `.bz-sub { margin: 0; color: var(--muted); font-size: 15px; line-height: 1.45; max-width: 46em; }
/* The proof tiles (Home's, from the run records). */
.bz-proof { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; grid-template-columns: repeat(auto-fit, minmax(min(100%, 200px), 1fr)); }
.bz-proof a { display: grid; gap: 2px; padding: 12px 14px; border-radius: 14px; background: var(--sunken); color: inherit; text-decoration: none; min-height: 44px; min-width: 0; }
.bz-proof a:hover { outline: 2px solid var(--accent); }
.bz-proof .k { display: flex; align-items: center; gap: 6px; font-size: 14px; font-weight: 700; color: var(--accent); }
.bz-proof .v { font-size: 20px; font-weight: 760; letter-spacing: -.01em; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.bz-proof .t { font-size: 14px; line-height: 1.35; overflow-wrap: anywhere; }
.bz-proof .g { justify-self: start; font-size: 14px; font-weight: 650; color: var(--muted); background: var(--surface); border-radius: 999px; padding: 1px 8px; margin-top: 4px; }
.bz-price { display: grid; gap: 8px; grid-template-columns: repeat(auto-fit, minmax(min(100%, 200px), 1fr)); }
.bz-price div { padding: 14px 16px; border-radius: 14px; background: var(--sunken); display: grid; gap: 2px; min-width: 0; }
.bz-price b { font-size: 14px; color: var(--muted); font-weight: 650; }
.bz-price span.v { font-size: 24px; font-weight: 780; letter-spacing: -.02em; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.bz-price span.v small { font-size: 14px; font-weight: 600; color: var(--muted); letter-spacing: 0; }
.bz-price small.d { font-size: 14px; color: var(--muted); }`;

/** Home's proof tiles (every value from a run record), as compact chips; links made relative to the page. */
export function proofChips(tiles: ProofTile[] = proofTiles()): string {
  if (!tiles.length) return "";
  return `<ul class="bz-proof">${tiles.map((t) => `<li${t.rec ? ` data-rec="${esc(t.rec)}"` : ""}><a href="${esc(t.href)}"${t.external ? ' target="_blank" rel="noopener"' : ""}><span class="k">${icon(t.icon, 14)}${esc(t.key)}</span><span class="v">${esc(t.value)}</span><span class="t">${esc(t.text)}</span><span class="g">${esc(t.tag)}</span></a></li>`).join("")}</ul>`;
}

/**
 * The fee per payout in one line (review, 21 Nov): its ceiling is the paying code's (FEE_BPS_CAP, src/airwallex/
 * platform.ts: 100 basis points, 1% of the payout); its rate is not set as a price, so a pilot agrees it.
 */
export const FEE_LINE = `Collected through Airwallex with each payout; capped at ${PRICING.platformFee.capBps / 100}% of the payout in code (FEE_BPS_CAP); rate agreed in the pilot`;
/** The label of the link to Purser Cloud's #/start (review, 21 Nov): it is for a company that was sent a starter key. */
export const STARTER_KEY_LABEL = "Have a starter key?";

export function priceHtml(): string {
  const { starter, business, platformFee } = PRICING;
  return `<div class="bz-price" data-rec="src/config/pricing.ts">
  <div><b>${esc(starter.name)}</b><span class="v">${esc(euro(starter.monthlyCents))} <small>a month</small></span><small class="d">${esc(`${starter.invoicesIncluded} invoices, then ${euro(starter.extraInvoiceCents)} each`)}</small></div>
  <div><b>${esc(business.name)}</b><span class="v"><small>from</small> ${esc(euro(business.fromMonthlyCents))} <small>a month</small></span><small class="d">${esc(business.includes.map((x, i) => (i ? x.toLowerCase() : x)).join(", "))}</small></div>
  <div><b>${esc(platformFee.name)}</b><span class="v"><small>a small fee per payout</small></span><small class="d">${esc(FEE_LINE)}</small></div>
</div>`;
}

/** The pilot form's choices for invoices a month. */
export const PILOT_VOLUMES: readonly string[] = ["<100", "100–500", "500–2,000", "2,000+"];
export const PILOT_SUBJECT = "Purser Founding Partner Pilot";
export const PILOT_APPLY = "Apply for the pilot";
export const PILOT_FORM_NOTE = "Opens your email app with your details filled in; nothing is stored.";
/** What the visitor fills in. */
export interface PilotForm { name: string; company: string; email: string; invoices: string; message?: string }
const one = (v: unknown, n: number) => String(v ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, n);
const msg = (v: unknown) => String(v ?? "").replace(/\r\n?/g, "\n").trim().slice(0, 2000);
/**
 * The mail the form opens: to the footer's contact address, subject "Purser Founding Partner Pilot: <Company>", the
 * fields listed in the body. Every value is percent-encoded (no header can be added) and single fields are one line.
 * PILOT_JS is the browser's copy (test/business-page.test.ts runs both on the same inputs).
 */
export function pilotMailto(f: PilotForm): string {
  const subject = `${PILOT_SUBJECT}: ${one(f.company, 200)}`;
  const body = [`Name: ${one(f.name, 200)}`, `Company: ${one(f.company, 200)}`, `Work email: ${one(f.email, 200)}`, `Invoices per month: ${one(f.invoices, 40)}`, `Message: ${msg(f.message) || "-"}`].join("\n");
  return `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
/** The page's one script: the same builder, then location.href on submit (after the browser's own validation). Nothing parsed as markup, no request. */
export const PILOT_JS = `(function () {
  var TO = ${JSON.stringify(CONTACT_EMAIL)}, SUBJECT = ${JSON.stringify(PILOT_SUBJECT)};
  function one(v, n) { return String(v == null ? "" : v).replace(/[\\r\\n]+/g, " ").trim().slice(0, n); }
  function msg(v) { return String(v == null ? "" : v).replace(/\\r\\n?/g, "\\n").trim().slice(0, 2000); }
  function build(f) {
    var subject = SUBJECT + ": " + one(f.company, 200);
    var body = ["Name: " + one(f.name, 200), "Company: " + one(f.company, 200), "Work email: " + one(f.email, 200), "Invoices per month: " + one(f.invoices, 40), "Message: " + (msg(f.message) || "-")].join("\\n");
    return "mailto:" + TO + "?subject=" + encodeURIComponent(subject) + "&body=" + encodeURIComponent(body);
  }
  globalThis.__purserPilot = { build: build };
  var form = document.getElementById("pilot-form");
  if (!form) return;
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    if (!form.reportValidity()) return;
    function v(n) { var el = form.elements.namedItem(n); return el ? el.value : ""; }
    location.href = build({ name: v("name"), company: v("company"), email: v("email"), invoices: v("invoices"), message: v("message") });
  });
})();`;

const PAGE_CSS = `main.bzp { padding: 0 0 32px; }
.bzp .wrap { max-width: 1120px; }
.bzp > .wrap { display: grid; gap: 22px; }
.bzh { position: relative; isolation: isolate; padding: 36px 0 8px; }
.bzh::before { content: ""; position: absolute; inset: 0; z-index: -1; pointer-events: none; background: radial-gradient(50% 80% at 85% 0%, color-mix(in srgb, var(--accent) 20%, transparent), transparent 70%); }
.bzh-g { display: grid; gap: 24px; grid-template-columns: minmax(0, 1fr); align-items: center; }
@media (min-width: 940px) { .bzh-g { grid-template-columns: minmax(0, 1.3fr) minmax(430px, .8fr); gap: 40px; } }
.bzh-pill { margin: 0; }
.bzh h1 { font-size: clamp(34px, 4.6vw, 60px); font-weight: 780; letter-spacing: -.03em; line-height: 1.04; margin: 12px 0 14px; max-width: 14em; }
.bzh-a { margin: 0; font-size: clamp(18px, 1.8vw, 22px); font-weight: 600; line-height: 1.4; color: var(--muted); max-width: 32em; }
/* The sign-up form. */
.bzf { padding: 24px; display: grid; gap: 16px; min-width: 0; scroll-margin-top: 120px; }
.bzf h2 { margin: 0; font-size: clamp(21px, 2.2vw, 26px); font-weight: 760; letter-spacing: -.02em; }
form.bzf-g { display: grid; gap: 14px; grid-template-columns: minmax(0, 1fr); }
@media (min-width: 720px) { form.bzf-g { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
.bzf-g label { display: grid; gap: 6px; font-size: 15px; font-weight: 650; min-width: 0; }
.bzf-g label small { font-weight: 500; color: var(--muted); font-size: 14px; }
.bzf-g .wide, .bzf-g .act { grid-column: 1 / -1; }
.bzf-g input, .bzf-g select, .bzf-g textarea { box-sizing: border-box; width: 100%; min-height: 48px; padding: 10px 12px; border-radius: 12px; border: 1px solid var(--border); background: var(--bg); color: var(--text); font: 500 16px/1.4 Inter, system-ui, sans-serif; }
.bzf-g textarea { min-height: 96px; resize: vertical; }
.bzf-g input:focus-visible, .bzf-g select:focus-visible, .bzf-g textarea:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.bzf-g .act { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 16px; }
.bzf-g .act .btn { white-space: normal; height: auto; min-height: 52px; padding: 12px 24px; font-size: 16px; }
.bzf-g .act p { margin: 0; font-size: 14px; color: var(--muted); line-height: 1.4; }
.bzf-g .act a { color: var(--accent); font-weight: 650; }
@media (max-width: 560px) { .bzh { padding-top: 20px; } .bzf { padding: 18px 14px; } .bzf-g .act .btn { width: 100%; justify-content: center; } }`;

export function businessPage(): string {
  // 22 Nov (Max: "far too much text"; then "still too much, the demo duplicates Home"): the question, one line, one small
  // animated visual and the pilot's sign-up form. Nothing else: the demo, the figures, the plans and the questions are
  // on Home, /proof and /one-pager.
  const d = demoFacts();
  const field = (name: string, label: string, attrs: string) => `<label><span>${esc(label)}</span><input name="${name}" ${attrs} required></label>`;
  const body = `<main class="bzp">
<section class="bzh" aria-labelledby="bzh-h"><div class="wrap"><div class="bzh-g">
<div><p class="bzh-pill"><span class="pill note">${icon("info", 14)}${esc(BUSINESS_LABEL)}</span></p>
<h1 id="bzh-h">${esc(BUSINESS_QUESTION)}</h1>
<p class="bzh-a">${esc(BUSINESS_LINE)}</p></div>
${pilotVisualHtml(d)}
</div></div></section>
<div class="wrap">
<section class="card bzf" id="pilot" aria-labelledby="bzf-h">
<h2 id="bzf-h">${esc(FOUNDING_NAME)}</h2>
<form class="bzf-g" id="pilot-form" aria-labelledby="bzf-h">
${field("name", "Name", 'type="text" autocomplete="name" maxlength="200"')}
${field("company", "Company", 'type="text" autocomplete="organization" maxlength="200"')}
${field("email", "Work email", 'type="email" autocomplete="email" maxlength="200"')}
<label><span>${esc("Invoices per month")}</span><select name="invoices" required><option value="">${esc("Choose")}</option>${PILOT_VOLUMES.map((v) => `<option>${esc(v)}</option>`).join("")}</select></label>
<label class="wide"><span>${esc("Message")} <small>${esc("(optional)")}</small></span><textarea name="message" rows="3" maxlength="2000"></textarea></label>
<div class="act"><button class="btn primary" type="submit">${icon("mail", 18)}${esc(PILOT_APPLY)}</button><p>${esc(PILOT_FORM_NOTE)}<br>${esc("or")} <a href="${esc(PILOT_MAIL)}">${esc("email us directly")}</a> · <a href="${ONE_PAGER_PATH}">${esc("the one-pager")}</a></p></div>
</form>
</section>
</div></main>`;
  return page({
    title: "For companies", tab: "business", css: `${BUSINESS_VISUAL_CSS}\n${PAGE_CSS}`, body, js: PILOT_JS, stage: false,
    description: "Would you trust an AI agent with your company's money? Apply for Purser's 30-day Founding Partner Pilot: agents pay the routine, your CFO signs the rest with Face ID. Test money only.",
    source: "Source: the recorded /try runs (docs/runs/2026-11-21-phone-try/summary.json) for the visual's amounts; the form only opens the visitor's own mail app (src/redesign/business.ts pilotMailto).",
    real: [
      "Test money only: sandboxes and testnet. No customers, pilots or revenue yet.",
      "The form sends nothing itself and stores nothing: it opens your own email app with the fields filled in.",
      `${FIRST_TARGET_NOTE} Built on Airwallex; no partnership or endorsement is claimed.`,
    ],
  });
}

const ONE_CSS = `.op { padding: 22px 0 28px; }
.op .wrap { max-width: 900px; display: grid; gap: 14px; }
.op-bar { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; justify-content: space-between; }
.op-bar .btn { white-space: normal; height: auto; min-height: 44px; padding: 8px 18px; }
.sheet { padding: 26px; display: grid; gap: 14px; min-width: 0; }
.sheet header.sh { display: flex; flex-wrap: wrap; gap: 6px 16px; align-items: baseline; justify-content: space-between; border-bottom: 2px solid var(--text); padding-bottom: 10px; }
.sheet header.sh b { font-size: 26px; font-weight: 800; letter-spacing: -.02em; display: inline-flex; align-items: center; gap: 8px; }
.sheet header.sh span { font-size: 14px; color: var(--muted); overflow-wrap: anywhere; }
.sheet h1 { margin: 0; font-size: clamp(22px, 3vw, 28px); font-weight: 780; letter-spacing: -.02em; line-height: 1.2; }
.sheet p { margin: 0; font-size: 15px; line-height: 1.5; overflow-wrap: anywhere; }
.sheet h2 { margin: 0 0 6px; font-size: 14px; font-weight: 750; letter-spacing: .07em; text-transform: uppercase; color: var(--accent); }
.sheet .two { display: grid; gap: 14px; grid-template-columns: minmax(0, 1fr); }
@media (min-width: 700px) { .sheet .two { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
.sheet ul.t { list-style: none; margin: 0; padding: 0; display: grid; gap: 5px; }
.sheet ul.t li { display: flex; gap: 8px; align-items: flex-start; font-size: 14.5px; line-height: 1.4; }
.sheet ul.t li .i { color: var(--ok); margin-top: 2px; flex: none; }
.sheet ol.s { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; grid-template-columns: repeat(auto-fit, minmax(min(100%, 150px), 1fr)); counter-reset: s; }
.sheet ol.s li { counter-increment: s; border: 1px solid var(--border); border-radius: 12px; padding: 10px 12px; font-size: 14px; line-height: 1.4; min-width: 0; }
.sheet ol.s li::before { content: counter(s); display: inline-grid; place-items: center; width: 20px; height: 20px; border-radius: 50%; background: var(--text); color: var(--bg); font-size: 14px; font-weight: 700; margin-right: 6px; }
.sheet ol.s li b { font-size: 14.5px; }
.sheet .bz-proof .v { font-size: 17px; }
.sheet .bz-price span.v { font-size: 20px; }
.sheet footer.sf { border-top: 1px solid var(--border); padding-top: 10px; display: flex; flex-wrap: wrap; gap: 6px 18px; justify-content: space-between; font-size: 14px; }
.sheet footer.sf a { color: var(--accent); font-weight: 650; overflow-wrap: anywhere; }
.sheet small.n { color: var(--muted); font-size: 14px; line-height: 1.4; }
@media print {
  @page { size: A4; margin: 10mm; }
  /* On paper always light, whatever the screen's theme. */
  :root, :root:not([data-theme="light"]), :root[data-theme="dark"] { --bg: #ffffff; --surface: #ffffff; --sunken: #f1f3f7; --border: #d5d9e0; --text: #0b1220; --muted: #4b5466; --faint: #586174; --accent: #4f46e5; --accent-soft: #eef0ff; --ok: #0b7d43; color-scheme: light; }
  body { background: #fff !important; color: #0b1220 !important; }
  header.top, .awx-row, footer.foot, .op-bar, .noprint { display: none !important; }
  .op { padding: 0; } .op .wrap { max-width: none; gap: 0; }
  .sheet { border: 0 !important; box-shadow: none !important; padding: 0; gap: 7px; }
  .sheet p, .sheet ul.t li, .sheet ol.s li { font-size: 10.5px; line-height: 1.38; }
  .sheet ul.t { gap: 2px; } .sheet ul.t li .i { width: 12px; height: 12px; }
  .sheet h1 { font-size: 18px; } .sheet header.sh { padding-bottom: 6px; } .sheet header.sh b { font-size: 18px; }
  .sheet h2 { font-size: 10.5px; margin-bottom: 3px; }
  .sheet .two { grid-template-columns: 1fr 1fr; gap: 10px; }
  .sheet ol.s { grid-template-columns: repeat(4, 1fr); gap: 6px; } .sheet ol.s li { padding: 6px 8px; }
  .bz-proof { grid-template-columns: repeat(4, 1fr); gap: 6px; }
  .bz-price { grid-template-columns: repeat(3, 1fr); gap: 6px; }
  .bz-proof a, .bz-price div { padding: 6px 8px; }
  .sheet .bz-proof .v, .sheet .bz-price span.v { font-size: 15px; }
  .bz-proof .t, .bz-price small.d, .sheet small.n, .sheet footer.sf { font-size: 10px; }
  .sheet footer.sf { padding-top: 6px; }
  .sheet a { color: #000 !important; text-decoration: none; }
  * { animation: none !important; transition: none !important; }
}`;

/** /one-pager: the sales sheet, one A4 page when printed ("Save as PDF" in the print dialog). */
export function onePagerPage(): string {
  const host = SITE_URL.replace(/^https:\/\//, "");
  const tick = (l: string) => `<li>${icon("check", 15)}<span>${esc(l)}</span></li>`;
  const body = `<main class="op"><div class="wrap">
  <div class="op-bar"><span class="pill note">${icon("info", 14)}${esc("Test money only · one page to keep")}</span><button class="btn primary" id="print" type="button" hidden>${icon("download", 18)}${esc("Save as PDF")}</button></div>
  <article class="card sheet" aria-labelledby="op-h">
    <header class="sh"><b>${icon("feather", 20)}Purser</b><span>${esc(`${host} · built on Airwallex`)}</span></header>
    <h1 id="op-h">${esc(BUSINESS_H1)}</h1>
    <p>${esc(BUSINESS_LEAD)}</p>
    <div class="two">
      <section><h2>${esc("The problem")}</h2><p>${esc("AI agents will spend company money. Today a company has two options: no agents, so every invoice is read and paid by hand; or blind trust, a shared card or a limit written in a prompt, found out at month end.")}</p></section>
      <section><h2>${esc("What changes")}</h2><ul class="t">${OUTCOMES.map((o) => tick(`${o.title}. ${o.line}`)).join("")}</ul></section>
    </div>
    <section><h2>${esc("Shown in sandboxes and on testnet, test money")}</h2>${proofChips()}</section>
    <div class="two">
      <section><h2>${esc("Who it is for")}</h2><p>${esc(`${FIRST_TARGET} ${FIRST_TARGET_NOTE} Accounting firms: an accountant reads each client's books and cannot pay.`)}</p></section>
      <section><h2>${esc("Your data and your bank")}</h2><p>${esc(faqs().find((f) => f.id === "data")!.a)} ${esc("Your money stays in your own Airwallex account; Purser is never in the flow of funds.")}</p></section>
    </div>
    <section><h2>${esc(`${FOUNDING_CTA}: the ${FOUNDING_NAME}`)}</h2><p>${esc(`${FOUNDING_TEXT} Free for 30 days, for selected businesses. ${FOUNDING_POINTS.join(" ")} At the end you choose whether to move to a paid plan, if one is offered then; nothing is billed.`)}</p><ol class="s">${PILOT_STEPS.map((s) => `<li><b>${esc(s.title)}</b><br>${esc(s.line)}</li>`).join("")}</ol></section>
    <section><h2>${esc("Plans after the pilot")}</h2>${priceHtml()}<small class="n">${esc(`${PRICING_LEAD} Not yet validated with customers.`)}</small></section>
    <footer class="sf"><span>${esc(`${FOUNDING_CTA}:`)} <a href="${esc(PILOT_MAIL)}">${esc(CONTACT_EMAIL)}</a></span><span>${esc("Try it:")} <a href="${esc(`${SITE_URL}${TRY_URL}`)}">${esc(`${host}${TRY_URL}`)}</a></span><span>${esc("Purser Cloud:")} <a href="${esc(CLOUD_SETUP_URL)}" target="_blank" rel="noopener">${esc(STARTER_KEY_LABEL)}</a></span></footer>
    <small class="n">${esc("Test money only: sandboxes and testnet. No customers, pilots or revenue yet. Built on Airwallex; no partnership or endorsement is claimed. Every figure links to its record on the site.")}</small>
  </article>
  <p class="bz-sub noprint">${siteLink("business", "Back to For companies")}</p>
</div></main>`;
  return page({
    title: "One-pager", tab: "business", css: `${BUSINESS_CSS}\n${ONE_CSS}`, body, js: PRINT_JS, stage: false,
    description: "Purser on one page: AI agents that pay suppliers and buy software, with the CFO approving the exact terms with Face ID. The problem, what changes, the proof, the pilot and its pilot prices. Print it or save it as a PDF.",
    source: "Source: as /business: src/config/pricing.ts, the run records behind the proof tiles, cloud/wrangler.jsonc and docs/cloud.md.",
    real: ["Test money only: sandboxes and testnet. No customers, pilots or revenue yet.", "The first target customer and the accounting-firm channel are hypotheses."],
  });
}
