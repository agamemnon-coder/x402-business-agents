// Recording mode for the Demo Day walkthrough (docs/finals/demo-recording.md): /try?present=1. A flag only. The page is
// the normal /try (cloud/src/tryPage.ts) with this style and one more script; every step is the real one, on Purser's
// engine, with test money on a simulated bank. Nothing here calls the API, fakes an answer or skips a step.
//
// What it adds, for a 1920×1080 screen recording with a camera bubble in the bottom-right corner:
// - A frame: larger type (the page's column zoomed), high contrast, the column at the left, a lane at the right for the
//   presenter's mirrored phone, and the bottom-right 340×340 px kept clear for the camera bubble.
// - An opener card (5 s, or →): Before and After, in one screen.
// - The phone lane: on the approval and pay steps, a framed place where the mirrored phone sits, with a caption. On a
//   desktop the passkey can be the phone's (the browser shows a QR code for it); the lane is where the audience sees it.
// - The outcome card at the end: the run's own numbers, read from the API's answers to this page in this browser (the
//   page's own requests, read, never changed): the time from the start to paid, the steps the engine recorded and how
//   many were Claude's, the amount paid, and whether a changed term was refused (and by which layers). Each figure is
//   what came back, or "not in this run".
// - The app shell (sidebar, sections, Claude's usage); ?shell=0 turns it off, and in it &neg=1 keeps the negotiation.
// - ?phone=0: no phone lane, for a laptop that signs with its own passkey (Windows Hello); R keeps it.
// - Keys for the presenter: → the step's main button (the same click a person makes), R start again (a new test
//   company), O the outcome card, Escape closes a card.
// Every value from an answer is put on the page as text (textContent), never as HTML.

import { INVOICE, PAY } from "../tryCopy.js";
import { AIRWALLEX_LOGO_DATA_URL } from "../awxLogo.gen.js";
import { LOGO_FILES } from "./logos.gen.js";
import { SYSTEM_MAP_DATA_URL } from "./systemMap.gen.js";

const NEG_HINT = INVOICE.hints.clean ?? "";

export const PRESENT_BEFORE = "An agent's invoice lands in a queue. An approve button anyone can click pays it, whatever was changed on the way.";
export const PRESENT_AFTER = "The CFO signs the exact terms with Face ID. Change one cent and the signature is refused: nothing moves.";
export const PRESENT_TRY = "kit11.max-31b.workers.dev/try";
export const PRESENT_MONEY = "Sandbox mode · test money · Airwallex sandbox";
export const PRESENT_LANE = "The CFO's phone, mirrored: Face ID signs the exact terms";
/**
 * The app shell (15 Nov, Max: "it needs to look like the actual product"): in recording mode, the site's menu and the
 * step bar give way to a product's own frame: a sidebar with the workspace, the sections (the current one lit by the
 * screen shown) and Claude's usage in this run, call by call (model, time, cost, Anthropic's request id), read from the
 * engine's own events. ?shell=0 turns it off.
 */
/** "How Purser works": plain words, for someone who has never seen a payment system (Max, 15 Nov). */
export const PRESENT_HOW = {
  eyebrow: "How Purser works",
  heading: "AI agents pay the invoices. You approve the exceptions with Face ID.",
  tabFlow: "One payment", tabMap: "The whole system", tabProof: "Partner proof", close: "Close",
  steps: [
    { h: "An invoice comes in", p: "A supplier sends it, by email or as an upload." },
    { h: "AI agents read and check it", p: "Claude reads it. The agents check the supplier, the bank account and whether it was paid before.", logo: "claude" },
    { h: "Your rules decide", p: "Below your limit, an agent pays it on its own. Above it, the agent asks you." },
    { h: "You approve with Face ID", p: "You sign the exact amount, supplier and bank account, with Face ID, Touch ID or Windows Hello." },
    { h: "The money is sent", p: "Through Airwallex, then booked and filed for you.", logo: "airwallex" },
  ],
  cut: { h: "Changed by one cent after you approved?", p: "Refused. Your approval no longer matches, so nothing is sent." },
  mapAlt: "The whole Purser system: who uses it, the screens, the Claude agents, the rules in code, the money rails (Airwallex sandbox, Alta testnet) and the proof anyone can check.",
  built: "Built with",
  foot: "Test money only · Airwallex sandbox · Alta testnet · no endorsement implied",
} as const;

/**
 * The v2 preview (/try?v=2, and recording mode): the same screens and engine, the product's words (Max, 15 Nov). Merged
 * over the page's copy key by key (tryPage's over), so plain /try keeps the release's words and its negotiation.
 */
export const V2_COPY = {
  start: {
    eyebrow: "Live demo · about 2 minutes",
    heading: "AI agents prepare the transfer. Your Face ID releases the funds.",
    text: "AI agents read and check every supplier invoice within your limits. Above the limit, nothing moves until you approve the exact payment with Face ID. Change one cent afterwards and it is blocked.",
    flow: [
      { name: "The AI agent prepares", line: "Claude reads the invoice and proposes the payment." },
      { name: "Your rules check it", line: "Above the agent's limit, it waits for you." },
      { name: "You release it", line: "Face ID on the exact amount, supplier and account." },
    ],
    flowEnd: "Changed by one cent: blocked",
    button: "Launch the live transfer demo",
    fine: "The real product · test money · Airwallex sandbox · deleted after 24 hours",
  },
  approve: {
    heading: "Approve the transfer.",
    sheet: "Locked payment terms",
    limit: "Above the agent's limit, so it waits for the CFO. In this demo the limit is EUR 0; below a CFO's limit, agents pay on their own.",
    signs: "Your approval locks exactly these terms.",
    approve: "Approve & sign {amount} with {method}",
  },
  books: { heading: "Transfer executed." },
  work: { heading: "The AI agent prepares the transfer." },
  company: { heading: "Your run, start to finish." },
  pay: {
    heading: "Test the lock.",
    line: "This is the payment you approved, with one cent added. Press Pay and watch what happens.",
  },
} as const;

/** The partners' proof, each from a run record, each a link to it (Metal and Visa awards; test networks only). */
export const PRESENT_PARTNERS = {
  heading: "Live on real payment rails",
  sub: "Three refusals and one fingerprint, each from a recorded run you can open. Test networks and sandboxes only.",
  cards: [
    { logo: "alta", label: "Alta (formerly Metal) · testnet", h: "Refused on chain", p: "An agent tried to spend over its mandate. Alta refused purchase #24 on chain and recorded why: over the per-payment cap.", link: "See the transaction", href: "https://testnet.metalntwx.com/tx/0x2e92f9cb4549246f58b9b888881c258bf117c6233c1d8f126f4833ae6ae41871" },
    { logo: "airwallex", label: "Airwallex · sandbox", h: "The approval travels with the money", p: "A EUR 240.00 SWIFT payment: Airwallex's own record carries the fingerprint the CFO signed with Face ID, 797d4483…", link: "See it on /airwallex", href: "https://kit11.max-31b.workers.dev/airwallex" },
    { logo: "", label: "Visa Intelligent Commerce · via Airwallex Airi", h: "A reused card credential, blocked", p: "The sandbox accepted the same agent credential a second time and for another amount. Purser refused both before any payment.", link: "See it on /visa", href: "https://kit11.max-31b.workers.dev/visa" },
  ],
  all: "View live partner proof & architecture",
  allHref: "https://kit11.max-31b.workers.dev/proof",
  foot: "No endorsement implied.",
} as const;

