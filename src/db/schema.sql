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

-- A customer's mandate payment on its way (night batch, 2 November): written before the facilitator settles it on
-- chain, closed when the sale is recorded (DONE) or the settle fails (FAILED). Between Metal's block and the sale's
-- row the chain already counts the payment; this row is what lets the dashboard show it as pending instead of a spend
-- that differs from the chain without a reason. Keyed by payer and ERC-3009 nonce, as the settlement id ends.
-- CHARGED: the reconciliation found it settled with no sale behind it (charged, no delivery recorded): it counts as
-- paid under the customer's mandate, as on chain, and is owed back unless a person finds it was delivered.
CREATE TABLE IF NOT EXISTS sale_settlements (
  key TEXT PRIMARY KEY,
  payer TEXT NOT NULL,
  nonce TEXT NOT NULL,
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  status TEXT NOT NULL CHECK (status IN ('SETTLING', 'DONE', 'FAILED', 'CHARGED')),
  sale_id INTEGER REFERENCES sales(sale_id),
  tx_hash TEXT,
  detail TEXT,
  -- The authorization's validBefore (unix seconds): after it, an unused nonce can never move.
  valid_before INTEGER,
  started_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sale_settlements_open ON sale_settlements (status);

CREATE TABLE IF NOT EXISTS disputes (
  dispute_id TEXT PRIMARY KEY,
  customer TEXT NOT NULL,
  email_sha256 TEXT NOT NULL,
  claims_json TEXT,
  evidence_json TEXT,
  verdicts_json TEXT,
  created_at TEXT NOT NULL
);

-- A dispute is decided once (agent run 1: a restart decided one twice). The decision is written before any refund is
-- paid or any proposal made; a restart carries out the rest of that decision and never decides again. The decision
-- itself cannot change or be deleted; only its progress (what is paid, which proposal) is filled in.
CREATE TABLE IF NOT EXISTS dispute_decisions (
  dispute_id TEXT PRIMARY KEY,
  source TEXT NOT NULL CHECK (source IN ('claude', 'code')),
  plan_json TEXT NOT NULL,
  decided_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('DECIDED', 'DONE')),
  paid_json TEXT NOT NULL DEFAULT '[]',
  escalation_proposal TEXT,
  approval_proposal TEXT,
  last_note TEXT,
  audited INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  attempted_at TEXT,
  -- Refunds of the decision code could not pay (no longer within the automatic limits, or refused for good): they go to
  -- the CFO as one recorded proposal, never paid around the limits.
  handover_json TEXT NOT NULL DEFAULT '[]',
  handover_proposal TEXT,
  -- Refunds held at Metal: how often each was looked at again ({"seq": n}); after HANDOVER_AFTER looks it is "sent,
  -- unconfirmed" (sent_json): never counted as refunded; /health and the reconciliation keep following it.
  held_json TEXT NOT NULL DEFAULT '{}',
  sent_json TEXT NOT NULL DEFAULT '[]',
  -- The process carrying it out now ({pid, start}): another process leaves it alone while that one lives.
  carrier TEXT,
  done_at TEXT
);
CREATE TRIGGER IF NOT EXISTS dispute_decision_once BEFORE INSERT ON dispute_decisions
WHEN EXISTS (SELECT 1 FROM dispute_decisions WHERE dispute_id = NEW.dispute_id)
BEGIN SELECT RAISE(ABORT, 'a dispute decision is decided once'); END;
CREATE TRIGGER IF NOT EXISTS dispute_decision_fixed BEFORE UPDATE OF dispute_id, source, plan_json, decided_at ON dispute_decisions
BEGIN SELECT RAISE(ABORT, 'a dispute decision is decided once'); END;
CREATE TRIGGER IF NOT EXISTS dispute_decision_kept BEFORE DELETE ON dispute_decisions
BEGIN SELECT RAISE(ABORT, 'a dispute decision is kept'); END;

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
  -- PENDING: reserved before Airwallex is asked; FAILED: Airwallex did not issue it as asked (any card it made is frozen).
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'ACTIVE', 'USED', 'FAILED')),
  created_at TEXT NOT NULL
);

