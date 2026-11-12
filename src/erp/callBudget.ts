// The ERP call budget of a live run (Moneybird sandbox, 12 November; the same idea as src/airwallex/callBudget.ts): the
// owner approves a number of requests before anything runs, and code keeps to it. Every HTTP request to the ERP counts
// (a token request, every retry and every lookup too), across every process of the run: each one is appended to one log
// file before it is sent, and a request that would go over the approved number is refused before it leaves this
// machine. The log holds the time, the method and the endpoint (host and path, object ids replaced by {id}); never a
// body, a query or a header.
//
// Set by the run's environment: ERP_LIVE_GO=yes (the owner's go), ERP_CALL_BUDGET (a whole number, for every process of
// the run together) and ERP_CALL_LOG (a JSONL file outside the repository). Without all three no live transport is
// built, so no live command runs.
//
// The budget sits on the transport, not on fetch: a refusal is thrown as it is (ErpBudgetSpent), never wrapped as a
// network error the sync runner would retry.

import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { ErpError, fetchTransport, type HttpRequest, type Transport } from "./connector.js";

type Env = Record<string, string | undefined>;

export class ErpBudgetSpent extends Error {
  constructor(readonly budget: number, readonly method: string, readonly endpoint: string) {
    super(`the approved ERP call budget of ${budget} is spent; ${method} ${endpoint} was not sent (ask the owner before any further call)`);
    this.name = "ErpBudgetSpent";
  }
}

const GUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
/** A run of five or more digits standing by itself (a Moneybird id, an Exact division): not the 2 of /v2 or /xmlrpc/2. */
const NUMBER = /(?<![A-Za-z0-9.])\d{5,}(?![A-Za-z0-9])/g;

/** A request's host and path with object ids replaced by {id}, without its query: what the log counts by. */
export function endpointOf(url: string): string {
  const u = new URL(url);
  return `${u.host}${u.pathname.replace(GUID, "{id}").replace(NUMBER, "{id}")}`;
}

export interface ErpCallLine { at: string; method: string; endpoint: string }

/** The calls a run's log holds, oldest first; a missing file is none. */
export function readCallLog(file: string): ErpCallLine[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as ErpCallLine);
}

/** The log's calls counted per `METHOD endpoint`, in the order each was first made. */
export function callsByEndpoint(calls: readonly ErpCallLine[]): { endpoint: string; calls: number }[] {
  const m = new Map<string, number>();
  for (const c of calls) m.set(`${c.method} ${c.endpoint}`, (m.get(`${c.method} ${c.endpoint}`) ?? 0) + 1);
  return [...m].map(([endpoint, calls]) => ({ endpoint, calls }));
}

/**
 * A transport that writes each request to the log and then sends it, and refuses the one that would go over the budget
 * before it is sent. `endpoint` lets a connector name its own requests in the log (Moneybird keeps the administration).
 */
export function budgetedTransport(inner: Transport, o: { budget: number; file: string; now?: () => Date; endpoint?: (req: HttpRequest) => string }): Transport {
  if (!Number.isSafeInteger(o.budget) || o.budget < 0) throw new Error(`not a call budget: ${o.budget}`);
  return {
    async send(req) {
      const endpoint = o.endpoint ? o.endpoint(req) : endpointOf(req.url);
      if (readCallLog(o.file).length >= o.budget) throw new ErpBudgetSpent(o.budget, req.method, endpoint);
      const line: ErpCallLine = { at: (o.now ?? (() => new Date()))().toISOString(), method: req.method, endpoint };
      appendFileSync(o.file, `${JSON.stringify(line)}\n`, { mode: 0o600 });
      return inner.send(req);
    },
  };
}

/** This checkout: a call log inside it could be committed with the code, and run data never is. */
const REPO = resolve(import.meta.dirname, "../..");
const inside = (dir: string, file: string) => { const rel = relative(dir, file); return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel)); };

/**
 * What a live ERP run still needs before anything may be called (names only, never a value); empty when it may run.
 * A relative ERP_CALL_LOG is read from `cwd`, as the command itself reads it.
 */
export function liveRefusals(env: Env, cwd = process.cwd()): string[] {
  const why: string[] = [];
  if (env.ERP_LIVE_GO !== "yes") why.push("ERP_LIVE_GO=yes (the owner's go for this run)");
  if (!/^\d+$/.test(env.ERP_CALL_BUDGET ?? "") || !Number.isSafeInteger(Number(env.ERP_CALL_BUDGET))) why.push("ERP_CALL_BUDGET (the approved number of requests, a whole number)");
  if (!env.ERP_CALL_LOG || inside(REPO, resolve(cwd, env.ERP_CALL_LOG))) why.push("ERP_CALL_LOG (a file outside the repository that counts them)");
  return why;
}

/** The transport of a live run: fetch under the call budget. Without the go, the budget and the log, there is none. */
export function liveTransport(env: Env, inner: Transport = fetchTransport(), endpoint?: (req: HttpRequest) => string): Transport {
  const why = liveRefusals(env);
  if (why.length) throw new ErpError("config", `a live run needs ${why.join(", ")}; nothing was called`);
  return budgetedTransport(inner, { budget: Number(env.ERP_CALL_BUDGET), file: resolve(env.ERP_CALL_LOG!), ...(endpoint ? { endpoint } : {}) });
}