/** The four stages on top of the workspace (v2). */
export const PRESENT_STAGES = ["The AI agent prepares", "The CFO approves", "The transfer", "The tamper test"] as const;

export const PRESENT_SHELL = {
  workspace: "Your test company",
  tag: "Test money · sandbox",
  nav: ["Inbox", "Approvals", "Payments", "Books", "Agents"],
  usage: "Claude · this run",
  none: "No Claude call yet",
  calls: "calls",
  user: "CFO",
  userSub: "Signs with a passkey",
  reader: "Reader",
  how: "How it works",
} as const;
/** The figures of the outcome card, by name; each is filled from an answer or says NOT_IN_RUN. */
export const PRESENT_OUTCOME = {
  heading: "What just happened",
  time: "From start to paid",
  steps: "Steps the engine recorded",
  claude: "of them by Claude (it reads the invoices when the switch is on)",
  paid: "Paid on the simulated bank",
  refused: "One cent changed after signing",
  refusedYes: "Refused by both layers: the signature and the payment check. Nothing moved.",
  refusedPart: "Refused. Nothing moved.",
  measured: "Measured in this browser, from this run's own answers.",
  try: "Try it yourself:",
  notInRun: "not in this run",
} as const;

const CSS = `
/* Recording mode (cloud/src/try/presentMode.ts). */
:root { --present-cam: 340px; }
body.present { font-size: 18px; }
@media (min-width: 1200px) {
  body.present main { zoom: 1.22; max-width: 600px; margin: 0 0 0 max(48px, calc(50vw - 820px)); }
  body.present:has(.screen.start) main { zoom: 1.1; }
  body.present .trust { zoom: 1.2; }
  body.present #main h1 { letter-spacing: -.02em; }
  /* Paid, booked, filed: two columns, so the step fits 1080p without a scroll. */
  body.present:has(.screen.books) main { max-width: 1160px; }
  body.present .screen.books { display: grid; grid-template-columns: 1fr 1fr; column-gap: 22px; align-items: start; }
  /* The stamp, then the slot of the Airwallex sandbox transfer (empty unless awx_payout made one), then paid, booked,
     filed and the way on: placed by what they are, so the slot never moves the others (14 Nov). */
  /* Each block placed by what it is (15 Nov: the visual strip, prepended, had moved every child one place on): the stamp
     and the strip on top, the ledger's lines in the right column, the rest down the left. */
  body.present .screen.books > * { grid-column: 1; }
  body.present .screen.books > .paidstamp { grid-row: 1; }
  body.present .screen.books > .vflow { grid-column: 2; grid-row: 1; align-self: center; margin: 0; }
  body.present .screen.books > .slot:has(.booked) { grid-column: 2; grid-row: 2 / span 5; }
  /* The transfer card, compact for 1080p: its heading, the transfer id and the status; the rest stays in normal mode. */
  body.present .slot.payout .awx { padding: 10px 14px; margin: 0; }
  body.present .slot.payout .awx dl > :nth-child(n+5), body.present .slot.payout .awx > p { display: none; }
  /* "Try to change it" (15 Nov), recorded: the amount and the payee only; the attacks are for visitors. */
  body.present .screen.pay .tryform > .two, body.present .screen.pay .attacks, body.present .screen.pay > p:has(> .link), body.present .screen.pay .why p:has(> .proofdl) { display: none; }
}
/* A card over the page: the page behind it does not scroll. */
html:has(.pv-card.on) { overflow: hidden; }
body.present { --muted: color-mix(in srgb, var(--text) 78%, var(--bg)); --faint: color-mix(in srgb, var(--text) 64%, var(--bg)); }
.pv-money { position: fixed; top: 76px; right: 24px; z-index: 30; display: inline-flex; align-items: center; gap: 8px; padding: 7px 14px; border-radius: 999px; background: var(--ok-soft); color: var(--ok); font: 650 15px/1.2 Inter, system-ui, sans-serif; }
.pv-money::before { content: ""; width: 8px; height: 8px; border-radius: 50%; background: var(--ok); }
.pv-lane { position: fixed; z-index: 20; top: 130px; right: calc(var(--present-cam) + 40px); width: 360px; display: none; flex-direction: column; align-items: center; gap: 14px; }
body.present:has(.screen.approve) .pv-lane, body.present:has(.screen.pay) .pv-lane { display: flex; }
.pv-phone { width: 300px; height: 620px; border-radius: 46px; border: 3px solid var(--border); background: var(--sunken); box-shadow: var(--shadow); display: grid; place-items: center; padding: 18px; position: relative; }
.pv-phone::before { content: ""; position: absolute; top: 14px; left: 50%; width: 90px; height: 24px; margin-left: -45px; border-radius: 99px; background: var(--border); }
.pv-phone span { color: var(--faint); font: 500 16px/1.4 Inter, system-ui, sans-serif; text-align: center; }
.pv-lane p { margin: 0; text-align: center; font: 600 18px/1.35 Inter, system-ui, sans-serif; color: var(--text); max-width: 340px; }
.pv-card { position: fixed; inset: 0; z-index: 60; display: none; place-items: center; background: var(--bg); padding: 48px calc(var(--present-cam) + 48px) 48px 96px; }
.pv-card.on { display: grid; }
.pv-card .in { width: 100%; max-width: 1240px; }
.pv-card h2 { margin: 0 0 28px; font: 780 56px/1.05 Inter, system-ui, sans-serif; letter-spacing: -.03em; color: var(--text); }
.pv-ba { display: grid; grid-template-columns: 1fr 1fr; gap: 28px; }
.pv-ba div { border-radius: 26px; padding: 34px 34px 38px; border: 1px solid var(--border); background: var(--surface); }
.pv-ba b { display: block; font: 700 22px/1.2 Inter, system-ui, sans-serif; text-transform: uppercase; letter-spacing: .08em; margin-bottom: 14px; }
.pv-ba .before b { color: var(--bad); }
.pv-ba .after { border-color: color-mix(in srgb, var(--ok) 50%, var(--border)); }
.pv-ba .after b { color: var(--ok); }
.pv-ba p { margin: 0; font: 600 34px/1.25 Inter, system-ui, sans-serif; color: var(--text); letter-spacing: -.01em; }
.pv-sub { margin: 26px 0 0; color: var(--muted); font: 500 22px/1.4 Inter, system-ui, sans-serif; }
.pv-figs { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(2, 1fr); gap: 20px; }
.pv-figs li { border-radius: 22px; padding: 24px 28px; background: var(--surface); border: 1px solid var(--border); min-width: 0; }
.pv-figs b { display: block; font: 760 54px/1.05 Inter, system-ui, sans-serif; letter-spacing: -.02em; color: var(--text); font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.pv-figs b.word { font-size: 28px; line-height: 1.25; letter-spacing: 0; }
.pv-figs b.none { color: var(--faint); font-size: 28px; }
.pv-figs span { display: block; margin-top: 8px; color: var(--muted); font: 500 20px/1.3 Inter, system-ui, sans-serif; }
.pv-figs li.ok b { color: var(--ok); }
.pv-try { margin: 28px 0 0; font: 700 34px/1.2 Inter, system-ui, sans-serif; color: var(--text); }
.pv-try span { color: var(--accent); }
.pv-card .pv-money { position: static; margin-bottom: 26px; }
.pv-card .pv-go { margin-top: 26px; color: var(--faint); font: 500 16px/1.2 Inter, system-ui, sans-serif; }
@media (max-width: 1199px) { .pv-lane { display: none !important; } .pv-card { padding: 24px 16px; } .pv-ba, .pv-figs { grid-template-columns: 1fr; } .pv-ba p { font-size: 22px; } .pv-card h2 { font-size: 32px; } .pv-figs b { font-size: 36px; } .pv-try { font-size: 22px; } .pv-money { top: auto; bottom: 12px; right: 12px; } }
@media (prefers-reduced-motion: no-preference) { .pv-card.on .in { animation: pvin .5s ease-out; } }
@keyframes pvin { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
/* The app shell (?shell=0 turns it off): the site's menu and step bar give way to a product frame. */
@media (min-width: 1200px) {
  body.pv-shell { padding-left: 276px; }
  body.pv-shell header.top, body.pv-shell .progw { display: none !important; }
  body.present.pv-shell .pv-money { top: 22px; }
  body.pv-shell .acts.pdfl { display: flex !important; }
  body.pv-shell .acts.pdfl .btn:not(.proofdl) { display: none; }
}
.pv-side { display: none; }
/* Blocked: the moment of the demo, in full view (Max, 15 Nov): red frame, a big headline, the money that moved. */
.card.refusal { border: 2px solid var(--bad); background: color-mix(in srgb, var(--bad) 8%, var(--surface)); }
.card.refusal > .head { font-size: 30px; line-height: 1.15; font-weight: 780; letter-spacing: -.01em; }
.card.refusal > .head .no { color: var(--bad); }
.card.refusal .diff { font-size: 19px; }
.card.refusal > .rule { font-weight: 650; color: var(--text); }
.card.refusal > .proof.xfer { font: 750 18px/1.3 Inter, system-ui, sans-serif; color: var(--text); }
body.pv-noneg .negcard { display: none !important; }
body.pv-noneg .payrow { justify-content: flex-start; gap: 16px; }
@media (min-width: 1200px) {
  body.pv-shell .pv-side { display: flex; position: fixed; z-index: 40; left: 0; top: 0; bottom: 0; width: 252px; flex-direction: column; gap: 18px; padding: 22px 16px; background: color-mix(in srgb, var(--bg) 82%, #000); border-right: 1px solid var(--border); font: 500 14px/1.35 Inter, system-ui, sans-serif; color: var(--text); }
}
.pv-side .brand { display: flex; align-items: center; gap: 10px; font-weight: 750; font-size: 19px; color: var(--text); text-decoration: none; }
.pv-side .brand .mk { display: inline-grid; place-items: center; width: 30px; height: 30px; border-radius: 8px; background: var(--text); color: var(--bg); }
.pv-ws { padding: 10px 12px; border: 1px solid var(--border); border-radius: 12px; }
.pv-ws b { display: block; font-weight: 650; }
.pv-ws span { display: inline-block; margin-top: 4px; font-size: 12px; font-weight: 650; color: var(--ok); }
.pv-nav { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; }
.pv-nav li { padding: 9px 12px; border-radius: 9px; color: var(--muted); font-weight: 600; }
body.pv-shell:has(.screen.invoice, .screen.work, .screen.start) .pv-nav li:nth-child(1),
body.pv-shell:has(.screen.approve) .pv-nav li:nth-child(2),
body.pv-shell:has(.screen.books, .screen.pay) .pv-nav li:nth-child(3),
body.pv-shell:has(.screen.company, .screen.did) .pv-nav li:nth-child(4) { background: color-mix(in srgb, var(--text) 10%, transparent); color: var(--text); }
.pv-use { margin-top: auto; padding: 12px; border: 1px solid var(--border); border-radius: 12px; }
.pv-use h3 { margin: 0 0 6px; font: 700 11px/1.2 Inter, system-ui, sans-serif; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); }
.pv-use .tot { font: 750 24px/1.15 Inter, system-ui, sans-serif; font-variant-numeric: tabular-nums; }
.pv-use .sub { color: var(--muted); font-size: 12px; margin-top: 2px; }
.pv-use ol { list-style: none; margin: 10px 0 0; padding: 0; display: grid; gap: 7px; }
.pv-use li { display: grid; grid-template-columns: 1fr auto; gap: 0 8px; font-size: 12.5px; }
.pv-use li b { font-weight: 650; }
.pv-use li .c { font-variant-numeric: tabular-nums; font-weight: 650; }
.pv-use li .m { grid-column: 1 / -1; color: var(--muted); font: 500 11px/1.3 ui-monospace, SFMono-Regular, Menlo, monospace; }
.pv-me { display: flex; align-items: center; gap: 10px; padding-top: 12px; border-top: 1px solid var(--border); }
.pv-me .av { display: grid; place-items: center; width: 32px; height: 32px; border-radius: 50%; background: var(--text); color: var(--bg); font: 750 12px/1 Inter, system-ui, sans-serif; }
.pv-me small { display: block; color: var(--muted); font-size: 12px; }


/* "How Purser works" (M in recording mode, the sidebar's button on the page). */
.pv-how { overflow: auto; }
.pv-how .in { max-width: 1400px; }
.hw-top { display: flex; align-items: center; gap: 18px; margin-bottom: 18px; }
.hw-eb { font: 750 15px/1.2 Inter, system-ui, sans-serif; letter-spacing: .12em; text-transform: uppercase; color: var(--accent); }
.hw-tabs { display: inline-flex; gap: 4px; padding: 4px; border-radius: 999px; background: var(--sunken); border: 1px solid var(--border); margin-left: auto; }
.hw-tab, .hw-x { appearance: none; border: 0; background: none; color: var(--muted); font: 650 14px/1 Inter, system-ui, sans-serif; padding: 9px 16px; border-radius: 999px; cursor: pointer; }
.hw-tab[aria-pressed="true"] { background: var(--surface); color: var(--text); box-shadow: 0 1px 2px #0003; }
.hw-x { border: 1px solid var(--border); }
.pv-how h2 { font-size: 44px; max-width: 1100px; margin-bottom: 30px; }
.hw-map { display: none; }
.pv-how.map .hw-one { display: none; }
.pv-how.map .hw-map { display: block; }
.pv-how.map h2 { display: none; }
.hw-map img { display: block; width: 100%; max-height: calc(100vh - 300px); object-fit: contain; border-radius: 18px; border: 1px solid var(--border); background: #0b1020; }
.hw-flow { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(5, 1fr); gap: 18px; position: relative; }
.hw-flow::before { content: ""; position: absolute; left: 4%; right: 4%; top: 31px; height: 3px; border-radius: 3px; background: linear-gradient(90deg, var(--accent), var(--ok)); transform-origin: left; opacity: .55; }
.hw-flow::after { content: ""; position: absolute; top: 26px; left: 4%; width: 13px; height: 13px; border-radius: 50%; background: #fff; box-shadow: 0 0 0 5px color-mix(in srgb, var(--accent) 40%, transparent), 0 0 24px var(--accent); }
.hw-flow li { position: relative; padding: 76px 22px 24px; border-radius: 22px; background: var(--surface); border: 1px solid var(--border); box-shadow: var(--shadow); min-width: 0; }
.hw-flow .n { position: absolute; top: 12px; left: 22px; display: grid; place-items: center; width: 40px; height: 40px; border-radius: 50%; background: var(--bg); border: 2px solid var(--accent); color: var(--text); font: 750 17px/1 Inter, system-ui, sans-serif; z-index: 1; }
.hw-flow li:nth-child(4) .n { border-color: var(--ok); }
.hw-flow li:nth-child(5) .n { border-color: var(--ok); background: var(--ok); color: #04130d; }
.hw-flow b { display: block; font: 750 21px/1.2 Inter, system-ui, sans-serif; letter-spacing: -.01em; color: var(--text); }
.hw-flow p { margin: 10px 0 0; color: var(--muted); font: 500 16px/1.45 Inter, system-ui, sans-serif; }
.hw-logo { display: inline-flex; align-items: center; height: 30px; padding: 0 10px; border-radius: 8px; background: #fff; }
.hw-logo img { display: block; height: 16px; width: auto; }
.hw-logo.hw-alta img { height: 18px; }
.hw-flow .hw-logo { margin-top: 14px; }
.hw-cut { margin: 22px 0 0 auto; width: calc(40% - 7px); padding: 18px 22px; border-radius: 18px; border: 1px solid color-mix(in srgb, var(--bad) 55%, var(--border)); background: color-mix(in srgb, var(--bad) 9%, var(--surface)); }
.hw-cut b { display: block; color: var(--bad); font: 750 19px/1.25 Inter, system-ui, sans-serif; }
.hw-cut p { margin: 6px 0 0; color: var(--text); font: 500 16px/1.4 Inter, system-ui, sans-serif; }
.hw-foot { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin-top: 28px; padding-top: 20px; border-top: 1px solid var(--border); }
.hw-built { font: 700 12px/1 Inter, system-ui, sans-serif; letter-spacing: .14em; text-transform: uppercase; color: var(--faint); margin-right: 4px; }
.hw-note { margin-left: auto; color: var(--faint); font: 500 13px/1.3 Inter, system-ui, sans-serif; }
@media (prefers-reduced-motion: no-preference) {
  .pv-how.on .hw-flow li { animation: hwin .55s cubic-bezier(.2,.8,.2,1) both; animation-delay: calc(var(--i) * .32s + .2s); }
  .pv-how.on .hw-flow::before { animation: hwline 1.8s ease-out both .2s; }
  .pv-how.on .hw-flow::after { animation: hwdot 3.2s cubic-bezier(.6,0,.4,1) infinite 2s; opacity: 0; }
  .pv-how.on .hw-cut { animation: hwin .5s ease-out both 2.1s, hwshake .45s ease-in-out 2.7s; }
}
@keyframes hwin { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
@keyframes hwline { from { transform: scaleX(0); } to { transform: scaleX(1); } }
@keyframes hwdot { 0% { left: 4%; opacity: 0; } 8% { opacity: 1; } 88% { opacity: 1; } 100% { left: calc(96% - 13px); opacity: 0; } }
@keyframes hwshake { 0%, 100% { transform: none; } 25% { transform: translateX(-6px); } 75% { transform: translateX(6px); } }
@media (max-width: 1199px) { .hw-flow { grid-template-columns: 1fr; } .hw-flow::before, .hw-flow::after { display: none; } .hw-cut { width: auto; } .pv-how h2 { font-size: 28px; } .hw-top { flex-wrap: wrap; } .hw-note { margin-left: 0; } }
.pv-howbtn { display: flex; align-items: center; gap: 10px; width: 100%; padding: 11px 12px; border-radius: 10px; border: 1px solid color-mix(in srgb, var(--accent) 45%, var(--border)); background: color-mix(in srgb, var(--accent) 12%, transparent); color: var(--text); font: 650 14px/1.2 Inter, system-ui, sans-serif; cursor: pointer; text-align: left; }
.pv-howbtn .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 0 4px color-mix(in srgb, var(--accent) 25%, transparent); }
.pv-howbtn:hover { background: color-mix(in srgb, var(--accent) 20%, transparent); }

/* v2 (/try?v=2 and recording mode): the four stages, the status tags, the partners' proof. */
.pv-stages { display: none; }
@media (min-width: 1200px) {
  body.pv-shell.pv-staged { padding-top: 64px; }
  body.pv-shell.pv-staged .pv-stages { display: flex; position: fixed; z-index: 35; top: 0; left: 252px; right: 0; height: 58px; align-items: center; gap: 6px; margin: 0; padding: 0 24px; list-style: none; background: color-mix(in srgb, var(--bg) 88%, #000); border-bottom: 1px solid var(--border); }
  body.present.pv-shell.pv-staged .pv-money { top: 12px; }
}
.pv-stages li { display: flex; align-items: center; gap: 9px; padding: 7px 14px 7px 8px; border-radius: 999px; color: var(--faint); font: 650 14px/1 Inter, system-ui, sans-serif; }
.pv-stages li + li::before { content: ""; width: 28px; height: 2px; margin-right: 6px; background: var(--border); border-radius: 2px; }
.pv-stages .n { display: grid; place-items: center; width: 24px; height: 24px; border-radius: 50%; border: 2px solid var(--border); font-size: 12px; }
.pv-stages li.cur { color: var(--text); background: color-mix(in srgb, var(--accent) 14%, transparent); }
.pv-stages li.cur .n { border-color: var(--accent); background: var(--accent); color: #fff; }
.pv-stages li.done { color: var(--muted); }
.pv-stages li.done .n { border-color: var(--ok); background: var(--ok); color: #04130d; }
.pv-tag { display: inline-flex; align-items: center; gap: 7px; width: fit-content; margin: 0 0 12px; padding: 5px 11px; border-radius: 999px; font: 700 12px/1.2 Inter, system-ui, sans-serif; letter-spacing: .04em; text-transform: uppercase; }
.pv-tag::before { content: ""; width: 7px; height: 7px; border-radius: 50%; background: currentColor; }
.pv-tag.amber { color: #f5b544; background: color-mix(in srgb, #f5b544 14%, transparent); }
.pv-tag.ok { color: var(--ok); background: var(--ok-soft); margin: 10px 0 0; }
.pv-tag.bad { color: var(--bad); background: color-mix(in srgb, var(--bad) 14%, transparent); font-size: 13px; }
.hashpill[data-v2] { font-family: Inter, system-ui, sans-serif; font-weight: 650; color: var(--ok); background: var(--ok-soft); }
.hashpill[data-v2]::before { content: "✓ "; }
.pp { margin-top: 28px; }
.pp h2 { margin: 0; font: 760 26px/1.2 Inter, system-ui, sans-serif; letter-spacing: -.01em; color: var(--text); }
.pp-sub { margin: 6px 0 16px; color: var(--muted); font: 500 15px/1.45 Inter, system-ui, sans-serif; }
.pp-cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
.pp-card { display: flex; flex-direction: column; gap: 8px; padding: 18px; border-radius: 18px; border: 1px solid var(--border); background: var(--surface); min-width: 0; }
.pp-top { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.pp-l { color: var(--faint); font: 600 12px/1.3 Inter, system-ui, sans-serif; }
.pp-visa { display: inline-flex; align-items: center; height: 30px; padding: 0 12px; border-radius: 8px; border: 1px solid var(--border); color: var(--text); font: 700 15px/1 Inter, system-ui, sans-serif; } /* Visa named in text, never a drawn mark */
.pp-card b { font: 750 18px/1.25 Inter, system-ui, sans-serif; color: var(--text); }
.pp-card p { margin: 0; color: var(--muted); font: 500 14.5px/1.5 Inter, system-ui, sans-serif; flex: 1; }
.pp-a { color: var(--accent); font: 650 14px/1.3 Inter, system-ui, sans-serif; text-decoration: none; }
.pp-a:hover { text-decoration: underline; }
.pp-foot { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; margin-top: 16px; }
.pp-note { color: var(--faint); font: 500 12.5px/1.3 Inter, system-ui, sans-serif; }
.hw-prf { display: none; }
.pv-how.prf .hw-one { display: none; }
.pv-how.prf .hw-prf { display: block; }
.pv-how.prf h2 { display: none; }
.pv-how .pp { margin-top: 0; }
.pv-how .pp-card b { font-size: 21px; }
.pv-how .pp-card p { font-size: 16px; }
@media (max-width: 899px) { .pp-cards { grid-template-columns: 1fr; } }

/* v2 polish (round 2): one step bar, the pill in it, the refusal framed in red, the partners across the page. */
@media (min-width: 1200px) {
  body.pv-shell:not(.pv-staged):not(.present) > .pv-money { display: none; }
  body.pv-shell.pv-staged > .pv-money { top: 12px; right: 20px; }
  body.pv-shell.pv-staged #main .vflow { display: none !important; }
}
body.pv-shell .band .same { display: none; }
.card.refusal { border: 2px solid var(--bad) !important; background: color-mix(in srgb, var(--bad) 8%, var(--bg)) !important; box-shadow: 0 0 0 6px color-mix(in srgb, var(--bad) 10%, transparent), 0 24px 60px -30px color-mix(in srgb, var(--bad) 60%, transparent) !important; }
body.pv-shell .screen.start .pp { grid-column: 1 / -1; width: 100%; }
body.pv-shell .screen.start li.wide { display: none; }
.screen.books .blk.booked .v2fold > summary { cursor: pointer; color: var(--accent); font: 600 14px/1.3 Inter, system-ui, sans-serif; margin-top: 6px; }
.screen .card .pv-tag.amber { margin-bottom: 14px; }
`;

