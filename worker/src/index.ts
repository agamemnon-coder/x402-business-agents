// The Worker entry: pages are served straight from the bundle; every /api/ request goes to the one Durable Object
// that holds the relay's state (the runner's last push, the queue, the tickets), so all of them see it in order.

import { DurableObject, WorkerEntrypoint } from "cloudflare:workers";
import { AwxGatewayDesk, type GatewayEnv } from "./awxGateway.js";
import type { GatewayAnswer, GatewayRequest } from "../../src/airwallex/gatewayRules.js";
import { COMMON_HEADERS, notFoundResponse, pageResponse, Relay } from "./core.js";
import { goResponse } from "./go.js";
import { TryDesk } from "./try.js";
import { isTrySignPath, trySignNotFound, trySignRoute, TrySignDesk } from "./trySign.js";
import { SandboxQuotes } from "./fxQuote.js";
import { AwxFxDesk, type AwxFxAnswer, type AwxFxAsk } from "./awxFx.js";
import { AwxCardsDesk } from "./awxCards.js";
import { AGENT_CARDS_PATH, agentCardsLive } from "./agentCardsLive.js";
import type { CardsAnswer, CardsAsk } from "../../src/airwallex/cardGate.js";
import { AwxPayoutDesk, SandboxPayouts, type PayoutAnswer, type PayoutAsk, type SimulateAnswer } from "./awxPayout.js";
import { invoiceReaderSource, treasuryAdvisorSource } from "./agentLine.js";
import { talkSource } from "./talkRound.js";
import { PAGES } from "./pages.gen.js";
import { X402Desk, X402_PATH } from "./x402.js";
import { METAL_INSPECTOR_PATH, MetalInspector, inspectorOff } from "./metalInspector.js";
import { tryEngineResponse } from "./tryEngine.js";
import { AWX_READ_PATH, AwxReadDesk, isAwxView, type AwxReadAnswer } from "./awxRead.js";
import { AWX_EVENTS_PATH, type AwxEventsAnswer } from "./awxEvents.js";
import { awxBooksResponse, booksCache, isAwxBooksPath } from "./awxBooks.js";
import type { AwxBadgeCache } from "../../src/finance/awxBadge.js";
import { StatusDesk } from "./statusDesk.js";
import { withChecks, type StatusSummary } from "../../src/ops/syntheticChecks.js";

export interface Env extends GatewayEnv {
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
  /** Where the short URL /go points (a plain var, an https URL; never an event token). Default: worker/src/go.ts. */
  TRY_GO_URL?: string;
  /** /x402/proof's testnet settlement (worker/src/x402.ts): "on" only with the owner's go; off by default. */
  X402_TESTNET_SETTLE?: string;
  /** /x402/proof's payee on Alta testnet; Northwind's business account when unset. */
  X402_PAY_TO?: string;
  /**
   * /metal's live mandate inspector (GET /api/metal/mandates, worker/src/metalInspector.ts): the Alta testnet RPC URL,
   * a Worker secret Max sets himself; no script in this repo sets it. Read-only calls, at most 500 a UTC day. Without it
   * the inspector answers the record's read of 12 November, labelled as recorded.
   */
  METAL_RPC_URL?: string;
  /** The inspector's switch: "off" (any case, trimmed) stops every call to the chain; any other value, or none, leaves it on. */
  METAL_INSPECTOR?: string;
  /** "on": /try/sign's "talk the agent round" step (worker/src/talkRound.ts); off when missing. */
  TRY_TALK?: string;
  /**
   * The hands-on demo's engine, purser-try (cloud/wrangler.try.jsonc), as a service binding (wrangler.jsonc): /try and
   * the paths its page calls go there (./tryEngine.ts). Without it the site answers /try with its own page.
   */
  TRY_ENGINE?: Fetcher;
  /** Purser Cloud's live Airwallex tab (./awxRead.ts): "off" (any case, trimmed) stops every read; anything else, or none, leaves it on. */
  AWX_READ?: string;
  /**
   * /try's live FX quote (worker/src/awxFx.ts, the AwxFx entrypoint): "off" (any case, trimmed) stops every call to
   * Airwallex from it; any other value, or none, leaves it on. Max sets it himself when needed; no script here does.
   */
  AWX_FX?: string;
  /**
   * /try's sandbox payout (worker/src/awxPayout.ts): its own scoped sandbox key (transfers write, balances read), Worker
   * secrets Max sets himself; no script in this repo sets them. Without both, the existing sandbox key is used (Max may
   * widen it instead); purser-try's switch awx_payout keeps every payout off until it is set.
   */
  AIRWALLEX_PAYOUT_CLIENT_ID?: string;
  AIRWALLEX_PAYOUT_API_KEY?: string;
  /** The payout's switch on this Worker: "off" (any case, trimmed) stops every payout call; anything else leaves it to the key and purser-try's awx_payout. */
  AWX_PAYOUT?: string;
  /**
   * The agents' live sandbox cards (./awxCards.ts, the AwxCards entrypoint): "on" lets card writes and the purchase
   * simulation through (create a card, freeze or unfreeze it, set its limits). Off when missing; reads need only the key.
   */
  AWX_CARDS_WRITE?: string;
}

