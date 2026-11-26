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
import { BUSINESS_LINE, BUSINESS_QUESTION } from "./businessVisuals.js";
import { TRY_URL, esc, icon, page } from "./ui.js";
import { picon } from "./proofIcons.js";

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
/**
 * Three short questions that qualify a pilot (26 Nov, the owner), each a row of chips; none is required. The name is
 * the form field's, the label the mail's line.
 */
export const PILOT_QUESTIONS: readonly { name: "pay" | "approver" | "start"; q: string; line: string; options: readonly string[] }[] = [
  { name: "pay", q: "How do you pay suppliers today?", line: "Pays suppliers through", options: ["Bank portal", "AP tool", "Spreadsheets"] },
  { name: "approver", q: "Who approves payments?", line: "Approves payments", options: ["CFO", "Founder", "Accountant"] },
  { name: "start", q: "When would you start?", line: "Would start", options: ["Now", "Next quarter", "Exploring"] },
];
export const PILOT_SUBJECT = "Purser Founding Partner Pilot";
export const PILOT_APPLY = "Apply for the pilot";
export const PILOT_FORM_NOTE = "Opens your email app with your details filled in; nothing is stored.";
/** What the visitor fills in. */
export interface PilotForm { name: string; company: string; email: string; invoices: string; pay?: string; approver?: string; start?: string }
const one = (v: unknown, n: number) => String(v ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, n);
/**
 * The mail the form opens: to the footer's contact address, subject "Purser Founding Partner Pilot: <Company>", the
 * fields listed in the body, an unanswered question as "-". Every value is percent-encoded (no header can be added) and
 * every field is one line. PILOT_JS is the browser's copy (test/business-page.test.ts runs both on the same inputs).
 */
export function pilotMailto(f: PilotForm): string {
  const subject = `${PILOT_SUBJECT}: ${one(f.company, 200)}`;
  const body = [`Name: ${one(f.name, 200)}`, `Company: ${one(f.company, 200)}`, `Work email: ${one(f.email, 200)}`, `Invoices per month: ${one(f.invoices, 40)}`,
    ...PILOT_QUESTIONS.map((x) => `${x.line}: ${one(f[x.name], 40) || "-"}`)].join("\n");
  return `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
/** The words the form says once it has opened the mail, and when a field still needs filling in. */
export const PILOT_SENT = "Your email app should now open with your details filled in. Press Send there to apply; nothing was sent from this page.";
export const PILOT_MISSING = "Please fill in the fields marked in red.";
/** The page's one script (the globe after it): the same builder, then location.href on submit (after the browser's own validation), and a status line. Nothing parsed as markup, no request. */
export const PILOT_JS = `(function () {
  var TO = ${JSON.stringify(CONTACT_EMAIL)}, SUBJECT = ${JSON.stringify(PILOT_SUBJECT)}, QS = ${JSON.stringify(PILOT_QUESTIONS.map((x) => [x.name, x.line]))};
  function one(v, n) { return String(v == null ? "" : v).replace(/[\\r\\n]+/g, " ").trim().slice(0, n); }
  function build(f) {
    var subject = SUBJECT + ": " + one(f.company, 200);
    var body = ["Name: " + one(f.name, 200), "Company: " + one(f.company, 200), "Work email: " + one(f.email, 200), "Invoices per month: " + one(f.invoices, 40)]
      .concat(QS.map(function (x) { return x[1] + ": " + (one(f[x[0]], 40) || "-"); })).join("\\n");
    return "mailto:" + TO + "?subject=" + encodeURIComponent(subject) + "&body=" + encodeURIComponent(body);
  }
  globalThis.__purserPilot = { build: build };
  var form = document.getElementById("pilot-form");
  if (!form) return;
  var st = document.getElementById("pilot-status");
  function say(t, kind) { if (!st) return; st.textContent = t; st.className = "bzf-st " + kind; st.hidden = false; }
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    form.classList.add("tried");
    if (!form.reportValidity()) { say(${JSON.stringify(PILOT_MISSING)}, "bad"); return; }
    function v(n) { var el = form.elements.namedItem(n); return el ? el.value : ""; }
    location.href = build({ name: v("name"), company: v("company"), email: v("email"), invoices: v("invoices"), pay: v("pay"), approver: v("approver"), start: v("start") });
    say(${JSON.stringify(PILOT_SENT)}, "ok");
  });
})();`;

/** Three points under the form, each true of the pilot as it is offered (FOUNDING_POINTS, PILOT_AGREEMENT). */
export const PILOT_TRUST: readonly [string, string][] = [["flask-conical", "Test money only"], ["credit-card", "No card, no billing"], ["file-check", "Written agreement"]];

const PAGE_CSS = `body { background: var(--bg); }
main.bzp { position: relative; isolation: isolate; overflow: hidden; min-height: calc(100vh - 140px); min-height: calc(100svh - 140px); display: grid; align-items: center; }
/* The ground: one large, soft violet glow that drifts slowly, over a faint grid fading out from the middle. */
main.bzp::before { content: ""; position: absolute; z-index: -1; left: 50%; top: 46%; width: min(1100px, 130vw); height: min(760px, 110vw); translate: -50% -50%; pointer-events: none; border-radius: 50%;
  background: radial-gradient(closest-side, color-mix(in srgb, var(--accent) 34%, transparent), color-mix(in srgb, var(--accent-ink) 14%, transparent) 55%, transparent);
  filter: blur(60px); opacity: .9; }
