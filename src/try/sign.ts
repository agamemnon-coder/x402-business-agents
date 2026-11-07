// /try/sign (TRY_SIGN_ENABLED): the demo, as one story of five screens, about 60 seconds (Max, 7 Nov: "De demo
// opnieuw"). One main action per screen, at most about 60 words in sight, the details behind "Show …":
//   1. "Your Treasury agent wants to pay an invoice above its limit." The agents' work comes in step by step, each step a
//      real answer from the server (POST /agents, spec 6b): Claude Sonnet reads the invoice, Purser's code checks it,
//      code plans the payment and Airwallex quotes the shortfall, Claude Opus advises. Then the agent's reason (Opus,
//      live, labelled; or recorded or fixed, labelled with why), its advice, the payment and its live quote, and one
//      button, "Sign with Face ID" (it makes the visitor's test passkey first when there is none, then signs: one tap,
//      two prompts). The steps behind "What the agents did"; the exact terms and the hash behind "Show the exact terms";
//      the other payment, stopped by a rule, and the three locks behind a closed line.
//   2. "Signed and verified." The server checked the signature over the SHA-256 of the exact terms; the stand-in ran it
//      in the test world. The receipt and /try/verify as two text links.
//   3. "Try to cheat." Change one cent, the IBAN or the currency and send it with the same signature: the server refuses.
//   4. "Change the rule." How much the Treasury agent may pay alone: a looser rule needs the visitor's signature, a
//      stricter one applies at once. The worst case and the three locks, one line each; every field and what Purser
//      would send to Airwallex and Metal behind "Show all fields and what Purser sends".
//   5. "The agent pays it alone." The agent's next invoice (EUR 1,240.00, with its own live quote) runs without a
//      signature under the new rule, or still waits for one. Then three ways on.
// The test world opens when the page is shown (Max, 7 Nov) and the agents start at once, so their steps are mostly done
// by the time the visitor reaches screen 1; per world, one reading, one advice and two quotes. The page's API is
// worker/src/trySign.ts.
// One inline script and one inline style, hashed into the CSP like the other public pages; everything it shows from the
// server goes in as text, never as markup.

import { esc, icon, iconSet, page } from "../redesign/ui.js";
import { REPO_URL } from "../submission/deck.js";
import { FILM_URL } from "../config/brand.js";
import { cfoApproval, recordedQuote, tryLocks } from "./examples.js";
import { RECEIPT_FORMAT } from "./receipt.js";
import { AGENTS, MCC_WORDS } from "../config/policy.js";
import { agentName } from "../config/brand.js";
import { ALONE_CHOICES, ALONE_PER_DAY, defaultPolicy, exposurePolicyOfWorld, FIELD_WORDS, PAID_ALONE, POLICY_CURRENCIES, POLICY_FIELDS, POLICY_MCCS, STEP0_CHAIN } from "./policy.js";
import { worstCaseWords, worstCaseWordsOf } from "../policy/exposureSources.js";
import { EXPOSURE_HOW, exposureOf } from "../policy/exposure.js";
import { AGENT_STEPS, FIXED_PROPOSALS, NEXT_INVOICE, TEST_WORLD, type AgentStep } from "../../worker/src/trySign.js";
import { CODE_LABEL } from "../../worker/src/agentLine.js";
import { ATTACKS, TRICKS } from "../../worker/src/trick.js";

/** The feature flag, read where the bundle is built: on, the page, its API and the links to it are in the bundle. */
export const trySignOn = (env: NodeJS.ProcessEnv = process.env) => ["on", "1", "true"].includes(env.TRY_SIGN_ENABLED ?? "");

/** The label at the top of the page, word for word: the one-line disclaimer. */
export const TRY_SIGN_LABEL = "Test world · test passkey · nothing real moves";

/** The six steps, in order (the progress indicator's names for them; Max, 7 Nov: "Trick the agent" after the cheat). */
export const TRY_SIGN_STEPS = ["The agent asks", "Signed", "Try to cheat", "Trick the agent", "Change the rule", "Pays alone"] as const;

/** Each screen's words, word for word (tests read them). */
export const TRY_SIGN_SCREENS = {
  // 1.1 (Max, 7 Nov): one sentence and one button before the first step; the amount is T-0002's (a test checks it).
  intro: {
    head: "You're the CFO. Your AI agents pay suppliers on their own. One of them wants €1,850.",
    start: "Show me",
  },
  ask: {
    head: "Your Treasury agent wants to pay an invoice above its limit.",
    sign: "Sign with Face ID",
    terms: "Show the exact terms",
    /** The payment a rule stopped in this test world (jury review, 7 Nov, #6: said as the test it is), and a real example. */
    other: "Purser stopped a test payment in your world just now",
    real: "see a real example ↗",
    opening: "Opening your test world…",
    /** The fold with the agents' steps, calls and plan (Max, 7 Nov). */
    did: "What the agents did",
    /** Each step while it runs: who works on what (no spinner). */
    pending: {
      read: ["Claude Sonnet", "is reading Alpine Packaging's invoice…"],
      check: ["Purser's code", "is checking the reading…"],
      quote: ["Airwallex sandbox", "is quoting what Purser's code plans to convert…"],
      advise: ["Claude Opus", "is advising on the timing…"],
      ready: ["Purser's code", "is writing the terms…"],
    },
    ready: "The exact terms are ready to sign.",
  },
  signed: {
    head: "Signed and verified.",
    line: "Purser checked your signature. It only fits these exact terms.",
    executed: "Executed in your test world",
    cheat: "Now try to cheat: change one cent",
    receipt: "Download your receipt",
    verify: "Check the receipt yourself",
    details: "Show the details",
  },
  cheat: {
    head: "Try to cheat.",
    refused: "Refused by Purser",
    chips: [{ id: "cent", label: "+ 1 cent" }, { id: "iban", label: "Other IBAN" }, { id: "currency", label: "USD instead of EUR" }],
    any: "Change any field",
    next: "Next: trick the agent",
  },
  // 1.3: two fixed fake invoices (worker/src/trick.ts), each blocked by Purser's own fraud and injection code.
  trick: {
    head: "Try to trick the agent.",
    lead: "Send your agent a fake invoice",
    /** Max, 7 Nov: true whether the agent was fooled or not. */
    decides: "Purser's code checks it.",
    did: "What the agent did",
    next: "Next: change the rule",
  },
  rule: {
    head: "Change the rule.",
    question: "How much may it pay alone?",
    chips: ALONE_CHOICES,
    /** Right under the worst case (Max's review): the risk it adds is the reason for the signature. */
    looser: "That risk needs your Face ID.",
    stricter: "Less risk: it applies at once.",
    same: "This is the rule in force. Pick another amount.",
    sign: "Sign with Face ID",
    apply: "Apply",
    all: "Show all fields",
    /** The worst case in one honest number, EUR a month, from the server (with what the choice adds, when it adds). */
    worst: "Worst case:",
  },
  alone: {
    head: "The agent pays it alone.",
    waits: "Still waits for you.",
    again: "Change the rule again",
    finish: "Finish",
  },
  // 1.5: the closing card, after the last step.
  done: {
    head: "That's Purser.",
    /** 6c: the world's hash chain, its length and head, and the check the browser makes of it. */
    chain: { label: "Hash chain:", verify: "Verify the chain", ok: "Verified in your browser" },
    lead: "In about a minute you:",
    items: { signed: "signed one payment", cheat: "tried to cheat (refused)", trick: "tried to trick the agent (blocked)", rule: "changed the rule (signed)", alone: "watched the agent pay alone" },
  },
} as const;

/** 1.4: screen 5's worst case in words a CFO reads at once, from the rule in force (Max, 7 Nov). */
export const worstAloneLine = (alone: string, perDay: number) => `Worst case in your test world: the agent may pay up to ${euro(alone)} alone, at most ${perDay} times a day.`;
/** Why the main run's figure is far lower: there the agents may pay nothing alone. */
export const mainRunWorst = (): string => `The main run's worst case is ${README_WORST.figure}: there the agents may pay nothing alone.`;

/** The other invoice the page shows on screen 5, as the server's test world has it (worker/src/trySign.ts). */
const NEXT = { id: NEXT_INVOICE.id, amount: NEXT_INVOICE.amount, payee: NEXT_INVOICE.payee, reference: NEXT_INVOICE.reference };
/** Who does each of the agents' steps, by its icon: the reader agent, Purser's code, Airwallex, the Treasury agent, the terms. */
const STEP_ICONS: Record<AgentStep, string> = { read: "bot", check: "shield-check", quote: "arrow-left-right", advise: "landmark", ready: "scan-face" };
/** The payment that waits on screen 1 (T-0002), by its id. */
const WAITING = FIXED_PROPOSALS.find((p) => p.id === "T-0002")!;

/** The last line after a refused tamper: one cent off the amount, or any other single change (Max, 6 Nov). */
export const TAMPER_VERDICT = { cent: "One cent changed. The signature is worthless.", field: "One field changed. The signature is worthless." } as const;

/** The closing card's three ways on (Max, 7 Nov, 1.5), word for word: the real run as the one main button. */
export const TRY_SIGN_END = [
  { label: "See the real run", href: "/proof", icon: "shield-check" },
  { label: "Trace a real payment", href: "/trace", icon: "link-2" },
  { label: "Read the code", href: REPO_URL, icon: "external-link" },
] as const;
/** Under them, as a text link. */
export const TRY_SIGN_FILM = { label: "Watch the film", href: FILM_URL } as const;

/** Screen 4's full policy, behind "Show all fields and what Purser sends" (#71, Max's item 1): its words, word for word. */
export const TRY_POLICY = {
  title: "Set the policy",
  /** The line the full policy is behind (closed by default). */
  open: TRY_SIGN_SCREENS.rule.all,
  /** Beside the agent's sentence on a payment that ran alone after a policy change: it was said before that change. */
  saidBefore: "said before your policy change",
  /** 1.1: the worst case block's heading, "Worst case" word for word (the /judge tour looks for it). */
  worstCase: "Worst case, set by policy",
  /** 1.1, decision B1: what the block counts on chain, since the policy here does not change Purser's mandates. */
  worstCaseChain: STEP0_CHAIN === "purser" ? "Here: the card limits you set; on chain, Purser's own mandates, which this page does not change." : "Here: the card limits you set; on chain, your test world's mandate as panel 3 shows it.",
  ifSigned: "If you sign it:",
  lead: "One policy → three locks. Change one value and apply it: a stricter policy holds at once, a looser one only with your signature.",
  panels: { purser: "Purser's rule", airwallex: "Airwallex card controls", metal: "Metal mandate" },
  notSent: { airwallex: "What Purser would send; not sent", metal: "Not sent" },
  state: { inForce: "In force", proposed: "Proposed: not in force until you sign" },
  refused: "Refused: a looser policy needs your signature",
  sign: "Sign the looser policy with Face ID",
  source: "Computed on the server by Purser's own code (src/try/policy.ts): the card body as IssuingRest sends it (src/airwallex/cardBody.ts), the mandate's terms as the owner signer passes them to metal-agent (src/metal/credentialArgs.ts). Nothing is sent to Airwallex or Metal.",
  metalUnit: "Amounts in *USDZ (test USD): the policy's numbers as they are, not converted from euros.",
  metalNote: "Cap = the limit per purchase, budget = the limit per month, expiry = the end date.",
} as const;

/** What each lock holds (Max's review, 7 Nov): Purser's rule the invoices and proposals, the Airwallex card the card spend,
 * the Metal mandate the payments on chain. Short, as screen 5's lines say it; long, as the diagram and the locks do. */
export const LOCK_CHANNELS = {
  purser: { short: "Invoices", long: "Invoices and proposals" },
  airwallex: { short: "Card spend", long: "Card spend" },
  metal: { short: "On-chain", long: "On-chain payments" },
} as const;

/** Screens 4 and 5 say the worst case as one line, and whom it counts: all three agents' cards and mandates. */
export const allAgents = (headline: string) => headline.replace("Worst case, set by policy:", "Worst case, all agents:");
/** The worst case before a world opens: the starting policy's, as the README and the CFO's view show it. */
// The test world's opening figure (Max, 7 Nov): Purser's policy plus what its Treasury agent may pay alone, by the code
// the Worker uses (exposurePolicyOfWorld), with the main run's rate; the page shows it before the world answers.
const START_WORST = worstCaseWordsOf(exposurePolicyOfWorld(defaultPolicy(new Date(), TEST_WORLD)));
/** Purser's own figure (the README's and the main run's): no payments alone there. */
const README_WORST = worstCaseWords();
/** The test world's opening worst case, EUR cents a month (cards and payments alone), as the Worker computes it. */
const START_WORST_EUR_MONTH = ((x) => x.total.month.eurCents - x.agents.find((e) => e.agent === "treasury")!.alone.monthEurCents)(exposureOf(exposurePolicyOfWorld(defaultPolicy(new Date(), TEST_WORLD))));

/** The fields a visitor may change to tamper, as the terms name them. */
export const TAMPER_FIELDS = ["amount", "payee_iban", "currency", "fx.client_rate"] as const;
/** "Other IBAN": a test IBAN (check digits 00, which no real account has), not the payee's. */
export const OTHER_IBAN = "DE00000000000000000666";

/** What the "What's real?" expander says, line by line (tests read it). */
export const WHATS_REAL = {
  simulated: [
    "A test world made for you, deleted after one hour: a test copy of Northwind Outdoor. Its balance, its payees and their IBANs are test data (the IBANs' check digits are 00, which no real account has).",
    "No payment or conversion at Airwallex, no Metal call, and no money moves: the executor is a stand-in that only records in your test world.",
    "The blocked payment and the lock that stops it are a simulation in your test world. The three examples it links to are real, each from the run it names.",
    "The rule and the policy: your test world's CFO policy and the three locks made of it (Purser's rule, the Airwallex card controls, the Metal mandate's terms), computed by Purser's own code and sent nowhere: nothing reaches Airwallex or Metal. As in Purser, a looser policy needs your passkey's signature and a stricter one applies at once.",
    "Your test world holds EUR 26,000.00 (floor EUR 25,000.00) and USD 8,000.00 (floor USD 3,000.00). The stand-in converts at the quote and charges no SWIFT fee; the EUR 20.00 fee ceiling code reserves stays in the balance.",
    "Once you have signed, the Treasury agent's next invoice arrives in your test world: fixed text, EUR 1,240.00, with a live quote of its own for the EUR it is short and no model call. If you raise what the agent may pay alone to that amount or more and sign it, the invoice runs without your signature, by the same stand-in, labelled “" + PAID_ALONE + "”.",
  ],
  real: [
    "Your device's passkey signature over the SHA-256 of the exact terms, and the server's check of it against the public key your device registered (the same verifier as the CFO's passkey sign-in).",
    "The tamper: the server checks your changed terms against the same signature, for real, and refuses them.",
    "The agents on the waiting payment are live: Claude Sonnet, the runner's invoice reader, reads Alpine Packaging's invoice (a document written by code), labelled “Claude Sonnet · live · invoice reader”; Purser's code checks the reading against the invoice's own lines, the payee against the allowlist and the amount against the limit, and plans the payment as Purser does (the invoice plus the EUR 20.00 fee ceiling, converting only what is short); Claude Opus, the runner's Treasury agent, advises paying now or waiting, labelled “Claude Opus · live · treasury advice”. Only the invoice and the test world's facts go in, never anything you type. No model sets an amount, a payee, the conversion or the plan: the terms come from the checked reading, and code checks every amount in Opus's reason against its own numbers.",
    "Limits: USD 10 a day for every live agent on this page together, a few calls a minute, 8 s a call. When a live agent is unavailable, the page shows a recorded real answer of the same agent, labelled “recorded: the live agent was unavailable” with the reason, and checked by code like a live one; without a recording, code's reading or a fixed sentence, labelled with the reason. An emergency switch on the server (TRY_SIGN_AGENTS=off) stops every live agent call; the labels then say so.",
    "The FX quotes are live from the Airwallex sandbox (a test environment): read-only, nothing is converted, no money moves; two per world, one for each invoice's shortfall. A quote is in the terms, so the signature covers its quote id, and an expired quote is refused. Without a live quote (no sandbox key on the server, or the limit reached) the page shows the main run's recorded quote instead, labelled, and it is not in the signature.",
    "The receipt: receipt.json holds the exact terms, their hash, your passkey's signature, its public key and the algorithm. Anyone can check it offline, with no server: npm run verify-receipt -- receipt.json in the repository. Change one field or one cent and it fails. It proves that the holder of that key signed those terms, not who holds it.",
    "The hash chain: every event in your test world (opened, each agent's step, each proposal, signature, refusal and execution, each policy change) adds a row whose hash covers the row before; the last screen shows its length and head, and “Verify the chain” recomputes every hash in your browser. The receipt carries the chain as it was when you signed, and its checks find your signature's row in it. The server keeps the chain, so it shows the order and that no row was changed after the next was written, not that the server could not have rewritten all of it: a head you noted down earlier can.",
  ],
  limits: [
    "The server checks no attestation, so it cannot tell which authenticator made the key, and a key made in software would verify too: Face ID is what your device asks for, not something the server proves.",
    "This world, its passkey and its proposals live in their own store, apart from Northwind's: a test passkey is enrolled nowhere else, so it can never approve a real proposal or sign in to the CFO's pages.",
    "Your test world opens when this page is shown and the agents start at once, one step per request, each step a real answer from the server: one reading, one advice and two quotes per world, within the limits per address and for everyone.",
  ],
  sources: [
    "The test world: worker/src/trySign.ts; nothing in it is recorded anywhere else. The locks' real examples: docs/demo/main-run.json and docs/runs/visa-tap-live-2026-11-02.json.",
  ],
} as const;

