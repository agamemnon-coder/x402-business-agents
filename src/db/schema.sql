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
  created_at TEXT NOT NULL,
  -- How the buyer paid: 'exact' (a transfer per query under its mandate) or 'bajillion' (Metal clearing, a receipt).
  scheme TEXT NOT NULL DEFAULT 'exact',
  -- For clearing: the service's receipt as the facilitator returned it.
  clearing_json TEXT
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
  method TEXT NOT NULL CHECK (method IN ('web', 'cli', 'telegram', 'passkey')),
  typed_prefix TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL
);

-- The approver's passkey (WebAuthn). The runner verifies every signature against this public key itself.
CREATE TABLE IF NOT EXISTS passkeys (
  credential_id TEXT PRIMARY KEY,
  public_key TEXT NOT NULL,
  counter INTEGER NOT NULL CHECK (counter >= 0),
  transports TEXT,
  rp_id TEXT NOT NULL,
  origin TEXT NOT NULL,
  label TEXT NOT NULL,
  aaguid TEXT,
  registration_json TEXT NOT NULL,
  enrolled_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'REVOKED'))
);
-- One active passkey per person (label); more than one person may approve (E1, four eyes).
CREATE UNIQUE INDEX IF NOT EXISTS one_active_passkey_per_person ON passkeys(label) WHERE status = 'ACTIVE';

-- A short window in which one passkey may be enrolled with a one-time code. Only the code's hash is kept.
CREATE TABLE IF NOT EXISTS passkey_enrolments (
  window_id TEXT PRIMARY KEY,
  challenge TEXT NOT NULL,
  user_id TEXT NOT NULL,
  code_sha256 TEXT NOT NULL,
  rp_id TEXT NOT NULL,
  origin TEXT NOT NULL,
  opened_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('OPEN', 'USED', 'EXPIRED', 'CLOSED')),
  -- E1: a window opened to add another person, by name, beside the passkeys already enrolled (none: the runner's own).
  label TEXT,
  adds INTEGER NOT NULL DEFAULT 0
);

-- Every verified passkey signature over a proposal's terms, kept so `npm run verify` can check it again offline.
CREATE TABLE IF NOT EXISTS passkey_assertions (
  assertion_sha256 TEXT PRIMARY KEY,
  proposal_id TEXT NOT NULL REFERENCES proposals(proposal_id),
  credential_id TEXT NOT NULL REFERENCES passkeys(credential_id),
  terms_sha256 TEXT NOT NULL,
  assertion_json TEXT NOT NULL,
  counter INTEGER NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('APPROVED', 'TOO_LATE', 'REJECTED')),
  verified_at TEXT NOT NULL
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
  method TEXT NOT NULL,
  -- ACTIVE: invoices may be paid here. REPLACED: the supplier's old account, kept for the history (E3).
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'REPLACED'))
);

-- A supplier's new bank details (E3): requested, verified by a person out of band, proposed, then applied once the
-- CFO approves. Until then invoices to the new account stay blocked.
CREATE TABLE IF NOT EXISTS payee_changes (
  change_id TEXT PRIMARY KEY,
  vendor TEXT NOT NULL,
  old_beneficiary_id TEXT NOT NULL REFERENCES beneficiaries(beneficiary_id),
  new_iban TEXT NOT NULL,
  new_bic TEXT NOT NULL,
  source TEXT,
  requested_by TEXT NOT NULL,
  verification_json TEXT,
  proposal_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('REQUESTED', 'VERIFIED', 'PROPOSED', 'APPLIED')),
  created_at TEXT NOT NULL
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
  fee_actual TEXT,
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

