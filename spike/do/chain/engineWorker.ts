// One SQLite-backed Durable Object per company, running the real engine on its own SQLite through the shim
// (src/db/doSql.ts). A spike: each step of the chain is one request, so each can be timed and counted from outside.
import "./installClock.js";
import { DurableObject } from "cloudflare:workers";
import { useDocStore } from "../../../src/ap/docStore.js";
import LEDGER from "../../../src/db/ledger.sql";
import { DoDatabase, type DoStorage } from "../../../src/db/doSql.js";
import { prepareDb } from "../../../src/db/migrate.js";
import type { DB } from "../../../src/db/open.js";
import SCHEMA from "../../../src/db/schema.sql";
import { FakeAirwallex } from "../../../src/redteam/airwallex.js";
import { steps, type StepName, type World } from "./chain.js";
import { randomCount, resetRandom, setClock } from "./det.js";
import { setPdfTextSource } from "./pdfTextStub.js";

interface Env { COMPANY: { idFromName(n: string): unknown; get(id: unknown): { fetch(r: Request): Promise<Response> } } }

export class CompanyEngine extends DurableObject {
  private db: DoDatabase | null = null;
  private world: World | null = null;

  /** Opens the ledger: the engine's schema and migrations over this object's SQLite, and its document store. */
  private open(): World {
    if (this.world) return this.world;
    const storage = this.ctx.storage as unknown as DoStorage;
    const db = (this.db = new DoDatabase(storage, `company:${this.ctx.id.toString().slice(0, 8)}`));
    prepareDb(db as unknown as DB, SCHEMA, LEDGER);
    // Documents and their text: this object's own tables (spike: a row holds at most 2 MB; larger files need R2).
    storage.sql.exec("CREATE TABLE IF NOT EXISTS do_documents (sha256 TEXT PRIMARY KEY, bytes BLOB NOT NULL, text TEXT, pages INTEGER)");
    useDocStore(db as unknown as DB, {
      put: (sha, bytes) => {
        storage.sql.exec("INSERT INTO do_documents (sha256, bytes) VALUES (?, ?) ON CONFLICT(sha256) DO UPDATE SET bytes = excluded.bytes", sha, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
        return `do:${sha}`;
      },
      get: (path) => Buffer.from(storage.sql.exec("SELECT bytes FROM do_documents WHERE sha256 = ?", path.slice(3)).one().bytes as ArrayBuffer),
    });
    setPdfTextSource((sha) => storage.sql.exec("SELECT text, pages FROM do_documents WHERE sha256 = ? AND text IS NOT NULL", sha).toArray()[0] as { text: string; pages: number } | undefined);
    return (this.world = { db: db as unknown as DB, awx: new FakeAirwallex(), dir: "/do" });
  }

  override async fetch(req: Request): Promise<Response> {
    const step = new URL(req.url).pathname.slice(1);
    const body = (req.method === "POST" ? await req.json() : {}) as { clock?: number; resetRandom?: boolean; args?: Record<string, unknown>; text?: { sha256: string; text: string; pages: number } };
    if (body.clock !== undefined) setClock(body.clock);
    if (body.resetRandom) resetRandom();
    try {
      const fresh = !this.world;
      const w = this.open();
      const stats = this.db!.stats;
      if (step === "open") return Response.json({ result: { fresh, tables: (w.db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table'").get() as { n: number }).n }, stats: { ...stats, perStatement: undefined } });
      // The text the real PDF reader gave for this document (see pdfTextStub.ts), kept beside its bytes.
      if (body.text) this.ctx.storage.sql.exec("INSERT INTO do_documents (sha256, bytes, text, pages) VALUES (?, x'', ?, ?) ON CONFLICT(sha256) DO UPDATE SET text = excluded.text, pages = excluded.pages", body.text.sha256, body.text.text, body.text.pages);
      const before = { ...stats };
      const result = await steps(w)[step as StepName](body.args ?? {});
      const delta = { statements: stats.statements - before.statements, added: stats.added - before.added, rowsRead: stats.rowsRead - before.rowsRead, rowsWritten: stats.rowsWritten - before.rowsWritten, transactions: stats.transactions - before.transactions, random: randomCount() };
      return Response.json({ result, stats: delta });
    } catch (e) {
      const x = e as Error;
      return Response.json({ error: x.message, name: x.name, stack: String(x.stack).split("\n").slice(0, 8) }, { status: 500 });
    }
  }
}

export default {
  fetch(req: Request, env: Env): Promise<Response> {
    const company = new URL(req.url).searchParams.get("company") ?? "demo";
    return env.COMPANY.get(env.COMPANY.idFromName(company)).fetch(req);
  },
};
