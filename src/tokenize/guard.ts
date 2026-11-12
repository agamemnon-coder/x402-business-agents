// What a live tokenize command needs before it may call Metal testnet: Max's go, a call budget for the command and one
// for the whole run, a call log, its own ledger (never the main run's) and its keys outside the repository. The same
// guards as `npm run two-locks`, plus the cumulative budget. Every refusal names a variable, never a value.

import { resolve, sep } from "node:path";

export const LIVE_COMMANDS = ["preflight", "fund", "deploy", "mint", "finance", "settle", "verify"] as const;
export type LiveCommand = (typeof LIVE_COMMANDS)[number];

/** The commands that read the source ledger (the passkey approval) and the invoice document. */
const NEEDS_SOURCE: readonly LiveCommand[] = ["preflight", "fund", "mint", "verify"];
/** `verify` only reads; it uses no key. */
const NEEDS_KEYS: readonly LiveCommand[] = ["preflight", "fund", "deploy", "mint", "finance", "settle"];

const REPO = resolve(import.meta.dirname, "../..");
export const insideRepo = (path: string, repo = REPO): boolean => { const p = resolve(path); return p === repo || p.startsWith(repo + sep); };
const wholeNumber = (v: string | undefined) => !!v && /^\d+$/.test(v) && Number(v) >= 1;

export function liveRefusals(cmd: LiveCommand, env: Record<string, string | undefined>, repo = REPO): string[] {
  const why: string[] = [];
  if (env.TOKENIZE_GO !== "yes") why.push("TOKENIZE_GO=yes (Max's go)");
  if (!wholeNumber(env.TOKENIZE_CALL_BUDGET)) why.push("TOKENIZE_CALL_BUDGET (a whole number of Metal RPC calls for this command)");
  if (!wholeNumber(env.TOKENIZE_CALL_BUDGET_TOTAL)) why.push("TOKENIZE_CALL_BUDGET_TOTAL (a whole number of Metal RPC calls for the whole run, held against the call log)");
  if (!env.TOKENIZE_CALL_LOG) why.push("TOKENIZE_CALL_LOG (a file each call is appended to)");
  if (!/(^|\/)tokenize[^/]*\.sqlite$/.test(env.TOKENIZE_DB ?? "")) why.push("TOKENIZE_DB=…/tokenize*.sqlite (this run's own ledger)");
  if (!env.METAL_RPC_URL) why.push("METAL_RPC_URL");
  if (NEEDS_KEYS.includes(cmd)) {
    if (!env.KIT11_KEYS_DIR) why.push("KIT11_KEYS_DIR (the directory of this run's four test keys, outside the repository)");
    else if (insideRepo(env.KIT11_KEYS_DIR, repo)) why.push("KIT11_KEYS_DIR must be outside the code repository");
  }
  if (NEEDS_SOURCE.includes(cmd)) {
    if (!env.TOKENIZE_SOURCE_DB) why.push("TOKENIZE_SOURCE_DB (the ledger with the passkey approval, opened read-only)");
    if (!env.TOKENIZE_PROPOSAL) why.push("TOKENIZE_PROPOSAL (the approved proposal id, e.g. P-0001)");
    if (!env.TOKENIZE_DOCUMENT) why.push("TOKENIZE_DOCUMENT (the invoice document the CFO approved)");
    if (env.TOKENIZE_SOURCE_DB && env.TOKENIZE_SOURCE_DB === env.TOKENIZE_DB) why.push("TOKENIZE_SOURCE_DB must not be this run's own ledger");
  }
  if (cmd === "fund") {
    if (!env.TOKENIZE_DONOR_KEY) why.push("TOKENIZE_DONOR_KEY (the key file the four test keys are funded from)");
    else if (insideRepo(env.TOKENIZE_DONOR_KEY, repo)) why.push("TOKENIZE_DONOR_KEY must be outside the code repository");
  }
  if (env.TOKENIZE_GAS !== undefined && env.TOKENIZE_GAS !== "estimate" && env.TOKENIZE_GAS !== "fixed") why.push("TOKENIZE_GAS is estimate (the default) or fixed");
  if (env.TOKENIZE_POLL_MS !== undefined && (!/^\d+$/.test(env.TOKENIZE_POLL_MS) || Number(env.TOKENIZE_POLL_MS) > 60_000)) why.push("TOKENIZE_POLL_MS is a whole number of milliseconds, at most 60000 (the wait before each receipt read; default 2500)");
  return why;
}
