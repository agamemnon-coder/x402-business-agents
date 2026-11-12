// One list of checks on the database handle as the engine uses it. Each check gives one line: its label and what the
// handle answered (or what it threw). The same list runs on better-sqlite3 and on the Durable Object handle
// (src/db/doSql.ts), over a stand-in in Node (test/db-do-sql.test.ts) and over a real Durable Object's SQLite in
// workerd (test/db-do-sql-workerd.test.ts), and the answers are compared line by line. One line is known to differ:
// "bind bigint" (a Durable Object's SQLite has no integer binding; the engine binds no bigint).
//
// No Node import here: this file is also bundled into the Worker of the workerd test.

interface LooseStatement {
  get(...values: unknown[]): unknown;
  all(...values: unknown[]): unknown[];
  run(...values: unknown[]): { changes: number; lastInsertRowid: number | bigint };
  iterate(...values: unknown[]): Iterable<unknown>;
}

/** The handle as the checks call it. Loose on purpose: the checks hand it wrong values and make wrong calls. */
export interface ConformanceDb {
  prepare(sql: string): LooseStatement;
  exec(sql: string): unknown;
  pragma(source: string, options?: { simple?: boolean }): unknown;
  transaction<A extends unknown[], R>(fn: (...args: A) => R): ((...args: A) => R) & { immediate: (...args: A) => R };
  readonly open: boolean;
  readonly inTransaction: boolean;
  readonly name: string;
}

/** The one check whose answer differs between better-sqlite3 and the Durable Object handle. */
export const KNOWN_DIFFERENCE = "bind bigint";

