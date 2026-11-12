-- Purser Cloud on Cloudflare's own platform (cloud/src/edge/): the nightly autopilot's companies and digests, and the
-- cloud's daily counters. No secret, no bank account, no person's name in any of these tables.

-- The companies whose engine was used (a write to /v1/engine): the nightly autopilot runs for these only.
CREATE TABLE IF NOT EXISTS engine_companies (
  tenant_id TEXT PRIMARY KEY,
  first_at TEXT NOT NULL
);

-- One nightly run per company per day (UTC): claimed before it runs, so a Cron Trigger that fires twice runs it once.
-- digest_json: what the run found (invoices by status, the overdue ones, approvals waiting, both chains verified).
CREATE TABLE IF NOT EXISTS autopilot_runs (
  tenant_id TEXT NOT NULL,
  day TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'done', 'failed')),
  started_at TEXT NOT NULL,
  finished_at TEXT,
  digest_json TEXT,
  error TEXT,
  PRIMARY KEY (tenant_id, day)
);

-- The cloud's own counters per day (UTC), across every company: requests, refusals, approvals. No company's id.
CREATE TABLE IF NOT EXISTS daily_counts (
  day TEXT NOT NULL,
  metric TEXT NOT NULL,
  n INTEGER NOT NULL,
  PRIMARY KEY (day, metric)
);
