-- Stage mode for the finals (cloud/src/try/stage.ts; docs/finals/stage-mode.md). Additive only: one new table and its
-- index, no change to any existing one. The module also makes them on first use (CREATE ... IF NOT EXISTS), so a
-- deployment that has not run this migration yet works the same; test/try-stage.test.ts holds the two equal.
-- One row per step of a company in the event pool: when, which kind (read, signed, paid, refused), a paid amount and
-- currency, the seconds since that company started, the changed fields' names. No company id, no name, no address.
CREATE TABLE IF NOT EXISTS try_stage (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('read', 'signed', 'paid', 'refused')), amount TEXT, currency TEXT, secs INTEGER, detail TEXT);
CREATE INDEX IF NOT EXISTS try_stage_by_at ON try_stage (at);
