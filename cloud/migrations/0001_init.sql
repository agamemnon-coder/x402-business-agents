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
  -- 'first-owner': a new company's starter key, good only for the first owner's passkey and revoked when that passkey
  -- exists (red team round 5). 'recovery': issued by the platform for one owner who lost their passkey, a day long,
  -- good only for that owner's passkey enrolment and spent when it is redeemed. NULL: an ordinary key.
  purpose TEXT,
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
  -- Who started it (red team round 5): 'session' or 'key', the person behind it, and whether a signed-in owner did.
  -- At redeem the starter must still be live, and an owner's passkey started by anyone but a signed-in owner still
  -- needs no owner to have one. A newer enrolment for the person, or the starter's revoke or erasure, cancels it.
  created_by_kind TEXT NOT NULL DEFAULT 'key',
  created_by_user TEXT,
  by_owner INTEGER NOT NULL DEFAULT 0,
  -- 1: started with a recovery key the platform issued for this owner (lost passkey). Redeemed, it removes the owner's
  -- other passkeys, ends their sessions and spends the recovery key, all in the write that adds the new passkey.
  recovery INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  cancelled_at TEXT,
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS enrolments_by_id ON enrolments (id);

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

-- What happened to a company's access that its owners must be able to see afterwards (an owner recovery, a staged
-- export and its download): who, when, what; never a secret. Append-only.
CREATE TABLE IF NOT EXISTS security_events (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  at TEXT NOT NULL,
  kind TEXT NOT NULL,
  actor TEXT NOT NULL,
  detail_json TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS security_events_by_time ON security_events (tenant_id, at);

-- A staged export (GET /v1/export in parts, built into R2 under exports/<tenant>/<id>/): one open at a time per company,
-- kept a day, then its parts are removed and its status says so. Its parts are fetched with short-lived signed links.
CREATE TABLE IF NOT EXISTS exports (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  status TEXT NOT NULL,            -- building | ready | failed | expired
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  parts_json TEXT NOT NULL,        -- [{table, n, rows, bytes, sha256}]
  bytes INTEGER NOT NULL,
  downloaded_at TEXT,
  PRIMARY KEY (tenant_id, id)
);

-- The company's Airwallex account opened through Purser as a platform (docs/airwallex-platform.md; off unless the cloud
-- is configured for it). One row per company, id 'main': the account's id and its onboarding status as Airwallex's
-- account.* webhooks report it (event_at: the newest event's x-timestamp). Never a key, never the onboarding link.
CREATE TABLE IF NOT EXISTS awx_accounts (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  -- Unique: one Airwallex account belongs to one company (NULL while the request to Airwallex is under way).
  account_id TEXT UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('opening', 'created', 'pending', 'action_required', 'active', 'refused', 'dormant', 'closed')),
  business_name TEXT NOT NULL,
  country_code TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  event_at INTEGER NOT NULL DEFAULT 0,
  -- The idempotency id sent with the account's create (every retry of the same opening sends the same one, so Airwallex
  -- opens one account), and the nonce of the attempt that may finish the row (red team 6: a slow first request and its
  -- replacement opened two accounts and crossed their ids).
  request_id TEXT,
  attempt TEXT,
  -- The company's agreement to Airwallex's terms before the account was opened: who, when, which version.
  consent_by TEXT,
  consent_at TEXT,
  consent_terms TEXT,
  PRIMARY KEY (tenant_id, id)
);

