// The product's name and the example company, in one place (docs/decisions.md D1-D3). The agents keep their
// internal ids (sourcing, support, treasury); people see the names below.

export const PRODUCT = "Purser";
export const TAGLINE = "Give every AI agent its own company card, with limits the CFO sets.";

/**
 * The Visa Award in the Kit line and "Visa TAP" (text, never a logo) in "Built on": on since the live TAP run and the
 * interop test were green in both directions (2 Nov, docs/runs/visa-tap-live-2026-11-02.json; Max's go).
 */
export const VISA_AWARD_ON = true;
/** The Visa claim, word for word (Max, 2 Nov); nothing stronger anywhere. */
export const VISA_CLAIM = "Our agents sign their card checkouts at TAP merchants with Visa's Trusted Agent Protocol. Their signatures are accepted by Visa's public TAP reference verifier (pinned commit 16d59bd). The TAP merchant in this demo is run by us. Body integrity, tag and payment checks are our own layer on top.";
/** The big line under the heading: the kit, the track and the awards entered. */
export const KIT_LINE = `Kit 11 · x402 Business Agents · entered for the Metal Award${VISA_AWARD_ON ? " + Visa Award" : ""}`;
/** Home's badge (Max's mega-prompt v4, C2), word for word: the kit, the awards entered, what it is built on. Visa TAP is a separate text badge, never a logo. */
export const HOME_BADGE = `Kit 11 · Metal Award${VISA_AWARD_ON ? " + Visa Award" : ""} · built on Airwallex, Metal, Claude`;
/** D3, in one sentence: who decides what. */
export const SPLIT_LINE = "Claude decides the exceptions; routine buying and selling per query is code.";
/** The core sentence (Max, 2 Nov), word for word, wherever the story is told in one line. */
export const CORE_SENTENCE = "Claude agents handle the exceptions — price shocks, disputes, rebalancing. Routine runs at code speed. Metal and Airwallex enforce every limit; the CFO approves anything beyond them.";
/** Who the second approver is, said wherever four eyes appears (Max, 2 Nov: he does everything alone). */
export const SECOND_APPROVER = "Second approver: a labelled test passkey in this demo. In production this is a second person.";
/** How agent run 1's world was set up, said wherever the run is shown (Max, 2 Nov). */
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
