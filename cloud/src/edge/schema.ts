// The tables of cloud/src/edge/ (cloud/migrations/0002_edge.sql, word for word: test/cloud-edge.test.ts holds them to
// it). Applied once per database per isolate, like the cloud's own schema; a deploy also runs the D1 migration.
import type { Sql } from "../store.js";

export const EDGE_SCHEMA = "-- Purser Cloud on Cloudflare's own platform (cloud/src/edge/): the nightly autopilot's companies and digests, and the\n-- cloud's daily counters. No secret, no bank account, no person's name in any of these tables.\n\n-- The companies whose engine was used (a write to /v1/engine): the nightly autopilot runs for these only.\nCREATE TABLE IF NOT EXISTS engine_companies (\n  tenant_id TEXT PRIMARY KEY,\n  first_at TEXT NOT NULL\n);\n\n-- One nightly run per company per day (UTC): claimed before it runs, so a Cron Trigger that fires twice runs it once.\n-- digest_json: what the run found (invoices by status, the overdue ones, approvals waiting, both chains verified).\nCREATE TABLE IF NOT EXISTS autopilot_runs (\n  tenant_id TEXT NOT NULL,\n  day TEXT NOT NULL,\n  status TEXT NOT NULL CHECK (status IN ('running', 'done', 'failed')),\n  started_at TEXT NOT NULL,\n  finished_at TEXT,\n  digest_json TEXT,\n  error TEXT,\n  PRIMARY KEY (tenant_id, day)\n);\n\n-- The cloud's own counters per day (UTC), across every company: requests, refusals, approvals. No company's id.\nCREATE TABLE IF NOT EXISTS daily_counts (\n  day TEXT NOT NULL,\n  metric TEXT NOT NULL,\n  n INTEGER NOT NULL,\n  PRIMARY KEY (day, metric)\n);\n";

const ready = new WeakMap<Sql, Promise<void>>();
export function ensureEdgeSchema(sql: Sql): Promise<void> {
  let p = ready.get(sql);
  if (!p) {
    p = sql.exec(EDGE_SCHEMA).catch((e: unknown) => { ready.delete(sql); throw e; });
    ready.set(sql, p);
  }
  return p;
}