-- A verified new passkey waiting for confirmation on the runner (security review M3): it counts only once the
-- person on the runner confirms the fingerprint the phone shows. A relay that slips in its own passkey shows another.
CREATE TABLE IF NOT EXISTS passkey_pending (
  credential_id TEXT PRIMARY KEY,
  window_id TEXT NOT NULL REFERENCES passkey_enrolments(window_id),
  public_key TEXT NOT NULL,
  counter INTEGER NOT NULL,
  transports TEXT,
  aaguid TEXT,
  registration_json TEXT NOT NULL,
  label TEXT NOT NULL,
  spki_sha256 TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Each agent's company card at Airwallex Issuing (K2). The card number stays at Airwallex; only the last four are
-- kept. The limits are the ones Airwallex last confirmed; the CFO policy says what they should be.
CREATE TABLE IF NOT EXISTS cards (
  agent TEXT PRIMARY KEY,
  cardholder_id TEXT NOT NULL,
  card_id TEXT NOT NULL UNIQUE,
  last4 TEXT NOT NULL,
  nickname TEXT NOT NULL,
  currency TEXT NOT NULL,
  per_tx_cents INTEGER NOT NULL CHECK (per_tx_cents > 0),
  monthly_cents INTEGER NOT NULL CHECK (monthly_cents > 0),
  status TEXT NOT NULL,
  synced_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  -- What the card may pay at all, as Airwallex has it: merchant category codes and currencies (comma-separated, empty
  -- for any) and its end date.
  allowed_mccs TEXT NOT NULL DEFAULT '',
  allowed_currencies TEXT NOT NULL DEFAULT '',
  active_to TEXT
);

-- Every authorisation on an agent's card, approved or declined by Airwallex. One row per Airwallex transaction,
-- whichever way it arrived first (our own simulated charge, the poll, or the webhook).
CREATE TABLE IF NOT EXISTS card_transactions (
  transaction_id TEXT PRIMARY KEY,
  card_id TEXT NOT NULL REFERENCES cards(card_id),
  agent TEXT NOT NULL,
  merchant TEXT NOT NULL,
  mcc TEXT,
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  currency TEXT NOT NULL,
  status TEXT NOT NULL,
  approved INTEGER NOT NULL CHECK (approved IN (0, 1)),
  failure_reason TEXT,
  purpose TEXT,
  source TEXT NOT NULL CHECK (source IN ('simulation', 'poll', 'webhook')),
  occurred_at TEXT NOT NULL,
  recorded_at TEXT NOT NULL
);

-- Money moved into or out of Metal clearing, and balances read from the clearing service (prepaid budget).
CREATE TABLE IF NOT EXISTS clearing_ops (
  id INTEGER PRIMARY KEY,
  party TEXT NOT NULL CHECK (party IN ('customer', 'seller')),
  kind TEXT NOT NULL CHECK (kind IN ('deposit', 'withdraw', 'balance')),
  units TEXT NOT NULL,
  tx TEXT,
  detail TEXT,
  created_at TEXT NOT NULL
);

-- An outside AI agent that connected through the agent API (P1, src/platform/externalAgents.ts). It gets a company
-- card only after the CFO approves its request with Face ID; from then on the CFO policy holds its card's limits.
CREATE TABLE IF NOT EXISTS external_agents (
  agent_id TEXT PRIMARY KEY CHECK (agent_id LIKE 'ext:%'),
  display_name TEXT NOT NULL,
  purpose TEXT NOT NULL,
  per_tx_cents INTEGER NOT NULL CHECK (per_tx_cents > 0),
  monthly_cents INTEGER NOT NULL CHECK (monthly_cents >= per_tx_cents),
  status TEXT NOT NULL CHECK (status IN ('REQUESTED', 'ACTIVE')),
  proposal_id TEXT,
  created_at TEXT NOT NULL
);

-- E1, four eyes: each person's verified passkey approval of a proposal that needs two people. The proposal is approved
-- (one row in approvals) only once two different people have signed its exact terms.
CREATE TABLE IF NOT EXISTS cosignatures (
  proposal_id TEXT NOT NULL REFERENCES proposals(proposal_id),
  credential_id TEXT NOT NULL,
  person TEXT NOT NULL,
  approver TEXT NOT NULL,
  terms_sha256 TEXT NOT NULL,
  assertion_sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (proposal_id, credential_id),
  UNIQUE (proposal_id, person)
);

-- Velocity limits (security item 2): each payment an agent makes, as counted against its limits per minute and hour.
-- Metal payments are counted before they are signed; card charges as Airwallex reports them (declines included).
CREATE TABLE IF NOT EXISTS velocity_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent TEXT NOT NULL,
  rail TEXT NOT NULL CHECK (rail IN ('metal', 'card')),
  cents INTEGER NOT NULL CHECK (cents >= 0),
  approved INTEGER NOT NULL CHECK (approved IN (0, 1)),
  at TEXT NOT NULL,
  -- A Metal payment's own id (a sweep or refund retried under it is counted once); null for card charges.
  payment_id TEXT UNIQUE
);
CREATE INDEX IF NOT EXISTS velocity_by_agent ON velocity_events (agent, at);

-- Ask Purser (G): a single-use card for one task (a flight, a hotel, a train), approved by the CFO with Face ID. The
-- card itself is in cards under task_id; its limits and controls come from here.
CREATE TABLE IF NOT EXISTS task_cards (
  task_id TEXT PRIMARY KEY CHECK (task_id LIKE 'task:%'),
  proposal_id TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,
  purpose TEXT NOT NULL,
  mccs TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  valid_until TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'USED')),
  created_at TEXT NOT NULL
);
