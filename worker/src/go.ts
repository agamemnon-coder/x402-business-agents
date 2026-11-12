// /go (master list 181): the short URL printed next to the QR code. It answers 302 to the hands-on demo on purser-try.
// The target is a Worker variable (TRY_GO_URL, a plain var, never a secret and never an event token); without it, or
// with a value that is not an https URL, the default below. The query is not passed on: a short link carries nothing.

import { COMMON_HEADERS } from "./core.js";

/** Where /go points when TRY_GO_URL is not set. */
export const TRY_GO_DEFAULT = "https://purser-try.max-31b.workers.dev/try";
/** The short path, as printed under a QR code. */
export const GO_PATH = "/go";

/** The target: TRY_GO_URL when it is an https URL without credentials, else the default. */
export function goTarget(configured: string | undefined): string {
  const v = configured?.trim();
  if (!v) return TRY_GO_DEFAULT;
  try {
    const u = new URL(v);
    return u.protocol === "https:" && !u.username && !u.password ? u.toString() : TRY_GO_DEFAULT;
  } catch {
    return TRY_GO_DEFAULT;
  }
}

/** 302 to the target for GET or HEAD on /go (and /go/), else null. */
export function goResponse(req: Request, configured: string | undefined): Response | null {
  if (req.method !== "GET" && req.method !== "HEAD") return null;
  const path = new URL(req.url).pathname;
  if (path !== GO_PATH && path !== `${GO_PATH}/`) return null;
  return new Response(null, { status: 302, headers: { ...COMMON_HEADERS, location: goTarget(configured), "cache-control": "no-store" } });
}
