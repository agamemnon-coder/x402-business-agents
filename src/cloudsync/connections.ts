// The runner's side of the accounts a company connected to Purser by OAuth (docs/real-customers.md): its own Airwallex
// account and its Moneybird administration. Purser Cloud holds the refresh token, sealed for this company; the runner
// asks the cloud with its own sync key for a short-lived access token (GET /v1/connect/{provider}/token) and makes every
// call for this company with it. The cloud answers a key only with its own company's token, so a runner can never get
// another company's. The token is held in memory only: never written, never logged.
//
// Behind flags, off by default: AIRWALLEX_OAUTH=on (the payout rail uses the company's own token instead of an API
// key) and ERP_MONEYBIRD_OAUTH=on (the Moneybird connector uses it instead of ERP_MONEYBIRD_TOKEN).

import type { OAuthProviderName } from "../lib/oauth.js";
import type { AirwallexConfig } from "../airwallex/client.js";
import type { TokenProvider } from "../erp/auth.js";
import type { CloudTarget } from "./client.js";
import { ACCOUNT_ID } from "../airwallex/platform.js";
import { budgetFromEnv } from "../airwallex/callBudget.js";

type Env = Record<string, string | undefined>;

export const airwallexOAuthOn = (env: Env = process.env) => env.AIRWALLEX_OAUTH === "on";
export const moneybirdOAuthOn = (env: Env = process.env) => env.ERP_MONEYBIRD_OAUTH === "on";

/** A refused token request: the cloud's sentence (it never holds a token) and its status. */
export class ConnectionUnavailable extends Error {
  constructor(readonly status: number, message: string) { super(message); this.name = "ConnectionUnavailable"; }
}

/** Refetch this long before the token's end, so a call never starts with a token about to run out. */
const EARLY_MS = 30_000;

export interface CloudTokens extends TokenProvider {
  /** The account the token is for, as the cloud last said (Airwallex: acct_…; Moneybird: null). */
  account(): string | null;
}

/**
 * A token provider for one company's connected account, from Purser Cloud. `expectAccount` pins the Airwallex account:
 * a token the cloud says is for any other account is refused (the runner pays only from the account it knows).
 */
export function cloudTokens(t: CloudTarget, provider: OAuthProviderName, o: { now?: () => number; expectAccount?: string } = {}): CloudTokens {
  const now = o.now ?? Date.now;
  let held: { token: string; until: number; account: string | null } | null = null;
  return {
    async token() {
      if (held && held.until - EARLY_MS > now()) return held.token;
      held = null;
      const f = t.fetch ?? ((i, init) => fetch(i, init));
      const res = await f(`${t.url.replace(/\/$/, "")}/v1/connect/${provider}/token`, { method: "GET", headers: { authorization: `Bearer ${t.key}` } });
      const j = (await res.json().catch(() => ({}))) as { access_token?: unknown; expires_at?: unknown; account?: unknown; error?: unknown };
      if (!res.ok) throw new ConnectionUnavailable(res.status, `Purser Cloud gave no ${provider} token (${res.status}): ${typeof j.error === "string" ? j.error.slice(0, 200) : "no reason given"}`);
      if (typeof j.access_token !== "string" || !j.access_token) throw new ConnectionUnavailable(502, `Purser Cloud answered without a ${provider} token`);
      const account = typeof j.account === "string" ? j.account : null;
      if (provider === "airwallex") {
        if (!account || !ACCOUNT_ID.test(account)) throw new ConnectionUnavailable(502, "Purser Cloud did not say which Airwallex account the token is for");
        if (o.expectAccount && account !== o.expectAccount) throw new ConnectionUnavailable(409, `the connected Airwallex account is ${account}, not ${o.expectAccount}; nothing is called`);
      }
      const until = typeof j.expires_at === "string" && !Number.isNaN(Date.parse(j.expires_at)) ? Date.parse(j.expires_at) : now() + 10 * 60_000;
      held = { token: j.access_token, until, account };
      return j.access_token;
    },
    invalidate() { held = null; },
    account() { return held?.account ?? null; },
  };
}

/**
 * The Airwallex client configuration for this company's own connected account (AIRWALLEX_OAUTH=on): its token from
 * Purser Cloud, no API key, no on-behalf-of, and the run's call budget when one is set. Null with the flag off, so the
 * existing sandbox path (src/airwallex/client.ts fromEnv) is unchanged.
 */
export function airwallexOAuthConfig(t: CloudTarget | null, env: Env = process.env): AirwallexConfig | null {
  if (!airwallexOAuthOn(env)) return null;
  if (!t) throw new ConnectionUnavailable(400, "AIRWALLEX_OAUTH=on needs PURSER_CLOUD_URL and PURSER_CLOUD_KEY (the company's sync key)");
  const budgeted = budgetFromEnv(env, (...a) => fetch(...a));
  return { oauth: cloudTokens(t, "airwallex", env.AIRWALLEX_CONNECTED_ACCOUNT ? { expectAccount: env.AIRWALLEX_CONNECTED_ACCOUNT } : {}), ...(budgeted ? { fetchImpl: budgeted } : {}) };
}

/** The cloud target from the environment (PURSER_CLOUD_URL, PURSER_CLOUD_KEY), or null. */
export function cloudTargetFromEnv(env: Env = process.env): CloudTarget | null {
  return env.PURSER_CLOUD_URL && env.PURSER_CLOUD_KEY ? { url: env.PURSER_CLOUD_URL, key: env.PURSER_CLOUD_KEY } : null;
}
