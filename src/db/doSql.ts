// The subset of the better-sqlite3 handle the engine uses, on top of a Durable Object's SQLite (ctx.storage.sql.exec
// and ctx.storage.transactionSync, both synchronous). The engine's modules call their ledger through
// db.prepare(sql).get/all/run, db.exec, db.transaction(fn) with .immediate, db.pragma, db.close and db.name. (Three
// record-making CLIs also call db.backup(); they run on Node only.) Nothing here imports from Node: the type of the
// engine's handle is the only thing taken from ./open.ts. What SqlStorage lacks, and the bridge:
//
//   prepared statements          none: exec(sql, ...values) only. prepare() keeps the SQL and its scanned parameters.
//   named parameters (@a, :a)    values are positional only. The SQL is scanned for its parameters, in SQLite's own
//                                numbering, and a named-parameter object is laid out in that order.
//   run().changes, .lastInsertRowid   not on the cursor (rowsWritten counts index rows too). One more statement after
//                                each run: SELECT changes(), total_changes(), last_insert_rowid().
//   BEGIN / COMMIT / SAVEPOINT   refused by SqlStorage. transaction(fn) runs fn in ctx.storage.transactionSync, which
//                                nests (a nested transaction that throws rolls back only its own part, as a savepoint).
//   PRAGMA journal_mode, busy_timeout   refused (not authorized), and without meaning in a Durable Object: answered here.
//   BLOB values                  come back as ArrayBuffer; handed on as Buffer, as better-sqlite3 does.
//   booleans, dates as values    SqlStorage stores true as the text "true"; better-sqlite3 throws. Thrown here too.
//   errors                       "<message>: SQLITE_X (extended: SQLITE_X_Y)"; rethrown as better-sqlite3 words them,
//                                with .code, so a message kept in the audit log is the same text in both runtimes.
//
// Numbers need no bridge: both bind every JavaScript number as a REAL (measured: typeof(?) is 'real' for 5 in both).

import type { DB } from "./open.js";

/** The part of a Durable Object's storage this needs (ctx.storage). */
export interface DoStorage {
  sql: { exec(query: string, ...bindings: unknown[]): DoCursor };
  transactionSync<T>(closure: () => T): T;
}

export interface DoCursor extends Iterable<Record<string, unknown>> {
  toArray(): Record<string, unknown>[];
  raw(): Iterable<unknown[]> & { toArray(): unknown[][] };
  readonly columnNames: string[];
  readonly rowsRead: number;
  readonly rowsWritten: number;
}

export interface RunResult { changes: number; lastInsertRowid: number }

/** What better-sqlite3 throws for an SQLite error: the message as SQLite gave it, and its (extended) result code. */
export class SqliteError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = "SqliteError";
  }
}

interface Scanned {
  /** One entry per SQLite parameter index: null for an anonymous `?`, the name for @name, :name or $name. */
  slots: (string | null)[];
  statements: number;
  /** The first keyword of the first statement, upper case. */
  head: string;
  returning: boolean;
  /** Where the last token ends: what follows is white space and comments, which SqlStorage takes for an empty statement. */
  end: number;
}

const IDENT_START = /[A-Za-z_\u0080-\uffff]/;
const IDENT = /[A-Za-z0-9_$\u0080-\uffff]/;