const SHARED = String.raw`
// --- Shared by recording mode and the public page: the app shell, Claude's usage per call, "How Purser works". ---
const mk=(tag,cls,kids)=>{const e=document.createElement(tag);if(cls)e.className=cls;for(const k of [].concat(kids==null?[]:kids))e.append(k instanceof Node?k:document.createTextNode(String(k)));return e};
const CALLS=new Map();
const usd=(m)=>'$'+(m/1e6).toFixed(4);
const title=(s)=>String(s||'').replace(/[^a-z0-9 _-]/gi,'').replace(/[_-]+/g,' ').replace(/\b\w/g,(c)=>c.toUpperCase());
const modelName=(m)=>{const x=/^claude-([a-z]+)-(\d+)-(\d+)/.exec(String(m||''));return x?title(x[1])+' '+x[2]+'.'+x[3]:''};
// One Claude call from the engine's own events (claude.read: the invoice reader; agent.run: an agent's run).
function takeCall(e,f){if((e.event==='claude.read'||e.event==='agent.run')&&!CALLS.has(e.seq)){const c=Number(f.cost_usd_micros);if(isFinite(c)&&c>=0)CALLS.set(e.seq,{who:e.event==='claude.read'?PC.shell.reader:title(f.agent),model:modelName(f.model),cost:c,ms:Number(f.latency_ms)||0,req:typeof f.request_id==='string'&&/^req_[A-Za-z0-9]{6,64}$/.test(f.request_id)?f.request_id:''})}}
const SHELL=new URLSearchParams(location.search).get('shell')!=='0';
const SH=PC.shell;let useBox=null;
// "How Purser works": the flow in five steps, and the whole system's map (the README's), as a card over the page.

// The partners' proof (Metal and Visa awards): three cards from recorded runs, each a link; and the way to all of it.
function partners(withHead){
  const P=PC.partners;const a=(href,text,cls)=>{const l=mk('a',cls||'',text);l.href=href;l.target='_blank';l.rel='noopener';return l};
  const cards=mk('div','pp-cards',P.cards.map((c)=>mk('article','pp-card',[mk('div','pp-top',[c.logo?logoChip(c.logo):mk('span','pp-visa','Visa'),mk('span','pp-l',c.label)]),mk('b','',c.h),mk('p','',c.p),a(c.href,c.link+' →','pp-a')])));
  const foot=mk('div','pp-foot',[a(P.allHref,P.all+' →','btn primary pp-all'),mk('span','pp-note',P.foot)]);
  return mk('section','pp',(withHead?[mk('h2','',P.heading),mk('p','pp-sub',P.sub)]:[]).concat([cards,foot]));
}
const H=PC.how;
const logoChip=(k)=>{const i=document.createElement('img');i.src=PC.logos[k].src;i.alt=PC.logos[k].alt;i.decoding='async';return mk('span','hw-logo hw-'+k,i)};
const how=mk('section','pv-card pv-how');how.setAttribute('role','dialog');how.setAttribute('aria-label',H.eyebrow);
{
  const flow=mk('ol','hw-flow',H.steps.map((st,i)=>{const li=mk('li','',[mk('span','n',String(i+1)),mk('b','',st.h),mk('p','',st.p)].concat(st.logo?[logoChip(st.logo)]:[]));li.style.setProperty('--i',String(i));return li}));
  const cut=mk('div','hw-cut',[mk('b','',H.cut.h),mk('p','',H.cut.p)]);
  const img=document.createElement('img');img.src=PC.map;img.alt=H.mapAlt;img.decoding='async';
  const tF=mk('button','hw-tab',H.tabFlow),tM=mk('button','hw-tab',H.tabMap),tP=mk('button','hw-tab',H.tabProof),x=mk('button','hw-x',H.close);
  for(const b of [tF,tM,tP,x])b.type='button';
  const setTab=(m)=>{how.classList.toggle('map',m==='map');how.classList.toggle('prf',m==='prf');tF.setAttribute('aria-pressed',String(m==='flow'));tM.setAttribute('aria-pressed',String(m==='map'));tP.setAttribute('aria-pressed',String(m==='prf'))};
  tF.addEventListener('click',()=>setTab('flow'));tM.addEventListener('click',()=>setTab('map'));tP.addEventListener('click',()=>setTab('prf'));x.addEventListener('click',()=>how.classList.remove('on'));
  setTab('flow');
  how.append(mk('div','in',[mk('div','hw-top',[mk('span','hw-eb',H.eyebrow),mk('div','hw-tabs',[tF,tM,tP]),x]),mk('h2','',H.heading),mk('div','hw-body',[mk('div','hw-one',[flow,cut]),mk('div','hw-map',img),mk('div','hw-prf',partners(false))]),
    mk('div','hw-foot',[mk('span','hw-built',H.built),logoChip('claude'),logoChip('airwallex'),logoChip('alta'),mk('span','hw-note',H.foot)])]));
  how.addEventListener('click',(e)=>{if(e.target===how)how.classList.remove('on')});
  document.body.append(how);
}
// The negotiation is left out of /try unless &neg=1 (Max, 15 Nov: until it is mastered): "Pay this invoice" becomes the step's main button (→ clicks it).
if(new URLSearchParams(location.search).get('neg')!=='1'){
  document.body.classList.add('pv-noneg');
  const promote=()=>{for(const b of document.querySelectorAll('#main .payrow > button.btn:not(.primary)'))b.classList.add('primary','big');for(const el of document.querySelectorAll('#main *'))if(el.childElementCount===0&&el.textContent===PC.negHint)el.textContent=PC.negHintShort};
  promote();new MutationObserver(promote).observe(document.body,{childList:true,subtree:true});
}

// v2: the test-money pill, the four stages on top, the partners' proof on the start screen and the way to it at the end.
if(!document.querySelector('body > .pv-money'))document.body.append(mk('div','pv-money',PC.money));
const stages=mk('ol','pv-stages',PC.stages.map((t,i)=>mk('li','',[mk('span','n',String(i+1)),t])));
document.body.append(stages);
function stageOf(){const m=document.getElementById('main');if(!m)return -1;const has=(c)=>!!m.querySelector('.screen.'+c);
  if(has('start'))return -1;if(has('invoice')||has('work'))return 0;if(has('approve'))return 1;if(has('books'))return 2;if(has('pay'))return m.querySelector('.refusal')?4:3;if(has('company')||has('did'))return 4;return -1}
function v2(){
  const k=stageOf();document.body.classList.toggle('pv-staged',k>=0);
  [...stages.children].forEach((li,i)=>{li.className=i<k?'done':i===k?'cur':''});
  const m=document.getElementById('main');if(!m)return;
  const st=m.querySelector('.screen.start');if(st&&!st.querySelector('.pp'))st.append(partners(true));
  for(const sc of m.querySelectorAll('.screen.company, .screen.did'))if(!sc.querySelector('.pp'))sc.append(partners(true));
  const ap=m.querySelector('.screen.approve .receipt.sheet');if(ap&&!ap.querySelector('.pv-tag'))ap.prepend(mk('span','pv-tag amber','Awaiting CFO approval'));
  const hp=m.querySelector('.screen.approve .hashpill');if(hp&&!hp.dataset.v2){hp.dataset.v2='1';hp.title=hp.textContent;hp.textContent='Verified digital fingerprint'}
  const ps=m.querySelector('.screen.books .paidstamp');if(ps&&!ps.querySelector('.pv-tag'))ps.append(mk('span','pv-tag ok','Signed & settled'));
  for(const h of m.querySelectorAll('.screen.books .paidstamp .hashpill'))if(!h.dataset.v2){h.dataset.v2='1';h.title=h.textContent;h.textContent='Verified digital fingerprint'}
  const pr=m.querySelector('.screen.work .payrow');if(pr){const card=pr.closest('.card')||pr.parentElement;if(card&&!card.querySelector('.pv-tag'))card.prepend(mk('span','pv-tag amber','Above the agent\'s limit · CFO approval required'))}
  if(!m.querySelector('.card.refusal'))for(const b of m.querySelectorAll('.screen.pay button.btn'))if(b.textContent.trim()===PC.payButton&&!b.classList.contains('primary'))b.classList.add('primary','big');
  if(!document.body.classList.contains('present')){const bk=m.querySelector('.screen.books .blk.booked');if(bk&&!bk.querySelector(':scope > details.v2fold')){const kids=[...bk.children].filter((c)=>!c.classList.contains('bh')&&!c.classList.contains('bal'));if(kids.length){const d=mk('details','v2fold',mk('summary','',PC.ledgerFold));d.append(...kids);bk.append(d)}}}
  const rf=m.querySelector('.card.refusal');if(rf&&!rf.querySelector('.pv-tag')){const x=rf.querySelector('.proof.xfer');const zero=x&&/:\s*0\b/.test(x.textContent);rf.prepend(mk('span','pv-tag bad',zero?'Payment blocked · EUR 0.00 moved':'Payment blocked'))}
}
let v2t=0;new MutationObserver(()=>{if(!v2t)v2t=requestAnimationFrame(()=>{v2t=0;v2()})}).observe(document.body,{childList:true,subtree:true});v2();
const showHow=()=>{how.classList.remove('on');void how.offsetWidth;how.classList.add('on')};
// The app shell, unless ?shell=0: a sidebar with the workspace, the sections and Claude's usage in this run.
if(SHELL){
  document.body.classList.add('pv-shell');
  const hb=document.querySelector('header.top .brand');const brand=hb?hb.cloneNode(true):mk('span','brand','Purser');
  useBox=mk('section','pv-use');
  const howBtn=mk('button','pv-howbtn',[mk('span','dot',''),SH.how]);howBtn.type='button';howBtn.addEventListener('click',showHow);
  document.body.append(mk('aside','pv-side',[brand,mk('div','pv-ws',[mk('b','',SH.workspace),mk('span','',SH.tag)]),mk('ul','pv-nav',SH.nav.map((n)=>mk('li','',n))),howBtn,useBox,mk('div','pv-me',[mk('span','av',SH.user),mk('span','',[SH.user,mk('small','',SH.userSub)])])]));
}
function drawUse(){
  if(!useBox)return;
  const calls=[...CALLS.values()];const tot=calls.reduce((a,c)=>a+c.cost,0);
  const rows=calls.slice(-5).reverse().map((c)=>mk('li','',[mk('b','',c.who+(c.model?' · '+c.model:'')),mk('span','c',usd(c.cost)),mk('span','m',[c.ms?(c.ms/1000).toFixed(1)+' s':'',c.ms&&c.req?' · ':'',c.req?c.req.slice(0,8)+'…'+c.req.slice(-5):''].join(''))]));
  useBox.replaceChildren(mk('h3','',SH.usage),mk('div','tot',calls.length?usd(tot):'$0.0000'),mk('div','sub',calls.length?calls.length+' '+SH.calls:SH.none),mk('ol','',rows));
}
drawUse();
`;

