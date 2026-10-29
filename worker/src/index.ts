// The Worker entry: pages are served straight from the bundle; every /api/ request goes to the one Durable Object
// that holds the relay's state (the runner's last push, the queue, the tickets), so all of them see it in order.

import { DurableObject } from "cloudflare:workers";
import { pageResponse, Relay } from "./core.js";
import { PAGES } from "./pages.gen.js";

export interface Env {
  RELAY: DurableObjectNamespace<RelayObject>;
  /** The runner's bearer token, set with `wrangler secret put RELAY_TOKEN` by npm run relay:deploy. */
  RELAY_TOKEN: string;
}

export class RelayObject extends DurableObject<Env> {
  private readonly relay: Relay;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.relay = new Relay(ctx.storage.sql, { relayToken: env.RELAY_TOKEN });
  }

  override fetch(req: Request): Promise<Response> {
    return this.relay.fetch(req);
  }
}

export default {
  async fetch(req, env): Promise<Response> {
    const page = pageResponse(req, PAGES);
    if (page) return page;
    if (new URL(req.url).pathname.startsWith("/api/")) return env.RELAY.get(env.RELAY.idFromName("relay")).fetch(req);
    return new Response("not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8", "x-content-type-options": "nosniff" } });
  },
} satisfies ExportedHandler<Env>;
