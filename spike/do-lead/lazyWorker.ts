// SPIKE: the cloud Worker with a THIN Engine object: nothing of the engine is imported statically. The object loads
// the engine (lazyHost.ts) on its first engine call. Shows that the cloud's own start does not pay for the engine.
import { DurableObject } from "cloudflare:workers";
import cloud, { type Bindings } from "../../cloud/src/worker.js";
import { sessionToken } from "../../cloud/src/auth.js";

interface Stub { loaded(): Promise<number | null>; call(method: string, args: unknown[]): Promise<unknown> }
interface Env extends Bindings { ENGINE: { idFromName(name: string): unknown; get(id: unknown): Stub } }
const flag = () => (globalThis as { __purserEngineLoadedAt?: number }).__purserEngineLoadedAt ?? null;

export class Engine extends DurableObject<Env> {
  private impl: Promise<{ handle(method: string, args: unknown[]): Promise<unknown> }> | null = null;
  async loaded(): Promise<number | null> { return flag(); }
  async call(method: string, args: unknown[]): Promise<unknown> {
    this.impl ??= import("./lazyHost.js").then((m) => m.make(this.ctx, this.env));
    return (await this.impl).handle(method, args);
  }
}

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b, null, 1), { status, headers: { "content-type": "application/json" } });

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const path = new URL(req.url).pathname;
    if (path !== "/") return cloud.fetch(req, env);
    const origin = env.ORIGIN;
    const call = (p: string, init: RequestInit & { token?: string } = {}) => cloud.fetch(new Request(`${origin}${p}`, { ...init, headers: { ...(init.token ? { authorization: `Bearer ${init.token}` } : {}), origin, ...(init.body ? { "content-type": "application/json" } : {}) } }), env);
    try {
      const health = await call("/v1/health");
      const res = await call("/v1/admin/tenants", { method: "POST", token: "spike-admin-token", body: JSON.stringify({ slug: `lazy-${crypto.randomUUID().slice(0, 6)}`, name: "Lazy (test)", owner: { display_name: "Test Owner" } }) });
      const b = (await res.json()) as { tenant: { id: string }; owner: { id: string } };
      const session = await sessionToken(env.SESSION_SECRET, { tenantId: b.tenant.id, userId: b.owner.id, role: "owner", gen: 0 }, new Date());
      const stub = env.ENGINE.get(env.ENGINE.idFromName(b.tenant.id));
      const before = { in_worker: flag(), in_object: await stub.loaded() };
      const t = performance.now();
      const run = (await stub.call("runChain", [b.tenant.id, {}])) as Record<string, { value?: unknown }>;
      const first_engine_call_ms = Math.round(performance.now() - t);
      const after = { in_worker: flag() !== null, in_object: (await stub.loaded()) !== null };
      const inv = (await (await call("/v1/invoices", { token: session })).json()) as { items: { id: string; status: string }[] };
      return json({ ok: true, health: health.status, engine_loaded_before_first_engine_call: before, first_engine_call_ms, engine_loaded_after: after, execute: run.execute?.value, invoices: inv.items.map((i) => `${i.id} ${i.status}`) });
    } catch (e) { return json({ ok: false, error: (e as Error).message, stack: String((e as Error).stack).split("\n").slice(0, 8) }, 500); }
  },
};
