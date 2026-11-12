// The Worker's entry point: HTTP (the API), e-mail (Cloudflare Email Routing) and the scheduled job (retention purge,
// housekeeping, expired staged exports). Bindings and secrets come from cloud/wrangler.jsonc and `wrangler secret put`; nothing secret is in git.

import { ensureSchema, handle, type CloudEnv } from "./app.js";
import { receiveEmail, type InboundEmail } from "./mail.js";
import { purgeExpired } from "./privacy.js";
import { sweepExports } from "./exports.js";
import { d1Sql, r2Blobs, type D1Like, type R2Like } from "./store.js";
import { sqlBlobs } from "./blobsSql.js";
import { ENGINE_MODE, engineStubs, type EngineNamespace } from "./engine/client.js";
import { sweepTry } from "./try/sweep.js";
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
  /** "on": the hands-on demo's routes (/v1/try, cloud/src/try/); at run time its switches decide, and a missing one is off. */
  HANDS_ON?: string;
  /** "on": the engine may call Claude (with its key, under the demo's caps). */
  ENGINE_CLAUDE?: string;
  /** The demo's own capped Claude key (a secret, set by hand on purser-try); only whether it is set is read here. */
  KIT11_ANTHROPIC_API_KEY?: string;
}

function envOf(b: Bindings): CloudEnv {
  if (!b.SESSION_SECRET || b.SESSION_SECRET.length < 32) throw new Error("SESSION_SECRET is not set (wrangler secret put SESSION_SECRET)");
  const assets = b.ASSETS;
  const sql = d1Sql(b.DB);
  return { sql, blobs: b.DOCS ? r2Blobs(b.DOCS) : sqlBlobs(sql), sessionSecret: b.SESSION_SECRET, adminTokenSha256: b.ADMIN_TOKEN_SHA256 ?? "", rpId: b.RP_ID, origin: b.ORIGIN, mailDomain: b.MAIL_DOMAIN ?? "",
    version: b.VERSION ?? "dev", outbound: (url: string, init: RequestInit) => fetch(url, init),
    ...(assets ? { asset: async (path: string) => assets.fetch(new Request(new URL(path, b.ORIGIN))) } : {}),
    ...(b.ENGINE && b.ENGINE_MODE === ENGINE_MODE ? { engine: engineStubs(b.ENGINE), ...(b.HANDS_ON === "on" ? { tryIt: { claude: b.ENGINE_CLAUDE === "on" && !!b.KIT11_ANTHROPIC_API_KEY } } : {}) } : {}) };
}

export default {
  fetch(req: Request, b: Bindings): Promise<Response> {
    return handle(req, envOf(b));
  },
  async email(msg: InboundEmail, b: Bindings): Promise<void> {
    const env = envOf(b);
    await ensureSchema(env.sql);
    await receiveEmail(env.sql, env.blobs, msg, { domain: b.MAIL_DOMAIN ?? "", now: new Date() });
  },
  async scheduled(_event: unknown, b: Bindings): Promise<void> {
    const env = envOf(b);
    await ensureSchema(env.sql);
    // The hands-on deployment: visitors' companies past their 24 hours are wiped (cloud/src/try/sweep.ts), whatever
    // the other jobs do: it runs first and on its own, so neither of them failing can skip it.
    if (env.tryIt) {
      try { await sweepTry({ sql: env.sql, blobs: env.blobs, ...(env.engine ? { engine: env.engine } : {}), now: new Date() }); } catch (e) {
        logEvent("error", "try_sweep_failed", { error: e instanceof Error ? e.message : String(e) });
      }
    }
    await purgeExpired(env.sql, env.blobs, new Date(), env.engine);
    // Staged exports past their day lose their parts (a request for the company does the same on its way).
    await sweepExports(env.sql, env.blobs, new Date());
  },
};
