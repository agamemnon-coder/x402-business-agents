// The conformance checks inside a SQLite-backed Durable Object, plus three questions only a Durable Object can answer.
import { DurableObject } from "cloudflare:workers";
import { DoDatabase, type DoStorage } from "../../src/db/doSql.js";
import { conformance } from "./conformance.js";

export class Conf extends DurableObject {
  override async fetch(req: Request): Promise<Response> {
    const storage = this.ctx.storage as unknown as DoStorage;
    const db = new DoDatabase(storage);
    const step = new URL(req.url).pathname;
    if (step === "/fresh") return Response.json({ foreign_keys_default: db.pragma("foreign_keys", { simple: true }) });
    if (step === "/conformance") { const rows = conformance(db); return Response.json({ rows, stats: { ...db.stats, perStatement: undefined } }); }
    if (step === "/write-then-throw") {
      db.exec("CREATE TABLE IF NOT EXISTS w (k TEXT)");
      db.prepare("INSERT INTO w VALUES ('written before the throw')").run();
      throw new Error("the request fails after an autocommitted write");
    }
    if (step === "/write-await-throw") {
      db.exec("CREATE TABLE IF NOT EXISTS w (k TEXT)");
      db.prepare("INSERT INTO w VALUES ('written before an await and a throw')").run();
      await new Promise((r) => setTimeout(r, 5));
      db.prepare("INSERT INTO w VALUES ('written after the await, before the throw')").run();
      throw new Error("the request fails after an await");
    }
    if (step === "/after-throw") return Response.json(db.prepare("SELECT k FROM w ORDER BY rowid").all());
    return new Response("?", { status: 404 });
  }
}

export default {
  fetch(req: Request, env: { CONF: { idFromName(n: string): unknown; get(id: unknown): { fetch(r: Request): Promise<Response> } } }): Promise<Response> {
    const name = new URL(req.url).searchParams.get("n") ?? "c";
    return env.CONF.get(env.CONF.idFromName(name)).fetch(req);
  },
};
