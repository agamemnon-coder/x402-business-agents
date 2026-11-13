-- Security settings (13 Nov): the table cloud/migrations/0001_init.sql also creates, for a database made before it.

-- Security settings an owner chooses (cloud/src/stepUp.ts). step_up 1: sensitive settings ask for the passkey again
-- after five minutes ("Ask again before sensitive changes"); 0 or no row (the default): signing in with the passkey is
-- enough. Changed only by a signed-in owner after a fresh passkey check; every change is a security event.
CREATE TABLE IF NOT EXISTS security_settings (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  step_up INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id)
);
