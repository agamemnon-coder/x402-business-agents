// The same storage on Node: better-sqlite3 for Sql and a directory for Blobs. Used by the tests and for running the
// cloud API locally (never imported by the Worker's entry point).

import Database from "better-sqlite3";
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import type { Blobs, Sql } from "./store.js";

export function sqliteSql(path = ":memory:"): Sql & { close(): void } {
  const db = new Database(path);
  db.pragma("foreign_keys = ON");
  return {
    all: async <T>(sql: string, params: (string | number | null)[] = []) => db.prepare(sql).all(...params) as T[],
    first: async <T>(sql: string, params: (string | number | null)[] = []) => (db.prepare(sql).get(...params) as T | undefined) ?? null,
    run: async (sql, params = []) => ({ changes: db.prepare(sql).run(...params).changes }),
    batch: async (s) => { db.transaction(() => { for (const x of s) db.prepare(x.sql).run(...(x.params ?? [])); })(); },
    exec: async (script) => { db.exec(script); },
    close: () => db.close(),
  };
}

export function dirBlobs(root: string): Blobs {
  // Keys are content-addressed paths Purser makes itself; anything that could leave the root is refused.
  const at = (key: string) => {
    if (!/^[a-z0-9][a-z0-9/._-]*$/i.test(key) || key.includes("..")) throw new Error(`bad blob key ${key}`);
    return join(root, key);
  };
  const walk = (dir: string): string[] => existsSync(dir) ? readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [relative(root, p)];
  }) : [];
  return {
    put: async (key, bytes) => { const p = at(key); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, bytes); },
    get: async (key) => { const p = at(key); return existsSync(p) ? new Uint8Array(readFileSync(p)) : null; },
    delete: async (key) => { rmSync(at(key), { force: true }); },
    has: async (key) => existsSync(at(key)),
    list: async (prefix) => walk(root).filter((k) => k.startsWith(prefix)).sort(),
  };
}
