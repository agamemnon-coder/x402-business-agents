// The API credit for the product's own Claude calls. 12 November (master-list line 422): a $150 ceiling with a hard stop
// at $140. Once the recorded total reaches $140, no block may start new spend; the $10 above it is not spendable. Every
// script that spends records its cost here (the cost each Claude call already reports, in micro-dollars); a script asks
// `spendRefusal` (or reads `over` in `budgetStatus`) before it spends. `npm run budget` prints the counters, per block, per
// day and per run, and warns at 80%.
//
// The split sums to exactly $140 and no block is below what it had already spent on 12 November (evals 24.77, redteam
// 2.46, reviews 2.09, coder 0.41, ap-agents 1.72). `try` is the jury demo: at most $15 of it per UTC day. The /try site
// keeps its own day cap in D1 (`try_switches`); the two must agree.

import { appendFileSync, existsSync, readFileSync } from "node:fs";

/** Dollars per block. Sums to BUDGET_STOP_USD. */
export const BUDGET_BLOCKS = { evals: 25, redteam: 10, soak: 25, reviews: 5, coder: 4, "ap-agents": 8, chain: 25, try: 38 } as const;
export type BudgetBlock = keyof typeof BUDGET_BLOCKS;
/** The ceiling of all Claude spend, and the hard stop below it. */
export const BUDGET_CEILING_USD = 150;
export const BUDGET_STOP_USD = 140;
/** Kept back between the stop and the ceiling: never spendable. */
export const BUDGET_RESERVE_USD = BUDGET_CEILING_USD - BUDGET_STOP_USD;
/** The jury demo's cap per UTC day, inside the `try` block. */
export const DAILY_CAPS_USD: Partial<Record<BudgetBlock, number>> = { try: 15 };
const WARN_AT = 0.8;

export interface Spend {
  block: BudgetBlock;
  usd_micros: number;
  what: string;
  /** The run this spend belongs to, when a script has one. */
  run?: string;
}
interface SpendLine extends Spend { at: string }

const isBlock = (b: unknown): b is BudgetBlock => typeof b === "string" && Object.hasOwn(BUDGET_BLOCKS, b);

/** Appends one spend (a JSON line). An unknown block is an error, so nothing is spent outside the plan. A spend that
 *  already happened is always recorded, also past a cap: the record stays true, and the next `spendRefusal` stops. */
export function recordSpend(file: string, s: Spend, at = new Date()): void {
  if (!isBlock(s.block)) throw new Error(`unknown budget block: ${String(s.block)}`);
  if (!Number.isSafeInteger(s.usd_micros) || s.usd_micros < 0) throw new Error(`bad spend: ${s.usd_micros}`);
  appendFileSync(file, `${JSON.stringify({ ...s, at: at.toISOString() })}\n`);
}

function readSpend(file: string): SpendLine[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as SpendLine);
}

const usd = (m: number) => Math.round(m / 10_000) / 100;
const utcDay = (iso: string) => iso.slice(0, 10);
const STOP_MICROS = BUDGET_STOP_USD * 1e6;

export interface BlockStatus {
  spentUsd: number;
  capUsd: number;
  warn: boolean;
  /** Over its own cap, or the total has reached the $140 stop. */
  over: boolean;
}

export function budgetStatus(file: string): { blocks: Record<BudgetBlock, BlockStatus>; totalUsd: number; stopped: boolean } {
  const micros = Object.fromEntries(Object.keys(BUDGET_BLOCKS).map((b) => [b, 0])) as Record<BudgetBlock, number>;
  // Every recorded line counts toward the total, also one of a block this version does not know.
  let total = 0;
  for (const s of readSpend(file)) {
    total += s.usd_micros;
    if (isBlock(s.block)) micros[s.block] += s.usd_micros;
  }
  const stopped = total >= STOP_MICROS;
  const blocks = Object.fromEntries((Object.keys(BUDGET_BLOCKS) as BudgetBlock[]).map((b) => {
    const cap = BUDGET_BLOCKS[b];
    return [b, { spentUsd: usd(micros[b]), capUsd: cap, warn: micros[b] >= cap * WARN_AT * 1e6, over: stopped || micros[b] > cap * 1e6 }];
  })) as Record<BudgetBlock, BlockStatus>;
  return { blocks, totalUsd: usd(total), stopped };
}

/** Spend per UTC day: the total and each block, in dollars, days in order. */
export function spendPerDay(file: string): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const s of readSpend(file)) {
    const d = (out[utcDay(s.at)] ??= { total: 0 });
    d[s.block] = (d[s.block] ?? 0) + s.usd_micros;
    d.total = (d.total ?? 0) + s.usd_micros;
  }
  return Object.fromEntries(Object.keys(out).sort().map((d) => [d, Object.fromEntries(Object.entries(out[d]!).map(([k, v]) => [k, usd(v)]))]));
}

/** Spend per run (only lines that name one), in dollars. */
export function spendPerRun(file: string): Record<string, { block: string; usd: number; lines: number }> {
  const out: Record<string, { block: string; micros: number; lines: number }> = {};
  for (const s of readSpend(file)) {
    if (!s.run) continue;
    const r = (out[s.run] ??= { block: s.block, micros: 0, lines: 0 });
    r.micros += s.usd_micros;
    r.lines++;
  }
  return Object.fromEntries(Object.entries(out).map(([k, r]) => [k, { block: r.block, usd: usd(r.micros), lines: r.lines }]));
}

/**
 * Why a new spend of up to `nextMicros` from `block` may not start, or null when it may. Refused: an unknown block; a
 * recorded total at the $140 stop, or one this spend would take past it; a block at its cap, or one this spend would take
 * past it; for a block with a day cap (`try`), a UTC day at its cap, or one this spend would take past it.
 */
export function spendRefusal(file: string, block: string, nextMicros = 0, now = new Date()): string | null {
  if (!isBlock(block)) return `unknown budget block: ${block}`;
  if (!Number.isSafeInteger(nextMicros) || nextMicros < 0) return `bad spend estimate: ${nextMicros}`;
  const lines = readSpend(file);
  const total = lines.reduce((a, s) => a + s.usd_micros, 0);
  if (total >= STOP_MICROS || total + nextMicros > STOP_MICROS) {
    return `the Claude budget stops at $${BUDGET_STOP_USD}: $${usd(total).toFixed(2)} is recorded${nextMicros ? `, and this spend could take it to $${usd(total + nextMicros).toFixed(2)}` : ""}`;
  }
  const spent = lines.filter((s) => s.block === block).reduce((a, s) => a + s.usd_micros, 0);
  const cap = BUDGET_BLOCKS[block] * 1e6;
  if (spent >= cap || spent + nextMicros > cap) return `the ${block} block is at its cap: $${usd(spent).toFixed(2)} of $${BUDGET_BLOCKS[block]} spent`;
  const dayCap = DAILY_CAPS_USD[block];
  if (dayCap !== undefined) {
    const today = utcDay(now.toISOString());
    const spentToday = lines.filter((s) => s.block === block && utcDay(s.at) === today).reduce((a, s) => a + s.usd_micros, 0);
    if (spentToday >= dayCap * 1e6 || spentToday + nextMicros > dayCap * 1e6) return `the ${block} block's day cap is reached: $${usd(spentToday).toFixed(2)} of $${dayCap} on ${today}`;
  }
  return null;
}

/** spendRefusal as a throw: call it before a Claude call or a run starts. */
export function assertSpendAllowed(file: string, block: string, nextMicros = 0, now = new Date()): void {
  const why = spendRefusal(file, block, nextMicros, now);
  if (why) throw new Error(why);
}