/** Runs every check on a fresh, empty database and returns [label, answer] per check, in order. */
export function conformance(handle: unknown): [string, string][] {
  const db = handle as ConformanceDb;
  const out: [string, string][] = [];
  const json = (v: unknown) => JSON.stringify(v, (_k, x: unknown) => (typeof x === "bigint" ? `${x}n` : x === undefined ? "<undefined>" : typeof x === "number" && !Number.isFinite(x) ? String(x) : x));
  const t = (label: string, f: () => unknown) => {
    try { out.push([label, json(f())]); } catch (e) { const x = e as Error & { code?: string }; out.push([label, `THROWS ${x.constructor.name} ${x.code ?? ""} ${x.message}`]); }
  };
  const blob = (row: unknown) => { const b = (row as { b: Buffer }).b; return [Buffer.isBuffer(b), [...b]]; };
  t("typeof bound numbers", () => db.prepare("SELECT typeof(?) AS t_int, typeof(?) AS t_real, typeof(?) AS t_bigfloat, ? || '' AS as_text, json_object('k', ?) AS o").get(5, 5.5, 5e9, 5, 5));
  db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, a TEXT, n INTEGER, x)");
  t("run result", () => db.prepare("INSERT INTO t (a, n, x) VALUES (?, ?, ?)").run(7, 7, 7));
  t("row types", () => db.prepare("SELECT id, a, typeof(a) AS ta, n, typeof(n) AS tn, x, typeof(x) AS tx FROM t").get());
  for (const [label, v] of [["undefined", undefined], ["true", true], ["date", new Date(0)], ["NaN", NaN], ["Infinity", Infinity], ["-0", -0], ["bigint", 5n], ["symbol", Symbol("s")], ["function", () => 1]] as [string, unknown][]) {
    t(`bind ${label}`, () => db.prepare("SELECT ? AS v, typeof(?) AS t").get(v, v));
  }
  t("two named objects", () => db.prepare("SELECT @a AS a").get({ a: 1 }, { a: 2 }));
  t("named, extra key", () => db.prepare("SELECT @a AS a, @b AS b").get({ a: 1, b: 2, extra: 3 }));
  t("named, missing", () => db.prepare("SELECT @a AS a, @b AS b").get({ a: 1 }));
  t("named, undefined value", () => db.prepare("SELECT @a AS a").get({ a: undefined }));
  t("named, repeated", () => db.prepare("SELECT @a AS a, @b AS b, @a AS c").get({ a: 1, b: 2 }));
  t("named + positional", () => db.prepare("SELECT ? AS p, @a AS a, ? AS q").get(9, { a: 1 }, 8));
  t("named, : and $", () => db.prepare("SELECT :a AS a, $b AS b").get({ a: 1, b: 2 }));
  t("named inside a string is not a parameter", () => db.prepare("SELECT '@a :b $c ?' AS s, json_extract(?, '$.k') AS j -- @z ?\n").get('{"k":3}'));
  t("too few", () => db.prepare("SELECT ? AS a").get());
  t("too many", () => db.prepare("SELECT ? AS a").get(1, 2));
  t("prepare two statements", () => db.prepare("SELECT 1 AS a; SELECT 2 AS b").get());
  t("prepare with trailing ; and comment", () => db.prepare("SELECT 1 AS a; -- done\n").get());
  t("run on a SELECT", () => db.prepare("SELECT 1 AS a").run());
  t("get on an INSERT", () => db.prepare("INSERT INTO t (a) VALUES (?)").get("z"));
  t("all on an INSERT", () => db.prepare("INSERT INTO t (a) VALUES (?)").all("z"));
  t("get on INSERT RETURNING", () => db.prepare("INSERT INTO t (a) VALUES (?) RETURNING id").get("z"));
  t("run on INSERT RETURNING", () => db.prepare("INSERT INTO t (a) VALUES (?) RETURNING id").run("z"));
  t("array of values", () => db.prepare("SELECT ? AS a, ? AS b").get([1, 2]));
  t("blob in, Buffer out", () => blob(db.prepare("SELECT ? AS b").get(Buffer.from([1, 2, 3]))));
  t("Uint8Array view in", () => blob(db.prepare("SELECT ? AS b").get(new Uint8Array([9, 1, 2, 3, 9]).subarray(1, 4))));
  t("duplicate column names", () => db.prepare("SELECT 1 AS a, 2 AS a").get());
  t("pragma table_info", () => (db.pragma("table_info(t)") as { name: string }[]).map((c) => c.name));
  t("prepare PRAGMA table_info", () => (db.prepare("PRAGMA table_info(t)").all() as { name: string; type: string }[]).map((c) => `${c.name}:${c.type}`));
  t("pragma foreign_keys = ON, then read", () => { db.pragma("foreign_keys = ON"); return [db.pragma("foreign_keys"), db.pragma("foreign_keys", { simple: true })]; });
  t("pragma busy_timeout / journal_mode do not throw", () => { db.pragma("busy_timeout = 5000"); db.pragma("journal_mode = WAL"); return "ok"; });
  t("pragma foreign_key_check", () => db.pragma("foreign_key_check(t)"));
  t("get with no row", () => db.prepare("SELECT 1 WHERE 0").get());
  t("all with no row", () => db.prepare("SELECT 1 WHERE 0").all());
  t("changes: update of nothing", () => db.prepare("UPDATE t SET a = a WHERE id = -1").run());
  t("changes: after a read", () => { db.prepare("SELECT * FROM t").all(); return db.prepare("UPDATE t SET a = 'q' WHERE id <= 2").run(); });
  t("changes: CREATE TABLE after an update", () => db.prepare("CREATE TABLE c1 (a)").run().changes);
  t("changes: after exec", () => { db.exec("INSERT INTO c1 VALUES (1); INSERT INTO c1 VALUES (2)"); return db.prepare("SELECT 1").run().changes; });
  t("changes: delete many", () => db.prepare("DELETE FROM c1").run().changes);
  t("lastInsertRowid after an update", () => db.prepare("UPDATE t SET a = 'r' WHERE id = 1").run());
  t("integer division with a bound number", () => db.prepare("SELECT ? / 2 AS d, 7 / 2 AS lit").get(7));
  t("text column = bound number", () => { db.exec("CREATE TABLE s (k TEXT); INSERT INTO s VALUES ('5'), ('5.0')"); return db.prepare("SELECT k FROM s WHERE k = ?").all(5); });
  t("LIMIT ?", () => db.prepare("SELECT id FROM t ORDER BY id LIMIT ?").all(2));
  t("big integer read", () => db.prepare("SELECT 9007199254740993 AS big, 4611686018427387904 AS bigger").get());
  t("json_extract number / text / null", () => db.prepare("SELECT json_extract(?, '$.n') AS n, json_extract(?, '$.s') AS s, json_extract(?, '$.missing') AS m, json_extract(?, '$.o') AS o").get('{"n":1.5}', '{"s":"x"}', "{}", '{"o":{"a":[1]}}'));
  t("get takes the first of many rows", () => { db.exec("CREATE TABLE many (n INTEGER)"); const ins = db.prepare("INSERT INTO many VALUES (?)"); for (let i = 0; i < 50; i++) ins.run(i); const first = db.prepare("SELECT n FROM many ORDER BY n").get(); db.prepare("UPDATE many SET n = n + 100").run(); return [first, db.prepare("SELECT MIN(n) AS lo FROM many").get()]; });
  t("statement reused with other values", () => { const st = db.prepare("SELECT ? + 0 AS v"); return [st.get(1), st.get(2), st.all(3)]; });
  t("iterate", () => [...db.prepare("SELECT n FROM many ORDER BY n LIMIT 3").iterate()]);
  // Transactions.
  t("transaction: value and arguments", () => db.transaction((a: number, b: number) => a + b)(2, 3));
  t("transaction: immediate", () => db.transaction(() => { db.prepare("INSERT INTO s VALUES ('tx1')").run(); return db.inTransaction; }).immediate());
  t("transaction: throw rolls back", () => { try { db.transaction(() => { db.prepare("INSERT INTO s VALUES ('gone')").run(); throw new Error("boom"); })(); } catch (e) { return [(e as Error).message, db.prepare("SELECT COUNT(*) AS n FROM s WHERE k = 'gone'").get()]; } return "did not throw"; });
  t("transaction: nested, inner throws, outer goes on", () => {
    const inner = db.transaction(() => { db.prepare("INSERT INTO s VALUES ('inner')").run(); throw new Error("inner fails"); });
    const outer = db.transaction(() => { db.prepare("INSERT INTO s VALUES ('outer')").run(); try { inner(); } catch { /* the outer transaction goes on */ } db.prepare("INSERT INTO s VALUES ('outer2')").run(); return db.inTransaction; });
    return [outer.immediate(), (db.prepare("SELECT k FROM s ORDER BY rowid").all() as { k: string }[]).map((x) => x.k), db.inTransaction];
  });
  t("transaction: nested, both commit", () => { const inner = db.transaction(() => db.prepare("INSERT INTO s VALUES ('n2')").run().changes); return db.transaction(() => inner() + inner())(); });
  t("transaction: nested, outer throws after inner committed", () => { const inner = db.transaction(() => { db.prepare("INSERT INTO s VALUES ('lost')").run(); }); try { db.transaction(() => { inner(); throw new Error("outer fails"); })(); } catch { /* rolled back */ } return db.prepare("SELECT COUNT(*) AS n FROM s WHERE k = 'lost'").get(); });
  t("transaction: a promise is refused", () => { try { db.transaction(async () => { db.prepare("INSERT INTO s VALUES ('async')").run(); })(); return "allowed"; } catch (e) { return [(e as Error).message, db.prepare("SELECT COUNT(*) AS n FROM s WHERE k = 'async'").get()]; } });
  t("changes after a rolled-back transaction", () => db.prepare("SELECT 1").run().changes);
  // Errors, as the engine's callers see them.
  db.exec("CREATE TABLE u (k TEXT PRIMARY KEY, v TEXT NOT NULL CHECK (v IN ('a', 'b')), r TEXT REFERENCES u(k))");
  t("error: primary key", () => { db.prepare("INSERT INTO u VALUES ('a', 'a', NULL)").run(); return db.prepare("INSERT INTO u VALUES ('a', 'a', NULL)").run(); });
  t("error: check", () => db.prepare("INSERT INTO u VALUES ('c', 'z', NULL)").run());
  t("error: not null", () => db.prepare("INSERT INTO u (k) VALUES ('d')").run());
  t("error: foreign key", () => db.prepare("INSERT INTO u VALUES ('e', 'a', 'nobody')").run());
  t("error: unique index", () => { db.exec("CREATE UNIQUE INDEX u_v ON u (v)"); return db.prepare("INSERT INTO u VALUES ('f', 'a', NULL)").run(); });
  t("error: trigger RAISE(ABORT)", () => { db.exec("CREATE TRIGGER u_no_update BEFORE UPDATE ON u BEGIN SELECT RAISE(ABORT, 'u is append-only'); END"); return db.prepare("UPDATE u SET v = 'b'").run(); });
  t("error: syntax", () => db.prepare("SELEC 1").get());
  t("error: no such table", () => db.prepare("SELECT * FROM nope").all());
  t("error: no such column", () => db.prepare("SELECT nope FROM t").all());
  t("error: in exec, earlier statements stay", () => { try { db.exec("INSERT INTO s VALUES ('before'); INSERT INTO nope VALUES (1)"); } catch (e) { return [(e as Error).message, db.prepare("SELECT COUNT(*) AS n FROM s WHERE k = 'before'").get()]; } return "did not throw"; });
  t("exec: a trigger with its own statements", () => { db.exec("CREATE TABLE lg (m TEXT); CREATE TRIGGER s_log AFTER INSERT ON s BEGIN INSERT INTO lg VALUES (CASE WHEN new.k = 'x' THEN 'saw x' ELSE 'saw other' END); END; INSERT INTO s VALUES ('x');"); return db.prepare("SELECT m FROM lg").all(); });
  t("changes do not count a trigger's rows", () => db.prepare("INSERT INTO s VALUES ('y')").run().changes);
  t("ALTER TABLE ADD COLUMN / RENAME", () => { db.exec("ALTER TABLE c1 ADD COLUMN b TEXT NOT NULL DEFAULT 'd'"); db.exec("ALTER TABLE c1 RENAME TO c2"); return (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('c1', 'c2')").all() as { name: string }[]).map((r) => r.name); });
  t("handle properties", () => [db.open, db.inTransaction, typeof db.name]);
  return out;
}
