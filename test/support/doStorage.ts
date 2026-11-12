// A stand-in for a Durable Object's ctx.storage over better-sqlite3, for the plain Node run. It answers as SqlStorage
// does where the Durable Object handle (src/db/doSql.ts) depends on it:
//   - exec(sql, ...values) with a cursor; values go in by position, whatever a parameter is called (@a, :a, $a too);
//   - BLOBs come back as ArrayBuffer;
//   - an SQLite error is worded "<message>: SQLITE_X (extended: SQLITE_X_Y)";
//   - BEGIN, COMMIT, ROLLBACK, SAVEPOINT and RELEASE are refused ("not authorized");
//   - transactionSync(closure) nests, as savepoints.
// It is a stand-in, not SqlStorage: the same checks run against a real Durable Object in workerd in
// test/db-do-sql-workerd.test.ts (npm run test:d1).
import type Database from "better-sqlite3";
import { scanSql, type DoCursor, type DoStorage } from "../../src/db/doSql.js";

const REFUSED = /^\s*(BEGIN|COMMIT|END|ROLLBACK|SAVEPOINT|RELEASE)\b/i;
const out = (v: unknown): unknown => (Buffer.isBuffer(v) ? v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength) : v);
const into = (v: unknown): unknown => (v instanceof ArrayBuffer ? Buffer.from(v) : v);

function asStorageError(e: unknown): unknown {
  const x = e as { code?: unknown; message?: string } | null;
  if (!x || typeof x.code !== "string" || !x.code.startsWith("SQLITE_")) return e;
  const parts = x.code.split("_");
  const primary = parts.slice(0, 2).join("_");
  return new Error(`${x.message}: ${primary}${parts.length > 2 ? ` (extended: ${x.code})` : ""}`);
}

function cursor(columns: string[], rows: unknown[][]): DoCursor {
  const objects = () => rows.map((r) => Object.fromEntries(columns.map((c, i) => [c, r[i]])));
  return {
    columnNames: columns,
    rowsRead: rows.length,
    rowsWritten: 0,
    toArray: objects,
    raw: () => Object.assign(rows[Symbol.iterator](), { toArray: () => rows }),
    [Symbol.iterator]: () => objects()[Symbol.iterator](),
  };
}

export function sqliteDoStorage(db: Database.Database): DoStorage {
  let depth = 0;
  return {
    sql: {
      exec(query: string, ...bindings: unknown[]): DoCursor {
        if (REFUSED.test(query)) throw new Error("not authorized: SQLITE_AUTH");
        try {
          let st: Database.Statement;
          try { st = db.prepare(query); } catch (e) {
            // SqlStorage runs several statements in one exec; better-sqlite3 prepares one at a time.
            if (/more than one statement/.test((e as Error).message) && bindings.length === 0) { db.exec(query); return cursor([], []); }
            throw e;
          }
          // SqlStorage binds by position whatever a parameter is called; better-sqlite3 wants a named one by name.
          const positional: unknown[] = [], named: Record<string, unknown> = {};
          scanSql(query).slots.forEach((slot, i) => { if (slot === null) positional.push(into(bindings[i])); else named[slot] = into(bindings[i]); });
          const args = Object.keys(named).length ? [...positional, named] : positional;
          if (st.reader) {
            const columns = st.columns().map((c) => c.name);
            const rows = (st.raw().all(...args) as unknown[][]).map((r) => r.map(out));
            return cursor(columns, rows);
          }
          st.run(...args);
          return cursor([], []);
        } catch (e) { throw asStorageError(e); }
      },
    },
    transactionSync<T>(closure: () => T): T {
      const name = `do_tx_${depth++}`;
      db.exec(`SAVEPOINT ${name}`);
      try {
        const r = closure();
        db.exec(`RELEASE ${name}`);
        return r;
      } catch (e) {
        db.exec(`ROLLBACK TO ${name}`);
        db.exec(`RELEASE ${name}`);
        throw e;
      } finally { depth--; }
    },
  };
}
