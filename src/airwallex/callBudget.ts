// The Airwallex call budget of a live run (awx-1, Max, 6 November): Max approves a number of calls before anything runs,
// and code keeps to it. Every HTTP request to the sandbox counts (the login and every retry too), across every process of
// the run (runner, CLI steps, the licence plan): each one is appended to one log file before it is sent, and a request
// that would go over the approved number is refused before it leaves this machine. The log holds the method, the path
// with ids replaced by {id} (for counting by endpoint), the time and the process; never a body, a query or a header.
//
// Set by the run's environment: AIRWALLEX_CALL_BUDGET (a whole number) and AIRWALLEX_CALL_LOG (a file path). Unset, the
// client is as before. Set one without the other, and the client refuses to start (a budget nobody counts is no budget).

import { appendFileSync, existsSync, readFileSync } from "node:fs";

export class AirwallexBudgetSpent extends Error {
  constructor(readonly budget: number, readonly method: string, readonly path: string) {
    super(`the approved Airwallex call budget of ${budget} is spent; ${method} ${path} was not sent (ask the CFO before any further call)`);
    this.name = "AirwallexBudgetSpent";
  }
}

/**
 * A path segment that is an id: a UUID, a long hex string, or a prefixed id such as int_sgpv…9h, acct_SC-QD89f…, ahfi_IriU…
 * A prefixed id has a digit or a capital in it, or is 16 characters or more; a word such as update_status or
 * payment_intents is not one (12 Nov: `payment_intents` was folded as if it were an id, so the read-back's calls were
 * logged as GET /pa/{id}/{id}).
 */
const ID = /^(?:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|[0-9a-fA-F]{20,}|[a-z]+_(?:(?=[A-Za-z0-9_-]*[A-Z0-9])[A-Za-z0-9_-]{6,}|[A-Za-z0-9]{16,}))$/;

/** A sandbox path with its ids replaced by {id}: `/api/v1/transfers/1b…/x` → `/transfers/{id}/x`. */
export function endpointOf(url: string): string {
  const path = new URL(url).pathname.replace(/^\/api\/v1/, "");
  return path.split("/").map((p) => (ID.test(p) ? "{id}" : p)).join("/");
}

export interface CallLine { at: string; method: string; endpoint: string; pid: number }

/** The calls a run's log holds, oldest first; a missing file is none. */
export function readCallLog(file: string): CallLine[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as CallLine);
}

/** The log's calls counted per `METHOD endpoint`, in the order each was first made. */
export function countByEndpoint(calls: readonly CallLine[]): { endpoint: string; calls: number }[] {
  const m = new Map<string, number>();
  for (const c of calls) m.set(`${c.method} ${c.endpoint}`, (m.get(`${c.method} ${c.endpoint}`) ?? 0) + 1);
  return [...m].map(([endpoint, calls]) => ({ endpoint, calls }));
}

/** A fetch that counts each request in the log and refuses the one that would go over the budget, before it is sent. */
export function budgetedFetch(inner: typeof fetch, o: { budget: number; file: string; now?: () => Date; pid?: number }): typeof fetch {
  if (!Number.isSafeInteger(o.budget) || o.budget < 0) throw new Error(`not a call budget: ${o.budget}`);
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? (typeof input === "object" && "method" in input ? input.method : "GET")).toUpperCase();
    const endpoint = endpointOf(url);
    if (readCallLog(o.file).length >= o.budget) throw new AirwallexBudgetSpent(o.budget, method, endpoint);
    const line: CallLine = { at: (o.now ?? (() => new Date()))().toISOString(), method, endpoint, pid: o.pid ?? process.pid };
    appendFileSync(o.file, `${JSON.stringify(line)}\n`, { mode: 0o600 });
    return inner(input, init);
  }) as typeof fetch;
}

/** The budgeted fetch the environment asks for, or null when no budget is set. Half a setting is refused. */
export function budgetFromEnv(env: NodeJS.ProcessEnv | Record<string, string | undefined>, inner: typeof fetch): typeof fetch | null {
  const budget = env.AIRWALLEX_CALL_BUDGET, file = env.AIRWALLEX_CALL_LOG;
  if (budget === undefined && file === undefined) return null;
  if (!budget || !file || !/^\d+$/.test(budget)) throw new Error("AIRWALLEX_CALL_BUDGET (a whole number) and AIRWALLEX_CALL_LOG (a file) go together; nothing was called");
  return budgetedFetch(inner, { budget: Number(budget), file });
}
