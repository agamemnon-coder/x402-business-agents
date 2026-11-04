// The health shapes, and what the relay may show anyone on /health (backend review B7). No imports: the relay Worker
// bundles this file.

export type Severity = "critical" | "warning";
export interface Alert { code: string; severity: Severity; since: string | null; words: string }
export interface Health { status: "ok" | "alert"; at: string; alerts: Alert[]; metrics: Record<string, number> }

/** The relay calls the runner down after this long without a sync. */
export const RUNNER_DOWN_AFTER_MS = 120_000;

/**
 * What the relay may show anyone on /health: whether all is well, the alarm codes, and whether the runner is
 * syncing. No amounts, names or ids. The status is 503 while anything is wrong, for an uptime monitor.
 */
export function publicHealth(h: Health | null, runnerAgeMs: number | null): { status: number; body: { status: "ok" | "alert"; runner: "up" | "down" | "unknown"; alerts: string[]; checked_at: string | null } } {
  const runner = runnerAgeMs === null ? "unknown" : runnerAgeMs > RUNNER_DOWN_AFTER_MS ? "down" : "up";
  const alerts = [...(runner === "down" ? ["runner_down"] : []), ...(h?.alerts.map((a) => a.code) ?? [])];
  const ok = runner === "up" && h !== null && alerts.length === 0;
  return { status: ok ? 200 : 503, body: { status: ok ? "ok" : "alert", runner, alerts, checked_at: h?.at ?? null } };
}
