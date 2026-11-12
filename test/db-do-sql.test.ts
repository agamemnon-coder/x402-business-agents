// The Durable Object handle (src/db/doSql.ts): a better-sqlite3-shaped handle over a Durable Object's SQLite, and the
// schema steps (src/db/migrate.ts) that run on any handle. Here in plain Node, over a stand-in for the object's storage
// (test/support/doStorage.ts); the same checks against a real Durable Object are in test/db-do-sql-workerd.test.ts.
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { asSqliteError, doDb, DoDatabase, scanSql, SqliteError } from "../src/db/doSql.js";
import { prepareDb, settlementsTable } from "../src/db/migrate.js";
import { openDb, settlementsTable as settlementsTableFromOpen } from "../src/db/open.js";
import { conformance, KNOWN_DIFFERENCE } from "./support/dbConformance.js";
import { sqliteDoStorage } from "./support/doStorage.js";

const SCHEMA = readFileSync(new URL("../src/db/schema.sql", import.meta.url), "utf8");
const LEDGER = readFileSync(new URL("../src/db/ledger.sql", import.meta.url), "utf8");

describe("scanSql: one read of the SQL", () => {
  it("numbers anonymous parameters by position", () => {
    const s = scanSql("SELECT ? AS a, ? AS b");
    expect(s.slots).toEqual([null, null]);
    expect(s.statements).toBe(1);
    expect(s.head).toBe("SELECT");
  });

  it("takes ?3 as the third parameter, with the ones before it", () => {
    expect(scanSql("SELECT ?3 AS c, ?1 AS a").slots).toEqual([null, null, null]);
    expect(scanSql("SELECT ?2, ?").slots).toEqual([null, null, null]);
  });

  it("names @a, :a and $a parameters", () => {
    expect(scanSql("SELECT @a AS a").slots).toEqual(["a"]);
    expect(scanSql("SELECT :a AS a, $b AS b").slots).toEqual(["a", "b"]);
  });

  it("gives a repeated name one index, as SQLite does", () => {
    expect(scanSql("SELECT @a AS a, @b AS b, @a AS c").slots).toEqual(["a", "b"]);
  });

  it("keeps named and anonymous parameters in SQLite's order", () => {
    expect(scanSql("SELECT ? AS p, @a AS a, ? AS q").slots).toEqual([null, "a", null]);
  });

  it("ignores what looks like a parameter inside a string, a quoted name or a comment", () => {
    expect(scanSql("SELECT '@a :b $c ?' AS s, \"@q ?\" AS q, `:r` AS r, [?] AS t, 'it''s ?' AS u, ? AS v -- @z ?\n/* :y ? */").slots).toEqual([null]);
    expect(scanSql("SELECT json_extract(?, '$.k') AS j").slots).toEqual([null]);
  });

  it("counts statements; a trailing semicolon or comment is not one more", () => {
    expect(scanSql("SELECT 1 AS a; SELECT 2 AS b").statements).toBe(2);
    expect(scanSql("SELECT 1 AS a; -- done\n").statements).toBe(1);
    expect(scanSql("  -- nothing here\n").statements).toBe(0);
    expect(scanSql("").statements).toBe(0);
  });

  it("tells where the last token ends, so a trailing comment can be cut off", () => {
    const sql = "SELECT 1 AS a; -- done\n";
    expect(sql.slice(0, scanSql(sql).end)).toBe("SELECT 1 AS a;");
  });

  it("counts CREATE TRIGGER ... BEGIN ... END as one statement", () => {
    expect(scanSql("CREATE TRIGGER u_no_update BEFORE UPDATE ON u BEGIN SELECT RAISE(ABORT, 'u is append-only'); END").statements).toBe(1);
    const withCase = "CREATE TRIGGER s_log AFTER INSERT ON s BEGIN INSERT INTO lg VALUES (CASE WHEN new.k = 'x' THEN 'saw x' ELSE 'saw other' END); UPDATE lg SET m = m; END";
    expect(scanSql(withCase).statements).toBe(1);
    expect(scanSql(`CREATE TABLE lg (m TEXT); ${withCase}; INSERT INTO s VALUES ('x');`).statements).toBe(3);
  });

  it("sees RETURNING", () => {
    const s = scanSql("INSERT INTO t (a) VALUES (?) RETURNING id");
    expect(s.head).toBe("INSERT");
    expect(s.returning).toBe(true);
    expect(scanSql("INSERT INTO t (a) VALUES ('RETURNING')").returning).toBe(false);
  });

  it("finds no parameter in the engine's own schema files, and more than one statement", () => {
    for (const text of [SCHEMA, LEDGER]) {
      const s = scanSql(text);
      expect(s.slots).toEqual([]);
      expect(s.statements).toBeGreaterThan(1);
    }
  });
});

