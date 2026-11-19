-- The security event log (cloud/src/securityLog.ts; ASVS 4.0.3 V7.1.3, V7.2.1, V7.2.2, V8.1.4). Additive only: one new
-- table, its index and two triggers that keep it append-only (no UPDATE; no DELETE of a row less than a year old). The
-- module also makes them on first use (IF NOT EXISTS), so a deployment that has not run this migration yet works the
-- same; test/cloud-security-log.test.ts holds the two equal. Ids and networks only, never a secret.
CREATE TABLE IF NOT EXISTS security_log (seq INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, kind TEXT NOT NULL, tenant_id TEXT, actor TEXT, ip TEXT NOT NULL, route TEXT, status INTEGER, detail_json TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS security_log_by_kind ON security_log (kind, at);
CREATE TRIGGER IF NOT EXISTS security_log_no_update BEFORE UPDATE ON security_log BEGIN SELECT RAISE(ABORT, 'security_log is append-only'); END;
CREATE TRIGGER IF NOT EXISTS security_log_keep BEFORE DELETE ON security_log WHEN OLD.at > strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-365 days') BEGIN SELECT RAISE(ABORT, 'security_log rows are kept a year'); END;
