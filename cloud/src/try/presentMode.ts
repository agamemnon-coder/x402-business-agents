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

import { INVOICE, LIVE, PAY, WORK } from "../tryCopy.js";
import { TRY_ALONE_LIMIT } from "../../../src/config/policy.js";
import { AIRWALLEX_LOGO_DATA_URL } from "../awxLogo.gen.js";
import { AIRWALLEX_LOGO_SIZE } from "../../../src/ui/builtOn.js";
import { START_LOGOS } from "./run.js";
import { LOGO_FILES } from "./logos.gen.js";
import { AWX_TRAIL_CALLS } from "./proof.gen.js";
import { SYSTEM_MAP_DATA_URL } from "./systemMap.gen.js";

const NEG_HINT = INVOICE.hints.clean ?? "";

export const PRESENT_BEFORE = "An agent's invoice lands in a queue. An approve button anyone can click pays it, whatever was changed on the way.";
export const PRESENT_AFTER = "The CFO signs the exact terms with Face ID. Change one cent and the signature is refused: nothing moves.";
export const PRESENT_TRY = "kit11.max-31b.workers.dev/try";
export const PRESENT_MONEY = "Test money only · Airwallex sandbox";
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
  heading: "AI agents prepare the payments. You approve the exceptions with your passkey.",
  tabFlow: "One payment", tabMap: "The whole system", tabProof: "Partner proof", close: "Close",
  steps: [
    { h: "An invoice comes in", p: "A supplier sends it, by email or as an upload." },
    { h: "AI agents read and check it", p: "Claude reads it. The agents check the supplier, the bank account and whether it was paid before.", logo: "claude" },
    { h: "Your rules decide", p: "Below your limit, an agent pays it on its own. Above it, the agent asks you." },
    { h: "You approve with your passkey", p: "You sign the exact amount, supplier and bank account with your passkey." },
    { h: "The money is sent", p: "Through Airwallex (sandbox), then booked and filed for you.", logo: "airwallex" },
  ],
  cut: { h: "Changed by one cent after you approved?", p: "Refused. Your approval no longer matches, so nothing is sent." },
  mapAlt: "The whole Purser system: who uses it, the screens, the Claude agents, the rules in code, the money rails (Airwallex sandbox, Alta testnet) and the proof anyone can check.",
  built: "Built with",
  foot: "Alta (formerly Metal) · Visa Intelligent Commerce via Airwallex Airi · test money only · no endorsement implied",
} as const;

/**
 * The v2 preview (/try?v=2, and recording mode): the same screens and engine, the product's words (Max, 15 Nov). Merged
 * over the page's copy key by key (tryPage's over), so plain /try keeps the release's words and its negotiation.
 */
export const V2_COPY = {
  start: {
    eyebrow: "Live demo · about 2 minutes",
    heading: "AI agents prepare the transfer. Your passkey releases the funds.",
    text: "Claude reads and checks every supplier invoice. Inside your limits, the agents pay on their own. Above them, nothing moves until you approve the exact payment with your passkey. Change one cent afterwards and it is blocked.",
    flow: [
      { name: "Claude reads the invoice", line: "Supplier, amount, bank account, due date: checked against what is on file." },
      { name: "Your rules decide", line: "Inside your limits the agent pays. Above them, it asks you." },
      { name: "You sign the exact payment", line: "Your passkey on this amount, this supplier, this account. Not a budget." },
    ],
    flowEnd: "Changed by one cent: blocked",
    button: "Launch the live transfer demo",
    // Site audit, 20 Nov (finding 6.3): the sandbox disclosure first, right under the primary button.
    fine: "Sandbox demo: test money, no real settlement · Purser's real engine · deleted after 24 hours",
  },
  approve: {
    heading: "Approve the transfer.",
    sheet: "Locked payment terms",
    limit: "Above the agent's limit, so it waits for the CFO. In this demo the limit is EUR 500.00; at or below it, the agent pays on its own.",
    signs: "Your approval locks exactly these terms.",
    approve: "Approve & sign {amount} with {method}",
  },
  books: { heading: "Transfer executed." },
  work: { heading: "The AI agent prepares the transfer.", ready: "Checks passed. Waiting for your approval.", readyAlone: "Checks passed. Approved by your policy.", readySub: "Agents can't raise their own limit or pay above it.", pay: "Send to CFO for approval →", took: "Purser's checks answered in {s} s, measured in your browser." },
  invoice: { send: "Give it to the AI agent →" },
  company: { heading: "Your run, start to finish." },
  pay: {
    heading: "Test the lock.",
    line: "This is the payment you approved, with one cent added. Try to pay it with your earlier approval.",
    button: "Try to pay with my earlier approval",
  },
} as const;

/**
 * The partners' proof, each from a run record, each a link to it (Metal and Visa awards; test networks only).
 * 19 Nov 2026 (live review: "154 sandbox calls" here, 184 on /airwallex): the Airwallex count is the one /airwallex lists,
 * from the run records (src/airwallex/apiTrail.ts), written into ./proof.gen.ts by npm run cloud:proof.
 */
export const PRESENT_PARTNERS = {
  heading: "Tested on partner sandboxes and testnet",
  sub: "The same controls, on each partner's own rails, each from a recorded run you can open. Test money only.",
  cards: [
    { logo: "airwallex", label: "Airwallex · sandbox", h: "Your approval travels with the money", p: "Each bank transfer carries the fingerprint of exactly what the CFO approved (797d4483… on a EUR 240.00 test transfer). Agent card limits are enforced by Airwallex itself: EUR 30.00 approved, EUR 30.01 declined.", link: `${AWX_TRAIL_CALLS} sandbox calls on /airwallex`, href: "https://kit11.max-31b.workers.dev/airwallex" },
    { logo: "alta", label: "Alta (formerly Metal) · testnet · x402", h: "Agent spending limits, enforced on chain", p: "86 agent payments on Alta testnet in the main run. When an agent tried to pay more than its limit allows, the chain itself refused it (purchase #24).", link: "tx 0x2e92f9cb…1871", href: "https://testnet.metalntwx.com/tx/0x2e92f9cb4549246f58b9b888881c258bf117c6233c1d8f126f4833ae6ae41871" },
    { logo: "", word: "Visa Intelligent Commerce", label: "via Airwallex Airi · sandbox", h: "One credential, one purchase", p: "Each agent purchase gets its own card credential, bound to the exact amount. Used again, or for another amount, Purser refuses it before any payment is tried. 6 purchases paid across 4 sandbox runs.", link: "See it on /visa", href: "https://kit11.max-31b.workers.dev/visa" },
  ],
  all: "View live partner proof & architecture",
  allHref: "https://kit11.max-31b.workers.dev/proof",
  foot: "Alta (formerly Metal), Visa Intelligent Commerce via Airwallex Airi, Airwallex: no endorsement implied.",
  chain: "The same rule on chain: Alta (formerly Metal) refused an agent's purchase #24 because it was over the agent's limit.",
  chainLink: "See the transaction →",
  chainHref: "https://testnet.metalntwx.com/tx/0x2e92f9cb4549246f58b9b888881c258bf117c6233c1d8f126f4833ae6ae41871",
} as const;

/** The four stages on top of the workspace (v2). */
/** One plain sentence per moment, above the screen (15 Nov, Max: "people need to understand what's happening"). */
export const PRESENT_GUIDE = {
  invoice: { k: "Step 1 of 4", t: "A supplier's invoice arrives.", d: "Pick one. An AI agent will read it and check it for you." },
  reading: { k: "Step 1 of 4", t: "The AI agent is reading the invoice.", d: "Claude reads the PDF; code checks what it read. Each step below is the engine's own event, as it happens." },
  workInj: { k: "Step 1 of 4", t: "The AI agent caught a hidden instruction in the invoice.", d: "It was ignored: an AI can't be told to pay. The invoice is checked like any other and still needs the CFO." },
  work: { k: "Step 1 of 4", t: "The AI agent read the invoice and checked it.", d: "It is above the agent's limit, so the agent can't pay it alone. It asks the CFO." },
  approve: { k: "Step 2 of 4", t: "You are the CFO. Approve this exact payment.", d: "Your passkey (Face ID on iPhone) locks the amount, the supplier and the bank account. Nothing moves before." },
  workAlone: { k: "Inside the limit", t: "The agent may pay this one on its own.", d: "It is within the agent's EUR 500.00 limit and every check passed. No signature needed: your rules already allow it." },
  workCash: { k: "Inside the limit", t: "Cash says wait: the agent does not pay this one now.", d: "Paying it would take available EUR below the cash floor. Purser's code checked the figures, not the AI." },
  booksAlone: { k: "Paid by the agent", t: "The agent paid it on its own.", d: "Within your limit, booked, and logged as approved by your policy, not by a person. Now try an invoice above the limit." },
  books: { k: "Step 3 of 4", t: "Approved, so the money went out.", d: "Paid with test money, booked in the accounts and filed. Next: try to cheat." },
  pay: { k: "Step 4 of 4", t: "Now play the fraudster: change one cent.", d: "Try to pay a slightly different amount with the CFO's earlier approval." },
  refused: { k: "Step 4 of 4", t: "Blocked. Not a cent moved.", d: "The approval only fits the exact payment the CFO saw. Change anything and it no longer fits." },
  done: { k: "Done", t: "That's Purser.", d: "AI agents do the work. You approve the exceptions. Nobody can change what you approved." },
} as const;

/**
 * 19 Nov 2026 (live review: the hosted Claude switch's action cap was unset, so every run fell back to Purser's code while
 * these lines said the AI agent read the invoice): the same moments when Purser's code reads the invoice in this run
 * (the engine's read_by, claude.capped or claude.fallback; before any of them, the start's mode). The reading line is
 * tryCopy's own (WORK.readingCode).
 */
export const PRESENT_GUIDE_CODE = {
  invoice: { k: "Step 1 of 4", t: "A supplier's invoice arrives.", d: "Pick one. In this run Purser's code reads it and checks it: Claude is not asked." },
  reading: { k: "Step 1 of 4", t: WORK.readingCode, d: "Claude is not asked in this run, so Purser's code reads the PDF and checks it. Each step below is the engine's own event, as it happens." },
  workInj: { k: "Step 1 of 4", t: "Purser's code caught a hidden instruction in the invoice.", d: "It was ignored: an invoice can't order a payment. It is checked like any other and still needs the CFO." },
  work: { k: "Step 1 of 4", t: "Purser's code read the invoice and checked it.", d: "Claude was not asked in this run. It is above the agent's limit, so it can't be paid alone: it goes to the CFO." },
} as const;

/** A note that tries to give the AI orders (the engine's own flag, document.injection_flagged): said, never hidden. */
/** The finish (16 Nov, Max: "tell the jury and partners what is happening and how everything is verified"): each step of
 * the run and how anyone checks it without trusting us. Every line is a fact of the code or a recorded run. */
export const PRESENT_VERIFY = {
  h: "How every step is verified",
  sub: "What happened in your run, and how anyone can check it without trusting us.",
  rows: [
    { k: "claude", h: "Claude read the invoice", p: "Each call is logged with its model, time, cost and Anthropic's request id.", run: "This run: {n} calls, {cost}." },
    { k: "sign", h: "Your passkey signed the exact terms", p: "It signed a fingerprint (SHA-256) of this amount, supplier and bank account. The server checks that signature before any money moves.", link: "Verify this payment yourself", href: "verify" },
    { k: "cent", h: "One cent changed: refused", p: "A changed payment has a different fingerprint, so your signature no longer fits. Nothing moved." },
    { k: "bank", h: "The bank keeps the fingerprint", p: "The Airwallex sandbox transfer carries the fingerprint of what you approved, and Airwallex's own approval is a second lock.", link: "Airwallex sandbox runs", href: "https://kit11.max-31b.workers.dev/airwallex" },
    { k: "chain", h: "Agent limits, enforced on chain", p: "On Alta (formerly Metal) testnet the chain itself refused an agent payment over its limit. Anyone can look it up.", link: "See the transaction", href: "https://testnet.metalntwx.com/tx/0x2e92f9cb4549246f58b9b888881c258bf117c6233c1d8f126f4833ae6ae41871" },
    { k: "log", h: "A log nobody can quietly rewrite", p: "Every step is hash-chained to the one before it, so a later edit shows. The records and the proof are yours to download." },
    { k: "code", h: "Open and tested", p: "The code is public, with more than 7,000 automated tests on every change.", link: "The code on GitHub", href: "https://github.com/agamemnon-coder/x402-business-agents" },
  ],
  all: "See all the proof",
  allHref: "https://kit11.max-31b.workers.dev/proof",
  foot: "Test money only. Partner names and marks belong to their owners; no endorsement implied.",
  /** 19 Nov 2026 (live review): the first line when Purser's code read the invoice in this run (tryCopy's own words). */
  code: {
    h: LIVE.ev["claude.fallback"]!.split(". ")[0]!,
    p: "Claude was not asked in this run, so no model answer was used: Purser's code read the invoice and its rules checked it. When Claude reads, each call is logged with its model, time, cost and Anthropic's request id.",
    run: "This run: {n} Claude calls, {cost}.", none: "This run: no Claude call.",
  },
} as const;

/**
 * 19 Nov 2026 (Max, after the all-time Claude cap ran out silently on the hosted demo): when live Claude did not read the
 * invoice, the visitor sees it in the main flow, on the reading step and on the end card, in one calm line, why first.
 * The reason is the engine's own (claude.capped's reason, src/engine/budget.ts CappedReason), in tryCopy's words
 * (LIVE.caps); "mode_code" is a start that said code reads (the switch, a key or a cap not set); anything else (a
 * fallback with no cap: a refusal, an answer that did not fit) says only that Claude's reading was not used. Never shown
 * when Claude read the invoice. `caps` is LIVE.caps, passed in: the page runs this function's own text.
 */
