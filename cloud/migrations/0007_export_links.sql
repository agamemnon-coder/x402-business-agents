-- Spent staged-export links (cloud/src/exports.ts; ASVS 4.0.3 V8.3.1, V13.1.3): each signed link is good once, so the
-- first download records its nonce here until the link would have expired anyway. Additive only: one new table. The
-- module also makes it on first use (IF NOT EXISTS); test/cloud-export-links.test.ts holds the two equal. A nonce, a
-- company id and two times, never a signature.
CREATE TABLE IF NOT EXISTS export_links_used (nonce TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, used_at TEXT NOT NULL, expires_at TEXT NOT NULL);