const CSS = `.testband { background: var(--text); color: var(--bg); text-align: center; font: 700 12px/16px Inter, system-ui, sans-serif; padding: 3px 10px; letter-spacing: 0; }
.testband .i { width: 13px; height: 13px; vertical-align: -2px; margin-right: 5px; }
.testband .row { display: flex; flex-wrap: wrap; justify-content: center; align-items: center; gap: 0 10px; }
.testband .tl { white-space: nowrap; }
/* "What's real?": one link in the band, opened on demand; its lines in a panel under the band. */
.testband details.wr > summary { cursor: pointer; list-style: none; display: inline-flex; align-items: center; min-height: 24px; margin: -4px 0; color: inherit; text-decoration: underline; text-underline-offset: 2px; font-weight: 650; }
.testband details.wr > summary::-webkit-details-marker { display: none; }
.testband details.wr[open] { flex-basis: 100%; }
.wr-body { display: grid; gap: 10px; padding: 14px 16px; margin: 8px auto 4px; max-width: 760px; font: 400 15px/1.5 Inter, system-ui, sans-serif; text-align: left; color: var(--text); letter-spacing: 0; }
.wr-body h3 { font-size: 15px; margin: 0; } .wr-body ul { margin: 0; padding-left: 18px; display: grid; gap: 4px; }
/* The site's header is opaque here: cards scroll under it. */
header.top { background: var(--bg); -webkit-backdrop-filter: none; backdrop-filter: none; }
main { padding: 16px 0 28px; }
/* One progress indicator: five dots and "2 of 5 · Signed". */
.prog { display: flex; align-items: center; gap: 12px; margin: 0 0 14px; max-width: 640px; }
ol.dots { list-style: none; margin: 0; padding: 0; display: flex; gap: 8px; }
ol.dots li { width: 10px; height: 10px; border-radius: 50%; background: var(--border); }
ol.dots li.done { background: var(--ok); } ol.dots li.on { background: var(--accent); box-shadow: 0 0 0 4px var(--accent-soft); }
ol.dots li .t { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
.prog .count { margin: 0; font: 650 14.5px/1.3 Inter, system-ui, sans-serif; color: var(--muted); }
.prog { flex-wrap: wrap; }
/* The story: one screen at a time, one card; from 1024 px the diagram beside it. */
.story { display: grid; gap: 20px; align-items: start; }
.scr { padding: 22px 20px 0; display: grid; gap: 14px; max-width: 640px; min-width: 0; }
.scr[hidden], .diagram[hidden] { display: none; }
.scr > * { min-width: 0; margin: 0; }
.scr h1, .scr h2 { font-size: clamp(25px, 3vw, 32px); line-height: 1.15; letter-spacing: -.02em; font-weight: 750; outline: none; }
.scr .lead1 { font-size: 18px; line-height: 1.45; color: var(--text); }
.scr .q { font-size: 18px; font-weight: 650; }
/* The one main action, always in sight on a phone: it sticks to the bottom of the screen while the card scrolls. */
.bar { position: sticky; bottom: 0; z-index: 5; display: grid; gap: 8px; margin: 2px -20px 0; padding: 12px 20px calc(14px + env(safe-area-inset-bottom)); background: var(--surface); border-top: 1px solid var(--border); border-radius: 0 0 var(--radius, 18px) var(--radius, 18px); }
.bar .btn { justify-content: center; width: 100%; }
.btn.big { min-height: 56px; font-size: 17px; padding: 0 26px; }
.btn[disabled] { opacity: .45; cursor: not-allowed; }
.btn[hidden] { display: none; }
/* A text link: the second action, never a second button. */
.tlink { background: none; border: 0; padding: 0; font: 650 16px/1.4 Inter, system-ui, sans-serif; color: var(--accent); text-decoration: none; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; min-height: 40px; }
.tlink:hover { text-decoration: underline; }
.links { display: flex; flex-wrap: wrap; align-items: center; gap: 0 18px; }
details.fold > summary { cursor: pointer; list-style: none; display: inline-flex; align-items: center; gap: 6px; min-height: 40px; font-weight: 650; font-size: 16px; color: var(--accent); }
details.fold > summary::-webkit-details-marker { display: none; }
details.fold > summary::after { content: "▾"; font-size: 13px; } details.fold[open] > summary::after { content: "▴"; }
details.fold > .fbody { display: grid; gap: 12px; padding: 4px 0 6px; }
details.fold.quiet > summary { color: var(--muted); font-weight: 600; font-size: 15px; }
/* One sentence shows; the rest is behind "more". */
details.more { font-size: 14.5px; color: var(--muted); }
details.more > summary { cursor: pointer; display: inline-flex; align-items: center; min-height: 32px; font-weight: 650; color: var(--accent); }
details.more > p { margin: 4px 0 0; }
.muted { color: var(--muted); } .small { font-size: 15px; }
.status { font-size: 15.5px; color: var(--muted); overflow-wrap: anywhere; margin: 0; }
.status:empty { display: none; }
.status.bad { color: var(--bad); font-weight: 600; } .status.ok { color: var(--ok); font-weight: 600; }
/* Screen 1: the agent's request. */
.who { display: flex; align-items: center; gap: 8px 10px; flex-wrap: wrap; font-weight: 700; font-size: 15.5px; }
.who .pill { white-space: normal; }
.who .av { width: 32px; height: 32px; background: var(--a-treasury); color: #fff; }
.who .av .i { width: 17px; height: 17px; }
.says { font-size: 17px; line-height: 1.45; margin: 0; }
/* The agent's own words as they are: no quote marks around them (Max's review). */
/* Screen 1: the agents' steps, each one a real answer from the server; the fields fade in as they arrive. */
ol.steps { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
.st { display: grid; grid-template-columns: 30px minmax(0, 1fr); gap: 10px; align-items: start; }
.st > * { min-width: 0; }
.st .sic { width: 30px; height: 30px; border-radius: 50%; display: grid; place-items: center; background: var(--sunken); color: var(--muted); }
.st.done .sic { background: var(--accent-soft); color: var(--accent); }
.st.waiting { opacity: .5; }
.st .sl { margin: 0; font-size: 15.5px; line-height: 1.4; overflow-wrap: anywhere; }
.st .sl .pill { margin-left: 4px; font-size: 12.5px; padding: 1px 8px; white-space: normal; }
.st.pending .sw, .st.waiting .sw { color: var(--muted); }
.st .sd { display: flex; flex-wrap: wrap; gap: 4px 6px; margin-top: 4px; font-size: 14.5px; }
.st .sd:empty { display: none; }
.st .fld { padding: 2px 8px; border-radius: 999px; background: var(--sunken); font-variant-numeric: tabular-nums; overflow-wrap: anywhere; animation: fin .35s ease both; }
.st .fld:nth-child(2) { animation-delay: .12s; } .st .fld:nth-child(3) { animation-delay: .24s; } .st .fld:nth-child(4) { animation-delay: .36s; } .st .fld:nth-child(5) { animation-delay: .48s; } .st .fld:nth-child(6) { animation-delay: .6s; }
@keyframes fin { from { opacity: 0; transform: translateY(3px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) { .st .fld { animation: none; } }
/* Once folded under "What the agents did", the fields stay as they are: opening the fold does not reveal them again. */
ol.steps.settled .fld { animation: none; }
ul.ticks { list-style: none; margin: 0; padding: 0; display: grid; gap: 3px; flex-basis: 100%; }
ul.ticks li { display: flex; gap: 6px; align-items: flex-start; overflow-wrap: anywhere; } ul.ticks li .i { flex: none; margin-top: 2px; color: var(--ok); } ul.ticks li.bad .i { color: var(--bad); }
.advice { margin: 0; font-weight: 650; font-size: 15.5px; color: var(--muted); }
.pay[hidden], .ask[hidden], details.fold[hidden], ol.steps[hidden] { display: none; }
#s1-did ul.calls { list-style: none; padding: 0; margin: 0; } #s1-did ul.calls li { overflow-wrap: anywhere; margin-top: 6px; }
#s1-did .fbody > * { min-width: 0; overflow-wrap: anywhere; margin: 0; }
.ask { display: grid; gap: 8px; padding: 14px 16px; border-radius: 16px; background: var(--sunken); }
.ask > * { min-width: 0; }
.pay { display: grid; gap: 4px; }
.pay .to { color: var(--muted); font-size: 15.5px; margin: 0; overflow-wrap: anywhere; }
.pay .amt { margin: 0; display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 10px; font-size: clamp(22px, 2.6vw, 28px); font-weight: 750; letter-spacing: -.015em; font-variant-numeric: tabular-nums; }
.nw { white-space: nowrap; }
.pay .fx { font-size: 16px; font-weight: 600; letter-spacing: 0; color: var(--muted); white-space: nowrap; }
.pay .fx .tag { font-size: 12.5px; padding: 2px 8px; vertical-align: 1px; }
.skel { height: 1.1em; border-radius: 8px; background: var(--sunken); } .skel.w60 { width: 60%; } .skel.w80 { width: 80%; } .skel.inl { display: inline-block; width: 14em; }
dl.facts { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 9px 12px; margin: 0; padding: 14px; border: 1px solid var(--border); border-radius: 14px; background: var(--sunken); font-size: 15.5px; }
dl.facts dt { color: var(--muted); white-space: nowrap; } dl.facts dd { margin: 0; font-weight: 650; overflow-wrap: anywhere; font-variant-numeric: tabular-nums; min-width: 0; }
dl.facts dd.amount { font-size: 18px; }
dl.world { display: flex; flex-wrap: wrap; gap: 6px; margin: 0; }
dl.world > div { display: inline-flex; gap: 5px; align-items: baseline; padding: 3px 9px; border-radius: 999px; background: var(--sunken); font-size: 13.5px; min-width: 0; }
dl.world dt { color: var(--muted); } dl.world dd { margin: 0; font-weight: 650; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 14.5px; }
.chk { display: grid; gap: 4px; border-radius: 14px; padding: 12px 14px; font-size: 15.5px; line-height: 1.45; }
.chk b { display: flex; align-items: center; gap: 6px; }
.chk.fail { background: var(--bad-soft); color: var(--text); } .chk.fail b { color: var(--bad); }
.chk.pass { background: var(--sunken); } .chk.pass b { color: var(--accent); }
/* A hash, shortened (first 12 and last 8 characters): tap it for all 64, Copy for the clipboard. */
.hash { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 6px 6px 6px 10px; }
.hash .exp { flex: 1 1 12ch; min-width: 0; text-align: left; background: none; border: 0; padding: 4px 0; cursor: pointer; color: var(--text); }
.hash code { font: 600 14px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; color: var(--text); }
.hash code b { color: var(--accent); }
.hash .copy { flex: none; display: inline-flex; align-items: center; gap: 6px; min-height: 40px; padding: 0 12px; border-radius: 999px; border: 1px solid var(--border); background: var(--surface); color: var(--text); font: 650 14px/1 Inter, system-ui, sans-serif; cursor: pointer; }
.hash .copy.ok { color: var(--ok); }
.hash code, pre.terms { overflow-wrap: anywhere; word-break: break-all; }
pre.terms { margin: 0; white-space: pre-wrap; font: 13.5px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; background: var(--sunken); border-radius: 10px; padding: 10px; }
.basis { font-size: 14px; color: var(--faint); margin: 0; }
/* The payment a rule stopped, and its three locks. */
.prop { padding: 16px; display: grid; gap: 12px; max-width: 100%; }
.prop > * { min-width: 0; }
.prop .eyebrow { margin: 0; font-size: 13px; }
.locks { display: grid; gap: 8px; }
.locks h3 { font-size: 16px; margin: 0; }
.lock { border: 1px solid var(--border); border-radius: 14px; padding: 10px 12px; display: grid; gap: 4px; font-size: 15px; line-height: 1.45; }
.lock > * { min-width: 0; }
.lock .lh { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-weight: 700; }
.lock .tag { font-size: 13px; padding: 2px 9px; }
.lock.hit { border-color: var(--bad); background: var(--bad-soft); } .lock.hit .tag { background: var(--bad); color: var(--on-bad); }
.lock a { color: var(--accent); font-weight: 650; text-decoration: none; display: inline-flex; align-items: center; gap: 4px; min-height: 32px; }
.lock a .i { flex: none; }
.fxq { display: grid; gap: 4px; margin-top: 4px; padding: 10px 12px; border-radius: 12px; background: var(--awx-soft); font-size: 15px; line-height: 1.45; }
.fxq .lh { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-weight: 700; }
.fxq.live .tag { background: var(--ok); color: var(--surface); }
.fxq.recorded { background: var(--sunken); } .fxq.recorded .tag { background: var(--border); color: var(--text); }
.fxq > * { min-width: 0; overflow-wrap: anywhere; }
/* Screen 2: signed. */
.bigok { display: flex; align-items: center; gap: 14px; }
.bigok .i { width: 56px; height: 56px; flex: none; color: var(--ok); }
.line { display: flex; align-items: flex-start; gap: 10px; font-size: 16px; line-height: 1.45; }
.line > * { min-width: 0; }
.line > .i, #t-icon { flex: none; margin-top: 2px; }
.line.ok .i { color: var(--ok); } .line.bad .i { color: var(--bad); }
.line b { display: block; }
.receipt code { font: 600 14px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; background: var(--sunken); border-radius: 6px; padding: 1px 5px; overflow-wrap: anywhere; }
/* Screens 3 and 4: choices as chips. */
.chips { display: flex; flex-wrap: wrap; gap: 8px; }
.chip { min-height: 46px; padding: 0 16px; border-radius: 999px; border: 1.5px solid var(--border); background: var(--surface); color: var(--text); font: 650 16px/1 Inter, system-ui, sans-serif; cursor: pointer; font-variant-numeric: tabular-nums; }
.chip[aria-pressed="true"] { border-color: var(--accent); background: var(--accent-soft); box-shadow: inset 0 0 0 1px var(--accent); }
.chip[disabled] { opacity: .5; cursor: not-allowed; }
.chip .now { display: inline-flex; vertical-align: -3px; margin-left: 6px; color: var(--ok); }
/* The refusal: what was signed and what was sent, the changed row marked, the others quiet. */
.refused { display: grid; gap: 10px; padding: 14px 16px; border-radius: 16px; background: var(--bad-soft); }
.refused[hidden] { display: none; }
.refused > * { min-width: 0; margin: 0; }
.refused .tagr { justify-self: start; display: inline-flex; align-items: center; gap: 6px; padding: 3px 10px; border-radius: 999px; background: var(--bad); color: var(--on-bad, #fff); font: 700 13.5px/1.3 Inter, system-ui, sans-serif; }
.refused .rh { display: flex; align-items: center; gap: 8px; color: var(--bad); font-weight: 650; font-size: 15px; }
.refused .outcome { order: -1; }
table.diff { width: 100%; border-collapse: collapse; font-size: 14.5px; table-layout: fixed; }
table.diff th, table.diff td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--border); overflow-wrap: anywhere; vertical-align: top; color: var(--muted); }
table.diff th { font-weight: 650; font-size: 13.5px; }
table.diff tr.chg td { color: var(--text); font-weight: 750; background: var(--surface); }
table.diff tr.chg td:last-child { color: var(--bad); }
.outcome { font-size: clamp(19px, 2vw, 22px); font-weight: 750; color: var(--bad); }
/* 1.3: the fake invoice, the fooled agent, the verdict (code's), the lesson. Calm (Max's review): a plain card, the red
   kept for what differs and for the block. */
.tricked { display: grid; gap: 10px; padding: 14px 16px; border-radius: 16px; background: var(--sunken); border: 1px solid var(--border); }
.tricked .doc { margin: 0; padding: 10px 12px; border-radius: 10px; background: var(--surface); border: 1px dashed var(--border); font: 500 13.5px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre-wrap; overflow-wrap: anywhere; }
.tricked .fooled { margin: 0; font-size: 15.5px; color: var(--muted); }
.tricked .outcome { padding: 8px 12px; border-radius: 10px; background: var(--bad-soft); font-size: clamp(17px, 1.8vw, 19px); }
.pill.live { background: var(--ok-soft, var(--accent-soft)); color: var(--text); font-weight: 700; }
.tricked ul.calls { list-style: none; padding: 0; } .tricked ul.calls li { overflow-wrap: anywhere; margin-top: 6px; }
.tricked .lesson { margin: 0; font-weight: 750; font-size: 17px; }
.tricked ul { margin: 6px 0 0; padding-left: 18px; } .tricked li.blocks { color: var(--bad); font-weight: 600; }
/* 1.4: what a looser rule adds to the worst case. */
.wdiff { margin: 4px 0 0; font-weight: 750; font-size: 17px; } .wdiff.up { color: var(--bad); } .wdiff.down { color: var(--ok, var(--accent)); }
/* 6c: the world's hash chain on the closing card. */
.chainbox { display: grid; gap: 8px; justify-items: start; padding: 12px 14px; border-radius: 14px; background: var(--sunken); }
.chainbox[hidden], #c-verify[hidden] { display: none; }
.chainbox .cline { margin: 0; font-size: 15.5px; overflow-wrap: anywhere; } .chainbox code { font: 600 14px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
/* 1.5: the closing card's two other ways on, as buttons. */
.end .ends { display: flex; flex-wrap: wrap; gap: 10px; margin: 10px 0 0; }
.outcome[hidden] { display: none; }
.hashes { display: grid; gap: 8px; } .hashes p { margin: 0; }
#t-what, #t-why { overflow-wrap: anywhere; }
.tf { display: grid; grid-template-columns: minmax(0, 1fr); gap: 8px; }
.tf label[hidden] { display: none; }
.tf label, .tf .send { display: grid; gap: 4px; font-size: 14px; font-weight: 650; color: var(--muted); }
.tf input, .tf select { font: 600 16px/1.3 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; color: var(--text); background: var(--surface); border: 1px solid var(--border); border-radius: 10px; min-height: 46px; padding: 8px 10px; width: 100%; }
.tf .chg input, .tf .chg select { border-color: var(--bad); box-shadow: 0 0 0 2px var(--bad-soft); }
/* Screen 4: the rule. */
.worst { font-weight: 750; font-size: 17.5px; line-height: 1.35; padding: 10px 12px; border-left: 4px solid var(--accent); border-radius: 10px; background: var(--sunken); }
ul.locks1 { list-style: none; padding: 0; display: grid; gap: 6px; }
ul.locks1 li { display: flex; align-items: flex-start; gap: 8px; font-size: 15.5px; line-height: 1.4; }
ul.locks1 li .i { color: var(--ok); flex: none; margin-top: 2px; }
/* Each lock's channel, in front of its line (Max's review). */
ul.locks1 li .ch, .lock .ch, .lkh .ch { flex: none; display: inline-flex; align-items: center; padding: 1px 8px; border-radius: 999px; background: var(--sunken); color: var(--muted); font: 650 12.5px/1.5 Inter, system-ui, sans-serif; white-space: nowrap; }
ul.locks1 li .ch { min-width: 76px; justify-content: center; }
/* The worst case, and right under it why a looser rule needs a signature. */
.argue { display: grid; gap: 6px; padding: 10px 12px; border-left: 4px solid var(--accent); border-radius: 10px; background: var(--sunken); }
.argue > * { margin: 0; min-width: 0; } .argue .worst { padding: 0; border: 0; background: none; border-radius: 0; }
.argue.looser .worst.chg { color: var(--bad); }
.argue .note:empty { display: none; } .argue .note { margin: 0; }
.argue.looser { border-left-color: var(--bad); } .argue.looser .note.looser { color: var(--bad); }
p.worst.chg { color: var(--accent); }
ul.locks1 li.chg { font-weight: 700; } ul.locks1 li.chg .i { color: var(--accent); }
.note { font-weight: 650; } .note.looser { color: var(--accent); } .note.stricter { color: var(--ok); }
/* Screen 5: the next invoice, and the way on. */
.next { display: grid; gap: 6px; padding: 14px 16px; border-radius: 16px; border: 1px solid var(--border); }
.next > * { margin: 0; min-width: 0; overflow-wrap: anywhere; }
.next .amt { font-size: 22px; font-weight: 750; font-variant-numeric: tabular-nums; }
.next.alone { border-color: var(--ok); background: var(--ok-soft, var(--sunken)); }
.next .nv { font-weight: 700; } .next.alone .nv { color: var(--ok); }
.worst.big { font-size: clamp(19px, 2.2vw, 22px); }
nav.end { display: grid; gap: 4px; }
nav.end .btn { justify-content: center; min-height: 56px; font-size: 17px; }
.pill.alone { white-space: normal; background: var(--ok-soft, var(--accent-soft)); color: var(--ok); justify-self: start; }
.pill.said-before { white-space: normal; justify-self: start; }
.polnote { white-space: normal; background: var(--accent-soft); color: var(--accent); justify-self: start; }
/* Every field of the policy (#71), behind "Show all fields and what Purser sends". */
.policy > * { min-width: 0; }
#p-body[hidden] { display: none; }
.phead { display: flex; align-items: center; gap: 12px; }
.phead .pt { display: grid; gap: 2px; min-width: 0; } .phead b { font-size: 17px; } .phead small { color: var(--muted); font-size: 14.5px; line-height: 1.4; }
.pbody { display: grid; gap: 12px; }
.pbody > *, .pform > *, .lk > *, .locks3 > *, .prefused > * { min-width: 0; }
.ptop { display: flex; flex-wrap: wrap; gap: 8px 12px; align-items: end; }
.ptop label, .pform label, .pform fieldset { display: grid; gap: 4px; font-size: 14px; font-weight: 650; color: var(--muted); }
.pform { display: grid; grid-template-columns: minmax(0, 1fr); gap: 10px; align-items: start; }
.pexpo { display: grid; gap: 4px; border: 1px solid var(--border); border-left: 4px solid var(--accent); border-radius: 12px; padding: 10px 12px; background: var(--surface); }
.pexpo > * { margin: 0; min-width: 0; overflow-wrap: anywhere; } .pexpo .hl { font-weight: 750; font-size: 18px; line-height: 1.3; letter-spacing: -.01em; }
.pexpo details.how { font-size: 14px; color: var(--muted); } .pexpo details.how summary { cursor: pointer; color: var(--accent); font-weight: 600; min-height: 32px; display: flex; align-items: center; } .pexpo details.how ul { margin: 4px 0 0; padding-left: 18px; display: grid; gap: 4px; }
.pexpo #p-expo-next { color: var(--bad); font-weight: 650; } #p-expo-next[hidden] { display: none; }
.pform fieldset { border: 1px solid var(--border); border-radius: 10px; padding: 8px 10px; margin: 0; }
.pform fieldset legend { padding: 0 4px; }
.pform .cks { display: flex; flex-wrap: wrap; gap: 4px 12px; }
.pform label.ck { display: inline-flex; align-items: center; gap: 6px; font-weight: 600; color: var(--text); min-height: 32px; }
.pform input[type="checkbox"] { width: 18px; height: 18px; accent-color: var(--accent); }
.ptop select, .pform input:not([type="checkbox"]) { font: 600 16px/1.3 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; color: var(--text); background: var(--surface); border: 1px solid var(--border); border-radius: 10px; min-height: 46px; padding: 8px 10px; width: 100%; max-width: 100%; }
.ptop select { font-family: Inter, system-ui, sans-serif; width: auto; }
.pform .chg input:not([type="checkbox"]), .pform fieldset.chg { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent-soft); }
.pacts { display: flex; flex-wrap: wrap; gap: 8px; }
.prefused { display: grid; gap: 10px; border-radius: 14px; padding: 12px 14px; background: var(--bad-soft); }
.prefused[hidden], #pl-pay[hidden], #p-sign[hidden] { display: none; }
.locks3 { display: grid; gap: 12px; }
.lk { border: 1px solid var(--border); border-radius: 14px; padding: 12px 14px; display: grid; gap: 8px; align-content: start; background: var(--surface); }
.lk-awx { border-top: 3px solid var(--awx); } .lk-metal { border-top: 3px solid var(--metal); } .lk-purser { border-top: 3px solid var(--accent); }
.lkh { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px; } .lkh b { font-size: 16px; }
.lkh .n { width: 24px; height: 24px; border-radius: 50%; background: var(--sunken); display: grid; place-items: center; font: 700 13px/1 Inter, system-ui, sans-serif; flex: none; }
.lk .state { white-space: normal; } .lk .state.proposed { background: var(--bad-soft); color: var(--bad); }
.lk .ns { margin: 0; font-size: 13.5px; font-weight: 700; color: var(--muted); }
.lk .unit { margin: 0; font-size: 14px; font-weight: 650; color: var(--text); background: var(--sunken); border-radius: 8px; padding: 6px 10px; }
.lk ul { margin: 0; padding-left: 18px; display: grid; gap: 4px; font-size: 14.5px; line-height: 1.45; }
.lk li.bad { color: var(--bad); } .lk li.ok { color: var(--ok); }
.lk pre { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; background: var(--sunken); border-radius: 10px; padding: 8px 10px; }
.lk pre .ln.chg { background: var(--accent-soft); color: var(--text); font-weight: 700; }
.lk dl { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 4px 10px; margin: 0; font-size: 14.5px; }
.lk dt { color: var(--muted); } .lk dd { margin: 0; font-weight: 650; overflow-wrap: anywhere; } .lk dd.chg { color: var(--accent); }
.others { display: grid; gap: 12px; }
/* The diagram: one policy, three locks; the part of it each screen is about lights up. Below 1024 px it is hidden. */
.diagram { display: none; }
@media (min-width: 1024px) {
  .story { grid-template-columns: minmax(0, 1fr) minmax(0, 420px); gap: 28px; max-width: 1140px; }
  .scr { max-width: none; }
  .diagram { display: grid; gap: 10px; padding: 20px; position: sticky; top: 84px; }
  .diagram .eyebrow { margin: 0; }
  .dn { display: grid; grid-template-columns: 22px minmax(0, 1fr); gap: 10px; align-items: start; padding: 11px 13px; border-radius: 14px; border: 1px solid var(--border); background: var(--surface); transition: background .25s, border-color .25s, opacity .25s; opacity: .55; }
  .dn b { display: block; font-size: 15.5px; } .dn small { display: block; color: var(--muted); font-size: 14px; line-height: 1.4; overflow-wrap: anywhere; }
  .dn small.ch { font-size: 12.5px; font-weight: 650; text-transform: uppercase; letter-spacing: .04em; color: var(--faint); }
  .dn.d-policy { opacity: 1; }
  ol.dlocks { list-style: none; margin: 0 0 0 22px; padding: 0 0 0 16px; border-left: 2px solid var(--border); display: grid; gap: 8px; }
  ol.dlocks li { position: relative; } ol.dlocks li::before { content: ""; position: absolute; left: -18px; top: 22px; width: 16px; border-top: 2px solid var(--border); }
  .dn.lit { opacity: 1; border-color: var(--accent); background: var(--accent-soft); }
  .dn.d-alone.lit { border-color: var(--ok); background: var(--ok-soft, var(--accent-soft)); }
  .dnote { margin: 0; font-size: 14.5px; font-weight: 650; }
}
@media (min-width: 720px) { .tf { grid-template-columns: minmax(0, .9fr) minmax(0, 2.1fr) minmax(0, .7fr) minmax(0, .9fr); } .hashes { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); } .pform { grid-template-columns: repeat(2, minmax(0, 1fr)); } .pform fieldset { grid-column: span 2; } }
@media (min-width: 1280px) { .locks3 { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
@media (max-width: 640px) {
  .scr { padding: 18px 16px 0; gap: 12px; } .bar { margin: 2px -16px 0; padding: 10px 16px calc(12px + env(safe-area-inset-bottom)); }
  .scr h1, .scr h2 { font-size: 24px; }
  .btn { white-space: normal; height: auto; min-height: 48px; }
}`;

