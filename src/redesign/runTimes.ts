// Face ID to paid (master list 81): how long a payout took from the CFO's Face ID to Airwallex's PAID, read from the run
// records alone. Only a payout a person approved with Face ID and that reached PAID counts; a run signed with a test
// passkey, or a record without both times, is left out and listed as left out, with the reason. Nothing is typed in: the
// times are read from the record's own timeline rows, and the record's own "x s after Face ID" must agree with them
// (test/run-times.test.ts). The result feeds one calm line on /runs: "Face ID to paid: median X, from Y to Z, over N".

import { readFileSync } from "node:fs";

/** The records read here, in order. Each one either gives timed payouts or is left out with its reason. */
export const RUN_TIME_RECORDS = {
  awx1: "docs/runs/2026-11-07-awx-1.md",
  twoLocks: "docs/runs/2026-11-12-airwallex-two-locks-paid.md",
  platform: "docs/runs/2026-11-10-platform-e2e.md",
} as const;

export interface TimedPayout {
  record: string; proposal: string; step: string;
  /** ISO times (UTC), read from the record's timeline rows. */
  approvedAt: string; paidAt: string;
  /** Milliseconds from the Face ID row to the PAID row. */
  ms: number;
  /** What the record itself says, "6.3 s after Face ID", when it says it. */
  stated: number | null;
}
export interface LeftOut { record: string; why: string }
export interface RunTimes {
  payouts: TimedPayout[]; leftOut: LeftOut[];
  n: number; medianMs: number | null; minMs: number | null; maxMs: number | null;
}

const read = (file: string): string | null => { try { return readFileSync(new URL(`../../${file}`, import.meta.url), "utf8"); } catch { return null; } };

/** The record's day (YYYY-MM-DD), from its file name. */
const dayOf = (file: string) => /(\d{4}-\d{2}-\d{2})/.exec(file)?.[1] ?? null;

/** A timeline cell "12:12:20.250" or "12:12:25.487 / 26.568" → the last time in it, as hh:mm:ss.mmm. */
function lastTime(cell: string): string | null {
  const m = /(\d{2}):(\d{2}):(\d{2})\.(\d{3})(?:\s*\/\s*(\d{2})\.(\d{3}))?/.exec(cell);
  if (!m) return null;
  return m[5] ? `${m[1]}:${m[2]}:${m[5]}.${m[6]}` : `${m[1]}:${m[2]}:${m[3]}.${m[4]}`;
}

/**
 * The payouts of a run log whose timeline has, per step, a row "**… approves P-000N with Face ID**" and a later row
 * "… **PAID** (x s after Face ID)". Pairs them by the step's key (f1, f2, ...). A Face ID approval with no PAID row in
 * its step (a card limit raise, say) is not a payout and is skipped.
 */
export function faceIdPayouts(md: string, record: string): TimedPayout[] {
  const day = dayOf(record);
  if (!day) return [];
  const rows = md.split("\n").filter((l) => l.startsWith("| ")).map((l) => l.split("|").map((c) => c.trim()));
  const approvals = new Map<string, { proposal: string; at: string }>();
  const out: TimedPayout[] = [];
  for (const c of rows) {
    const [, when, step, what] = c;
    if (!when || !step || !what) continue;
    const t = lastTime(when);
    if (!t) continue;
    const a = /approves (P-\d{4}) with Face ID/.exec(what);
    if (a) { approvals.set(step, { proposal: a[1]!, at: `${day}T${t}Z` }); continue; }
    if (/\*\*PAID\*\*/.test(what)) {
      const ap = approvals.get(step);
      if (!ap) continue;
      const paidAt = `${day}T${t}Z`;
      const stated = /\(([\d.]+) s after Face ID\)/.exec(what);
      out.push({ record, proposal: ap.proposal, step, approvedAt: ap.at, paidAt, ms: Date.parse(paidAt) - Date.parse(ap.at), stated: stated ? Number(stated[1]) : null });
    }
  }
  return out;
}

/** The median of a list of numbers (the mean of the two middle ones for an even count), or null when empty. */
export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** Why a record is left out, read from its own words; null when it has no reason to be left out. */
export function leftOutWhy(md: string): string | null {
  if (/virtual test passkey/i.test(md) && !/with Face ID\*\*/.test(md)) return "signed with a labelled virtual test passkey, not Face ID";
  if (/test passkey/i.test(md) && !/with Face ID\*\*/.test(md)) return "signed with a test passkey, not Face ID";
  return null;
}

/** Face ID to paid over the records above. */
export function runTimes(files: readonly string[] = Object.values(RUN_TIME_RECORDS), load: (f: string) => string | null = read): RunTimes {
  const payouts: TimedPayout[] = [];
  const leftOut: LeftOut[] = [];
  for (const file of files) {
    const md = load(file);
    if (!md) { leftOut.push({ record: file, why: "the record is missing" }); continue; }
    const why = leftOutWhy(md);
    if (why) { leftOut.push({ record: file, why }); continue; }
    const got = faceIdPayouts(md, file);
    if (got.length) payouts.push(...got);
    else leftOut.push({ record: file, why: "no Face ID approval and PAID time in the record" });
  }
  const ms = payouts.map((p) => p.ms);
  return { payouts, leftOut, n: payouts.length, medianMs: median(ms), minMs: ms.length ? Math.min(...ms) : null, maxMs: ms.length ? Math.max(...ms) : null };
}

/** Seconds with one decimal, as the records write them ("6.3 s"). */
export const secs = (ms: number) => `${(Math.round(ms / 100) / 10).toFixed(1)} s`;

/** The one line on /runs, or null when no payout is timed. */
export function runTimesLine(t: RunTimes = runTimes()): string | null {
  if (!t.n || t.medianMs === null || t.minMs === null || t.maxMs === null) return null;
  const spread = t.n > 1 ? `, from ${secs(t.minMs)} to ${secs(t.maxMs)}` : "";
  return `Face ID to paid: median ${secs(t.medianMs)}${spread}, over ${t.n} payout${t.n === 1 ? "" : "s"}.`;
}
