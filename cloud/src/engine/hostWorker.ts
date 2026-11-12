// The engine inside a company's Durable Object: the engine host (src/engine/host.ts, the same class the Node tests
// run) over the object's own SQLite, with the outside world the object has. The twin of cloud/src/engine/node.ts:
//   the ledger     the object's SQLite through the engine's handle (src/db/doSql.ts), schema and migrations as on a runner
//   documents      the object's SQLite, in 1 MB pieces (./docChunks.ts)
//   PDF text       the engine's reader on this thread (a Durable Object has no worker threads)
//   the bank       the stand-in bank, TEST MONEY ONLY, kept as text in the object's SQLite so it outlives the object's memory
//   the reader     the parser (no model is asked)
//   the archive    the cloud's document store under t/<tenant>/vault/ (./vaultR2.ts)
//   the read model the cloud's own applySync on D1 and R2 (./target.ts), fed with what changed
//
// This file loads the whole engine. Nothing imports it statically: the object (./object.ts) loads it with import() on
// a company's first engine call, so the Worker's own start does not pay for it (test/cloud-engine-bundle.test.ts).
import * as pdfkit from "pdfkit";
import Helvetica from "pdfkit/standard-fonts/Helvetica";
import HelveticaBold from "pdfkit/standard-fonts/HelveticaBold";
import HelveticaOblique from "pdfkit/standard-fonts/HelveticaOblique";
import { useDocStore } from "../../../src/ap/docStore.js";
import { usePdfReader } from "../../../src/ap/pdfText.js";
import { readPdfInline } from "../../../src/ap/pdfTextInline.js";
import { doDb, type DoStorage } from "../../../src/db/doSql.js";
import LEDGER from "../../../src/db/ledger.sql";
import { prepareDb } from "../../../src/db/migrate.js";
import SCHEMA from "../../../src/db/schema.sql";
import { feedCloud } from "../../../src/engine/feed.js";
import { EngineHost, parserOnly } from "../../../src/engine/host.js";
import { bankToText, standInBank } from "../../../src/engine/standInBank.js";
import { d1Sql, r2Blobs, type D1Like, type R2Like } from "../store.js";
import { TenantDb } from "../tenant.js";
import type { EngineApi } from "./api.js";
import { docChunks } from "./docChunks.js";
import { cloudTarget } from "./target.js";
import { blobVault } from "./vaultR2.js";

/** What the host needs of the object: its storage. */
export interface HostCtx { storage: DoStorage & { deleteAll(): Promise<void> } }
/** What the host needs of the Worker's bindings: the cloud's database and document store, and the passkeys' relying party. */
export interface HostEnv { DB: D1Like; DOCS: R2Like; RP_ID: string; ORIGIN: string }

let runtimeReady = false;
/** Once per isolate: the PDF reader without a worker thread, and the three fonts the archive's PDFs use (pdfkit's browser build carries none). */
function prepareRuntime(): void {
  if (runtimeReady) return;
  usePdfReader(readPdfInline);
  (pdfkit as unknown as { registerStdFonts(...fonts: unknown[]): void }).registerStdFonts(Helvetica, HelveticaBold, HelveticaOblique);
  runtimeReady = true;
}

export async function openHost(ctx: HostCtx, env: HostEnv, tenantId: string): Promise<{ api: EngineApi }> {
  prepareRuntime();
  const { storage } = ctx;
  const sql = d1Sql(env.DB);
  const company = await sql.first<{ name: string; language: string }>("SELECT name, language FROM tenants WHERE id = ?", [tenantId]);
  if (!company) throw new Error("no such company");

  const db = doDb(storage, "company");
  prepareDb(db, SCHEMA, LEDGER);
  useDocStore(db, docChunks(storage));
  // The object's own table, do_state (./object.ts made it and keeps the company's id in it): the bank and the seed's mark live there too.
  const state = {
    get: (key: string): string | null => (storage.sql.exec("SELECT value FROM do_state WHERE key = ?", key).toArray()[0]?.value as string | undefined) ?? null,
    set: (key: string, value: string): void => { storage.sql.exec("INSERT INTO do_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", key, value); },
  };
  // The stand-in bank: the one this object kept, when it has been here before.
  const bank = standInBank({ load: () => state.get("bank"), save: (text) => state.set("bank", text) });
  const keepBank = () => state.set("bank", bankToText(bank));
  const target = cloudTarget(new TenantDb(sql, tenantId), r2Blobs(env.DOCS), () => new Date());
  const host = new EngineHost({
    db, reader: parserOnly, rails: { rail: bank, sim: bank }, afterMoney: keepBank,
    rp: { rpId: env.RP_ID, origin: env.ORIGIN }, company: { name: company.name, lang: company.language === "en" ? "en" : "nl" },
    vault: blobVault(r2Blobs(env.DOCS), tenantId), feed: (d, now) => feedCloud(d, target, now),
  });
  // The treasury's test money, once in the object's life (the Node engine seeds at its start, which is once in its life too).
  if (state.get("seeded") === null) {
    await host.seed();
    state.set("seeded", new Date().toISOString());
  }
  /** After an action that followed payments: the bank as it stands now is the one kept. */
  const kept = async <T>(action: Promise<T>): Promise<T> => { try { return await action; } finally { keepBank(); } };
  const api: EngineApi = {
    status: async () => host.status(),
    seed: async () => host.seed(),
    upload: async (doc) => host.upload(doc),
    invoices: async () => host.invoices(),
    invoice: async (id) => host.invoice(id),
    propose: async (invoiceId) => host.propose(invoiceId),
    proposal: async (id) => host.proposal(id),
    passkeyStart: async () => host.passkeyStart(),
    passkeyFinish: async (a) => host.passkeyFinish(a),
    approve: async (a) => kept(host.approve(a)),
    retry: async (proposalId) => kept(host.retry(proposalId)),
    sync: async () => kept(host.sync()),
    events: async (after, limit) => host.events(after, limit),
    vaultFiles: async () => host.vaultFiles(),
    vaultFile: async (path) => host.vaultFile(path),
    forgetPasskey: async (label) => host.forgetPasskey(label),
    // The object does this itself (it must also forget this host); here for the interface's sake.
    wipe: async () => { await storage.deleteAll(); },
  };
  return { api };
}
