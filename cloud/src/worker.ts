// The Worker's entry point: HTTP (the API), e-mail (Cloudflare Email Routing) and the scheduled job (retention purge,
// housekeeping, expired staged exports). Bindings and secrets come from cloud/wrangler.jsonc and `wrangler secret put`; nothing secret is in git.

import { ensureSchema, handle, type CloudEnv } from "./app.js";
import { randomToken } from "./crypto.js";
import { DEMO_MAIL_REFUSAL, demoFromVars, type DemoCache, type DemoEnv } from "./demo.js";
import { receiveEmail, type InboundEmail } from "./mail.js";
import { purgeExpired } from "./privacy.js";
import { sweepExports } from "./exports.js";
import { d1Sql, r2Blobs, type D1Like, type R2Like } from "./store.js";

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
  /**
   * The public demo mode (cloud/src/demo.ts), for a deployment of its own that holds seeded test companies only:
   * DEMO_PUBLIC "on" switches it on, DEMO_SLUGS names the demo companies (their addresses, separated by commas).
   * Unset (every other deployment): nothing changes. A demo deployment needs no secret: SESSION_SECRET and
   * ADMIN_TOKEN_SHA256 are not used there, and MAIL_DOMAIN is ignored.
   */
  DEMO_PUBLIC?: string;
  DEMO_SLUGS?: string;
}

/** Demo mode's state lives as long as the isolate (its limits and remembered answers are in memory), not one request. */
let demoOnce: { vars: string; demo: DemoEnv | undefined } | null = null;
function demoOf(b: Bindings): DemoEnv | undefined {
  const vars = `${b.DEMO_PUBLIC ?? ""}\n${b.DEMO_SLUGS ?? ""}`;
  if (!demoOnce || demoOnce.vars !== vars) {
    // Cloudflare's edge cache, where the runtime has one (cloud/src/demo.ts: a saving on top of the isolate's own memory).
    const cache = (globalThis as { caches?: { default?: DemoCache } }).caches?.default;
    demoOnce = { vars, demo: demoFromVars(b, cache ? { cache } : {}) };
  }
  return demoOnce.demo;
}

function envOf(b: Bindings): CloudEnv {
  const demo = demoOf(b);
  const assets = b.ASSETS;
  const asset = assets ? { asset: async (path: string) => assets.fetch(new Request(new URL(path, b.ORIGIN))) } : {};
  // A public demo signs nobody in, has no platform operator, takes no mail and sends no webhook: it gets a session
  // secret nobody knows (new in every isolate), no platform token and no mail domain, whatever the deployment holds.
  if (demo) return { sql: d1Sql(b.DB), blobs: r2Blobs(b.DOCS), sessionSecret: randomToken(32), adminTokenSha256: "", rpId: b.RP_ID, origin: b.ORIGIN, mailDomain: "", version: b.VERSION ?? "dev", demo, ...asset };
  if (!b.SESSION_SECRET || b.SESSION_SECRET.length < 32) throw new Error("SESSION_SECRET is not set (wrangler secret put SESSION_SECRET)");
  return { sql: d1Sql(b.DB), blobs: r2Blobs(b.DOCS), sessionSecret: b.SESSION_SECRET, adminTokenSha256: b.ADMIN_TOKEN_SHA256 ?? "", rpId: b.RP_ID, origin: b.ORIGIN, mailDomain: b.MAIL_DOMAIN ?? "",
    version: b.VERSION ?? "dev", outbound: (url: string, init: RequestInit) => fetch(url, init), ...asset };
}

export default {
  fetch(req: Request, b: Bindings): Promise<Response> {
    return handle(req, envOf(b));
  },
  async email(msg: InboundEmail, b: Bindings): Promise<void> {
    const env = envOf(b);
    // A public demo takes no mail: refused at the door, nothing stored.
    if (env.demo) { msg.setReject(DEMO_MAIL_REFUSAL); return; }
    await ensureSchema(env.sql);
    await receiveEmail(env.sql, env.blobs, msg, { domain: b.MAIL_DOMAIN ?? "", now: new Date() });
  },
  async scheduled(_event: unknown, b: Bindings): Promise<void> {
    const env = envOf(b);
    // A public demo writes nothing, on a schedule or otherwise: its data is what the seed loaded.
    if (env.demo) return;
    await ensureSchema(env.sql);
    await purgeExpired(env.sql, env.blobs, new Date());
    // Staged exports past their day lose their parts (a request for the company does the same on its way).
    await sweepExports(env.sql, env.blobs, new Date());
  },
};
