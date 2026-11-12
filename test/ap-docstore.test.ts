// Where a filed document's bytes are kept (src/ap/docStore.ts). A host that has no folder hands the ledger a store of
// its own: the inbox then writes no file, ap_documents.path keeps what the store's put() returned, and every reader
// of a filed document (the payment, the recheck, the invoice's detail, the cloud sync, the vault) asks the store.
// With no store handed in, documents are files in the payables folder, as before.
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { seedTreasury } from "../src/agents/euroBill.js";
import { invoiceDetail } from "../src/ap/detail.js";
import { docStoreOf, readDoc, useDocStore, type DocStore } from "../src/ap/docStore.js";
import { ingestDocument, recheck, type InboxDeps } from "../src/ap/inbox.js";
import { ensureCoded } from "../src/ap/coderAgent.js";
import { payApInvoice } from "../src/ap/pay.js";
import type { Asker } from "../src/ap/read.js";
import { apInvoice } from "../src/ap/store.js";
import { batchesFor } from "../src/cloudsync/client.js";
import { openDb, type DB } from "../src/db/open.js";
import { syncVault } from "../src/vault/build.js";
import { LocalSink } from "../src/vault/sink.js";
import { EN } from "./fakes/apInvoices.js";
import { FakeAirwallex } from "./fakes/airwallex.js";
import { pdfOf } from "./fakes/pdf.js";

const now = new Date();
const parserOnly: Asker = { ask: async (_a, fallback) => ({ value: fallback(), source: "fallback", model: null, note: "no key" }) } as Asker;
const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const NOTHING_HELD = { audit: { seq: 0, hash: null }, ledger: { entry_id: 0, hash: null }, documents: [] };

/** A store in memory: the bytes under a name no file has, and every read counted. */
class MemStore implements DocStore {
  readonly kept = new Map<string, Buffer>();
  readonly reads: string[] = [];
  put(sha: string, bytes: Uint8Array): string {
    const path = `mem:${sha}`;
    if (!this.kept.has(path)) this.kept.set(path, Buffer.from(bytes));
    return path;
  }
  get(path: string): Buffer {
    this.reads.push(path);
    const b = this.kept.get(path);
    if (!b) throw new Error(`no document at ${path}`);
    return b;
  }
}

let dir: string;
let db: DB;
let awx: FakeAirwallex;
let deps: InboxDeps;
let bytes: Buffer;
beforeEach(async () => {
  dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "ap-docstore-"));
  db = openDb(":memory:");
  awx = new FakeAirwallex();
  await seedTreasury(db, awx, awx);
  deps = { dir, reader: parserOnly, now: () => now };
  bytes = await pdfOf(EN);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const add = async () => {
  const out = await ingestDocument(db, deps, { bytes, filename: "bergtex.pdf", source: "upload" });
  if (out.kind !== "invoice") throw new Error(out.kind);
  return out.invoice.id;
};
const pathOf = (id: string) => (db.prepare("SELECT d.path FROM ap_documents d JOIN ap_invoices i ON i.doc_sha256 = d.sha256 WHERE i.id = ?").get(id) as { path: string }).path;

describe("a ledger with its own document store", () => {
  let store: MemStore;
  beforeEach(() => {
    store = new MemStore();
    useDocStore(db, store);
  });

  it("the inbox writes no file: the store keeps the bytes and ap_documents.path is what put() returned", async () => {
    const id = await add();
    const name = `mem:${sha256(bytes)}`;
    expect(existsSync(join(dir, "docs"))).toBe(false);
    expect(pathOf(id)).toBe(name);
    expect(Buffer.compare(store.kept.get(name)!, bytes)).toBe(0);
    expect(apInvoice(db, id)!.status).toBe("ready");
    expect(docStoreOf(db)).toBe(store);
    expect(Buffer.compare(readDoc(db, name), bytes)).toBe(0);
  });

  it("the same file again is a duplicate and is kept once", async () => {
    await add();
    const again = await ingestDocument(db, deps, { bytes, filename: "copy.pdf", source: "upload" });
    expect(again.kind).toBe("duplicate_document");
    expect(store.kept.size).toBe(1);
  });

  it("paying an invoice reads its document from the store", async () => {
    const id = await add();
    const out = await payApInvoice(db, awx, id, now);
    if (out.kind !== "proposed") throw new Error(out.reason);
    expect(apInvoice(db, id)!.status).toBe("waiting_cfo");
    expect(store.reads).toContain(pathOf(id));
  });

  it("a recheck reads the document from the store and checks it again", async () => {
    const id = await add();
    // A person's hold that the checks themselves do not give: only a recheck that really read the text lifts it.
    db.prepare("UPDATE ap_invoices SET status = 'needs_review' WHERE id = ?").run(id);
    const [again] = await recheck(db, { now: () => now }, [id]);
    expect(again!.status).toBe("ready");
    expect(store.reads).toContain(pathOf(id));
  });

  it("the coder agent reads the document's text from the store before the accrual is booked", async () => {
    const id = await add();
    const inv = apInvoice(db, id)!;
    const before = store.reads.length;
    await ensureCoded(db, { ...inv, coding: undefined }, { now: () => now, env: { KIT11_AP_AGENTS: "on" } });
    expect(store.reads.slice(before)).toContain(pathOf(id));
  });

  it("the invoice's detail shows the supplier's own total line, read from the store", async () => {
    const id = await add();
    const d = await invoiceDetail(db, id);
    expect(d!.total_line).toMatch(/Total due EUR 1,850\.00/);
    expect(store.reads).toContain(pathOf(id));
  });

  it("the cloud sync sends the stored bytes", async () => {
    await add();
    const docs = batchesFor(db, NOTHING_HELD, { now }).flatMap((b) => (b.documents as { sha256: string; base64: string }[] | undefined) ?? []);
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({ sha256: sha256(bytes), base64: bytes.toString("base64") });
  });

  it("the vault files the original from the store, byte for byte", async () => {
    const id = await add();
    const root = join(dir, "vault");
    const out = await syncVault(db, new LocalSink(root), { company: "Northwind Outdoor", now, today: now.toISOString().slice(0, 10) });
    const filed = out.added.find((a) => a.path.includes("/Inkoopfacturen/"));
    expect(filed, `the invoice ${id} is filed`).toBeDefined();
    expect(Buffer.compare(readFileSync(join(root, filed!.path)), bytes)).toBe(0);
  });

  it("is the store of that ledger only: another ledger keeps its files", async () => {
    const other = openDb(":memory:");
    expect(docStoreOf(other)).toBeUndefined();
    const out = await ingestDocument(other, deps, { bytes, filename: "bergtex.pdf", source: "upload" });
    if (out.kind !== "invoice") throw new Error(out.kind);
    expect(existsSync(join(dir, "docs", `${sha256(bytes)}.pdf`))).toBe(true);
    expect(store.kept.size).toBe(0);
  });
});

describe("a ledger with no document store", () => {
  it("keeps the document as a read-only file in the payables folder, as before", async () => {
    const id = await add();
    const file = join(dir, "docs", `${sha256(bytes)}.pdf`);
    expect(docStoreOf(db)).toBeUndefined();
    expect(pathOf(id)).toBe(file);
    expect(Buffer.compare(readFileSync(file), bytes)).toBe(0);
    expect(statSync(file).mode & 0o222).toBe(0);
    expect(Buffer.compare(readDoc(db, file), bytes)).toBe(0);
    expect((await invoiceDetail(db, id))!.total_line).toMatch(/Total due EUR 1,850\.00/);
  });
});