/**
 * The script: runs before the page's own (both are modules, in order), so it can read the page's API answers. It wraps
 * fetch to read a copy of each answer to /v1/try/start, /v1/engine/events and the pay route, and changes nothing.
 * PRESENT_CFG is filled in by presentExtra().
 */
const SCRIPT = String.raw`
const PC=__PRESENT_CFG__;
document.body.classList.add('present');
__SHARED__

// An event or jury token in the link (#e= or #j=, read by the page's own script): kept in this tab only, so R starts
// again in the same pool (retakes do not run into the public pool's per-address limit).
const POOLTAG=(()=>{const m=/^#([ej])=([A-Za-z0-9_.~-]{1,256})$/.exec(location.hash);try{if(m)sessionStorage.setItem('purser.present.pool',m[0]);return m?m[0]:sessionStorage.getItem('purser.present.pool')||''}catch(e){return m?m[0]:''}})();
// The run's own numbers, from the answers this page gets.
const RUN={startAt:null,paidAt:null,seqs:new Set(),claude:new Set(),paid:null,refused:null};
try{const o=JSON.parse(sessionStorage.getItem('purser.present')||'null');if(o&&typeof o==='object'){RUN.startAt=o.startAt??null;RUN.paidAt=o.paidAt??null;RUN.paid=o.paid??null;RUN.refused=o.refused??null;for(const s of o.seqs||[])RUN.seqs.add(s);for(const s of o.claude||[])RUN.claude.add(s)}}catch(e){}
const keep=()=>{try{sessionStorage.setItem('purser.present',JSON.stringify({startAt:RUN.startAt,paidAt:RUN.paidAt,paid:RUN.paid,refused:RUN.refused,seqs:[...RUN.seqs],claude:[...RUN.claude]}))}catch(e){}};
const AMT=/^\d{1,9}\.\d{2}$/,CUR=/^[A-Z]{3}$/;
const money=(a,c)=>{const [w,d]=a.split('.');return c+' '+w.replace(/\B(?=(\d{3})+$)/g,',')+'.'+d};
const real=window.fetch.bind(window);
window.fetch=async(input,init)=>{
  const res=await real(input,init);
  try{
    const url=new URL(typeof input==='string'?input:input.url,location.href);const p=url.pathname;
    if(res.ok&&(p==='/v1/try/start'||p==='/v1/engine/events'||/^\/v1\/engine\/proposals\/[^/]+\/pay$/.test(p))){
      const at=Date.now();
      res.clone().json().then((j)=>{
        if(!j||typeof j!=='object')return;
        if(p==='/v1/try/start'){RUN.startAt=at;RUN.paidAt=null;RUN.paid=null;RUN.refused=null;RUN.seqs.clear();RUN.claude.clear();CALLS.clear()}
        else if(p==='/v1/engine/events'){for(const e of Array.isArray(j.items)?j.items:[]){if(e&&typeof e.seq==='number'){RUN.seqs.add(e.seq);const f=e.fields&&typeof e.fields==='object'?e.fields:{};if(e.event==='claude.read'||(/^ap\.(checker_decided|coded|payer_proposed)$/.test(String(e.event))&&f.source==='claude'))RUN.claude.add(e.seq);takeCall(e,f);}}}
        else{
          let sent=null;try{sent=JSON.parse(String(init&&init.body||'null'))}catch(e){}
          const t=sent&&sent.terms||{};
          if(j.outcome==='paid'&&!RUN.paidAt){RUN.paidAt=at;RUN.paid=AMT.test(String(t.amount))&&CUR.test(String(t.currency))?money(String(t.amount),String(t.currency)):''}
          if(j.outcome==='refused'&&Array.isArray(j.changed)&&j.changed.length){const L=j.layers||{};RUN.refused={both:!!(L.signature&&L.signature.verified===false&&L.executor&&L.executor.accepted===false),changed:j.changed.filter((k)=>/^[a-z_0-9]{1,32}$/.test(k))}}
        }
        keep();drawOutcome();drawUse();
      }).catch(()=>{});
    }
  }catch(e){}
  return res;
};
// The test-money label, always on screen.
document.body.append(mk('div','pv-money',PC.money));
// The phone lane, unless ?phone=0 (a recording on a laptop that signs with its own passkey, e.g. Windows Hello).
const NOPHONE=new URLSearchParams(location.search).get('phone')==='0';
if(!NOPHONE)document.body.append(mk('aside','pv-lane',[mk('div','pv-phone',mk('span','',PC.laneSpot)),mk('p','',PC.lane)]));
// The opener: Before and After.
const opener=mk('section','pv-card',mk('div','in',[mk('div','pv-money',PC.money),mk('h2','',PC.openerHeading),mk('div','pv-ba',[mk('div','before',[mk('b','',PC.beforeLabel),mk('p','',PC.before)]),mk('div','after',[mk('b','',PC.afterLabel),mk('p','',PC.after)])]),mk('p','pv-go',PC.go)]));
opener.setAttribute('role','dialog');opener.setAttribute('aria-label',PC.openerHeading);
document.body.append(opener);
// The outcome.
const outcome=mk('section','pv-card pv-out');outcome.setAttribute('role','dialog');outcome.setAttribute('aria-label',PC.out.heading);
document.body.append(outcome);
const secs=(ms)=>{const s=Math.round(ms/1000);return s<60?s+' s':Math.floor(s/60)+' min '+(s%60)+' s'};
function fig(value,label,cls){const b=mk('b',value==null?'none':(cls||''),value==null?PC.out.notInRun:value);return mk('li',cls==='word'||cls==='ok'?cls:'',[b,mk('span','',label)])}
function drawOutcome(){
  const O=PC.out;
  const r=RUN.refused;
  const figs=mk('ul','pv-figs',[
    fig(RUN.startAt&&RUN.paidAt?secs(RUN.paidAt-RUN.startAt):null,O.time),
    fig(RUN.paid?RUN.paid:null,O.paid),
    fig(RUN.seqs.size?String(RUN.seqs.size):null,RUN.seqs.size?O.steps+' · '+RUN.claude.size+' '+O.claude:O.steps),
    fig(r?(r.both?O.refusedYes:O.refusedPart):null,O.refused,r?'ok':null),
  ]);
  figs.lastChild.querySelector('b').classList.add('word');
  outcome.replaceChildren(mk('div','in',[mk('div','pv-money',PC.money),mk('h2','',O.heading),figs,mk('p','pv-sub',O.measured),mk('p','pv-try',[O.try+' ',mk('span','',PC.tryUrl)])]));
}
drawOutcome();
// Fit: a step taller than the screen is drawn a little smaller (never under 80% of the frame's size), so nothing
// scrolls at 1080p. Wide screens only; a phone scrolls as ever.
let fitting=0;
function fit(){
  fitting=0;const m=document.getElementById('main');if(!m||innerWidth<1200)return;
  m.style.zoom='';
  const base=parseFloat(getComputedStyle(m).zoom)||1;let z=base;
  for(let k=0;k<4;k++){
    const sh=document.documentElement.scrollHeight;if(sh<=innerHeight)break;
    const top=m.getBoundingClientRect().top+scrollY;
    z=Math.max(base*0.8,z*(innerHeight-top)/(sh-top)-0.005);m.style.zoom=String(z);
    if(z<=base*0.8)break;
  }
}
new MutationObserver(()=>{if(!fitting)fitting=requestAnimationFrame(fit)}).observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['hidden','open','class']});
addEventListener('resize',()=>{if(!fitting)fitting=requestAnimationFrame(fit)});
const close=(c)=>c.classList.remove('on');
const isOn=(c)=>c.classList.contains('on');
let openerTimer=null;
function showOpener(){opener.classList.add('on');clearTimeout(openerTimer);openerTimer=setTimeout(()=>close(opener),PC.openerMs)}
// The opener at a fresh start only (not after a reload in the middle of a run).
let st=null;try{st=JSON.parse(sessionStorage.getItem('purser.try')||'null')}catch(e){}
if(!st||!st.session)showOpener();
opener.addEventListener('click',()=>close(opener));
outcome.addEventListener('click',()=>close(outcome));
// → : the step's own main button, the same click a person makes. On the invoice step with nothing chosen, the first sample.
function next(){
  if(isOn(how)){close(how);return}
  if(isOn(opener)){close(opener);return}
  if(isOn(outcome)){close(outcome);return}
  const main=document.getElementById('main');if(!main)return;
  if(main.querySelector('.screen.invoice')){const picked=main.querySelector('.screen.invoice [aria-pressed="true"]');if(!picked){const first=main.querySelector('.screen.invoice button[aria-pressed]');if(first){first.click();return}}}
  // After paid, the next step is the one-cent change (screen 5's own quiet link); after the refusal, the outcome.
  if(RUN.refused&&(main.querySelector('.screen.pay .why')||main.querySelector('.screen.books, .screen.company, .screen.did'))){outcome.classList.add('on');return}
  if(RUN.paidAt&&!RUN.refused){const cheat=main.querySelector('.screen.books button.cheat');if(cheat){cheat.click();return}}
  const b=[...main.querySelectorAll('.btn.primary')].find((x)=>!x.disabled&&x.offsetParent!==null);
  if(b)b.click();
}
document.addEventListener('keydown',(e)=>{
  if(e.altKey||e.ctrlKey||e.metaKey)return;
  const t=e.target;if(t&&(t.tagName==='INPUT'||t.tagName==='TEXTAREA'||t.isContentEditable))return;
  if(e.key==='ArrowRight'){e.preventDefault();next()}
  else if(e.key==='r'||e.key==='R'){try{sessionStorage.removeItem('purser.try');sessionStorage.removeItem('purser.present')}catch(x){}location.href=location.pathname+'?present=1'+(NOPHONE?'&phone=0':'')+POOLTAG;location.reload()}
  else if(e.key==='o'||e.key==='O'){drawOutcome();outcome.classList.add('on')}
  else if(e.key==='m'||e.key==='M'){if(isOn(how))close(how);else{close(opener);close(outcome);showHow()}}
  else if(e.key==='Escape'){close(opener);close(outcome);close(how)}
});
`;

