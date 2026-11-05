// The product's name and the example company, in one place (docs/decisions.md D1-D3). The agents keep their
// internal ids (sourcing, support, treasury); people see the names below.

export const PRODUCT = "Purser";
export const TAGLINE = "Give every AI agent its own company card, with limits the CFO sets.";

/**
 * The Visa Award in the Kit line and Home's badge, and "Visa TAP" (text, never a logo) in "Built on": off since 5 Nov.
 * Visa (hackathon Slack, 5 Nov): TAP is not available as Visa tooling for this hackathon; only Visa Intelligent
 * Commerce (VIC) or Intelligent Commerce Connect (ICC) are. So Purser is entered for the Metal Award only
 * (docs/decisions.md D27, docs/evidence/README.md). The TAP work stays on /visa as a labelled extra (VISA_TAP_STATUS).
 */
export const VISA_AWARD_ON = false;
/**
 * The Visa claim in plain words (jury review, 4 Nov), said once per surface (/visa, the README, the form, the deck);
 * nothing stronger anywhere. "Public reference verifier", never "open source": Visa's reference has no open-source
 * licence (docs/decisions.md).
 */
export const VISA_CLAIM = "Visa: each agent signs its card checkout with Visa's Trusted Agent Protocol (TAP), so a merchant can check which agent is buying. Visa's public reference verifier accepted the signatures in a separate test on 2 November; the merchant is ours.";
/**
 * TAP's status, on Max's wording (5 Nov, after Visa's answer in the hackathon Slack), said once per surface (/visa, the
 * form, the deck): built and verified against Visa's public reference verifier, not eligible Visa tooling for this
 * hackathon. Never "certified", "endorsed" or "confirmed by Visa".
 */
export const VISA_TAP_STATUS = "Visa TAP: built and verified against Visa's public reference verifier; not eligible Visa tooling for this hackathon (Visa, 5 Nov), so Purser is entered for the Metal Award only.";
/** How Home and Proof link to /visa since 5 Nov: the TAP work as a labelled extra, not an award entry. */
export const VISA_EXTRA_LINK = "Extra, not an award entry: Visa TAP and its status, on /visa";
/** The big line under the heading: the kit, the track and the awards entered. */
export const KIT_LINE = `Kit 11 · x402 Business Agents · entered for the Metal Award${VISA_AWARD_ON ? " + Visa Award" : ""}`;
/** Home's badge (Max's mega-prompt v4, C2), word for word: the kit, the awards entered, what it is built on. Visa TAP is a separate text badge, never a logo. */
export const HOME_BADGE = `Kit 11 · Metal Award${VISA_AWARD_ON ? " + Visa Award" : ""} · built on Airwallex, Metal, Claude`;
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