export const pausedNotice = (reason: string, done: boolean, caps: Record<string, string>): string => {
  const budget = /^(action_budget|pool_day_cap|company_cap|address_cap|all_time_cap)$/.test(reason) && typeof caps[reason] === "string";
  const head = budget ? "Live Claude is paused right now: " + caps[reason] + "."
    : reason === "switch_off" ? "Live Claude is switched off right now."
    : reason === "no_key" ? "Live Claude is not set up here."
    : reason === "busy" ? "Live Claude is busy right now."
    : reason === "mode_code" ? "Live Claude is off for this demo right now."
    : "Claude's reading was not used for this invoice.";
  return head + " Purser's code " + (done ? "read" : "reads") + " this invoice instead. Every limit, check and signature works exactly the same.";
};

/** "Under the hood" (16 Nov, Max: "small screens of the code and what is happening, simple"): per step, the real flow
 * in a few simplified lines, with this run's own values (Claude's call, the terms, their fingerprint, the refused one). */
/** The agent's own limit in a /try company (EUR), as the engine sets it; the code window compares the invoice with it. */
export const PRESENT_AGENT_LIMIT = TRY_ALONE_LIMIT.amount;

export const PRESENT_HOOD = {
  h: "Under the hood", tag: "simplified from the real code", show: "Show the code", hide: "Hide the code",
} as const;

/** Airwallex's own approval workflow on the sandbox account: a second, independent lock after the CFO's Face ID. */
export const PRESENT_AWX2 = {
  okH: "Paid at Airwallex (sandbox), with your approval's fingerprint attached.",
  okP: "Airwallex's own transfer approval workflow is available as an optional second lock.",
  h: "Second lock: Airwallex's own approval.",
  p: "This test account asks a person to approve each transfer inside Airwallex too. Purser never does that step itself, so here the test transfer waits there.",
} as const;

export const PRESENT_INJ = {
  h: "Hidden instruction found in this invoice, and ignored",
  p: "Someone wrote an order to the AI into the invoice. It changes nothing: the AI can't pay on its own, and this payment still needs the CFO's approval.",
  h2: "This invoice had a hidden instruction for the AI",
  p2: "It was ignored. Check the terms below: only your passkey can approve them.",
} as const;

export const PRESENT_STAGES = ["The AI agent prepares", "The CFO approves", "The transfer", "The tamper test"] as const;
/** The same four on a phone. */
export const PRESENT_STAGES_SHORT = ["Agent", "CFO", "Transfer", "Tamper test"] as const;

export const PRESENT_SHELL = {
  workspace: "Your test company",
  tag: "Test money · sandbox",
  nav: ["Inbox", "Approvals", "Payments", "Books", "Agents"],
  usage: "Claude · this run",
  none: "No Claude call yet",
  /** 19 Nov 2026: when Purser's code read the invoice in this run. */
  noneCode: "No Claude call in this run",
  calls: "calls", call: "call",
  user: "CFO",
  userSub: "Signs with a passkey",
  reader: "Reader",
  how: "How it works",
  guide: "Guided demo · follow the highlighted button",
} as const;
/** The figures of the outcome card, by name; each is filled from an answer or says NOT_IN_RUN. */
export const PRESENT_OUTCOME = {
  heading: "What just happened",
  time: "From start to paid",
  steps: "Steps the engine recorded",
  claude: "of them by Claude (it reads the invoices when the switch is on)",
  /**
   * 20 Nov 2026: what paid, as the pay answer says (src/try/partners.ts, the pay line): the simulated bank always; the
   * Airwallex sandbox as well only when the answer's airwallex_payout says it made a transfer (the switch awx_payout).
   */
  paid: "Paid on the simulated bank (test money)",
  paidAwx: "Paid on the simulated bank, then once on the Airwallex sandbox (test money)",
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
  body.present.pv-shell header.top, body.pv-shell .progw { display: none !important; }
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
  body.pv-shell .pv-side { display: flex; position: fixed; z-index: 40; left: 0; top: 0; bottom: 0; width: 252px; flex-direction: column; gap: 18px; padding: 22px 16px; background: var(--surface); border-right: 1px solid var(--border); font: 500 14px/1.35 Inter, system-ui, sans-serif; color: var(--text); }
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
  body.present.pv-shell.pv-staged { padding-top: 64px; }
  body.pv-shell.pv-staged .pv-stages:not(.inmain) { display: flex; position: fixed; z-index: 35; top: 0; left: 0; right: 0; height: 58px; align-items: center; gap: 6px; margin: 0; padding: 0 24px; list-style: none; background: color-mix(in srgb, var(--surface) 88%, transparent); backdrop-filter: blur(10px); border-bottom: 1px solid var(--border); }
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
.screen.approve .hashpill[data-v2] { color: var(--accent); background: var(--accent-soft); }
.screen.approve .hashpill[data-v2]::before { content: none; }
.pp { margin-top: 28px; }
.pp h2 { margin: 0; font: 760 26px/1.2 Inter, system-ui, sans-serif; letter-spacing: -.01em; color: var(--text); }
.pp-sub { margin: 6px 0 16px; color: var(--muted); font: 500 15px/1.45 Inter, system-ui, sans-serif; }
.pp-cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
.pp-card { display: flex; flex-direction: column; gap: 8px; padding: 18px; border-radius: 18px; border: 1px solid var(--border); background: var(--surface); min-width: 0; }
.pp-top { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.pp-l { color: var(--faint); font: 600 12px/1.3 Inter, system-ui, sans-serif; }
.pv-chain { margin: 10px 0 0; padding: 10px 12px; border-radius: 12px; border: 1px dashed color-mix(in srgb, var(--bad) 45%, var(--border)); color: var(--muted); font: 500 14px/1.45 Inter, system-ui, sans-serif; }
.pv-chain a { color: var(--accent); font-weight: 650; text-decoration: none; }
.pp-visa { display: inline-flex; align-items: center; height: 30px; padding: 0 12px; border-radius: 8px; border: 1px solid var(--border); color: var(--text); font: 700 15px/1 Inter, system-ui, sans-serif; } /* Visa named in text, never a drawn mark */
.pp-card b { font: 750 18px/1.25 Inter, system-ui, sans-serif; color: var(--text); }
.pp-card p { margin: 0; color: var(--muted); font: 500 14.5px/1.5 Inter, system-ui, sans-serif; flex: 1; font-feature-settings: "calt" 0; }
.pv-chain, .pp-l { font-feature-settings: "calt" 0; }
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
  body.pv-shell.pv-staged > .pv-money { top: 12px; right: 20px; z-index: 45; }
  body.pv-shell.pv-staged #main .vflow { display: none !important; }
}
body.pv-shell .band .same { display: none; }
@media (max-width: 1199px) { body.pv-shell:not(.present) > .pv-money { display: none; } }
.card.refusal { border: 2px solid var(--bad) !important; background: color-mix(in srgb, var(--bad) 8%, var(--bg)) !important; box-shadow: 0 0 0 6px color-mix(in srgb, var(--bad) 10%, transparent), 0 24px 60px -30px color-mix(in srgb, var(--bad) 60%, transparent) !important; }
body.pv-shell .screen.start .pp { grid-column: 1 / -1; width: 100%; }
body.pv-shell .screen.start li.wide { display: none; }
.screen.books .blk.booked .v2fold > summary { cursor: pointer; color: var(--accent); font: 600 14px/1.3 Inter, system-ui, sans-serif; margin-top: 6px; }
.screen .card .pv-tag.amber { margin-bottom: 14px; }

/* Jury round (15 Nov): no stray dot, one even stage bar, the finish readable, the proof large in recording mode. */
.hw-flow::after { display: none !important; }
.pv-stages li { height: 40px; margin: 0; }
.pv-guide { margin: -6px 0 0; padding: 0 4px; color: var(--faint); font: 600 11.5px/1.35 Inter, system-ui, sans-serif; }
.pv-nav li { cursor: default; }
.screen.company .pp-cards, .screen.did .pp-cards { grid-template-columns: 1fr; }
.screen .hw-logo.hw-airwallex { margin: 0 4px; }
body.present .card.refusal .hashes .hash { margin: 0; font-size: 15px; line-height: 1.5; word-break: break-all; }
body.present .card.refusal .hashes .hl { margin-right: 10px; font-family: Inter, system-ui, sans-serif; font-weight: 700; }
body.present .card.refusal .hashes { margin: 10px 0; padding: 12px 14px; border-radius: 12px; background: var(--bg); border: 1px solid var(--border); }
body.present .card.refusal .hashes .hash + .hash { color: var(--bad); }
body.present .card.refusal .hashes .hash + .hash::before { content: "≠  "; font-weight: 800; }

/* Motion (15 Nov, Max: ultra high quality): every screen arrives, every state change is felt, nothing loops loudly.
   All of it off for people who ask for less motion. */
.pv-aurora { display: none; }
@media (prefers-reduced-motion: no-preference) {
  body.pv-shell #main > h1 { animation: mvUp .5s cubic-bezier(.2,.8,.2,1) both; }
  body.pv-shell #main > .screen > * { animation: mvUp .6s cubic-bezier(.2,.8,.2,1) both; }
  body.pv-shell #main > .screen > *:nth-child(2) { animation-delay: .07s; }
  body.pv-shell #main > .screen > *:nth-child(3) { animation-delay: .14s; }
  body.pv-shell #main > .screen > *:nth-child(4) { animation-delay: .21s; }
  body.pv-shell #main > .screen > *:nth-child(n+5) { animation-delay: .28s; }
  /* The agent ticks its checks one by one. */
  body.pv-shell .screen.work ul.checks li { animation: mvTick .45s cubic-bezier(.2,.8,.2,1) both; }
  body.pv-shell .screen.work ul.checks li:nth-child(1) { animation-delay: .25s; }
  body.pv-shell .screen.work ul.checks li:nth-child(2) { animation-delay: .5s; }
  body.pv-shell .screen.work ul.checks li:nth-child(3) { animation-delay: .75s; }
  body.pv-shell .screen.work ul.checks li:nth-child(4) { animation-delay: 1s; }
  body.pv-shell .screen.work ul.checks li svg { animation: mvPop .4s cubic-bezier(.2,1.6,.4,1) both; animation-delay: inherit; }
  /* Tags, the stage bar, the sidebar. */
  .pv-tag { animation: mvTag .5s cubic-bezier(.2,.8,.2,1) both .1s; }
  .pv-stages li .n { transition: background .35s, border-color .35s, color .35s, transform .35s; }
  .pv-stages li.cur .n { animation: mvRing 2.4s ease-out infinite; }
  .pv-stages li.done .n { animation: mvPop .45s cubic-bezier(.2,1.6,.4,1) both; }
  .pv-stages li + li::before { transition: background .5s; }
  .pv-stages li.done + li::before, .pv-stages li.done + li.cur::before { background: var(--ok); }
  .pv-howbtn .dot { animation: mvDot 2.4s ease-out infinite; }
  .pv-use li { animation: mvRow .4s cubic-bezier(.2,.8,.2,1) both; }
  .pv-use .tot.flash { animation: mvFlash .9s ease-out; }
  /* The main button breathes once it is the only thing to do; a light sweeps across on hover. */
  body.pv-shell #main .btn.primary { position: relative; overflow: hidden; transition: transform .18s, box-shadow .25s; }
  body.pv-shell #main .btn.primary:hover { transform: translateY(-1px); box-shadow: 0 10px 30px -10px color-mix(in srgb, var(--accent) 80%, transparent); }
  body.pv-shell #main .btn.primary::after { content: ""; position: absolute; inset: 0; background: linear-gradient(100deg, transparent 30%, #ffffff40 50%, transparent 70%); transform: translateX(-120%); }
  body.pv-shell #main .btn.primary:hover::after { transform: translateX(120%); transition: transform .7s; }
  body.pv-shell #main .btn.primary.big { animation: mvBreathe 2.8s ease-in-out infinite 1.4s; }
  /* Approve: the amount lands, the seal settles. */
  body.pv-shell .screen.approve .receipt.sheet .amount { animation: mvScale .6s cubic-bezier(.2,.9,.3,1.15) both .3s; }
  body.pv-shell .hashpill[data-v2] { background-image: linear-gradient(100deg, transparent 30%, #ffffff30 50%, transparent 70%); background-size: 250% 100%; animation: mvShine 1.6s ease-out .9s both; }
  /* Paid: an emerald light passes over the payment once. */
  body.pv-shell .screen.books .blk.paid { position: relative; overflow: hidden; }
  body.pv-shell .screen.books .blk.paid::after { content: ""; position: absolute; inset: 0; pointer-events: none; background: linear-gradient(100deg, transparent 35%, color-mix(in srgb, var(--ok) 22%, transparent) 50%, transparent 65%); transform: translateX(-100%); animation: mvSweep 1.4s ease-out .5s both; }
  body.pv-shell .screen.books .blk.paid .amount { animation: mvScale .6s cubic-bezier(.2,.9,.3,1.15) both .35s; }
  /* Blocked: one shake, a red pulse, the changed cent marked. */
  .card.refusal { animation: mvShake .55s cubic-bezier(.36,.07,.19,.97) both .1s, mvGlowRed 2.4s ease-in-out .8s 2 !important; }
  .card.refusal .diff mark.new { animation: mvMark 1.4s ease-out .5s both; }
  .card.refusal .hashes mark { animation: mvBlink 1.2s ease-in-out .9s 2; }
  /* The landing: the steps arrive in order, the refusal last; a slow aurora behind. */
  body.pv-shell .screen.start .flow li { animation: mvUp .6s cubic-bezier(.2,.8,.2,1) both; }
  body.pv-shell .screen.start .flow li:nth-child(1) { animation-delay: .25s; }
  body.pv-shell .screen.start .flow li:nth-child(2) { animation-delay: .45s; }
  body.pv-shell .screen.start .flow li:nth-child(3) { animation-delay: .65s; }
  body.pv-shell .screen.start .flow li.fend { animation: mvUp .6s cubic-bezier(.2,.8,.2,1) .95s both, mvShake .5s cubic-bezier(.36,.07,.19,.97) 1.55s; }
  body.pv-shell:has(.screen.start) .pv-aurora { display: block; position: fixed; inset: 0; z-index: -1; pointer-events: none; background: radial-gradient(40vw 30vw at 70% 20%, color-mix(in srgb, var(--accent) 22%, transparent), transparent 70%), radial-gradient(35vw 28vw at 30% 80%, color-mix(in srgb, var(--ok) 14%, transparent), transparent 70%); animation: mvAurora 18s ease-in-out infinite alternate; }
}
.pv-grad { background: linear-gradient(90deg, var(--accent), color-mix(in srgb, var(--accent) 40%, var(--ok))); -webkit-background-clip: text; background-clip: text; color: transparent; }
@keyframes mvUp { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: none; } }
@keyframes mvTick { from { opacity: 0; transform: translateX(-8px); } to { opacity: 1; transform: none; } }
@keyframes mvPop { 0% { transform: scale(.4); } 70% { transform: scale(1.18); } 100% { transform: scale(1); } }
@keyframes mvTag { from { opacity: 0; transform: translateY(-6px) scale(.96); } to { opacity: 1; transform: none; } }
@keyframes mvRing { 0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--accent) 55%, transparent); } 70%, 100% { box-shadow: 0 0 0 10px transparent; } }
@keyframes mvDot { 0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--accent) 60%, transparent); } 70%, 100% { box-shadow: 0 0 0 8px transparent; } }
@keyframes mvRow { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: none; } }
@keyframes mvFlash { 0% { color: var(--ok); } 100% { color: inherit; } }
@keyframes mvBreathe { 0%, 100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--accent) 0%, transparent); } 50% { box-shadow: 0 0 0 6px color-mix(in srgb, var(--accent) 18%, transparent); } }
@keyframes mvScale { from { opacity: 0; transform: scale(.94); } to { opacity: 1; transform: none; } }
@keyframes mvShine { from { background-position: 120% 0; } to { background-position: -120% 0; } }
@keyframes mvSweep { to { transform: translateX(100%); } }
@keyframes mvShake { 0%, 100% { transform: none; } 20% { transform: translateX(-7px); } 40% { transform: translateX(6px); } 60% { transform: translateX(-4px); } 80% { transform: translateX(2px); } }
@keyframes mvGlowRed { 0%, 100% { box-shadow: 0 0 0 6px color-mix(in srgb, var(--bad) 10%, transparent); } 50% { box-shadow: 0 0 0 10px color-mix(in srgb, var(--bad) 22%, transparent), 0 0 40px color-mix(in srgb, var(--bad) 30%, transparent); } }
@keyframes mvMark { 0% { background: color-mix(in srgb, var(--bad) 45%, transparent); } 100% { background: transparent; } }
@keyframes mvBlink { 0%, 100% { opacity: 1; } 50% { opacity: .35; } }
@keyframes mvAurora { from { transform: translate3d(0,0,0) scale(1); } to { transform: translate3d(-4vw,3vh,0) scale(1.08); } }

