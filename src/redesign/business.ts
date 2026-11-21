// /business, "For companies" (21 Nov; Max: "we are technically strong, now we must make it commercially strong"), and
// /one-pager, its printable sales sheet. One page a business owner can act on: the problem, what changes, who it is
// for, a calculator for the visitor's own numbers, the pilot (what you get, how it starts, what it costs, whom to write
// to) and the questions a buyer asks first. Nothing is invented:
//   - every price is read from src/config/pricing.ts (pilot prices; nothing is on sale yet, as /pricing said);
//   - the calculator only does arithmetic on what the visitor types: the defaults are example inputs, labelled so, and
//     no figure is a customer's (there are none) or a measured saving;
//   - the proof tiles are Home's, read from the run records (src/redesign/home.ts proofTiles);
//   - where the data lives is /privacy's own reading of the Workers' configs (src/redesign/privacy.ts residency);
//   - the pilot steps are how Purser Cloud starts a company today (docs/cloud.md: POST /v1/admin/tenants hands over a
//     starter key; the owner makes a passkey at #/start); test money only;
//   - "never in the flow of funds" is docs/airwallex-platform.md's; the checks are src/ap/checkerCore.ts's (docs/claims.md).
// The first target customer and the accounting-firm channel are hypotheses (docs/business/model.md) and say so. Built on
// Airwallex; no partnership or endorsement is claimed. No competitor, customer, quote or founder is named.
// One small script: the calculator (textContent only, nothing parsed as markup), and /one-pager's print button.

import { CONTACT_EMAIL } from "../config/brand.js";
import { PRICING, PRICING_LINE, euro } from "../config/pricing.js";
import { SITE_URL } from "../ui/siteUrl.js";
import { CLOUD_SETUP_URL, START_STEPS, proofTiles, type ProofTile } from "./home.js";
import { PRICING_LEAD } from "./pricing.js";
import { residency } from "./privacy.js";
import { foldHtml, outLink, productPage, repoHref, siteLink } from "./productPage.js";
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
export const FOUNDING_TEXT = "Get 30 days of guided access to Purser. Help shape the future of autonomous financial operations while retaining human control over every critical payment decision.";
export const GO_LIVE_DOC = "docs/go-live.md";
export const FOUNDING_POINTS: readonly string[] = [
  "No credit card. No automatic conversion or billing.",
  "A defined onboarding and one clearly scoped financial workflow.",
  "Direct access to the team: your feedback shapes the product.",
  "Sandbox and test money until the go-live requirements are met.",
];
export const FOUNDING_TERMS: readonly { id: string; title: string; line: string }[] = [
  { id: "eligibility", title: "Eligibility", line: "Selected businesses: a registered company with a person who approves payments (a CFO, a fractional CFO or an accountant) and one workflow to bring." },
  { id: "scope", title: "Scope", line: "One financial workflow, agreed at onboarding, such as paying supplier invoices. No production payments until the go-live requirements are met." },
  { id: "after", title: "After 30 days", line: "Nothing is billed. You choose whether to move to an existing paid plan. Early access for design partners, not a permanent free offer." },
];
export const BUSINESS_H1 = "Let AI agents pay. Keep the CFO in control.";
export const BUSINESS_LEAD = POSITION;
export const ONE_PAGER_PATH = "one-pager";
/** Said wherever the calculator's result is: it is the visitor's own arithmetic, not a result Purser has seen. */
export const CALC_NOTE = "Your inputs, our arithmetic: an estimate, not a result. No company has used Purser for a month yet, so no figure here is measured.";
/** The "Try it" step's own tag on Home ("2 minutes · deleted after 24 h"). */
const TRY_TAG = START_STEPS[0]!.tag;

/** Today's two options and Purser, side by side. */
export const OPTIONS: readonly { id: string; icon: string; title: string; line: string; us?: true }[] = [
  { id: "none", icon: "ban", title: "No agents", line: "Safe, but every invoice is read, checked and paid by hand." },
  { id: "blind", icon: "triangle-alert", title: "Blind trust", line: "A shared card or a limit in a prompt, found out at month end." },
  { id: "purser", icon: "shield-check", title: "Purser", line: "Agents do the routine, the rails hold the limits, the CFO signs the rest.", us: true },
];