describe("asSqliteError: a Durable Object's error as better-sqlite3 throws it", () => {
  it("takes the code from the extended part and leaves the message as SQLite gave it", () => {
    const e = asSqliteError(new Error("UNIQUE constraint failed: u.k: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_PRIMARYKEY)"));
    expect(e).toBeInstanceOf(SqliteError);
    expect((e as SqliteError).message).toBe("UNIQUE constraint failed: u.k");
    expect((e as SqliteError).code).toBe("SQLITE_CONSTRAINT_PRIMARYKEY");
  });

  it("uses the primary code when there is no extended one, and drops the offset", () => {
    const e = asSqliteError(new Error("near \"SELEC\": syntax error at offset 0: SQLITE_ERROR")) as SqliteError;
    expect(e.message).toBe("near \"SELEC\": syntax error");
    expect(e.code).toBe("SQLITE_ERROR");
  });

  it("hands anything else on unchanged", () => {
    const plain = new Error("boom");
    expect(asSqliteError(plain)).toBe(plain);
    expect(asSqliteError("text")).toBe("text");
  });
});

describe("the stand-in for a Durable Object's storage", () => {
  const storage = () => sqliteDoStorage(new Database(":memory:"));

  it("binds by position, named parameters included", () => {
    expect(storage().sql.exec("SELECT ? AS p, @a AS a, :b AS b, $c AS c", 1, 2, 3, 4).toArray()).toEqual([{ p: 1, a: 2, b: 3, c: 4 }]);
  });

  it("hands a BLOB back as an ArrayBuffer", () => {
    const row = storage().sql.exec("SELECT ? AS b", new Uint8Array([1, 2, 3]).buffer).toArray()[0]!;
    expect(row.b).toBeInstanceOf(ArrayBuffer);
    expect([...new Uint8Array(row.b as ArrayBuffer)]).toEqual([1, 2, 3]);
  });

  it("words an SQLite error with its codes after the message", () => {
    const s = storage();
    s.sql.exec("CREATE TABLE u (k TEXT PRIMARY KEY)");
    s.sql.exec("INSERT INTO u VALUES ('a')");
    expect(() => s.sql.exec("INSERT INTO u VALUES ('a')")).toThrow("UNIQUE constraint failed: u.k: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_PRIMARYKEY)");
    expect(() => s.sql.exec("SELECT * FROM nope")).toThrow("no such table: nope: SQLITE_ERROR");
  });

  it("refuses BEGIN, COMMIT and SAVEPOINT", () => {
    const s = storage();
    for (const sql of ["BEGIN", "BEGIN IMMEDIATE", "COMMIT", "ROLLBACK", "SAVEPOINT a", "RELEASE a"]) expect(() => s.sql.exec(sql), sql).toThrow("not authorized: SQLITE_AUTH");
  });

  it("runs transactionSync as savepoints: an inner throw undoes only the inner part", () => {
    const s = storage();
    s.sql.exec("CREATE TABLE s (k TEXT)");
    s.transactionSync(() => {
      s.sql.exec("INSERT INTO s VALUES ('outer')");
      try { s.transactionSync(() => { s.sql.exec("INSERT INTO s VALUES ('inner')"); throw new Error("inner fails"); }); } catch { /* the outer part goes on */ }
    });
    expect(() => s.transactionSync(() => { s.sql.exec("INSERT INTO s VALUES ('gone')"); throw new Error("boom"); })).toThrow("boom");
    expect(s.sql.exec("SELECT k FROM s").toArray()).toEqual([{ k: "outer" }]);
  });
});

