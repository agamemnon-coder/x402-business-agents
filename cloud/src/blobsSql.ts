// The cloud's document store in its own database, for a deployment without R2 (the Worker uses it when the DOCS binding
// is absent: cloud/src/worker.ts, cloud/src/engine/hostWorker.ts). The same Blobs interface as R2 and the test
// directory (./store.ts), so nothing above it knows the difference.
//
// D1 keeps one value up to about 2 MB and Sql binds text, numbers and null, so a document is kept as base64 text in
// parts of BLOB_PART_BYTES (800,000 characters each), and an invoice of 15 MB is 26 parts. A document exists when its
// header row exists, and the header is written after its last part: a put that fails half way leaves no document to
// read or list (its stray parts are cleared by the next put or delete of that key). Keys are the cloud's own,
// prefixed t/<tenant>/ as in R2; the tables are made here, on first use, like the cloud's schema (CREATE ... IF NOT EXISTS).
import type { Blobs, Sql } from "./store.js";

/** Raw bytes per part: 600,000 bytes are 800,000 base64 characters, well under D1's limit on one value. */
export const BLOB_PART_BYTES = 600_000;

const SCHEMA = [
  "CREATE TABLE IF NOT EXISTS cloud_blobs (key TEXT PRIMARY KEY, parts INTEGER NOT NULL, bytes INTEGER NOT NULL, meta TEXT)",
  "CREATE TABLE IF NOT EXISTS cloud_blob_parts (key TEXT NOT NULL, n INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY (key, n))",
];

const ready = new WeakMap<Sql, Promise<void>>();
function tables(sql: Sql): Promise<void> {
  let p = ready.get(sql);
  if (!p) {
    p = (async () => { for (const s of SCHEMA) await sql.run(s); })().catch((e: unknown) => { ready.delete(sql); throw e; });
    ready.set(sql, p);
  }
  return p;
}

function toBase64(u: Uint8Array): string {
  let s = "";
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function sqlBlobs(sql: Sql): Blobs {
  const header = async (key: string) => sql.first<{ parts: number; bytes: number }>("SELECT parts, bytes FROM cloud_blobs WHERE key = ?", [key]);
  const remove = async (key: string) => {
    await sql.run("DELETE FROM cloud_blobs WHERE key = ?", [key]);
    await sql.run("DELETE FROM cloud_blob_parts WHERE key = ?", [key]);
  };
  return {
    async put(key, bytes, meta) {
      await tables(sql);
      await remove(key);
      const parts = Math.max(1, Math.ceil(bytes.byteLength / BLOB_PART_BYTES));
      for (let n = 0; n < parts; n++) {
        const piece = bytes.subarray(n * BLOB_PART_BYTES, (n + 1) * BLOB_PART_BYTES);
        await sql.run("INSERT INTO cloud_blob_parts (key, n, data) VALUES (?, ?, ?)", [key, n, toBase64(piece)]);
      }
      await sql.run("INSERT INTO cloud_blobs (key, parts, bytes, meta) VALUES (?, ?, ?, ?)", [key, parts, bytes.byteLength, meta ? JSON.stringify(meta) : null]);
    },
    async get(key) {
      await tables(sql);
      const h = await header(key);
      if (!h) return null;
      const rows = await sql.all<{ n: number; data: string }>("SELECT n, data FROM cloud_blob_parts WHERE key = ? ORDER BY n", [key]);
      const pieces = rows.map((r) => fromBase64(r.data));
      const total = pieces.reduce((a, p) => a + p.byteLength, 0);
      if (rows.length !== h.parts || total !== h.bytes) throw new Error(`the document at ${key} is incomplete in the database`);
      const out = new Uint8Array(total);
      let at = 0;
      for (const p of pieces) { out.set(p, at); at += p.byteLength; }
      return out;
    },
    async delete(key) {
      await tables(sql);
      await remove(key);
    },
    async has(key) {
      await tables(sql);
      return (await header(key)) !== null;
    },
    async list(prefix) {
      await tables(sql);
      // substr counts characters, as Array.from does; LIKE would read % and _ in a prefix as patterns.
      const rows = await sql.all<{ key: string }>("SELECT key FROM cloud_blobs WHERE substr(key, 1, ?) = ? ORDER BY key", [Array.from(prefix).length, prefix]);
      return rows.map((r) => r.key);
    },
  };
}
