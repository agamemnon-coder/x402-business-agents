-- A person's active sessions (cloud/src/sessions.ts; ASVS 4.0.3 V3.3.4): one row per passkey sign-in, to list and end.
-- Additive only: one new table and its index. The module also makes them on first use (IF NOT EXISTS);
-- test/cloud-sessions.test.ts holds the two equal. Never a token: the session's id, its times, the browser's user agent
-- cut short and the network it came from.
CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, user_id TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, user_agent TEXT NOT NULL, ip TEXT NOT NULL, ended_at TEXT);
CREATE INDEX IF NOT EXISTS sessions_by_user ON sessions (tenant_id, user_id, expires_at);