/** Reads the SQL once: its parameters in SQLite's numbering, how many statements it holds, and whether it returns rows. */
export function scanSql(sql: string): Scanned {
  const slots: (string | null)[] = [];
  const seen = new Set<string>();
  let statements = 0, open = false, head = "", returning = false, end = 0;
  // A trigger's body holds statements of its own: CREATE TRIGGER ... BEGIN ...; ...; END is one statement.
  let words: string[] = [], trigger = false, depth = 0;
  const n = sql.length;
  let i = 0;
  const skipQuoted = (q: string) => {
    i++;
    while (i < n) {
      if (sql[i] === q) { if (sql[i + 1] === q) { i += 2; continue; } i++; return; }
      i++;
    }
  };
  while (i < n) {
    const c = sql[i]!;
    if (c === " " || c === "\n" || c === "\t" || c === "\r" || c === "\f") { i++; continue; }
    if (c === "-" && sql[i + 1] === "-") { while (i < n && sql[i] !== "\n") i++; continue; }
    if (c === "/" && sql[i + 1] === "*") { const end = sql.indexOf("*/", i + 2); i = end < 0 ? n : end + 2; continue; }
    if (c === ";") { if (depth <= 0) { open = false; words = []; trigger = false; depth = 0; } i++; end = i; continue; }
    if (!open) { open = true; statements++; }
    if (c === "'" || c === '"' || c === "`") { skipQuoted(c); end = i; continue; }
    if (c === "[") { const close = sql.indexOf("]", i + 1); i = close < 0 ? n : close + 1; end = i; continue; }
    if (c === "?") {
      i++;
      let digits = "";
      while (i < n && sql[i]! >= "0" && sql[i]! <= "9") digits += sql[i++];
      if (digits) { const at = Number(digits); while (slots.length < at) slots.push(null); } else slots.push(null);
      end = i;
      continue;
    }
    if ((c === "@" || c === ":" || c === "$") && i + 1 < n && IDENT_START.test(sql[i + 1]!)) {
      let j = i + 1;
      while (j < n && IDENT.test(sql[j]!)) j++;
      const name = sql.slice(i + 1, j);
      if (!seen.has(name)) { seen.add(name); slots.push(name); }
      i = j;
      end = i;
      continue;
    }
    if (IDENT_START.test(c)) {
      let j = i + 1;
      while (j < n && IDENT.test(sql[j]!)) j++;
      const word = sql.slice(i, j).toUpperCase();
      if (words.length < 4) words.push(word);
      if (statements === 1 && words.length === 1) head = word;
      if (word === "RETURNING") returning = true;
      if (!trigger && word === "TRIGGER" && words[0] === "CREATE") trigger = true;
      if (trigger) { if (word === "BEGIN" || word === "CASE") depth++; else if (word === "END") depth--; }
      i = j;
      end = i;
      continue;
    }
    if (c >= "0" && c <= "9") { while (i < n && /[0-9A-Za-z_.]/.test(sql[i]!)) i++; end = i; continue; }
    i++;
    end = i;
  }
  return { slots, statements, head, returning, end };
}

/** Statements that return no rows unless they say RETURNING. Anything else is run and SQLite decides (a typo included). */
const WRITER_HEADS = new Set(["INSERT", "UPDATE", "DELETE", "REPLACE", "CREATE", "DROP", "ALTER", "REINDEX", "ANALYZE"]);
/** Statements that cannot change a row: after them the change counter is known without asking. */
const PURE_READ_HEADS = new Set(["SELECT", "VALUES", "EXPLAIN"]);

const BIND_TYPES = "SQLite3 can only bind numbers, strings, bigints, buffers, and null";

function bindValue(v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (typeof v === "number" || typeof v === "string") return v;
  if (typeof v === "bigint") {
    // better-sqlite3 binds a bigint as INTEGER; SqlStorage has no integer binding. Nothing in the engine binds one.
    throw new TypeError("a bigint cannot be bound in a Durable Object's SQLite (no integer binding); the engine binds none");
  }
  if (v instanceof ArrayBuffer) return v;
  if (ArrayBuffer.isView(v)) return v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength);
  throw new TypeError(BIND_TYPES);
}

const isPlain = (v: unknown): v is Record<string, unknown> => {
  if (typeof v !== "object" || v === null || v instanceof ArrayBuffer || ArrayBuffer.isView(v)) return false;
  const proto = Object.getPrototypeOf(v) as unknown;
  return proto === Object.prototype || proto === null;
};

/** Lays the caller's values out by SQLite parameter index, with better-sqlite3's rules and its errors. */
function layout(slots: (string | null)[], args: unknown[]): unknown[] {
  const positional: unknown[] = [];
  let named: Record<string, unknown> | undefined;
  for (const a of args) {
    if (Array.isArray(a)) positional.push(...(a as unknown[]));
    else if (isPlain(a)) {
      if (named) throw new TypeError("You cannot specify named parameters in two different objects");
      named = a;
    } else positional.push(a);
  }
  const out: unknown[] = [];
  let next = 0;
  for (const slot of slots) {
    if (slot === null) {
      if (next >= positional.length) throw new RangeError("Too few parameter values were provided");
      out.push(bindValue(positional[next++]));
    } else {
      if (!named || !(slot in named)) throw new RangeError(`Missing named parameter "${slot}"`);
      out.push(bindValue(named[slot]));
    }
  }
  if (next < positional.length) throw new RangeError("Too many parameter values were provided");
  return out;
}

const SQLITE_SUFFIX = /^([\s\S]*?): (SQLITE_[A-Z0-9_]+)(?: \(extended: (SQLITE_[A-Z0-9_]+)\))?$/;
const AT_OFFSET = / at offset \d+$/;

