-- Connectors (20 Nov): the tables cloud/migrations/0001_init.sql also creates, for a database made before them.
-- CREATE ... IF NOT EXISTS: running it on a database that has them changes nothing. Additive only.
-- Slack and Teams live notifications (cloud/src/chatHooks.ts): one incoming-webhook URL per company and product, pasted
-- by an owner. The URL is a credential: used only to send to, never returned by the API (its host only), never exported.
-- Switched off after 20 failed events in a row, like the signed webhook.
CREATE TABLE IF NOT EXISTS chat_hooks (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL CHECK (id IN ('slack', 'teams')),
  url TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TEXT,
  last_status INTEGER,
  disabled_at TEXT,
  PRIMARY KEY (tenant_id, id)
);

-- Accounting systems a company connects by OAuth itself (cloud/src/connect.ts): Xero, QuickBooks Online and Exact Online.
-- The same shape as oauth_connections, whose provider check names only airwallex and moneybird. account_ref: Xero's
-- organisation (tenant) id, QuickBooks' company (realm) id; NULL for Exact (its division is the runner's setting).
CREATE TABLE IF NOT EXISTS books_connections (
  tenant_id TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('xero', 'quickbooks', 'exact')),
  status TEXT NOT NULL CHECK (status IN ('connected', 'disconnected')),
  account_ref TEXT,
  scope TEXT NOT NULL DEFAULT '',
  access_sealed TEXT,
  access_expires_at INTEGER,
  refresh_sealed TEXT,
  refresh_expires_at INTEGER,
  refreshing_until INTEGER NOT NULL DEFAULT 0,
  connected_by TEXT NOT NULL,
  connected_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  ended_reason TEXT,
  PRIMARY KEY (tenant_id, provider)
);

-- Supplier invoices sent to a connected accounting system as draft bills (cloud/src/books/xero.ts): one row per invoice
-- and system, so a second push never makes a second bill. remote_id: the system's own id for the bill.
CREATE TABLE IF NOT EXISTS books_pushes (
  tenant_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  invoice_id TEXT NOT NULL,
  remote_id TEXT NOT NULL,
  pushed_at TEXT NOT NULL,
  pushed_by TEXT NOT NULL,
  PRIMARY KEY (tenant_id, provider, invoice_id)
);

-- Sign in with Google, Microsoft or Apple (cloud/src/oidc.ts): a person links their own identity to their own membership
-- while signed in with their passkey, and may unlink it. The provider's issuer and subject (its stable id for the
-- person), never a token. A link signs in to read only; settings and approving still take the passkey.
CREATE TABLE IF NOT EXISTS identity_links (
  tenant_id TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('google', 'microsoft', 'apple')),
  issuer TEXT NOT NULL,
  subject TEXT NOT NULL,
  user_id TEXT NOT NULL,
  email TEXT,
  linked_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, provider, issuer, subject)
);
CREATE UNIQUE INDEX IF NOT EXISTS identity_links_one_per_person ON identity_links (tenant_id, user_id, provider);

-- One OpenID Connect start (ten minutes, good once): its state's hash, what it is for (link or sign-in), the company, the
-- person (for a link), the nonce, the PKCE verifier, and the hash of the browser's own secret (so a code is finished
-- only in the browser that started it).
CREATE TABLE IF NOT EXISTS oidc_states (
  state_sha256 TEXT PRIMARY KEY,
  purpose TEXT NOT NULL CHECK (purpose IN ('link', 'sign-in')),
  tenant_id TEXT NOT NULL,
  user_id TEXT,
  provider TEXT NOT NULL,
  nonce TEXT NOT NULL,
  verifier TEXT,
  browser_sha256 TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