-- B1: payments to the sweep wallet from anyone but the business account, held by Metal's ReceivePolicy in quarantine.
-- Kept with Metal's evidence reference (chain id, transaction, log index) and the full receipt needed to release it.
CREATE TABLE IF NOT EXISTS quarantines (
  receipt_id TEXT PRIMARY KEY,
  chain_id INTEGER NOT NULL,
  tx_hash TEXT NOT NULL,
  log_index INTEGER NOT NULL,
  block INTEGER NOT NULL,
  token TEXT NOT NULL,
  originator TEXT NOT NULL,
  receiver TEXT NOT NULL,
  amount_units TEXT NOT NULL,
  reason INTEGER NOT NULL,
  receipt_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('OPEN', 'RETURNED', 'ACCEPTED')),
  resolved_tx TEXT,
  created_at TEXT NOT NULL,
  resolved_at TEXT
);

-- Spend holds (backend review B1): every agent payment reserves its amount here, in one exclusive transaction, before
-- anything is signed or charged; the reservation counts against the agent's mandate budget, the shared total and the
-- card's month at once, so concurrent payments can never together pass a limit. SETTLED: the payment is in its ledger
-- (and counted there); RELEASED: it did not happen. A hold left HELD by a crash keeps counting until it is resolved.
CREATE TABLE IF NOT EXISTS holds (
  ref TEXT PRIMARY KEY,
  agent TEXT NOT NULL,
  rail TEXT NOT NULL CHECK (rail IN ('metal', 'card')),
  cents INTEGER NOT NULL CHECK (cents > 0),
  status TEXT NOT NULL CHECK (status IN ('HELD', 'SETTLED', 'RELEASED')),
  reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS holds_open ON holds (status, agent);

-- The step log of every money action (backend review B2), an outbox: a step is written STARTED with its idempotency
-- key before the outside call, and DONE with what came back after it. After a crash the action resumes from here:
-- a DONE step is never repeated, a STARTED one is looked up at the outside service by its key, never resent blind.
CREATE TABLE IF NOT EXISTS money_steps (
  action_id TEXT NOT NULL,
  n INTEGER NOT NULL,
  step TEXT NOT NULL,
  key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('STARTED', 'DONE')),
  detail_json TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (action_id, step)
);

-- Every version of the CFO policy (backend review B4): all rules and their values, and their hash. A decision, an
-- approval and a hold record the version that applied, so the audit and verify can show which rule held then.
CREATE TABLE IF NOT EXISTS policy_versions (
  version INTEGER PRIMARY KEY,
  sha256 TEXT NOT NULL,
  values_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Agent identities (backend review B5): each agent acts as a principal with its own capabilities (which tools, rails,
-- currencies and kinds of payee), which can be revoked, can expire, and (for an outside agent) has a key that can be
-- rotated. Only the key's hash is kept; the key itself goes to a key file, never to the ledger or a log.
CREATE TABLE IF NOT EXISTS principals (
  principal_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('internal', 'outside')),
  capabilities_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'REVOKED')),
  expires_at TEXT,
  key_sha256 TEXT,
  key_version INTEGER NOT NULL DEFAULT 0,
  reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Receivables (awards item 5): what retailers owe Northwind, and the payments they send to its Airwallex Global
-- Accounts (EUR, GBP). The receivables agent matches each payment to an invoice by its reference; a short, an
-- overpayment, a payment in another currency or one with no invoice is escalated to the CFO. Nothing here moves money.
CREATE TABLE IF NOT EXISTS receivables (
  invoice_no TEXT PRIMARY KEY,
  customer TEXT NOT NULL,
  currency TEXT NOT NULL CHECK (currency IN ('EUR', 'GBP', 'USD')),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  paid_cents INTEGER NOT NULL DEFAULT 0,
  due_date TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('OPEN', 'PAID', 'PARTIAL', 'OVERPAID')),
  issued_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS receipts (
  deposit_id TEXT PRIMARY KEY,
  global_account_id TEXT,
  currency TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  reference TEXT,
  payer TEXT,
  invoice_no TEXT REFERENCES receivables(invoice_no),
  -- The part applied to the invoice; the rest (an overpayment, or all of an unknown payment) waits in suspense.
  applied_cents INTEGER NOT NULL DEFAULT 0,
  outcome TEXT NOT NULL CHECK (outcome IN ('MATCHED', 'SHORT', 'OVER', 'WRONG_CURRENCY', 'UNMATCHED')),
  detail TEXT NOT NULL,
  received_at TEXT NOT NULL
);

