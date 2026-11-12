// Where a filed document's bytes are kept. On a runner that is the payables folder (<dir>/docs/<sha256>.pdf, written
// once, read-only), and nothing changes there. A ledger that has no folder (the engine in a Durable Object) names its
// own store here, per ledger handle; the inbox, the payment, the recheck, the invoice's detail, the vault and the cloud
// sync then ask it. The value a store returns from put() is what ap_documents.path keeps, and get() takes it back.
import { readFileSync } from "node:fs";
import type { DB } from "../db/open.js";

export interface DocStore {
  /** Keeps the bytes under their hash, once, and returns where they are (kept in ap_documents.path). */
  put(sha256: string, bytes: Uint8Array): string;
  /** The bytes kept at a path put() returned. */
  get(path: string): Buffer;
}

const stores = new WeakMap<object, DocStore>();

/** Names the store of one ledger. Without one, documents are files in the payables folder, as before. */
export function useDocStore(db: DB, store: DocStore): void {
  stores.set(db, store);
}

export function docStoreOf(db: DB): DocStore | undefined {
  return stores.get(db);
}

/** A filed document's bytes: from the ledger's own store, else the file its path names. */
export function readDoc(db: DB, path: string): Buffer {
  const store = stores.get(db);
  return store ? store.get(path) : readFileSync(path);
}