/** /try's live quote may take this long at Airwallex; the engine waits at most 3 s for the whole answer (cloud/src/engine/liveFx.ts). */
const AWX_FX_TIMEOUT_MS = 2_500;

/** The try-sign instance's answer to the relay's /health: today's spend on its live agents. Not a public path. */
export const LIVE_AGENTS_PATH = "/internal/try-sign/live-agents";

export class RelayObject extends DurableObject<Env> {
  // Each desk is made on its instance's first request, so an instance holds only its own desk's tables: the try-sign
  // instance never has the relay's, and is handed only the Airwallex sandbox key, inside a client that can do nothing but
  // ask for an FX quote (worker/src/fxQuote.ts), and the Anthropic key inside the functions that read the invoice and ask for the advice.
  private relay?: Relay;
  private tryDesk?: TryDesk;
  private trySign?: TrySignDesk;
  private x402?: X402Desk;
  private metal?: MetalInspector;
  private awxRead?: AwxReadDesk;
  private awxBooks?: AwxBadgeCache;
  private awxFx?: AwxFxDesk;
  private awxPayout?: AwxPayoutDesk;
  private status?: StatusDesk;

  /** The "status" instance's desk (./statusDesk.ts): the hourly checks' rows, in this instance's own tables. */
  private statusDesk(): StatusDesk {
    // The Worker's global fetch: with global_fetch_strictly_public (wrangler.jsonc) it goes over the public internet,
    // as a visitor's request does, even to this Worker's own address.
    return (this.status ??= new StatusDesk(this.ctx.storage.sql, { fetch: (url, init) => fetch(url, init) }));
  }
  /** One round of the hourly checks, by RPC from the cron trigger only (no HTTP path reaches it). */
  async statusRun(): Promise<{ checks: number; passed: number }> {
    return this.statusDesk().run();
  }
  /** What /status and /status.json show: read only. */
  async statusSummary(): Promise<StatusSummary> {
    return this.statusDesk().summary();
  }

