// Stockline's live stock checks of 30 October for one product at the Tilburg warehouse, one a second from 09:00:01
// UTC. A sync fault at Stockline published checks 7, 10 and 13 with 250 more units on hand than were there; the
// correction notice (fixtures/stockline-corrections.txt) gives the true values, which are the ones in ON_HAND.

/** True units on hand, check 1 first. Units reserved for open orders are always on hand / 8, rounded down. */
const ON_HAND = [
  94, 98, 97, 93, 99, 99, 93, 90, 92, 97,
  103, 101, 99, 102, 103, 98, 93, 87, 83, 79,
  78, 79, 80, 76, 81, 85, 82, 78, 83, 81,
  85, 85, 86, 91, 85, 82, 77, 76, 75, 74,
  79, 83, 87, 89, 91, 95, 100, 97, 97, 98,
];
const FAULT_UNITS = 250;
export const FAULTY_SEQS: readonly number[] = [7, 10, 13];

/** The product every check is for: Northwind's down parka, size M, at the Tilburg warehouse. */
export const SKU = "NW-PARKA-M";
export const WAREHOUSE = "Tilburg";

export type StockCheck = { seq: number; sku: string; warehouse: string; on_hand: number; reserved: number; ts: string };

/** One trading day of checks, one a second. */
export const SESSION_CHECKS = 86_400;

/**
 * True units on hand for seq: the recorded 50 first, then a smooth deterministic drift around the last recorded
 * value (no faults after check 50), so sales past 50 (a second run, clearing sales) still have data.
 */
function trueOnHand(seq: number): number {
  if (seq <= ON_HAND.length) return ON_HAND[seq - 1]!;
  const n = seq - ON_HAND.length;
  return ON_HAND[ON_HAND.length - 1]! + Math.round(18 * Math.sin(n / 37) + 6 * Math.sin(n / 5.3));
}

/** The check Stockline serves for seq, with the sync fault unless corrected; throws outside the day. */
export function servedCheck(seq: number, corrected: boolean): StockCheck {
  if (!Number.isSafeInteger(seq) || seq < 1 || seq > SESSION_CHECKS) throw new RangeError(`no stock check #${seq}`);
  const truth = trueOnHand(seq);
  const onHand = truth + (!corrected && FAULTY_SEQS.includes(seq) ? FAULT_UNITS : 0);
  const ts = new Date(Date.UTC(2026, 9, 30, 9, 0, seq)).toISOString();
  return { seq, sku: SKU, warehouse: WAREHOUSE, on_hand: onHand, reserved: Math.floor(truth / 8), ts };
}
