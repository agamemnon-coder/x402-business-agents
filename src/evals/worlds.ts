// D26: the variation test's worlds, generated from a seed (pure: the same seed gives the same world, always). Each world
// varies what the agents meet: Stockline's and Ridgeline's prices and data age, how many suppliers there are (one,
// two, or two plus a third stand-in supplier outside the Sourcing mandate's payees), when Stockline's price rises,
// the kind of dispute (justified, partly justified, false), the licence invoice's amount, whether the Sourcing card
// declines the software plan, and how money comes in (exact, short, unmatched). src/evals/simWorld.ts runs one.

export type DisputeKind = "justified" | "partly" | "false";
export type MoneyIn = "exact" | "short" | "unmatched";

export interface SimWorldSpec {
  seed: number;
  /** 1: Stockline only; 2: Stockline and Ridgeline Data; 3: both plus a stand-in supplier the mandate cannot pay. */
  suppliers: 1 | 2 | 3;
  stockline: { beforeCents: number; afterCents: number; ageSeconds: number };
  ridgeline: { priceCents: number; ageSeconds: number; unavailableOf20: number } | null;
  third: { name: string; priceCents: number; ageSeconds: number } | null;
  /** The Sourcing mandate's cap per purchase. */
  capCents: number;
  /** The query price customers pay. */
  sellCents: number;
  /** Stock checks Summit already bought before the world starts (#1..#history), the ones a dispute can name. */
  history: number;
  /** Customer queries during the world (#history+1 onwards). */
  queries: number;
  /** Stockline's price rises after this many of those queries. */
  priceRiseAfter: number;
  dispute: { kind: DisputeKind; seqs: number[]; wrong: number[] };
  /** The licence invoice's total in EUR cents (the contract in code says 240.00). */
  invoiceEurCents: number;
  /** The Sourcing card's limit is under the Pro plan's 45.00 EUR, so Airwallex declines it. */
  cardDecline: boolean;
  moneyIn: MoneyIn;
}

/** mulberry32: a small, well-mixed PRNG; deterministic per seed. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const THIRD_NAMES = ["Northgate Stock", "Peakview Data", "Trailhead Feeds"];

export function generateWorld(seed: number): SimWorldSpec {
  const r = rng(seed * 2654435761);
  const int = (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;

  const capCents = pick([3, 3, 3, 4]);
  const before = 2;
  const sellCents = pick([4, 5, 5, 5, 6, 7]);
  const suppliers = pick([1, 2, 2, 2, 3] as const);
  const stockline = { beforeCents: before, afterCents: int(3, 6), ageSeconds: pick([5, 5, 10, 30]) };
  const ridgeline = suppliers === 1 ? null : { priceCents: int(2, 5), ageSeconds: pick([30, 60, 120, 300, 600, 900, 1800, 3600]), unavailableOf20: int(0, 15) };
  const third = suppliers === 3 ? { name: pick(THIRD_NAMES), priceCents: int(1, 3), ageSeconds: pick([5, 20, 60]) } : null;
  const history = 16;
  const queries = int(8, 12);
  const priceRiseAfter = int(1, queries - 3);

  const kind = pick(["justified", "partly", "false"] as const);
  const first = int(1, history - 4);
  const count = kind === "justified" ? int(3, 5) : int(4, Math.min(12, history - first + 1));
  const seqs = Array.from({ length: Math.min(count, history - first + 1) }, (_, i) => first + i);
  const wrong = kind === "justified" ? [...seqs] : kind === "false" ? [] : seqs.filter(() => r() < 0.3);
  if (kind === "partly" && wrong.length === 0) wrong.push(seqs[1]!);
  if (kind === "partly" && wrong.length === seqs.length) wrong.pop();

  return {
    seed, suppliers, stockline, ridgeline, third, capCents, sellCents, history, queries, priceRiseAfter,
    dispute: { kind, seqs, wrong },
    invoiceEurCents: pick([24_000, 24_000, 24_000, 21_600, 26_400, 240_000]),
    cardDecline: r() < 0.5,
    moneyIn: pick(["exact", "short", "unmatched"] as const),
  };
}

export const generateWorlds = (start: number, count: number): SimWorldSpec[] => Array.from({ length: count }, (_, i) => generateWorld(start + i));