describe("the engine's handle over a Durable Object's SQLite", () => {
  const node = conformance(new Database(":memory:"));
  const shim = conformance(doDb(sqliteDoStorage(new Database(":memory:"))));

  it("has 76 checks", () => {
    expect(node).toHaveLength(76);
    expect(shim.map(([label]) => label)).toEqual(node.map(([label]) => label));
    expect(new Set(node.map(([label]) => label)).size).toBe(76);
  });

  for (const [i, [label, answer]] of node.entries()) {
    if (label === KNOWN_DIFFERENCE) continue;
    it(`answers as better-sqlite3 does: ${label}`, () => { expect(shim[i]![1]).toBe(answer); });
  }

  it("differs on one check only: a bigint cannot be bound (the engine binds none)", () => {
    const differing = node.filter(([, answer], i) => shim[i]![1] !== answer).map(([label]) => label);
    expect(differing).toEqual([KNOWN_DIFFERENCE]);
    const i = node.findIndex(([label]) => label === KNOWN_DIFFERENCE);
    expect(node[i]![1]).toBe('{"v":5,"t":"integer"}');
    expect(shim[i]![1]).toMatch(/^THROWS TypeError .*bigint cannot be bound/);
  });

  it("doDb gives the handle the engine's type, with its name", () => {
    const db = doDb(sqliteDoStorage(new Database(":memory:")), "company");
    expect(db).toBeInstanceOf(DoDatabase);
    expect(db.name).toBe("company");
    expect(doDb(sqliteDoStorage(new Database(":memory:"))).name).toBe("durable-object");
    expect(db.prepare("SELECT @a + ? AS n").get({ a: 1 }, 2)).toEqual({ n: 3 });
  });
});

describe("prepareDb: the schema and its migrations on any handle", () => {
  const master = (db: { prepare(sql: string): { all(): unknown[] } }) => db.prepare("SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name").all();

  it("over the Durable Object handle leaves the same schema as openDb(':memory:')", () => {
    const viaOpen = openDb(":memory:");
    const raw = new Database(":memory:");
    const db = doDb(sqliteDoStorage(raw));
    db.pragma("foreign_keys = ON");
    prepareDb(db, SCHEMA, LEDGER);
    const expected = master(viaOpen);
    expect(expected.length).toBeGreaterThan(50);
    expect(master(db)).toEqual(expected);
    // Read without the shim too: what is in the file is the same.
    expect(master(raw)).toEqual(expected);
    expect(raw.pragma("foreign_keys", { simple: true })).toBe(1);
    expect(raw.pragma("foreign_key_check")).toEqual([]);
  });

  it("is idempotent over the handle: a second run changes nothing", () => {
    const db = doDb(sqliteDoStorage(new Database(":memory:")));
    db.pragma("foreign_keys = ON");
    prepareDb(db, SCHEMA, LEDGER);
    const first = master(db);
    prepareDb(db, SCHEMA, LEDGER);
    expect(master(db)).toEqual(first);
  });

  it("on better-sqlite3 directly gives what openDb gives (openDb only adds the file and its pragmas)", () => {
    const raw = new Database(":memory:");
    raw.pragma("foreign_keys = ON");
    prepareDb(raw, SCHEMA, LEDGER);
    expect(master(raw)).toEqual(master(openDb(":memory:")));
  });

  it("neither the schema steps nor the handle import anything at run time (no Node module in a Durable Object)", () => {
    for (const file of ["../src/db/migrate.ts", "../src/db/doSql.ts"]) {
      const imports = readFileSync(new URL(file, import.meta.url), "utf8").split("\n").filter((line) => /^\s*(import|export)\b.*\bfrom\b/.test(line) || /\b(require|import)\(/.test(line));
      expect(imports, file).toEqual(['import type { DB } from "./open.js";']);
    }
  });

  it("open.ts still exports settlementsTable, the one in migrate.ts", () => {
    expect(settlementsTableFromOpen).toBe(settlementsTable);
  });
});
