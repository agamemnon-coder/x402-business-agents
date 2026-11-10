// What a live tokenize command needs before it may call Metal testnet: Max's go, a call budget and a call log, and its
// own ledger (never the main run's). The same guards as `npm run two-locks`.

export const LIVE_COMMANDS = ["deploy", "mint", "finance", "settle", "verify"] as const;
export type LiveCommand = (typeof LIVE_COMMANDS)[number];

export function liveRefusals(cmd: LiveCommand, env: Record<string, string | undefined>): string[] {
  const why: string[] = [];
  if (env.TOKENIZE_GO !== "yes") why.push("TOKENIZE_GO=yes (Max's go)");
  const budget = Number(env.TOKENIZE_CALL_BUDGET);
  if (!env.TOKENIZE_CALL_BUDGET || !Number.isInteger(budget) || budget < 1) why.push("TOKENIZE_CALL_BUDGET (a whole number of Metal RPC calls)");
  if (!env.TOKENIZE_CALL_LOG) why.push("TOKENIZE_CALL_LOG (a file each call is appended to)");
  if (!/(^|\/)tokenize[^/]*\.sqlite$/.test(env.TOKENIZE_DB ?? "")) why.push("TOKENIZE_DB=…/tokenize*.sqlite (this run's own ledger)");
  if (!env.METAL_RPC_URL) why.push("METAL_RPC_URL");
  if (cmd === "mint" || cmd === "verify") {
    if (!env.TOKENIZE_SOURCE_DB) why.push("TOKENIZE_SOURCE_DB (the ledger with the passkey approval, opened read-only)");
    if (!env.TOKENIZE_PROPOSAL) why.push("TOKENIZE_PROPOSAL (the approved proposal id, e.g. P-0001)");
    if (!env.TOKENIZE_DOCUMENT) why.push("TOKENIZE_DOCUMENT (the invoice document the CFO approved)");
    if (env.TOKENIZE_SOURCE_DB && env.TOKENIZE_SOURCE_DB === env.TOKENIZE_DB) why.push("TOKENIZE_SOURCE_DB must not be this run's own ledger");
  }
  return why;
}
