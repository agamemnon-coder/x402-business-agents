// Feedstock Labs' raw EUR/USD session of 30 October, one tick a second from 09:00:01 UTC.
// A feed fault published ticks 7, 10 and 13 with bid and ask 0.02500 too high; the correction
// notice (fixtures/feedstock-corrections.txt) gives the true values, which are the ones in BIDS.

/** True bids in units of 0.00001, tick 1 first. Ask is always bid + 0.00002. */
const BIDS = [
  108494, 108498, 108497, 108493, 108499, 108499, 108493, 108490, 108492, 108497,
  108503, 108501, 108499, 108502, 108503, 108498, 108493, 108487, 108483, 108479,
  108478, 108479, 108480, 108476, 108481, 108485, 108482, 108478, 108483, 108481,
  108485, 108485, 108486, 108491, 108485, 108482, 108477, 108476, 108475, 108474,
  108479, 108483, 108487, 108489, 108491, 108495, 108500, 108497, 108497, 108498,
];
const SPREAD_UNITS = 2;
const FAULT_UNITS = 2500;
export const FAULTY_SEQS: readonly number[] = [7, 10, 13];

export type Tick = { seq: number; pair: "EUR/USD"; bid: string; ask: string; ts: string };

const price = (units: number) => (units / 100_000).toFixed(5);

/** One session day of ticks, one a second. */
export const SESSION_TICKS = 86_400;

/**
 * True bid for seq: the recorded 50 first, then the session goes on as a smooth deterministic drift around the last
 * recorded bid (no faults after tick 50), so sales past 50 (a second run, clearing sales) still have data.
 */
function trueBid(seq: number): number {
  if (seq <= BIDS.length) return BIDS[seq - 1]!;
  const n = seq - BIDS.length;
  return BIDS[BIDS.length - 1]! + Math.round(18 * Math.sin(n / 37) + 6 * Math.sin(n / 5.3));
}

/** The tick the supplier serves for seq, with the feed fault unless corrected; throws outside the session. */
export function servedTick(seq: number, corrected: boolean): Tick {
  if (!Number.isSafeInteger(seq) || seq < 1 || seq > SESSION_TICKS) throw new RangeError(`no tick #${seq}`);
  const bid = trueBid(seq) + (!corrected && FAULTY_SEQS.includes(seq) ? FAULT_UNITS : 0);
  const ts = new Date(Date.UTC(2026, 9, 30, 9, 0, seq)).toISOString();
  return { seq, pair: "EUR/USD", bid: price(bid), ask: price(bid + SPREAD_UNITS), ts };
}
