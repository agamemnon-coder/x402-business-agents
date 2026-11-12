// A company's filed documents inside its Durable Object's own SQLite (the engine's document store seam,
// src/ap/docStore.ts): a row has a size limit and an invoice may be 15 MB, so a document is kept in pieces of 1 MB,
// under its hash, once. What put() returns ("do:<sha256>") is what ap_documents.path keeps, and get() takes it back.
import type { DocStore } from "../../../src/ap/docStore.js";
import type { DoStorage } from "../../../src/db/doSql.js";

export const DOC_CHUNK_BYTES = 1024 * 1024;
const PREFIX = "do:";

export function docChunks(storage: Pick<DoStorage, "sql">, chunkBytes: number = DOC_CHUNK_BYTES): DocStore {
  const { sql } = storage;
  sql.exec("CREATE TABLE IF NOT EXISTS do_doc_chunks (sha256 TEXT NOT NULL, n INTEGER NOT NULL, bytes BLOB NOT NULL, PRIMARY KEY (sha256, n)) WITHOUT ROWID");
  return {
    put(sha256, bytes) {
      const kept = sql.exec("SELECT COUNT(*) AS n FROM do_doc_chunks WHERE sha256 = ?", sha256).toArray()[0]!.n as number;
      if (!kept) {
        // Each piece as an ArrayBuffer of its own (what the object's SQLite binds as a BLOB), whatever view the bytes came in.
        let n = 0;
        do {
          const piece = bytes.subarray(n * chunkBytes, (n + 1) * chunkBytes);
          sql.exec("INSERT INTO do_doc_chunks (sha256, n, bytes) VALUES (?, ?, ?)", sha256, n, new Uint8Array(piece).buffer);
          n++;
        } while (n * chunkBytes < bytes.byteLength);
      }
      return `${PREFIX}${sha256}`;
    },
    get(path) {
      const pieces = path.startsWith(PREFIX) ? sql.exec("SELECT bytes FROM do_doc_chunks WHERE sha256 = ? ORDER BY n", path.slice(PREFIX.length)).toArray() : [];
      if (!pieces.length) throw new Error(`no document at ${path}`);
      return Buffer.concat(pieces.map((r) => Buffer.from(r.bytes as ArrayBuffer)));
    },
  };
}
