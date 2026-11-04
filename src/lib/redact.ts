// One redactor for every text that leaves the runner: audit rows (which feed the dashboard and the public relay),
// the verdicts sent to the phone, and log lines (security review M1). viem, for one, quotes the RPC URL in its
// errors, and the Metal RPC URL is a credential.

import { relayToken, viewKey, viewKeyWeekly } from "../relay/config.js";

/** Environment values that are credentials. Only values of 8 characters or more are matched. */
const SECRET_ENV = [
  "METAL_RPC_URL", "METAL_ENDPOINT_SECRET", "AIRWALLEX_CLIENT_ID", "AIRWALLEX_API_KEY", "KIT11_ANTHROPIC_API_KEY",
  "CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID", "KIT11_RELAY_TOKEN",
];

export function redactSecrets(text: string, env: NodeJS.ProcessEnv = process.env): string {
  let out = text;
  const rpc = env.METAL_RPC_URL;
  if (rpc && rpc.length >= 8) {
    out = out.split(rpc).join("[rpc-url]");
    // The endpoint id on its own (the URL's last path segment) is the credential part.
    const id = rpc.replace(/\/+$/, "").split("/").pop() ?? "";
    if (id.length >= 12) out = out.split(id).join("[redacted]");
  }
  for (const name of SECRET_ENV) {
    const v = env[name];
    if (v && v.length >= 8) out = out.split(v).join("[redacted]");
  }
  // Derived secrets: the relay token (from the Cloudflare token unless set) and the viewer key (review N7).
  // A local relay token kept across restarts (KIT11_LOCAL_RELAY_TOKEN, the dry run) is one too, with its viewer key.
  for (const token of [relayToken(env), env.KIT11_LOCAL_RELAY_TOKEN]) {
    // D20: the weekly viewer keys too (this week's and last week's).
    if (token && token.length >= 8) for (const v of [token, viewKey(token), viewKeyWeekly(token), viewKeyWeekly(token, new Date(Date.now() - 7 * 864e5))]) out = out.split(v).join("[redacted]");
  }
  return out
    .replace(/https:\/\/rpc-testnet\.metalntwx\.com\/\S*/g, "[rpc-url]")
    .replace(/\/v1\/[A-Za-z0-9_-]{16,}/g, "/v1/[redacted]")
    .replace(/\b(Bearer)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 [redacted]");
}

/** The same over every string inside a JSON value. */
export function redactJson<T>(value: T, env: NodeJS.ProcessEnv = process.env): T {
  if (typeof value === "string") return redactSecrets(value, env) as T;
  if (Array.isArray(value)) return value.map((v) => redactJson(v, env)) as T;
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redactJson(v, env)])) as T;
  return value;
}