/* The guide: one plain sentence above every step, in the visitor's words. */
.pv-cap { display: none; }
.pv-cap.on { display: grid; grid-template-columns: auto 1fr; column-gap: 14px; align-items: baseline; margin: 6px 0 18px; padding: 16px 20px; border-radius: 16px; border: 1px solid color-mix(in srgb, var(--accent) 35%, var(--border)); background: linear-gradient(135deg, color-mix(in srgb, var(--accent) 14%, var(--surface)), var(--surface) 70%); box-shadow: 0 18px 40px -28px color-mix(in srgb, var(--accent) 70%, transparent); }
.pv-cap .k { grid-row: 1 / span 2; align-self: start; padding: 5px 10px; border-radius: 999px; background: var(--accent); color: #fff; font: 750 12px/1.2 Inter, system-ui, sans-serif; letter-spacing: .04em; text-transform: uppercase; white-space: nowrap; }
.pv-cap b { font: 760 21px/1.25 Inter, system-ui, sans-serif; letter-spacing: -.01em; color: var(--text); }
.pv-cap .d { grid-column: 2; margin-top: 3px; color: var(--muted); font: 500 15.5px/1.45 Inter, system-ui, sans-serif; }
.pv-cap.refused { border-color: color-mix(in srgb, var(--bad) 55%, var(--border)); background: linear-gradient(135deg, color-mix(in srgb, var(--bad) 16%, var(--surface)), var(--surface) 70%); }
.pv-cap.refused .k { background: var(--bad); }
.pv-cap.books .k, .pv-cap.done .k { background: var(--ok); color: #04130d; }
.pv-cap.books { border-color: color-mix(in srgb, var(--ok) 45%, var(--border)); background: linear-gradient(135deg, color-mix(in srgb, var(--ok) 12%, var(--surface)), var(--surface) 70%); }
.pv-cap.approve .k { background: #f5b544; color: #241500; }
.pv-cap.approve { border-color: color-mix(in srgb, #f5b544 45%, var(--border)); background: linear-gradient(135deg, color-mix(in srgb, #f5b544 12%, var(--surface)), var(--surface) 70%); }
@media (prefers-reduced-motion: no-preference) { .pv-cap.in { animation: mvUp .5s cubic-bezier(.2,.8,.2,1) both; } }
@media (max-width: 700px) { .pv-cap.on { grid-template-columns: 1fr; } .pv-cap .k { grid-row: auto; justify-self: start; margin-bottom: 8px; } .pv-cap .d { grid-column: 1; } .pv-cap b { font-size: 18px; } }
body.pv-shell #main > .band { opacity: .7; }
/* 19 Nov 2026 (Max): live Claude did not read this invoice: one calm line in the flow (reading step, end card). */
.pv-paused { margin: 0 0 12px; padding: 10px 14px; border: 1px solid color-mix(in srgb, #f5b544 55%, var(--border)); border-radius: 12px; background: color-mix(in srgb, #f5b544 10%, var(--surface)); color: var(--text); font: 500 14.5px/1.45 Inter, system-ui, sans-serif; }
.pv-verify .pv-paused { margin: 4px 0 14px; }
.screen.work > .pv-paused { order: -2; }
/* 19 Nov 2026 (live review: on a 390 x 844 phone the main button started at y 926): below the two-column start, the
   button and its small print come before the three steps, so the button is on the first screen. */
@media (max-width: 1023px) { body.pv-shell:has(.screen.start) main { grid-template-areas: "eyebrow" "h1" "lede" "cta" "fine" "flow" "partners" "real"; } }
/* The guide says what the heading said, in the visitor's words: the heading stays for screen readers only. */
body.pv-shell #main:has(> .pv-cap.on) > h1 { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }

/* Simple (16 Nov, Max: "too much text, too much happening"): one story per screen; the rest stays on plain /try. */
body.pv-shell .vflow, body.pv-shell .progw, body.pv-shell #main .card.activity { display: none !important; }
body.pv-shell .screen.start .partners, body.pv-shell .screen.start li.wide { display: none; }
body.pv-shell .screen.work .result > p.meta, body.pv-shell .screen.work ul.checks li.next, body.pv-shell .screen.work .agentic, body.pv-shell .screen.work .negcard { display: none !important; }
body.pv-shell .screen.approve p.limit, body.pv-shell .screen.approve > div > details, body.pv-shell .screen.approve > div > p.muted, body.pv-shell .screen.approve .openl { display: none !important; }
body.pv-shell .screen.books .slot:has(.blk.filed), body.pv-shell .screen.books .tail .pdfl, body.pv-shell .screen.books .tail > p.hint, body.pv-shell .screen.books .tail .cloudl, body.pv-shell .screen.books .tail .acts .btn:not(.primary) { display: none !important; }
body.pv-shell .screen.pay .tryform > .two, body.pv-shell .screen.pay .attacks, body.pv-shell .screen.pay > p:has(> .link) { display: none !important; }
body.pv-shell .screen.company .vis-charts, body.pv-shell .screen.company .proofband, body.pv-shell .screen.company .records, body.pv-shell .screen.company > details, body.pv-shell .screen.company .acts.more a:not(.verifyl) { display: none !important; }
/* One column where the side panel was; the blocked card says it once. */
@media (min-width: 1200px) { body.pv-shell:not(.present) #main:has(> .screen.pay), body.pv-shell:not(.present) #main:has(> .screen.approve) { max-width: 640px; } }
body.pv-shell .screen.pay, body.pv-shell .screen.approve { grid-template-columns: 1fr !important; }
body.pv-shell .card.refusal > .sigl, body.pv-shell .card.refusal > .proof.xfer { display: none !important; }
/* The note that tried to give orders: said once, at the top, in amber (the page's own line below the button goes). */
body.pv-shell .screen.work .result > p.flagged { display: none !important; }
body:not(.pv-staged) .pv-stages.inmain { display: none !important; }
@media (max-width: 760px) { body.pv-shell .screen.start ol.flow { grid-template-columns: 1fr !important; } }
/* The note that tried to give orders: said plainly, in amber. */
body.pv-shell #main p.band { display: none !important; }
.pv-rd { font-weight: 600; opacity: .85; font-variant-numeric: tabular-nums; }
.pv-rd::before { content: "· "; }
.pv-verify { margin: 22px 0; padding: 22px; border-radius: 18px; border: 1px solid var(--border); background: var(--surface); }
.pv-verify h2 { margin: 0; font: 750 22px/1.25 Inter, system-ui, sans-serif; }
.pv-verify .sub { margin: 6px 0 14px; color: var(--muted); }
.pv-verify ol { list-style: none; margin: 0 0 16px; padding: 0; display: grid; gap: 12px; }
.pv-verify li { display: grid; grid-template-columns: 28px 1fr; gap: 10px; align-items: start; }
.pv-verify li .n { width: 26px; height: 26px; border-radius: 50%; display: grid; place-items: center; background: var(--ok-soft); color: var(--ok); font: 700 12px/1 Inter, system-ui, sans-serif; }
.pv-verify li b { display: block; font-weight: 700; }
.pv-verify li p { margin: 2px 0 0; color: var(--muted); font-size: 14px; line-height: 1.45; }
.pv-verify li a { display: inline-block; margin-top: 4px; font-size: 14px; font-weight: 600; }
.pv-verify .pv-all { display: inline-flex; }
.pv-verify .foot { margin: 12px 0 0; font-size: 12px; color: var(--muted); }
@media (max-width: 1199px) { body.pv-shell.pv-staged .awx-badge { display: none !important; } }
/* 16 Nov (Max): at laptop widths the money badge covered step 4; the steps take their short names there. */
@media (min-width: 1200px) and (max-width: 1599px) { .pv-stages:not(.inmain) .t { display: none; } .pv-stages:not(.inmain) .ts { display: inline; } }

/* Under the hood (16 Nov): a small dark code window in the step card; lines come in one by one. */
.pv-cap .pv-hood, .pv-cap .pv-usechip { grid-column: 1 / -1; }
.pv-cap .pv-hood b { font: 700 12.5px/1.3 Inter, system-ui, sans-serif; letter-spacing: .02em; }
.pv-hood { margin: 14px 0 0; border-radius: 12px; background: #0b0d14; border: 1px solid #ffffff1a; color: #e6e8f2; overflow: hidden; }
.pv-hood-h { display: flex; align-items: center; gap: 10px; padding: 8px 12px; border-bottom: 1px solid #ffffff12; font: 600 12px/1.3 Inter, system-ui, sans-serif; }
.pv-hood-h b { color: #fff; letter-spacing: .02em; }
.pv-hood-h span { color: #8b90a8; }
.pv-hood-h::before { content: ""; flex: none; width: 34px; height: 8px; background: radial-gradient(circle, #ff5f57 3.5px, transparent 4px) 0 0/12px 8px repeat-x; opacity: .9; }
.pv-hood-h b, .pv-hood-t { white-space: nowrap; }
.pv-hood-t { margin-left: auto; border: 0; background: #ffffff14; color: #e6e8f2; border-radius: 999px; padding: 3px 10px; font: 600 12px/1.3 Inter, system-ui, sans-serif; cursor: pointer; }
.pv-hood ol { display: none; list-style: none; margin: 0; padding: 10px 12px 12px; counter-reset: ln; }
.pv-hood.open ol { display: grid; gap: 5px; }
.pv-hood li { display: grid; grid-template-columns: 18px 1fr; column-gap: 8px; align-items: baseline; font: 500 12.5px/1.45 ui-monospace, "SF Mono", Menlo, Consolas, monospace; counter-increment: ln; }
.pv-hood li::before { content: counter(ln); width: 14px; color: #5b6078; text-align: right; }
.pv-hood code { color: #c9d1ff; font: inherit; white-space: pre-wrap; word-break: break-word; }
.pv-hood .nt { grid-column: 2; color: #7f8aa6; font-size: 11.5px; }
.pv-hood li.ok code { color: #6ee7a8; } .pv-hood li.bad code { color: #ff8a8a; } .pv-hood li.warn code { color: #f5c06a; }
.pv-hood.fresh li { animation: hoodIn .42s cubic-bezier(.2,.7,.2,1) both; animation-delay: calc(var(--i) * 220ms + 150ms); }
@keyframes hoodIn { from { opacity: 0; transform: translateX(-6px); filter: blur(2px); } to { opacity: 1; transform: none; filter: none; } }
@media (prefers-reduced-motion: reduce) { .pv-hood.fresh li { animation: none; } }
@media (max-width: 700px) { .pv-hood-h span { display: none; } .pv-hood-h::before { flex: none; } .pv-hood li { font-size: 11.5px; } }
.pv-hood li.cur code { color: #c9d1ff; animation: hoodBlink 1s steps(2) infinite; }
@keyframes hoodBlink { 50% { opacity: 0; } }
/* Motion (16 Nov, CSS only): the seal stamps on when paid, the refused line pulses, the code window settles in. */
@media (prefers-reduced-motion: no-preference) {
  body.pv-shell .screen.books .paidstamp .hashpill[data-v2] { animation: sealStamp .75s cubic-bezier(.2,.8,.2,1) .25s both, sealGlow 2.2s ease-out 1s 1; }
  body.pv-shell .screen.books .paidstamp .ring { animation: sealRing .9s cubic-bezier(.2,.8,.2,1) both; }
  .pv-hood.fresh li.bad:last-child code { animation: hoodBad 1.1s ease-out 1.1s 2; }
  .pv-hood.fresh li.ok code { animation: hoodOk 1s ease-out .9s 1; }
  .pv-cap.in .pv-caprow { animation: mvUp .5s cubic-bezier(.2,.8,.2,1) .15s both; }
}
@keyframes sealStamp { 0% { opacity: 0; transform: scale(1.7) rotate(-6deg); } 60% { opacity: 1; transform: scale(.94) rotate(1deg); } 100% { transform: none; } }
@keyframes sealGlow { 0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--ok) 60%, transparent); } 100% { box-shadow: 0 0 0 14px transparent; } }
@keyframes sealRing { 0% { transform: scale(.6); opacity: 0; } 70% { transform: scale(1.12); opacity: 1; } 100% { transform: none; } }
@keyframes hoodBad { 0%, 100% { background: transparent; } 30% { background: #ff6b6b33; } }
@keyframes hoodOk { 0%, 100% { background: transparent; } 30% { background: #6ee7a826; } }
.pv-word { color: #14171f; font: 700 13px/1 Inter, system-ui, sans-serif; letter-spacing: -.01em; }

/* The step card's last row (16 Nov, no sidebar): Claude's usage on the left; the money line and How it works on the right. */
.pv-cap .pv-caprow { grid-column: 1 / -1; display: flex; flex-wrap: wrap; align-items: flex-start; gap: 8px 12px; margin: 12px 0 0; padding-top: 10px; border-top: 1px solid var(--border); }
.pv-cap .pv-caprow .pv-usechip { margin: 0; padding: 0; border: 0; flex: 1 1 260px; }
.pv-meta { display: flex; align-items: center; gap: 8px; margin-left: auto; }
.pv-meta .pv-sm { padding: 5px 11px; border-radius: 999px; background: var(--ok-soft); color: var(--ok); font: 650 12px/1.2 Inter, system-ui, sans-serif; white-space: nowrap; }
.pv-meta .pv-howbtn { margin: 0; padding: 5px 11px; font-size: 12px; white-space: nowrap; }
body.pv-shell:not(.present) > .pv-money { display: none !important; }
body.present .pv-meta .pv-sm { display: none; }
@media (max-width: 699px) { .pv-meta .pv-howbtn { display: none; } }
@media (min-width: 900px) { .pv-stages.inmain .t { display: inline; } .pv-stages.inmain .ts { display: none; } }
.pv-stages li.notneeded { opacity: .45; text-decoration: line-through; }
/* The Live Engine rail (16 Nov): read-only; 310 px beside a 640 px step column from 1280 px; a drawer below that. */
.pv-rail { display: none; border: 1px solid var(--border); border-radius: 16px; background: var(--surface); font: 500 13px/1.4 Inter, system-ui, sans-serif; color: var(--text); }
body.pv-shell.pv-staged .pv-rail { display: block; }
.pv-rail-h { display: flex; align-items: center; gap: 8px; width: 100%; padding: 11px 14px; border: 0; background: none; color: var(--text); font: inherit; cursor: pointer; text-align: left; }
.pv-rail-h b { font-weight: 750; letter-spacing: .01em; }
.pv-rail-h .dot { flex: none; width: 8px; height: 8px; border-radius: 50%; background: var(--ok); }
.pv-rail-h .sum { margin-left: auto; color: var(--muted); font-variant-numeric: tabular-nums; }
.pv-rail-h::after { content: "\\25BE"; color: var(--muted); }
.pv-rail.open .pv-rail-h::after { content: "\\25B4"; }
.pv-rail-b { display: none; padding: 0 12px 12px; }
.pv-rail.open .pv-rail-b { display: grid; gap: 10px; }
.pv-rail .pv-meta { margin: 0; flex-wrap: wrap; justify-content: space-between; gap: 6px; }
.pv-rail, .pv-rail * { min-width: 0; box-sizing: border-box; }
.pv-rail.open .pv-rail-b, .pv-rail.side .pv-rail-b { grid-template-columns: minmax(0, 1fr); }
.pv-rail .pv-hood-h > span { display: none; }
.pv-rail .pv-hood li { grid-template-columns: 16px minmax(0, 1fr); font-size: 11.5px; }
.pv-rail .pv-hood code { overflow-wrap: anywhere; }
.pv-rail .pv-m-agents li span, .pv-rail .pv-m-rails li span { display: block; overflow-wrap: anywhere; }
.pv-rail .pv-m-rails li > div { flex: 1 1 auto; }
.pv-mod { padding: 12px; border-radius: 12px; border: 1px solid var(--border); background: color-mix(in srgb, var(--text) 3%, var(--surface)); }
.pv-mod h3 { display: flex; align-items: center; gap: 6px; margin: 0 0 8px; font: 700 11px/1.2 Inter, system-ui, sans-serif; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); }
.pv-m-hood:empty { display: none; }
.pv-m-hood .pv-hood { margin: 0; }
.pv-m-claude .sp { color: #d97757; }
.pv-m-claude .tot { font: 760 26px/1.1 Inter, system-ui, sans-serif; font-variant-numeric: tabular-nums; }
.pv-m-claude .sub { margin-top: 2px; color: var(--muted); font-size: 12px; }
.pv-m-claude details { margin-top: 8px; }
.pv-m-claude summary { cursor: pointer; color: var(--accent); font-size: 12px; font-weight: 650; }
.pv-m-claude ol { list-style: none; margin: 6px 0 0; padding: 0; display: grid; gap: 6px; }
.pv-m-claude li { display: grid; grid-template-columns: 1fr auto; gap: 0 8px; font-size: 12px; }
.pv-m-claude li .c { font-weight: 650; font-variant-numeric: tabular-nums; }
.pv-m-claude li .m { grid-column: 1 / -1; color: var(--muted); font: 500 10.5px/1.35 ui-monospace, SFMono-Regular, Menlo, monospace; }
.pv-m-claude li .w { grid-column: 1 / -1; color: var(--text); font-size: 11.5px; line-height: 1.35; }
.pv-m-claude .x { margin: 8px 0 0; color: var(--muted); font-size: 12px; font-weight: 650; }
.pv-m-claude .x.ok { color: var(--ok); }
.pv-m-agents .mode { display: inline-block; margin-bottom: 8px; padding: 4px 10px; border-radius: 999px; background: color-mix(in srgb, var(--text) 8%, transparent); font-size: 12px; font-weight: 650; }
.pv-m-agents .mode.ok { background: var(--ok-soft); color: var(--ok); }
.pv-m-agents .mode.warn { background: color-mix(in srgb, #f5b544 18%, transparent); color: #c98a00; }
@media (prefers-color-scheme: dark) { .pv-m-agents .mode.warn { color: #f5b544; } }
.pv-m-agents ol { list-style: none; margin: 0; padding: 0; display: grid; gap: 7px; }
.pv-m-agents li { position: relative; padding-left: 22px; }
.pv-m-agents li b { display: block; font-size: 13px; }
.pv-m-agents li span { color: var(--muted); font-size: 12px; }
.pv-m-agents li::before { content: ""; position: absolute; left: 3px; top: 4px; width: 10px; height: 10px; border-radius: 50%; border: 2px solid var(--border); box-sizing: border-box; }
.pv-m-agents li.done::before { background: var(--ok); border-color: var(--ok); }
.pv-m-agents li.cur::before { border-color: var(--accent); background: var(--accent); }
.pv-m-agents li.wait::before { border-color: #f5b544; }
.pv-m-agents li.bad::before { background: var(--bad); border-color: var(--bad); }
.pv-m-agents li.bad span { color: var(--bad); }
.pv-m-rails ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
.pv-m-rails li { display: flex; align-items: center; gap: 12px; padding: 6px 0; }
.pv-m-rails li > div { opacity: .7; transition: opacity .3s ease; }
.pv-m-rails li.on > div { opacity: 1; }
.pv-m-rails li b { display: block; font-size: 12.5px; }
.pv-m-rails li span { color: var(--muted); font-size: 11.5px; }
.pv-m-rails .hw-logo { flex: none; width: 96px; height: auto; min-height: 28px; padding: 5px 8px; justify-content: center; box-sizing: border-box; }
.pv-m-rails .hw-logo img { height: auto; max-height: 14px; max-width: 100%; }
.pv-m-rails .hw-logo.hw-alta img { width: auto; height: 16px; max-height: 16px; margin: 0 auto; } /* 16 Nov: the SVG's own width sat it to the left */
.pv-m-rails .pv-word, .pv-rail .pv-m-rails li span.pv-word { font-size: 10.5px; line-height: 1.2; white-space: normal; text-align: center; color: #14171f; font-weight: 700; display: inline-flex; }
.pv-m-rails li.on .hw-logo { box-shadow: 0 0 0 2px var(--ok); }
@media (prefers-reduced-motion: no-preference) { .pv-m-agents li.cur::before { animation: mvDot 1.6s infinite; } .pv-rail-h .dot { animation: mvDot 2.2s infinite; } }
@media (min-width: 1280px) {
  body.pv-shell.pv-staged #main { max-width: 640px !important; margin-left: max(16px, calc(50% - 525px)) !important; margin-right: auto !important; }
  body.pv-shell.pv-staged .pv-rail.side { position: fixed; z-index: 30; top: 76px; left: min(calc(50% + 185px), calc(100% - 326px)); width: 310px; max-height: calc(100vh - 92px); overflow: auto; }
  .pv-rail.side .pv-rail-h { pointer-events: none; }
  .pv-rail.side .pv-rail-h::after { content: none; }
  .pv-rail.side .pv-rail-b { display: grid; gap: 10px; }
}
@media (max-width: 1279px) { .pv-rail { margin: 0 0 16px; } }
/* 16 Nov (Max: "things out of the text box"): in the v2 frame the work, approve and pay screens are one column (the
   old two-column grid kept a right column for a panel the frame hides, and squeezed the answer and its button). */
body.pv-shell .screen.work, body.pv-shell .screen.approve, body.pv-shell .screen.pay { display: flex !important; flex-direction: column; }
body.pv-shell .screen.work > .card, body.pv-shell .screen.approve > .card, body.pv-shell .screen.pay > .card { grid-column: auto; grid-row: auto; margin-top: 16px; }
body.pv-shell .screen.work .payrow .btn { white-space: nowrap; }
body.pv-shell .screen.company .cmdl { display: block !important; flex-basis: 100%; order: 9; margin: 2px 0 0; font-size: 12.5px; color: var(--muted); overflow-wrap: anywhere; }
/* The inbox in the 640 px column: four columns (the due date is in the invoice), risk chips may wrap. */
@media (min-width: 721px) {
  body.pv-shell .ihead, body.pv-shell .samples.inbox .btn.row { grid-template-columns: minmax(0, 1fr) 92px 116px 118px; column-gap: 12px; }
  body.pv-shell .samples.inbox .amt { white-space: nowrap; }
  body.pv-shell .ihead .due, body.pv-shell .samples.inbox .due { display: none; }
  body.pv-shell .samples.inbox .rchip { white-space: nowrap; font-size: 11.5px; }
  body.pv-shell .samples.inbox .no { white-space: nowrap; font-size: 12px; }
}
.pv-cap.workAlone .k, .pv-cap.booksAlone .k { background: var(--ok); color: #04130d; }
.pv-cap.workAlone, .pv-cap.booksAlone { border-color: color-mix(in srgb, var(--ok) 45%, var(--border)); background: linear-gradient(135deg, color-mix(in srgb, var(--ok) 12%, var(--surface)), var(--surface) 70%); }
.pv-lock2 { margin: 10px 0 0; padding: 10px 12px; border-radius: 10px; background: var(--accent-soft); font-size: 13.5px; line-height: 1.45; }
.pv-warn.small { padding: 10px 14px; }
.pv-warn.small p { font-size: 13px; }
.pv-warn { margin: 0 0 14px; padding: 14px 16px; border-radius: 14px; border: 1px solid color-mix(in srgb, #f5b544 55%, var(--border)); background: color-mix(in srgb, #f5b544 12%, var(--surface)); }
.pv-warn b { display: block; color: #b87500; font: 750 16px/1.3 Inter, system-ui, sans-serif; }
.pv-warn b::before { content: "⚠  "; }
.pv-warn p { margin: 6px 0 0; color: var(--text); font: 500 14.5px/1.45 Inter, system-ui, sans-serif; }
@media (prefers-color-scheme: dark) { .pv-warn b { color: #f5b544; } }
/* The four stages and Claude's usage at the top of the page, on every screen (16 Nov: no sidebar). */
.pv-stages .ts, .pv-usechip { display: none; }
@media all {
  .pv-stages.inmain { display: flex; justify-content: space-between; gap: 4px; margin: 4px 0 10px; padding: 8px 10px; list-style: none; border-radius: 14px; border: 1px solid var(--border); background: var(--surface); }
  .pv-stages.inmain li { height: auto; padding: 4px 6px; gap: 6px; font-size: 12.5px; }
  .pv-stages.inmain li + li::before { display: none; }
  .pv-stages.inmain .t { display: none; }
  .pv-stages.inmain .ts { display: inline; }
  .pv-stages.inmain .n { width: 20px; height: 20px; font-size: 11px; }
  .pv-cap .pv-usechip { display: block; margin: 0; padding-top: 0; font: 500 13px/1.35 Inter, system-ui, sans-serif; }
  .pv-usechip summary { display: flex; align-items: center; gap: 8px; padding: 0; cursor: pointer; list-style: none; color: var(--muted); }
  .pv-usechip summary::-webkit-details-marker { display: none; }
  .pv-usechip summary b { color: var(--text); font-weight: 700; }
  .pv-cap .pv-usechip b, .pv-cap .pv-usechip span { display: inline; margin: 0; font: inherit; font-size: 13px; }
  .pv-cap .pv-usechip summary b { font-weight: 700; }
  .pv-usechip summary .sp { color: #d97757; }
  .pv-usechip ol { list-style: none; margin: 0; padding: 8px 0 0; display: grid; gap: 4px; }
  .pv-usechip li { display: flex; justify-content: space-between; gap: 8px; color: var(--muted); font-variant-numeric: tabular-nums; }
  .pv-usechip li b { color: var(--text); font-weight: 600; }
}
`;

/**
 * 17 Nov (jury: "show the agent's judgement"): one line per Claude call in "Each call": what its agent decided and why,
 * from the engine's own decision event (ap.checker_decided, ap.payer_proposed, ap.coded: the agent's reason, its first
 * sentence, as the engine's event list already masks it), matched to the call by Anthropic's request id. No new call,
 * no new route. At most 120 characters; the page sets it as text, never as HTML. Null when there is nothing to say.
 */
export const callSaid = (event: string, f: Record<string, unknown>): { req: string; said: string } | null => {
  const req = typeof f.request_id === "string" ? f.request_id : "";
  const reason = typeof f.reason === "string" ? f.reason.replace(/\s+/g, " ").trim() : "";
  if (!req || !reason) return null;
  const what = event === "ap.checker_decided" ? (typeof f.action === "string" ? f.action : "")
    : event === "ap.payer_proposed" ? [f.rail, f.pay_on].filter((x) => typeof x === "string" && x !== "").join(" · ")
    : event === "ap.coded" ? (typeof f.account === "string" && f.account ? "book to " + f.account : "")
    : null;
  if (what === null) return null;
  const line = (what ? what.replace(/_/g, " ") + ": " : "") + reason;
  return { req, said: line.length > 120 ? line.slice(0, 119).trimEnd() + "\u2026" : line };
};

/**
 * 19 Nov 2026 (live review: "$0.0000 · 3 calls this run" over three agent runs that never reached Claude): the Claude
 * calls an engine event holds, or null. claude.read is the reader's answer, written only when Claude answered
 * (src/claude/reader.ts). agent.run is an agent's run (src/agents/loop.ts): its claude_ms lists each answered call's
 * time, so n is their number; without it, a run that spent something, carries a request id, or finished (done, or
 * incomplete: out of turns) held at least one. A run that never reached Claude (unavailable: no client, a cap, nothing
 * spent) holds none, and no other event is a call.
 */
export const claudeCall = (event: string, f: Record<string, unknown>): { n: number } | null => {
  if (event === "claude.read") return { n: 1 };
  if (event !== "agent.run") return null;
  const ms = typeof f.claude_ms === "string" ? f.claude_ms.split(",").filter((x) => /^\d+$/.test(x)).length : 0;
  if (ms > 0) return { n: ms };
  const cost = Number(f.cost_usd_micros);
  const req = typeof f.request_id === "string" && f.request_id !== "";
  return (Number.isFinite(cost) && cost > 0) || req || f.status === "done" || f.status === "incomplete" ? { n: 1 } : null;
};

/**
 * 19 Nov 2026: who read the invoice, from one engine event: sure from ap.received's read_by ("parser", or
 * "claude:<model>" / "claude-scan:<model>"); a hint, while the reading is under way, from claude.read (Claude answered),
 * claude.capped or claude.fallback (Purser's code reads). Null for any other event.
 */
export const readerOf = (event: string, f: Record<string, unknown>): { by: "claude" | "code"; sure: boolean } | null => {
  if (event === "ap.received") {
    const r = typeof f.read_by === "string" ? f.read_by : "";
    return r === "parser" ? { by: "code", sure: true } : /^claude(-scan)?:/.test(r) ? { by: "claude", sure: true } : null;
  }
  if (event === "claude.capped" || event === "claude.fallback") return { by: "code", sure: false };
  if (event === "claude.read") return { by: "claude", sure: false };
  return null;
};

const SHARED = String.raw`
// --- Shared by recording mode and the public page: the app shell, Claude's usage per call, "How Purser works". ---
const mk=(tag,cls,kids)=>{const e=document.createElement(tag);if(cls)e.className=cls;for(const k of [].concat(kids==null?[]:kids))e.append(k instanceof Node?k:document.createTextNode(String(k)));return e};
const CALLS=new Map();
// The agent's own line per call (callSaid, cloud/src/try/presentMode.ts), by Anthropic's request id.
const callSaid=__CALL_SAID__;const SAID=new Map();
// 19 Nov 2026 (live review): a call counts only when Claude answered (claudeCall); who read the invoice in this run is
// the engine's own word (readerOf), else the start's mode; and why live Claude did not read it (claude.capped's reason).
const claudeCall=__CLAUDE_CALL__;const readerOf=__READER_OF__;const pausedNotice=__PAUSED_NOTICE__;
const nCalls=(cs)=>cs.reduce((x,c)=>x+(Number(c.n)||1),0);
const READ={by:'',sure:false,why:''};
try{const r=JSON.parse(sessionStorage.getItem('purser.read')||'null');if(r&&(r.by==='claude'||r.by==='code')){READ.by=r.by;READ.sure=!!r.sure;READ.why=typeof r.why==='string'&&Object.prototype.hasOwnProperty.call(PC.caps,r.why)?r.why:''}}catch(e){}
const keepRead=()=>{try{sessionStorage.setItem('purser.read',JSON.stringify(READ))}catch(e){}};
function noteRead(e,f){const ev=String(e.event||'');if(ev==='claude.capped'&&typeof f.reason==='string'&&Object.prototype.hasOwnProperty.call(PC.caps,f.reason)&&READ.why!==f.reason&&!(READ.sure&&READ.by==='claude')){READ.why=f.reason;keepRead()}
  const r=readerOf(ev,f);if(!r||(READ.sure&&!r.sure))return;if(READ.by!==r.by||READ.sure!==r.sure){READ.by=r.by;READ.sure=r.sure;if(r.by==='claude')READ.why='';keepRead()}}
const forgetRead=()=>{READ.by='';READ.sure=false;READ.why='';keepRead()};
const modeOf=()=>{let st={};try{st=JSON.parse(sessionStorage.getItem('purser.try')||'{}')||{}}catch(e){}return st.mode&&typeof st.mode==='object'?(st.mode.claude==='live'?'claude':'code'):''};
const readerIs=()=>READ.by||modeOf();
// The notice in the main flow when live Claude did not read this invoice (Max, 19 Nov): never when Claude read it.
const pausedText=(done)=>readerIs()==='code'?pausedNotice(READ.why||(modeOf()==='code'?'mode_code':''),done,PC.caps):'';
const chip=mk('details','pv-usechip',[mk('summary',''),mk('ol','')]);
const capMeta=mk('div','pv-meta');
// The Live Engine rail (16 Nov, Max): read-only, beside the step on a wide screen and a drawer under it on a smaller one.
// Every row is the run's own state: Claude's calls from the engine's events, the agents' stage from the screen, the code
// window, the partner rails engaged in this run (or the recorded run, said so). No navigation in it.
const rail=mk('aside','pv-rail');rail.setAttribute('aria-label','Live engine');
const railHead=mk('button','pv-rail-h',[mk('span','dot',''),mk('b','','Live engine'),mk('span','sum','')]);railHead.type='button';railHead.setAttribute('aria-expanded','false');
railHead.addEventListener('click',()=>{const o=!rail.classList.contains('open');rail.classList.toggle('open',o);railHead.setAttribute('aria-expanded',String(o))});
const rClaude=mk('section','pv-mod pv-m-claude'),rAgents=mk('section','pv-mod pv-m-agents'),rHood=mk('section','pv-mod pv-m-hood'),rRails=mk('section','pv-mod pv-m-rails');
rail.append(railHead,mk('div','pv-rail-b',[capMeta,rClaude,rAgents,rHood,rRails]));
// Claude's calls kept across reloads in this tab (the run's own tally, Step 1 to the end).
try{const kept=JSON.parse(sessionStorage.getItem('purser.calls')||'[]');if(Array.isArray(kept))for(const [k,v] of kept)if(typeof k==='number'&&v&&typeof v==='object')CALLS.set(k,v)}catch(e){}
const keepCalls=()=>{try{sessionStorage.setItem('purser.calls',JSON.stringify([...CALLS.entries()].slice(-40)))}catch(e){}};
const PAYAT={seq:-1,tried:false};
// The engine's own flag on a document that tries to give orders (document.injection_flagged), since the last filing.
const INJ={since:-1,flag:false,max:0};
const EVT=[];
function noteEvent(e){if(e&&typeof e.seq==='number'&&e.seq>INJ.since&&!EVT.some((x)=>x.seq===e.seq)){EVT.push({seq:e.seq,event:String(e.event||''),f:e.fields&&typeof e.fields==='object'?e.fields:{}});EVT.sort((a,b)=>a.seq-b.seq);if(EVT.length>60)EVT.splice(0,EVT.length-60)}
  if(e&&typeof e.seq==='number'){if(e.seq>INJ.max)INJ.max=e.seq;if(e.event==='document.injection_flagged'&&e.seq>INJ.since)INJ.flag=true;if(e.seq>INJ.since)noteRead(e,e.fields&&typeof e.fields==='object'?e.fields:{})}}
function noteFiling(p,m){if(m==='POST'&&/^\/v1\/engine\/(compose$|samples\/)/.test(p)){INJ.since=INJ.max;INJ.flag=false;EVT.length=0;forgetRead()}}
const usd=(m)=>'$'+(m/1e6).toFixed(4);
const title=(s)=>String(s||'').replace(/[^a-z0-9 _-]/gi,'').replace(/[_-]+/g,' ').replace(/\b\w/g,(c)=>c.toUpperCase());
const modelName=(m)=>{const x=/^claude-([a-z]+)-(\d+)-(\d+)/.exec(String(m||''));return x?title(x[1])+' '+x[2]+'.'+x[3]:''};
// One Claude call from the engine's own events (claude.read: the invoice reader; agent.run: an agent's run).
function takeSaid(e,f){const s=callSaid(String(e.event||''),f);if(!s)return;SAID.set(s.req,s.said);for(const c of CALLS.values())if(c.req===s.req&&c.said!==s.said){c.said=s.said;keepCalls()}}
function takeCall(e,f){takeSaid(e,f);const cc=claudeCall(String(e.event||''),f);if(cc&&!CALLS.has(e.seq)){const c=Number(f.cost_usd_micros);if(isFinite(c)&&c>=0)CALLS.set(e.seq,{who:e.event==='claude.read'?PC.shell.reader:title(f.agent),n:cc.n,model:modelName(f.model),cost:c,ms:Number(f.latency_ms)||0,req:typeof f.request_id==='string'&&/^req_[A-Za-z0-9]{6,64}$/.test(f.request_id)?f.request_id:'',tin:Number(f.input_tokens)||0,tout:Number(f.output_tokens)||0});keepCalls()}}
const SHELL=new URLSearchParams(location.search).get('shell')!=='0';
const SH=PC.shell;let useBox=null;
// "How Purser works": the flow in five steps, and the whole system's map (the README's), as a card over the page.

// The partners' proof (Metal and Visa awards): three cards from recorded runs, each a link; and the way to all of it.
function partners(withHead){
  const P=PC.partners;const a=(href,text,cls)=>{const l=mk('a',cls||'',text);l.href=href;l.target='_blank';l.rel='noopener';return l};
  const cards=mk('div','pp-cards',P.cards.map((c)=>mk('article','pp-card',[mk('div','pp-top',[c.logo?logoChip(c.logo):c.word?mk('span','hw-logo pv-word',c.word):null,mk('span','pp-l',c.label)].filter(Boolean)),mk('b','',c.h),mk('p','',c.p),a(c.href,c.link+' →','pp-a')])));
  const foot=mk('div','pp-foot',[a(P.allHref,P.all+' →','btn primary pp-all'),mk('span','pp-note',P.foot)]);
  return mk('section','pp',(withHead?[mk('h2','',P.heading),mk('p','pp-sub',P.sub)]:[]).concat([cards,foot]));
}
const H=PC.how;
const logoChip=(k)=>{const i=document.createElement('img');i.src=PC.logos[k].src;i.alt=PC.logos[k].alt;i.width=PC.logos[k].w;i.height=PC.logos[k].h;return mk('span','hw-logo hw-'+k,i)};
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
const stages=mk('ol','pv-stages',PC.stages.map((t,i)=>mk('li','',[mk('span','n',String(i+1)),mk('span','t',t),mk('span','ts',PC.stagesShort[i])])));
document.body.append(stages);
document.body.prepend(mk('div','pv-aurora',''));
const aloneRun=()=>{try{const st=JSON.parse(sessionStorage.getItem('purser.try')||'{}');return !!(st&&st.proposal&&st.proposal.alone)}catch(e){return false}};
function stageOf(){const m=document.getElementById('main');if(!m)return -1;const has=(c)=>!!m.querySelector('.screen.'+c);
  if(has('start'))return -1;if(has('invoice')||has('work'))return 0;if(has('approve'))return 1;if(has('books'))return 2;if(has('pay'))return m.querySelector('.refusal')?4:3;if(has('company')||has('did'))return 4;return -1}
const cap=mk('div','pv-cap',[mk('span','k',''),mk('b','',''),mk('span','d','')]);cap.setAttribute('role','status');
function guideKey(){const m=document.getElementById('main');if(!m)return '';const has=(c)=>!!m.querySelector('.screen.'+c);
  if(has('invoice'))return 'invoice';if(has('work')){if(m.querySelector('.screen.work .skel'))return 'reading';if(m.querySelector('.screen.work .why.cashctx'))return 'workCash';const pb=m.querySelector('.screen.work .payrow .btn');if(!pb)return '';const pt=(pb.textContent||'').trim();return pt===PC.payAlone||pt===PC.payingAlone?'workAlone':INJ.flag?'workInj':'work'}if(has('approve'))return 'approve';if(has('books'))return aloneRun()?'booksAlone':'books';
  if(has('pay'))return m.querySelector('.card.refusal')?'refused':'pay';if(has('company')||has('did'))return 'done';return ''}

// "Under the hood": the step's real flow in a few lines, this run's own values filled in as they appear.
const HOOD={fp:'',amount:'',payee:'',iban:'',due:'',open:innerWidth>=1200};
const hoodBox=mk('div','pv-hood');
function hoodLines(g,m){const C=[...CALLS.values()];const rd=C.find((c)=>c.who===PC.shell.reader);const n=nCalls(C);const code=readerIs()==='code';const readNote=rd?'':code?'what Purser’s code read · Claude not asked':'what Claude read';const usdS=(x)=>usd(x);
  const q=(v)=>v?'"'+v+'"':'…';const L=[];const c=(code,note,cls)=>L.push({code,note,cls});
  let st={};try{st=JSON.parse(sessionStorage.getItem('purser.try')||'{}')||{}}catch(e){}
  const pr=st.proof&&typeof st.proof==='object'?st.proof:null;const sha=(st.proposal&&typeof st.proposal.terms_sha256==='string'?st.proposal.terms_sha256:'')||(pr&&pr.terms_sha256)||'';
  const s12=(x)=>typeof x==='string'&&x?x.slice(0,12)+'…':'…';
  const inv=()=>{const o={};for(const r of m.querySelectorAll('.screen.work .card.inv dl > div')){const k=(r.children[0]||{}).textContent||'';const v=((r.children[1]||{}).textContent||'').trim();if(/Supplier/.test(k))o.supplier=v;if(/Invoice number/.test(k))o.number=v;if(/Amount/.test(k))o.amount=v;if(/Due/.test(k))o.due=v}return o};
  const amt=(v)=>{const mm=/([A-Z]{3})\s*([\d,]+\.\d{2})/.exec(v||'');return mm?{cur:mm[1],n:mm[2].replace(/,/g,'')}:null};
  if(g==='invoice'){c('invoice = inbox.receive(pdf)','a supplier\'s invoice arrives');if(code)c('reading = parser.read(pdf)','Purser’s code reads it: Claude is not asked in this run');else c('agent = claude.agent("payables")','an AI agent picks it up')}
  else if(g==='reading'){const lab={'ap.received':'inbox.receive(pdf) → sha256 of the file','claude.asking':'claude.read(invoice) …','claude.read':'claude.read(invoice) ✓','claude.capped':'claude.read(invoice) → not asked','claude.fallback':'parser.read(invoice) ✓','document.injection_flagged':'findInjections(text) → found, ignored','agent.tool':'agent.check()','agent.run':'agent.decide()','ap.checker_decided':'checker.decide() ✓','ap.coded':'ledger.code(invoice) ✓','ap.payer_proposed':'payer.propose() ✓','fx.rate_checked':'treasury.rate() ✓','airwallex.quote':'airwallex.quote() ✓','invoice.escalated':'escalate(CFO)','invoice.fraud_suspected':'fraud check → held','ap.status':'invoice.status()','proposal.within_limit':'approveWithinLimit() → policy ✓','transfer.created':'transfer.created ✓','proposal.executed':'proposal.executed ✓'};
    const seen=[];for(const e of EVT){const l=lab[e.event];if(!l)continue;const tool=e.event==='agent.tool'&&typeof e.f.tool==='string'?'agent.'+e.f.tool+'()':l;const last=seen[seen.length-1];if(last&&last.code===tool){last.k++;continue}
      const who=e.event==='claude.capped'?'Claude not asked: '+(PC.caps[e.f.reason]||'its live budget is used'):e.event==='claude.fallback'?'Purser’s code read it':e.event==='agent.run'&&!claudeCall('agent.run',e.f)?'Claude not asked · code decides':typeof e.f.model==='string'?modelName(e.f.model):'';seen.push({code:tool,k:1,note:e.event==='claude.read'&&rd?(rd.model||'Claude')+(rd.ms?' · '+(rd.ms/1000).toFixed(1)+' s':'')+' · '+usdS(rd.cost):who,cls:e.event==='document.injection_flagged'?'bad':/✓/.test(tool)?'ok':''})}
    for(const x of seen.slice(-7))c(x.code+(x.k>1?' ×'+x.k:''),x.note,x.cls);if(!seen.length)c('waiting for the engine…','the first step arrives in a moment');c('▍','','cur')}
  else if(g==='work'||g==='workInj'){const o=inv();const a=amt(o.amount);
    c('reading = '+JSON.stringify({supplier:o.supplier||'…',invoice:o.number||'…',amount:a?a.n:'…',currency:a?a.cur:'…',due:o.due||'…'}),rd?'Claude '+(rd.model?'· '+rd.model+' ':'')+(rd.ms?'· '+(rd.ms/1000).toFixed(1)+' s ':'')+'· '+usdS(rd.cost):readNote);
    if(g==='workInj')c('findInjections(text) → 1 found','an order to the AI: logged, ignored','bad');
    c('checks = [notPaidBefore ✓, ibanOnFile ✓, knownSupplier ✓]','code checks it, not the AI','ok');
    if(a&&PC.limit)c('amount <= agent_limit  →  '+a.n+' <= '+PC.limit+'  →  '+(Number(a.n)<=Number(PC.limit)?'true':'false'),Number(a.n)<=Number(PC.limit)?'the agent may pay it alone':'above the limit: the CFO decides',Number(a.n)<=Number(PC.limit)?'ok':'warn');
    else c('limitRule(amount) → ask_cfo','above the agent’s limit: the CFO decides','warn');
    if(n)c('// '+n+' Claude call'+(n===1?'':'s')+' so far · '+usdS(C.reduce((x,y)=>x+y.cost,0)),'');else if(code)c('// no Claude call in this run','')}
  else if(g==='workAlone'){const o=inv();const a=amt(o.amount);
    c('reading = '+JSON.stringify({supplier:o.supplier||'…',invoice:o.number||'…',amount:a?a.n:'…',currency:a?a.cur:'…'}),rd?'Claude '+(rd.model?'· '+rd.model+' ':'')+'· '+usdS(rd.cost):readNote);
    c('checks = [notPaidBefore ✓, ibanOnFile ✓, knownSupplier ✓]','code checks it, not the AI','ok');
    if(a)c('amount <= agent_limit  →  '+a.n+' <= '+PC.limit+'  →  true','inside the limit','ok');
    c('approveWithinLimit(terms) → method: "policy"','your policy approves it; no person, no signature','ok');c('payer.pay(terms)','the agent pays it now, on its own')}
  else if(g==='workCash'){const o=inv();const a=amt(o.amount);const v=[...m.querySelectorAll('.screen.work .why.cashctx .cmp dd')].map((d)=>(d.textContent||'').replace(/^[A-Z]{3}\s*/,'').trim());
    if(a)c('amount <= agent_limit  →  '+a.n+' <= '+PC.limit+'  →  true','inside the limit','ok');
    if(v.length>=6)c('available - payment >= floor  →  '+v[2]+' - '+v[4]+' >= '+v[3]+'  →  false','available after: '+v[5]+', below the floor','bad');
    c('enforceProposal(case, proposal: "pay now")  →  hold','code decides: a prompt is not a financial control','bad');
    c('airwallex.transfer(…)  →  not called','no transfer, nothing booked as paid','ok')}
  else if(g==='booksAlone'){let st={};try{st=JSON.parse(sessionStorage.getItem('purser.try')||'{}')||{}}catch(e){}const se=st.settled&&typeof st.settled==='object'?st.settled:{};
    const wl=EVT.find((e)=>e.event==='proposal.within_limit');
    c('audit: proposal.within_limit { method: "policy", limit: "'+(wl&&typeof wl.f.limit==='string'?wl.f.limit:'EUR '+PC.limit)+'" }','approved by your rules, not a person','ok');
    c('transfer → '+String(se.transfer_status||'PAID'),'test money, simulated bank');
    c('ledger.append(entry)'+(se.ledger_entries!==undefined?' · '+(Array.isArray(se.ledger_entries)?se.ledger_entries.length:se.ledger_entries)+' entries':''),'booked, hash-chained to the log','ok');
    c('invoice.status = "'+String(se.invoice_status||'paid')+'"','')}
  else if(g==='approve'){const pre=m.querySelector('.screen.approve pre.terms');const d=pre&&pre.closest('details');if(d&&!d.open&&!pre.textContent){d.open=true}
    let t=null;try{t=pre&&pre.textContent?JSON.parse(pre.textContent):null}catch(e){}
    if(t){const pick={};for(const k of ['amount','currency','beneficiary_name','iban_last4','invoice_no','due_date'])if(k in t)pick[k]=t[k];c('terms = '+JSON.stringify(pick),'the canonical payload (RFC 8785), part of it')}
    else c('terms = { amount: '+q(HOOD.amount)+', payee: '+q(HOOD.payee)+', iban: '+q(HOOD.iban)+' }','exactly what you see');
    c('sha256(canonical(terms)) = '+(sha?sha.slice(0,16)+'…':(HOOD.fp?HOOD.fp+'…':'…')),'one fingerprint for these exact terms');c('signature = faceId.sign(fingerprint)','your passkey, on this device','ok')}
  else if(g==='books'){c('verify(signature, '+s12(sha)+') ✓','the server checks your passkey signature','ok');
    const awx=st.awx&&typeof st.awx==='object'&&st.awx.source==='airwallex-sandbox'?st.awx:null;
    c('airwallex.transfer({ … metadata: { approval_sha256: '+s12(sha)+' } })',awx?'transfer '+String(awx.transfer_id).slice(0,8)+'… · '+String(awx.status||''):'Airwallex sandbox · test money');
    const lg=pr&&pr.ledger&&typeof pr.ledger==='object'?pr.ledger:null;c('ledger.append(entry) → head '+(lg&&lg.head?s12(lg.head):'…'),lg?lg.count+' entries, each hash-chained to the one before':'the books balance','ok')}
  else if(g==='pay'){c('changed = { ...terms, amount: '+(HOOD.amount?'+0.01':'…')+' }','one cent more');c('pay(changed, signature)','with the earlier approval')}
  else if(g==='refused'){const ask=pr&&pr.asked&&typeof pr.asked==='object'?pr.asked:null;const dec=pr&&pr.decision&&typeof pr.decision==='object'?pr.decision:null;
    const hs=[...m.querySelectorAll('.card.refusal .hashes p.hash')].map((p)=>{const t=(p.textContent||'');const l=(p.querySelector('.hl')||{}).textContent||'';return t.slice(l.length).trim()});
    const sa=hs[0]||(dec&&dec.signed_sha256)||sha,sb=hs[1]||(ask&&ask.sha256)||'';const newAmt=(()=>{const d=m.querySelector('.card.refusal .diff');const mm=d&&/([\d,]+\.\d{2})\s*$/.exec((d.textContent||'').trim());return mm?mm[1].replace(/,/g,''):''})();
    const am=(o)=>o&&o.terms&&typeof o.terms==='object'?String(o.terms.amount??''):'';
    if(pr&&am(pr))c('signed: { amount: "'+am(pr)+'" }  →  '+s12(sa),'what you approved');else c('signed  →  '+s12(sa),'what you approved');
    const na=(ask&&am(ask))||newAmt;if(na)c('asked:  { amount: "'+na+'" }  →  '+s12(sb),'one cent changed','bad');else c('asked   →  '+s12(sb),'the changed payment','bad');
    c(s12(sa)+' !== '+s12(sb)+'  →  refused · EUR 0.00 moved','the signature only fits the exact terms','bad')}
  else if(g==='done'){const lg=pr&&pr.ledger&&typeof pr.ledger==='object'?pr.ledger:null;c('audit_log: row_hash = sha256(prev_hash + row)','a later edit breaks the chain');if(lg&&lg.head)c('ledger head '+s12(lg.head)+' · '+lg.count+' entries','this company\'s books','ok');c('proof.json → verify in your browser','no need to trust us','ok')}
  return L}
function hood(m){const g=cap.dataset.k||'';const now=performance.now();if(g===HOOD.g&&now-(HOOD.t||0)<250)return;HOOD.t=now;HOOD.g=g;
  {const sh=m.querySelector('.screen.approve .receipt.sheet');if(sh){const hp=sh.querySelector('.hashpill');const t=hp&&(hp.title||hp.textContent||'');const mm=/[0-9a-f]{8,}/.exec(t);if(mm)HOOD.fp=mm[0].slice(0,12);
    const amt=sh.querySelector('.amount');if(amt)HOOD.amount=(amt.textContent||'').trim();
    for(const dt of sh.querySelectorAll('dt')){const k=(dt.textContent||'').trim();const v=dt.nextElementSibling?(dt.nextElementSibling.textContent||'').trim():'';if(k==='Payee')HOOD.payee=v;if(k==='IBAN')HOOD.iban='…'+v.replace(/\s/g,'').slice(-4)}}}
  if(!g||!cap.classList.contains('on')){hoodBox.remove();return}
  if(hoodBox.parentElement!==rHood)rHood.append(hoodBox);
  const L=hoodLines(g,m);if(!L.length){hoodBox.remove();return}const key=g+'|'+L.map((x)=>x.code+x.note).join('|');if(hoodBox.dataset.k===key)return;const fresh=hoodBox.dataset.g!==g;hoodBox.dataset.k=key;hoodBox.dataset.g=g;
  const tog=mk('button','pv-hood-t',HOOD.open?PC.hood.hide:PC.hood.show);tog.type='button';tog.addEventListener('click',()=>{HOOD.open=!HOOD.open;hoodBox.classList.toggle('open',HOOD.open);tog.textContent=HOOD.open?PC.hood.hide:PC.hood.show});
  const ol=mk('ol','',L.map((x,i)=>{const li=mk('li',x.cls||'',[mk('code','',x.code),x.note?mk('span','nt','// '+x.note):null].filter(Boolean));li.style.setProperty('--i',String(i));return li}));
  hoodBox.className='pv-hood'+(HOOD.open?' open':'')+(fresh?' fresh':'');hoodBox.replaceChildren(mk('div','pv-hood-h',[mk('b','',PC.hood.h),mk('span','',PC.hood.tag),tog]),ol)}
// The rail's modules, from the run's own state (no number here that the engine did not report).
function railDraw(){const g=cap.dataset.k||'';const calls=[...CALLS.entries()].sort((a,b)=>a[0]-b[0]);const tot=calls.reduce((x,[,c])=>x+c.cost,0);
  if((g==='pay'||g==='refused')&&PAYAT.seq<0)PAYAT.seq=INJ.max;if(g!=='pay'&&g!=='refused'&&g!=='done'){PAYAT.seq=-1;PAYAT.tried=false}
  // 19 Nov 2026 (live review): the extra calls since the change are said only once the change was tried (the refusal).
  if(g==='refused')PAYAT.tried=true;
  const N=nCalls(calls.map(([,c])=>c));const code=readerIs()==='code';
  const extra=PAYAT.seq>=0?nCalls(calls.filter(([s])=>s>PAYAT.seq).map(([,c])=>c)):-1;
  railHead.querySelector('.sum').textContent=N?usd(tot)+' · '+N+(N===1?' call':' calls'):code?'no Claude call · code read it':'no Claude call yet';
  // The Airwallex transfer's status is in the key: "Sandbox: move to PAID" changes it after the paid screen is drawn.
  let st={};try{st=JSON.parse(sessionStorage.getItem('purser.try')||'{}')||{}}catch(e){}const awx=st.awx&&typeof st.awx==='object'?st.awx:null;
  const key=JSON.stringify([g,N,tot,extra,PAYAT.tried,code,INJ.flag,aloneRun(),awx&&awx.status||'']);if(rail.dataset.k===key)return;rail.dataset.k=key;
  // 1. Claude: the run's cumulative cost, its calls, each with model, tokens, time and Anthropic's request id.
  const list=mk('ol','',calls.slice(-10).reverse().map(([,c])=>mk('li','',[mk('b','',c.who+(c.model?' · '+c.model:'')),mk('span','c',usd(c.cost)),mk('span','m',[c.tin||c.tout?(c.tin+c.tout)+' tokens':'',c.ms?(c.ms/1000).toFixed(1)+' s':'',c.req?c.req.slice(0,10)+'…'+c.req.slice(-4):''].filter(Boolean).join(' · ')),...((c.said||SAID.get(c.req))?[mk('span','w',String(c.said||SAID.get(c.req)))]:[])])));
  const det=mk('details','',[mk('summary','','Each call'),list]);
  rClaude.replaceChildren(mk('h3','',[mk('span','sp','✦'),'Claude · live cost & calls']),mk('div','tot',calls.length?usd(tot):'$0.0000'),mk('div','sub',N?N+(N===1?' call':' calls')+' this run':code?'Not asked in this run: Purser’s code read the invoice':'No Claude call yet'),...(calls.length?[det]:[]),...(PAYAT.tried&&extra>=0?[mk('p','x'+(extra===0?' ok':''),extra===0?'0 extra calls · blocked locally by SHA-256':extra+' extra calls since the change')]:[]));
  // 2. Agents and the mandate: who acts now, and whether the agent may pay alone.
  // 19 Nov 2026: when Purser's code read the invoice and no agent reached Claude, the roles say code did the work.
  const agentsRan=calls.some(([,c])=>c.who!==PC.shell.reader);
  const al=g==='workAlone'||g==='booksAlone';const S3=[code?['Reader','Purser’s code read the PDF; Claude not asked']:['Reader agent','Claude reads the PDF'],code&&!agentsRan?['Checker','Purser’s code checks, limits, signature']:['Checker agent','checks, limits, signature'],code&&!agentsRan?['Payer','Purser’s code pays and books']:['Payer agent','pays; the Coder agent books']];
  const state=(i)=>{if(g==='reading')return i===0?'cur':'';if(g==='work'||g==='workInj')return i===0?'done':i===1?'cur':'';if(g==='workAlone')return i<2?'done':'cur';if(g==='workCash')return i<2?'done':'';if(g==='approve')return i===0?'done':i===1?'wait':'';
    if(g==='books'||g==='booksAlone'||g==='done')return 'done';if(g==='pay')return i===1?'cur':'done';if(g==='refused')return i===1?'bad':'done';return ''};
  const mode=g==='workCash'?mk('span','mode warn','Inside EUR '+PC.limit+' · held by the cash floor'):al?mk('span','mode ok','Auto-pay ≤ EUR '+PC.limit):g&&g!=='invoice'&&g!=='reading'?mk('span','mode warn','Above EUR '+PC.limit+' · CFO passkey required'):mk('span','mode','Auto-pay ≤ EUR '+PC.limit+' · above it, CFO passkey');
  rAgents.replaceChildren(mk('h3','','Agents & mandate'),mode,mk('ol','',S3.map(([n,d],i)=>mk('li',state(i),[mk('b','',state(i)==='bad'?'Purser’s code':n),mk('span','',state(i)==='wait'?'waiting for the CFO’s passkey':state(i)==='bad'?'blocked: the fingerprint does not match':d)]))));
  // 3. Partner rails: lit when this run used them; the recorded runs said as such.
  const fx=EVT.some((e)=>e.event==='fx.rate_checked'||e.event==='airwallex.quote');
  const row=(cls,logo,name,txt,on)=>mk('li',(on?'on ':'')+cls,[logo,mk('div','',[mk('b','',name),mk('span','',txt)])]);
  const awxTxt=awx&&awx.source==='airwallex-sandbox'?'transfer '+String(awx.status||'').replace(/_/g,' ')+' · approval_sha256 attached':fx?'FX quote checked for this payment':'sandbox · standing by';
  rRails.replaceChildren(mk('h3','','Partner rails'),mk('ul','',[row('r-awx',logoChip('airwallex'),'Airwallex',awxTxt,!!awx||fx),row('r-alta',logoChip('alta'),'Alta (formerly Metal)',g==='refused'?'the same rule on chain: purchase #24 refused (recorded run)':'on-chain mandate limits · recorded run',g==='refused'),row('r-visa',mk('span','hw-logo pv-word','Visa Intelligent Commerce'),'via Airwallex Airi','one credential per purchase · recorded runs',false)]))}
function v2(){
  {const mm=document.getElementById('main');const small=innerWidth<1200||!document.body.classList.contains('present');
   if(mm&&small&&stages.parentElement!==mm){stages.classList.add('inmain');mm.prepend(stages)}else if(!small&&stages.parentElement!==document.body){stages.classList.remove('inmain');document.body.append(stages)}
   if(mm&&small&&stages.parentElement===mm&&mm.firstElementChild!==stages)mm.prepend(stages);
   // 16 Nov (Max): the Live Engine rail beside the step on a wide screen, a drawer under the step card on a smaller one.
   {const wide=innerWidth>=1280;rail.classList.toggle('side',wide);if(wide){if(rail.parentElement!==document.body)document.body.append(rail)}else if(mm&&cap.parentElement===mm&&cap.nextElementSibling!==rail)cap.after(rail)}
   const res=mm&&mm.querySelector('.screen.work .result');if(res&&INJ.flag&&!res.querySelector('.pv-warn')){const w=mk('div','pv-warn',[mk('b','',PC.inj.h),mk('p','',PC.inj.p)]);const big=res.querySelector('p.big');if(big)res.insertBefore(w,big);else res.prepend(w)}}
  // 19 Nov 2026: the step's line in the code's words when Purser's code reads this invoice (PRESENT_GUIDE_CODE).
  {const g=guideKey();const m0=document.getElementById('main');const gc=readerIs()==='code'&&PC.guideCode[g]?PC.guideCode[g]:null;const gv=g+(gc?'|code':'');if(cap.dataset.k!==g||cap.dataset.v!==gv){cap.dataset.k=g;cap.dataset.v=gv;if(g&&PC.guide[g]){const G=gc||PC.guide[g];cap.children[0].textContent=G.k;cap.children[1].textContent=G.t;cap.children[2].textContent=G.d;cap.className='pv-cap on '+g.replace('workInj','work refused');void cap.offsetWidth;cap.classList.add('in')}else cap.className='pv-cap'}
   if(m0&&g){const anchor=stages.parentElement===m0?stages:null;if(anchor){if(anchor.nextElementSibling!==cap)anchor.after(cap)}else if(m0.firstElementChild!==cap)m0.prepend(cap)}}
  const k=stageOf();document.body.classList.toggle('pv-staged',k>=0);
  {const g0=cap.dataset.k||'';const al=g0==='workAlone'||g0==='booksAlone';[...stages.querySelectorAll(':scope > li:not(.x)')].forEach((li,i)=>{li.className=al&&i===1?'notneeded':i<k?'done':i===k?'cur':''})}
  const m=document.getElementById('main');if(!m)return;
  const h1=m.querySelector(':scope > h1');if(h1&&m.querySelector('.screen.start')&&!h1.querySelector('.pv-grad')){const t=h1.textContent||'';const i=t.indexOf('. ');if(i>0&&i<t.length-2)h1.replaceChildren(t.slice(0,i+2),mk('span','pv-grad',t.slice(i+2)))}
  const st=m.querySelector('.screen.start');if(st&&!st.querySelector('.pp'))st.append(partners(true));
  for(const sc of m.querySelectorAll('.screen.company, .screen.did'))if(!sc.querySelector('.pp'))sc.append(partners(true));
  {const ch=m.querySelector('.screen.work .card.inv .slot .chip');const rd=[...CALLS.values()].find((c)=>c.who===PC.shell.reader);if(ch&&rd&&!ch.querySelector('.pv-rd')){const sp=ch.querySelector(':scope > span:not(.mono)');if(sp)sp.textContent='Read by Claude'+(rd.model?' · '+rd.model:'');const mo=ch.querySelector('.mono');if(mo)mo.hidden=true;ch.append(mk('span','pv-rd',[rd.ms?(rd.ms/1000).toFixed(1)+' s':'',rd.ms?' · ':'',usd(rd.cost)].join('')))}}
  for(const dt of m.querySelectorAll('.screen.approve .receipt dt'))if(/^(Conversion|Sign before)$/.test((dt.textContent||'').trim())&&!dt.hidden){dt.hidden=true;const dd=dt.nextElementSibling;if(dd&&dd.tagName==='DD')dd.hidden=true;const row=dt.parentElement;if(row&&row.tagName==='DIV'&&row.children.length===2)row.hidden=true}
  {const sh=m.querySelector('.screen.approve .receipt.sheet');if(sh&&INJ.flag&&!m.querySelector('.screen.approve .pv-warn')){const w=mk('div','pv-warn small',[mk('b','',PC.inj.h2),mk('p','',PC.inj.p2)]);const box=sh.parentElement;if(box)box.before(w)}}
  // The Airwallex card on Paid: a transfer waiting in Airwallex's own approval workflow is the second lock, said so; the
  // sandbox button cannot move it (Purser never approves at Airwallex), so it goes; the fingerprint shortened (full on hover).
  for(const ax of m.querySelectorAll('section.awx.live')){if(ax.dataset.v2)continue;const dds=[...ax.querySelectorAll('dd')];
    for(const dd of dds)if(/^[0-9a-f]{64}$/.test((dd.textContent||'').trim())){dd.title=dd.textContent.trim();dd.textContent=dd.title.slice(0,12)+'…'}
    const st=dds.find((d)=>/^IN APPROVAL$/.test((d.textContent||'').trim()));
    if(st){ax.dataset.v2='1';st.textContent='Waiting for approval in Airwallex';for(const b of ax.querySelectorAll('button'))(b.closest('p')||b).hidden=true;for(const h of ax.querySelectorAll('p.hint'))h.hidden=true;ax.append(mk('p','pv-lock2',[mk('b','',PC.awx2.h),' ',PC.awx2.p]))}
    else if(dds.length){const paid=dds.find((d)=>/^PAID$/.test((d.textContent||'').trim()));if(!paid&&!ax.dataset.sim)continue;ax.dataset.v2='1';
      if(paid)ax.append(mk('p','pv-lock2 opt',[mk('b','',PC.awx2.okH),' ',PC.awx2.okP]))}}
  // 19 Nov 2026 (Max): live Claude did not read this invoice: said plainly on the reading step, why first, never when it did.
  {const wk=m.querySelector('.screen.work');const t=wk?pausedText(!wk.querySelector('.skel')):'';let pn=wk?wk.querySelector(':scope > .pv-paused'):null;
   if(wk&&t){if(!pn){pn=mk('p','pv-paused','');pn.setAttribute('role','note');wk.prepend(pn)}if(pn.textContent!==t)pn.textContent=t}else if(pn)pn.remove()}
  // The finish's first line says who read the invoice in this run, and counts only Claude's real calls.
  for(const sc of m.querySelectorAll('.screen.company, .screen.did'))if(!sc.querySelector('.pv-verify')){const V=PC.verify;const calls=[...CALLS.values()];const tot=calls.reduce((x,c)=>x+c.cost,0);const N=nCalls(calls);const code=readerIs()==='code';const paused=pausedText(true);
    const vh=sc.querySelector('a.verifyl');const ol=mk('ol','',V.rows.map((r,i)=>{const cr=code&&r.k==='claude';const h=cr?V.code.h:r.h;const run=cr?(N?V.code.run:V.code.none):(r.run&&N?r.run:'');const kids=[mk('span','n',String(i+1)),mk('div','',[mk('b','',h),mk('p','',(cr?V.code.p:r.p)+(run?' '+run.replace('{n}',String(N)).replace(N===1?' calls':'{n}',N===1?' call':'{n}').replace('{cost}',usd(tot)):''))])];
      const href=r.href==='verify'?(vh&&vh.getAttribute('href')):r.href;if(r.link&&href){const l=mk('a','',r.link+' →');l.href=href;l.target='_blank';l.rel='noopener';kids[1].append(l)}return mk('li','',kids)}));
    const all=mk('a','btn primary big pv-all',V.all+' →');all.href=V.allHref;all.target='_blank';all.rel='noopener';
    const pn=paused?mk('p','pv-paused',paused):null;if(pn)pn.setAttribute('role','note');
    const card=mk('section','pv-verify',[mk('h2','',V.h),mk('p','sub',V.sub),...(pn?[pn]:[]),ol,all,mk('p','foot',V.foot)]);const pp=sc.querySelector('.pp');if(pp)pp.before(card);else sc.append(card)}
  // 16 Nov (review of the full run): three figures on the landing, not five; the warning in the green line too; terms are
  // locked by the Face ID, not before; no raw transfer ids on the paid card (they stay in the proof).
  for(const pk of m.querySelectorAll('.screen.start ul.rl li .pk'))if(/live runs|decisions by Claude/.test(pk.textContent||'')){const li=pk.closest('li');if(li)li.hidden=true}
  {const big=m.querySelector('.screen.work .result p.big');const alone=cap.dataset.k==='workAlone';if(big&&(INJ.flag||alone)&&!big.dataset.v2&&/^Checks passed/.test((big.textContent||'').trim())){big.dataset.v2='1';big.textContent=alone?'Checks passed. Approved by your policy.':'Checks passed · hidden instruction ignored · waiting for your approval.'}}
  {const sh=m.querySelector('.screen.approve p.sheet-h');if(sh&&!sh.dataset.v2){sh.dataset.v2='1';sh.textContent='Payment terms · your passkey locks them'}}
  for(const x of m.querySelectorAll('.screen.books dt, .screen.books span, .screen.books b'))if(!x.closest('details')&&(x.textContent||'').trim()==='Transfer'){const v=x.nextElementSibling;if(v&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test((v.textContent||'').trim())&&!x.hidden){x.hidden=true;v.hidden=true}}
  hood(m);railDraw();
  // A sandbox transfer Airwallex lets move (no approval workflow on it): its own simulation runs at once, labelled.
  for(const ax of m.querySelectorAll('section.awx.live'))if(!ax.dataset.sim){const b=[...ax.querySelectorAll('button')].find((x)=>!x.disabled&&x.offsetParent);const st=[...ax.querySelectorAll('dd')].map((d)=>(d.textContent||'').trim()).find((t)=>/^[A-Z ]+$/.test(t)||/Airwallex$/.test(t))||'';if(b&&!/APPROVAL|Waiting/.test(st)){ax.dataset.sim='1';b.click()}}
  const ap=m.querySelector('.screen.approve .receipt.sheet');if(ap&&!ap.querySelector('.pv-tag'))ap.prepend(mk('span','pv-tag amber','Awaiting CFO approval'));
  const hp=m.querySelector('.screen.approve .hashpill');if(hp&&!hp.dataset.v2){hp.dataset.v2='1';hp.title=hp.textContent;hp.textContent='Your passkey seals these exact terms'}
  const ps=m.querySelector('.screen.books .paidstamp');if(ps&&!ps.querySelector('.pv-tag'))ps.append(mk('span','pv-tag ok',aloneRun()?'Paid by the agent · test money':'Signed & paid · test money'));
  for(const h of m.querySelectorAll('.screen.books .paidstamp .hashpill'))if(!h.dataset.v2){h.dataset.v2='1';h.title=h.textContent;h.textContent=aloneRun()?'Approved by your policy · within EUR '+PC.limit:'Sealed by your passkey · any change breaks the seal'}
  {const cc=m.querySelector('.screen.work .why.cashctx');if(cc&&!cc.querySelector('.pv-tag'))cc.prepend(mk('span','pv-tag amber','Inside the agent\'s limit · held by Purser\'s code'))}
  const pr=m.querySelector('.screen.work .payrow');if(pr){const card=pr.closest('.card')||pr.parentElement;if(card&&!card.querySelector('.pv-tag'))card.prepend(cap.dataset.k==='workAlone'?mk('span','pv-tag ok','Inside the agent\'s limit · no signature needed'):mk('span','pv-tag amber','Above the agent\'s limit · CFO approval required'))}
  if(!m.querySelector('.card.refusal'))for(const b of m.querySelectorAll('.screen.pay button.btn'))if(b.textContent.trim()===PC.payButton&&!b.classList.contains('primary'))b.classList.add('primary','big');
  if(!document.body.classList.contains('present')){const bk=m.querySelector('.screen.books .blk.booked');if(bk&&!bk.querySelector(':scope > details.v2fold')){const kids=[...bk.children].filter((c)=>!c.classList.contains('bh')&&!c.classList.contains('bal'));if(kids.length){const d=mk('details','v2fold',mk('summary','',PC.ledgerFold));d.append(...kids);bk.append(d)}}}
  if(document.body.classList.contains('pv-noneg'))for(const a of m.querySelectorAll('.screen.company a, .screen.company button, .screen.did a, .screen.did button'))if(/negotiat/i.test(a.textContent||'')&&!a.hidden)a.hidden=true;
  // The finish: one main way on, the rest quiet; nothing repeated from the landing.
  for(const sc of m.querySelectorAll('.screen.company, .screen.did')){for(const a of sc.querySelectorAll('a, button'))if(/star on github|open purser cloud|download as json|watch agents negotiate/i.test(a.textContent||'')&&!a.hidden)a.hidden=true;for(const x of sc.querySelectorAll('li.wide'))x.hidden=true}
  // Recording mode: the refusal's proof open, the two fingerprints large.
  if(document.body.classList.contains('present')){const rc=m.querySelector('.card.refusal');const hs=rc&&rc.querySelector('details .hashes');const df=rc&&rc.querySelector(':scope > .diff');if(hs&&df)df.after(hs)}
  const rf=m.querySelector('.card.refusal');if(rf&&!rf.querySelector('.pv-tag')){const x=rf.querySelector('.proof.xfer');const zero=x&&/:\s*0\b/.test(x.textContent);rf.prepend(mk('span','pv-tag bad',zero?'Payment blocked · EUR 0.00 moved':'Payment blocked'));const ch=mk('p','pv-chain',[PC.partners.chain+' ']);const l=mk('a','',PC.partners.chainLink);l.href=PC.partners.chainHref;l.target='_blank';l.rel='noopener';ch.append(l);const x2=rf.querySelector('.proof.xfer');(x2||rf.querySelector('.rule')||rf.lastChild).after(ch)}
}
let v2t=0;new MutationObserver(()=>{if(!v2t)v2t=requestAnimationFrame(()=>{v2t=0;v2()})}).observe(document.body,{childList:true,subtree:true});v2();
const showHow=()=>{how.classList.remove('on');void how.offsetWidth;how.classList.add('on')};
// The app shell, unless ?shell=0: a sidebar with the workspace, the sections and Claude's usage in this run.
if(SHELL){
  // 16 Nov (Max: no fake navigation): no sidebar. The money line and How it works ride at the end of the step bar;
  // Claude's usage is the pill in the step card.
  document.body.classList.add('pv-shell');
  const howBtn=mk('button','pv-howbtn',[mk('span','dot',''),SH.how]);howBtn.type='button';howBtn.addEventListener('click',showHow);
  capMeta.append(mk('span','pv-sm',PC.money),howBtn);
}
function drawUse(){
  const calls=[...CALLS.values()];const tot=calls.reduce((a,c)=>a+c.cost,0);const N=nCalls(calls);const none=readerIs()==='code'?SH.noneCode:SH.none;
  const rows=calls.slice(-5).reverse().map((c)=>mk('li','',[mk('b','',c.who+(c.model?' · '+c.model:'')),mk('span','c',usd(c.cost)),mk('span','m',[c.ms?(c.ms/1000).toFixed(1)+' s':'',c.ms&&c.req?' · ':'',c.req?c.req.slice(0,8)+'…'+c.req.slice(-5):''].join(''))]));
  if(chip){chip.querySelector('summary').replaceChildren(mk('span','sp','✦'),mk('b','',SH.usage),mk('span','',N?N+' '+(N===1?SH.call:SH.calls)+' · '+usd(tot):none));const ol=chip.querySelector('ol');ol.replaceChildren(...calls.slice(-8).reverse().map((c)=>mk('li','',[mk('b','',c.who+(c.model?' · '+c.model:'')),mk('span','',usd(c.cost)+(c.ms?' · '+(c.ms/1000).toFixed(1)+' s':'')+(c.req?' · '+c.req.slice(0,8)+'…'+c.req.slice(-5):''))])))}
  railDraw();
  if(!useBox)return;
  const flash=calls.length&&useBox.dataset.tot!==String(tot);useBox.dataset.tot=String(tot);
  useBox.replaceChildren(mk('h3','',SH.usage),mk('div','tot'+(flash?' flash':''),calls.length?usd(tot):'$0.0000'),mk('div','sub',N?N+' '+(N===1?SH.call:SH.calls):none),mk('ol','',rows));
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
const RUN={startAt:null,paidAt:null,seqs:new Set(),claude:new Set(),paid:null,awx:false,refused:null};
try{const o=JSON.parse(sessionStorage.getItem('purser.present')||'null');if(o&&typeof o==='object'){RUN.startAt=o.startAt??null;RUN.paidAt=o.paidAt??null;RUN.paid=o.paid??null;RUN.awx=o.awx===true;RUN.refused=o.refused??null;for(const s of o.seqs||[])RUN.seqs.add(s);for(const s of o.claude||[])RUN.claude.add(s)}}catch(e){}
const keep=()=>{try{sessionStorage.setItem('purser.present',JSON.stringify({startAt:RUN.startAt,paidAt:RUN.paidAt,paid:RUN.paid,awx:RUN.awx,refused:RUN.refused,seqs:[...RUN.seqs],claude:[...RUN.claude]}))}catch(e){}};
const AMT=/^\d{1,9}\.\d{2}$/,CUR=/^[A-Z]{3}$/;
const money=(a,c)=>{const [w,d]=a.split('.');return c+' '+w.replace(/\B(?=(\d{3})+$)/g,',')+'.'+d};
const real=window.fetch.bind(window);
window.fetch=async(input,init)=>{
  // A new filing starts the hidden-instruction watch before its request: live, Claude takes seconds and the engine's flag
  // arrives while the request is still open (16 Nov live run), so a reset after it would erase that flag.
  try{noteFiling(new URL(typeof input==='string'?input:input.url,location.href).pathname,String(init&&init.method||'GET').toUpperCase())}catch(e){}
  const res=await real(input,init);
  try{
    const url=new URL(typeof input==='string'?input:input.url,location.href);const p=url.pathname;
    if(res.ok&&(p==='/v1/try/start'||p==='/v1/engine/events'||/^\/v1\/engine\/proposals\/[^/]+\/pay$/.test(p))){
      const at=Date.now();
      res.clone().json().then((j)=>{
        if(!j||typeof j!=='object')return;
        if(p==='/v1/try/start'){RUN.startAt=at;RUN.paidAt=null;RUN.paid=null;RUN.awx=false;RUN.refused=null;RUN.seqs.clear();RUN.claude.clear();CALLS.clear();keepCalls();forgetRead()}
        else if(p==='/v1/engine/events'){for(const e of Array.isArray(j.items)?j.items:[]){if(e&&typeof e.seq==='number'){RUN.seqs.add(e.seq);const f=e.fields&&typeof e.fields==='object'?e.fields:{};if(e.event==='claude.read'||(/^ap\.(checker_decided|coded|payer_proposed)$/.test(String(e.event))&&f.source==='claude'))RUN.claude.add(e.seq);takeCall(e,f);noteEvent(e);}}}
        else{
          let sent=null;try{sent=JSON.parse(String(init&&init.body||'null'))}catch(e){}
          const t=sent&&sent.terms||{};
          if(j.outcome==='paid'&&!RUN.paidAt){RUN.paidAt=at;RUN.paid=AMT.test(String(t.amount))&&CUR.test(String(t.currency))?money(String(t.amount),String(t.currency)):'';const ap=j.airwallex_payout;RUN.awx=!!(ap&&typeof ap==='object'&&ap.source==='airwallex-sandbox')}
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
    fig(RUN.paid?RUN.paid:null,RUN.awx?O.paidAwx:O.paid),
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
const own = (key: string) => START_LOGOS.find((l) => l.key === key)!;
/**
 * The partners' own files (logos.gen.ts unaltered, awxLogo.gen.ts the official wordmark scaled), on a white chip as on
 * the README, each with the file's own width and height (site audit, 19 Nov, finding 5: the chip's <img> had neither, so
 * the browser could not hold its box before the file loaded).
 */
export const LOGOS = {
  claude: { src: b64("/assets/logo-claude-slate.svg"), alt: "Claude", w: own("claude").w, h: own("claude").h },
  airwallex: { src: AIRWALLEX_LOGO_DATA_URL, alt: "Airwallex", w: AIRWALLEX_LOGO_SIZE.width, h: AIRWALLEX_LOGO_SIZE.height },
  alta: { src: b64("/assets/logo-alta.svg"), alt: "Alta (formerly Metal)", w: own("alta").w, h: own("alta").h },
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
  // A new filing starts the hidden-instruction watch before its request: live, Claude takes seconds and the engine's flag
  // arrives while the request is still open (16 Nov live run), so a reset after it would erase that flag.
  try{noteFiling(new URL(typeof input==='string'?input:input.url,location.href).pathname,String(init&&init.method||'GET').toUpperCase())}catch(e){}
  const res=await real(input,init);
  try{const url=new URL(typeof input==='string'?input:input.url,location.href);const p=url.pathname;
    if(res.ok&&(p==='/v1/try/start'||p==='/v1/engine/events'))res.clone().json().then((j)=>{if(!j||typeof j!=='object')return;
      if(p==='/v1/try/start'){CALLS.clear();keepCalls();forgetRead()}else for(const e of Array.isArray(j.items)?j.items:[])if(e&&typeof e.seq==='number'){takeCall(e,e.fields&&typeof e.fields==='object'?e.fields:{});noteEvent(e)}
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
    out: PRESENT_OUTCOME, shell: PRESENT_SHELL, how: PRESENT_HOW, map: SYSTEM_MAP_DATA_URL, logos: LOGOS, partners: PRESENT_PARTNERS, stages: PRESENT_STAGES, stagesShort: PRESENT_STAGES_SHORT, guide: PRESENT_GUIDE, guideCode: PRESENT_GUIDE_CODE, caps: LIVE.caps, payAlone: WORK.payAlone, payingAlone: PAY.paying, inj: PRESENT_INJ, awx2: PRESENT_AWX2, verify: PRESENT_VERIFY, hood: PRESENT_HOOD, limit: PRESENT_AGENT_LIMIT, payButton: V2_COPY.pay.button, ledgerFold: "Show the bookkeeping entries",
    // Without the negotiation the Clean sample's hint keeps only its first part ("Ready to pay").
    negHint: NEG_HINT, negHintShort: NEG_HINT.split(" · ")[0],
  };
  const body = (kind === "public" ? PUBLIC_SCRIPT : SCRIPT).replace("__SHARED__", () => SHARED.replace("__CALL_SAID__", () => callSaid.toString()).replace("__CLAUDE_CALL__", () => claudeCall.toString()).replace("__READER_OF__", () => readerOf.toString()).replace("__PAUSED_NOTICE__", () => pausedNotice.toString()));
  return { css: CSS, script: body.replace("__PRESENT_CFG__", () => json(cfg)) };
}