/** SqlStorage's "<message>: SQLITE_X (extended: SQLITE_X_Y)" as better-sqlite3 throws it; anything else unchanged. */
export function asSqliteError(e: unknown): unknown {
  const m = e instanceof Error ? SQLITE_SUFFIX.exec(e.message) : null;
  if (!m) return e;
  return new SqliteError(m[1]!.replace(AT_OFFSET, ""), m[3] ?? m[2]!);
}

const toBuffers = (row: Record<string, unknown>): Record<string, unknown> => {
  for (const k in row) if (row[k] instanceof ArrayBuffer) row[k] = Buffer.from(row[k] as ArrayBuffer);
  return row;
};

export interface DoStats {
  /** Statements the engine asked for. */
  statements: number;
  /** Statements this shim added (the change counter after each run). */
  added: number;
  rowsRead: number;
  rowsWritten: number;
  transactions: number;
  /** Wall time inside SqlStorage, in ms (Date.now() only advances after I/O in workerd, so this is 0 in production). */
  perStatement: Map<string, number> | null;
}

export class DoStatement {
  readonly reader: boolean;
  private readonly sql: string;
  private mode: "object" | "pluck" | "raw" = "object";

  constructor(private readonly db: DoDatabase, readonly source: string, private readonly scanned: Scanned) {
    this.reader = !WRITER_HEADS.has(scanned.head) || scanned.returning;
    // SqlStorage takes a comment after the last ";" for one more, empty, statement and refuses it.
    this.sql = scanned.end < source.length ? source.slice(0, scanned.end) : source;
  }

  pluck(on = true): this { this.mode = on ? "pluck" : "object"; return this; }
  raw(on = true): this { this.mode = on ? "raw" : "object"; return this; }

  run(...args: unknown[]): RunResult {
    const bindings = layout(this.scanned.slots, args);
    const before = this.db.totalBefore();
    const cursor = this.db.execute(this.sql, bindings);
    // A statement with RETURNING does its work as its rows are read.
    if (cursor.columnNames.length > 0) cursor.toArray();
    this.db.count(cursor, this.source);
    return this.db.changed(before);
  }

  get(...args: unknown[]): unknown {
    if (!this.reader) throw new TypeError("This statement does not return data. Use run() instead");
    const cursor = this.db.execute(this.sql, layout(this.scanned.slots, args));
    let first: unknown;
    if (this.mode === "object") {
      // Only the first row is asked for; the cursor is closed by leaving the loop (its return()).
      for (const row of cursor) { first = toBuffers(row); break; }
    } else {
      for (const row of cursor.raw()) { first = this.mode === "pluck" ? row[0] : row; break; }
    }
    this.db.count(cursor, this.source);
    this.db.afterRead(this.scanned.head);
    return first;
  }

  all(...args: unknown[]): unknown[] {
    if (!this.reader) throw new TypeError("This statement does not return data. Use run() instead");
    const cursor = this.db.execute(this.sql, layout(this.scanned.slots, args));
    const rows = this.mode === "object" ? cursor.toArray().map(toBuffers) : cursor.raw().toArray().map((r) => (this.mode === "pluck" ? r[0] : r));
    this.db.count(cursor, this.source);
    this.db.afterRead(this.scanned.head);
    return rows;
  }

  *iterate(...args: unknown[]): IterableIterator<unknown> {
    // Read in full first: a cursor left open across the caller's own statements is not something SqlStorage promises.
    yield* this.all(...args);
  }
}

type TxFn<A extends unknown[], R> = ((...args: A) => R) & { default: (...args: A) => R; deferred: (...args: A) => R; immediate: (...args: A) => R; exclusive: (...args: A) => R };

/** The better-sqlite3 handle, as far as the engine uses it, over one Durable Object's SQLite. */
export class DoDatabase {
  readonly open = true;
  readonly memory = false;
  readonly readonly = false;
  readonly stats: DoStats = { statements: 0, added: 0, rowsRead: 0, rowsWritten: 0, transactions: 0, perStatement: null };
  private depth = 0;
  private readonly scans = new Map<string, Scanned>();
  /** SQLite's total change counter after the last statement that could have moved it; null: not known. */
  private total: number | null = null;

  constructor(private readonly storage: DoStorage, readonly name = "durable-object") {}

  get inTransaction(): boolean { return this.depth > 0; }

  prepare(sql: string): DoStatement {
    let scanned = this.scans.get(sql);
    if (!scanned) {
      scanned = scanSql(sql);
      if (scanned.statements > 1) throw new RangeError("The supplied SQL string contains more than one statement");
      if (scanned.statements === 0) throw new RangeError("The supplied SQL string contains no statements");
      if (this.scans.size >= 4096) this.scans.clear();
      this.scans.set(sql, scanned);
    }
    return new DoStatement(this, sql, scanned);
  }

