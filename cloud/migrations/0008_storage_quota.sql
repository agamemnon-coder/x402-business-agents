-- The storage quota per company (cloud/src/storageQuota.ts; ASVS 4.0.3 V12.1.3): the bytes and files each company has
-- uploaded through the API. Additive only: one new table. The module also makes it on first use (IF NOT EXISTS);
-- test/cloud-asvs-controls.test.ts holds the two equal. Counts only, never a file or its name.
CREATE TABLE IF NOT EXISTS storage_use (tenant_id TEXT PRIMARY KEY, bytes INTEGER NOT NULL, files INTEGER NOT NULL, updated_at TEXT NOT NULL);
