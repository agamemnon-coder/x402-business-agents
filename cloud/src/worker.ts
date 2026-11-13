// The Worker's entry point: HTTP (the API), e-mail (Cloudflare Email Routing) and the scheduled job (retention purge,
// housekeeping, expired staged exports). Bindings and secrets come from cloud/wrangler.jsonc and `wrangler secret put`; nothing secret is in git.

import { ensureSchema, handle, type CloudEnv } from "./app.js";
import { receiveEmail, type InboundEmail } from "./mail.js";
import { purgeExpired } from "./privacy.js";
import { sweepExports } from "./exports.js";
import { d1Sql, r2Blobs, type D1Like, type R2Like } from "./store.js";
import { sqlBlobs } from "./blobsSql.js";
import { ENGINE_MODE, engineStubs, type EngineNamespace } from "./engine/client.js";
import { pruneAutopilot, runAutopilot } from "./edge/autopilot.js";
import { consumeMail, enqueueMail, requeueWaitingMail, type MailQueue, type QueuedMessage } from "./edge/inbox.js";
import { countsOf, countUp, pruneCounts, writeCounts } from "./edge/stats.js";
import { sweepTry } from "./try/sweep.js";
import { expireStale } from "./engine/spend.js";
import { logEvent } from "./log.js";
import type { ConnectEnv } from "./connect.js";
import { resendEmail, type AlertProviders } from "./alerts.js";
import { forRequest } from "./hostOrigin.js";

export interface Bindings {
  DB: D1Like;
  /** The documents' R2 bucket. Absent (a deployment without R2, cloud/wrangler.try.jsonc): they are kept in D1 (./blobsSql.ts). */
  DOCS?: R2Like;
  SESSION_SECRET: string;
  ADMIN_TOKEN_SHA256: string;
  RP_ID: string;
  ORIGIN: string;
  MAIL_DOMAIN?: string;
  /** The deployed version, shown by /v1/health (a var set at deploy, e.g. the commit). */
  VERSION?: string;
  /** Workers static assets (cloud/public, filled by npm run cloud:pdfjs): pdf.js for the console's invoice view. */
  ASSETS?: { fetch(req: Request): Promise<Response> };
  /** The company engines' Durable Object (cloud/src/engine/object.ts), and the switch that turns the /v1/engine routes on: "test_money". */
  ENGINE?: EngineNamespace;
  ENGINE_MODE?: string;
  /** "off": no nightly autopilot (cloud/src/edge/autopilot.ts). Unset: it runs with the daily job wherever the engine is on. */
  AUTOPILOT?: string;
  /** Cloudflare Queues: inbound e-mail filed into the company's engine (cloud/src/edge/inbox.ts). Unbound: mail waits for the runner. */
  INBOX_QUEUE?: MailQueue;
  /** "off": no daily counters, and GET /v1/stats answers 404 (cloud/src/edge/stats.ts). Unset: on. */
  STATS?: string;
  /** "on": the hands-on demo's routes (/v1/try, cloud/src/try/); at run time its switches decide, and a missing one is off. */
  HANDS_ON?: string;
  /** "on": the engine may call Claude (with its key, under the demo's caps). */
  ENGINE_CLAUDE?: string;
  /** The demo's own capped Claude key (a secret, set by hand on purser-try); only whether it is set is read here. */
  KIT11_ANTHROPIC_API_KEY?: string;
  /** The hands-on demo's bot check secret (cloud/src/try/botCheck.ts); a secret set by hand, read only by that check. */
  TRY_BOTCHECK_SECRET?: string;
  /**
   * Connecting a company's own accounts by OAuth (cloud/src/connect.ts, docs/real-customers.md), off unless
   * PURSER_OAUTH_CONNECT is "on": the sealing key (32 bytes, base64) and, per provider, the OAuth application Purser
   * registered there. All secrets (wrangler secret put); the redirect URI is <ORIGIN>/v1/connect/<provider>/callback.
   */
  PURSER_OAUTH_CONNECT?: string;
  OAUTH_TOKEN_KEY?: string;
  AIRWALLEX_OAUTH_CLIENT_ID?: string;
  AIRWALLEX_OAUTH_CLIENT_SECRET?: string;
  AIRWALLEX_PARTNER_WEBHOOK_SECRET?: string;
  MONEYBIRD_OAUTH_CLIENT_ID?: string;
  MONEYBIRD_OAUTH_CLIENT_SECRET?: string;
  /**
   * Approval alerts (cloud/src/alerts.ts). WhatsApp through Twilio: the account SID and auth token (secrets) and the
   * WhatsApp sender (the sandbox's number in a demo). E-mail through Resend: its API key (a secret) and the From address.
   * Unset: those channels record no_provider; Slack, Teams and the signed webhook need nothing here.
   * ALERTS_LIVE_MONEY "on" drops the [TEST MONEY] mark, for a company that pays with real money (none does yet).
   */
  TWILIO_ACCOUNT_SID?: string;
  TWILIO_AUTH_TOKEN?: string;
  TWILIO_WHATSAPP_FROM?: string;
  RESEND_API_KEY?: string;
  ALERT_EMAIL_FROM?: string;
  ALERTS_LIVE_MONEY?: string;
}