  /** /try's sandbox payout, by RPC from the AwxFx entrypoint only: the "awx-payout" instance's desk, with the payout key inside its client. */
  private payoutDesk(): AwxPayoutDesk {
    // Its own payout key when both are set; else the Worker's existing sandbox key (widened by Max). Either way the
    // client's own allow-list (four sandbox calls) is the guard, not the key's scopes.
    const own = this.env.AIRWALLEX_PAYOUT_CLIENT_ID && this.env.AIRWALLEX_PAYOUT_API_KEY;
    const { id, key } = own
      ? { id: this.env.AIRWALLEX_PAYOUT_CLIENT_ID, key: this.env.AIRWALLEX_PAYOUT_API_KEY }
      : { id: this.env.AIRWALLEX_CLIENT_ID, key: this.env.AIRWALLEX_API_KEY };
    return (this.awxPayout ??= new AwxPayoutDesk(this.ctx.storage.sql, {
      rail: id && key ? new SandboxPayouts({ clientId: id, apiKey: key }) : null,
      off: (this.env.AWX_PAYOUT ?? "").trim().toLowerCase() === "off",
    }));
  }

  async awxPayoutCreate(a: PayoutAsk): Promise<PayoutAnswer> {
    return this.payoutDesk().payout(a);
  }
  /** The visitor's "Sandbox: move to PAID" for its company's own transfer (the sandbox's simulation). */
  async awxPayoutSimulate(a: { company: string; terms_sha256: string }): Promise<SimulateAnswer> {
    return this.payoutDesk().simulatePaid(a);
  }

  /**
   * /try's live FX quote, by RPC from the AwxFx entrypoint only (the Worker routes no request here): the "awx-fx"
   * instance's desk, with its own sandbox quote client (the key stays inside it) and its caps.
   */
  async awxFxQuote(a: AwxFxAsk): Promise<AwxFxAnswer> {
    const { AIRWALLEX_CLIENT_ID: id, AIRWALLEX_API_KEY: key } = this.env;
    this.awxFx ??= new AwxFxDesk(this.ctx.storage.sql, {
      source: id && key ? new SandboxQuotes({ clientId: id, apiKey: key, timeoutMs: AWX_FX_TIMEOUT_MS }) : null,
      off: (this.env.AWX_FX ?? "").trim().toLowerCase() === "off",
    });
    return this.awxFx.quote(a);
  }

  /** The awx-read instance's gateway to the Airwallex sandbox (./awxRead.ts), made on its first request. */
  private awxReadDesk(): AwxReadDesk {
    return (this.awxRead ??= new AwxReadDesk(this.ctx.storage.sql, { clientId: this.env.AIRWALLEX_CLIENT_ID, apiKey: this.env.AIRWALLEX_API_KEY, off: (this.env.AWX_READ ?? "").trim().toLowerCase() === "off" }));
  }

  /** The try-sign instance's desk, made on its first request (it holds only its own tables). */
  private trySignDesk(): TrySignDesk {
    const { AIRWALLEX_CLIENT_ID: id, AIRWALLEX_API_KEY: key } = this.env;
    return (this.trySign ??= new TrySignDesk(this.ctx.storage.sql, {
      fx: id && key ? new SandboxQuotes({ clientId: id, apiKey: key }) : null,
      // Section 6: the runner's invoice reader (Sonnet), live; spec 6b: the Treasury agent's advice (Opus). Only
      // functions that make those calls: the desk never holds the key itself. Both under the switch and the budget.
      reader: invoiceReaderSource(this.env, fetch),
      advisor: treasuryAdvisorSource(this.env, fetch),
      // "Talk the agent round" (worker/src/talkRound.ts): only with TRY_TALK=on; under the same switch and budget.
      ...(this.env.TRY_TALK === "on" ? { talk: talkSource(this.env, fetch) } : {}),
      // The recorded real outputs, built into the bundle, for when a live agent is unavailable.
      recorded: PAGES.tryAgentsRecorded ?? null,
      // 1.1: the main run's recorded rate, built in with the pages, for step 0's worst case.
      rate: PAGES.exposureRate ?? null,
    }));
  }