main.bzp::after { content: ""; position: absolute; z-index: -2; inset: 0; pointer-events: none;
  background-image: linear-gradient(color-mix(in srgb, var(--text) 6%, transparent) 1px, transparent 1px), linear-gradient(90deg, color-mix(in srgb, var(--text) 6%, transparent) 1px, transparent 1px);
  background-size: 56px 56px; -webkit-mask-image: radial-gradient(60% 55% at 50% 45%, #000, transparent); mask-image: radial-gradient(60% 55% at 50% 45%, #000, transparent); }
@media (prefers-reduced-motion: no-preference) { main.bzp::before { animation: bz-drift 18s ease-in-out infinite alternate; } }
@keyframes bz-drift { from { translate: -56% -52%; scale: 1; } to { translate: -44% -46%; scale: 1.08; } }
@media (prefers-color-scheme: light) { :root:not([data-theme="dark"]) main.bzp::before { opacity: .55; } }
:root[data-theme="light"] main.bzp::before { opacity: .55; }
.bzp .wrap { max-width: 1120px; }
.bzx { padding: clamp(40px, 9vh, 120px) 0; }
.bzx-g { display: grid; gap: 40px; grid-template-columns: minmax(0, 1fr); align-items: center; }
@media (min-width: 980px) { .bzx-g { grid-template-columns: minmax(0, 1fr) minmax(380px, 420px); gap: clamp(48px, 7vw, 112px); } }
.bzx-pill { margin: 0; }
.bzx h1 { margin: 22px 0 0; font-size: clamp(40px, 4.7vw, 68px); font-weight: 760; letter-spacing: -.045em; line-height: .98; max-width: 10.5em; text-wrap: balance; }
.bzx-a { margin: 22px 0 0; max-width: 26em; font-size: clamp(17px, 1.4vw, 20px); line-height: 1.5; color: var(--muted); }
/* The form: one quiet card. */
.bzf { position: relative; padding: 28px; border-radius: 24px; min-width: 0;
  background: linear-gradient(180deg, color-mix(in srgb, var(--surface) 90%, transparent), color-mix(in srgb, var(--surface) 76%, transparent));
  border: 1px solid var(--glass-line); box-shadow: inset 0 1px 0 rgba(255, 255, 255, .06), 0 50px 100px -50px var(--glow), 0 24px 60px -40px rgba(8, 6, 28, .6);
  -webkit-backdrop-filter: blur(20px) saturate(1.3); backdrop-filter: blur(20px) saturate(1.3); }
.bzf::before { content: ""; position: absolute; left: 16%; right: 16%; top: -1px; height: 1px; background: linear-gradient(90deg, transparent, var(--accent), transparent); }
.bzf h2 { margin: 0; font-size: 20px; font-weight: 720; letter-spacing: -.02em; line-height: 1.25; }
.bzf > p { margin: 6px 0 0; font-size: 14px; line-height: 1.45; color: var(--muted); }
form.bzf-g { margin: 22px 0 0; display: grid; gap: 14px; grid-template-columns: minmax(0, 1fr); }
.bzf-g label { display: grid; gap: 6px; min-width: 0; font-size: 14px; font-weight: 600; }
.bzf-g input:not([type="radio"]), .bzf-g select { box-sizing: border-box; width: 100%; min-height: 46px; padding: 10px 13px; border-radius: 12px; border: 1px solid color-mix(in srgb, var(--text) 13%, var(--border));
  background: color-mix(in srgb, var(--bg) 60%, var(--surface)); color: var(--text); font: 500 16px/1.4 Inter, system-ui, sans-serif; transition: border-color .15s ease, box-shadow .15s ease; }
.bzf-g select { appearance: none; -webkit-appearance: none; padding-right: 38px; cursor: pointer;
  background-image: linear-gradient(45deg, transparent 50%, var(--muted) 50%), linear-gradient(135deg, var(--muted) 50%, transparent 50%);
  background-position: calc(100% - 19px) 52%, calc(100% - 14px) 52%; background-size: 5px 5px, 5px 5px; background-repeat: no-repeat; }
.bzf-g ::placeholder { color: var(--faint); opacity: 1; }
.bzf-g input:not([type="radio"]):hover, .bzf-g select:hover { border-color: color-mix(in srgb, var(--accent) 40%, var(--border)); }
.bzf-g input:not([type="radio"]):focus-visible, .bzf-g select:focus-visible { outline: none; border-color: var(--accent); box-shadow: 0 0 0 4px color-mix(in srgb, var(--accent) 22%, transparent); }
.bzf-g.tried :invalid, .bzf-g :user-invalid { border-color: var(--bad); box-shadow: 0 0 0 3px color-mix(in srgb, var(--bad) 16%, transparent); }
/* A question as a row of chips (radios), never required. */
.bzf-g fieldset { margin: 0; padding: 0; border: 0; min-width: 0; }
.bzf-g legend { padding: 0; margin: 0 0 8px; font-size: 14px; font-weight: 600; }
.bzf-g legend small { font-weight: 500; color: var(--faint); }
.bzf-g .chips { display: flex; flex-wrap: wrap; gap: 6px; }
.bzf-g .chips label { display: inline-flex; position: relative; font-weight: 550; }
.bzf-g .chips input { position: absolute; opacity: 0; width: 1px; height: 1px; }
.bzf-g .chips span { display: inline-flex; align-items: center; min-height: 34px; padding: 0 13px; border-radius: 999px; border: 1px solid color-mix(in srgb, var(--text) 13%, var(--border)); font-size: 14px; color: var(--muted); cursor: pointer; transition: border-color .15s ease, background-color .15s ease, color .15s ease; }
.bzf-g .chips span:hover { border-color: color-mix(in srgb, var(--accent) 45%, var(--border)); color: var(--text); }
.bzf-g .chips input:checked + span { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 16%, transparent); color: var(--text); }
.bzf-g .chips input:focus-visible + span { outline: 3px solid color-mix(in srgb, var(--accent) 55%, transparent); outline-offset: 2px; }
/* "Tell us more": the rest of the questions, folded, all optional. */
.bzf-g details.more { border-top: 1px solid var(--glass-line); padding-top: 12px; }
.bzf-g details.more > summary { list-style: none; display: inline-flex; align-items: center; gap: 8px; min-height: 32px; font-size: 14px; font-weight: 600; color: var(--muted); cursor: pointer; border-radius: 8px; }
.bzf-g details.more > summary::-webkit-details-marker { display: none; }
.bzf-g details.more > summary::after { content: ""; width: 6px; height: 6px; border-right: 1.5px solid currentColor; border-bottom: 1.5px solid currentColor; transform: rotate(45deg) translateY(-2px); transition: transform .15s ease; }
.bzf-g details.more[open] > summary::after { transform: rotate(225deg) translateY(-1px); }
.bzf-g details.more > summary:hover { color: var(--text); }
.bzf-g details.more > div { display: grid; gap: 14px; padding-top: 10px; }
.bzf-g .act { display: grid; gap: 10px; margin-top: 2px; }
.bzf-g .act .btn { width: 100%; justify-content: center; height: auto; min-height: 52px; padding: 13px 22px; font-size: 16.5px; white-space: normal; }
.bzf-g .act p { margin: 0; text-align: center; font-size: 14px; line-height: 1.5; color: var(--muted); text-wrap: balance; }
.bzf-g .act a { color: var(--accent); font-weight: 650; }
.bzf-st { margin: 0; padding: 11px 13px; border-radius: 12px; font-size: 14px; font-weight: 550; line-height: 1.45; }
.bzf-st.ok { color: var(--ok); background: color-mix(in srgb, var(--ok) 10%, transparent); border: 1px solid color-mix(in srgb, var(--ok) 35%, transparent); }
.bzf-st.bad { color: var(--bad); background: color-mix(in srgb, var(--bad) 8%, transparent); border: 1px solid color-mix(in srgb, var(--bad) 35%, transparent); }
.bzf-st[hidden] { display: none; }
/* Three tiny points under the form. */
ul.bzt { list-style: none; margin: 16px 0 0; padding: 0; display: flex; flex-wrap: wrap; justify-content: center; gap: 6px 14px; }
ul.bzt li { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 500; color: var(--muted); white-space: nowrap; }
ul.bzt li .i { width: 14px; height: 14px; color: var(--accent); }
/* The page's own footer: one line. */
footer.bzfoot { padding: 20px 0 28px; }
footer.bzfoot p { margin: 0; display: flex; flex-wrap: wrap; justify-content: center; gap: 4px 14px; font-size: 14px; line-height: 1.5; color: var(--faint); text-align: center; }
footer.bzfoot a { color: var(--muted); }
@media (prefers-reduced-motion: reduce) { .bzf-g input, .bzf-g select, .bzf-g .chips span, .bzf-g details.more > summary::after { transition: none; } }
@media (max-width: 520px) { .bzf { padding: 22px 16px; border-radius: 20px; } .bzx h1 { font-size: clamp(36px, 10.5vw, 46px); } main.bzp { min-height: 0; } }`;

/** The one question in sight; the others fold under "Tell us more". */
const ASKED = "start";

export function businessPage(): string {
  // 22 Nov (Max: "far too much text"): the question, one line, one visual and the form. 26 Nov (Max: "really ugly";
  // then "far too full again", and the globe is the sign-in's): one screen, simple and high-tech: a deep page with one
  // soft violet glow, the question and one line, a short form (name, work email, company and one optional question;
  // the rest folded under "Tell us more"), three tiny points and one footer line. The form still only opens the
  // visitor's own mail app; nothing is stored.
  const field = (name: string, label: string, attrs: string) => `<label><span>${esc(label)}</span><input name="${name}" ${attrs} required></label>`;
  const chips = (x: (typeof PILOT_QUESTIONS)[number]) => `<fieldset><legend>${esc(x.q)} <small>${esc("optional")}</small></legend><div class="chips">${x.options.map((o) => `<label><input type="radio" name="${x.name}" value="${esc(o)}"><span>${esc(o)}</span></label>`).join("")}</div></fieldset>`;
  const body = `<main class="bzp">
<section class="bzx" aria-labelledby="bzh-h"><div class="wrap"><div class="bzx-g">
<div class="bzx-l"><p class="bzx-pill"><span class="pill note">${icon("info", 14)}${esc(BUSINESS_LABEL)}</span></p>
<h1 id="bzh-h">${esc(BUSINESS_QUESTION)}</h1>
<p class="bzx-a">${esc(BUSINESS_LINE)}</p></div>
<div class="bzx-r" id="pilot">
<section class="bzf" aria-labelledby="bzf-h"><h2 id="bzf-h">${esc(FOUNDING_NAME)}</h2><p>${esc("Free for 30 days. We reply by email.")}</p>
<form class="bzf-g" id="pilot-form" aria-labelledby="bzf-h" novalidate>
${field("name", "Name", 'type="text" autocomplete="name" maxlength="200" placeholder="Ada Jansen"')}
${field("email", "Work email", 'type="email" autocomplete="email" maxlength="200" placeholder="ada@company.com"')}
${field("company", "Company", 'type="text" autocomplete="organization" maxlength="200" placeholder="Northwind B.V."')}
${chips(PILOT_QUESTIONS.find((x) => x.name === ASKED)!)}
<details class="more"><summary>${esc("Tell us more")}</summary><div>
<label><span>${esc("Invoices per month")}</span><select name="invoices"><option value="">${esc("Choose")}</option>${PILOT_VOLUMES.map((v) => `<option>${esc(v)}</option>`).join("")}</select></label>
${PILOT_QUESTIONS.filter((x) => x.name !== ASKED).map(chips).join("\n")}
</div></details>
<div class="act"><button class="btn primary" type="submit">${esc(PILOT_APPLY)}${picon("arrow-right", 18)}</button><p>${esc(PILOT_FORM_NOTE)}<br>${esc("Or")} <a href="${esc(PILOT_MAIL)}">${esc("email us directly")}</a> · <a href="${ONE_PAGER_PATH}">${esc("the one-pager")}</a></p></div>
<p class="bzf-st" id="pilot-status" role="status" hidden></p>
</form></section>
<ul class="bzt">${PILOT_TRUST.map(([i, l]) => `<li>${picon(i, 14)}${esc(l)}</li>`).join("")}</ul>
</div>
</div></div></section>
</main>`;
  // One footer line in place of the site's (Max: no "What's real?", no row of links here): the honesty, the contact.
  const foot = `<footer class="bzfoot"><div class="wrap"><p><span>${esc(BUSINESS_HONEST)}</span><a href="mailto:${esc(CONTACT_EMAIL)}">${esc(CONTACT_EMAIL)}</a></p></div></footer>`;
  return page({
    title: "For companies", tab: "business", css: PAGE_CSS, body, js: PILOT_JS, stage: false, footer: foot,
    description: "Would you trust an AI agent with your company's money? Apply for Purser's 30-day Founding Partner Pilot: agents pay the routine, your CFO signs the rest with Face ID. Test money only.",
    source: "Source: the form only opens the visitor's own mail app (src/redesign/business.ts pilotMailto).",
  });
}
/** The page's one honesty line (its footer): test money, no customers yet, no endorsement claimed. */
export const BUSINESS_HONEST = "Test money only. No customers, pilots or revenue yet. Built on Airwallex; no partnership or endorsement claimed.";

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
