// The T:0 sink (Phase E), behind T0_ENABLED: after a money action is final, Purser's books are posted to T:0 in the
// background, with the same client, entry builder and push as `npm run t0 -- push` (src/accounting/t0.ts).
//
// - Idempotent per journal entry: each entry's je_number is a hash of its content; what the ledger's t0_postings table
//   holds, or T:0 already lists, is skipped, and a replayed idempotency key (409 CAPI34) counts as posted.
// - Never in the way of a payment: it runs after the action, is never awaited by it, and every failure (no key, a
//   missing rate or account, T:0 down) is logged in one line and dropped. A later run posts what is still missing.
// - The key comes from T0_API_KEY in the environment only and is never logged. T0_RATES ("USD=0.92,EUR=1.00": units of
//   T:0's functional currency per unit) and T0_MAP=sandbox are optional, as the CLI's --rate and --map.

import type { DB } from "../db/open.js";
import { redactSecrets } from "../lib/redact.js";
import { T0_SANDBOX_MAP } from "../config/t0Map.js";
import { books, type Posting } from "./books.js";
import { buildEntries, functionalCurrency, pushBooks, recordT0Posting, resolveAccounts, T0Client, t0Posted, type T0Rate } from "./t0.js";

export function t0Enabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.T0_ENABLED === "on" || env.T0_ENABLED === "1" || env.T0_ENABLED === "true";
}

/** T0_RATES as a rate function, or why it cannot be read. */
export function ratesFromEnv(raw: string | undefined): T0Rate | string {
  const m = new Map<string, number>();
  for (const part of (raw ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
    const hit = /^([A-Za-z]{3,4})=(\d+(?:\.\d+)?)$/.exec(part);
    if (!hit || Number(hit[2]) <= 0) return `T0_RATES: "${part.slice(0, 20)}" is not CUR=rate`;
    m.set(hit[1]!.toUpperCase(), Number(hit[2]));
  }
  return (_date, cur) => m.get(cur);
}

export type T0SinkResult =
  | { ran: false; reason: "off" | "no key" }
  | { ran: true; ok: true; posted: number; skipped: number }
  | { ran: true; ok: false; error: string };

export interface T0SinkDeps {
  env?: NodeJS.ProcessEnv;
  /** A client (tests pass one on a fake); else one from T0_API_KEY, T0_BASE_URL and T0_ENTITY. */
  client?: Pick<T0Client, "listGlAccounts" | "profitLoss" | "listJournalEntries" | "postJournalEntry">;
  /** The books to post; the ledger's own by default. */
  books?: (db: DB) => { balanced: boolean; postings: Posting[] };
  log?: (line: string) => void;
}

/** One push of the books to T:0. Never throws. */
export async function t0SinkOnce(db: DB, deps: T0SinkDeps = {}): Promise<T0SinkResult> {
  const env = deps.env ?? process.env;
  if (!t0Enabled(env)) return { ran: false, reason: "off" };
  const key = env.T0_API_KEY?.trim();
  if (!deps.client && !key) {
    deps.log?.("t0       T0_ENABLED is on but T0_API_KEY is not set: nothing posted");
    return { ran: false, reason: "no key" };
  }
  try {
    const client = deps.client ?? new T0Client({ apiKey: key!, baseUrl: env.T0_BASE_URL || undefined, entity: env.T0_ENTITY || undefined });
    const b = (deps.books ?? books)(db);
    if (!b.balanced) throw new Error("our books are not balanced (npm run books); nothing posted");
    const rate = ratesFromEnv(env.T0_RATES);
    if (typeof rate === "string") throw new Error(rate);
    const { currency, atomsPerUnit } = await functionalCurrency(client);
    const { map, labels } = resolveAccounts(await client.listGlAccounts(), b.postings.map((p) => p.account), { fallback: env.T0_MAP === "sandbox" ? T0_SANDBOX_MAP : undefined });
    const entries = buildEntries(b.postings, map, currency, rate, { atomsPerUnit, labels });
    const r = await pushBooks(client, entries, t0Posted(db), (p, e) => recordT0Posting(db, p, e));
    if (r.posted.length) deps.log?.(`t0       ${r.posted.length} journal entr${r.posted.length === 1 ? "y" : "ies"} posted to T:0 (${r.skipped.length} already there)`);
    return { ran: true, ok: true, posted: r.posted.length, skipped: r.skipped.length };
  } catch (e) {
    const error = redactSecrets(e instanceof Error ? e.message : String(e)).split(key || "\u0000").join("[key]").slice(0, 300);
    deps.log?.(`t0       push to T:0 failed, ignored (the payment is not affected): ${error}`);
    return { ran: true, ok: false, error };
  }
}

/**
 * Runs the sink after each final money action, one push at a time: a request while one runs is folded into one more run
 * after it, so two pushes never list and post at the same moment.
 */
export class T0Sink {
  private running: Promise<void> | null = null;
  private again = false;
  last: T0SinkResult | null = null;

  constructor(private readonly db: DB, private readonly deps: T0SinkDeps = {}) {}

  /** Asks for a push; returns at once. The promise is for tests; a payment never waits on it. */
  afterMoney(): Promise<void> {
    if (!t0Enabled(this.deps.env ?? process.env)) return Promise.resolve();
    if (this.running) {
      this.again = true;
      return this.running;
    }
    const loop = async () => {
      do {
        this.again = false;
        this.last = await t0SinkOnce(this.db, this.deps);
      } while (this.again);
    };
    this.running = loop().finally(() => { this.running = null; });
    return this.running;
  }
}

const sinks = new WeakMap<DB, T0Sink>();
/** The process's sink for this ledger (the executor dispatch and the runner share it). */
export function t0SinkFor(db: DB, deps: T0SinkDeps = { log: (line) => console.log(line) }): T0Sink {
  let s = sinks.get(db);
  if (!s) sinks.set(db, (s = new T0Sink(db, deps)));
  return s;
}
