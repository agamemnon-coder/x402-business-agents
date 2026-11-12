// Purser Cloud's storage, behind two small interfaces: Sql (D1 in the Worker, better-sqlite3 in tests and local runs)
// and Blobs (R2 in the Worker, a directory in tests). Nothing above this file knows which one it talks to.

export type SqlValue = string | number | null;

export interface Sql {
  all<T = Record<string, SqlValue>>(sql: string, params?: SqlValue[]): Promise<T[]>;
  first<T = Record<string, SqlValue>>(sql: string, params?: SqlValue[]): Promise<T | null>;
  run(sql: string, params?: SqlValue[]): Promise<{ changes: number }>;
  /** Several statements as one transaction: all apply or none. */
  batch(statements: { sql: string; params?: SqlValue[] }[]): Promise<void>;
  /** Runs a schema script (several statements separated by ";"). */
  exec(script: string): Promise<void>;
}

export interface Blobs {
  put(key: string, bytes: Uint8Array, meta?: Record<string, string>): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  delete(key: string): Promise<void>;
  list(prefix: string): Promise<string[]>;
  /** Whether bytes are stored under the key (without reading them). */
  has?(key: string): Promise<boolean>;
}

// The parts of Cloudflare's D1 and R2 bindings used here, typed locally so the repo needs no Workers type package.
interface D1Stmt { bind(...v: SqlValue[]): D1Stmt; all<T>(): Promise<{ results: T[] }>; first<T>(): Promise<T | null>; run(): Promise<{ meta: { changes: number } }> }
export interface D1Like { prepare(sql: string): D1Stmt; batch(s: D1Stmt[]): Promise<unknown>; exec(sql: string): Promise<unknown> }
export interface R2Like {
  put(key: string, value: Uint8Array, opts?: { customMetadata?: Record<string, string> }): Promise<unknown>;
  get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>;
  head(key: string): Promise<unknown>;
  delete(key: string): Promise<void>;
  list(opts: { prefix: string; cursor?: string }): Promise<{ objects: { key: string }[]; truncated: boolean; cursor?: string }>;
}

/**
 * One wrapper per D1 binding (speed, 12 Nov). The Worker builds its env on every request; a new wrapper each time made
 * every "once per database per isolate" cache keyed on it (the schema, the metrics, the blobs and counters tables) miss,
 * so each request ran the schema's 40 statements against D1 again, one round trip each: about 1.5 s a request next to the
 * database, and about 6 s from across the ocean.
 */
const wrappers = new WeakMap<D1Like, Sql>();

export function d1Sql(db: D1Like): Sql {
  const had = wrappers.get(db);
  if (had) return had;
  const made = makeD1Sql(db);
  wrappers.set(db, made);
  return made;
}

function makeD1Sql(db: D1Like): Sql {
  const stmt = (sql: string, params: SqlValue[] = []) => db.prepare(sql).bind(...params);
  return {
    all: async <T>(sql: string, params?: SqlValue[]) => (await stmt(sql, params).all<T>()).results,
    first: <T>(sql: string, params?: SqlValue[]) => stmt(sql, params).first<T>(),
    run: async (sql, params) => ({ changes: (await stmt(sql, params).run()).meta.changes }),
    batch: async (s) => { await db.batch(s.map((x) => stmt(x.sql, x.params))); },
    exec: async (script) => { for (const part of splitScript(script)) await db.prepare(part).run(); },
  };
}

export function r2Blobs(bucket: R2Like): Blobs {
  return {
    put: async (key, bytes, meta) => { await bucket.put(key, bytes, meta ? { customMetadata: meta } : undefined); },
    get: async (key) => { const o = await bucket.get(key); return o ? new Uint8Array(await o.arrayBuffer()) : null; },
    delete: (key) => bucket.delete(key),
    has: async (key) => (await bucket.head(key)) !== null,
    list: async (prefix) => {
      const out: string[] = [];
      let cursor: string | undefined;
      do {
        const page = await bucket.list({ prefix, ...(cursor ? { cursor } : {}) });
        out.push(...page.objects.map((o) => o.key));
        cursor = page.truncated ? page.cursor : undefined;
      } while (cursor);
      return out;
    },
  };
}

/** A schema script's statements, comments dropped (D1 runs one statement per prepare). */
export function splitScript(script: string): string[] {
  return script.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n").split(";").map((s) => s.trim()).filter(Boolean);
}