// The page script: no backticks and no "${" in here (it lives in a template string). Text from the server goes in with
// textContent; the only markup set is the icons, built on the server from the fixed icon set.
const JS = `
(function () {
  "use strict";
  var D = JSON.parse(document.getElementById("run-data").textContent);
  var $ = function (id) { return document.getElementById(id); };
  var S = { token: null, world: null, options: null, credId: null, signed: null, timer: null, screen: 0, choice: null, did: {} };
  var W = D.screens;

  function el(tag, cls, kids) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    (kids || []).forEach(function (k) { if (k !== null && k !== undefined) n.appendChild(typeof k === "string" ? document.createTextNode(k) : k); });
    return n;
  }
  // One sentence, and the rest behind a native "more" toggle.
  function more(text) { return el("details", "more", [el("summary", "", ["more"]), el("p", "", [text])]); }
  function ic(name) { var s = document.createElement("span"); s.innerHTML = D.icons[name]; return s.firstChild; }
  function status(id, text, tone) { var n = $(id); n.textContent = text; n.className = "status" + (tone ? " " + tone : ""); }
  // Motion (150 to 400 ms each, never in the way): with prefers-reduced-motion, the end state at once.
  function still() { return !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches); }
  // A class whose animation plays again each time (taken off, the layout read, put back).
  function replay(n, cls) { n.classList.remove(cls); if (still()) return; void n.offsetWidth; n.classList.add(cls); }
  // A number that counts up: the element holds its final words at once (what a screen reader and a test read); while
  // it counts, those words are see-through and the counting words are drawn over them (data-count, a ::after).
  function countTo(n, text, at) {
    n.textContent = text;
    if (n.raf) cancelAnimationFrame(n.raf);
    var end = function () { n.raf = 0; n.classList.remove("counting"); n.removeAttribute("data-count"); };
    if (still() || !at) { end(); return; }
    var t0 = performance.now();
    n.classList.add("counting");
    n.dataset.count = at(0);
    var f = function (now) {
      var p = Math.min(1, (now - t0) / 360);
      if (p >= 1) { end(); return; }
      n.dataset.count = at(1 - Math.pow(1 - p, 3));
      n.raf = requestAnimationFrame(f);
    };
    n.raf = requestAnimationFrame(f);
  }

  // ── The five screens: one shows at a time; the dots, the count and the diagram follow it. ──
  function go(n) {
    S.screen = n;
    for (var k = 0; k <= 7; k++) $("scr-" + k).hidden = k !== n;
    for (var i = 1; i <= 6; i++) {
      var li = $("pg-" + i);
      li.classList.toggle("done", i < n); li.classList.toggle("on", i === n);
      if (i === n) li.setAttribute("aria-current", "step"); else li.removeAttribute("aria-current");
    }
    $("pg-count").textContent = n === 0 ? "6 steps · about a minute" : n === 7 ? "Done" : n + " of 6 · " + D.steps[n - 1];
    $("diagram").dataset.step = String(n);
    window.scrollTo({ top: 0, behavior: "instant" });
    var h = $("scr-" + n).querySelector("h1, h2");
    if (h && n > 0) h.focus({ preventScroll: true });
  }

  // A hash as the page shows it: the first 12 and last 8 characters (the first 8 stressed), the whole hash on a tap,
  // with Copy. Copy that fails (no clipboard) shows the whole hash to select instead.
  function hashBox(h, cls) {
    var code = el("code", "", []);
    var show = function (all) { code.replaceChildren(el("b", "", [h.slice(0, 8)]), all ? h.slice(8) : h.slice(8, 12) + "…" + h.slice(-8)); };
    show(false);
    code.title = h;
    var b = el("button", "copy", ["Copy"]);
    b.type = "button";
    b.setAttribute("aria-label", "Copy the whole hash");
    b.addEventListener("click", function () {
      var done = function (ok) {
        b.replaceChildren(ok ? ic("check") : "", ok ? "Copied" : "Select the hash");
        b.classList.toggle("ok", ok);
        if (!ok) { show(true); x.setAttribute("aria-expanded", "true"); }
      };
      if (!navigator.clipboard) { done(false); return; }
      navigator.clipboard.writeText(h).then(function () { done(true); }, function () { done(false); });
    });
    var x = el("button", "exp", [code]);
    x.type = "button";
    x.setAttribute("aria-expanded", "false");
    x.setAttribute("aria-label", "Show the whole hash");
    x.addEventListener("click", function () { var all = x.getAttribute("aria-expanded") !== "true"; show(all); x.setAttribute("aria-expanded", String(all)); });
    var box = el("div", "hash" + (cls ? " " + cls : ""), [x, b]);
    box.dataset.hash = h;
    return box;
  }
  function group(s) { return String(s).replace(/\\B(?=(\\d{3})+(?!\\d))/g, ","); }
  function amt(cur, s) { var p = String(s).split("."); return cur + " " + group(p[0]) + (p.length > 1 ? "." + p[1] : ""); }
  function eur(s) { var p = String(s).split("."); return "EUR " + group(p[0]) + "." + (p[1] || "00"); }
  // Short euros for the rule: €2,000 (cents only when there are any).
  function euro(s) { var p = String(s).split("."); return "€" + group(p[0]) + (p[1] && p[1] !== "00" ? "." + p[1] : ""); }
  function iban(s) { return String(s).replace(/(.{4})/g, "$1 ").trim(); }

  // Bytes.
  function toB64u(buf) { var u = new Uint8Array(buf), s = ""; for (var i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return btoa(s).replace(/\\+/g, "-").replace(/\\//g, "_").replace(/=+$/, ""); }
  function fromB64u(s) { var b = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)); var u = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }
  function hexToBytes(h) { var u = new Uint8Array(h.length / 2); for (var i = 0; i < u.length; i++) u[i] = parseInt(h.substr(2 * i, 2), 16); return u; }
  function sha256(text) { return crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)).then(function (d) { return Array.from(new Uint8Array(d)).map(function (b) { return b.toString(16).padStart(2, "0"); }).join(""); }); }
  // Canonical JSON (RFC 8785 for terms without numbers), as the approval page and the server compute it.
  function canon(v) {
    if (v === null || typeof v === "boolean" || typeof v === "string") return JSON.stringify(v);
    if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
    if (typeof v === "object") return "{" + Object.keys(v).sort().map(function (k) { return JSON.stringify(k) + ":" + canon(v[k]); }).join(",") + "}";
    throw new Error("terms carry no numbers");
  }

  function post(path, body) {
    return fetch("/api/try-sign/" + path, { method: "POST", credentials: "omit", cache: "no-store", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { status: r.status, data: d }; }); })
      .catch(function () { return { status: 0, data: { error: "the server cannot be reached" } }; });
  }
  function passkeyError(e) {
    var n = e && e.name;
    if (n === "NotAllowedError") return "Cancelled or timed out. Nothing was signed.";
    if (n === "NotSupportedError") return "This device offers no ES256 passkey, the kind the server checks. Try a phone by QR code.";
    if (n === "SecurityError") return "The browser refused: passkeys need this site's own address over HTTPS.";
    if (n === "InvalidStateError") return "This authenticator already has a passkey for this world.";
    return "The passkey did not work here (" + (n || "error") + ").";
  }

  function tick() {
    if (!S.world) return;
    var ms = Date.parse(S.world.expires_at) - Date.now();
    if (ms <= 0) {
      clearInterval(S.timer);
      document.querySelectorAll("[data-left]").forEach(function (n) { n.textContent = "expired"; });
      document.querySelectorAll("button[data-world]").forEach(function (b) { b.disabled = true; });
      status("w-status", "This test world has expired and is deleted. Reload the page to start a new one.", "bad");
      return;
    }
    var m = Math.floor(ms / 60000), s = Math.floor((ms % 60000) / 1000);
    document.querySelectorAll("[data-left]").forEach(function (n) { n.textContent = (n.dataset.left === "in" ? "in " : "") + m + " min " + String(s).padStart(2, "0") + " s"; });
    // The quote's own countdown; once it has passed, the signature it would carry is worthless: get a new quote.
    var gone = false;
    document.querySelectorAll("[data-until]").forEach(function (n) {
      var q = Date.parse(n.dataset.until) - Date.now();
      if (q <= 0) { n.textContent = "expired"; gone = true; return; }
      n.textContent = "in " + Math.floor(q / 60000) + " min " + String(Math.floor((q % 60000) / 1000)).padStart(2, "0") + " s";
    });
    if (gone) quoteExpired();
  }
  // While the quote is expired, the one action on screen 1 is "Get a new quote": no signature until new terms are here.
  function quoteExpired() {
    if (S.signed || !S.x || !S.x.terms.fx) return;
    S.quoteGone = true;
    $("go-sign").disabled = true; $("go-sign").hidden = true;
    if (!$("go-quote").hidden) return;
    $("go-quote").hidden = false; $("go-quote").disabled = false;
    status("q-status", "Quote expired. Get a fresh one and sign again.", "bad");
  }

  // ── Screen 1: the world opens when the page is shown; the agents' steps; the agent's request, and one button. ──
  function openWorld() {
    if (S.opening) return;
    if (S.world) { runAgents(); return; }
    S.opening = true;
    $("go-retry").hidden = true; $("go-sign").hidden = false; $("go-sign").disabled = true;
    status("w-status", W.ask.opening);
    post("world", {}).then(function (r) {
      S.opening = false;
      if (r.status !== 201) {
        status("w-status", "No test world: " + (r.data.error || ("error " + r.status)) + ".", "bad");
        $("go-sign").hidden = true; $("go-retry").hidden = false; $("go-retry").disabled = false;
        return;
      }
      S.token = r.data.world.token; S.world = r.data.world; S.options = r.data.passkey_options;
      $("w-id").textContent = S.world.id;
      worldFacts(S.world);
      S.timer = setInterval(tick, 1000);
      policyState(r.data); fillForm(); inForceView();
      return showProposals(r.data.proposals).then(function () { tick(); status("w-status", ""); runAgents(); });
    });
  }
  $("go-retry").addEventListener("click", openWorld);

  // The agents' steps (spec 6b): one request per step, in order; each step drawn from the server's own answer. While a
  // step runs elsewhere the server says "busy" and the page asks again in a moment.
  function stepRow(name) { return $("st-" + name); }
  function stepWho(row, who, label, live) {
    var b = el("b", "", [who]);
    var kids = [b, " "];
    if (label) { var pl = el("span", "pill" + (live ? " live" : ""), [label]); pl.dataset.label = "1"; kids.push(pl); }
    row.querySelector(".sl").replaceChildren.apply(row.querySelector(".sl"), kids);
  }
  function fld(text) { return el("span", "fld", [text]); }
  function day(iso) { var m = /^(\\d{4})-(\\d{2})-(\\d{2})$/.exec(iso || ""); return m ? Number(m[3]) + " " + ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(m[2]) - 1] : iso; }
  function adviceWords(a) {
    var m = /^wait_until (\\d{4}-\\d{2}-\\d{2})$/.exec(a || "");
    return a === "pay_now" ? "Advice: pay now" : m ? "Advice: wait until " + day(m[1]) + " — you decide" : null;
  }
  function drawStep(name, r) {
    var row = stepRow(name), sd = row.querySelector(".sd");
    row.className = "st done"; row.dataset.state = "done";
    if (name === "read") {
      stepWho(row, "Read", r.by, r.source === "live");
      var f = r.fields;
      sd.replaceChildren(fld(f.vendor), fld(amt(f.currency, f.amount)), fld("IBAN …" + String(f.iban).slice(-4)), fld(f.invoice_no), fld("due " + day(f.due_date)));
    } else if (name === "check") {
      stepWho(row, D.codeLabel, null, false);
      sd.replaceChildren(el("ul", "ticks", r.ticks.map(function (t) { var li = el("li", t.ok ? "ok" : "bad", [ic(t.ok ? "check" : "octagon-x"), t.label]); li.dataset.tick = t.id; return li; })));
    } else if (name === "quote") {
      stepWho(row, r.fx && r.fx.status !== "unavailable" ? "Quote" : D.codeLabel, r.fx && r.fx.status !== "unavailable" ? r.by : null, false);
      var q = r.fx && r.fx.status !== "unavailable" ? r.fx.quote : null;
      S.fx = r.fx || null; S.agentsPlan = r.plan_words || "";
      sd.replaceChildren.apply(sd, r.skipped ? [fld("Not planned: the invoice is blocked.")] : r.no_fx ? [fld("No FX needed.")]
        : [fld(amt(q ? q.buy_currency : "EUR", r.plan.buy) + (q ? " for " + amt(q.sell_currency, q.sell_amount) : " short")), fld(q ? "quote " + q.quote_id.slice(0, 8) + "…" : "no live quote")]);
    } else if (name === "advise") {
      stepWho(row, "Advice", r.label || r.by, r.source === "live");
      sd.replaceChildren(fld(adviceWords(r.advice) || "No advice"));
    } else if (name === "ready") {
      stepWho(row, D.codeLabel, null, false);
      sd.replaceChildren(fld(W.ask.ready));
    }
    var next = row.nextElementSibling;
    if (next) { next.className = "st pending"; next.dataset.state = "pending"; }
  }
  function runAgents() {
    if (S.agentsBusy || S.agentsDone || !S.token) return;
    S.agentsBusy = true;
    $("go-retry").hidden = true;
    (function next() {
      post("agents", { token: S.token }).then(function (r) {
        if (r.status === 409 && r.data.busy) { setTimeout(next, 700); return; }
        if (r.status !== 200) {
          S.agentsBusy = false;
          status("w-status", "The agents stopped: " + (r.data.error || ("error " + r.status)) + ".", "bad");
          $("go-sign").hidden = true; $("go-retry").hidden = false; $("go-retry").disabled = false;
          return;
        }
        drawStep(r.data.step, r.data.result);
        if (r.data.step !== "ready") { next(); return; }
        S.agentsBusy = false; S.agentsDone = true; S.agents = r.data.agents;
        policyState(r.data); worldFacts(r.data.world); fillForm(); inForceView();
        agentsFold(r.data.agents);
        showProposals(r.data.proposals);
      });
    })();
  }
  // "What the agents did": the steps (moved into the fold), each call with its model, time and request id, the plan in
  // code's words and what the reader read.
  function agentsFold(a) {
    var body = $("s1-did-body");
    $("s1-steps").classList.add("settled");
    body.insertBefore($("s1-steps"), body.firstChild);
    $("s1-calls").replaceChildren.apply($("s1-calls"), a.calls.map(function (c) {
      return el("li", "", [el("b", "", [c.step]), " · " + (c.model || D.codeLabel) + (c.ms != null ? " · " + (c.ms / 1000).toFixed(1) + " s" : "") + (c.request_id ? " · " + c.request_id : ""), el("br", "", []), c.input + " → " + c.output]);
    }));
    var plan = S.agentsPlan || "";
    $("s1-plan").textContent = plan;
    var rd = a.reading;
    if (rd) {
      var who = rd.source === "live" ? (/^stand-in/.test(rd.label) ? "The stand-in" : "Claude Sonnet") : rd.source === "recorded" ? "Claude Sonnet (recorded)" : D.codeLabel;
      $("s1-read").textContent = who + " read: Pay " + amt(rd.currency, rd.amount) + " to " + rd.vendor + ", IBAN …" + String(rd.iban).slice(-4) + "." + (rd.note ? " " + rd.note + "." : "");
    }
    $("s1-did").hidden = false;
  }

  function makePasskey() {
    var o = S.options;
    return navigator.credentials.create({ publicKey: {
      challenge: fromB64u(o.challenge), rp: o.rp, user: { id: fromB64u(o.user.id), name: o.user.name, displayName: o.user.displayName },
      pubKeyCredParams: o.pubKeyCredParams, timeout: o.timeout, attestation: o.attestation, authenticatorSelection: o.authenticatorSelection
    } }).then(function (c) {
      if (!c) return { ok: false, again: true, msg: "Cancelled. No passkey was made." };
      var body = { token: S.token, credential: { id: c.id, rawId: toB64u(c.rawId), type: c.type, response: { clientDataJSON: toB64u(c.response.clientDataJSON), attestationObject: toB64u(c.response.attestationObject) } } };
      return post("passkey", body).then(function (r) {
        if (r.status !== 201) return { ok: false, again: false, msg: "Not accepted: " + (r.data.error || ("error " + r.status)) + "." };
        S.credId = c.id;
        $("k-status").textContent = "Your test passkey is made and registered in this world only (" + c.id.slice(0, 10) + "…).";
        return { ok: true };
      });
    }, function (e) { return { ok: false, again: true, msg: passkeyError(e) }; });
  }

  // Who wrote the agent's sentence: Claude Opus live, a labelled stand-in (local checks only), its recording, or the
  // fixed text, each with why, as the server labels it.
  function voiceLabel(v) { return v ? v.label : "fixed text, no model call"; }
  function agentLine(p) {
    var pill = el("span", "pill" + (p.voice && p.voice.source === "live" ? " live" : ""), [voiceLabel(p.voice)]);
    pill.dataset.voice = p.voice ? p.voice.source : "fixed";
    return el("div", "who", [el("span", "av", [ic("landmark")]), p.agent, pill]);
  }
  // On screen 1 the heading names the agent: its avatar and who wrote the sentence only.
  function askLine(p) {
    var w = agentLine(p);
    w.childNodes[1].remove();
    w.firstChild.setAttribute("aria-label", p.agent);
    return w;
  }
  function voiceMore(p) {
    var v = p.voice;
    if (!v) return null;
    if (v.source === "live") return more("Request id " + (v.request_id || "none") + " (" + v.model + "). The agent was given only the invoice and this test world's balances, floors, plan and quote, never your words. It only advises: the amounts, the checks and the approval are code and your passkey.");
    if (v.source === "recorded") return more("A recorded real answer (request id " + (v.request_id || "none") + ", " + v.model + "), checked by code like a live one. Shown because: " + v.why + ".");
    return more("The fixed sentence: " + v.why + ".");
  }
  function factsOf(p, t) {
    return el("dl", "facts", [
      el("dt", "", ["Amount"]), el("dd", "amount", [amt(t.currency, t.amount)]),
      el("dt", "", ["Beneficiary"]), el("dd", "", [t.payee]),
      el("dt", "", ["IBAN"]), el("dd", "mono", [iban(t.payee_iban)]),
      el("dt", "", ["Reference"]), el("dd", "", [t.reference]),
      el("dt", "", ["Proposal"]), el("dd", "", [p.proposal_id])
    ].concat(t.fx ? [el("dt", "", ["FX quote"]), el("dd", "", [fxLine(t.fx)])] : []));
  }
  function fxFrom(q) { return q.source === "stand-in" ? "a stand-in (a local check, not Airwallex)" : "the Airwallex sandbox (a test environment)"; }
  function fxLine(q) { return amt(q.buy_currency, q.buy_amount) + " for " + amt(q.sell_currency, q.sell_amount) + " at " + q.client_rate + " · quote " + q.quote_id.slice(0, 8) + "…"; }
  // No live quote (no sandbox key, or the limit reached): said in four words; the terms show the main run's, labelled.
  function quoteLine(t) {
    if (t.fx) return el("span", "fx", [(t.fx.source === "stand-in" ? "stand-in quote: " : "live Airwallex quote: ") + amt(t.fx.sell_currency, t.fx.sell_amount)]);
    return el("span", "fx", ["no live quote now"]);
  }

  // The world's proposals: T-0002 is screen 1's request, T-0001 (stopped by a rule) is behind its closed line; T-0003,
  // the next invoice, is screen 5's. Every other state (a policy that made one wait, or blocked one) shows on screen 5.
  function showProposals(list) {
    S.list = list;
    return Promise.all(list.map(function (p) {
      var terms = JSON.parse(p.canonical);
      return sha256(canon(terms)).then(function (h) { return { p: p, terms: terms, mine: h, same: canon(terms) === p.canonical && h === p.terms_sha256 }; });
    })).then(function (rows) {
      S.rows = rows;
      // Each payment's check as it was first seen (T-0002 arrives with the agents' last step, T-0003 after signing).
      if (!S.firstCheck) S.firstCheck = {};
      rows.forEach(function (x) { if (!(x.p.proposal_id in S.firstCheck)) S.firstCheck[x.p.proposal_id] = x.p.check; });
      var t2 = rows.filter(function (x) { return x.p.proposal_id === D.waiting; })[0];
      if (t2 && !S.signed) drawAsk(t2);
      var t1 = rows.filter(function (x) { return x.p.proposal_id === D.blocked; })[0];
      if (t1 && t1.p.check === "fail") $("s1-blocked").replaceChildren(blocked(t1));
      drawOthers(rows);
      drawNext(rows);
    });
  }
  function drawAsk(x) {
    S.x = x;
    var p = x.p, t = x.terms;
    var adv = adviceWords(t.agent_advice);
    var advice = adv ? el("p", "advice", [adv]) : null;
    if (advice) advice.id = "s1-advice";
    $("s1-ask").replaceChildren.apply($("s1-ask"), [askLine(p), el("p", "says", [p.says]), advice].filter(Boolean));
    $("s1-ask").hidden = false; $("s1-pay").hidden = false; $("s1-terms").hidden = false;
    // One line: the payee as a person reads it (the terms behind "Show the exact terms" name it in full, "(test payee)").
    $("s1-to").replaceChildren(t.payee.replace(/ \\(test payee\\)$/, "") + " · ", el("span", "nw", [t.reference.replace(/^Invoice /, "")]));
    $("s1-amt").textContent = amt(t.currency, t.amount);
    $("s1-fx").replaceWith(Object.assign(quoteLine(t), { id: "s1-fx" }));
    // The exact terms: the table, the hash this device computed, every field as hashed, the quote, the CFO's sheet.
    var facts = factsOf(p, t);
    var left = el("dd", "", []); left.dataset.left = "in";
    facts.append(el("dt", "", ["Proposal expires"]), left);
    if (t.fx) { var ql = el("dd", "", []); ql.dataset.until = t.fx.valid_to_at; ql.id = "q-left"; facts.append(el("dt", "", ["Quote expires"]), ql); }
    var vm = voiceMore(p);
    var kids = [facts, vm ? el("div", "", [el("p", "small muted", ["Who wrote the agent's sentence: " + voiceLabel(p.voice) + "."]), vm]) : null,
      el("div", "", [el("p", "small muted", ["The hash of the exact terms, which your passkey signs" + (x.same ? " (checked on this device):" : ":")]), hashBox(x.mine)]),
      el("details", "more terms", [el("summary", "", ["All terms (exactly what is hashed)"]), el("pre", "terms", [p.canonical])])];
    if (t.fx) kids.push(el("div", "", [el("p", "small muted", ["The live FX quote is part of these terms, so your signature covers its quote id and ends with it."]), more("Quote " + t.fx.quote_id + " from " + fxFrom(t.fx) + ": the Treasury agent holds USD and the invoice is in EUR, so it would buy " + amt(t.fx.buy_currency, t.fx.buy_amount) + " for " + amt(t.fx.sell_currency, t.fx.sell_amount) + " at " + t.fx.client_rate + ". Nothing is converted. Once the quote expires, the server refuses the signature: get a new quote and sign the new terms.")]));
    kids.push(lockQuote());
    kids.push(el("p", "small muted", ["One tap: a test passkey for this world first, then your signature."]), more("A random id, no name or e-mail, kept on your device for this site only; it opens this test world and nothing else. Face ID, Touch ID, Windows Hello, a security key, or your phone by QR code."));
    kids.push(el("p", "basis", [D.cfo]));
    $("s1-terms-body").replaceChildren.apply($("s1-terms-body"), kids);
    $("scr-1").dataset.proposal = p.proposal_id;
    $("go-sign").hidden = false; $("go-quote").hidden = true;
    $("go-sign").disabled = !x.same;
    if (!x.same) status("s1-status", "The terms do not hash to the hash the server sent. Do not sign.", "bad");
    if (S.credId) $("k-status").textContent = "Your test passkey is kept (" + S.credId.slice(0, 10) + "…). Sign these terms.";
  }

  // "Sign with Face ID": the test passkey first when there is none (one tap, two prompts), then the signature.
  $("go-sign").addEventListener("click", function () {
    var b = $("go-sign"), x = S.x;
    if (!x || !x.same) return;
    b.disabled = true;
    status("s1-status", S.credId ? "Waiting for Face ID…" : "First your test passkey for this world, then your signature: waiting for Face ID…");
    (S.credId ? Promise.resolve({ ok: true }) : makePasskey()).then(function (k) {
      if (!k.ok) { status("s1-status", k.msg, "bad"); b.disabled = !!S.quoteGone || !k.again; return; }
      return sign(x, b);
    });
  });

  // "Get a new quote": new terms (the new quote in them), checked on this device again, to sign again.
  $("go-quote").addEventListener("click", function () {
    var btn = $("go-quote");
    btn.disabled = true;
    status("q-status", "Asking the Airwallex sandbox for a new quote…");
    post("quote", { token: S.token }).then(function (r) {
      if (r.status !== 200) { status("q-status", "No new quote: " + (r.data.error || ("error " + r.status)).replace(/^no new live quote: /, "") + ".", "bad"); btn.disabled = false; return; }
      S.fx = r.data.fx;
      S.quoteGone = false;
      if (r.data.paid_alone && r.data.paid_alone.length) { policyState(r.data); worldFacts(r.data.world); S.base = renderLocks(S.locks[S.agent], false, S.base); }
      var p = r.data.proposal, terms = JSON.parse(p.canonical);
      if (p.proposal_id !== D.waiting) { status("q-status", "A new quote for " + p.proposal_id + ": new terms.", "ok"); btn.hidden = true; return; }
      return sha256(canon(terms)).then(function (h) {
        drawAsk({ p: p, terms: terms, mine: h, same: canon(terms) === p.canonical && h === p.terms_sha256 });
        tick();
        status("q-status", "A new quote, so new terms: sign them.", "ok");
      });
    });
  });

  // At the Airwallex lock: the live quote used in this signature, or, without one, the main run's, labelled recorded.
  function lockQuote() {
    var f = S.fx, box;
    if (f && f.status !== "unavailable") {
      var q = f.quote, left = el("b", "", []);
      left.dataset.until = q.valid_to_at;
      box = el("div", "fxq live", [
        el("div", "lh", [el("span", "tag", ["Used in this signature"]), q.source === "stand-in" ? "Stand-in quote (local check, not Airwallex)" : "Live quote, Airwallex sandbox"]),
        el("span", "", [amt(q.buy_currency, q.buy_amount) + " for " + amt(q.sell_currency, q.sell_amount) + " at " + q.client_rate + ". Quote " + q.quote_id.slice(0, 8) + "…" + q.quote_id.slice(-4) + ". Quote expires: ", left, "."]),
        more((q.source === "stand-in" ? "A stand-in gave this quote: a local check, not Airwallex." : "Read-only: Airwallex's sandbox (a test environment) was asked for a quote, and nothing was converted or paid.") + (f.status === "reused" ? " Shared: asked for a moment ago for another visitor, as many asked at once." : ""))
      ]);
    } else {
      var r = D.recordedFx;
      box = el("div", "fxq recorded", [
        el("div", "lh", [el("span", "tag", ["Recorded, not live"]), "Not in this signature"]),
        el("span", "", ["No live quote now (" + ((f && f.reason) || "none") + "). The main run's quote, " + r.run + ": " + amt(r.buy_currency, r.buy_amount) + " for " + amt(r.sell_currency, r.sell_amount) + " at " + r.client_rate + " (quote " + r.quote_id.slice(0, 8) + "…)."])
      ]);
    }
    box.id = "fx-lock";
    return box;
  }

  // The payment a rule stopped: nothing to sign, and which of the three locks stopped it, each with its real example.
  function blocked(x) {
    var p = x.p, t = x.terms;
    var locks = el("div", "locks", [el("h3", "", ["Which lock stopped it"])]);
    D.locks.forEach(function (l) {
      var hit = l.id === "purser";
      var a = el("a", "", [l.link, ic(/^https?:/.test(l.href) ? "external-link" : "arrow-right")]);
      a.href = l.href;
      if (/^https?:/.test(l.href)) { a.target = "_blank"; a.rel = "noopener noreferrer"; }
      var row = el("div", "lock " + l.id + (hit ? " hit" : ""), [
        el("div", "lh", [ic(hit ? "octagon-x" : "lock"), l.name, el("span", "ch", [D.channels[l.id] ? D.channels[l.id].long : ""]), el("span", "tag", [hit ? "Stopped this one (simulated)" : "Not this one"])]),
        el("span", "", [hit ? p.rule : l.what]), a, more("Real example, " + l.run + ": " + l.example)
      ]);
      row.dataset.lock = l.id;
      locks.appendChild(row);
    });
    locks.appendChild(el("p", "small muted", ["Your blocked payment is a simulation in your test world; the examples are real, from the runs named."]));
    var a = el("article", "card prop blocked", [
      el("p", "eyebrow", ["Blocked · " + p.proposal_id]), policyNote(p, "pass"),
      agentLine(p), el("p", "says", [p.says]), factsOf(p, t),
      el("div", "chk fail", [el("b", "", [ic("octagon-x"), "Check: fail · blocked by a rule"]), el("span", "", [p.rule]), el("span", "", ["Nothing to sign: no signature can approve this."])]),
      locks
    ]);
    a.dataset.proposal = p.proposal_id;
    return a;
  }
  // A payment whose check the visitor's policy turned around says so (was blocked, now passes; or the reverse).
  function policyNote(p, was) {
    if (!S.firstCheck || S.firstCheck[p.proposal_id] !== was) return null;
    var n = el("p", "pill polnote", [was === "fail" ? "Was blocked by a rule; the policy you set lets it pass" : "Was allowed; the stricter policy you set blocks it"]);
    n.dataset.note = was === "fail" ? "now-allowed" : "now-blocked";
    return n;
  }

  function assertionOf(c) {
    return { id: c.id, rawId: toB64u(c.rawId), type: c.type, response: { clientDataJSON: toB64u(c.response.clientDataJSON), authenticatorData: toB64u(c.response.authenticatorData), signature: toB64u(c.response.signature) } };
  }
  function getSignature(sha) {
    return navigator.credentials.get({ publicKey: { challenge: hexToBytes(sha), rpId: location.hostname, allowCredentials: [{ type: "public-key", id: fromB64u(S.credId) }], userVerification: "required", timeout: 60000 } });
  }

  // Screen 1's signature, checked by the server; verified, screen 2.
  function sign(x, b) {
    status("s1-status", "Waiting for Face ID…");
    return getSignature(x.mine).then(function (c) {
      if (!c) { status("s1-status", "Cancelled. Nothing was signed.", "bad"); b.disabled = false; return; }
      var a = assertionOf(c);
      status("s1-status", "Purser is checking your signature…");
      return post("sign", { token: S.token, proposal_id: x.p.proposal_id, canonical: x.p.canonical, credential: a }).then(function (r) {
        if (r.status !== 200 && r.data.why === "quote_expired") { status("s1-status", ""); quoteExpired(); status("q-status", r.data.error, "bad"); return; }
        if (r.status !== 200 || r.data.verified !== true) { status("s1-status", "Not accepted: " + (r.data.reason || r.data.error || ("error " + r.status)) + ".", "bad"); b.disabled = false; return; }
        S.signed = { x: x, a: a, d: r.data };
        status("s1-status", "Signed, verified and executed in your test world.", "ok");
        showResult(x, r.data);
        // The next invoice arrived with this signature: the world as it is now, for screens 4 and 5.
        if (r.data.proposals) { policyState(r.data); worldFacts(r.data.world); fillForm(); S.base = renderLocks(S.locks[S.agent], false); return showProposals(r.data.proposals); }
      });
    }, function (e) { status("s1-status", passkeyError(e), "bad"); b.disabled = false; });
  }

  // ── Screen 2: signed and verified. ──
  function showResult(x, d) {
    $("r-hash").replaceChildren(hashBox(d.terms_sha256));
    $("r-checks").replaceChildren(el("span", "small muted", ["Checked by the server with the relay's passkey verifier."]), more("Checked: " + d.checks.join(", ") + "."));
    var e = d.executed;
    $("r-exec").replaceChildren(el("span", "small muted", [eur(e.amount) + " to " + e.payee.replace(/ \\(test payee\\)$/, "") + "."]), more("Test transfer " + e.id + ": " + eur(e.amount) + " to " + e.payee + (e.fx_bought ? ", after converting " + eur(e.fx_bought) + " for " + amt("USD", e.fx_sold) : "") + ". Test balances now " + eur(e.balance_after) + " and " + amt("USD", e.usd_after) + ". " + (e.fee ? e.fee + " " : "") + "By the " + e.by + "."));
    // The receipt to /try/verify in the link's #fragment, which a browser never sends to a server.
    $("r-verify").href = "/try/verify#receipt=" + toB64u(new TextEncoder().encode(JSON.stringify(receipt())));
    resetTamper();
    S.did.signed = true;
    go(2);
  }
  $("go-cheat").addEventListener("click", function () { go(3); cheat("cent"); });

  // ── The receipt: everything needed to check the signature offline, and nothing secret (no world token). ──
  function receipt() {
    var s = S.signed, a = s.a, k = s.d.public_key;
    return {
      receipt: D.receipt, note: "A signature made on /try/sign in a test world: nothing real moved. Check it offline: npm run verify-receipt -- receipt.json",
      terms: JSON.parse(s.x.p.canonical), terms_sha256: s.d.terms_sha256, algorithm: s.d.algorithm,
      public_key: { kty: k.kty, crv: k.crv, x: k.x, y: k.y }, credential_id: a.id, rp_id: location.hostname, origin: location.origin,
      assertion: { authenticatorData: a.response.authenticatorData, clientDataJSON: a.response.clientDataJSON, signature: a.response.signature },
      verified_by_server_at: s.d.executed.at, verify: "npm run verify-receipt -- receipt.json",
      // 6c: the world's hash chain when it was signed; its signature row is this signature (the checks find it).
      chain: s.d.chain ? { length: s.d.chain.length, head: s.d.chain.head, rows: s.d.chain.rows } : undefined
    };
  }
  $("r-receipt").addEventListener("click", function () {
    if (!S.signed) return;
    var url = URL.createObjectURL(new Blob([JSON.stringify(receipt(), null, 2) + "\\n"], { type: "application/json" }));
    var link = el("a", "", []);
    link.href = url; link.download = "receipt.json";
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
  });

  // ── Screen 3: try to cheat. The signed terms with one thing changed, sent with the same signature. ──
  var LABEL = { amount: "Amount", payee_iban: "IBAN", currency: "Currency", "fx.client_rate": "FX rate" };
  function get(t, k) { return k.split(".").reduce(function (o, x) { return o && o[x]; }, t); }
  function fieldsOf(t) { return D.fields.filter(function (k) { return get(t, k) !== undefined && get(t, k) !== null; }); }
  function shown(k, v, t) { return k === "amount" ? amt(t.currency, v) : k === "payee_iban" ? iban(v) : v; }
  function resetTamper() {
    var t = S.signed && S.signed.x.terms;
    if (!t) return;
    $("t-amount").value = t.amount; $("t-iban").value = iban(t.payee_iban); $("t-currency").value = t.currency;
    document.querySelector('label[data-field="fx.client_rate"]').hidden = !t.fx;
    if (t.fx) $("t-rate").value = t.fx.client_rate;
    edited();
  }
  // The visitor's terms: the signed ones with the fields as typed (amounts to two decimals, IBANs without spaces).
  function typed() {
    var s = S.signed, t = JSON.parse(s.x.p.canonical);
    var a = $("t-amount").value.trim().replace(/,/g, "");
    if (!/^\\d{1,12}(\\.\\d{1,2})?$/.test(a)) return { error: "Type an amount like 1850.01." };
    var p = a.split(".");
    t.amount = String(Number(p[0])) + "." + ((p[1] || "") + "00").slice(0, 2);
    var i = $("t-iban").value.replace(/\\s+/g, "").toUpperCase();
    if (!/^[A-Z0-9]{1,34}$/.test(i)) return { error: "Type an IBAN: letters and digits, up to 34." };
    t.payee_iban = i;
    t.currency = $("t-currency").value;
    if (t.fx) {
      var rate = $("t-rate").value.trim();
      if (!/^\\d{1,6}(\\.\\d{1,10})?$/.test(rate)) return { error: "Type a rate like 1.129677." };
      t.fx.client_rate = rate;
    }
    return { terms: t, changed: fieldsOf(s.x.terms).filter(function (k) { return get(t, k) !== get(s.x.terms, k); }) };
  }
  function edited() {
    if (!S.signed) return;
    var r = typed();
    D.fields.forEach(function (k) { var n = document.querySelector('label[data-field="' + k + '"]'); if (n) n.classList.toggle("chg", !!(r.changed && r.changed.indexOf(k) >= 0)); });
    $("t-send").disabled = !!r.error || r.changed.length === 0;
    status("t-status", r.error || (r.changed.length ? "Changed: " + r.changed.map(function (k) { return LABEL[k]; }).join(", ") + ". Send it with the signature you made." : ""), r.error ? "bad" : "");
  }
  ["t-amount", "t-iban", "t-currency", "t-rate"].forEach(function (id) { $(id).addEventListener("input", edited); $(id).addEventListener("change", edited); });
  // A chip: the signed values back, one thing changed, sent at once.
  function cheat(kind) {
    var t = S.signed && S.signed.x.terms;
    if (!t) return;
    resetTamper();
    if (kind === "cent") { var c = Math.round(Number(t.amount) * 100) + 1; $("t-amount").value = Math.floor(c / 100) + "." + String(c % 100).padStart(2, "0"); }
    if (kind === "iban") $("t-iban").value = iban(D.otherIban);
    if (kind === "currency") $("t-currency").value = t.currency === "USD" ? "EUR" : "USD";
    document.querySelectorAll("#cheat-chips .chip").forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.cheat === kind)); });
    edited();
    tamper();
  }
  document.querySelectorAll("#cheat-chips .chip").forEach(function (b) { b.addEventListener("click", function () { cheat(b.dataset.cheat); }); });
  function tamper() {
    var s = S.signed, r = typed();
    if (!s || r.error || !r.changed.length) { edited(); return; }
    var bs = [].slice.call(document.querySelectorAll("#cheat-chips .chip")).concat([$("t-send")]);
    bs.forEach(function (b) { b.disabled = true; });
    var changed = canon(r.terms);
    status("t-status", "Sending your terms with the same signature…");
    sha256(changed).then(function (h) {
      var rows = fieldsOf(s.x.terms).map(function (k) {
        var tr = el("tr", r.changed.indexOf(k) >= 0 ? "chg" : "", [el("td", "", [LABEL[k]]), el("td", "", [shown(k, get(s.x.terms, k), s.x.terms)]), el("td", "", [shown(k, get(r.terms, k), r.terms)])]);
        tr.dataset.row = k;
        return tr;
      });
      // The two hashes side by side under the fields, every character that differs marked.
      var hr = el("tr", "hrow", [el("td", "", ["Hash"]), el("td", "", [hashPair(s.x.mine, s.x.mine)]), el("td", "", [hashPair(h, s.x.mine)])]);
      hr.dataset.row = "hash";
      $("t-table").replaceChildren(el("table", "diff", [el("thead", "", [el("tr", "", [Object.assign(el("th", "", []), { ariaLabel: "Field" }), el("th", "", ["Signed"]), el("th", "", ["Sent"])])]), el("tbody", "", rows.concat([hr]))]));
      $("t-what").replaceChildren(el("div", "hashes", [
        el("div", "", [el("p", "small muted", ["Signed terms hash to:"]), hashBox(s.x.mine, "old")]),
        el("div", "", [el("p", "small muted", ["Your changed terms hash to:"]), hashBox(h, "new")])
      ]));
      return post("sign", { token: S.token, proposal_id: s.x.p.proposal_id, canonical: changed, credential: s.a }).then(function (q) {
        // A refused signature is an answer (200, verified false); an error status is a refusal too, never "accepted".
        var refused = q.status !== 200 || !q.data || q.data.verified !== true;
        $("tamper").className = refused ? "refused" : "refused accepted";
        $("t-icon").replaceChildren(ic(refused ? "octagon-x" : "triangle-alert"));
        $("t-head").textContent = refused ? "Refused: the same signature does not verify for the changed terms" : "Accepted?! This should not happen.";
        $("t-why").replaceChildren(el("span", "", [refused ? refusal(q) : ""]));
        var v = $("t-verdict");
        v.textContent = refused ? verdict(r.changed, s.x.terms, r.terms) : "";
        v.hidden = !refused;
        if (refused) S.did.cheat = true;
        $("tamper").hidden = false;
        if (refused) replay($("tamper"), "shake");
        bs.forEach(function (b) { b.disabled = false; });
        edited();
        S.lastField = r.changed[r.changed.length - 1];
      });
    });
  }
  // The first 12 characters of a hash, those that differ from the other one marked.
  function hashPair(h, other) {
    var c = el("code", "hp", h.slice(0, 12).split("").map(function (x, i) { return x === other.charAt(i) ? x : el("span", "hx", [x]); }).concat(["…"]));
    c.title = h;
    return c;
  }
  function refusal(q) {
    var d = q.data || {};
    if (d.reason && !d.error) d.error = d.reason;
    var hex = function (h) { return /^[0-9a-f]{64}$/.test(h || "") ? h.slice(0, 12) + "…" : null; };
    if (d.why === "challenge" && hex(d.signed_sha256) && hex(d.terms_sha256)) return "The server refused it: the signature was made for hash " + hex(d.signed_sha256) + ", not for your terms (" + hex(d.terms_sha256) + ").";
    var why = String(d.error || ("error " + q.status)).replace(/^refused:\\s*/i, "");
    return "The server refused it: " + why + (/[.!?…]$/.test(why) ? "" : ".");
  }
  function verdict(changed, was, now) {
    var cents = function (a) { return Math.round(Number(a) * 100); };
    if (changed.length === 1 && changed[0] === "amount" && Math.abs(cents(now.amount) - cents(was.amount)) === 1) return D.verdict.cent;
    if (changed.length === 1) return D.verdict.field;
    return ["", "", "Two", "Three", "Four"][changed.length] + " fields changed. The signature is worthless.";
  }
  $("t-send").addEventListener("click", function () { document.querySelectorAll("#cheat-chips .chip").forEach(function (b) { b.setAttribute("aria-pressed", "false"); }); tamper(); });
  $("go-trick").addEventListener("click", function () { go(4); });
  $("go-rule").addEventListener("click", function () { go(5); pick(null); });

  // ── Screen 4: change the rule. One question; the full policy (#71) behind "Show all fields and what Purser sends". ──
  // The values in force and the three locks come from the server, computed there by Purser's own code; this page only
  // shows them. A stricter change holds at once; a looser one is refused until the visitor signs its exact terms.
  var P = D.policy;
  function show(v) { return Array.isArray(v) ? v.join(", ") : v; }
  function inForce() { var a = S.policy.agents[S.agent], o = {}; P.fields.forEach(function (f) { o[f] = f === "reserve_floor" ? S.policy.reserve_floor : a[f]; }); return o; }
  function setOf(v) { var o = {}; P.fields.forEach(function (f) { o[f] = v[f]; }); return o; }
  function pval(f) {
    if (f === "mccs" || f === "currencies") return [].slice.call(document.querySelectorAll('input[name="pf-' + f + '"]:checked')).map(function (n) { return n.value; }).sort();
    return $("pf-" + f).value.trim();
  }
  function fillForm() {
    var v = inForce();
    P.fields.forEach(function (f) {
      if (f === "mccs" || f === "currencies") document.querySelectorAll('input[name="pf-' + f + '"]').forEach(function (n) { n.checked = v[f].indexOf(n.value) >= 0; });
      else $("pf-" + f).value = v[f];
    });
    $("pf-end_date").min = S.bounds.end_date_min; $("pf-end_date").max = S.bounds.end_date_max;
    pedited();
  }
  function cents(v) { return Number(String(v).replace(".", "")); }
  function pset() {
    var out = {}, err = null;
    P.fields.forEach(function (f) {
      var v = pval(f);
      if (f === "mccs" || f === "currencies") { if (!v.length && !err) err = P.words[f] + ": choose at least one."; out[f] = v; return; }
      if (f === "end_date") {
        if ((!/^\\d{4}-\\d{2}-\\d{2}$/.test(v) || v < S.bounds.end_date_min || v > S.bounds.end_date_max) && !err) err = "End date: a date from " + S.bounds.end_date_min + " to " + S.bounds.end_date_max + ".";
        out[f] = v; return;
      }
      v = v.replace(/,/g, "");
      if (/^\\d{1,9}$/.test(v)) v = v + ".00"; else if (/^\\d{1,9}\\.\\d$/.test(v)) v = v + "0";
      var min = f === "per_tx" || f === "monthly" ? S.bounds.limit_min : "0.00";
      if ((!/^\\d{1,9}\\.\\d{2}$/.test(v) || cents(v) < cents(min) || cents(v) > cents(S.bounds.max)) && !err) err = P.words[f] + ": an amount from " + min + " to " + S.bounds.max + " EUR, like 25.00.";
      out[f] = v;
    });
    if (!err && cents(out.per_tx) > cents(out.monthly)) err = "Limit per purchase: no higher than the limit per month.";
    return { set: out, error: err };
  }
  function same(a, b) { return Array.isArray(a) ? a.join(",") === b.join(",") : a === b; }
  function pedited() {
    var r = pset(), v = inForce(), changed = P.fields.filter(function (f) { return !same(r.set[f], v[f]); });
    P.fields.forEach(function (f) { document.querySelector('[data-pfield="' + f + '"]').classList.toggle("chg", changed.indexOf(f) >= 0); });
    $("p-apply").disabled = !!r.error || !changed.length;
    status("p-status", r.error || (changed.length ? "Changed: " + changed.map(function (f) { return P.words[f].toLowerCase(); }).join(", ") + ". Apply it: stricter holds at once, looser needs your signature." : "Change one value, then apply it."), r.error ? "bad" : "");
    return r;
  }
  function steady(ln) { return ln.replace(/--expires-in \\d+/, "--expires-in"); }
  function lines(pre, text, base) {
    var old = base === undefined ? null : base.split("\\n").map(steady);
    pre.replaceChildren.apply(pre, text.split("\\n").map(function (ln) { return el("span", "ln" + (old && old.indexOf(steady(ln)) < 0 ? " chg" : ""), [ln + "\\n"]); }));
  }
  function argText(a) { return /^[A-Za-z0-9_.,:\\/-]+$/.test(a) ? a : JSON.stringify(a); }
  function renderLocks(l, proposed, base) {
    var t = {
      purser: JSON.stringify(l.purser.settings, null, 2),
      awx: JSON.stringify({ authorization_controls: l.airwallex.authorization_controls }, null, 2),
      args: "metal-agent " + l.metal.args.map(argText).join(" "),
      metal: [l.metal.params.cap, l.metal.params.budget, l.metal.params.payee, l.metal.params.expires_at.slice(0, 16)].join("\\n")
    };
    lines($("pl-purser"), t.purser, base && base.purser);
    lines($("pl-awx"), t.awx, base && base.awx);
    lines($("pl-margs"), t.args, base && base.args);
    $("pl-rules").replaceChildren.apply($("pl-rules"), l.purser.rules.map(function (r) { return el("li", "", [r]); }));
    var pay = l.purser.payments || [];
    $("pl-pay").replaceChildren.apply($("pl-pay"), pay.map(function (p) {
      var li = el("li", p.check === "fail" ? "bad" : p.check === "executed" ? "" : "ok", [p.proposal_id + " · " + eur(p.amount) + ": " + (p.check === "fail" ? "blocked. " + p.rule : p.check === "executed" ? (p.alone ? D.policy.paidAlone + " (stand-in, test world)." : "ran (stand-in, test world).") : "passes. " + (p.waits || "Within what the agent may pay alone."))]);
      li.dataset.proposal = p.proposal_id; li.dataset.check = p.check;
      return li;
    }));
    $("pl-pay").hidden = !pay.length;
    var m = l.metal.params, old = base ? base.metal.split("\\n") : null;
    var dd = function (v, i, shownV) { var d = el("dd", old && old[i] !== v ? "chg" : "", [shownV || v]); d.dataset.value = v; return d; };
    var at = m.payee.indexOf(","), addr = m.payee.slice(0, at);
    $("pl-metal").replaceChildren(
      el("dt", "", ["Cap (most per payment)"]), dd(m.cap, 0, m.cap + " *USDZ"), el("dt", "", ["Budget (most in all)"]), dd(m.budget, 1, m.budget + " *USDZ"),
      el("dt", "", ["Payee"]), dd(m.payee, 2, m.payee.slice(at + 1) + " · " + addr.slice(0, 6) + "…" + addr.slice(-4)),
      el("dt", "", ["Expiry"]), dd(m.expires_at.slice(0, 16), 3, m.expires_at.slice(0, 16).replace("T", " ") + " UTC (in " + Math.round(Number(m.expires_in_seconds) / 86400) + " days)")
    );
    document.querySelectorAll("#p-locks .state").forEach(function (n) { n.textContent = proposed ? P.state.proposed : P.state.inForce; n.classList.toggle("proposed", !!proposed); });
    $("p-locks").dataset.state = proposed ? "proposed" : "in-force";
    return t;
  }
  function worstCase(x) {
    if (!x) return;
    $("p-expo-head").textContent = x.headline; $("p-expo-tasks").textContent = x.tasks;
    // Screen 4, in one line beside the choice: "Worst case: …" (the figure as everywhere; "set by policy" is the screen).
    // Screens 5 and 6: the worst case in a CFO's words, from the rule in force; the full figure behind "more".
    if (S.policy && S.expoMonth) { countTo($("s4-worst"), W.rule.worst + " " + euro(String(S.expoMonth.in_force / 100)) + " a month", null); S.shown = null; }
    $("s4-full").textContent = x.headline;
    var ul = $("p-expo-how");
    ul.replaceChildren.apply(ul, x.how.concat([D.policy.worstCaseChain]).map(function (l) { return el("li", "", [l]); }));
  }
  function monthEuro(c) { return euro((c / 100).toFixed(2)); }
  function policyState(d) {
    S.policy = d.policy; S.locks = d.locks; if (d.bounds) S.bounds = d.bounds; S.expoAlone = d.exposure_alone || null; S.expoMonth = d.exposure_month || null;
    if (!S.agent) S.agent = "treasury";
    worstCase(d.exposure);
    $("p-ver").textContent = "Policy v" + d.policy_version;
    ruleLines(null);
  }
  function worldFacts(w) {
    if (!w) return;
    $("w-balance").textContent = eur(w.balance); $("w-floor").textContent = eur(w.reserve_floor); $("w-alone").textContent = eur(w.alone_limit);
    if (w.usd_balance) { $("w-usd").textContent = amt("USD", w.usd_balance); $("w-usd-floor").textContent = amt("USD", w.usd_floor); }
  }
  function inForceView() { S.pending = null; $("p-refused").hidden = true; $("p-expo-next").hidden = true; S.base = renderLocks(S.locks[S.agent], false); }

  // The three locks in one line each, for the Treasury agent: Purser's limit to pay alone (the chosen one, when one is
  // chosen), the Airwallex card's limits, the Metal mandate's cap; from the policy in force, as Purser's code made them.
  function ruleLines(alone) {
    if (!S.policy) return;
    var a = S.policy.agents.treasury, m = S.locks.treasury.metal.params;
    var now = a.alone, v = alone || now;
    $("rl-purser").lastChild.textContent = "Purser: up to " + euro(v) + " alone, ${ALONE_PER_DAY} a day";
    $("rl-purser").classList.toggle("chg", v !== now);
    $("rl-awx").lastChild.textContent = "Airwallex card: " + euro(a.per_tx) + " each, " + euro(a.monthly) + " a month";
    $("rl-metal").lastChild.textContent = "Metal mandate: " + String(Number(m.cap)) + " test USD each";
    // The diagram says the same, beside the story.
    $("dg-purser").textContent = euro(v) + " alone, ${ALONE_PER_DAY} a day"; $("dg-awx").textContent = euro(a.per_tx) + " each, " + euro(a.monthly) + " a month"; $("dg-metal").textContent = String(Number(m.cap)) + " test USD each";
    document.querySelectorAll("#rule-chips .chip").forEach(function (b) {
      // The amount in force is marked with a tick (its name says so to a screen reader).
      b.replaceChildren(euro(b.dataset.alone), b.dataset.alone === now ? Object.assign(el("span", "now", [ic("check")]), { title: "in force" }) : "");
      b.setAttribute("aria-label", euro(b.dataset.alone) + (b.dataset.alone === now ? ", in force" : ""));
    });
  }
  // A chip: the rule the visitor would set, and what it takes: a signature if looser, nothing if stricter.
  function pick(v) {
    S.choice = v;
    var now = S.policy.agents.treasury.alone;
    document.querySelectorAll("#rule-chips .chip").forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.alone === v)); });
    ruleLines(v);
    // The worst case moves with the choice: the server's figure for that amount, marked as not yet in force.
    var x = S.expoAlone && v ? S.expoAlone[v] : null;
    if (x) $("s4-full").textContent = x;
    // One honest number (a juror, 7 Nov): the worst case a month this choice sets, and what it adds or takes, both
    // as the server computed them (1.4).
    var m = S.expoMonth;
    var at = m && v && m.alone[v] !== undefined ? m.alone[v] : m ? m.in_force : 0, delta = m ? at - m.in_force : 0;
    S.delta = delta;
    var worstWords = function (a, d) { return W.rule.worst + " " + monthEuro(a) + " a month" + (d ? " (" + (d > 0 ? "+" : "−") + monthEuro(Math.abs(d)) + ")" : ""); };
    // The worst case and the difference count up (or down) from what was shown to the new figures.
    var was = S.shown || { at: at, delta: delta };
    var whole = function (c) { return Math.round(c / 100) * 100; };
    countTo($("s4-worst"), worstWords(at, delta), v && (was.at !== at || was.delta !== delta) ? function (p) { return worstWords(whole(was.at + (at - was.at) * p), whole(was.delta + (delta - was.delta) * p)); } : null);
    S.shown = { at: at, delta: delta };
    // The difference in brackets keeps to one line (jury review, 7 Nov, #26): its own span, white-space: nowrap.
    var wn = $("s4-worst"), cut = delta ? wn.textContent.lastIndexOf(" (") : -1;
    if (cut > 0) { var ds = document.createElement("span"); ds.className = "delta"; ds.textContent = wn.textContent.slice(cut + 1); wn.textContent = wn.textContent.slice(0, cut + 1); wn.appendChild(ds); }
    $("s4-worst").classList.toggle("chg", !!delta);
    // The three locks light up one by one for the amount chosen.
    if (v) replay($("s4-locks"), "lit");
    var looser = v && cents(v) > cents(now), stricter = v && cents(v) < cents(now);
    var btn = $("go-apply"), note = $("s4-note");
    btn.replaceChildren(looser ? ic("scan-face") : "", looser ? W.rule.sign : W.rule.apply);
    btn.disabled = !(looser || stricter);
    note.textContent = looser ? W.rule.looser : stricter ? W.rule.stricter : v ? W.rule.same : "";
    note.className = "note" + (looser ? " looser" : stricter ? " stricter" : "");
    $("s4-argue").className = "argue" + (looser ? " looser" : stricter ? " stricter" : "");
    status("s4-status", "");
  }
  document.querySelectorAll("#rule-chips .chip").forEach(function (b) { b.addEventListener("click", function () { pick(b.dataset.alone); }); });
  // Apply (stricter) or sign (looser): the same request the full form sends, for the Treasury agent's "may pay alone".
  $("go-apply").addEventListener("click", function () {
    var v = S.choice, btn = $("go-apply");
    if (!v) return;
    var set = setOf(inForce()); set.alone = v;
    btn.disabled = true;
    status("s4-status", "Sending the rule to your test world…");
    post("policy", { token: S.token, agent: "treasury", set: set }).then(function (q) {
      var d = q.data || {};
      if (q.status !== 200) { status("s4-status", d.error || ("error " + q.status), "bad"); btn.disabled = false; return; }
      if (d.applied) return ruled(d, false);
      if (!d.needs_signature) { status("s4-status", d.reason || "Nothing changed.", ""); btn.disabled = false; return; }
      // Looser: the exact terms of the change, checked on this device, signed with the passkey, checked by the server.
      var terms = JSON.parse(d.canonical);
      return sha256(canon(terms)).then(function (h) {
        if (!(canon(terms) === d.canonical && h === d.terms_sha256)) { status("s4-status", "The terms do not hash to the hash the server sent. Do not sign.", "bad"); return; }
        status("s4-status", "Waiting for Face ID…");
        return getSignature(h).then(function (c) {
          if (!c) { status("s4-status", "Cancelled. Nothing was signed.", "bad"); btn.disabled = false; return; }
          status("s4-status", "Purser is checking your signature…");
          return post("policy", { token: S.token, agent: "treasury", set: set, canonical: d.canonical, credential: assertionOf(c) }).then(function (r) {
            var e = r.data || {};
            if (r.status === 200 && e.applied) return ruled(e, true);
            status("s4-status", "Not accepted: " + (e.reason || e.error || ("error " + r.status)), "bad"); btn.disabled = false;
          });
        }, function (e) { status("s4-status", passkeyError(e), "bad"); btn.disabled = false; });
      });
    });
  });
  // The rule holds: the full form and the locks follow it, and screen 5 shows what the agent does with its next invoice.
  function ruled(d, signed) {
    var before = S.base;
    policyState(d); worldFacts(d.world); fillForm();
    S.pending = null; $("p-refused").hidden = true; $("p-expo-next").hidden = true;
    S.base = renderLocks(S.locks[S.agent], false, before);
    S.lastRule = { signed: signed, alone: S.policy.agents.treasury.alone, ran: d.paid_alone || [] };
    S.did.rule = signed ? "signed" : "applied";
    // Screen 6, one small line (Max, 7 Nov): the new rule and what it did to the worst case.
    $("s5-worst").textContent = "Your new rule: up to " + euro(S.policy.agents.treasury.alone) + " alone, ${ALONE_PER_DAY} times a day" + (S.delta ? " (" + (S.delta > 0 ? "+" : "−") + monthEuro(Math.abs(S.delta)) + " a month worst case)" : "") + ".";
    status("s4-status", "");
    return showProposals(d.proposals).then(function () { go(6); });
  }

  // The full policy (#71): every field, the three panels and the worst case, as before.
  function policyApplied(d, signed) {
    var before = S.base;
    policyState(d);
    S.pending = null; $("p-refused").hidden = true; $("p-expo-next").hidden = true;
    S.base = renderLocks(S.locks[S.agent], false, before);
    fillForm();
    var ch = (d.changes || []).map(function (c) { return P.words[c.field].toLowerCase() + " " + show(c.from) + " → " + show(c.to); }).join("; ");
    var ran = (d.paid_alone || []).map(function (id) { return " " + id + ": " + D.policy.paidAlone + "."; }).join("");
    status("p-status", (signed ? "Signed and verified: the looser policy holds in your test world. " : "Stricter: it holds at once, no signature needed. ") + "Changed: " + ch + "." + ran, "ok");
    S.lastRule = { signed: signed, alone: S.policy.agents.treasury.alone, ran: d.paid_alone || [] };
    worldFacts(d.world);
    return showProposals(d.proposals);
  }
  function policyRefused(d, agent, set) {
    var terms = JSON.parse(d.canonical);
    return sha256(canon(terms)).then(function (h) {
      var ok = canon(terms) === d.canonical && h === d.terms_sha256;
      policyState(d);
      $("p-why").textContent = d.reason;
      $("p-effect").textContent = d.alone_effect || ""; $("p-effect").hidden = !d.alone_effect;
      $("p-hash").replaceChildren(el("p", "small muted", ["The hash of the exact terms of this change, which your passkey signs" + (ok ? " (checked on this device):" : ":")]), hashBox(h));
      $("p-terms").textContent = d.canonical;
      $("p-sign").hidden = !ok; $("p-sign").disabled = !ok;
      status("p-sstatus", ok ? "Sign it to make it hold, or undo your edits." : "The terms do not hash to the hash the server sent. Do not sign.", ok ? "" : "bad");
      S.pending = ok ? { agent: agent, set: set, canonical: d.canonical, sha: h } : null;
      $("p-refused").hidden = false;
      status("p-status", "", "");
      renderLocks(d.proposed[agent], true, S.base);
      if (d.proposed_exposure) { $("p-expo-next").textContent = D.policy.ifSigned + " " + d.proposed_exposure.figure + "."; $("p-expo-next").hidden = false; }
    });
  }
  P.fields.forEach(function (f) {
    var ns = f === "mccs" || f === "currencies" ? document.querySelectorAll('input[name="pf-' + f + '"]') : [$("pf-" + f)];
    [].forEach.call(ns, function (n) {
      ["input", "change"].forEach(function (ev) { n.addEventListener(ev, function () { if (S.pending) inForceView(); pedited(); }); });
    });
  });
  $("p-agent").addEventListener("change", function () { S.agent = $("p-agent").value; fillForm(); inForceView(); });
  $("p-reset").addEventListener("click", function () { fillForm(); inForceView(); });
  $("p-apply").addEventListener("click", function () {
    var r = pedited();
    if (r.error) return;
    var b = $("p-apply"), agent = S.agent;
    b.disabled = true;
    status("p-status", "Sending the change to your test world…");
    post("policy", { token: S.token, agent: agent, set: r.set }).then(function (q) {
      var d = q.data || {};
      b.disabled = false;
      if (q.status !== 200) { status("p-status", (d.error || ("error " + q.status)), "bad"); return; }
      if (d.applied) return policyApplied(d, false);
      if (d.needs_signature) return policyRefused(d, agent, r.set);
      status("p-status", d.reason || "Nothing changed.", "");
    });
  });
  $("p-sign").addEventListener("click", function () {
    var pend = S.pending, btn = $("p-sign");
    if (!pend) return;
    btn.disabled = true;
    status("p-sstatus", "Waiting for Face ID…");
    getSignature(pend.sha).then(function (c) {
      if (!c) { status("p-sstatus", "Cancelled. Nothing was signed.", "bad"); btn.disabled = false; return; }
      status("p-sstatus", "Purser is checking your signature…");
      return post("policy", { token: S.token, agent: pend.agent, set: pend.set, canonical: pend.canonical, credential: assertionOf(c) }).then(function (r) {
        var d = r.data || {};
        if (r.status === 200 && d.applied) { status("p-sstatus", "", ""); return policyApplied(d, true); }
        status("p-sstatus", "Not accepted: " + (d.reason || d.error || ("error " + r.status)), "bad");
        btn.disabled = false;
      });
    }, function (e) { status("p-sstatus", passkeyError(e), "bad"); btn.disabled = false; });
  });
  $("go-see").addEventListener("click", function () { go(6); });
  $("go-again").addEventListener("click", function () { go(5); pick(null); });

  // ── Screen 5: the next invoice under the rule in force; any other payment the visitor's policy changed. ──
  function drawNext(rows) {
    var x = rows.filter(function (r) { return r.p.proposal_id === D.next.id; })[0];
    var box = $("s5-next");
    if (!x) { box.hidden = true; return; }
    box.hidden = false;
    var p = x.p, alone = p.status === "executed" && p.execution && p.execution.alone, ran = p.status === "executed";
    var limit = euro(S.policy.agents.treasury.alone);
    $("s5-head").textContent = alone ? W.alone.head : ran ? "You signed it." : W.alone.waits;
    box.className = "next" + (alone ? " alone" : "");
    box.dataset.proposal = p.proposal_id;
    box.dataset.state = alone ? "alone" : ran ? "signed" : p.check === "fail" ? "blocked" : "waits";
    S.did.alone = alone;
    box.replaceChildren(
      el("p", "small muted", [x.terms.payee.replace(/ \\(test payee\\)$/, "") + " · a new invoice, ", el("span", "nw", [x.terms.reference.replace(/^Invoice /, "")])]),
      el("p", "amt", [amt(x.terms.currency, x.terms.amount)]),
      flowOf(box.dataset.state),
      el("p", "nv", [alone ? "Paid alone under your new policy (up to " + limit + "). No signature needed." : ran ? "Signed, verified and run in your test world." : p.check === "fail" ? "Blocked: " + p.rule : "Waits for your signature: above the " + limit + " the agent may pay alone."]),
      alone ? el("details", "more", [el("summary", "", ["more"]), el("p", "", ["Test transfer " + p.execution.id + ", balance after " + eur(p.execution.balance_after) + ", by the stand-in, in your test world only. Bound to these terms' hash and to the rule you signed (policy v" + p.execution.policy_version + ")."]),
        el("div", "", [agentLine(p), el("p", "says", [p.says]), el("span", "pill said-before", [D.policy.saidBefore])])]) : null
    );
  }
  // The payment on its way: Purser's rule, then the card and mandate limits, then paid (green); or held at Purser's rule.
  function flowOf(state) {
    var stop = function (name, words) { var li = el("li", "fs f-" + name, [el("span", "fd", [ic(name === "paid" ? "check" : "lock")]), words]); li.dataset.stop = name; return li; };
    var f = el("ol", "flow", [stop("purser", "Purser"), stop("rail", "Airwallex · Metal"), stop("paid", "Paid")]);
    f.dataset.state = state;
    f.setAttribute("aria-label", state === "alone" || state === "signed" ? "Through Purser's rule, the card and mandate limits, then paid" : state === "blocked" ? "Stopped at Purser's rule" : "Held at Purser's rule: it waits for your signature");
    return f;
  }
  // Payments other than the story's, when the visitor's policy changed what they do: each as it is, signable when it waits.
  function drawOthers(rows) {
    var list = rows.filter(function (x) { return x.p.proposal_id !== D.next.id && !(S.signed && x.p.proposal_id === S.signed.x.p.proposal_id) && (S.firstCheck[x.p.proposal_id] !== x.p.check || x.p.status === "executed"); });
    var box = $("s5-others");
    if (!S.signed) list = [];
    $("s5-others-fold").hidden = !list.length;
    box.replaceChildren.apply(box, list.map(function (x) { return x.p.check === "fail" && x.p.status !== "executed" ? blocked(x) : otherSheet(x); }));
    $("s5-others-n").textContent = String(list.length);
  }
  function otherSheet(x) {
    var p = x.p, t = x.terms, done = p.status === "executed", alone = done && !!(p.execution && p.execution.alone);
    var st = el("p", "status", []); st.id = "st-" + p.proposal_id;
    var kids = [el("p", "eyebrow", [(alone ? "Paid alone · " : done ? "You approved · " : "Waiting for you · ") + p.proposal_id]), done ? null : policyNote(p, "fail"),
      alone ? el("p", "pill alone", [D.policy.paidAlone]) : null,
      agentLine(p), el("p", "says", [p.says]), alone ? el("p", "pill said-before", [D.policy.saidBefore]) : null, factsOf(p, t),
      done ? el("div", "chk pass", [el("b", "", [ic("check"), alone ? "Check: pass · " + p.execution.rule : "Check: pass · signed by you, run in your test world"])])
        : el("div", "chk pass", [el("b", "", [ic("clock"), "Check: pass · waiting for a person"]), el("span", "", [p.waits || ""])])];
    if (!done && x.same) {
      var b = el("button", "btn", [ic("scan-face"), "Sign with Face ID"]);
      b.type = "button"; b.dataset.sign = p.proposal_id; b.dataset.world = "1";
      b.addEventListener("click", function () {
        b.disabled = true; status(st.id, "Waiting for Face ID…");
        getSignature(x.mine).then(function (c) {
          if (!c) { status(st.id, "Cancelled. Nothing was signed.", "bad"); b.disabled = false; return; }
          return post("sign", { token: S.token, proposal_id: p.proposal_id, canonical: p.canonical, credential: assertionOf(c) }).then(function (r) {
            if (r.status !== 200 || r.data.verified !== true) { status(st.id, "Not accepted: " + (r.data.reason || r.data.error || ("error " + r.status)) + ".", "bad"); b.disabled = false; return; }
            b.hidden = true;
            status(st.id, "Signed, verified and executed in your test world: test transfer " + r.data.executed.id + ", " + eur(r.data.executed.amount) + ".", "ok");
          });
        }, function (e) { status(st.id, passkeyError(e), "bad"); b.disabled = false; });
      });
      kids.push(b);
    }
    kids.push(st);
    var a = el("article", "card prop sheet", kids);
    a.dataset.proposal = p.proposal_id;
    if (alone) a.dataset.alone = "1";
    return a;
  }

  // ── Screen 4: try to trick the agent. A fixed fake invoice goes to the server, which runs Purser's own fraud and
  // injection code on it (worker/src/trick.ts); the page shows the invoice, the fooled agent's words and the verdict. ──
  function trick(attack) {
    document.querySelectorAll("#trick-chips .chip").forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.attack === attack)); b.disabled = true; });
    status("k2-status", "Purser is checking the invoice…");
    return post("trick", { token: S.token, attack: attack }).then(function (q) {
      document.querySelectorAll("#trick-chips .chip").forEach(function (b) { b.disabled = false; });
      var r = q.data && q.data.trick;
      if (q.status !== 200 || !r) { status("k2-status", (q.data && q.data.error) || ("error " + q.status), "bad"); return; }
      status("k2-status", "");
      $("k-doc").textContent = r.invoice.shows; $("k-full").textContent = r.invoice.text;
      // The IBAN on file for the payee it claims to be, and the invoice's own, side by side: what differs in red.
      // Country and check digits compared in place, the account number from the right (IBANs differ in length by country).
      var mark = function (s, other) { return el("code", "", s.split("").map(function (x, i) { var o = i < 4 ? other.charAt(i) : other.charAt(other.length - s.length + i); return x === o ? x : el("span", "hx", [x]); })); };
      var known = el("span", "ib known", [ic("check"), mark(r.known.iban, r.known.iban)]), now = el("span", "ib new", [ic("triangle-alert"), mark(r.invoice.iban, r.known.iban)]);
      known.setAttribute("role", "group"); known.setAttribute("aria-label", "The IBAN on file for " + r.known.vendor + ": " + r.known.iban);
      now.setAttribute("role", "group"); now.setAttribute("aria-label", "The IBAN on this invoice: " + r.invoice.iban);
      known.dataset.iban = r.known.iban; now.dataset.iban = r.invoice.iban;
      $("k-ibans").replaceChildren(known, el("span", "neq", ["≠"]), now);
      // What the agent read (live Sonnet, labelled; or code's reading, labelled why), then the code's verdict.
      $("k-says").textContent = r.agent.read;
      $("k-label").textContent = r.agent.label;
      $("k-label").className = "pill " + (r.agent.live ? "live" : "said-before");
      $("k-calls").replaceChildren.apply($("k-calls"), r.agent.calls.map(function (c) {
        return el("li", "", [el("b", "", [c.step]), " · " + (c.model || "no model") + (c.ms != null ? " · " + (c.ms / 1000).toFixed(1) + " s" : "") + (c.request_id ? " · " + c.request_id : ""), el("br", "", []), c.input + " → " + c.output]);
      }).concat(r.agent.note ? [el("li", "small muted", [r.agent.note])] : []));
      $("k-out").textContent = r.outcome;
      $("k-lesson").textContent = r.lesson;
      $("k-why").replaceChildren.apply($("k-why"), r.signals.map(function (g) { return el("li", g.blocks ? "blocks" : "", [(g.blocks ? "Blocks: " : "Evidence: ") + g.detail]); })
        .concat(r.injections.map(function (i) { return el("li", "", ["Flagged as planted (" + i.kind.replace(/_/g, " ") + "): " + i.excerpt]); }))
        .concat([el("li", "small muted", [r.by])]));
      $("k-result").className = "tricked" + (r.blocked ? "" : " passed");
      $("k-result").hidden = false;
      replay($("k-result"), "go");
      if (r.blocked) S.did.trick = true;
    });
  }
  document.querySelectorAll("#trick-chips .chip").forEach(function (b) { b.addEventListener("click", function () { trick(b.dataset.attack); }); });

  // ── The closing card (1.5): what this visitor did, in order, then the three ways on. ──
  $("go-done").addEventListener("click", function () {
    var it = W.done.items, d = S.did, parts = [];
    if (d.signed) parts.push(it.signed);
    if (d.cheat) parts.push(it.cheat);
    if (d.trick) parts.push(it.trick);
    if (d.rule) parts.push(d.rule === "signed" ? it.rule : it.rule.replace("(signed)", "(applied)"));
    if (d.alone) parts.push(it.alone);
    $("d-list").textContent = parts.join(" · ") + ".";
    go(7);
    // 6c: the world's hash chain, as the server has it now.
    if (S.token) post("chain", { token: S.token }).then(function (r) {
      if (r.status !== 200 || !r.data.chain) return;
      S.fullChain = r.data.chain;
      $("c-len").textContent = r.data.chain.length + " events";
      $("c-head").textContent = r.data.chain.head ? r.data.chain.head.slice(0, 12) + "…" : "none";
      $("c-head").title = r.data.chain.head || "";
      $("c-box").hidden = false; $("c-verify").hidden = false; $("c-verify").disabled = false;
      status("c-status", "");
    });
  });
  // The chain, recomputed here: each row's SHA-256 over its canonical JSON (without its hash), each prev the row before's.
  function rowCanon(r) { return "{\\"at\\":" + JSON.stringify(r.at) + ",\\"data_sha256\\":" + JSON.stringify(r.data_sha256) + ",\\"kind\\":" + JSON.stringify(r.kind) + ",\\"prev\\":" + JSON.stringify(r.prev) + ",\\"seq\\":" + r.seq + "}"; }
  function checkChain(rows) {
    var prev = "0".repeat(64), i = 0;
    var next = function () {
      if (i >= rows.length) return Promise.resolve({ ok: true, n: rows.length, head: prev });
      var r = rows[i];
      if (!r || r.seq !== i + 1 || r.prev !== prev) return Promise.resolve({ ok: false, at: i + 1, why: "it does not follow the row before" });
      return sha256(rowCanon(r)).then(function (h) {
        if (h !== r.hash) return { ok: false, at: i + 1, why: "its hash does not match" };
        prev = h; i++;
        return next();
      });
    };
    return next();
  }
  $("c-verify").addEventListener("click", function () {
    var c = S.fullChain, b = $("c-verify");
    if (!c) return;
    b.disabled = true;
    checkChain(c.rows).then(function (v) {
      var ok = v.ok && v.n === c.length && v.head === c.head;
      $("c-box").dataset.verified = String(ok);
      if (ok) { b.hidden = true; status("c-status", W.done.chain.ok + ": " + v.n + " of " + c.length + " rows.", "ok"); return; }
      b.disabled = false;
      status("c-status", v.ok ? "The length or the head does not match the rows." : "Broken at row " + v.at + ": " + v.why + ".", "bad");
    });
  });
  $("go-start").addEventListener("click", function () { go(1); });

  // The end's links (from the data block, as the locks': the page's markup carries no outside link).
  document.querySelectorAll("#t-end a[data-end]").forEach(function (a) {
    var e = D.end[Number(a.dataset.end)];
    a.href = e.href;
    if (/^https?:/.test(e.href)) { a.target = "_blank"; a.rel = "noopener noreferrer"; }
  });
  $("t-film").href = D.film.href;

  // ── Start: the world opens when the page is shown (not while it is prerendered or in a background tab). ──
  if (!window.PublicKeyCredential || !navigator.credentials) {
    status("w-status", "This browser has no passkeys (WebAuthn). Open this page in Safari, Chrome, Edge or Firefox on a recent phone or laptop.", "bad");
    $("go-sign").disabled = true;
    return;
  }
  go(0);
  if (document.visibilityState === "visible") openWorld();
  else document.addEventListener("visibilitychange", function once() { if (document.visibilityState === "visible") { document.removeEventListener("visibilitychange", once); openWorld(); } });
})();`;