  override fetch(req: Request): Promise<Response> {
    const path = new URL(req.url).pathname;
    // The relay's /health asks the try-sign instance for today's spend on its live agents. LIVE_AGENTS_PATH reaches an
    // instance only from the relay's own (the Worker routes no outside request to it).
    if (path === LIVE_AGENTS_PATH) return Promise.resolve(Response.json(this.trySignDesk().spentToday()));
    if (isTrySignPath(path)) return this.trySignDesk().fetch(req);
    if (path === X402_PATH) return (this.x402 ??= new X402Desk(this.ctx.storage.sql, { settle: this.env.X402_TESTNET_SETTLE, payTo: this.env.X402_PAY_TO })).fetch(req);
    // The mandate inspector's own instance holds only the RPC URL and the switch, inside the desk.
    if (path === METAL_INSPECTOR_PATH) return (this.metal ??= new MetalInspector(this.ctx.storage.sql, { rpcUrl: this.env.METAL_RPC_URL, off: inspectorOff(this.env.METAL_INSPECTOR) ? "switched off" : null, recorded: PAGES.metalRecorded ?? null })).fetch(req);
    // Purser Cloud's live Airwallex reads (./awxRead.ts): their own instance, reached only through the AwxRead entrypoint.
    if (path === AWX_READ_PATH) return this.awxReadDesk().fetch(req);
    // The reconciliation badge on /proof and Home (./awxBooks.ts): the same instance's reads, kept 5 minutes.
    // Its own instance ("awx-books"): it can only ask the gateway's instance for the financial view, and answers counts.
    if (isAwxBooksPath(path)) return awxBooksResponse(req, (this.awxBooks ??= booksCache(async () => (await this.env.RELAY.get(this.env.RELAY.idFromName("awx-read")).fetch(`https://relay.internal${AWX_READ_PATH}?view=financial`)).json())));
    if (path === "/api/try") return (this.tryDesk ??= new TryDesk(this.ctx.storage.sql, { anthropicKey: this.env.ANTHROPIC_API_KEY })).fetch(req);
    return (this.relay ??= new Relay(this.ctx.storage.sql, {
      relayToken: this.env.RELAY_TOKEN, webhookSecret: this.env.AIRWALLEX_WEBHOOK_SECRET, mfa: this.env.MFA_SESSIONS === "on", liveRun: this.env.LIVE_RUN === "on",
      // /health's live agents: read from the try-sign instance, where their spend is kept (code review, 13 Nov).
      liveAgents: async () => {
        const r = await this.env.RELAY.get(this.env.RELAY.idFromName("try-sign")).fetch(`https://relay.internal${LIVE_AGENTS_PATH}`);
        return r.ok ? ((await r.json()) as { usd: number; budget_usd: number }) : null;
      },
    })).fetch(req);
  }
}

/**
 * Purser Cloud's way to the Airwallex sandbox (14 Nov): a named entrypoint that only a service binding reaches
 * (cloud/wrangler.try.jsonc, AWX_READ with entrypoint "AwxRead"); no HTTP request can call it, and the Worker routes
 * no outside path to AWX_READ_PATH. It answers one read-only view at a time (./awxRead.ts): never a key, never a token.
 */
export class AwxRead extends WorkerEntrypoint<Env> {
  async read(view: string): Promise<AwxReadAnswer | { error: string }> {
    if (!isAwxView(view)) return { error: "no such view" };
    const r = await this.env.RELAY.get(this.env.RELAY.idFromName("awx-read")).fetch(`https://relay.internal${AWX_READ_PATH}?view=${view}`);
    return (await r.json()) as AwxReadAnswer;
  }

  /** The live Airwallex events feed (./awxEvents.ts): the same public answer /awx-live/events.json gives. */
  async events(): Promise<AwxEventsAnswer | { error: string }> {
    const r = await this.env.RELAY.get(this.env.RELAY.idFromName("relay")).fetch(`https://relay.internal${AWX_EVENTS_PATH}`);
    return r.ok ? ((await r.json()) as AwxEventsAnswer) : { error: "no answer" };
  }
}

