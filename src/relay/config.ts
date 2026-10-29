// Where the runner finds the relay Worker and how it proves itself to it. The address is the Worker's fixed
// workers.dev host (read from the Cloudflare account unless KIT11_RELAY_URL is set); it is also the passkeys'
// origin and rpId. The bearer token is KIT11_RELAY_TOKEN, or else derived from the Cloudflare API token: whoever
// holds that token can redeploy the Worker anyway, so the derived token adds no new trust and needs no new secret.

import { createHmac } from "node:crypto";

/** The Worker's name in worker/wrangler.jsonc; its address is https://<name>.<subdomain>.workers.dev. */
export const WORKER_NAME = "kit11";

export interface RelayConfig {
  url: string;
  origin: string;
  rpId: string;
  token: string;
}

type Env = Record<string, string | undefined>;

export function relayToken(env: Env = process.env): string | null {
  if (env.KIT11_RELAY_TOKEN) return env.KIT11_RELAY_TOKEN;
  if (env.CLOUDFLARE_API_TOKEN) return createHmac("sha256", env.CLOUDFLARE_API_TOKEN).update("kit11 relay token v1").digest("hex");
  return null;
}

/**
 * The viewer key (security review M2): the relay serves its data and takes the phone's submissions only with it.
 * Derived from the relay token, so the Worker computes it from the secret it already has (worker/src/core.ts).
 * The CFO gets it once as a link with the key in the #fragment, which browsers never send to a server.
 */
export function viewKey(token: string): string {
  return createHmac("sha256", token).update("kit11 view v1").digest("hex").slice(0, 32);
}

/** The link that hands the phone its viewer key and pins the runner's display key (src/relay/sign.ts). */
export const viewerLink = (cfg: RelayConfig, runnerSpki?: string): string =>
  `${cfg.url}/#view=${viewKey(cfg.token)}${runnerSpki ? `&runner=${runnerSpki}` : ""}`;

async function workersDevUrl(env: Env, fetchImpl: typeof fetch): Promise<string> {
  const account = env.CLOUDFLARE_ACCOUNT_ID;
  const token = env.CLOUDFLARE_API_TOKEN;
  if (!account || !token) throw new Error("set KIT11_RELAY_URL, or CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN so the Worker's address can be looked up");
  const res = await fetchImpl(`https://api.cloudflare.com/client/v4/accounts/${account}/workers/subdomain`, { headers: { authorization: `Bearer ${token}` } });
  const body = (await res.json().catch(() => ({}))) as { success?: boolean; result?: { subdomain?: string }; errors?: { message?: string }[] };
  const sub = body.result?.subdomain;
  if (!res.ok || !body.success || !sub) {
    throw new Error(`Cloudflare did not return the workers.dev subdomain (${res.status}: ${(body.errors ?? []).map((e) => e.message).join("; ") || "no detail"})`);
  }
  return `https://${WORKER_NAME}.${sub}.workers.dev`;
}

export async function relayConfig(env: Env = process.env, fetchImpl: typeof fetch = fetch): Promise<RelayConfig> {
  const url = new URL(env.KIT11_RELAY_URL ?? (await workersDevUrl(env, fetchImpl)));
  const token = relayToken(env);
  if (!token) throw new Error("set KIT11_RELAY_TOKEN or CLOUDFLARE_API_TOKEN: the runner needs a token for the relay");
  return { url: url.origin, origin: url.origin, rpId: url.hostname, token };
}
