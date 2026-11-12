// A bare SQL probe: one SQLite-backed Durable Object that runs the statements it is sent, one by one, and reports what
// SqlStorage said to each. Used to find out what the engine's schema and queries meet in workerd (spike, not product).
import { DurableObject } from "cloudflare:workers";

const plain = (v) => (v instanceof ArrayBuffer ? { $blob: [...new Uint8Array(v)] } : v);

export class Probe extends DurableObject {
  async fetch(req) {
    const { ops, tx } = await req.json();
    const out = [];
    const run = () => {
      for (const op of ops) {
        try {
          const args = (op.args ?? []).map((a) => (a && typeof a === "object" && "$blob" in a ? new Uint8Array(a.$blob).buffer : a && typeof a === "object" && "$undefined" in a ? undefined : a));
          const cur = this.ctx.storage.sql.exec(op.sql, ...args);
          const rows = cur.toArray().map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, plain(v)])));
          out.push({ ok: true, rows, columns: cur.columnNames, rowsRead: cur.rowsRead, rowsWritten: cur.rowsWritten });
        } catch (e) {
          out.push({ ok: false, error: String(e && e.message) });
          if (op.throw) throw e;
        }
      }
    };
    try { if (tx) this.ctx.storage.transactionSync(run); else run(); } catch (e) { out.push({ ok: false, error: `tx: ${String(e && e.message)}` }); }
    return Response.json(out);
  }
}

export default {
  fetch(req, env) {
    const name = new URL(req.url).searchParams.get("n") ?? "a";
    return env.PROBE.get(env.PROBE.idFromName(name)).fetch(req);
  },
};
