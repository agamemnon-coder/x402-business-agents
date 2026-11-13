-- Approval alerts (13 Nov): the tables cloud/migrations/0001_init.sql also creates, for a database made before them.
-- CREATE ... IF NOT EXISTS: running it on a database that has them changes nothing.

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