/** What approval alerts are sent with: Twilio for WhatsApp and Resend for e-mail, each only when all its settings are there. */
export function alertsOf(b: Bindings): AlertProviders {
  const out = (url: string, init: RequestInit) => fetch(url, init);
  return {
    ...(b.TWILIO_ACCOUNT_SID && b.TWILIO_AUTH_TOKEN && b.TWILIO_WHATSAPP_FROM ? { twilio: { accountSid: b.TWILIO_ACCOUNT_SID, authToken: b.TWILIO_AUTH_TOKEN, whatsappFrom: b.TWILIO_WHATSAPP_FROM } } : {}),
    ...(b.RESEND_API_KEY && b.ALERT_EMAIL_FROM ? { email: resendEmail({ apiKey: b.RESEND_API_KEY, from: b.ALERT_EMAIL_FROM }, out) } : {}),
    testMoney: b.ALERTS_LIVE_MONEY !== "on",
  };
}

/** The OAuth connection configuration, or none (the default: the /v1/connect routes answer 404). */
export function connectOf(b: Bindings): ConnectEnv | undefined {
  if (b.PURSER_OAUTH_CONNECT !== "on") return undefined;
  if (!b.OAUTH_TOKEN_KEY) throw new Error("PURSER_OAUTH_CONNECT is on but OAUTH_TOKEN_KEY is not set (wrangler secret put OAUTH_TOKEN_KEY)");
  const client = (provider: string, id?: string, secret?: string) => (id && secret ? { clientId: id, clientSecret: secret, redirectUri: `${b.ORIGIN.replace(/\/$/, "")}/v1/connect/${provider}/callback` } : undefined);
  const airwallex = client("airwallex", b.AIRWALLEX_OAUTH_CLIENT_ID, b.AIRWALLEX_OAUTH_CLIENT_SECRET);
  const moneybird = client("moneybird", b.MONEYBIRD_OAUTH_CLIENT_ID, b.MONEYBIRD_OAUTH_CLIENT_SECRET);
  return { tokenKey: b.OAUTH_TOKEN_KEY, fetch: (i, init) => fetch(i, init), clients: { ...(airwallex ? { airwallex } : {}), ...(moneybird ? { moneybird } : {}) },
    ...(b.AIRWALLEX_PARTNER_WEBHOOK_SECRET ? { airwallexWebhookSecret: b.AIRWALLEX_PARTNER_WEBHOOK_SECRET } : {}) };
}

/** The part of the Workers runtime's ExecutionContext used here: work that may finish after the answer is sent. */
interface Waits { waitUntil(p: Promise<unknown>): void }

function envOf(b: Bindings): CloudEnv {
  if (!b.SESSION_SECRET || b.SESSION_SECRET.length < 32) throw new Error("SESSION_SECRET is not set (wrangler secret put SESSION_SECRET)");
  const assets = b.ASSETS;
  const sql = d1Sql(b.DB);
  const connect = connectOf(b);
  return { sql, blobs: b.DOCS ? r2Blobs(b.DOCS) : sqlBlobs(sql), sessionSecret: b.SESSION_SECRET, adminTokenSha256: b.ADMIN_TOKEN_SHA256 ?? "", rpId: b.RP_ID, origin: b.ORIGIN, mailDomain: b.MAIL_DOMAIN ?? "",
    version: b.VERSION ?? "dev", outbound: (url: string, init: RequestInit) => fetch(url, init),
    ...(assets ? { asset: async (path: string) => assets.fetch(new Request(new URL(path, b.ORIGIN))) } : {}),
    ...(b.ENGINE && b.ENGINE_MODE === ENGINE_MODE ? { engine: engineStubs(b.ENGINE), ...(b.HANDS_ON === "on" ? { tryIt: { claude: b.ENGINE_CLAUDE === "on" && !!b.KIT11_ANTHROPIC_API_KEY, ...(b.TRY_BOTCHECK_SECRET ? { botSecret: b.TRY_BOTCHECK_SECRET } : {}) } } : {}) } : {}),
    edge: { stats: b.STATS !== "off" }, ...(connect ? { connect } : {}), alerts: alertsOf(b) };
}

