// The Worker's entry point: HTTP (the API), e-mail (Cloudflare Email Routing) and the scheduled job (retention purge,
// housekeeping, expired staged exports). Bindings and secrets come from cloud/wrangler.jsonc and `wrangler secret put`; nothing secret is in git.

import { ensureSchema, handle, type CloudEnv } from "./app.js";
import { receiveEmail, type InboundEmail } from "./mail.js";
import { purgeExpired } from "./privacy.js";
import { sweepExports } from "./exports.js";
import { d1Sql, r2Blobs, type D1Like, type R2Like } from "./store.js";
import { ENGINE_MODE, engineStubs, type EngineNamespace } from "./engine/client.js";
import type { RateLimiter } from "./edge/limits.js";
import { runAutopilot } from "./edge/autopilot.js";
import { countsOf, countUp, pruneCounts } from "./edge/stats.js";
import { logEvent } from "./log.js";

export interface Bindings {
  DB: D1Like;
  DOCS: R2Like;
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
  /** Cloudflare's Rate Limiting bindings (cloud/wrangler.jsonc ratelimits; cloud/src/edge/limits.ts): per company on its engine writes, per address on the public routes. */
  ENGINE_LIMITER?: RateLimiter;
  PUBLIC_LIMITER?: RateLimiter;
  /** "off": no nightly autopilot (cloud/src/edge/autopilot.ts). Unset: it runs with the daily job wherever the engine is on. */
  AUTOPILOT?: string;
  /** "off": no daily counters, and GET /v1/stats answers 404 (cloud/src/edge/stats.ts). Unset: on. */
  STATS?: string;
}

/** The part of the Workers runtime's ExecutionContext used here: work that may finish after the answer is sent. */
interface Waits { waitUntil(p: Promise<unknown>): void }

function envOf(b: Bindings): CloudEnv {
  if (!b.SESSION_SECRET || b.SESSION_SECRET.length < 32) throw new Error("SESSION_SECRET is not set (wrangler secret put SESSION_SECRET)");
  const assets = b.ASSETS;
  return { sql: d1Sql(b.DB), blobs: r2Blobs(b.DOCS), sessionSecret: b.SESSION_SECRET, adminTokenSha256: b.ADMIN_TOKEN_SHA256 ?? "", rpId: b.RP_ID, origin: b.ORIGIN, mailDomain: b.MAIL_DOMAIN ?? "",
    version: b.VERSION ?? "dev", outbound: (url: string, init: RequestInit) => fetch(url, init),
    ...(assets ? { asset: async (path: string) => assets.fetch(new Request(new URL(path, b.ORIGIN))) } : {}),
    ...(b.ENGINE && b.ENGINE_MODE === ENGINE_MODE ? { engine: engineStubs(b.ENGINE) } : {}),
    edge: { limits: { ...(b.ENGINE_LIMITER ? { engineWrites: b.ENGINE_LIMITER } : {}), ...(b.PUBLIC_LIMITER ? { publicCalls: b.PUBLIC_LIMITER } : {}), prefix: b.RP_ID }, stats: b.STATS !== "off" } };
}

export default {
  async fetch(req: Request, b: Bindings, ctx?: Waits): Promise<Response> {
    const env = envOf(b);
    const res = await handle(req, env);
    // The day's counters, after the answer is sent (cloud/src/edge/stats.ts); a counter that fails never fails the request.
    if (env.edge?.stats && ctx) {
      const counted = countsOf(req, res).then((m) => countUp(env.sql, m, new Date()))
        .catch((e: unknown) => logEvent("warn", "stats_not_counted", { error: e instanceof Error ? e.message.slice(0, 200) : "unknown" }));
      ctx.waitUntil(counted);
    }
    return res;
  },
  async email(msg: InboundEmail, b: Bindings): Promise<void> {
    const env = envOf(b);
    await ensureSchema(env.sql);
    await receiveEmail(env.sql, env.blobs, msg, { domain: b.MAIL_DOMAIN ?? "", now: new Date() });
  },
  async scheduled(_event: unknown, b: Bindings): Promise<void> {
    const env = envOf(b);
    await ensureSchema(env.sql);
    await purgeExpired(env.sql, env.blobs, new Date(), env.engine);
    // Staged exports past their day lose their parts (a request for the company does the same on its way).
    await sweepExports(env.sql, env.blobs, new Date());
    // The nightly autopilot (cloud/src/edge/autopilot.ts): each company's engine synced and its digest written, once a day.
    if (env.engine && b.AUTOPILOT !== "off") await runAutopilot(env.sql, env.engine, { now: new Date() });
    if (env.edge?.stats) await pruneCounts(env.sql, new Date());
  },
};
