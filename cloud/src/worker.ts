// The Worker's entry point: HTTP (the API), e-mail (Cloudflare Email Routing) and the scheduled job (retention purge,
// housekeeping, expired staged exports). Bindings and secrets come from cloud/wrangler.jsonc and `wrangler secret put`; nothing secret is in git.

import { ensureSchema, handle, type CloudEnv } from "./app.js";
import { receiveEmail, type InboundEmail } from "./mail.js";
import { purgeExpired } from "./privacy.js";
import { sweepExports } from "./exports.js";
import { d1Sql, r2Blobs, type D1Like, type R2Like } from "./store.js";
import type { ConnectEnv } from "./connect.js";

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

function envOf(b: Bindings): CloudEnv {
  if (!b.SESSION_SECRET || b.SESSION_SECRET.length < 32) throw new Error("SESSION_SECRET is not set (wrangler secret put SESSION_SECRET)");
  const assets = b.ASSETS;
  const connect = connectOf(b);
  return { sql: d1Sql(b.DB), blobs: r2Blobs(b.DOCS), sessionSecret: b.SESSION_SECRET, adminTokenSha256: b.ADMIN_TOKEN_SHA256 ?? "", rpId: b.RP_ID, origin: b.ORIGIN, mailDomain: b.MAIL_DOMAIN ?? "",
    version: b.VERSION ?? "dev", outbound: (url: string, init: RequestInit) => fetch(url, init),
    ...(assets ? { asset: async (path: string) => assets.fetch(new Request(new URL(path, b.ORIGIN))) } : {}), ...(connect ? { connect } : {}) };
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
    await purgeExpired(env.sql, env.blobs, new Date());
    // Staged exports past their day lose their parts (a request for the company does the same on its way).
    await sweepExports(env.sql, env.blobs, new Date());
  },
};
