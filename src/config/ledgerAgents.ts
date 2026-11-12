/**
 * The ledger agents (12 November), each behind its own flag and off by default: the Controller agent's month-end review
 * (src/agents/controllerAgent.ts) only when KIT11_CONTROLLER_AGENT is exactly "on", and the books agent's answers to the
 * CFO's questions (src/agents/booksAgent.ts) only when KIT11_BOOKS_AGENT is exactly "on". Off, neither makes a Claude
 * call or writes a row. Its own module, so callers can ask without loading the Claude SDK.
 */
export function controllerAgentOn(env: Record<string, string | undefined> = process.env): boolean {
  return env.KIT11_CONTROLLER_AGENT === "on";
}

export function booksAgentOn(env: Record<string, string | undefined> = process.env): boolean {
  return env.KIT11_BOOKS_AGENT === "on";
}
