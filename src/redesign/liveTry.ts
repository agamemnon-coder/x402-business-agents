// The public /try walked as a visitor, recorded (scripts/try-live-record.ts, then scripts/try-live-summary.ts): every
// folder under docs/runs whose summary.json has that shape (an aggregate with a run count, and the runs), read and added
// up. 19 Nov: docs/runs/2026-11-19-live-try (8 walks); a later, bigger recording in the same shape is picked up the same
// way, with no change here. Percentiles are recomputed over every run's own step times (nearest rank, as the summary
// script does), never averaged from the records' own p50s. Test money only: the /try simulated bank, payouts to the
// Airwallex sandbox, PAID by the sandbox's simulation.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";

const ROOT = new URL("../../", import.meta.url);
const RUNS_DIR = "docs/runs";

type J = Record<string, unknown>;
const isRec = (v: unknown): v is J => typeof v === "object" && v !== null && !Array.isArray(v);
const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** One recorded series of /try walks: its folder, its run log (when there is one), and its summary as written. */
export interface LiveTryRecord { dir: string; summary: string; log: string | null; first: string; last: string; aggregate: J; runs: J[] }

/** Is this summary.json one of try-live-summary.ts's: an aggregate with runs counted, and the runs themselves? */
const isLiveTry = (s: unknown): s is { aggregate: J; runs: J[] } =>
  isRec(s) && isRec(s.aggregate) && typeof s.aggregate.runs === "number" && Array.isArray(s.runs) && s.runs.every((r) => isRec(r) && typeof r.run === "number" && isRec(r.steps_ms));

/** Every recorded series of /try walks under docs/runs, oldest first. */
export function liveTryRecords(): LiveTryRecord[] {
  let names: string[];
  try { names = readdirSync(new URL(`${RUNS_DIR}/`, ROOT)); } catch { return []; }
  const out: LiveTryRecord[] = [];
  for (const name of names.sort()) {
    const dir = `${RUNS_DIR}/${name}`;
    if (!statSync(new URL(dir, ROOT)).isDirectory()) continue;
    const summary = `${dir}/summary.json`;
    if (!existsSync(new URL(summary, ROOT))) continue;
    let s: unknown;
    try { s = JSON.parse(readFileSync(new URL(summary, ROOT), "utf8")); } catch { continue; }
    if (!isLiveTry(s)) continue;
    const log = existsSync(new URL(`${dir}.md`, ROOT)) ? `${dir}.md` : null;
    const starts = s.runs.map((r) => String(r.started_at ?? "")).filter(Boolean).sort();
    const ends = s.runs.map((r) => String(r.finished_at ?? r.started_at ?? "")).filter(Boolean).sort();
    out.push({ dir, summary, log, first: String(s.aggregate.first_start ?? starts[0] ?? ""), last: String(s.aggregate.last_finish ?? ends.at(-1) ?? ""), aggregate: s.aggregate, runs: s.runs });
  }
  return out.sort((a, b) => a.first.localeCompare(b.first));
}

/** p50 and p95 by nearest rank, as scripts/try-live-summary.ts computes them. */
export const nearestRank = (xs: number[], q: number): number | null => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)]! : null;
};
export interface Pct { n: number; p50: number | null; p95: number | null }
const pctOf = (xs: number[]): Pct => ({ n: xs.length, p50: nearestRank(xs, 0.5), p95: nearestRank(xs, 0.95) });

/** Every series added up: counts summed, request ids made distinct, percentiles over every run's own times. */
export interface LiveTryTotals {
  records: string[];
  days: string[];
  runs: number; ok: number;
  transfers: number; paid: number; scheduledToPaid: Pct;
  approvalsMatching: number; refused: number; held: number;
  proofs: number; proofsValid: number;
  claude: { entries: number; requests: number; distinctIds: number; fallbacks: number; costMicros: number; models: string[] };
  consoleErrors: number; outsideRequests: number;
  steps: Record<string, Pct>;
}

export function liveTryTotals(records: LiveTryRecord[] = liveTryRecords()): LiveTryTotals | null {
  if (!records.length) return null;
  const sum = (k: string) => records.reduce((a, r) => a + n(r.aggregate[k]), 0);
  const claude = (k: string) => records.reduce((a, r) => a + n(isRec(r.aggregate.claude) ? r.aggregate.claude[k] : 0), 0);
  const awx = (k: string) => records.reduce((a, r) => a + n(isRec(r.aggregate.airwallex) ? r.aggregate.airwallex[k] : 0), 0);
  const runs = records.flatMap((r) => r.runs);
  const ids = new Set(runs.flatMap((r) => (isRec(r.claude) ? arr(r.claude.request_ids) : []).filter((x): x is string => typeof x === "string")));
  const models = [...new Set(records.flatMap((r) => (isRec(r.aggregate.claude) ? arr(r.aggregate.claude.models) : []).map(String)))].sort();
  const stepKeys = [...new Set(runs.flatMap((r) => Object.keys(r.steps_ms as J)))];
  const steps = Object.fromEntries(stepKeys.map((k) => [k, pctOf(runs.map((r) => (r.steps_ms as J)[k]).filter((x): x is number => typeof x === "number"))]));
  const s2p = runs.flatMap((r) => arr(r.airwallex).map((t) => (isRec(t) ? t.scheduled_to_paid_ms : null))).filter((x): x is number => typeof x === "number");
  const proofs = runs.reduce((a, r) => a + (isRec(r.bundle) ? (isRec(r.bundle.downloaded) ? 1 : 0) + (isRec(r.bundle.paid) ? 1 : 0) : 0), 0);
  const valid = runs.reduce((a, r) => {
    if (!isRec(r.bundle)) return a;
    const ok = (b: unknown) => isRec(b) && /^VALID\b/.test(String(b.verify_page ?? "")) && isRec(b.repo_verifier) && b.repo_verifier.ok === true;
    return a + (ok(r.bundle.downloaded) ? 1 : 0) + (ok(r.bundle.paid) ? 1 : 0);
  }, 0);
  return {
    records: records.map((r) => r.summary),
    days: [...new Set(records.map((r) => r.first.slice(0, 10)))],
    runs: sum("runs"), ok: sum("ok"),
    transfers: awx("transfers"), paid: awx("paid"), scheduledToPaid: pctOf(s2p),
    approvalsMatching: sum("approvals_matching_transfer"), refused: sum("refused"), held: sum("held"),
    proofs, proofsValid: valid,
    claude: { entries: claude("entries"), requests: claude("api_requests"), distinctIds: ids.size, fallbacks: claude("fallbacks"), costMicros: claude("cost_usd_micros"), models },
    consoleErrors: sum("console_errors"), outsideRequests: sum("outside_requests"),
    steps,
  };
}
