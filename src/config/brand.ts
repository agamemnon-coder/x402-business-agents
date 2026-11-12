// The product's name and the example company, in one place (docs/decisions.md D1-D3). The agents keep their
// internal ids (sourcing, support, treasury); people see the names below.

export const PRODUCT = "Purser";

/**
 * Where a company that wants to use Purser goes (review 9 Nov: no call to action anywhere). Empty until Max gives the
 * address; while empty, nothing shows. Once set (an https: or mailto: URL), the link shows on Home, on /try/sign's
 * closing card and, by hand, in the README under the badges (test/design-partner.test.ts keeps the README in step).
 */
export const DESIGN_PARTNER_URL = "";
export const DESIGN_PARTNER_LABEL = "Become a design partner";
/** The design-partner link as HTML, or "" while there is no valid address. */
export function designPartnerHtml(url: string = DESIGN_PARTNER_URL): string {
  if (!/^(https:\/\/|mailto:)[^\s"'<>]+$/.test(url)) return "";
  return `<p class="partner"><a href="${url.replace(/&/g, "&amp;")}">${DESIGN_PARTNER_LABEL} →</a></p>`;
}
export const TAGLINE = "Give every AI agent its own company card, with limits the CFO sets.";

/**
 * "Visa (VIC via Airi)" (text, never a logo) in Home's "Built on", since 12 Nov (jury panel): the Visa entry is the
 * Airi run, Visa Intelligent Commerce via Airwallex's Airi (docs/runs/2026-11-07-vic-1.md), so it stands beside
 * Airwallex, Metal and Claude. History: Visa (hackathon Slack, 5 Nov) said TAP is not available as Visa tooling for
 * this hackathon, only Visa Intelligent Commerce (VIC) or Intelligent Commerce Connect are; Visa (hackathon Slack,
 * 7 Nov, as reported by the builder) said the VIC run counts, so since 7 Nov Purser is entered for the Metal Award and
 * the Visa Award, on the Airi run, never on TAP (docs/decisions.md D28, docs/evidence/README.md). This switch was
 * VISA_AWARD_ON (off: it would have put "Visa TAP" in "Built on"); TAP is never in "Built on", and its work sits in
 * one closed fold at the foot of /visa, outside the entry (VISA_TAP_STATUS).
 */
export const VISA_VIC_BUILT_ON = true;
export const VISA_BUILT_ON = "Visa (VIC via Airi)";
/**
 * Intelligent Commerce Connect, exactly as it stands (the owner, 12 Nov: access is requested, no answer has come).
 * Said once, on /visa; no other claim about it anywhere on the site or in the README (test/visa-overview.test.ts).
 */
export const VISA_ICC_LINE = "Intelligent Commerce Connect: access requested, not granted yet; not used in this entry.";
/**
 * The Visa claim in plain words (jury review, 4 Nov), said once per surface (/visa, the README, the form, the deck);
 * nothing stronger anywhere. "Public reference verifier", never "open source": Visa's reference has no open-source
 * licence (docs/decisions.md). "The Sourcing agent" since 12 Nov (was "each agent"): only the Sourcing agent ran TAP
 * live, in the TAP run of 2 Nov and in the main run (test/visa-overview.test.ts reads both records).
 */
export const VISA_CLAIM = "Visa: the Sourcing agent signs its card checkout with Visa's Trusted Agent Protocol (TAP), so a merchant can check which agent is buying. Visa's public reference verifier accepted the signatures in a separate test on 2 November; the merchant is ours.";
/**
 * TAP's status, on Max's wording (5 Nov, after Visa's answer in the hackathon Slack), said once per surface (/visa, the
 * form, the deck): built and verified against Visa's public reference verifier, not eligible Visa tooling for this
 * hackathon. Never "certified", "endorsed" or "confirmed by Visa".
 */
export const VISA_TAP_STATUS = "Visa TAP: built and verified against Visa's public reference verifier; not eligible Visa tooling for this hackathon (Visa, 5 Nov).";
/**
 * The big line under the heading: the kit, the track and the awards entered. The Visa Award since 7 Nov (Visa: the VIC
 * run counts), on the Airi run, not on TAP.
 */
export const KIT_LINE = "Kit 11 · x402 Business Agents · entered for the Metal Award and the Visa Award";
/** Home's badge (Max's mega-prompt v4, C2): the kit, the awards entered (the Visa Award since 7 Nov, on the Airi run, as KIT_LINE), what it is built on. Visa TAP is never in it. */
export const HOME_BADGE = "Kit 11 · Metal Award and Visa Award · built on Airwallex, Metal, Claude";
/** D3, in one sentence: who decides what. */
export const SPLIT_LINE = "Claude decides the exceptions; routine buying and selling per query is code.";
/**
 * Home's heading (Max, 5 Nov: as the film and the social preview say it). No absolute claim: the core sentence under it
 * says who holds which limit, and that the CFO approves anything beyond them.
 */
export const HERO = "AI agents spend. You sign off.";
/**
 * The core sentence (jury review, 4 Nov), word for word, wherever the story is told in one line: who holds which
 * limit. Never "enforce every limit": the refund, FX and other thresholds are held by Purser's own code.
 */
export const CORE_SENTENCE = "Metal holds each agent's on-chain budget, Airwallex holds each card's limit, Purser's code holds the rest; the CFO approves anything beyond them.";
/** Who the second approver is, said wherever four eyes appears (Max, 2 Nov: he does everything alone). */
export const SECOND_APPROVER = "Second approver: a labelled test passkey in this demo. In production this is a second person.";
/**
 * The main run (3 Nov): one purchase over the cap let through to Metal on Max's flag, word for word wherever that
 * refusal is shown. The run's own ledger row carries the same text (upstream.let_through_refused).
 */
export const DEFENSE_IN_DEPTH = "Defense in depth: Purser normally refuses before signing. To prove the rail itself enforces the limit, one purchase was let through to Metal — Metal refused it; nothing moved.";
/**
 * A sandbox transfer's PAID, said wherever a page shows it (final review, 4 Nov): Purser itself moves the transfer to
 * SENT, then PAID, through Airwallex's simulation API (src/executors/invoicePayment.ts settleInSandbox), so the
 * settlement is simulated; the seconds from Face ID to PAID stay the measured time.
 */
export const SANDBOX_SETTLED = "in the sandbox, where the settlement is simulated";
/** How the played run's world was set up (agent run 1 and the main run alike), said wherever the run is shown (Max, 2 Nov). */
export const WORLD_SETUP = "World set-up: the alternative supplier (Ridgeline) is offline in this world, so the price rise forces a choice. The agents were not told what to do.";
/** Four eyes, in one line, wherever a page names it. */
export const FOUR_EYES_LINE = "Four eyes on chain: two signatures required (second approver = a labelled test passkey in this demo)";

/**
 * What only Purser has (jury review, 6 Nov, #1): three sentences, word for word and first on every surface (the README's
 * first lines, Home under the heading, the form's synopsis and description, the deck's title slide), then the Kit 11
 * moments in one line (KIT11_RUN_LINE). The 24 is the main run's decisions, all by Claude (test/differentiation.test.ts
 * checks it against docs/demo/main-run.json). "No key reaches Claude", not "holds no keys": each agent's own code pays
 * with its own mandate key; what is documented and tested is that no key reaches the agents' Claude models
 * (docs/claims.md, test/adversarial.test.ts).
 */
export const DIFFERENTIATORS = [
  "An approval is usually a button. In Purser it's a signature over the exact terms: change one cent and it's worthless.",
  "One CFO policy, a lock per rail: Airwallex card controls, Metal's mandate, the CFO's signature on invoices. A prompt is not a control.",
  "Real agents: Claude made all 24 decisions (routine payments are code); no key reaches Claude.",
] as const;
/** The one line after the three sentences, linked to /try/sign wherever a surface can link (section D, 6 Nov). */
export const TRY_IT = "Try it in a minute.";
/** Where TRY_IT goes: a test world of the visitor's own, signed with their own passkey; nothing real moves. */
export const TRY_SIGN_URL = "https://kit11.max-31b.workers.dev/try/sign";
/**
 * What Purser is, in one sentence: since the review of 9 Nov customer-first, who it is for and the moment of the
 * /try/sign demo (Treasury asks to pay Alpine Packaging's €1,850 invoice, over the limit it may pay alone). First under the
 * title on the README, under Home's heading and at the start of the form's synopsis. Anything beyond the CFO's signed
 * policy is a proposal the CFO signs with Face ID (docs/cfo-policy.md).
 */
export const WHAT_IT_IS = "For CFOs whose AI agents pay suppliers: when an agent wants to pay an invoice over its limit, you sign the exact terms with Face ID.";
/**
 * The first screen, in this order, on the README and in the form's synopsis: what Purser is, the three sentences, then
 * "Try it in a minute." Only then the badges and the details. Home says what Purser is and the three sentences under its
 * heading, then its one button and three steps (jury review, 7 Nov, #2). test/first-screen.test.ts checks all three.
 */
export const FIRST_SCREEN = [WHAT_IT_IS, ...DIFFERENTIATORS, TRY_IT] as const;
/** The first screen as one paragraph (the form's synopsis). */
export const FIRST_SCREEN_TEXT = FIRST_SCREEN.join(" ");

/** Where the business case lives (docs/business/, the folder on GitHub: tree, not blob, which answers 404 for a folder). */
export const BUSINESS_DOCS = "https://github.com/agamemnon-coder/x402-business-agents/tree/main/docs/business";
/** "Why this is a company": one link to the whole case (Max, 7 Nov), not one per line. */
export const BUSINESS_CASE_LINK = "Read the business case ↗";
/**
 * "Why this is a company" (section D, 6 Nov): five lines, on the README and on Home, each linked to docs/business/.
 * Every line is what docs/business/ says; the pricing is the hypothesis in model.md, and the one outside source is
 * Airwallex's own post [S1] in problem.md. "Not validated" is said once, in the note under the heading. No other
 * company's name. test/first-screen.test.ts checks each line against its page.
 */
/**
 * The intended price (hypothesis), approved by Max on 6 November 2026 with Claude decisions included. Said word for word
 * wherever a price is given (test/unit-economics-hypothesis.test.ts); src/business/unitEconomics.ts computes from it.
 */
export const PRICE_LINE = "€49 per company a month, including 5 agents and 1,500 Claude decisions; €10 per extra agent; €3 per extra 100 decisions.";
export const WHY_COMPANY_NOTE = "Not validated with customers yet: 2 finance conversations (a CFO and a bank finance professional, quoted, anonymous); more in progress; no pilots, no revenue. Every line below is a hypothesis except the cited source.";
/** The same, as one small line under the lines (Proof, Max 7 Nov: the content first, the disclaimer last). */
export const WHY_COMPANY_NOTE_LAST = "Not validated with customers yet: 2 finance conversations (a CFO and a bank finance professional, quoted, anonymous); more in progress; no pilots, no revenue; every line above is a hypothesis except the cited source.";
export const WHY_COMPANY: readonly { label: string; text: string; page: string }[] = [
  { label: "The problem", text: "when an AI agent pays today, its limit lives in a prompt it can be talked out of, or in a month-end review that finds the money after it has left.", page: "problem.md#what-goes-wrong" },
  { label: "Who buys", text: "the finance team of a small company or scale-up that already banks with Airwallex and lets AI agents pay; the CFO uses it and decides.", page: "model.md#who-buys-and-who-uses-it-hypothesis" },
  { label: "Intended pricing", text: `${PRICE_LINE} A hypothesis.`, page: "model.md#intended-pricing-hypothesis" },
  { label: "Why now", text: "Airwallex wrote on 5 October 2026 that agents moving money need limits enforced \"through underlying infrastructure rather than prompts\" (\"Agentic banking starts with governance\", source S1).", page: "problem.md#why-now-sourced" },
  { label: "Why Purser", text: "it builds on Airwallex's own card controls and Metal's mandates, and adds what sits on top: one CFO policy for card and chain, approvals signed over the exact terms, a hash-chained audit log.", page: "model.md#risks-and-what-we-do-not-know" },
];
/** The film (v8, 3:58, YouTube, 8 Nov), linked from Home and Proof (jury QA, 6 Nov, Q3). /film is the earlier animation. */
export const FILM_URL = "https://youtu.be/kCUsFHrxE-o";
export const FILM_LINK = "Watch the film (4 min)";
/** The Kit 11 moments, in one line, after the three sentences. */
export const KIT11_RUN_LINE = "The Kit 11 scenario, run live on 3 November.";
/**
 * The caveats in one line, with a link to the full list (jury review, 6 Nov, #7): on Home and in the form. The full
 * list is Home's "What's real?" (the footer) and the long description's "What is real and what is simulated".
 */
export const CAVEAT_LINE = "Test money. Simulated: customer, supplier, settlement, second approver.";
export const CAVEAT_LINK = "Details →";
/**
 * The purchase let through to Metal, framed as what it was (jury review, 6 Nov, #8): a test of the layer under Purser.
 * Both layers, in order: Purser refuses first; with that check off once, Metal refused anyway. Said wherever that
 * refusal is told; the run's own ledger label (DEFENSE_IN_DEPTH) stays word for word beside it.
 */
export const CHAIN_TEST = "We switched off our own check once to prove the chain holds the line: Purser refuses an over-cap purchase before signing; with that check off for one purchase, Metal refused it anyway.";

/** The example company that runs Purser in the demo. */
export const COMPANY = "Northwind Outdoor";
/** How Northwind is described everywhere a juror reads it: Kit 11's data business, in one sentence. */
export const NORTHWIND_LINE = "an outdoor wholesaler that sells live stock data to retailers per query";

/** What each agent is called where a person reads it (Kit 11's names, word for word), and its job in Kit 11's brief. */
export const AGENT_DISPLAY: Record<"sourcing" | "support" | "treasury", { name: string; job: string }> = {
  sourcing: { name: "Sourcing agent", job: "buys upstream data per query (live stock checks from the warehouse API) and pays the warehouse software" },
  support: { name: "Support agent", job: "refunds customers when a dispute holds and pays the helpdesk software" },
  treasury: { name: "Treasury agent", job: "watches spending, sweeps earnings to Airwallex once final, and pays the monthly licence fee in EUR (Airwallex FX and SWIFT, after the CFO's Face ID)" },
};

/** Each agent's Kit 11 job, short, for the deck. */
export const KIT11_JOBS: Record<"sourcing" | "support" | "treasury", string> = {
  sourcing: "buys upstream data per query",
  support: "refunds customers in disputes",
  treasury: "watches spending, sweeps to Airwallex, pays the EUR licence fee",
};

/**
 * Shown on every page that plays the 30 October recording, until the live run with Max is recorded: that run was
 * made before the agents took Kit 11's names. Its recorded data shows the Kit 11 names; nothing else was changed.
 */
export const RECORDING_NAMES_NOTE = "Recorded on 30 October, before the agents took Kit 11's names: the names here are shown in Kit 11's form, and in that run the Support agent's card bought ads (it now pays helpdesk software). The new recording comes from the live run with the Kit 11 names.";

/** The display name of an agent id, or the id itself for anything else. */
export function agentName(id: string): string {
  return (AGENT_DISPLAY as Record<string, { name: string }>)[id]?.name ?? id;
}

/**
 * The proof, one sentence per partner (section D, 6 Nov), word for word wherever it appears: the README, the form's
 * Description and the deck (on the site, /proof's partner cards say the same claims in fewer words: proofLead.ts). Every number is read from its record by test/proof-sentences.test.ts:
 * - Airwallex: the GET-only read-backs docs/runs/airwallex-transfer-approval-2026-11-06.json (the terms hash the CFO
 *   signed for P-0005, in the SWIFT transfer's metadata) and docs/runs/airwallex-cards-2026-11-06.json (3 of 3 cards
 *   matching the CFO policy), computed in src/redesign/airwallexProof.ts;
 * - Metal: the main run's record (docs/demo/main-run.json), through src/redesign/metalStory.ts;
 * - Claude: the main run's agent_stats (24 of 24, 0 fallbacks) and the reliability run rel-1 (docs/demo/reliability.json,
 *   docs/runs/reliability-2026-11.md: the treasury-card-raise eval 6/10 before the fix, 10/10 after, docs/evals/agents.json).
 */
export const PROOF_SENTENCES: readonly { partner: "Airwallex" | "Metal" | "Claude"; anchor: string; text: string }[] = [
  { partner: "Airwallex", anchor: "airwallex", text: "Airwallex (sandbox): the hash of the exact terms the CFO signed with Face ID is in Airwallex's own record of the EUR 240.00 SWIFT payment, and 3 of 3 agent cards carry the CFO's policy as Airwallex's own controls, read back from Airwallex." },
  { partner: "Metal", anchor: "metal", text: "Metal (testnet): a mandate on chain per agent; 86 payments, each its own transaction; purchase #24 refused on chain (mandate_cap_exceeded); the mandates replaced on chain by the owner key after the CFO's Face ID in Purser (four eyes; second approver a labelled test passkey)." },
  { partner: "Claude", anchor: "claude", text: "Claude: 24 of 24 decisions in the main run, 0 fallbacks; a reliability run (rel-1) found a fault in how the agents hand off a card raise, and after the fix the eval rebuilt from that moment went from 6/10 to 10/10 and the next run (rel-1b) passed every step." },
];
/**
 * The CFO's view (Max's last round, item 4): Home and Proof link to the CFO dashboard's replay of the main run
 * (/?autonomy: read-only, public, its data inside the page, no viewer key), and that view opens with CFO_VIEW_LINE,
 * Max's words (his stricter wording: "each limit the CFO set", what the view shows from the CFO policy; never "every
 * limit", which the site's tests ban).
 * test/cfo-view.test.ts audits that page for anything private.
 */
export const CFO_VIEW_LINK = "See the CFO's view";
export const CFO_VIEW_URL = "./?autonomy";
export const CFO_VIEW_LINE = "This is what the CFO opens: what the agents did, what waits for a signature, and each limit the CFO set.";
/** The heading over PROOF_SENTENCES wherever they are listed. */
export const PROOF_HEADING = "The proof, one sentence per partner";

/** Home's one quiet way to the judge's tour, under the one button (Max, 7 Nov): a text link, not a second button. */
export const JUDGE_LINE = "Judging? Take the 3-minute tour";
