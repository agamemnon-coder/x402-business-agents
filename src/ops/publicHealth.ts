// The health shapes, and what the relay may show anyone on /health (backend review B7). No imports: the relay Worker
// bundles this file.

export type Severity = "critical" | "warning";
export interface Alert { code: string; severity: Severity; since: string | null; words: string }
export interface Health { status: "ok" | "alert"; at: string; alerts: Alert[]; metrics: Record<string, number> }

/** The relay calls the runner down after this long without a sync. */
export const RUNNER_DOWN_AFTER_MS = 120_000;

/**
 * The alarm, for monitoring and the CFO (/health/live, and /health while a live run is expected): whether all is well,
 * the alarm codes, and whether the runner is syncing. No amounts, names or ids. The status is 503 while anything is
 * wrong, a runner that stopped syncing included, for an uptime monitor.
 */
export function publicHealth(h: Health | null, runnerAgeMs: number | null): { status: number; body: { status: "ok" | "alert"; runner: "up" | "down" | "unknown"; alerts: string[]; checked_at: string | null } } {
  const runner = runnerAgeMs === null ? "unknown" : runnerAgeMs > RUNNER_DOWN_AFTER_MS ? "down" : "up";
  const alerts = [...(runner === "down" ? ["runner_down"] : []), ...(h?.alerts.map((a) => a.code) ?? [])];
  const ok = runner === "up" && h !== null && alerts.length === 0;
  return { status: ok ? 200 : 503, body: { status: ok ? "ok" : "alert", runner, alerts, checked_at: h?.at ?? null } };
}

/**
 * A live run is expected while the runner synced within this long, or while one is declared (the Worker's LIVE_RUN
 * variable). Past it, with none declared, the runner is off because no live run is going on: the hosted pages replay
 * the recorded run.
 */
export const LIVE_RUN_EXPECTED_MS = 30 * 60_000;
/** What /health says between live runs, word for word. */
export const RECORDED_DEMO_WORDS = "Recorded demo · the live runner runs during live runs";

/**
 * What /health shows anyone. While a live run is expected it is the alarm itself (publicHealth: 503 on runner_down or
 * any alarm). Between live runs a runner that is off is no alarm: 200, the mode in words, and the alarm codes that
 * stood at the runner's last sync (nothing moves while it is off). /health/live keeps the alarm at all times.
 */
export function publicStatus(h: Health | null, runnerAgeMs: number | null, o: { liveRun?: boolean; lastSync?: string | null } = {}): { status: number; body: Record<string, unknown> } {
  const expected = o.liveRun === true || (runnerAgeMs !== null && runnerAgeMs <= LIVE_RUN_EXPECTED_MS);
  if (expected) return publicHealth(h, runnerAgeMs);
  return { status: 200, body: { status: "recorded_demo", words: RECORDED_DEMO_WORDS, runner: "off", alerts: h?.alerts.map((a) => a.code) ?? [], checked_at: h?.at ?? null, last_sync: o.lastSync ?? null } };
}
