// Phase D: Max's own hub (a Worker) and his Cardputer. Two switches, both off by default:
//   HUB_PUSH_ENABLED=on       Purser pushes its last runs to the hub (src/hub/push.ts)
//   HUB_DECISIONS_ENABLED=on  the hub's decision is an extra gate before an approved proposal runs (src/hub/gate.ts)
// The hub's address (HUB_URL) and its token (HUB_PUSH_TOKEN) come from the environment only. Neither is ever logged,
// stored in the ledger, or sent anywhere but in the request to the hub itself.

const on = (v: string | undefined) => v === "on" || v === "1" || v === "true";

export function hubPushEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return on(env.HUB_PUSH_ENABLED);
}

export function hubDecisionsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return on(env.HUB_DECISIONS_ENABLED);
}

export interface HubEndpoint {
  /** Without a trailing slash. */
  url: string;
  token: string;
}

/**
 * The hub's address and token, or null when either is missing or the address is not https (plain http only to this
 * machine, for a local hub). A null endpoint with decisions on counts as an unreachable hub: the existing approval
 * alone decides, and that is recorded.
 */
export function hubEndpoint(env: NodeJS.ProcessEnv = process.env): HubEndpoint | null {
  const raw = (env.HUB_URL ?? "").trim();
  const token = (env.HUB_PUSH_TOKEN ?? "").trim();
  if (!raw || !token) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  const local = u.hostname === "localhost" || u.hostname === "127.0.0.1";
  if (u.protocol !== "https:" && !(u.protocol === "http:" && local)) return null;
  if (u.username || u.password || u.search || u.hash) return null;
  return { url: raw.replace(/\/+$/, ""), token };
}

/** Every hub call gives up after this long: a slow hub never holds up Purser. */
export const HUB_TIMEOUT_MS = 3_000;