/** What changes for the company, each with where it is shown. */
export const OUTCOMES: readonly { icon: string; title: string; line: string; href: string; label: string }[] = [
  { icon: "scan-face", title: "The CFO signs the exact terms", line: "Over a limit, a payment waits for the CFO's Face ID. Change one cent and the signature breaks.", href: "verify", label: "Verify a payment" },
  { icon: "lock", title: "Limits live in the rails", line: "Airwallex card limits, Alta mandates on chain, Visa via Airwallex Airi. Not a prompt.", href: "proof", label: "The proof" },
  { icon: "file-check", title: "Checks before money leaves", line: "Duplicate or split invoices, changed bank details, instructions hidden in an invoice.", href: "security", label: "Security" },
  { icon: "receipt", title: "In the books at once", line: "Every payment posted with its proof (T:0), for you and your accountant.", href: "books", label: "Books" },
];

/** The pilot, as Purser Cloud starts a company today (docs/cloud.md). */
export const PILOT_STEPS: readonly { icon: string; title: string; line: string }[] = [
  { icon: "mail", title: "Write to us", line: "Tell us how your company pays suppliers today." },
  { icon: "building-2", title: "We set up your company", line: "In Purser Cloud, with a starter key for its owner." },
  { icon: "scan-face", title: "Add your passkey", line: "Face ID on your phone. Suppliers' invoices go to your company's inbox address." },
  { icon: "zap", title: "Run your workflow, 30 days", line: "Agents propose, the CFO signs, the books fill. On test money." },
];

/** The buyer's first questions, each answered from what is built, with where to check it. */
export interface Faq { id: string; q: string; a: string; links: [string, string][] }
export function faqs(): Faq[] {
  // /privacy's reading of the configs: the database and the documents in the EU, the engine not pinned yet, AI and alerts opt-in.
  const z = Object.fromEntries(residency().map((r) => [r.id, r.zone]));
  if (z.db !== "eu" || z.docs !== "eu" || z.engine !== "open" || z.ai !== "out") throw new Error("/business: where the data lives no longer reads as /privacy has it");
  return [
    { id: "wrong", q: "What if the AI is wrong?", a: "It only proposes. Code checks every invoice and every payment against the limits the CFO signed; anything over them waits for the CFO's Face ID. If an agent tries anyway, the rail refuses: in test runs Airwallex declined a card charge over its limit, and Alta refused an over-cap payment on chain.", links: [["proof", "The proof"], ["security", "Security"]] },
    { id: "liable", q: "Who is liable for a payment?", a: "Your company stays the payer, from its own Airwallex account: Purser is never in the flow of funds. Each payment carries the CFO's signature over its exact terms, and a receipt anyone can verify. Liability terms would be set in a pilot agreement; none is signed yet.", links: [["verify", "Verify a receipt"]] },
    { id: "data", q: "Where is my data?", a: "Purser Cloud's database and documents are in the EU (western Europe, EU jurisdiction); each company's engine and its logs are not pinned to a region yet. Claude and e-mail or WhatsApp alerts leave the EU only when switched on. Access, export and erasure are built in.", links: [["privacy", "Privacy"]] },
    { id: "bank", q: "Do I change banks?", a: "No. Purser works on your company's own Airwallex account, today with an API key you create there. Connecting by signing in at Airwallex is built, not live yet.", links: [["airwallex", "Airwallex"]] },
    { id: "cost", q: "What does it cost?", a: `The ${FOUNDING_NAME} is free, with no credit card and no automatic billing. After it, the plans: ${PRICING_LINE} ${PRICING_LEAD} These prices are not yet validated with customers.`, links: [["#pricing", "The plans"]] },
    { id: "start", q: "How long does it take to start?", a: `Try it yourself first: ${TRY_TAG}. A Founding Partner pilot starts with a defined onboarding: we set up your company and send a starter key, you add your passkey, and we scope one workflow with you. Then it runs for 30 days.`, links: [[TRY_URL, "Try it"], ["#pilot", "The pilot"]] },
  ];
}

/** The calculator's inputs: the defaults are example inputs, for the visitor to replace. */
export interface CalcIn { invoices: number; minutes: number; hourly: number; share: number; atRisk: number; caught: number }
export const CALC_DEFAULTS: CalcIn = { invoices: PRICING.starter.invoicesIncluded, minutes: 10, hourly: 45, share: 50, atRisk: 0, caught: 50 };
export const CALC_FIELDS: readonly { key: keyof CalcIn; id: string; label: string; unit: string; max: number; step: number }[] = [
  { key: "invoices", id: "c-invoices", label: "Supplier invoices a month", unit: "", max: 100000, step: 10 },
  { key: "minutes", id: "c-minutes", label: "Minutes per invoice by hand today", unit: "min", max: 600, step: 1 },
  { key: "hourly", id: "c-hourly", label: "Cost of an hour of that work", unit: "€", max: 1000, step: 5 },
  { key: "share", id: "c-share", label: "Share the agents could handle", unit: "%", max: 100, step: 5 },
  { key: "atRisk", id: "c-risk", label: "Lost a year to duplicates, errors or fraud", unit: "€", max: 100000000, step: 100 },
  { key: "caught", id: "c-caught", label: "Of that, the share stopped before payment (your guess)", unit: "%", max: 100, step: 5 },
];
export interface CalcOut { hours: number; value: number; price: number; net: number; risk: number; year: number }
/**
 * The arithmetic, here for the page as built and in CALC_JS for the browser (test/business-page.test.ts runs both on
 * the same inputs). Prices from src/config/pricing.ts: Starter's monthly price, its included invoices, then each extra.
 * The fee per payout has no rate set, so it is left out (said under the result).
 */
