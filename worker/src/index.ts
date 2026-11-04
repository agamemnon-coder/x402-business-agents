// The Worker entry: pages are served straight from the bundle; every /api/ request goes to the one Durable Object
// that holds the relay's state (the runner's last push, the queue, the tickets), so all of them see it in order.

import { DurableObject } from "cloudflare:workers";
import { notFoundResponse, pageResponse, Relay } from "./core.js";
import { TryDesk } from "./try.js";
import { PAGES } from "./pages.gen.js";

export interface Env {
  RELAY: DurableObjectNamespace<RelayObject>;
  /** The runner's bearer token, set with `wrangler secret put RELAY_TOKEN` by npm run relay:deploy. */
  RELAY_TOKEN: string;
  /** D20: "on" turns on passkey sessions and the weekly viewer key (a plain var in wrangler.toml; off by default). */
  MFA_SESSIONS?: string;
  /** Airwallex's webhook signing secret, set by npm run cards -- webhook. Without it the webhook route answers 503. */
  AIRWALLEX_WEBHOOK_SECRET?: string;
  /** Claude for Try Purser, set with `wrangler secret put ANTHROPIC_API_KEY`. Without it the page reads by code alone. */
  ANTHROPIC_API_KEY?: string;
}

export class RelayObject extends DurableObject<Env> {
  private readonly relay: Relay;
  private readonly tryDesk: TryDesk;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.relay = new Relay(ctx.storage.sql, { relayToken: env.RELAY_TOKEN, webhookSecret: env.AIRWALLEX_WEBHOOK_SECRET, mfa: env.MFA_SESSIONS === "on" });
    this.tryDesk = new TryDesk(ctx.storage.sql, { anthropicKey: env.ANTHROPIC_API_KEY });
  }

  override fetch(req: Request): Promise<Response> {
    return new URL(req.url).pathname === "/api/try" ? this.tryDesk.fetch(req) : this.relay.fetch(req);
  }
}

export default {
  async fetch(req, env): Promise<Response> {
    const page = pageResponse(req, PAGES);
    if (page) return page;
    const path = new URL(req.url).pathname;
    // Try Purser runs in its own instance: its storage and its load stay apart from the approvals.
    if (path === "/api/try") return env.RELAY.get(env.RELAY.idFromName("try")).fetch(req);
    // /health is the relay's too: it knows when the runner last synced (B7).
    if (path.startsWith("/api/") || path === "/hooks/airwallex" || path === "/health") return env.RELAY.get(env.RELAY.idFromName("relay")).fetch(req);
    return notFoundResponse(PAGES);
  },
} satisfies ExportedHandler<Env>;
