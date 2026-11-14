// The live reconciliation badge on /proof and Home (14 Nov): "Purser's books = Airwallex's transactions · checked
// <time>". The awx-read instance (./awxRead.ts) reads Airwallex's financial transactions for the recorded run's window;
// the same comparison Purser Cloud's Airwallex tab runs (cloud/src/awxLive.ts reconcileView, the runner's own code in
// src/finance/awxReconcile.ts) turns them into a badge (src/finance/awxBadge.ts), kept 5 minutes. Public, read-only,
// counts only: no amount, no id, no key. As JSON for /proof's script, and as an image for Home (whose script reaches no
// network).

import { checkGatewayAnswer, reconcileView } from "../../cloud/src/awxLive.js";
import { AwxBadgeCache, badgeOf, badgeSvg, type AwxBadge } from "../../src/finance/awxBadge.js";
import { COMMON_HEADERS } from "./core.js";

export const AWX_BOOKS_JSON_PATH = "/awx-live/books.json";
export const AWX_BOOKS_SVG_PATH = "/awx-live/books.svg";
export const isAwxBooksPath = (p: string) => p === AWX_BOOKS_JSON_PATH || p === AWX_BOOKS_SVG_PATH;

/** The badge from one read of Airwallex's financial transactions (the gateway's "financial" view), at `now`. */
export async function booksBadge(readFinancial: () => Promise<unknown>, now: Date): Promise<AwxBadge> {
  return badgeOf(reconcileView(checkGatewayAnswer("financial", await readFinancial(), now), now), now);
}

/** The badge cache, made once per instance: one read of Airwallex every 5 minutes at most, whoever asks. */
export function booksCache(readFinancial: () => Promise<unknown>, now: () => number = () => Date.now()): AwxBadgeCache {
  return new AwxBadgeCache((at) => booksBadge(readFinancial, at), now);
}

/** GET only. The image says the same as the JSON, and is kept by browsers no longer than the badge itself. */
export async function awxBooksResponse(req: Request, cache: AwxBadgeCache): Promise<Response> {
  if (req.method !== "GET" && req.method !== "HEAD") return new Response(JSON.stringify({ error: "method not allowed" }), { status: 405, headers: { ...COMMON_HEADERS, "content-type": "application/json; charset=utf-8", allow: "GET, HEAD" } });
  const b = await cache.get();
  const headers = { ...COMMON_HEADERS, "cache-control": "public, max-age=60" };
  if (new URL(req.url).pathname === AWX_BOOKS_SVG_PATH) return new Response(badgeSvg(b), { headers: { ...headers, "content-type": "image/svg+xml; charset=utf-8" } });
  return new Response(JSON.stringify(b), { headers: { ...headers, "content-type": "application/json; charset=utf-8" } });
}