export function calc(i: CalcIn): CalcOut {
  const n = (v: number, max: number) => (Number.isFinite(v) ? Math.min(Math.max(v, 0), max) : 0);
  const inv = n(i.invoices, 100000), min = n(i.minutes, 600), hr = n(i.hourly, 1000), share = n(i.share, 100), atRisk = n(i.atRisk, 100000000), caught = n(i.caught, 100);
  const hours = (inv * min * share) / 100 / 60, value = hours * hr;
  const { monthlyCents, invoicesIncluded, extraInvoiceCents } = PRICING.starter;
  const price = (monthlyCents + Math.max(0, Math.ceil(inv) - invoicesIncluded) * extraInvoiceCents) / 100;
  const net = value - price, risk = (atRisk * caught) / 100;
  return { hours, value, price, net, risk, year: net * 12 + risk };
}
/** A euro amount as the calculator shows it: whole euros, a minus sign for less than nothing. */
export const calcEuro = (x: number) => `${x < 0 ? "−" : ""}€${Math.round(Math.abs(x)).toLocaleString("en-US")}`;
export const calcHours = (x: number) => (Math.round(x * 10) / 10).toLocaleString("en-US");

/** The browser's copy of calc() and its formatting, with the prices passed in from the price list (never typed). */
export const CALC_JS = `(function () {
  var P = ${JSON.stringify({ m: PRICING.starter.monthlyCents, inc: PRICING.starter.invoicesIncluded, x: PRICING.starter.extraInvoiceCents })};
  function n(v, max) { return isFinite(v) ? Math.min(Math.max(v, 0), max) : 0; }
  function calc(i) {
    var inv = n(i.invoices, 100000), min = n(i.minutes, 600), hr = n(i.hourly, 1000), share = n(i.share, 100), atRisk = n(i.atRisk, 100000000), caught = n(i.caught, 100);
    var hours = (inv * min * share) / 100 / 60, value = hours * hr;
    var price = (P.m + Math.max(0, Math.ceil(inv) - P.inc) * P.x) / 100;
    var net = value - price, risk = (atRisk * caught) / 100;
    return { hours: hours, value: value, price: price, net: net, risk: risk, year: net * 12 + risk };
  }
  function eur(x) { return (x < 0 ? "\\u2212" : "") + "\\u20ac" + Math.round(Math.abs(x)).toLocaleString("en-US"); }
  function hrs(x) { return (Math.round(x * 10) / 10).toLocaleString("en-US"); }
  globalThis.__purserCalc = { calc: calc, eur: eur, hrs: hrs };
  var form = document.getElementById("calc");
  if (!form) return;
  var keys = ${JSON.stringify(CALC_FIELDS.map((f) => [f.key, f.id]))};
  function set(id, text) { var el = document.getElementById(id); if (el) el.textContent = text; }
  function bar(id, part, whole) { var el = document.getElementById(id); if (el) { el.style.width = (whole > 0 ? Math.max(2, Math.round(100 * part / whole)) : 0) + "%"; el.parentNode.parentNode.hidden = false; } }
  function update() {
    var i = {};
    keys.forEach(function (k) { var el = document.getElementById(k[1]); i[k[0]] = el ? parseFloat(el.value) : 0; });
    var o = calc(i);
    set("o-hours", hrs(o.hours)); set("o-value", eur(o.value)); set("o-price", eur(o.price)); set("o-net", eur(o.net)); set("o-risk", eur(o.risk)); set("o-year", eur(o.year));
    var top = Math.max(o.value, o.price);
    bar("b-value", o.value, top); bar("b-price", o.price, top);
  }
  form.addEventListener("input", update);
  form.addEventListener("submit", function (e) { e.preventDefault(); });
  update();
})();`;

