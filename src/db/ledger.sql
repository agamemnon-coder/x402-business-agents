-- Purser's own books (docs/archive/superpowers/specs/2026-11-08-bookkeeping-core-design.md): a stored general ledger.
-- Append-only like the audit log: entries, lines, month locks and stock moves are never changed or deleted; a mistake
-- is corrected by a reversing entry. Each entry's hash covers the previous one's (src/ledger/core.ts).
CREATE TABLE IF NOT EXISTS ledger_entries (
  entry_id INTEGER PRIMARY KEY,
  posting_date TEXT NOT NULL,
  doc_date TEXT NOT NULL,
  description TEXT NOT NULL,
  source_key TEXT UNIQUE,
  doc_ref TEXT,
  doc_sha256 TEXT,
  created_by TEXT NOT NULL,
  reverses INTEGER REFERENCES ledger_entries(entry_id),
  created_at TEXT NOT NULL,
  prev_hash TEXT NOT NULL,
  entry_hash TEXT NOT NULL UNIQUE,
  -- Added 12 November, nullable: the CFO's Face ID hash and the rail's id (transfer id or tx hash) an entry was made
  -- under. In the entry's hash only when set, so the entries before them hash as they did.
  approval_sha256 TEXT,
  rail_ref TEXT
);
CREATE INDEX IF NOT EXISTS ledger_entries_posting ON ledger_entries (posting_date);
CREATE TABLE IF NOT EXISTS ledger_lines (
  entry_id INTEGER NOT NULL REFERENCES ledger_entries(entry_id),
  line_no INTEGER NOT NULL,
  account TEXT NOT NULL,
  debit_cents INTEGER NOT NULL DEFAULT 0,
  credit_cents INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL,
  cost_centre TEXT,
  vat_code TEXT,
  vat_cents INTEGER,
  party TEXT,
  due_date TEXT,
  doc_ref TEXT,
  memo TEXT,
  PRIMARY KEY (entry_id, line_no),
  CHECK (debit_cents >= 0 AND credit_cents >= 0 AND (debit_cents = 0) <> (credit_cents = 0))
);
CREATE INDEX IF NOT EXISTS ledger_lines_account ON ledger_lines (account, currency);
CREATE TABLE IF NOT EXISTS ledger_locks (
  month TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  locked_by TEXT NOT NULL,
  locked_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS stock_items (
  sku TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  currency TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS stock_moves (
  id INTEGER PRIMARY KEY,
  sku TEXT NOT NULL REFERENCES stock_items(sku),
  qty_delta INTEGER NOT NULL,
  value_delta_cents INTEGER NOT NULL,
  -- The entry that moved the value; none for a sale whose share of the cost rounds to zero cents (no entry to post).
  entry_id INTEGER REFERENCES ledger_entries(entry_id),
  at TEXT NOT NULL,
  -- A sale's own key (cogs:<sku>:<doc>), so a sale moves stock once even when no entry was posted for it.
  ref TEXT
);
CREATE TRIGGER IF NOT EXISTS ledger_entries_no_update BEFORE UPDATE ON ledger_entries BEGIN SELECT RAISE(ABORT, 'the ledger is append-only'); END;
CREATE TRIGGER IF NOT EXISTS ledger_entries_no_delete BEFORE DELETE ON ledger_entries BEGIN SELECT RAISE(ABORT, 'the ledger is append-only'); END;
CREATE TRIGGER IF NOT EXISTS ledger_lines_no_update BEFORE UPDATE ON ledger_lines BEGIN SELECT RAISE(ABORT, 'the ledger is append-only'); END;
CREATE TRIGGER IF NOT EXISTS ledger_lines_no_delete BEFORE DELETE ON ledger_lines BEGIN SELECT RAISE(ABORT, 'the ledger is append-only'); END;
CREATE TRIGGER IF NOT EXISTS ledger_locks_no_update BEFORE UPDATE ON ledger_locks BEGIN SELECT RAISE(ABORT, 'month locks are append-only'); END;
CREATE TRIGGER IF NOT EXISTS ledger_locks_no_delete BEFORE DELETE ON ledger_locks BEGIN SELECT RAISE(ABORT, 'month locks are append-only'); END;
CREATE TRIGGER IF NOT EXISTS stock_moves_no_update BEFORE UPDATE ON stock_moves BEGIN SELECT RAISE(ABORT, 'stock moves are append-only'); END;
CREATE TRIGGER IF NOT EXISTS stock_moves_no_delete BEFORE DELETE ON stock_moves BEGIN SELECT RAISE(ABORT, 'stock moves are append-only'); END;
