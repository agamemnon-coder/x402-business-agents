// The ICC call budget of a live run, in the way of the Airwallex one (src/airwallex/callBudget.ts): the owner approves
// a number of calls before anything runs, and code keeps to it. Every HTTP request to the sandbox counts, across every
// process of the run: each is appended to one log file before it is sent, and a request that would go over the
// approved number is refused before it leaves this machine. The log holds the time, the method, the path with ids
// replaced by {id}, and the process; never a body, a query, a header or an id.
//
// Unlike the Airwallex client, the ICC client makes no call at all without a budget and a log (src/icc/client.ts):
// ICC_CALL_BUDGET (a whole number) and ICC_CALL_LOG (a file path) are both required.

import { appendFileSync } from "node:fs";
import { readCallLog, type CallLine } from "../airwallex/callBudget.js";

export class IccBudgetSpent extends Error {
  constructor(readonly budget: number, readonly method: string, readonly endpoint: string) {
    super(`the approved ICC call budget of ${budget} is spent; ${method} ${endpoint} was not sent (ask the owner before any further call)`);
    this.name = "IccBudgetSpent";
  }
}

export interface IccBudget {
  budget: number;
  file: string;
}

/** A budget is a whole number of calls, zero or more, and a log file to count them in. */
export function assertIccBudget(b: Partial<IccBudget>): asserts b is IccBudget {
  if (typeof b.budget !== "number" || !Number.isSafeInteger(b.budget) || b.budget < 0) throw new Error("the ICC client needs a call budget (a whole number); nothing was called");
  if (typeof b.file !== "string" || !b.file) throw new Error("the ICC client needs a call log (a file) to count its budget in; nothing was called");
}

/**
 * Counts one call: refused when the log already holds the approved number, else appended to the log. The caller sends
 * the request only after this returns. `endpoint` is the path with its ids already replaced (src/icc/client.ts).
 */
export function countIccCall(b: IccBudget, call: { method: string; endpoint: string; at: Date; pid?: number }): void {
  if (readCallLog(b.file).length >= b.budget) throw new IccBudgetSpent(b.budget, call.method, call.endpoint);
  const line: CallLine = { at: call.at.toISOString(), method: call.method, endpoint: call.endpoint, pid: call.pid ?? process.pid };
  appendFileSync(b.file, `${JSON.stringify(line)}\n`, { mode: 0o600 });
}

/** The budget the environment names. Both variables are required: a budget nobody counts is no budget. */
export function iccBudgetFromEnv(env: NodeJS.ProcessEnv | Record<string, string | undefined>): IccBudget {
  const budget = env.ICC_CALL_BUDGET, file = env.ICC_CALL_LOG;
  if (!budget || !file) throw new Error("ICC_CALL_BUDGET (a whole number) and ICC_CALL_LOG (a file) are both required; nothing was called");
  if (!/^\d{1,6}$/.test(budget)) throw new Error("ICC_CALL_BUDGET must be a whole number; nothing was called");
  return { budget: Number(budget), file };
}
