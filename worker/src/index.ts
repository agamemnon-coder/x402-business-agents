// The Worker entry: pages are served straight from the bundle; every /api/ request goes to the one Durable Object
// that holds the relay's state (the runner's last push, the queue, the tickets), so all of them see it in order.

import { DurableObject } from "cloudflare:workers";
import { notFoundResponse, pageResponse, Relay } from "./core.js";
import { TryDesk } from "./try.js";
import { isTrySignPath, trySignNotFound, trySignRoute, TrySignDesk } from "./trySign.js";
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
  /** "on" declares a live run (a plain var, off by default): /health then keeps the alarm however long the runner is silent. */
  LIVE_RUN?: string;
}

export class RelayObject extends DurableObject<Env> {
  // Each desk is made on its instance's first request, so an instance holds only its own desk's tables: the try-sign
  // instance never has the relay's, and is handed no secret at all.
  private relay?: Relay;
  private tryDesk?: TryDesk;
  private trySign?: TrySignDesk;

  override fetch(req: Request): Promise<Response> {
    const path = new URL(req.url).pathname;
    if (isTrySignPath(path)) return (this.trySign ??= new TrySignDesk(this.ctx.storage.sql)).fetch(req);
    if (path === "/api/try") return (this.tryDesk ??= new TryDesk(this.ctx.storage.sql, { anthropicKey: this.env.ANTHROPIC_API_KEY })).fetch(req);
    return (this.relay ??= new Relay(this.ctx.storage.sql, { relayToken: this.env.RELAY_TOKEN, webhookSecret: this.env.AIRWALLEX_WEBHOOK_SECRET, mfa: this.env.MFA_SESSIONS === "on", liveRun: this.env.LIVE_RUN === "on" })).fetch(req);
  }
}

export default {
  async fetch(req, env): Promise<Response> {
    const page = pageResponse(req, PAGES);
    if (page) return page;
    const path = new URL(req.url).pathname;
    // /try/sign's test worlds (TRY_SIGN_ENABLED, baked into the bundle): their own instance, their own tables; with
    // the feature off every one of its paths is a 404, before the relay sees it.
    const trySign = trySignRoute(path, PAGES);
    if (trySign) return trySign === "desk" ? env.RELAY.get(env.RELAY.idFromName("try-sign")).fetch(req) : trySignNotFound();
    // Try Purser runs in its own instance: its storage and its load stay apart from the approvals.
    if (path === "/api/try") return env.RELAY.get(env.RELAY.idFromName("try")).fetch(req);
    // /health and /health/live are the relay's too: it knows when the runner last synced (B7).
    if (path.startsWith("/api/") || path === "/hooks/airwallex" || path === "/health" || path === "/health/live") return env.RELAY.get(env.RELAY.idFromName("relay")).fetch(req);
    return notFoundResponse(PAGES);
  },
} satisfies ExportedHandler<Env>;