-- The hands-on deployment (purser-try, cloud/src/try/): a visitor's test company, the switches that run the demo, the
-- day's address salt and the admin's changes. None of these tables exists for the product's own companies' data: a
-- try company's own rows live in the tables above, under its tenant id, and are swept with it after 24 hours.
-- A visitor's company: its pool ('public', 'event', 'jury'), the start address keyed with the day's salt (never the
-- address itself; NULL for event and jury), the hash of the visitor's token (never the token), and when it was swept.
CREATE TABLE IF NOT EXISTS try_companies (
  tenant_id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  pool TEXT NOT NULL CHECK (pool IN ('public', 'event', 'jury')),
  addr TEXT,
  visitor_sha256 TEXT NOT NULL,
  wiped_at TEXT,
  -- Sweeps whose engine would not wipe: such a company is tried again after the others, so it never holds them up.
  sweep_tries INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS try_companies_by_expiry ON try_companies (wiped_at, expires_at);
CREATE INDEX IF NOT EXISTS try_companies_by_created ON try_companies (created_at);
-- The demo's switches and caps (cloud/src/try/switches.ts): a missing row is off, or 0.
CREATE TABLE IF NOT EXISTS try_switches (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
-- Every change the admin made to a switch: when, which key, the old and the new value; never the admin's token.
CREATE TABLE IF NOT EXISTS try_admin_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  key TEXT NOT NULL,
  old TEXT,
  new TEXT
);
-- One random salt per UTC day for keying a start address; deleted after 48 hours, so an old key cannot be redone.
CREATE TABLE IF NOT EXISTS try_salts (
  day TEXT PRIMARY KEY,
  salt TEXT NOT NULL
);

-- Claude in the engine under caps (cloud/src/engine/spend.ts; lane A of the hands-on demo). try_spend: what each scope
-- has spent or holds reserved, in micro-USD at list price; a scope is 'all', 'day:<pool>:<YYYY-MM-DD>', 'co:<tenant>' or
-- 'addr:<hash>:<YYYY-MM-DD>'. A reservation adds its whole ceiling at once, and its settlement gives back what was not
-- used. try_resv: one row per reservation; it counts as in flight while 'open', and one older than ten minutes is closed
-- at its full amount. No prompt, no answer and no address is kept here (an address only as its salted hash in a scope).
CREATE TABLE IF NOT EXISTS try_spend (
  scope TEXT PRIMARY KEY,
  micros INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS try_resv (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  micros INTEGER NOT NULL,
  started_at TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('open', 'settled', 'expired'))
);
CREATE INDEX IF NOT EXISTS try_resv_open ON try_resv (state, started_at);
-- Accounts a company connects to Purser itself by OAuth (docs/real-customers.md; off unless the cloud is configured for
-- it): its existing Airwallex account and its Moneybird administration. The tokens are sealed (AES-256-GCM; the key is
-- a Worker secret, and each value is bound to its company, provider and field: cloud/src/sealed.ts). No token is ever
-- logged or shown; only the company's own runner gets a short-lived access token (GET /v1/connect/{provider}/token).
CREATE TABLE IF NOT EXISTS oauth_connections (
  tenant_id TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('airwallex', 'moneybird')),
  status TEXT NOT NULL CHECK (status IN ('connected', 'disconnected')),
  -- Airwallex: the account the tokens act for (acct_…, from the token answer); one account belongs to one company.
  account_ref TEXT,
  scope TEXT NOT NULL DEFAULT '',
  access_sealed TEXT,
  access_expires_at INTEGER,
  refresh_sealed TEXT,
  refresh_expires_at INTEGER,
  -- A refresh is under way until this time (ms): one at a time, since Airwallex revokes a refresh token used twice.
  refreshing_until INTEGER NOT NULL DEFAULT 0,
  connected_by TEXT NOT NULL,
  connected_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  -- Why a connection ended: owner (disconnected in Purser), refused (the provider refused the refresh token),
  -- provider (the provider said it was disconnected).
  ended_reason TEXT,
  PRIMARY KEY (tenant_id, provider)
);
CREATE UNIQUE INDEX IF NOT EXISTS oauth_connections_account ON oauth_connections (provider, account_ref) WHERE account_ref IS NOT NULL AND status = 'connected';

-- One OAuth start, kept until its callback (ten minutes at most) and then removed: the state's hash, who started it for
-- which company, and the PKCE verifier (sealed). A state is good once, for that person and company only.
CREATE TABLE IF NOT EXISTS oauth_states (
  state_sha256 TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  user_id TEXT NOT NULL,
  verifier_sealed TEXT,
  expires_at INTEGER NOT NULL
);

-- Connect Claude (cloud/src/claude/oauth.ts): one authorization code, from the consent page to the token request (five
-- minutes, good once). Only the code's hash is kept, with the connector key it was issued for (its id, never its
-- secret), the client, the redirect address and the PKCE challenge (S256) the token request must answer.
CREATE TABLE IF NOT EXISTS oauth_codes (
  code_sha256 TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  key_id TEXT NOT NULL,
  client_id_sha256 TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);

-- Connect Claude: a consent form's token, once spent (cloud/src/claude/oauth.ts consentToken). Only its hash, until the
-- form would have expired anyway; a second answer with the same form is refused.
CREATE TABLE IF NOT EXISTS oauth_consents (
  token_sha256 TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);

-- Approval alerts (cloud/src/alerts.ts): who hears that a payment waits for the CFO's Face ID, and on which channel. The
-- target is a WhatsApp number, an e-mail address or a Slack/Teams webhook URL; it is used only to send to, never returned
-- by the API, never exported (a webhook URL is a credential) and shown masked everywhere. Set by a signed-in owner after
-- a fresh passkey check (step-up).
CREATE TABLE IF NOT EXISTS alert_targets (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('whatsapp', 'email', 'slack', 'teams')),
  target TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

-- One row per alert and target: its id is the hash of the event and the target, so the same event never reaches the
-- same target twice (a replayed push, two dispatches at once). The status, attempts and the provider's message id; the
-- target only masked.
CREATE TABLE IF NOT EXISTS alert_deliveries (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  event_key TEXT NOT NULL,
  invoice_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  target_id TEXT NOT NULL,
  target_mask TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('sending', 'sent', 'failed', 'capped', 'no_provider')),
  attempts INTEGER NOT NULL DEFAULT 0,
  http_status INTEGER,
  provider_ref TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS alert_deliveries_by_time ON alert_deliveries (tenant_id, updated_at);