  exec(sql: string): this {
    const { end, statements } = scanSql(sql);
    if (statements === 0) return this;
    const cursor = this.execute(end < sql.length ? sql.slice(0, end) : sql, []);
    if (cursor.columnNames.length > 0) cursor.toArray();
    this.count(cursor, sql);
    this.total = null;
    return this;
  }

  /**
   * better-sqlite3's transaction(fn): the returned function runs fn in a transaction, and inside another one as a
   * savepoint; a throw rolls its own part back and is thrown on. deferred, immediate and exclusive are the same thing
   * here: a Durable Object has one writer, so there is no lock to take early.
   */
  transaction<A extends unknown[], R>(fn: (...args: A) => R): TxFn<A, R> {
    const run = (...args: A): R => {
      this.stats.transactions++;
      this.depth++;
      try {
        return this.storage.transactionSync(() => {
          const out = fn(...args);
          if (out && typeof (out as { then?: unknown }).then === "function") throw new TypeError("Transaction function cannot return a promise");
          return out;
        });
      } catch (e) {
        // A rollback may have undone changes: the counter is asked for again.
        this.total = null;
        throw e;
      } finally {
        this.depth--;
      }
    };
    return Object.assign(run, { default: run, deferred: run, immediate: run, exclusive: run });
  }

  pragma(source: string, options: { simple?: boolean } = {}): unknown {
    const text = source.trim();
    const assign = /^([a-z_]+)\s*=\s*(.+)$/i.exec(text);
    const name = (assign ? assign[1]! : text.replace(/\(.*$/, "")).toLowerCase();
    let rows: Record<string, unknown>[];
    // Refused by SqlStorage and without meaning here: one writer, and the platform keeps its own write-ahead log.
    if (name === "journal_mode") rows = [{ journal_mode: "wal" }];
    else if (name === "busy_timeout") rows = [{ timeout: assign ? Number(assign[2]) : 0 }];
    else {
      const cursor = this.execute(`PRAGMA ${text}`, []);
      rows = cursor.toArray();
      this.count(cursor, `PRAGMA ${text}`);
    }
    if (!options.simple) return rows;
    const first = rows[0];
    return first ? Object.values(first)[0] : undefined;
  }

  close(): this { return this; }

  // What the statements share.

  /** @internal */
  execute(sql: string, bindings: unknown[]): DoCursor {
    this.stats.statements++;
    try {
      return this.storage.sql.exec(sql, ...bindings);
    } catch (e) {
      throw asSqliteError(e);
    }
  }

  /** @internal */
  count(cursor: DoCursor, sql: string): void {
    this.stats.rowsRead += cursor.rowsRead;
    this.stats.rowsWritten += cursor.rowsWritten;
    if (this.stats.perStatement) this.stats.perStatement.set(sql, (this.stats.perStatement.get(sql) ?? 0) + 1);
  }

  /** @internal A reader that may have written (INSERT ... RETURNING, WITH ... INSERT, PRAGMA): the counter is not known. */
  afterRead(head: string): void {
    if (!PURE_READ_HEADS.has(head)) this.total = null;
  }

  /** @internal SQLite's total change counter before a run: remembered from the last statement, or asked for. */
  totalBefore(): number {
    if (this.total === null) {
      this.stats.added++;
      this.total = (this.storage.sql.exec("SELECT total_changes() AS t").toArray()[0] as { t: number }).t;
    }
    return this.total;
  }

  /**
   * @internal better-sqlite3's run() result: changes is SQLite's count for the statement just run, or 0 when it changed
   * nothing at all (a SELECT, a CREATE TABLE), which it tells by the total counter standing still.
   */
  changed(before: number): RunResult {
    this.stats.added++;
    const row = this.storage.sql.exec("SELECT changes() AS c, total_changes() AS t, last_insert_rowid() AS r").toArray()[0] as { c: number; t: number; r: number };
    this.total = row.t;
    return { changes: row.t === before ? 0 : row.c, lastInsertRowid: row.r };
  }
}

/**
 * The engine's handle over one Durable Object's SQLite. The engine's modules take `DB`, better-sqlite3's own type;
 * DoDatabase has the part of it they call (the list at the top of this file; test/support/dbConformance.ts holds both
 * to the same answers). This is the one place where the one is handed out as the other.
 */
export function doDb(storage: DoStorage, name?: string): DB {
  return new DoDatabase(storage, name) as unknown as DB;
}