const b64 = (k: string) => { const f = LOGO_FILES[k]; return f ? `data:${f.type};base64,${f.b64}` : ""; };
/** The partners' own files, unaltered (logos.gen.ts, awxLogo.gen.ts), on a white chip as on the README. */
const LOGOS = {
  claude: { src: b64("/assets/logo-claude-slate.svg"), alt: "Claude" },
  airwallex: { src: AIRWALLEX_LOGO_DATA_URL, alt: "Airwallex" },
  alta: { src: b64("/assets/logo-alta.svg"), alt: "Alta (formerly Metal)" },
};

/**
 * The public page (no ?present=1): the same app shell and "How Purser works", nothing of recording mode (no opener, no
 * outcome card, no keys, no zoom). Claude's usage is read from the same answers, a copy, never changed.
 */
const PUBLIC_SCRIPT = String.raw`
const PC=__PRESENT_CFG__;
__SHARED__
const real=window.fetch.bind(window);
window.fetch=async(input,init)=>{
  const res=await real(input,init);
  try{const url=new URL(typeof input==='string'?input:input.url,location.href);const p=url.pathname;
    if(res.ok&&(p==='/v1/try/start'||p==='/v1/engine/events'))res.clone().json().then((j)=>{if(!j||typeof j!=='object')return;
      if(p==='/v1/try/start')CALLS.clear();else for(const e of Array.isArray(j.items)?j.items:[])if(e&&typeof e.seq==='number')takeCall(e,e.fields&&typeof e.fields==='object'?e.fields:{});
      drawUse()}).catch(()=>{});
  }catch(e){}
  return res;
};
addEventListener('keydown',(e)=>{if(e.key==='Escape')how.classList.remove('on')});
`;

