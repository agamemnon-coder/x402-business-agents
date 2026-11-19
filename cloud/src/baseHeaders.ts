// The baseline security headers on every answer of the cloud (security sweep 3, 15 Nov): the JSON API, redirects, plain
// text and files had only HSTS and nosniff, while the pages had the full set. Applied once, in handle() (./app.ts).
//
// Only what an answer does not set itself is added, so a page's own policy wins (the PDF frame's
// x-frame-options SAMEORIGIN, each page's nonce CSP). CORS headers are never touched. A CSP that allows nothing is
// added only where nothing is ever rendered or run: JSON, plain text and answers without a body (redirects, 204).
// HTML always brings its own CSP; scripts, fonts and images keep none, so their loading is not changed.

export const PERMISSIONS_POLICY = "publickey-credentials-get=(self), publickey-credentials-create=(self), camera=(), microphone=(), geolocation=(), payment=(), usb=()";
export const INERT_CSP = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

const BASELINE: Record<string, string> = {
  "strict-transport-security": "max-age=31536000; includeSubDomains",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
  "cross-origin-opener-policy": "same-origin",
  "permissions-policy": PERMISSIONS_POLICY,
};

/** Whether nothing in this answer is ever rendered or run, so a CSP that allows nothing cannot break it. */
function inert(res: Response): boolean {
  const type = (res.headers.get("content-type") ?? "").toLowerCase();
  if (!type) return res.body === null || res.status === 204 || (res.status >= 300 && res.status < 400);
  return /^application\/(?:[\w.+-]+\+)?json\b/.test(type) || type.startsWith("text/plain");
}

/** The answer with the baseline headers it lacks; its status, body and every header it set are kept. */
export function withBaseline(res: Response): Response {
  // A WebSocket upgrade keeps its own object (the cloud has none today; this keeps one working if added).
  if (res.status === 101) return res;
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(BASELINE)) if (!headers.has(k)) headers.set(k, v);
  if (!headers.has("content-security-policy") && inert(res)) headers.set("content-security-policy", INERT_CSP);
  // An API answer is data, never a page (ASVS V14.4.2): a browser that opens one saves it. A file keeps its own name.
  if (!headers.has("content-disposition") && /^application\/(?:[\w.+-]+\+)?json\b/i.test(headers.get("content-type") ?? "")) headers.set("content-disposition", 'attachment; filename="api.json"');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}
