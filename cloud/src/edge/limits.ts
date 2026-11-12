// Cloudflare's Rate Limiting binding in front of what costs (developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit):
// a company's writes to its engine (an upload is read and checked, a payment is filed, an approval pays on the stand-in
// bank) and anyone's calls to the public routes. It counts at Cloudflare's edge, in memory, without a database write,
// before the route runs; the cloud's own per-key limit in D1 (cloud/src/auth.ts withinRate) stays as it is behind it.
//
// Off unless bound: without ENGINE_LIMITER or PUBLIC_LIMITER in the Worker (cloud/wrangler.jsonc ratelimits) nothing
// here refuses anything. The binding's counts are approximate and per Cloudflare location (its docs say so): a guard
// against a script or a crowd, not an exact quota. A binding that throws lets the request through (logged): the D1
// limit still holds.
//
// An address is never handed over as it is: an IPv6 address is cut to its /64 (one host can change its last 64 bits at
// will), an IPv4 address is taken whole, and the key is a SHA-256 of that with the deployment's prefix.
import { sha256Hex } from "../crypto.js";
import { logEvent } from "../log.js";

/** The Rate Limiting binding's one method. */
export interface RateLimiter { limit(o: { key: string }): Promise<{ success: boolean }> }

export interface EdgeLimits {
  /** Per company: its writes to /v1/engine (cloud/wrangler.jsonc: ENGINE_LIMITER). */
  engineWrites?: RateLimiter;
  /** Per address: the routes anyone may call (cloud/wrangler.jsonc: PUBLIC_LIMITER). */
  publicCalls?: RateLimiter;
  /** Put before every key, so two deployments that share a namespace do not share counts (the deployment's host). */
  prefix?: string;
}

/** A write to the company's engine: every POST under /v1/engine/. */
export const isEngineWrite = (method: string, route: string): boolean => method === "POST" && route.startsWith("/v1/engine/");

/**
 * Whether the request may go on, by the edge's counts: null when it may, else the sentence of a 429. `route` is the
 * route table's pattern, `need` what it needs; the company is the caller's, the address Cloudflare's cf-connecting-ip.
 */
export async function edgeRefusal(limits: EdgeLimits | undefined, a: { method: string; route: string; need: string; tenantId: string | null; ip: string }): Promise<string | null> {
  if (!limits) return null;
  const at = limits.prefix ? `${limits.prefix}|` : "";
  if (limits.engineWrites && a.tenantId && isEngineWrite(a.method, a.route)) {
    if (!(await allowed(limits.engineWrites, `${at}engine:${a.tenantId}`))) return "too many uploads, payments or approvals for this company in a minute; wait a minute";
  }
  if (limits.publicCalls && a.need === "public") {
    if (!(await allowed(limits.publicCalls, `${at}public:${await sha256Hex(`${at}${addressOf(a.ip)}`)}`))) return "too many requests from this address; wait a minute";
  }
  return null;
}

/** The part of an address that names one subscriber: an IPv6 address's first 64 bits, an IPv4 address whole. */
export function addressOf(ip: string): string {
  if (!ip.includes(":")) return ip;
  // An IPv4 address written as IPv6 (::ffff:192.0.2.1) is that IPv4 address.
  if (ip.includes(".")) return ip.slice(ip.lastIndexOf(":") + 1);
  const [head = "", tail] = ip.toLowerCase().split("%")[0]!.split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const groups = tail === undefined ? left : [...left, ...Array<string>(Math.max(0, 8 - left.length - right.length)).fill("0"), ...right];
  return `${groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, "")).join(":")}::/64`;
}

async function allowed(limiter: RateLimiter, key: string): Promise<boolean> {
  try {
    return (await limiter.limit({ key })).success;
  } catch (e) {
    logEvent("warn", "edge_rate_limit_unavailable", { error: e instanceof Error ? e.message.slice(0, 200) : "unknown" });
    return true;
  }
}
