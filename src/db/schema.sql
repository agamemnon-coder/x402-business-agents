-- Ledger for the Kit 11 build (build plan 2.2). Money is integer cents; amounts on chain are decimal strings.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS config_snapshots (
  id INTEGER PRIMARY KEY,
  taken_at TEXT NOT NULL,
  json TEXT NOT NULL,
  sha256 TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS metal_accounts (
  address TEXT PRIMARY KEY,
  role TEXT NOT NULL CHECK (role IN ('business', 'customer', 'supplier', 'sweep', 'owner', 'customer_owner')),
  created_tx TEXT
);

CREATE TABLE IF NOT EXISTS mandates (
  mandate_ref TEXT PRIMARY KEY,
  agent TEXT NOT NULL,
  credential_path TEXT NOT NULL,
  credential_hash TEXT NOT NULL UNIQUE,
  principal TEXT NOT NULL,
  cap_cents INTEGER NOT NULL CHECK (cap_cents > 0),
  budget_cents INTEGER NOT NULL CHECK (budget_cents >= cap_cents),
  payees_json TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  description TEXT,
  bound_tx TEXT,
  status TEXT NOT NULL CHECK (status IN ('ISSUED', 'BOUND', 'REPLACED', 'REVOKED', 'EXPIRED')),
  replaced_by TEXT REFERENCES mandates(mandate_ref),
  proposal_id TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS one_bound_mandate_per_agent ON mandates(agent) WHERE status = 'BOUND';

CREATE TABLE IF NOT EXISTS upstream_purchases (
  id INTEGER PRIMARY KEY,
  price_cents INTEGER NOT NULL,
  nonce TEXT,
  tx_hash TEXT,
  outcome TEXT NOT NULL CHECK (outcome IN ('PAID', 'REFUSED', 'IN_DOUBT')),
  refusal_reason TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sales (
  sale_id INTEGER PRIMARY KEY,
  route TEXT NOT NULL,
  price_cents INTEGER NOT NULL,
  payer TEXT NOT NULL,
  customer_mandate_ref TEXT,
  signed_offer TEXT,
  settlement_id TEXT UNIQUE,
  tx_hash TEXT,
  request_url TEXT NOT NULL,
  request_params_json TEXT NOT NULL,
  body_sha256 TEXT,
  body_json TEXT,
  upstream_purchase_id INTEGER REFERENCES upstream_purchases(id),
  -- The exact x402 offer the payment answered, so a dispute can re-check the payment against it.
  requirements_json TEXT,
  status TEXT NOT NULL CHECK (status IN ('DELIVERED', 'ABORTED_NO_CHARGE', 'SETTLE_FAILED')),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS disputes (
  dispute_id TEXT PRIMARY KEY,
  customer TEXT NOT NULL,
  email_sha256 TEXT NOT NULL,
  claims_json TEXT,
  evidence_json TEXT,
  verdicts_json TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS proposals (
  proposal_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  terms_json TEXT NOT NULL,
  terms_sha256 TEXT NOT NULL UNIQUE,
  created_by TEXT NOT NULL,
  evidence_json TEXT,
  explanation TEXT,
  status TEXT NOT NULL CHECK (status IN ('PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'EXPIRED', 'SUPERSEDED',
                                         'EXECUTING', 'EXECUTED', 'FAILED', 'NEEDS_REAPPROVAL')),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS approvals (
  approval_id INTEGER PRIMARY KEY,
  proposal_id TEXT NOT NULL UNIQUE REFERENCES proposals(proposal_id),
  decision TEXT NOT NULL CHECK (decision IN ('APPROVED', 'REJECTED')),
  approved_sha256 TEXT NOT NULL,
  approver TEXT NOT NULL,
  method TEXT NOT NULL CHECK (method IN ('web', 'cli', 'telegram')),
  typed_prefix TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS refunds (
  refund_id INTEGER PRIMARY KEY,
  sale_id INTEGER NOT NULL UNIQUE REFERENCES sales(sale_id),
  payment_id TEXT NOT NULL UNIQUE,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  to_address TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('PROPOSED', 'PENDING', 'PAID', 'HELD', 'REFUSED')),
  refusal_reason TEXT,
  tx_hash TEXT,
  proposal_id TEXT REFERENCES proposals(proposal_id),
  dispute_id TEXT REFERENCES disputes(dispute_id)
);

CREATE TABLE IF NOT EXISTS executions (
  id INTEGER PRIMARY KEY,
  proposal_id TEXT NOT NULL REFERENCES proposals(proposal_id),
  step_no INTEGER NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  external_ref TEXT,
  status TEXT NOT NULL CHECK (status IN ('STARTED', 'DONE', 'FAILED')),
  request_redacted TEXT,
  response_json TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS locks (
  lock_key TEXT PRIMARY KEY,
  holder TEXT NOT NULL,
  acquired_at TEXT NOT NULL,
  released_at TEXT
);

CREATE TABLE IF NOT EXISTS chain_credits (
  event_key TEXT PRIMARY KEY,
  tx_hash TEXT NOT NULL,
  from_address TEXT NOT NULL,
  to_address TEXT NOT NULL,
  amount_base_units TEXT NOT NULL,
  block INTEGER NOT NULL,
  finalized_block INTEGER NOT NULL,
  awx_deposit_id TEXT,
  awx_reference TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS fx_quotes (
  quote_id TEXT PRIMARY KEY,
  pair TEXT NOT NULL,
  buy_amount TEXT NOT NULL,
  sell_amount TEXT,
  client_rate TEXT NOT NULL,
  valid_from TEXT NOT NULL,
  valid_to TEXT NOT NULL,
  used_by_conversion TEXT UNIQUE
);

CREATE TABLE IF NOT EXISTS fx_conversions (
  conversion_id TEXT PRIMARY KEY,
  quote_id TEXT NOT NULL UNIQUE REFERENCES fx_quotes(quote_id),
  request_id TEXT NOT NULL UNIQUE,
  buy_amount TEXT NOT NULL,
  sell_amount TEXT,
  status TEXT NOT NULL,
  approval_sha256 TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS beneficiaries (
  beneficiary_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  iban_last4 TEXT NOT NULL,
  iban_sha256 TEXT NOT NULL,
  bic TEXT NOT NULL,
  currency TEXT NOT NULL,
  method TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS invoices (
  invoice_no TEXT PRIMARY KEY,
  vendor TEXT NOT NULL,
  amount TEXT NOT NULL,
  currency TEXT NOT NULL,
  due_date TEXT NOT NULL,
  iban_sha256 TEXT NOT NULL,
  bic TEXT NOT NULL,
  beneficiary_id TEXT REFERENCES beneficiaries(beneficiary_id),
  doc_sha256 TEXT NOT NULL,
  extracted_json TEXT,
  status TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS obligations (
  id INTEGER PRIMARY KEY,
  currency TEXT NOT NULL,
  amount TEXT NOT NULL,
  due_date TEXT NOT NULL,
  label TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS transfers (
  transfer_id TEXT,
  request_id TEXT PRIMARY KEY,
  invoice_no TEXT NOT NULL REFERENCES invoices(invoice_no),
  amount TEXT NOT NULL,
  currency TEXT NOT NULL,
  method TEXT NOT NULL,
  fee_estimate TEXT NOT NULL,
  status TEXT NOT NULL,
  failure_type TEXT,
  failure_reason TEXT,
  replaces_request_id TEXT REFERENCES transfers(request_id),
  approval_sha256 TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
-- Only one live payout per invoice can exist at any moment.
CREATE UNIQUE INDEX IF NOT EXISTS one_live_transfer_per_invoice ON transfers(invoice_no) WHERE status NOT IN ('CANCELLED');

CREATE TABLE IF NOT EXISTS balance_snapshots (
  id INTEGER PRIMARY KEY,
  taken_at TEXT NOT NULL,
  label TEXT NOT NULL,
  json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  seq INTEGER PRIMARY KEY,
  ts TEXT NOT NULL,
  actor TEXT NOT NULL,
  event TEXT NOT NULL,
  subject TEXT,
  payload_json TEXT NOT NULL,
  prev_hash TEXT NOT NULL,
  row_hash TEXT NOT NULL UNIQUE
);
CREATE TRIGGER IF NOT EXISTS audit_log_no_update BEFORE UPDATE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
CREATE TRIGGER IF NOT EXISTS audit_log_no_delete BEFORE DELETE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;

-- Runtime settings the demo changes on purpose (prices), each change audited.
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Earnings swept from the business account to the sweep wallet (treasury mandate pulls).
CREATE TABLE IF NOT EXISTS sweeps (
  payment_id TEXT PRIMARY KEY,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  tx_hash TEXT,
  outcome TEXT NOT NULL CHECK (outcome IN ('PLANNED', 'PAID', 'REFUSED', 'PENDING', 'HELD')),
  event_key TEXT REFERENCES chain_credits(event_key),
  created_at TEXT NOT NULL
);
