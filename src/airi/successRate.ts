// The Visa Intelligent Commerce runs through Airi, counted from their own records (master-list line 280): how many runs,
// how many succeeded, how many failed or stopped, and why. Every attempt is a run, failed ones included, as the records
// keep them. Live and stand-in runs are counted apart; nothing here is typed by hand. The /visa page renders this after
// the visa-vic-first stream merges.
//
// Records read: docs/demo/airi-run.json (vic-1, its `attempts`; the log is docs/runs/2026-11-07-vic-1.md),
// docs/demo/vic-2-run.json (vic-2, its `checks`), and docs/demo/vic-3-run.json when it exists (vic-3, the same shape).

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type VicOutcome = "succeeded" | "failed" | "stopped";
export interface VicRun { run: string; attempt: string; at: string; mode: "live" | "stand-in"; outcome: VicOutcome; reason: string | null; source: string }
export interface VicSuccessRate {
  runs: number;
  succeeded: number;
  failed: number;
  /** Succeeded of all runs, in percent with one decimal (null with no runs). */
  rate_pct: number | null;
  live: { runs: number; succeeded: number };
  stand_in: { runs: number; succeeded: number };
  reasons: { run: string; attempt: string; outcome: Exclude<VicOutcome, "succeeded">; reason: string }[];
  list: VicRun[];
}

interface AttemptsRecord { run: string; mode?: string; attempts?: { world: string; attempt?: number; at: string; outcome: string; cause: string | null }[] }
interface ChecksRecord { run: string; mode?: string; started_at?: string; checks?: Record<string, { ok: boolean; detail?: string }> }

const modeOf = (m: string | undefined): "live" | "stand-in" => (m === "live" ? "live" : "stand-in");

/** vic-1's record: one run per attempt, as it ended. */
export function fromAttempts(r: AttemptsRecord, source: string): VicRun[] {
  return (r.attempts ?? []).map((a) => ({
    run: r.run, attempt: a.attempt === undefined ? a.world : `${a.world} #${a.attempt}`, at: a.at, mode: modeOf(r.mode),
    outcome: a.outcome === "passed" ? "succeeded" : a.outcome === "stopped" ? "stopped" : "failed", reason: a.cause, source,
  }));
}

/** A run whose record lists its checks: succeeded when every check is ok, else failed with the checks that were not. */
export function fromChecks(r: ChecksRecord, source: string): VicRun[] {
  const checks = Object.entries(r.checks ?? {});
  if (!checks.length) return [];
  const bad = checks.filter(([, c]) => !c.ok);
  return [{ run: r.run, attempt: r.run, at: r.started_at ?? "", mode: modeOf(r.mode), outcome: bad.length ? "failed" : "succeeded",
    reason: bad.length ? bad.map(([k, c]) => `${k}: ${c.detail ?? "not ok"}`).join("; ") : null, source }];
}

export function vicSuccessRate(list: VicRun[]): VicSuccessRate {
  const ok = list.filter((r) => r.outcome === "succeeded");
  const part = (m: "live" | "stand-in") => ({ runs: list.filter((r) => r.mode === m).length, succeeded: ok.filter((r) => r.mode === m).length });
  return {
    runs: list.length, succeeded: ok.length, failed: list.length - ok.length,
    rate_pct: list.length ? Math.round((ok.length / list.length) * 1000) / 10 : null,
    live: part("live"), stand_in: part("stand-in"),
    reasons: list.filter((r) => r.outcome !== "succeeded").map((r) => ({ run: r.run, attempt: r.attempt, outcome: r.outcome as Exclude<VicOutcome, "succeeded">, reason: r.reason ?? "no reason recorded" })),
    list,
  };
}

/** Reads the committed VIC records under the repository root. */
export function readVicRuns(root: string): VicRun[] {
  const read = <T>(p: string): T | null => (existsSync(join(root, p)) ? JSON.parse(readFileSync(join(root, p), "utf8")) as T : null);
  const out: VicRun[] = [];
  const v1 = read<AttemptsRecord>("docs/demo/airi-run.json");
  if (v1) out.push(...fromAttempts(v1, "docs/demo/airi-run.json"));
  for (const f of ["docs/demo/vic-2-run.json", "docs/demo/vic-3-run.json"]) {
    const r = read<AttemptsRecord & ChecksRecord>(f);
    if (r) out.push(...(r.attempts?.length ? fromAttempts(r, f) : fromChecks(r, f)));
  }
  return out.sort((a, b) => a.at.localeCompare(b.at));
}