/** /one-pager's button: the browser's own print dialog, where "Save as PDF" is. */
export const PRINT_JS = `(function () { var b = document.getElementById("print"); if (b) { b.hidden = false; b.addEventListener("click", function () { window.print(); }); } })();`;

export const BUSINESS_CSS = `.bz-hd { margin-top: 14px; } .bz-hd .eyebrow { margin-bottom: 4px; }
.bz-h { margin: 6px 0 0; font-size: clamp(22px, 2.6vw, 28px); font-weight: 760; letter-spacing: -.02em; line-height: 1.2; }
.bz-sub { margin: 0; color: var(--muted); font-size: 15px; line-height: 1.45; max-width: 46em; }
.bz-ctas { display: flex; flex-wrap: wrap; gap: 10px; }
.bz-ctas .btn { white-space: normal; height: auto; min-height: 48px; padding: 10px 20px; line-height: 1.25; }
.bz-ctas .btn .i { flex: none; }
/* Today's options. */
.bz-opt { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; grid-template-columns: minmax(0, 1fr); }
@media (min-width: 760px) { .bz-opt { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
.bz-opt li { display: grid; gap: 8px; align-content: start; padding: 18px; border-radius: 18px; border: 1.5px dashed var(--border); background: var(--surface); min-width: 0; }
.bz-opt li b { display: flex; align-items: center; gap: 10px; font-size: 17px; }
.bz-opt li p { margin: 0; font-size: 15.5px; line-height: 1.45; color: var(--muted); overflow-wrap: anywhere; }
.bz-opt li .i { color: var(--bad); flex: none; }
.bz-opt li.us { border: 1.5px solid transparent; background: linear-gradient(var(--surface), var(--surface)) padding-box, linear-gradient(135deg, var(--accent), var(--ok)) border-box; box-shadow: 0 18px 40px -28px rgba(79, 70, 229, .6); }
.bz-opt li.us p { color: var(--text); } .bz-opt li.us .i { color: var(--ok); }
/* Outcomes. */
.bz-out { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; grid-template-columns: repeat(auto-fit, minmax(min(100%, 220px), 1fr)); }
.bz-out li { display: grid; gap: 6px; align-content: start; padding: 16px; border-radius: 16px; background: var(--surface); border: 1px solid var(--border); min-width: 0; }
.bz-out .ic, .bz-who .ic, .bz-steps .ic { width: 40px; height: 40px; border-radius: 12px; display: grid; place-items: center; background: var(--accent-soft); color: var(--accent); flex: none; }
.bz-out b { font-size: 16px; line-height: 1.3; }
.bz-out p { margin: 0; font-size: 15px; line-height: 1.45; color: var(--muted); overflow-wrap: anywhere; }
/* The proof tiles (Home's, from the run records). */
.bz-proof { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; grid-template-columns: repeat(auto-fit, minmax(min(100%, 200px), 1fr)); }
.bz-proof a { display: grid; gap: 2px; padding: 12px 14px; border-radius: 14px; background: var(--sunken); color: inherit; text-decoration: none; min-height: 44px; min-width: 0; }
.bz-proof a:hover { outline: 2px solid var(--accent); }
.bz-proof .k { display: flex; align-items: center; gap: 6px; font-size: 14px; font-weight: 700; color: var(--accent); }
.bz-proof .v { font-size: 20px; font-weight: 760; letter-spacing: -.01em; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.bz-proof .t { font-size: 14px; line-height: 1.35; overflow-wrap: anywhere; }
.bz-proof .g { justify-self: start; font-size: 14px; font-weight: 650; color: var(--muted); background: var(--surface); border-radius: 999px; padding: 1px 8px; margin-top: 4px; }
/* Who it is for. */
.bz-who { display: grid; gap: 10px; grid-template-columns: minmax(0, 1fr); }
@media (min-width: 860px) { .bz-who { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
.bz-who article { display: grid; gap: 8px; align-content: start; padding: 18px; min-width: 0; }
.bz-who h3 { margin: 0; display: flex; align-items: center; gap: 10px; font-size: 17px; }
.bz-who p { margin: 0; font-size: 15px; line-height: 1.45; overflow-wrap: anywhere; }
.bz-who small { color: var(--muted); font-size: 14px; line-height: 1.4; }
/* The calculator. */
.bz-calc { display: grid; gap: 16px; padding: 20px; grid-template-columns: minmax(0, 1fr); min-width: 0; }
@media (min-width: 860px) { .bz-calc { grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr); } }
.bz-calc .note { grid-column: 1 / -1; margin: 0; font-size: 14.5px; line-height: 1.45; border-left: 4px solid var(--accent); padding: 2px 0 2px 10px; }
.bz-in { display: grid; gap: 10px; margin: 0; padding: 0; border: 0; min-width: 0; }
.bz-in legend { font-size: 14px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); padding: 0; margin-bottom: 4px; }
.bz-in label { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 6px 10px; align-items: center; font-size: 15px; line-height: 1.35; }
.bz-in .f { display: inline-flex; align-items: center; gap: 6px; }
.bz-in input { width: 7.5em; min-height: 44px; padding: 0 10px; border-radius: 10px; border: 1px solid var(--border); background: var(--bg); color: var(--text); font: 600 16px/1 Inter, system-ui, sans-serif; font-variant-numeric: tabular-nums; }
.bz-in .u { color: var(--muted); font-size: 14px; min-width: 2.2em; }
@media (max-width: 420px) { .bz-in label { grid-template-columns: minmax(0, 1fr); } }
.bz-res { display: grid; gap: 10px; align-content: start; padding: 16px; border-radius: 16px; background: var(--sunken); min-width: 0; }
.bz-res dl { margin: 0; display: grid; gap: 8px; }
.bz-res dl div { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 2px 12px; font-size: 15px; line-height: 1.35; }
.bz-res dd { margin: 0; font-weight: 720; font-variant-numeric: tabular-nums; }
.bz-res dl div.tot { border-top: 1px solid var(--border); padding-top: 8px; font-size: 17px; }
.bz-res dl div.tot dd { font-size: 22px; color: var(--accent); }
.bz-bars { display: grid; gap: 6px; }
.bz-bars div { display: grid; grid-template-columns: 7.5em minmax(0, 1fr); gap: 8px; align-items: center; font-size: 14px; color: var(--muted); }
.bz-bars span.b { height: 12px; border-radius: 6px; background: var(--surface); overflow: hidden; }
.bz-bars span.b i { display: block; height: 100%; width: 0; border-radius: 6px; background: var(--ok); transition: width .3s ease; }
.bz-bars span.b i.p { background: var(--accent); }
.bz-res small { color: var(--muted); font-size: 14px; line-height: 1.4; }
/* The pilot: four steps on a line, then the prices. */
.bz-pilot { display: grid; gap: 14px; padding: 20px; min-width: 0; }
ol.bz-steps { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; grid-template-columns: minmax(0, 1fr); counter-reset: st; }
@media (min-width: 860px) { ol.bz-steps { grid-template-columns: repeat(4, minmax(0, 1fr)); } }
ol.bz-steps li { position: relative; display: grid; gap: 6px; align-content: start; padding: 16px; border-radius: 16px; border: 1px solid var(--border); background: var(--surface); min-width: 0; }
ol.bz-steps li .ic { position: relative; }
ol.bz-steps li .ic em { position: absolute; right: -9px; top: -9px; width: 22px; height: 22px; border-radius: 50%; background: var(--text); color: var(--bg); font: 700 14px/22px Inter, system-ui, sans-serif; text-align: center; font-style: normal; }
ol.bz-steps b { font-size: 16px; } ol.bz-steps p { margin: 0; font-size: 14.5px; line-height: 1.45; color: var(--muted); overflow-wrap: anywhere; }
.bz-price { display: grid; gap: 8px; grid-template-columns: repeat(auto-fit, minmax(min(100%, 200px), 1fr)); }
.bz-price div { padding: 14px 16px; border-radius: 14px; background: var(--sunken); display: grid; gap: 2px; min-width: 0; }
.bz-price b { font-size: 14px; color: var(--muted); font-weight: 650; }
.bz-price span.v { font-size: 24px; font-weight: 780; letter-spacing: -.02em; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.bz-price span.v small { font-size: 14px; font-weight: 600; color: var(--muted); letter-spacing: 0; }
.bz-price small.d { font-size: 14px; color: var(--muted); }
/* The Founding Partner Pilot: its card beside the onboarding steps, then eligibility, scope and terms. */
.bz-ft { font-size: 17px; color: var(--text); }
.bz-fp { display: grid; gap: 12px; grid-template-columns: minmax(0, 1fr); }
@media (min-width: 960px) { .bz-fp { grid-template-columns: minmax(0, 1fr) minmax(0, 1.5fr); align-items: start; } .bz-fp ol.bz-steps { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
.bz-fpc { display: grid; gap: 10px; align-content: start; padding: 20px; border-radius: 18px; border: 1.5px solid transparent; background: linear-gradient(var(--surface), var(--surface)) padding-box, linear-gradient(135deg, var(--accent), var(--ok)) border-box; box-shadow: 0 18px 40px -28px rgba(79, 70, 229, .6); min-width: 0; }
.bz-fpc .pill { justify-self: start; }
.bz-fpc b.n { font-size: 18px; letter-spacing: -.01em; }
.bz-fpc .v { font-size: 34px; font-weight: 780; letter-spacing: -.03em; line-height: 1.05; }
.bz-fpc .v small { font-size: 15px; font-weight: 600; letter-spacing: 0; color: var(--muted); }
.bz-fpc .btn { justify-self: start; white-space: normal; height: auto; min-height: 48px; padding: 10px 20px; line-height: 1.25; }
.bz-terms { margin: 0; display: grid; gap: 10px; grid-template-columns: repeat(auto-fit, minmax(min(100%, 240px), 1fr)); }
.bz-terms div { padding: 14px 16px; border-radius: 14px; background: var(--sunken); min-width: 0; }
.bz-terms dt { font-size: 14px; font-weight: 750; letter-spacing: .05em; text-transform: uppercase; color: var(--accent); margin-bottom: 4px; }
.bz-terms dd { margin: 0; font-size: 15px; line-height: 1.45; overflow-wrap: anywhere; }
/* Questions. */
.bz-faq { display: grid; gap: 8px; }
.bz-faq details { border: 1px solid var(--border); border-radius: 14px; background: var(--surface); padding: 0 16px; }
.bz-faq summary { cursor: pointer; list-style: none; display: flex; align-items: center; justify-content: space-between; gap: 10px; min-height: 52px; font-weight: 680; font-size: 16px; line-height: 1.35; }
.bz-faq summary::-webkit-details-marker { display: none; }
.bz-faq summary::after { content: "+"; font-size: 20px; color: var(--accent); flex: none; } .bz-faq details[open] summary::after { content: "−"; }
.bz-faq details p { margin: 0 0 8px; font-size: 15.5px; line-height: 1.5; overflow-wrap: anywhere; }
.bz-faq .links { padding-bottom: 12px; }`;

