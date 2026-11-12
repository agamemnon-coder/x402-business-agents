-- The hands-on deployment's extras (cloud/src/try/counter.ts, metrics.ts, feedback.ts). Additive only: new tables, no
-- change to any existing one. The modules also make these tables on first use (CREATE ... IF NOT EXISTS), so a
-- deployment that has not run this migration yet works the same; test/cloud-try-extras.test.ts holds the two equal.
-- None of them holds an id of a company, an address, a token or a browser.
-- The live counter: totals per UTC hour (YYYY-MM-DDTHH) and kind (played, caught, signed, unsigned).
CREATE TABLE IF NOT EXISTS try_tally (hour TEXT NOT NULL, kind TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (hour, kind));
-- The owner's page: requests per minute, route pattern and status class, with latency buckets; who read the invoices.
CREATE TABLE IF NOT EXISTS try_metrics (minute INTEGER NOT NULL, route TEXT NOT NULL, class TEXT NOT NULL, n INTEGER NOT NULL, b0 INTEGER NOT NULL DEFAULT 0, b1 INTEGER NOT NULL DEFAULT 0, b2 INTEGER NOT NULL DEFAULT 0, b3 INTEGER NOT NULL DEFAULT 0, b4 INTEGER NOT NULL DEFAULT 0, b5 INTEGER NOT NULL DEFAULT 0, b6 INTEGER NOT NULL DEFAULT 0, b7 INTEGER NOT NULL DEFAULT 0, b8 INTEGER NOT NULL DEFAULT 0, b9 INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (minute, route, class));
CREATE TABLE IF NOT EXISTS try_status (key TEXT PRIMARY KEY, at TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0);
-- Anonymous feedback: the hour, one of three choices and an optional note of at most 200 characters.
CREATE TABLE IF NOT EXISTS try_feedback (id INTEGER PRIMARY KEY AUTOINCREMENT, hour TEXT NOT NULL, choice TEXT NOT NULL CHECK (choice IN ('useful', 'unclear', 'broken')), note TEXT);
