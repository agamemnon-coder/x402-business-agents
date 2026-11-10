// The platform end-to-end's call budget (Max, 10 November): before a live run, Max approves a number of calls per
// outside service, and code keeps to it. Every request counts (logins and retries too); the one that would go over
// the approved number is refused before it leaves this machine. The log holds the service, method, path (ids replaced
// by {id}) and time; never a body, a query or a header, so no key or token can reach it.

import { appendFileSync } from "node:fs";
import { endpointOf } from "../airwallex/callBudget.js";

export type Service = "airwallex" | "t0" | "claude" | "metal";

/** Phase 2's approved budget (coordinator, 10 November). Metal is not part of this run. */
export const PHASE2_BUDGET: Readonly<Record<Service, number>> = { airwallex: 26, t0: 12, claude: 8, metal: 0 };

export class BudgetSpent extends Error {
  constructor(readonly service: Service, readonly cap: number, readonly what: string) {
    super(`the approved ${service} budget of ${cap} call${cap === 1 ? "" : "s"} is spent; ${what} was not sent (ask before any further call)`);
    this.name = "BudgetSpent";
  }
}

export interface CallRecord { at: string; service: Service; method: string; endpoint: string }

const pathOf = (service: Service, url: string): string => {
  if (service === "airwallex") return endpointOf(url);
  const p = new URL(url).pathname;
  return p.split("/").map((s) => (/^[A-Za-z0-9_-]{16,}$/.test(s) || /^[0-9a-f-]{32,}$/i.test(s) ? "{id}" : s)).join("/");
};

export class CallBudget {
  readonly calls: CallRecord[] = [];
  constructor(readonly caps: Readonly<Record<Service, number>>, private readonly o: { file?: string; now?: () => Date } = {}) {
    for (const [s, n] of Object.entries(caps)) if (!Number.isSafeInteger(n) || n < 0) throw new Error(`not a call budget for ${s}: ${n}`);
  }

  used(service: Service): number { return this.calls.filter((c) => c.service === service).length; }
  left(service: Service): number { return this.caps[service] - this.used(service); }

  /** Counts one call, or refuses it (throws BudgetSpent) when the service's budget is spent. */
  take(service: Service, method: string, endpoint: string): void {
    if (this.used(service) >= this.caps[service]) throw new BudgetSpent(service, this.caps[service], `${method} ${endpoint}`);
    const c: CallRecord = { at: (this.o.now ?? (() => new Date()))().toISOString(), service, method, endpoint };
    this.calls.push(c);
    if (this.o.file) appendFileSync(this.o.file, `${JSON.stringify(c)}\n`, { mode: 0o600 });
  }

  /** A fetch that counts each request against `service` before sending it. */
  fetchFor(service: Service, inner: typeof fetch = fetch): typeof fetch {
    return (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const method = (init?.method ?? (typeof input === "object" && "method" in input ? input.method : "GET")).toUpperCase();
      this.take(service, method, pathOf(service, url));
      return inner(input, init);
    }) as typeof fetch;
  }

  /** Calls per service and endpoint, for the run record. */
  summary(): { service: Service; endpoint: string; calls: number }[] {
    const m = new Map<string, { service: Service; endpoint: string; calls: number }>();
    for (const c of this.calls) {
      const k = `${c.service} ${c.method} ${c.endpoint}`;
      const e = m.get(k) ?? { service: c.service, endpoint: `${c.method} ${c.endpoint}`, calls: 0 };
      e.calls++;
      m.set(k, e);
    }
    return [...m.values()];
  }
}