export default {
  async fetch(req: Request, b: Bindings, ctx?: Waits): Promise<Response> {
    // The passkeys' relying party and the same-origin check follow the request's host when it is allowed (./hostOrigin.ts).
    const env = forRequest(envOf(b), req);
    // Work that may finish after the answer (approval alerts after a runner's push, final review S4).
    if (ctx) env.waitUntil = (p) => ctx.waitUntil(p);
    const res = await handle(req, env);
    // The day's counters, after the answer is sent (cloud/src/edge/stats.ts); a counter that fails never fails the request.
    if (env.edge?.stats && ctx) {
      const counted = countsOf(req, res).then((m) => countUp(env.sql, m, new Date(), b.DB))
        .catch((e: unknown) => logEvent("warn", "stats_not_counted", { error: e instanceof Error ? e.message.slice(0, 200) : "unknown" }));
      ctx.waitUntil(counted);
    }
    return res;
  },
  async email(msg: InboundEmail, b: Bindings): Promise<void> {
    const env = envOf(b);
    await ensureSchema(env.sql);
    const got = await receiveEmail(env.sql, env.blobs, msg, { domain: b.MAIL_DOMAIN ?? "", now: new Date() });
    // Where the cloud runs the engine, the stored e-mail goes on the queue to be filed there (cloud/src/edge/inbox.ts).
    // A send that fails is logged; the daily job puts e-mail still waiting after an hour on the queue again.
    if (got.queued && got.id && env.engine && b.INBOX_QUEUE) {
      try { await enqueueMail(env.sql, b.INBOX_QUEUE, { to: msg.to, domain: b.MAIL_DOMAIN ?? "", mailId: got.id }); } catch (e) {
        logEvent("warn", "inbox_not_queued", { error: e instanceof Error ? e.message.slice(0, 200) : "unknown" });
      }
    }
  },
  /** INBOX_QUEUE's consumer: each e-mail filed into the company's engine, retried later, or marked refused. */
  async queue(batch: { messages: readonly QueuedMessage[] }, b: Bindings): Promise<void> {
    const env = envOf(b);
    await ensureSchema(env.sql);
    // No engine here (switched off since): the e-mail stays queued in the database for the company's runner.
    if (!env.engine) { for (const m of batch.messages) m.ack(); return; }
    await consumeMail({ sql: env.sql, blobs: env.blobs, engine: env.engine }, batch.messages);
  },
  async scheduled(_event: unknown, b: Bindings): Promise<void> {
    const env = envOf(b);
    await ensureSchema(env.sql);
    // The hands-on deployment: visitors' companies past their 24 hours are wiped (cloud/src/try/sweep.ts), whatever
    // the other jobs do: it runs first and on its own, so neither of them failing can skip it.
    if (env.tryIt) {
      // Lane A's Claude reservations older than ten minutes are closed at their full amount (cloud/src/engine/spend.ts).
      try { await sweepTry({ sql: env.sql, blobs: env.blobs, ...(env.engine ? { engine: env.engine } : {}), settle: expireStale, now: new Date() }); } catch (e) {
        logEvent("error", "try_sweep_failed", { error: e instanceof Error ? e.message : String(e) });
      }
    }
    await purgeExpired(env.sql, env.blobs, new Date(), env.engine);
    // Staged exports past their day lose their parts (a request for the company does the same on its way).
    await sweepExports(env.sql, env.blobs, new Date());
    // Cloudflare's platform (cloud/src/edge/), after the purge and the sweep and each on its own: one that fails is
    // logged and never keeps the others from running.
    const edge = async (event: string, run: () => Promise<unknown>) => {
      try { await run(); } catch (e) { logEvent("error", event, { error: e instanceof Error ? e.message.slice(0, 300) : "unknown" }); }
    };
    // The nightly autopilot (cloud/src/edge/autopilot.ts): each company's engine synced and its digest written, once a day.
    if (env.engine && b.AUTOPILOT !== "off") await edge("autopilot_failed", () => runAutopilot(env.sql, env.engine!, { now: new Date() }));
    await edge("autopilot_prune_failed", () => pruneAutopilot(env.sql, new Date()));
    if (env.engine && b.INBOX_QUEUE) await edge("inbox_requeue_failed", () => requeueWaitingMail(env.sql, b.INBOX_QUEUE!, new Date()));
    if (env.edge?.stats) {
      await edge("stats_write_failed", () => writeCounts(env.sql, new Date(), b.DB));
      await edge("stats_prune_failed", () => pruneCounts(env.sql, new Date()));
    }
  },
};
