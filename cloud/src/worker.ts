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
import { logEvent } from "./log.js";

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
}

/** The part of the Workers runtime's ExecutionContext used here: work that may finish after the answer is sent. */
interface Waits { waitUntil(p: Promise<unknown>): void }

function envOf(b: Bindings): CloudEnv {
  if (!b.SESSION_SECRET || b.SESSION_SECRET.length < 32) throw new Error("SESSION_SECRET is not set (wrangler secret put SESSION_SECRET)");
  const assets = b.ASSETS;
  const sql = d1Sql(b.DB);
  return { sql, blobs: b.DOCS ? r2Blobs(b.DOCS) : sqlBlobs(sql), sessionSecret: b.SESSION_SECRET, adminTokenSha256: b.ADMIN_TOKEN_SHA256 ?? "", rpId: b.RP_ID, origin: b.ORIGIN, mailDomain: b.MAIL_DOMAIN ?? "",
    version: b.VERSION ?? "dev", outbound: (url: string, init: RequestInit) => fetch(url, init),
    ...(assets ? { asset: async (path: string) => assets.fetch(new Request(new URL(path, b.ORIGIN))) } : {}),
    ...(b.ENGINE && b.ENGINE_MODE === ENGINE_MODE ? { engine: engineStubs(b.ENGINE) } : {}),
    edge: { stats: b.STATS !== "off" } };
}

export default {
  async fetch(req: Request, b: Bindings, ctx?: Waits): Promise<Response> {
    const env = envOf(b);
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
