-- Owner recovery takes two platform admins (cloud/src/recovery.ts; review finding 2, 20 Nov 2026): one named admin key
-- asks, a second, different one approves, and only then is the recovery key issued. Additive only: one new table. The
-- module also makes it on first use (IF NOT EXISTS); test/cloud-recovery-two-admins.test.ts holds the two equal. Admin
-- key ids, an owner id and times; never a key or a secret.
CREATE TABLE IF NOT EXISTS recovery_requests (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, owner_id TEXT NOT NULL, check_method TEXT NOT NULL, requested_by TEXT NOT NULL, requested_at TEXT NOT NULL, expires_at TEXT NOT NULL, approved_by TEXT, approved_at TEXT, recovery_key TEXT);