const li = (lines: readonly string[]) => lines.map((l) => `<li>${esc(l)}</li>`).join("");
/** €2,000 for 2000.00, as the rule's chips and lines write it. */
const euro = (s: string) => { const [i, c] = s.split("."); return `€${i!.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${c && c !== "00" ? `.${c}` : ""}`; };

/** The page's own style: its layout, the diagram's steps and the motion pass (a test reads every duration in it). */
export const trySignCss = () => CSS + DIAGRAM_STEPS + MOTION;

/** The page, its links and assets absolute (it answers at /try/sign, one level down). */
export function trySignPage(): string {
  const locks = tryLocks().map((l) => ({ ...l, href: /^https?:\/\//.test(l.href) ? l.href : `/${l.href}` }));
  const W = TRY_SIGN_SCREENS;
  const scr = (n: number, inner: string, extra = "") => `<section class="card scr" id="scr-${n}" data-screen="${n}"${n === 0 ? "" : " hidden"}${extra}>\n${inner}\n</section>`;
  const body = `<main><div class="wrap">
<div class="prog"><ol class="dots" aria-label="Six steps">${TRY_SIGN_STEPS.map((s, i) => `<li id="pg-${i + 1}"><span class="t">${esc(s)}</span></li>`).join("")}</ol><p class="count" id="pg-count" aria-live="polite">6 steps · about a minute</p></div>
<div class="story">
<div class="screens">
${scr(0, `  <h1 tabindex="-1" id="s0-head">${esc(W.intro.head)}</h1>
  <div class="bar"><button class="btn primary big" type="button" id="go-start">${esc(W.intro.start)}${icon("arrow-right", 20)}</button></div>`)}
${scr(1, `  <h2 tabindex="-1" id="s1-head">${esc(W.ask.head)}</h2>
  <ol class="steps" id="s1-steps" aria-live="polite" aria-label="What the agents do">${AGENT_STEPS.map((n, i) => `<li class="st ${i === 0 ? "pending" : "waiting"}" id="st-${n}" data-step="${n}" data-state="${i === 0 ? "pending" : "waiting"}"><span class="sic">${icon(STEP_ICONS[n], 18)}</span><div><p class="sl"><b>${esc(W.ask.pending[n][0])}</b> <span class="sw">${esc(W.ask.pending[n][1])}</span></p><div class="sd"></div></div></li>`).join("")}</ol>
  <div class="ask" id="s1-ask" hidden></div>
  <div class="pay" id="s1-pay" hidden><p class="to" id="s1-to"></p><p class="amt"><span id="s1-amt"></span><span class="fx" id="s1-fx"></span></p></div>
  <p class="status" id="w-status" aria-live="polite"></p>
  <details class="fold" id="s1-did" hidden><summary>${esc(W.ask.did)}</summary><div class="fbody" id="s1-did-body"><ul class="small calls" id="s1-calls"></ul><p class="small" id="s1-plan"></p><p class="small" id="s1-read"></p></div></details>
  <details class="fold" id="s1-terms" hidden><summary>${esc(W.ask.terms)}</summary><div class="fbody" id="s1-terms-body"></div></details>
  <details class="fold quiet" id="s1-other"><summary><span>${esc(W.ask.other)} · <a id="s1-real" href="${esc(locks.find((l) => l.id === "purser")?.href ?? "/proof")}">${esc(W.ask.real)}</a></span></summary><div class="fbody" id="s1-blocked"></div></details>
  <p class="status" id="s1-status" aria-live="polite"></p>
  <p class="status" id="q-status" aria-live="polite"></p>
  <p class="status small" id="k-status" aria-live="polite"></p>
  <div class="bar"><button class="btn primary big" type="button" id="go-sign" data-world="1" disabled>${icon("scan-face", 20)}${esc(W.ask.sign)}</button><button class="btn primary big" type="button" id="go-quote" data-world="1" hidden>${icon("undo-2", 20)}Get a new quote</button><button class="btn primary big" type="button" id="go-retry" hidden>${icon("undo-2", 20)}Try again</button></div>`)}
${scr(2, `  <div class="bigok">${icon("circle-check", 56).replace(/<(circle|path) /g, '<$1 pathLength="100" ')}<h2 tabindex="-1" id="r-head">${esc(W.signed.head)}</h2></div>
  <p class="lead1" id="r-line">${esc(W.signed.line)}</p>
  <div class="line ok">${icon("circle-check", 22)}<span><b>${esc(W.signed.executed)}</b><span id="r-exec"></span></span></div>
  <p class="links"><button class="tlink" type="button" id="r-receipt">${icon("receipt", 18)}${esc(W.signed.receipt)}</button><a class="tlink" id="r-verify" href="/try/verify" target="_blank" rel="noopener">${icon("shield-check", 18)}${esc(W.signed.verify)}</a></p>
  <details class="fold quiet" id="r-details"><summary>${esc(W.signed.details)}</summary><div class="fbody">
    <div class="line ok">${icon("shield-check", 22)}<span><b>Verified by the server</b><span id="r-checks"></span></span></div>
    <div><p class="small muted">The hash you signed (SHA-256 of the exact terms):</p><div id="r-hash"></div></div>
    <div class="receipt"><p class="small muted">Check it offline with one command, no server: <code>npm run verify-receipt -- receipt.json</code>.</p>
    <details class="more"><summary>more</summary><p>It holds the exact terms, their hash, your signature, its public key and the algorithm, and no secret. The command is in the repository, ${esc(REPO_URL.replace(/^https:\/\//, ""))}. Change one field or one cent and it fails. It proves that the holder of that key signed these terms, not who holds it.</p></details></div>
  </div></details>
  <div class="bar"><button class="btn primary big" type="button" id="go-cheat" data-world="1">${icon("triangle-alert", 20)}${esc(W.signed.cheat)}</button></div>`)}
${scr(3, `  <h2 tabindex="-1" id="s3-head">${esc(W.cheat.head)}</h2>
  <div class="chips" id="cheat-chips" role="group" aria-label="What to change">${W.cheat.chips.map((c) => `<button class="chip" type="button" data-cheat="${c.id}" data-world="1" aria-pressed="false">${esc(c.label)}</button>`).join("")}</div>
  <div class="refused" id="tamper" hidden aria-live="polite">
    <p class="tagr">${icon("octagon-x", 16)}${esc(W.cheat.refused)}</p>
    <p class="outcome" id="t-verdict" hidden></p>
    <div id="t-table"></div>
    <details class="more"><summary>more</summary><p class="rh"><span id="t-icon"></span><span id="t-head"></span></p><div id="t-why" class="small"></div><div id="t-what"></div></details>
  </div>
  <details class="fold quiet" id="t-any"><summary>${esc(W.cheat.any)}</summary><div class="fbody" id="tamper-box">
    <div class="tf">
      <label data-field="amount">Amount<input id="t-amount" inputmode="decimal" autocomplete="off" spellcheck="false" data-world="1"></label>
      <label data-field="payee_iban">IBAN<input id="t-iban" autocomplete="off" autocapitalize="characters" spellcheck="false" data-world="1"></label>
      <label data-field="currency">Currency<select id="t-currency" data-world="1"><option>EUR</option><option>USD</option><option>GBP</option><option>CHF</option></select></label>
      <label data-field="fx.client_rate" hidden>FX rate<input id="t-rate" inputmode="decimal" autocomplete="off" spellcheck="false" data-world="1"></label>
    </div>
    <div><button class="btn" type="button" id="t-send" data-world="1" disabled>Send with the same signature</button></div>
    <p class="status" id="t-status" aria-live="polite"></p>
  </div></details>
  <div class="bar"><button class="btn primary big" type="button" id="go-trick" data-world="1">${esc(W.cheat.next)}${icon("arrow-right", 20)}</button></div>`)}
${scr(4, `  <h2 tabindex="-1" id="k-head">${esc(W.trick.head)}</h2>
  <div class="chips" id="trick-chips" role="group" aria-label="${esc(W.trick.lead)}">${ATTACKS.map((a) => `<button class="chip" type="button" data-attack="${a}" data-world="1" aria-pressed="false">${esc(TRICKS[a].label)}</button>`).join("")}</div>
  <p class="status" id="k2-status" aria-live="polite"></p>
  <div class="tricked" id="k-result" hidden aria-live="polite">
    <p class="doc" id="k-doc"></p>
    <div class="ibans" id="k-ibans"></div>
    <p class="fooled"><span class="pill said-before" id="k-label"></span> <span id="k-says"></span></p>
    <p class="outcome" id="k-out"></p>
    <p class="lesson" id="k-lesson"></p>
    <details class="more" id="k-did"><summary>${esc(W.trick.did)}</summary><p class="small">${esc(W.trick.decides)}</p><ul class="small calls" id="k-calls"></ul><pre class="doc" id="k-full"></pre><ul class="small" id="k-why"></ul></details>
  </div>
  <div class="bar"><button class="btn primary big" type="button" id="go-rule" data-world="1">${esc(W.trick.next)}${icon("arrow-right", 20)}</button></div>`)}
${scr(5, `  <h2 tabindex="-1" id="s4-head">${esc(W.rule.head)}</h2>
  <p class="q">${esc(W.rule.question)}</p>
  <div class="chips" id="rule-chips" role="group" aria-label="${esc(W.rule.question)}">${W.rule.chips.map((v) => `<button class="chip" type="button" data-alone="${v}" data-world="1" aria-pressed="false">${esc(euro(v))}${v === TEST_WORLD.alone_limit ? `<span class="now" title="in force">${icon("check", 16)}</span>` : ""}</button>`).join("")}</div>
  <div class="argue" id="s4-argue"><p class="worst" id="s4-worst">${esc(`${TRY_SIGN_SCREENS.rule.worst} €${(START_WORST_EUR_MONTH / 100).toLocaleString("en-US")} a month`)}</p>
  <p class="note" id="s4-note" aria-live="polite"></p></div>
  <details class="more" id="s4-more"><summary>more</summary><p id="s4-full">${esc(START_WORST.headline)}</p><p>${esc(mainRunWorst())}</p></details>
  <ul class="locks1" id="s4-locks">${([["rl-purser", "purser"], ["rl-awx", "airwallex"], ["rl-metal", "metal"]] as const).map(([id, k]) => `<li id="${id}">${icon("check", 18)}<span class="ch">${esc(LOCK_CHANNELS[k].short)}</span><span></span></li>`).join("")}</ul>
  <p class="status" id="s4-status" aria-live="polite"></p>
  <details class="fold quiet policy" id="policy"><summary id="p-open">${esc(TRY_POLICY.open)}</summary><div class="fbody pbody" id="p-body">
    <dl class="world" id="w-facts"><div><dt>Test world</dt><dd id="w-id"></dd></div><div><dt>EUR</dt><dd id="w-balance"></dd></div><div><dt>EUR floor</dt><dd id="w-floor"></dd></div><div><dt>USD</dt><dd id="w-usd"></dd></div><div><dt>USD floor</dt><dd id="w-usd-floor"></dd></div><div><dt>An agent pays alone up to</dt><dd id="w-alone"></dd></div><div><dt>Deleted</dt><dd id="w-left" data-left="in"></dd></div></dl>
    <div class="phead"><span class="pt"><b id="p-head">${esc(TRY_POLICY.title)}</b><small>${esc(TRY_POLICY.lead)}</small></span></div>
    <div class="pexpo" id="p-expo" aria-live="polite"><p class="hl" id="p-expo-head">${esc(START_WORST.headline)}</p><p class="small" id="p-expo-tasks">${esc(START_WORST.tasks)}</p><p class="small">${esc(START_WORST.above)}</p><p class="small" id="p-expo-next" hidden></p><details class="how"><summary>${esc(EXPOSURE_HOW)}</summary><ul id="p-expo-how">${[...START_WORST.how, TRY_POLICY.worstCaseChain].map((l) => `<li>${esc(l)}</li>`).join("")}</ul></details></div>
    <div class="ptop"><label>Agent<select id="p-agent" data-world="1">${AGENTS.map((a) => `<option value="${esc(a)}">${esc(agentName(a))}</option>`).join("")}</select></label><span class="pill" id="p-ver"></span></div>
    <div class="pform" id="p-form">
      ${(["per_tx", "monthly", "alone", "reserve_floor"] as const).map((f) => `<label data-pfield="${f}">${esc(FIELD_WORDS[f])} (EUR${f === "reserve_floor" ? ", the company's" : ""})<input id="pf-${f}" inputmode="decimal" autocomplete="off" spellcheck="false" data-world="1"></label>`).join("\n      ")}
      <label data-pfield="end_date">${esc(FIELD_WORDS.end_date)}<input id="pf-end_date" type="date" data-world="1"></label>
      <fieldset data-pfield="currencies"><legend>${esc(FIELD_WORDS.currencies)}</legend><div class="cks">${POLICY_CURRENCIES.map((c) => `<label class="ck"><input type="checkbox" name="pf-currencies" value="${esc(c)}" data-world="1">${esc(c)}</label>`).join("")}</div></fieldset>
      <fieldset data-pfield="mccs"><legend>${esc(FIELD_WORDS.mccs)}</legend><div class="cks">${POLICY_MCCS.map((m) => `<label class="ck"><input type="checkbox" name="pf-mccs" value="${esc(m)}" data-world="1">${esc(m)} ${esc(MCC_WORDS[m] ?? "")}</label>`).join("")}</div></fieldset>
    </div>
    <div class="pacts"><button class="btn" type="button" id="p-apply" data-world="1" disabled>Apply the policy</button><button class="btn" type="button" id="p-reset" data-world="1">Undo my edits</button><button class="btn" type="button" id="go-see" data-world="1">See what the agent does now${icon("arrow-right", 18)}</button></div>
    <p class="status" id="p-status" aria-live="polite"></p>
    <div class="prefused" id="p-refused" hidden>
      <div class="line bad">${icon("octagon-x", 22)}<span><b id="p-rhead">${esc(TRY_POLICY.refused)}</b><span id="p-why" class="small"></span></span></div>
      <p class="small" id="p-effect" hidden></p>
      <div id="p-hash"></div>
      <details class="more terms"><summary>All terms of this change (exactly what is hashed)</summary><pre class="terms" id="p-terms"></pre></details>
      <div><button class="btn" type="button" id="p-sign" data-world="1">${icon("scan-face", 18)}${esc(TRY_POLICY.sign)}</button></div>
      <p class="status" id="p-sstatus" aria-live="polite"></p>
    </div>
    <div class="locks3" id="p-locks">
      <article class="lk lk-purser" data-panel="purser"><div class="lkh"><span class="n">1</span><b>${esc(TRY_POLICY.panels.purser)}</b><span class="ch">${esc(LOCK_CHANNELS.purser.long)}</span><span class="pill state"></span></div><p class="ns">Rules in code, checked before anything is signed</p><ul id="pl-rules"></ul><pre id="pl-purser"></pre><ul id="pl-pay" hidden></ul></article>
      <article class="lk lk-awx" data-panel="airwallex"><div class="lkh"><span class="n">2</span><b>${esc(TRY_POLICY.panels.airwallex)}</b><span class="ch">${esc(LOCK_CHANNELS.airwallex.long)}</span><span class="pill state"></span></div><p class="ns">${esc(TRY_POLICY.notSent.airwallex)}</p><pre id="pl-awx"></pre></article>
      <article class="lk lk-metal" data-panel="metal"><div class="lkh"><span class="n">3</span><b>${esc(TRY_POLICY.panels.metal)}</b><span class="ch">${esc(LOCK_CHANNELS.metal.long)}</span><span class="pill state"></span></div><p class="ns">${esc(TRY_POLICY.notSent.metal)}</p><p class="unit" id="pl-unit">${esc(TRY_POLICY.metalUnit)}</p><dl id="pl-metal"></dl><pre id="pl-margs"></pre><p class="small muted">${esc(TRY_POLICY.metalNote)}</p></article>
    </div>
    <p class="basis">${esc(TRY_POLICY.source)}</p>
  </div></details>
  <div class="bar"><button class="btn primary big" type="button" id="go-apply" data-world="1" disabled>${esc(W.rule.apply)}</button></div>`)}
${scr(6, `  <h2 tabindex="-1" id="s5-head">${esc(W.alone.head)}</h2>
  <div class="next" id="s5-next" hidden></div>
  <p class="small muted" id="s5-worst"></p>
  <details class="fold quiet" id="s5-others-fold" hidden><summary>Other payments in your test world (<span id="s5-others-n">0</span>)</summary><div class="fbody others" id="s5-others"></div></details>
  <p class="links"><button class="tlink" type="button" id="go-again" data-world="1">${icon("undo-2", 18)}${esc(W.alone.again)}</button></p>
  <div class="bar"><button class="btn primary big" type="button" id="go-done">${esc(W.alone.finish)}${icon("arrow-right", 20)}</button></div>`)}
${scr(7, `  <h2 tabindex="-1" id="d-head">${esc(W.done.head)}</h2>
  <p class="lead1">${esc(W.done.lead)} <span id="d-list"></span></p>
  <div class="chainbox" id="c-box" hidden><p class="cline"><span>${esc(W.done.chain.label)}</span> <b id="c-len"></b> · head <code id="c-head"></code></p><button class="btn" type="button" id="c-verify" data-world="1">${icon("link-2", 18)}${esc(W.done.chain.verify)}</button><p class="status" id="c-status" aria-live="polite"></p></div>
  <nav class="end" id="t-end" aria-label="What next">${TRY_SIGN_END.slice(0, 1).map((e) => `<a class="btn primary big" data-end="0">${icon(e.icon, 18)}${esc(e.label)}</a>`).join("")}<p class="ends">${TRY_SIGN_END.slice(1).map((e, i) => `<a class="btn" data-end="${i + 1}">${icon(e.icon, 18)}${esc(e.label)}</a>`).join("")}</p></nav>
  <a id="t-film" hidden></a>`)}
</div>
<aside class="card diagram" id="diagram" data-step="1" aria-label="One policy, three locks">
  <p class="eyebrow">One policy → three locks</p>
  <div class="dn d-policy">${icon("shield-check", 20)}<span><b>The CFO's policy</b><small>One set of limits, written once.</small></span></div>
  <ol class="dlocks">
    <li class="dn d-purser">${icon("lock", 18)}<span><b>Purser</b><small class="ch">${esc(LOCK_CHANNELS.purser.long)}</small><small id="dg-purser">${esc(euro(TEST_WORLD.alone_limit))} alone, ${ALONE_PER_DAY} a day</small><small class="dstop">${esc(W.ask.other)} · <a id="dg-real" href="${esc(locks.find((l) => l.id === "purser")?.href ?? "/proof")}">${esc(W.ask.real)}</a></small></span></li>
    <li class="dn d-airwallex">${icon("lock", 18)}<span><b>Airwallex card</b><small class="ch">${esc(LOCK_CHANNELS.airwallex.long)}</small><small id="dg-awx">€25 each, €50 a month</small></span></li>
    <li class="dn d-metal">${icon("lock", 18)}<span><b>Metal mandate</b><small class="ch">${esc(LOCK_CHANNELS.metal.long)}</small><small id="dg-metal">25 test USD each</small></span></li>
  </ol>
  <div class="dn d-sign">${icon("scan-face", 20)}<span><b>Above the limit: your signature</b><small>Face ID over the exact terms; change one cent and it is worthless.</small></span></div>
  <div class="dn d-alone">${icon("circle-check", 20)}<span><b>Within the limit: paid alone</b><small>No signature needed, and nothing above it.</small></span></div>
  <p class="dnote">Any one lock stops a payment. Above the limit, a person signs: here, you.</p>
</aside>
</div>
</div></main>`;
  const html = page({
    title: "Sign with your own Face ID", description: "Try it yourself in 60 seconds: an agent asks to pay, you sign the exact terms with Face ID, try to cheat, change the rule, and see the agent pay alone. A test world of your own; nothing real moves.",
    tab: "try", css: trySignCss(), body, js: JS, stage: false,
    data: { icons: iconSet(["link-2", "landmark", "octagon-x", "clock", "scan-face", "triangle-alert", "circle-check", "check", "lock", "external-link", "arrow-right", "receipt", "bot", "shield-check", "arrow-left-right"]), locks, cfo: cfoApproval().line, fields: TAMPER_FIELDS, verdict: TAMPER_VERDICT, receipt: RECEIPT_FORMAT, recordedFx: recordedQuote(), end: TRY_SIGN_END, film: TRY_SIGN_FILM, codeLabel: CODE_LABEL,
      steps: TRY_SIGN_STEPS, screens: TRY_SIGN_SCREENS, channels: LOCK_CHANNELS, perDay: ALONE_PER_DAY, waiting: WAITING.id, blocked: FIXED_PROPOSALS.find((p) => p.id !== WAITING.id)!.id, next: NEXT, otherIban: OTHER_IBAN,
      policy: { fields: POLICY_FIELDS, words: FIELD_WORDS, state: TRY_POLICY.state, paidAlone: PAID_ALONE, worstCase: TRY_POLICY.worstCase, saidBefore: TRY_POLICY.saidBefore, worstCaseChain: TRY_POLICY.worstCaseChain, ifSigned: TRY_POLICY.ifSigned } },
    source: "Source: a test world made for you (worker/src/trySign.ts); nothing in it is recorded anywhere else. The lock examples: docs/demo/main-run.json and docs/runs/visa-tap-live-2026-11-02.json.",
    real: [
      "A test world made for you, deleted after one hour: a test copy of Northwind Outdoor; its balance, payees, IBANs and the agent's proposals are test data.",
      "No payment or conversion at Airwallex, no Metal call, and no money moves: the executor only records, in your test world. Claude Sonnet reads the invoice and Claude Opus advises, given the invoice and the test world's facts only; the amounts and the checks are Purser's code.",
      "Real: your device's passkey signature over the hash of the exact terms, and the server's check of it against the public key your device registered.",
    ],
  }).replace("<body>\n", () => `<body>\n<div class="testband" role="note"><div class="row"><span class="tl">${icon("lock", 16)}${esc(TRY_SIGN_LABEL)}</span><details class="wr"><summary>What's real?</summary><div class="card wr-body">
    <h3>Simulated</h3><ul>${li(WHATS_REAL.simulated)}</ul>
    <h3>Real</h3><ul>${li(WHATS_REAL.real)}</ul>
    <h3>What the server does not prove</h3><ul>${li(WHATS_REAL.limits)}</ul>
    <h3>Sources</h3><ul>${li(WHATS_REAL.sources)}</ul>
  </div></details></div></div>\n`);
  // One "What's real?" on this page (Max, 6 Nov): the one in the band at the top. The footer's copy is cut out, by position.
  const foot = html.indexOf('<footer class="foot">');
  const a = html.indexOf('<details class="real"', foot), b = html.indexOf("</details>", a);
  if (foot < 0 || a < 0 || b < 0) throw new Error("/try/sign: the footer's What's real? was not found");
  const one = html.slice(0, a) + html.slice(b + "</details>".length);
  // Relative links and assets made absolute: the page answers one level down, at /try/sign.
  return one.replace(/(href|src)="(?!https?:|#|\/|data:|mailto:)/g, '$1="/').replace(/url\(assets\//g, "url(/assets/");
}

/** The diagram lights the part each screen is about: 1 Purser's limit and the signature it asks for; 2 and 3 the
 * signature; 4 the three locks; 5 "paid alone". */
const DIAGRAM_STEPS = `
@media (min-width: 1024px) {
  .diagram[data-step="1"] .d-purser, .diagram[data-step="1"] .d-sign, .diagram[data-step="2"] .d-sign, .diagram[data-step="3"] .d-sign,
  .diagram[data-step="4"] .d-purser, .diagram[data-step="5"] .dlocks .dn, .diagram[data-step="6"] .d-alone, .diagram[data-step="7"] .dn { opacity: 1; border-color: var(--accent); background: var(--accent-soft); animation: dnlit .35s ease-out both; }
  /* Each step lights its part as it opens: the locks one after the other. */
  .diagram .dlocks li:nth-child(2) { animation-delay: .08s; } .diagram .dlocks li:nth-child(3) { animation-delay: .16s; }
  .diagram[data-step="6"] .d-alone { border-color: var(--ok); background: var(--ok-soft, var(--accent-soft)); }
  .diagram .dstop { display: none; } .diagram[data-step="1"] .dstop { display: block; color: var(--bad); font-weight: 650; }
  .diagram[data-step="1"] .dstop a { color: inherit; }
}`;

/** Motion (Max, 7 Nov: "the most impressive moment"): the same colours, type and layout; cards with a subtle shadow and a
 * light gradient, no glass and no glow that costs contrast. Each animation runs 150 to 400 ms and holds nothing up
 * (nothing waits for it); with prefers-reduced-motion the end state shows at once, and the script counts nothing. */
export const MOTION = `
.story .card { background: linear-gradient(180deg, color-mix(in srgb, var(--sunken) 55%, var(--surface)) 0, var(--surface) 180px); }
/* Signed and verified: the tick draws itself in, with a soft green glow. */
.bigok .i { filter: drop-shadow(0 0 8px color-mix(in srgb, var(--ok) 35%, transparent)); animation: glow .4s ease-out both; }
.bigok .i > * { stroke-dasharray: 100; stroke-dashoffset: 0; animation: draw .32s cubic-bezier(.65, 0, .35, 1) both; }
.bigok .i > :last-child { animation-duration: .24s; animation-delay: .16s; }
@keyframes draw { from { stroke-dashoffset: 100; } to { stroke-dashoffset: 0; } }
@keyframes glow { from { filter: drop-shadow(0 0 0 transparent); } to { filter: drop-shadow(0 0 8px color-mix(in srgb, var(--ok) 35%, transparent)); } }
/* Try to cheat: the card shakes once; the changed field lights red; the two hashes side by side. */
.refused.shake { animation: shake .34s cubic-bezier(.36, .07, .19, .97) both; }
@keyframes shake { 15%, 85% { transform: translateX(-2px); } 30%, 70% { transform: translateX(4px); } 45% { transform: translateX(-4px); } 60% { transform: translateX(3px); } }
table.diff tr.chg td { animation: lightred .4s ease-out both; }
table.diff tr.chg td:first-child { box-shadow: inset 3px 0 0 var(--bad); }
@keyframes lightred { from { background: color-mix(in srgb, var(--bad) 30%, var(--surface)); } to { background: var(--surface); } }
table.diff tr.hrow td { border-bottom: 0; }
code.hp { font: 600 13.5px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; color: var(--text); overflow-wrap: anywhere; }
.hx { color: var(--bad); font-weight: 800; }
/* Trick the agent: the fake invoice slides in, the IBANs side by side, then the block. */
.tricked.go .doc, .tricked.go .ibans { animation: slidein .3s ease-out both; }
.tricked.go .ibans { animation-delay: .06s; }
.tricked.go .outcome { animation: blockin .22s ease-out .18s both; }
@keyframes slidein { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
@keyframes blockin { from { opacity: 0; transform: scale(.97); } to { opacity: 1; transform: none; } }
.ibans { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; margin: 0; }
.ibans .ib { display: inline-flex; align-items: center; gap: 6px; padding: 5px 10px; border-radius: 10px; background: var(--surface); border: 1px solid var(--border); min-width: 0; }
.ibans .ib code { font: 600 14px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; overflow-wrap: anywhere; min-width: 0; }
.ibans .ib .i { flex: none; } .ibans .known .i { color: var(--ok); } .ibans .new { border-color: var(--bad); } .ibans .new .i { color: var(--bad); }
.ibans .neq { font-weight: 750; color: var(--bad); }
/* On a phone the two IBANs one above the other, right-aligned, so the account numbers line up digit for digit. */
@media (max-width: 640px) { .ibans { display: grid; grid-template-columns: max-content; gap: 6px; } .ibans .ib { justify-content: space-between; } .ibans .neq { display: none; } }
/* Change the rule: the figures count (countTo in the script), the three locks light up one by one. */
#s4-worst .delta { white-space: nowrap; }
.counting { position: relative; -webkit-text-fill-color: transparent; }
.counting::after { content: attr(data-count); position: absolute; inset: 0; padding: inherit; -webkit-text-fill-color: currentColor; overflow: hidden; }
ul.locks1 li { border-radius: 8px; margin: 0 -6px; padding: 2px 6px; }
ul.locks1.lit li { animation: lockon .26s ease-out both; }
ul.locks1.lit li:nth-child(2) { animation-delay: .1s; } ul.locks1.lit li:nth-child(3) { animation-delay: .2s; }
@keyframes lockon { from { background: var(--accent-soft); transform: translateX(-3px); } to { background: transparent; transform: none; } }
/* Pays alone: the payment moves through the locks (Purser, then Airwallex and Metal, then paid) and ends green. */
ol.flow { list-style: none; margin: 4px 0 2px; padding: 0; position: relative; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; }
ol.flow::before, ol.flow::after { content: ""; position: absolute; top: 13px; left: 16.6%; right: 16.6%; height: 3px; border-radius: 3px; background: var(--border); }
ol.flow::after { background: var(--ok); transform-origin: left; transform: scaleX(0); }
ol.flow li { position: relative; z-index: 1; display: grid; justify-items: center; gap: 4px; text-align: center; font: 650 13.5px/1.3 Inter, system-ui, sans-serif; color: var(--muted); min-width: 0; overflow-wrap: anywhere; }
ol.flow .fd { width: 28px; height: 28px; border-radius: 50%; display: grid; place-items: center; background: var(--surface); border: 2px solid var(--border); color: var(--muted); }
ol.flow .fd .i { width: 14px; height: 14px; }
ol.flow[data-state="alone"]::after, ol.flow[data-state="signed"]::after { transform: none; animation: fill .4s ease-in-out both; }
ol.flow[data-state="alone"] li, ol.flow[data-state="signed"] li { color: var(--text); }
ol.flow[data-state="alone"] .fd, ol.flow[data-state="signed"] .fd { border-color: var(--ok); background: var(--ok); color: var(--surface); animation: stop .18s ease-out both; }
ol.flow[data-state="alone"] li:nth-child(2) .fd, ol.flow[data-state="signed"] li:nth-child(2) .fd { animation-delay: .14s; }
ol.flow[data-state="alone"] li:nth-child(3) .fd, ol.flow[data-state="signed"] li:nth-child(3) .fd { animation-delay: .3s; }
ol.flow[data-state="waits"] .f-purser .fd { border-color: var(--accent); color: var(--accent); animation: stop .2s ease-out both; }
ol.flow[data-state="waits"] .f-purser, ol.flow[data-state="blocked"] .f-purser { color: var(--text); }
ol.flow[data-state="blocked"] .f-purser .fd { border-color: var(--bad); color: var(--bad); }
@keyframes fill { from { transform: scaleX(0); } to { transform: none; } }
@keyframes stop { from { transform: scale(.7); background: var(--surface); border-color: var(--border); color: var(--muted); } }
@keyframes dnlit { from { transform: translateX(-4px); box-shadow: 0 0 0 0 transparent; } 50% { box-shadow: 0 0 0 4px var(--accent-soft); } to { transform: none; box-shadow: 0 0 0 0 transparent; } }
/* prefers-reduced-motion: the end state, at once. */
@media (prefers-reduced-motion: reduce) {
  .story *, .story *::before, .story *::after { animation: none !important; transition: none !important; }
}`;
