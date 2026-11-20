// The Airwallex soaks (npm run airwallex:soak): every record docs/runs/<date>-airwallex-soak.json, with its run log
// (.md beside it), oldest first. 19 Nov and 20 Nov so far. The pages read each figure from these records and sum them
// where they show one figure for all soaks (src/redesign/evidenceWallData.ts); each soak is its own row on /runs
// (src/redesign/runs.ts) and its own run in the API trail (src/airwallex/apiTrail.ts). Nothing is typed in: a new soak
// record is found by its name. Read at build time only, never by the Worker.

import { readdirSync, readFileSync } from "node:fs";

export const SOAK_NAME = /^(\d{4}-\d{2}-\d{2})-airwallex-soak\.json$/;

export interface SoakSummary {
  planned: number; created: number; paid: number; readback_matches: number;
  conversions: { planned: number; booked: number; readback_matches: number };
  latency_ms: { p50: number };
  calls: { total: number };
  negatives: { planned: number; refused: number; posts_in_window: number; creates_in_window: number; calls_in_window: number; by_endpoint_in_window?: Record<string, number> };
  errors?: unknown[];
}
export interface SoakRecord {
  started_at: string; ended_at: string;
  budget: { approved: number | null; used: number };
  summary: SoakSummary;
  payments: { invoice_no: string; transfer_id: string | null; proposal_id?: string; terms_sha256?: string; currency?: string; amount?: string; status_after_execute?: string; readback?: { approval_sha256?: string } | null }[];
}
export interface Soak { file: string; log: string; day: string; rec: SoakRecord }

const ROOT = new URL("../../", import.meta.url);

/** Every soak record under docs/runs, oldest first; a record that cannot be read, or created nothing, is left out. */
export function soaks(): Soak[] {
  let names: string[];
  try { names = readdirSync(new URL("docs/runs/", ROOT)); } catch { return []; }
  return names.filter((n) => SOAK_NAME.test(n)).sort().flatMap((n) => {
    // The path is rebuilt from the date's three numbers, so only digits from the listing ever reach a page (CodeQL).
    const [y, m, d] = SOAK_NAME.exec(n)![1]!.split("-").map(Number) as [number, number, number];
    const day = `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const file = `docs/runs/${day}-airwallex-soak.json`;
    try {
      const rec = JSON.parse(readFileSync(new URL(file, ROOT), "utf8")) as SoakRecord;
      return rec.summary?.created ? [{ file, log: file.replace(/\.json$/, ".md"), day, rec }] : [];
    } catch { return []; }
  });
}

/** The soaks' figures summed, record by record (each figure the sum of the same field in every record). */
export function soakTotals(all: readonly Soak[] = soaks()) {
  const sum = (f: (s: SoakSummary) => number) => all.reduce((n, s) => n + f(s.rec.summary), 0);
  const reads: Record<string, number> = {};
  for (const s of all) for (const [e, c] of Object.entries(s.rec.summary.negatives.by_endpoint_in_window ?? {})) reads[e] = (reads[e] ?? 0) + c;
  return {
    soaks: all.length,
    created: sum((m) => m.created), paid: sum((m) => m.paid), readbackMatches: sum((m) => m.readback_matches),
    fx: { planned: sum((m) => m.conversions.planned), booked: sum((m) => m.conversions.booked), readbackMatches: sum((m) => m.conversions.readback_matches) },
    negatives: { planned: sum((m) => m.negatives.planned), refused: sum((m) => m.negatives.refused), posts: sum((m) => m.negatives.posts_in_window), creates: sum((m) => m.negatives.creates_in_window), calls: sum((m) => m.negatives.calls_in_window), reads },
    calls: sum((m) => m.calls.total),
    /** The records and their run logs, for data-rec. */
    files: all.flatMap((s) => [s.file, s.log]),
  };
}
