// The product's name and the example company, in one place (docs/decisions.md D1-D3). The agents keep their
// internal ids (sourcing, support, treasury); people see the names below.

export const PRODUCT = "Purser";
export const TAGLINE = "Give every AI agent its own company card, with limits the CFO sets.";

/** The example company that runs Purser in the demo: a D2C outdoor brand in Amsterdam, selling in the EU and the US. */
export const COMPANY = "Northwind Outdoor";

/** What each agent is called where a person reads it, and its one job. */
export const AGENT_DISPLAY: Record<"sourcing" | "support" | "treasury", { name: string; job: string }> = {
  sourcing: { name: "Operations agent", job: "buys live stock checks from the warehouse API and pays the warehouse software" },
  support: { name: "Sales agent", job: "pays for ads and settles retailers' claims" },
  treasury: { name: "Finance agent", job: "pays the manufacturer by SWIFT, sweeps earnings on Metal once final, books them at Airwallex, and pays the bookkeeping" },
};

/** The display name of an agent id, or the id itself for anything else. */
export function agentName(id: string): string {
  return (AGENT_DISPLAY as Record<string, { name: string }>)[id]?.name ?? id;
}