-- Every Airwallex webhook the runner accepted (HMAC checked at the relay and again on the runner), once per event id,
-- with what the ledger made of it: agrees 1 (it matches), 0 (the ledger cannot explain it), NULL (nothing to compare).
CREATE TABLE IF NOT EXISTS airwallex_events (
  event_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  object TEXT NOT NULL CHECK (object IN ('card_transaction', 'card', 'transfer', 'conversion', 'deposit', 'other')),
  object_id TEXT,
  status TEXT,
  amount_cents INTEGER,
  currency TEXT,
  agrees INTEGER CHECK (agrees IN (0, 1)),
  outcome TEXT NOT NULL,
  received_at TEXT NOT NULL
);

-- Metal finality certificates (src/metal/finality.ts): one per block, as Metal's RPC returned it, with Purser's check
-- of it (header hash and number, signer bitmap, quorum of the pinned validator count). The BLS signature is not
-- checked, so a certificate is what the RPC reported, not a proof. ok 0 means it failed a check: never evidence.
CREATE TABLE IF NOT EXISTS finality_certificates (
  block_hash TEXT PRIMARY KEY,
  block_number INTEGER NOT NULL,
  certificate_json TEXT NOT NULL,
  ok INTEGER NOT NULL CHECK (ok IN (0, 1)),
  check_json TEXT NOT NULL,
  fetched_at TEXT NOT NULL
);
-- Each ledger chain transaction's block and what is known of its certificate: REPORTED (stored, its checks hold),
-- FAILED (it failed a check), NOT_KEPT (the node no longer had it: past its retention, about 2 hours on testnet) or
-- NOT_FOUND (the transaction never showed as final in about two hours of tries).
CREATE TABLE IF NOT EXISTS finality_evidence (
  tx TEXT PRIMARY KEY,
  block_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('REPORTED', 'FAILED', 'NOT_KEPT', 'NOT_FOUND')),
  recorded_at TEXT NOT NULL
);
-- Transactions looked up but not settled yet (not final, or the RPC failed): tried again, at most MAX_TRIES times.
CREATE TABLE IF NOT EXISTS finality_pending (
  tx TEXT PRIMARY KEY,
  tries INTEGER NOT NULL,
  last_at TEXT NOT NULL
);
-- Agent recognition (the agent-recognition profile of Visa's Trusted Agent Protocol spec): our self-hosted registry of
-- each agent's Ed25519 public key, the merchant domains it may sign for, an end date and a revocation; and every nonce
-- a merchant accepted, so none is accepted twice. Not Visa's directory.
CREATE TABLE IF NOT EXISTS tap_agents (
  keyid TEXT PRIMARY KEY,
  agent TEXT NOT NULL,
  public_jwk TEXT NOT NULL,
  domains_json TEXT NOT NULL,
  not_after INTEGER NOT NULL,
  revoked_at TEXT
);
CREATE TABLE IF NOT EXISTS tap_nonces (
  nonce TEXT PRIMARY KEY,
  keyid TEXT NOT NULL,
  seen_at INTEGER NOT NULL
);
-- D25: nonces our merchant layer accepted on the TAP card rail (src/visa/tapMerchant.ts), per key, stored only after
-- every check passed, and kept for the window plus the skew either way (after that no signature carrying one can be valid).
CREATE TABLE IF NOT EXISTS tap_rail_nonces (
  keyid TEXT NOT NULL,
  nonce TEXT NOT NULL,
  seen_at INTEGER NOT NULL,
  PRIMARY KEY (keyid, nonce)
);

-- Block 5.2: one claim per piece of work two processes could both pick up (a card decline seen by the CLI that caused
-- it and by the runner's webhook or poll): whoever inserts the row does the work; the other skips it.
CREATE TABLE IF NOT EXISTS agent_claims (
  claim TEXT PRIMARY KEY,
  claimed_by TEXT NOT NULL,
  claimed_at TEXT NOT NULL
);

-- D19, the autonomous agents: what changed in the world, the agents' messages to each other, and how far each agent
-- has read. The world (the demo, a webhook, a refusal) publishes events; an agent's loop wakes on its own.
CREATE TABLE IF NOT EXISTS world_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  for_agent TEXT,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS agent_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_agent TEXT NOT NULL,
  to_agent TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS agent_cursors (
  agent TEXT PRIMARY KEY,
  last_event_id INTEGER NOT NULL DEFAULT 0,
  last_message_id INTEGER NOT NULL DEFAULT 0,
  last_tick_at TEXT
);

-- The Airi rail (src/airi/purchase.ts): one row per purchase, from its reservation (HELD, which is its hold: the day's
-- count of purchases without Face ID is taken under the write lock) to SETTLED, RELEASED or UNCONFIRMED (the
-- checkout's outcome is not known; it keeps counting until a look-up or a person settles it). Safe references only:
-- never the credential, its file or the passkey link.
CREATE TABLE IF NOT EXISTS airi_purchases (
  action_id TEXT PRIMARY KEY,
  agent TEXT NOT NULL,
  route TEXT NOT NULL CHECK (route IN ('alone', 'cfo')),
  proposal_id TEXT,
  order_sha256 TEXT NOT NULL,
  terms_json TEXT NOT NULL,
  cents INTEGER NOT NULL CHECK (cents > 0),
  day TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('HELD', 'WAITING_FOR_TAP', 'PAYING', 'SETTLED', 'RELEASED', 'UNCONFIRMED')),
  mandate_id TEXT,
  checkout_ref TEXT,
  outcome TEXT,
  code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS airi_purchases_day ON airi_purchases (day, route, status);

-- Payables (src/ap): every supplier document as it came in, kept unchanged at `path` (data/ap/docs/<sha256>.<ext>);
-- the invoice read from it, its checks and where it stands; and new suppliers, added only after a person verified
-- the account and the CFO approved (src/ap/vendors.ts, like payee_changes).
CREATE TABLE IF NOT EXISTS ap_documents (
  sha256 TEXT PRIMARY KEY,
  filename TEXT NOT NULL,
  mime TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  path TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('upload', 'folder', 'email', 'api')),
  meta_json TEXT NOT NULL DEFAULT '{}',
  text_chars INTEGER NOT NULL,
  received_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ap_invoices (
  id TEXT PRIMARY KEY,
  doc_sha256 TEXT NOT NULL UNIQUE REFERENCES ap_documents(sha256),
  -- What the document is (Claude Haiku's label, checked by code, or keyword rules): only an invoice, a credit note or a
  -- reminder is read in full; a reminder goes through the duplicate check like any copy.
  doc_kind TEXT NOT NULL CHECK (doc_kind IN ('invoice', 'credit_note', 'receipt', 'reminder', 'other', 'unread')),
  classified_by TEXT NOT NULL,
  vendor TEXT NOT NULL,
  invoice_no TEXT NOT NULL,
  issue_date TEXT NOT NULL,
  due_date TEXT NOT NULL,
  currency TEXT NOT NULL,
  subtotal TEXT NOT NULL,
  tax TEXT NOT NULL,
  total TEXT NOT NULL,
  iban_last4 TEXT NOT NULL,
  bic TEXT NOT NULL,
  reading_json TEXT NOT NULL,
  read_by TEXT NOT NULL,
  gl_account TEXT NOT NULL,
  gl_rule TEXT NOT NULL,
  cost_centre TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('blocked', 'needs_review', 'needs_vendor', 'ready', 'waiting_cfo', 'paid', 'rejected')),
  findings_json TEXT NOT NULL,
  proposal_id TEXT,
  -- Claude Opus's advisory note on an irregular invoice (blocked, warned, or waiting for Face ID), or the code's own
  -- reasons without a key. Advisory only: it never changes a status.
  review_note TEXT,
  review_by TEXT,
  received_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  paid_at TEXT
);
CREATE INDEX IF NOT EXISTS ap_invoices_vendor ON ap_invoices (vendor, received_at);

CREATE TABLE IF NOT EXISTS payee_adds (
  add_id TEXT PRIMARY KEY,
  vendor TEXT NOT NULL,
  iban TEXT NOT NULL,
  bic TEXT NOT NULL,
  source TEXT,
  requested_by TEXT NOT NULL,
  verification_json TEXT,
  proposal_id TEXT,
  -- CLOSED: its proposal expired, was rejected or can no longer run; a new request for the supplier may follow.
  status TEXT NOT NULL CHECK (status IN ('REQUESTED', 'VERIFIED', 'PROPOSED', 'APPLIED', 'CLOSED')),
  created_at TEXT NOT NULL
);

-- What each payables invoice has handed to the bookkeeping sink, once per event: an accrual a sink missed is pushed
-- before the payment, and a rejected invoice's accrual is reversed there (review, 8 November).
CREATE TABLE IF NOT EXISTS ap_sink_events (
  invoice_id TEXT NOT NULL REFERENCES ap_invoices(id),
  event TEXT NOT NULL CHECK (event IN ('accrual', 'payment', 'reversal')),
  sink TEXT NOT NULL,
  pushed_at TEXT NOT NULL,
  PRIMARY KEY (invoice_id, event, sink)
);