/**
 * The named entrypoint purser-try binds to (cloud/wrangler.try.jsonc, AWX_FX): one method, a live Airwallex sandbox
 * quote for a test company, or a fixed reason. A named entrypoint has no public URL: only a Worker bound to it calls it.
 */
export class AwxFx extends WorkerEntrypoint<Env> {
  private payoutStub() {
    return this.env.RELAY.get(this.env.RELAY.idFromName("awx-payout"));
  }
  async quote(a: AwxFxAsk): Promise<AwxFxAnswer> {
    return this.env.RELAY.get(this.env.RELAY.idFromName("awx-fx")).awxFxQuote(a);
  }
  /** Step 2: one sandbox transfer for a test company's signed payment (worker/src/awxPayout.ts), or a fixed reason. */
  async payout(a: PayoutAsk): Promise<PayoutAnswer> {
    return this.payoutStub().awxPayoutCreate(a);
  }
  /** Step 2's labelled "Sandbox: move to PAID": the sandbox's own simulation of the company's transfer. */
  async payoutSimulate(a: { company: string; terms_sha256: string }): Promise<SimulateAnswer> {
    return this.payoutStub().awxPayoutSimulate(a);
  }
}

/**
 * The Airwallex gateway for Purser Cloud's actions (./awxGateway.ts): a named entrypoint, reached only through Purser
 * Cloud's service binding (cloud/wrangler.try.jsonc, AWX_GATEWAY), never by an HTTP request. Allow-listed calls to the
 * Airwallex sandbox only; writes need AWX_GATEWAY_WRITE=on.
 */
export class AwxGateway extends WorkerEntrypoint<Env> {
  private desk?: AwxGatewayDesk;
  async call(r: GatewayRequest): Promise<GatewayAnswer> {
    // Its own key when the owner set one (AWX_ACT_*), else the Worker's one sandbox key; the allow-list, AWX_GATEWAY_WRITE and
    // Purser Cloud's switch and caps stay the locks either way. The key is read here and handed to the desk only.
    const id = this.env.AWX_ACT_CLIENT_ID ?? this.env.AIRWALLEX_CLIENT_ID;
    const key = this.env.AWX_ACT_API_KEY ?? this.env.AIRWALLEX_API_KEY;
    return (this.desk ??= new AwxGatewayDesk({ AWX_ACT_CLIENT_ID: id, AWX_ACT_API_KEY: key, AWX_GATEWAY_WRITE: this.env.AWX_GATEWAY_WRITE })).call(r);
  }
}

/**
 * The agents' live sandbox cards (14 Nov): the named entrypoint purser-try binds to (cloud/wrangler.try.jsonc,
 * AWX_CARDS). No HTTP request reaches it. One method; every call to Airwallex on the card allow-list
 * (src/airwallex/cardGate.ts); the answer carries the last four digits at most, never a key, a token or card data.
 */
let cardsDesk: AwxCardsDesk | undefined;
export class AwxCards extends WorkerEntrypoint<Env> {
  async ask(a: CardsAsk): Promise<CardsAnswer> {
    cardsDesk ??= new AwxCardsDesk({ AIRWALLEX_CLIENT_ID: this.env.AIRWALLEX_CLIENT_ID, AIRWALLEX_API_KEY: this.env.AIRWALLEX_API_KEY, AWX_CARDS_WRITE: this.env.AWX_CARDS_WRITE });
    return cardsDesk.ask(a);
  }
}

