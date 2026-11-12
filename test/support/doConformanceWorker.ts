// The Worker of test/db-do-sql-workerd.test.ts: one SQLite-backed Durable Object that runs the checks of
// ./dbConformance.ts on the engine's handle (src/db/doSql.ts) over its own storage and answers with their lines.
// A test fixture only: bundled by the test and run in local workerd, never deployed.
import { doDb, type DoStorage } from "../../src/db/doSql.js";
import { conformance } from "./dbConformance.js";

export class ConformanceObject {
  constructor(private readonly ctx: { storage: DoStorage }) {}

  fetch(req: Request): Response {
    if (new URL(req.url).pathname !== "/conformance") return new Response("not found", { status: 404 });
    return Response.json({ rows: conformance(doDb(this.ctx.storage)) });
  }
}

interface Env {
  CONFORMANCE: { idFromName(name: string): unknown; get(id: unknown): { fetch(req: Request): Promise<Response> } };
}

export default {
  fetch(req: Request, env: Env): Promise<Response> {
    return env.CONFORMANCE.get(env.CONFORMANCE.idFromName("checks")).fetch(req);
  },
};
