// The product's name and the example company, in one place (docs/decisions.md D1-D3). The agents keep their
// internal ids (sourcing, support, treasury); people see the names below.

export const PRODUCT = "Purser";
export const TAGLINE = "Give every AI agent its own company card, with limits the CFO sets.";

/** The example company that runs Purser in the demo: a D2C outdoor brand in Amsterdam, selling in the EU and the US. */
export const COMPANY = "Northwind Outdoor";

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
