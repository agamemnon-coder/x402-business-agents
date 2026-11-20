// The HTTP log of a live sandbox drill (card drill and stop drill, 20 Nov): one JSON line per request the drill sends to
// the Airwallex sandbox, shared by every process of the run (the drill and the child it kills on purpose). Each line
// holds the method, the endpoint with ids folded, when it was sent and answered, the HTTP status, Airwallex's own
// request and trace ids, an error code, and a few facts the drill measures (a card's status, a simulated
// authorisation's result). Never a body as sent, a header, a token, a key or a card number.
//
// It also enforces the drill's rules before a request leaves this machine: the sandbox host only; at least 200 ms
// after the previous request of any process of the run; nothing after an unexpected 4xx or 5xx (the drill stops).

import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { endpointOf } from "../airwallex/callBudget.js";
import { traceOf } from "../airwallex/client.js";
import { redactSecrets } from "../lib/redact.js";

export const SANDBOX_HOST = "api.sandbox.airwallex.com";
/** The least time between two requests of the run, start to start, across its processes. */
export const DRILL_GAP_MS = 200;

/** A simulated authorisation as the sandbox answered it: only these fields are kept (never a card number). */
export interface SimAnswer {
  card_id: string | null; card_transaction_id: string | null; transaction_id: string | null; transaction_amount: number | string | null; transaction_currency: string | null;
  status: string | null; process_result: string | null; failure_reason: string | null; created_at: string | null; transaction_date: string | null; transacted_at?: string | null; transaction_type: string | null;
  merchant: { name: string | null; category_code: string | null } | null;
}

export interface DrillLine {
  n: number; pid: number; at: string; answered_at: string; ms: number; method: string; endpoint: string; status: number;
  awx_request_id: string | null; trace_id: string | null; code: string | null;
  /** A non-2xx answer: Airwallex's own message, redacted, at most 200 characters (added after pass 1 of the stop drill, 20 Nov). */
  message?: string | null;
  /** GET /issuing/cards/{id}: the card's status as Airwallex answered it. */
  card_status?: string | null;
  /** POST /simulation/issuing/create: the authorisation, whitelisted fields only. */
  sim?: SimAnswer;
}

export class DrillHalted extends Error {
  constructor(why: string) { super(`drill halted: ${why}; nothing more is sent`); this.name = "DrillHalted"; }
}

const CODE = /^[a-z0-9_.-]{1,64}$/i;
const str = (v: unknown): string | null => (typeof v === "string" ? v.slice(0, 120) : null);
const amount = (v: unknown): number | string | null => (typeof v === "number" || typeof v === "string" ? v : null);

/** The whitelisted fields of a simulated authorisation's answer (the sandbox's card transaction event shape). */
export function simAnswerOf(b: Record<string, unknown>): SimAnswer {
  const m = b.merchant && typeof b.merchant === "object" ? (b.merchant as Record<string, unknown>) : null;
  const ctd = b.card_transaction_data && typeof b.card_transaction_data === "object" ? (b.card_transaction_data as Record<string, unknown>) : null;
  return {
    card_id: str(b.card_id), card_transaction_id: str(b.card_transaction_id) ?? str(ctd?.card_transaction_id), transaction_id: str(b.transaction_id),
    transaction_amount: amount(b.transaction_amount), transaction_currency: str(b.transaction_currency), status: str(b.status), process_result: str(b.process_result),
    failure_reason: str(b.failure_reason), created_at: str(b.created_at), transaction_date: str(b.transaction_date), transacted_at: str(b.transacted_at), transaction_type: str(b.transaction_type) ?? str(b.type),
    merchant: m ? { name: str(m.name), category_code: str(m.category_code) } : null,
  };
}

export function readDrillLog(file: string): DrillLine[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as DrillLine);
}

/** The halt marker beside the log: once written, every process of the run refuses to send. */
const haltFile = (file: string) => `${file}.halt`;
export function drillHaltReason(file: string): string | null {
  return existsSync(haltFile(file)) ? readFileSync(haltFile(file), "utf8").trim() || "halted" : null;
}

