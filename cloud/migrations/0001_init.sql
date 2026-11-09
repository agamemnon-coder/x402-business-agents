-- Purser Cloud: one database for every tenant; every row carries tenant_id and every query is scoped by it
-- (cloud/src/tenant.ts). Bookkeeping records are append-only or versioned; nothing is overwritten silently.

CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  -- The language of the company's pages, for everyone ('nl', the default, or 'en'); a person may choose their own.
  language TEXT NOT NULL DEFAULT 'nl' CHECK (language IN ('nl', 'en')),
  created_at TEXT NOT NULL,
  closed_at TEXT,
  -- After this day a closed tenant's records may be purged (the end of the seventh year after its last records).
  purge_after TEXT
);

CREATE TABLE IF NOT EXISTS users (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  email TEXT,
  role TEXT NOT NULL CHECK (role IN ('owner', 'cfo', 'accountant', 'viewer')),
  -- The person's own language for the pages; NULL follows the company's.
  language TEXT CHECK (language IN ('nl', 'en')),
  created_at TEXT NOT NULL,
  erased_at TEXT,
  -- Bumped on sign-out, erasure, a role change or a closed account: every session issued before stops working.
  session_gen INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS credentials (
  tenant_id TEXT NOT NULL,
  credential_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  x TEXT NOT NULL,
  y TEXT NOT NULL,
  counter INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, credential_id)
);

CREATE TABLE IF NOT EXISTS challenges (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  challenge TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);

CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL,
  scopes TEXT NOT NULL,
  secret_sha256 TEXT NOT NULL,
  created_by TEXT NOT NULL,
  -- The person behind the key (a key made by a key inherits it): erasing that person revokes it.
  created_by_user TEXT,
  -- The key that made this one, if a key did: revoking it revokes this one too, and this one never has more scope or
  -- a later expiry than it (red team round 4).
  parent_key TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT,
  revoked_at TEXT,
  last_used_at TEXT
);

-- A passkey enrolment an owner starts for one person: single use, short-lived, only the hash of its secret is kept.
CREATE TABLE IF NOT EXISTS enrolments (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  token_sha256 TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS rate_hits (
  bucket TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (bucket, window_start)
);

CREATE TABLE IF NOT EXISTS vendors (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL,
  body_json TEXT NOT NULL,
  body_sha256 TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS invoices (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  vendor TEXT NOT NULL,
  invoice_no TEXT NOT NULL,
  due_date TEXT NOT NULL,
  currency TEXT NOT NULL,
  total TEXT NOT NULL,
  status TEXT NOT NULL,
  doc_sha256 TEXT NOT NULL,
  received_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL,
  body_json TEXT NOT NULL,
  body_sha256 TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS invoices_by_status ON invoices (tenant_id, status, received_at);

CREATE TABLE IF NOT EXISTS payments (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  invoice_id TEXT,
  status TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL,
  body_json TEXT NOT NULL,
  body_sha256 TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

-- The transactions register (src/money/register.ts): every money movement the runner knows, on every rail, versioned
-- like a payment. sort_key is the moment and the id, so a list can page newest first.
CREATE TABLE IF NOT EXISTS transactions (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  sort_key TEXT NOT NULL,
  at TEXT NOT NULL,
  rail TEXT NOT NULL,
  direction TEXT NOT NULL,
  currency TEXT NOT NULL,
  moved INTEGER NOT NULL,
  reconciliation TEXT NOT NULL,
  version INTEGER NOT NULL,
  body_json TEXT NOT NULL,
  body_sha256 TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS transactions_by_time ON transactions (tenant_id, sort_key);

-- Every earlier version of a vendor, invoice, payment or transaction, kept when a newer one replaces it.
CREATE TABLE IF NOT EXISTS object_history (
  tenant_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  id TEXT NOT NULL,
  version INTEGER NOT NULL,
  body_json TEXT NOT NULL,
  body_sha256 TEXT NOT NULL,
  replaced_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, kind, id, version)
);

CREATE TABLE IF NOT EXISTS documents (
  tenant_id TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  filename TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  blob_key TEXT NOT NULL,
  received_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, sha256)
);

CREATE TABLE IF NOT EXISTS ledger_entries (
  tenant_id TEXT NOT NULL,
  entry_id INTEGER NOT NULL,
  posting_date TEXT NOT NULL,
  doc_date TEXT NOT NULL,
  description TEXT NOT NULL,
  entry_json TEXT NOT NULL,
  prev_hash TEXT NOT NULL,
  entry_hash TEXT NOT NULL,
  PRIMARY KEY (tenant_id, entry_id)
);

CREATE TABLE IF NOT EXISTS ledger_lines (
  tenant_id TEXT NOT NULL,
  entry_id INTEGER NOT NULL,
  line_no INTEGER NOT NULL,
  posting_date TEXT NOT NULL,
  account TEXT NOT NULL,
  currency TEXT NOT NULL,
  debit_cents INTEGER NOT NULL,
  credit_cents INTEGER NOT NULL,
  vat_code TEXT,
  vat_cents INTEGER,
  party TEXT,
  doc_ref TEXT,
  due_date TEXT,
  PRIMARY KEY (tenant_id, entry_id, line_no)
);

CREATE TABLE IF NOT EXISTS audit_rows (
  tenant_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  ts TEXT NOT NULL,
  actor TEXT NOT NULL,
  event TEXT NOT NULL,
  subject TEXT,
  payload_json TEXT NOT NULL,
  prev_hash TEXT NOT NULL,
  row_hash TEXT NOT NULL,
  PRIMARY KEY (tenant_id, seq)
);

CREATE TABLE IF NOT EXISTS inbound_mail (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  blob_key TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  size INTEGER NOT NULL,
  received_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'done', 'refused')),
  note TEXT,
  PRIMARY KEY (tenant_id, id)
);

-- What the cloud did with a person's data on request, and when (the request itself is kept, its content is not).
CREATE TABLE IF NOT EXISTS erasures (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  subject TEXT NOT NULL,
  done_at TEXT NOT NULL,
  done_by TEXT NOT NULL,
  detail TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

-- One row per push the cloud accepted, written in the push's own transaction. by_key is filled at commit time from the
-- key that sent it, and only while that key is live: a push racing its key's revoke fails as a whole (cloud/src/tenant.ts).
CREATE TABLE IF NOT EXISTS push_log (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  by_key TEXT NOT NULL,
  at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

-- The runner's own health as it last reported it (POST /v1/health/report): alert codes and severities only, never the
-- words (they can name suppliers or proposals). One row per company, id 'latest'.
CREATE TABLE IF NOT EXISTS runner_health (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ok', 'alert')),
  alerts_json TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

-- The company's alert webhook, set by an owner: alert events are POSTed to it, signed with HMAC-SHA256 under its
-- secret (kept here to sign with; never exported or shown again). Turned off after 20 failed deliveries in a row.
CREATE TABLE IF NOT EXISTS webhooks (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  url TEXT NOT NULL,
  secret TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TEXT,
  last_status INTEGER,
  disabled_at TEXT,
  PRIMARY KEY (tenant_id, id)
);
