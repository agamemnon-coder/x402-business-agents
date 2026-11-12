// One Durable Object per company: the company's engine on the object's own SQLite. TEST MONEY ONLY (the engine in
// here pays on a stand-in bank; see ./hostWorker.ts). The cloud's routes reach it through a stub (./client.ts), one
// method: call(tenantId, method, args).
//
// The object itself is thin. Nothing of the engine is imported here but types: the engine (./hostWorker.ts, and
// through it the whole payables chain) is loaded with import() on the company's first engine call, so the Worker's
// start and every request that is not the engine's never pay for it.
//
// Whose engine this is comes with every call and is pinned on the first one, in a row of the object's own table;
// a call for another company is refused. (The object's name is the company's id too, but nothing here relies on it.)
//
// An answer is data, also when it is a refusal: { ok: false, error } carries the engine's own words across the stub
// unchanged, and the stub's caller throws them again.
import { DurableObject } from "cloudflare:workers";
import { ENGINE_METHODS, type EngineApi } from "./api.js";
import type { HostEnv } from "./hostWorker.js";

export type EngineAnswer = { ok: true; value: unknown } | { ok: false; error: string };

const STATE_TABLE = "CREATE TABLE IF NOT EXISTS do_state (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID";

export class CompanyEngine extends DurableObject<HostEnv> {
  private host: Promise<{ api: EngineApi }> | null = null;
  private pinned: string | null = null;
  /** The calls that have not answered yet: a wipe waits for them. */
  private readonly running = new Set<Promise<unknown>>();

  /** One action of the company's engine. The answer is always data: the action's value, or what was refused or failed, in words. */
  async call(tenantId: string, method: keyof EngineApi, args: unknown[]): Promise<EngineAnswer> {
    try {
      this.pin(tenantId);
      if (typeof method !== "string" || !(ENGINE_METHODS as readonly string[]).includes(method) || !Array.isArray(args)) throw new Error("not an action of the engine");
      if (method === "wipe") {
        await this.wipe();
        return { ok: true, value: undefined };
      }
      const run = this.open(tenantId).then(({ api }) => (api[method] as (...a: unknown[]) => Promise<unknown>)(...args));
      this.running.add(run);
      try { return { ok: true, value: await run }; } finally { this.running.delete(run); }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  /** Forgets everything this company's engine holds: its ledger, its documents, its stand-in bank and whose it was. */
  async wipe(): Promise<void> {
    await Promise.allSettled([...this.running]);
    this.host = null;
    this.pinned = null;
    await this.ctx.storage.deleteAll();
  }

  /** The company this object is for: the first one that calls it; anyone else is refused. */
  private pin(tenantId: string): void {
    if (typeof tenantId !== "string" || !tenantId) throw new Error("the engine is one company's: its id is needed");
    if (this.pinned === null) {
      const { sql } = this.ctx.storage;
      sql.exec(STATE_TABLE);
      sql.exec("INSERT OR IGNORE INTO do_state (key, value) VALUES ('tenant', ?)", tenantId);
      this.pinned = String(sql.exec("SELECT value FROM do_state WHERE key = 'tenant'").toArray()[0]!.value);
    }
    if (this.pinned !== tenantId) throw new Error("this engine is another company's");
  }

  /** The engine, loaded and opened on first use; a start that failed is not kept, so the next call tries again. */
  private open(tenantId: string): Promise<{ api: EngineApi }> {
    if (!this.host) {
      const host = import("./hostWorker.js").then((m) => m.openHost(this.ctx, this.env, tenantId));
      this.host = host;
      host.catch(() => { if (this.host === host) this.host = null; });
    }
    return this.host;
  }
}