/**
 * The sandbox's simulation refusing to simulate at all (seen live on 20 Nov, from 09:54 UTC, on frozen cards: HTTP 400
 * bad_request "failed to process transaction", after about 10 s). It is neither an approval nor a decline, and it moves
 * nothing; a drill may tolerate a few of them (recorded as such) instead of halting.
 */
export const isSimFailure = (l: Pick<DrillLine, "method" | "endpoint" | "status" | "message">): boolean =>
  l.method === "POST" && l.endpoint === "/simulation/issuing/create" && l.status === 400 && l.message === "failed to process transaction";

export interface DrillFetchOptions {
  file: string;
  /** How many isSimFailure answers the whole run's log may hold before they halt it too (default 0). */
  toleratedSimFailures?: number;
  /** Statuses that are expected answers in this drill (besides 2xx); any other 4xx or 5xx halts the run. 429 is retried by the client and only noted. */
  expected?: (line: DrillLine) => boolean;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

/** The drill's fetch over `inner` (the budgeted fetch, which counts each call in the run's call log). */
export function drillFetch(inner: typeof fetch, o: DrillFetchOptions): typeof fetch {
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = o.now ?? Date.now;
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (new URL(url).host !== SANDBOX_HOST) throw new DrillHalted(`refused a request to ${new URL(url).host}: the drill talks to ${SANDBOX_HOST} only`);
    const halted = drillHaltReason(o.file);
    if (halted) throw new DrillHalted(halted);
    const prev = readDrillLog(o.file).at(-1);
    const wait = prev ? Date.parse(prev.at) + DRILL_GAP_MS - now() : 0;
    if (wait > 0) await sleep(wait);
    const method = (init?.method ?? "GET").toUpperCase();
    const endpoint = endpointOf(url);
    const start = now();
    const line: DrillLine = { n: 0, pid: process.pid, at: new Date(start).toISOString(), answered_at: "", ms: 0, method, endpoint, status: 0, awx_request_id: null, trace_id: null, code: null };
    // Written before the answer is read: a process killed mid-request still leaves its line's start (status 0).
    const write = () => { line.n = readDrillLog(o.file).length + 1; appendFileSync(o.file, `${JSON.stringify(line)}\n`, { mode: 0o600 }); };
    let res: Response;
    try {
      res = await inner(input, init);
    } catch (e) {
      // Refused by the call budget before it was sent: not a request, so no line.
      if ((e as { name?: string }).name === "AirwallexBudgetSpent") throw e;
      line.answered_at = new Date(now()).toISOString();
      line.ms = now() - start;
      write();
      throw e;
    }
    line.answered_at = new Date(now()).toISOString();
    line.ms = now() - start;
    line.status = res.status;
    const t = traceOf(res.headers);
    line.awx_request_id = t.requestId ?? null;
    line.trace_id = t.traceId ?? null;
    const body = (await res.clone().json().catch(() => null)) as Record<string, unknown> | null;
    if (!res.ok) {
      const c = body?.code;
      if (typeof c === "string" && CODE.test(c)) line.code = c;
      if (typeof body?.message === "string") line.message = redactSecrets(body.message).slice(0, 200);
    }
    if (res.ok && method === "GET" && /^\/issuing\/cards\/\{id\}$/.test(endpoint)) line.card_status = str(body?.card_status);
    if (res.ok && method === "POST" && endpoint === "/simulation/issuing/create" && body) line.sim = simAnswerOf(body);
    write();
    const tolerated = isSimFailure(line) && readDrillLog(o.file).filter(isSimFailure).length <= (o.toleratedSimFailures ?? 0);
    if (res.status >= 400 && res.status !== 429 && !tolerated && !(o.expected?.(line) ?? false)) {
      writeFileSync(haltFile(o.file), `an unexpected HTTP ${res.status}${line.code ? ` ${line.code}` : ""} on ${method} ${endpoint} (line ${line.n})`);
    }
    return res;
  }) as typeof fetch;
}