export default {
  /** Hourly (wrangler.jsonc triggers.crons): the synthetic checks behind /status (src/ops/syntheticChecks.ts). */
  async scheduled(_controller, env, ctx): Promise<void> {
    ctx.waitUntil(env.RELAY.get(env.RELAY.idFromName("status")).statusRun().then(() => undefined));
  },
  async fetch(req, env): Promise<Response> {
    // /go: the short URL under the QR code, 302 to the hands-on demo (TRY_GO_URL, or its default).
    const go = goResponse(req, env.TRY_GO_URL);
    if (go) return go;
    // /airwallex's live block: the agents' cards at the Airwallex sandbox, read only, last four digits only (./agentCardsLive.ts).
    if (new URL(req.url).pathname === AGENT_CARDS_PATH && req.method === "GET") {
      cardsDesk ??= new AwxCardsDesk({ AIRWALLEX_CLIENT_ID: env.AIRWALLEX_CLIENT_ID, AIRWALLEX_API_KEY: env.AIRWALLEX_API_KEY, AWX_CARDS_WRITE: env.AWX_CARDS_WRITE });
      const desk = cardsDesk;
      const body = await agentCardsLive((a) => desk.ask(a), { off: (env.AWX_READ ?? "").trim().toLowerCase() === "off" });
      return Response.json(body, { headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } });
    }
    // /try and its page's calls, to purser-try when the binding is there (./tryEngine.ts): the request as it came.
    const tryEngine = tryEngineResponse(req, env.TRY_ENGINE);
    if (tryEngine) return tryEngine;
    // /status and /status.json: the hourly checks, read from their own instance (./statusDesk.ts).
    const status = await statusResponse(req, env);
    if (status) return status;
    const page = pageResponse(req, PAGES);
    if (page) return page;
    const path = new URL(req.url).pathname;
    // /try/sign's test worlds (TRY_SIGN_ENABLED, baked into the bundle): their own instance, their own tables; with
    // the feature off every one of its paths is a 404, before the relay sees it.
    const trySign = trySignRoute(path, PAGES);
    if (trySign) return trySign === "desk" ? env.RELAY.get(env.RELAY.idFromName("try-sign")).fetch(req) : trySignNotFound();
    if (path === X402_PATH) return env.RELAY.get(env.RELAY.idFromName("x402")).fetch(req);
    // /metal's mandate inspector in its own instance: its cache and its daily count of calls stay apart.
    if (path === METAL_INSPECTOR_PATH) return env.RELAY.get(env.RELAY.idFromName("metal-inspector")).fetch(req);
    // Try Purser runs in its own instance: its storage and its load stay apart from the approvals.
    if (path === "/api/try") return env.RELAY.get(env.RELAY.idFromName("try")).fetch(req);
    // /health and /health/live are the relay's too: it knows when the runner last synced (B7).
    // The live Airwallex badge (./awxBooks.ts): its own instance, which asks the gateway for one view; never the gateway itself.
    if (isAwxBooksPath(path)) return env.RELAY.get(env.RELAY.idFromName("awx-books")).fetch(req);
    if (path.startsWith("/api/") || path === "/hooks/airwallex" || path === AWX_EVENTS_PATH || path === "/health" || path === "/health/live") return env.RELAY.get(env.RELAY.idFromName("relay")).fetch(req);
    return notFoundResponse(PAGES);
  },
} satisfies ExportedHandler<Env>;

/** /status.json, and /status with its checks' card filled in, from the "status" instance; null for any other request. */
async function statusResponse(req: Request, env: Env): Promise<Response | null> {
  if (req.method !== "GET" && req.method !== "HEAD") return null;
  const path = new URL(req.url).pathname;
  if (path !== "/status" && path !== "/status.json") return null;
  let summary: StatusSummary | null = null;
  try {
    summary = await env.RELAY.get(env.RELAY.idFromName("status")).statusSummary();
  } catch {
    summary = null;
  }
  if (path === "/status.json") {
    return summary
      ? Response.json(summary, { headers: { ...COMMON_HEADERS, "content-type": "application/json; charset=utf-8" } })
      : Response.json({ error: "the hourly checks could not be read just now" }, { status: 503, headers: { ...COMMON_HEADERS, "content-type": "application/json; charset=utf-8" } });
  }
  return PAGES.status ? pageResponse(req, { ...PAGES, status: withChecks(PAGES.status, summary) }) : null;
}
