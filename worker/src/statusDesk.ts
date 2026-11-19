// The hourly synthetic checks' store (src/ops/syntheticChecks.ts): the "status" instance of the relay's Durable Object
// keeps one row per address per check in its own SQLite, and adds them up for /status and /status.json. Only the cron
// trigger runs the checks (worker/src/index.ts, scheduled → statusRun, an RPC method no HTTP request reaches); the two
// public paths only read. Rows are never written for a time no check ran at: no backfill.

import { runChecks, summarize, type CheckRow, type FetchLike, type StatusSummary } from "../../src/ops/syntheticChecks.js";
import type { Sql } from "./core.js";

/** A summary is served from memory for this long, or until the next check (it only changes then, or as windows slide). */
const SUMMARY_CACHE_MS = 60_000;

export class StatusDesk {
  private readonly now: () => number;
  private cached: { at: number; summary: StatusSummary } | null = null;

  constructor(private readonly sql: Sql, private readonly opts: { fetch: FetchLike; now?: () => number }) {
    this.now = opts.now ?? (() => Date.now());
    sql.exec(`CREATE TABLE IF NOT EXISTS status_checks (
      at_ms INTEGER NOT NULL, at TEXT NOT NULL, target TEXT NOT NULL, status INTEGER NOT NULL, ms INTEGER NOT NULL,
      ok INTEGER NOT NULL, error TEXT
    )`);
    sql.exec("CREATE INDEX IF NOT EXISTS status_checks_at ON status_checks (at_ms)");
  }

  /** One round of checks (the cron's): each address asked once, each answer stored as it came. */
  async run(): Promise<{ checks: number; passed: number }> {
    const rows = await runChecks(this.opts.fetch, this.now);
    for (const r of rows) this.sql.exec("INSERT INTO status_checks (at_ms, at, target, status, ms, ok, error) VALUES (?, ?, ?, ?, ?, ?, ?)", Date.parse(r.at), r.at, r.target, r.status, r.ms, r.ok ? 1 : 0, r.error);
    this.cached = null;
    return { checks: rows.length, passed: rows.filter((r) => r.ok).length };
  }

  /** Every stored row, oldest first. */
  rows(): CheckRow[] {
    return (this.sql.exec("SELECT at, target, status, ms, ok, error FROM status_checks ORDER BY at_ms, rowid").toArray() as { at: string; target: string; status: number; ms: number; ok: number; error: string | null }[])
      .map((r) => ({ at: r.at, target: r.target, status: r.status, ms: r.ms, ok: r.ok === 1, error: r.error }));
  }

  /** What /status and /status.json show, as of now. */
  summary(): StatusSummary {
    const now = this.now();
    if (this.cached && now - this.cached.at < SUMMARY_CACHE_MS) return this.cached.summary;
    const summary = summarize(this.rows(), now);
    this.cached = { at: now, summary };
    return summary;
  }
}