const sectionHead = (id: string, eyebrow: string, title: string) => `<div class="bz-hd"><p class="eyebrow">${esc(eyebrow)}</p><h2 class="bz-h" id="${id}">${esc(title)}</h2></div>`;

/** Home's proof tiles (every value from a run record), as compact chips; links made relative to the page. */
export function proofChips(tiles: ProofTile[] = proofTiles()): string {
  if (!tiles.length) return "";
  return `<ul class="bz-proof">${tiles.map((t) => `<li${t.rec ? ` data-rec="${esc(t.rec)}"` : ""}><a href="${esc(t.href)}"${t.external ? ' target="_blank" rel="noopener"' : ""}><span class="k">${icon(t.icon, 14)}${esc(t.key)}</span><span class="v">${esc(t.value)}</span><span class="t">${esc(t.text)}</span><span class="g">${esc(t.tag)}</span></a></li>`).join("")}</ul>`;
}

export function priceHtml(): string {
  const { starter, business, platformFee } = PRICING;
  return `<div class="bz-price" data-rec="src/config/pricing.ts">
  <div><b>${esc(starter.name)}</b><span class="v">${esc(euro(starter.monthlyCents))} <small>a month</small></span><small class="d">${esc(`${starter.invoicesIncluded} invoices, then ${euro(starter.extraInvoiceCents)} each`)}</small></div>
  <div><b>${esc(business.name)}</b><span class="v"><small>from</small> ${esc(euro(business.fromMonthlyCents))} <small>a month</small></span><small class="d">${esc(business.includes.map((x, i) => (i ? x.toLowerCase() : x)).join(", "))}</small></div>
  <div><b>${esc(platformFee.name)}</b><span class="v"><small>a small fee per payout</small></span><small class="d">${esc("Collected through Airwallex with each payout")}</small></div>
</div>`;
}

