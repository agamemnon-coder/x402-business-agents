// Max, 2 November (D26): how long Treasury takes to put options to the CFO once customers are turned away. Measured as
// the dry-run harness does (test/browser/dryrun.check.ts, "TREASURY TIMING"): from the first customers.turned_away
// world event (or, where none was published, the third buy-policy refusal) to the first mandate_replace proposal.
// Read from any ledger, simulated or live, so both kinds of world are measured the same way and reported apart.

import type { DB } from "../db/open.js";

export interface TreasuryTiming {
  /** Whether customers were turned away in this world at all. */
  applies: boolean;
  from: "customers.turned_away" | "third buy_policy refusal" | null;
  /** Seconds to the first options; null when none came (see words). */
  seconds: number | null;
  words: string;
}

export function treasuryTiming(db: DB, endedAt = new Date()): TreasuryTiming {
  const event = db.prepare("SELECT created_at FROM world_events WHERE kind = 'customers.turned_away' ORDER BY id LIMIT 1").get() as { created_at: string } | undefined;
  const third = event ? undefined : db.prepare("SELECT created_at FROM upstream_purchases WHERE outcome = 'REFUSED' AND refusal_reason LIKE 'buy_policy:%' ORDER BY id LIMIT 1 OFFSET 2").get() as { created_at: string } | undefined;
  const start = event ?? third;
  if (!start) return { applies: false, from: null, seconds: null, words: "no customer turned away" };
  const from = event ? "customers.turned_away" : "third buy_policy refusal";
  const proposed = db.prepare("SELECT created_at FROM proposals WHERE kind = 'mandate_replace' ORDER BY created_at LIMIT 1").get() as { created_at: string } | undefined;
  if (!proposed) return { applies: true, from, seconds: null, words: `none within ${Math.round((endedAt.getTime() - Date.parse(start.created_at)) / 1000)} s` };
  const seconds = Math.round((Date.parse(proposed.created_at) - Date.parse(start.created_at)) / 1000);
  if (seconds < 0) return { applies: true, from, seconds: 0, words: "options already waiting for the CFO when the third customer was turned away" };
  return { applies: true, from, seconds, words: `options ${seconds} s after the third customer was turned away` };
}

/** n (worlds where options came), how many had none, the median, p90 (nearest rank) and the maximum, in seconds. */
export function timingStats(values: (number | null)[]): { n: number; none: number; median: number | null; p90: number | null; max: number | null } {
  const xs = values.filter((v): v is number => v !== null).sort((a, b) => a - b);
  const none = values.length - xs.length;
  if (xs.length === 0) return { n: 0, none, median: null, p90: null, max: null };
  const mid = xs.length / 2;
  const median = xs.length % 2 ? xs[Math.floor(mid)]! : (xs[mid - 1]! + xs[mid]!) / 2;
  return { n: xs.length, none, median, p90: xs[Math.ceil(0.9 * xs.length) - 1]!, max: xs.at(-1)! };
}