const json = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c");

/** The style and the script /try adds with ?present=1. */
export function presentExtra(kind: "present" | "public" = "present"): { css: string; script: string } {
  const cfg = {
    money: PRESENT_MONEY, lane: PRESENT_LANE, laneSpot: "Mirrored phone", tryUrl: PRESENT_TRY,
    openerHeading: "Paying suppliers, with AI agents", beforeLabel: "Before", afterLabel: "After with Purser",
    before: PRESENT_BEFORE, after: PRESENT_AFTER, go: "Press → to start", openerMs: 5_000,
    out: PRESENT_OUTCOME, shell: PRESENT_SHELL, how: PRESENT_HOW, map: SYSTEM_MAP_DATA_URL, logos: LOGOS, partners: PRESENT_PARTNERS, stages: PRESENT_STAGES, payButton: PAY.button, ledgerFold: "Show the bookkeeping entries",
    // Without the negotiation the Clean sample's hint keeps only its first part ("Ready to pay").
    negHint: NEG_HINT, negHintShort: NEG_HINT.split(" · ")[0],
  };
  const body = (kind === "public" ? PUBLIC_SCRIPT : SCRIPT).replace("__SHARED__", () => SHARED);
  return { css: CSS, script: body.replace("__PRESENT_CFG__", () => json(cfg)) };
}