export function calcHtml(i: CalcIn = CALC_DEFAULTS): string {
  const o = calc(i);
  const field = (f: (typeof CALC_FIELDS)[number]) => `<label for="${f.id}"><span>${esc(f.label)}</span><span class="f"><input id="${f.id}" name="${f.key}" type="number" inputmode="decimal" min="0" max="${f.max}" step="${f.step}" value="${i[f.key]}"><span class="u">${esc(f.unit)}</span></span></label>`;
  const row = (id: string, label: string, value: string, cls = "") => `<div${cls ? ` class="${cls}"` : ""}><dt>${esc(label)}</dt><dd id="${id}">${esc(value)}</dd></div>`;
  return `<form class="card bz-calc" id="calc" aria-labelledby="h-calc" novalidate>
  <p class="note">${esc(CALC_NOTE)}</p>
  <fieldset class="bz-in"><legend>${esc("Your numbers (example inputs; replace them)")}</legend>${CALC_FIELDS.map(field).join("")}</fieldset>
  <div class="bz-res" aria-live="polite"><dl>
    ${row("o-hours", "Hours back a month", calcHours(o.hours))}
    ${row("o-value", "Value of that time a month", calcEuro(o.value))}
    ${row("o-price", `${PRICING.starter.name} plan for that volume`, calcEuro(o.price))}
    ${row("o-net", "Difference a month", calcEuro(o.net))}
    ${row("o-risk", "Losses stopped a year (your guess)", calcEuro(o.risk))}
    ${row("o-year", "Your estimate for a year", calcEuro(o.year), "tot")}
  </dl>
  <div class="bz-bars" aria-hidden="true"><div hidden><span>${esc("Time back")}</span><span class="b"><i id="b-value"></i></span></div><div hidden><span>${esc("Plan price")}</span><span class="b"><i class="p" id="b-price"></i></span></div></div>
  <small>${esc("Without the fee per payout, which has no rate set.")}</small></div>
  ${foldHtml("How it is worked out", [
    esc("Hours back = invoices × minutes × share ÷ 60."),
    esc(`${PRICING.starter.name} = ${euro(PRICING.starter.monthlyCents)} a month for up to ${PRICING.starter.invoicesIncluded} invoices, then ${euro(PRICING.starter.extraInvoiceCents)} each.`),
    esc("A year = (value of the time − price) × 12 + losses × your share."),
  ])}
</form>`;
}

