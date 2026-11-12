// The Worker entry: pages are served straight from the bundle; every /api/ request goes to the one Durable Object
// that holds the relay's state (the runner's last push, the queue, the tickets), so all of them see it in order.

import { DurableObject } from "cloudflare:workers";
import { notFoundResponse, pageResponse, Relay } from "./core.js";
import { TryDesk } from "./try.js";
import { isTrySignPath, trySignNotFound, trySignRoute, TrySignDesk } from "./trySign.js";
import { SandboxQuotes } from "./fxQuote.js";
import { invoiceReaderSource, treasuryAdvisorSource } from "./agentLine.js";
import { PAGES } from "./pages.gen.js";
import { METAL_INSPECTOR_PATH, MetalInspector, inspectorOff } from "./metalInspector.js";

export interface Env {
  RELAY: DurableObjectNamespace<RelayObject>;
  /** The runner's bearer token, set with `wrangler secret put RELAY_TOKEN` by npm run relay:deploy. */
  RELAY_TOKEN: string;
  /** D20: "on" turns on passkey sessions and the weekly viewer key (a plain var in wrangler.toml; off by default). */
  MFA_SESSIONS?: string;
  /** Airwallex's webhook signing secret, set by npm run cards -- webhook. Without it the webhook route answers 503. */
  AIRWALLEX_WEBHOOK_SECRET?: string;
  /** Claude for Try Purser, and for /try/sign's live agents (Sonnet reads the invoice, Opus advises): a Worker secret
   *  Max sets himself; no script in this repo sets it (test/try-fx.test.ts). Without it the pages read by code alone,
   *  show a recorded output or fixed text, labelled. */
  ANTHROPIC_API_KEY?: string;
  /** /try/sign's emergency switch for every live agent call (Sonnet and Opus): "off" (any case, trimmed) stops them;
   *  any other value, or none, leaves them on. Max sets it himself when needed (dashboard or wrangler); no script or
   *  config here does. */
  TRY_SIGN_AGENTS?: string;
  /** The switch's old name, still honoured: "off" here stops every live agent call too (a Worker deployed with it stays off). */
  TRY_SIGN_HAIKU?: string;
  /**
   * /try/sign's live FX quote (read-only, sandbox only): a Worker secret Max sets himself, from a scoped sandbox key
   * (Conversion: Write only); no script in this repo sets it (test/try-fx.test.ts). The client id.
   */
  AIRWALLEX_CLIENT_ID?: string;
  /** Its API key, the same way. Without both, /try/sign shows the main run's recorded quote, labelled, in no signature. */
  AIRWALLEX_API_KEY?: string;
  /** "on" declares a live run (a plain var, off by default): /health then keeps the alarm however long the runner is silent. */
  LIVE_RUN?: string;
  /**
   * /metal's live mandate inspector (GET /api/metal/mandates, worker/src/metalInspector.ts): the Metal testnet RPC URL,
   * a Worker secret Max sets himself; no script in this repo sets it. Read-only calls, at most 500 a UTC day. Without it
   * the inspector answers the record's read of 12 November, labelled as recorded.
   */
  METAL_RPC_URL?: string;
  /** The inspector's switch: "off" (any case, trimmed) stops every call to the chain; any other value, or none, leaves it on. */
  METAL_INSPECTOR?: string;
}

export class RelayObject extends DurableObject<Env> {
  // Each desk is made on its instance's first request, so an instance holds only its own desk's tables: the try-sign
  // instance never has the relay's, and is handed only the Airwallex sandbox key, inside a client that can do nothing but
  // ask for an FX quote (worker/src/fxQuote.ts), and the Anthropic key inside the functions that read the invoice and ask for the advice.
  private relay?: Relay;
  private tryDesk?: TryDesk;
  private trySign?: TrySignDesk;
  private metal?: MetalInspector;

  override fetch(req: Request): Promise<Response> {
    const path = new URL(req.url).pathname;
    if (isTrySignPath(path)) {
      const { AIRWALLEX_CLIENT_ID: id, AIRWALLEX_API_KEY: key } = this.env;
      return (this.trySign ??= new TrySignDesk(this.ctx.storage.sql, {
        fx: id && key ? new SandboxQuotes({ clientId: id, apiKey: key }) : null,
        // Section 6: the runner's invoice reader (Sonnet), live; spec 6b: the Treasury agent's advice (Opus). Only
        // functions that make those calls: the desk never holds the key itself. Both under the switch and the budget.
        reader: invoiceReaderSource(this.env, fetch),
        advisor: treasuryAdvisorSource(this.env, fetch),
        // The recorded real outputs, built into the bundle, for when a live agent is unavailable.
        recorded: PAGES.tryAgentsRecorded ?? null,
        // 1.1: the main run's recorded rate, built in with the pages, for step 0's worst case.
        rate: PAGES.exposureRate ?? null,
      })).fetch(req);
    }
    // The mandate inspector's own instance holds only the RPC URL and the switch, inside the desk.
    if (path === METAL_INSPECTOR_PATH) return (this.metal ??= new MetalInspector(this.ctx.storage.sql, { rpcUrl: this.env.METAL_RPC_URL, off: inspectorOff(this.env.METAL_INSPECTOR) ? "switched off" : null, recorded: PAGES.metalRecorded ?? null })).fetch(req);
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
    // /metal's mandate inspector in its own instance: its cache and its daily count of calls stay apart.
    if (path === METAL_INSPECTOR_PATH) return env.RELAY.get(env.RELAY.idFromName("metal-inspector")).fetch(req);
    // Try Purser runs in its own instance: its storage and its load stay apart from the approvals.
    if (path === "/api/try") return env.RELAY.get(env.RELAY.idFromName("try")).fetch(req);
    // /health and /health/live are the relay's too: it knows when the runner last synced (B7).
    if (path.startsWith("/api/") || path === "/hooks/airwallex" || path === "/health" || path === "/health/live") return env.RELAY.get(env.RELAY.idFromName("relay")).fetch(req);
    return notFoundResponse(PAGES);
  },
} satisfies ExportedHandler<Env>;
