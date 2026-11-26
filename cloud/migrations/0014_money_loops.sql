-- Cash & FX and Receivables (v1.5.1): the table cloud/migrations/0001_init.sql also creates, for a database made before it.
-- Additive only: one new table. One row per company, id 'latest' (cloud/src/moneyLoop.ts): no customer or payer name.
CREATE TABLE IF NOT EXISTS money_loops (tenant_id TEXT NOT NULL, id TEXT NOT NULL, at TEXT NOT NULL, body_json TEXT NOT NULL, body_sha256 TEXT NOT NULL, received_at TEXT NOT NULL, PRIMARY KEY (tenant_id, id));