export function businessPage(): string {
  const options = `<ul class="bz-opt">${OPTIONS.map((o) => `<li class="${o.us ? "us" : ""}" id="opt-${o.id}"><b>${icon(o.icon, 20)}${esc(o.title)}</b><p>${esc(o.line)}</p></li>`).join("")}</ul>`;
  const outcomes = `<ul class="bz-out">${OUTCOMES.map((o) => `<li><span class="ic">${icon(o.icon, 20)}</span><b>${esc(o.title)}</b><p>${esc(o.line)}</p><div class="links">${siteLink(o.href, o.label)}</div></li>`).join("")}</ul>`;
  const who = `<div class="bz-who">
  <article class="card" id="ideal"><h3><span class="ic">${icon("building-2", 20)}</span>${esc("Built for")}</h3><p>${esc("EU companies of 20 to 200 people, already on Airwallex, paying suppliers and software in several currencies, with a CFO, a fractional CFO or an accountant.")}</p><small>${esc("Our first target: a hypothesis, not a finding.")}</small></article>
  <article class="card" id="firms"><h3><span class="ic">${icon("users", 20)}</span>${esc("For accounting firms")}</h3><p>${esc("The accountant's role reads the books, invoices and audit trail; it cannot approve or pay. Books filed in Moneybird; Xero, QuickBooks Online and Exact Online exports.")}</p><small>${esc("Moneybird in its sandbox; the exports are files, not live links.")}</small></article>
  <article class="card" id="on-airwallex"><h3><span class="ic">${icon("landmark", 20)}</span>${esc("Built on Airwallex")}</h3><p>${esc("Money stays in the company's own Airwallex account; Purser is never in the flow of funds. Its fee rides on the payout.")}</p><small>${esc("Run in Airwallex's sandbox. No partnership or endorsement claimed.")}</small></article>
</div>`;
  const steps = `<ol class="bz-steps">${PILOT_STEPS.map((s, i) => `<li><span class="ic">${icon(s.icon, 20)}<em>${i + 1}</em></span><b>${esc(s.title)}</b><p>${esc(s.line)}</p></li>`).join("")}</ol>`;
  const pilot = `<section class="card bz-pilot" aria-labelledby="pilot">
  <div class="bz-fp">
    <div class="bz-fpc" id="founding"><span class="pill run">${esc("Early access · limited availability")}</span><b class="n">${esc(FOUNDING_NAME)}</b><span class="v">${esc("Free")} <small>${esc("for 30 days")}</small></span>
      <ul class="ticks">${FOUNDING_POINTS.map((l) => `<li>${icon("check", 16)}<span>${esc(l)}</span></li>`).join("")}</ul>
      <a class="btn primary" href="${esc(PILOT_MAIL)}">${icon("mail", 18)}${esc(FOUNDING_CTA)}</a></div>
    ${steps}
  </div>
  <dl class="bz-terms">${FOUNDING_TERMS.map((t) => `<div id="t-${t.id}"><dt>${esc(t.title)}</dt><dd>${esc(t.line)}</dd></div>`).join("")}</dl>
  <div class="links">${outLink(repoHref(GO_LIVE_DOC), "The go-live requirements")}</div>
</section>`;
  const plans = `<section class="card bz-pilot" aria-labelledby="pricing">
  ${priceHtml()}
  <p class="bz-sub">${esc(`${PRICING_LEAD} Not yet validated with customers.`)}</p>
  <div class="bz-ctas"><a class="btn" href="${esc(TRY_URL)}">${icon("zap", 18)}${esc(`Try it first (${TRY_TAG.split(" · ")[0]})`)}</a><a class="btn" href="${ONE_PAGER_PATH}">${icon("file-text", 18)}${esc("The one-pager")}</a></div>
</section>`;
  const faq = `<div class="bz-faq">${faqs().map((f) => `<details id="faq-${f.id}"><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p><div class="links">${f.links.map(([h, l]) => siteLink(h, l)).join("")}</div></details>`).join("")}</div>`;
  const body = `${sectionHead("today", "The problem", "Today it is no agents, or blind trust.")}
  ${options}
  ${sectionHead("outcome", "What changes", "Agents do the routine. You keep the say.")}
  ${outcomes}
  ${proofChips()}
  ${sectionHead("who", "Who it is for", "Finance teams on Airwallex, and their accountants.")}
  ${who}
  ${sectionHead("h-calc", "Calculator", "What could it save you?")}
  ${calcHtml()}
  ${sectionHead("pilot", "Founding Partner Pilot", FOUNDING_CTA)}
  <p class="bz-sub bz-ft">${esc(FOUNDING_TEXT)}</p>
  ${pilot}
  ${sectionHead("pricing", "Plans", "After the pilot, if you choose.")}
  ${plans}
  ${sectionHead("faq", "Questions", "What a buyer asks first.")}
  ${faq}`;
  return productPage({
    key: "business", title: "For companies", h1: BUSINESS_H1, label: BUSINESS_LABEL, lead: BUSINESS_LEAD, body, css: BUSINESS_CSS, js: CALC_JS,
    description: "Purser for companies: let AI agents pay suppliers and buy software while the CFO approves the exact terms with Face ID. Who it is for, a calculator for your own numbers, the pilot and its pilot prices, and a buyer's questions answered.",
    source: "Source: src/config/pricing.ts (pilot prices), the run records behind the proof tiles, cloud/wrangler.jsonc (where data lives), docs/cloud.md (how a pilot company starts) and docs/airwallex-platform.md.",
    real: [
      "Test money only: sandboxes and testnet. No customers, pilots or revenue yet.",
      CALC_NOTE,
      "The first target customer and the accounting-firm channel are hypotheses. Built on Airwallex; no partnership or endorsement is claimed.",
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
      <section><h2>${esc("Who it is for")}</h2><p>${esc("EU companies of 20 to 200 people already on Airwallex, paying suppliers and software in several currencies, with a CFO, a fractional CFO or an accountant (our first target, a hypothesis). Accounting firms: an accountant reads each client's books and cannot pay.")}</p></section>
      <section><h2>${esc("Your data and your bank")}</h2><p>${esc(faqs().find((f) => f.id === "data")!.a)} ${esc("Your money stays in your own Airwallex account; Purser is never in the flow of funds.")}</p></section>
    </div>
    <section><h2>${esc(`${FOUNDING_CTA}: the ${FOUNDING_NAME}`)}</h2><p>${esc(`${FOUNDING_TEXT} Free for 30 days, limited availability, for selected businesses. ${FOUNDING_POINTS.join(" ")} At the end you choose whether to move to a paid plan; nothing is billed.`)}</p><ol class="s">${PILOT_STEPS.map((s) => `<li><b>${esc(s.title)}</b><br>${esc(s.line)}</li>`).join("")}</ol></section>
    <section><h2>${esc("Plans after the pilot")}</h2>${priceHtml()}<small class="n">${esc(`${PRICING_LEAD} Not yet validated with customers.`)}</small></section>
    <footer class="sf"><span>${esc(`${FOUNDING_CTA}:`)} <a href="${esc(PILOT_MAIL)}">${esc(CONTACT_EMAIL)}</a></span><span>${esc("Try it:")} <a href="${esc(`${SITE_URL}${TRY_URL}`)}">${esc(`${host}${TRY_URL}`)}</a></span><span>${esc("Set up:")} <a href="${esc(CLOUD_SETUP_URL)}" target="_blank" rel="noopener">${esc("Purser Cloud")}</a></span></footer>
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
