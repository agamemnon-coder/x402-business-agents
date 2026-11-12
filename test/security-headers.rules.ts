// The security headers each kind of relay answer must carry (A3), in one place: test/security-headers.test.ts
// checks them against the Worker's code, test/browser/headers.check.ts against the local stand-in or the deployed site.

export type AnswerKind = "page" | "not-found" | "json" | "asset" | "redirect";

/** The answers to check on a running relay (no key needed), each with its kind and status. */
export const HEADER_PATHS: { path: string; kind: AnswerKind; status: number }[] = [
  ...["/", "/home", "/watch", "/proof", "/month", "/film", "/try", "/lab", "/metal", "/metal/report", "/visa", "/airwallex", "/claude", "/pricing", "/security", "/docs", "/approve/P-0001", "/enrol", "/policy"]
    .map((path) => ({ path, kind: "page" as const, status: 200 })),
  { path: "/no/such/page", kind: "not-found", status: 404 },
  { path: "/health", kind: "json", status: 200 },
  { path: "/api/snapshot", kind: "json", status: 401 },
  { path: "/live", kind: "redirect", status: 302 },
  ...["/assets/approve.js", "/assets/approve.css", "/assets/inter.woff2", "/assets/logo-metal.svg", "/assets/favicon.svg", "/favicon.ico"]
    .map((path) => ({ path, kind: "asset" as const, status: 200 })),
];

/** What is wrong with one answer's headers; empty when nothing is. */
export function headerFaults(kind: AnswerKind, h: Headers): string[] {
  const faults: string[] = [];
  const want = (name: string, ok: (v: string) => boolean, expected: string) => {
    const v = h.get(name);
    if (v === null || !ok(v)) faults.push(`${name}: ${v === null ? "missing" : `"${v}"`}, expected ${expected}`);
  };
  // Every answer.
  want("strict-transport-security", (v) => /^max-age=(\d+); includeSubDomains$/.test(v) && Number(/\d+/.exec(v)![0]) >= 31536000, "max-age of a year or more; includeSubDomains");
  want("x-content-type-options", (v) => v === "nosniff", "nosniff");
  want("referrer-policy", (v) => v === "no-referrer", "no-referrer");
  want("x-frame-options", (v) => v === "DENY", "DENY");
  want("content-security-policy", (v) => /(^|; )default-src 'none'(;|$)/.test(v) && /frame-ancestors 'none'/.test(v) && /base-uri 'none'/.test(v)
    && !/'unsafe-inline'|'unsafe-eval'|https?:|\*/.test(v), "default-src 'none', frame-ancestors 'none', base-uri 'none', nothing inline by keyword, no other origin");
  want("cache-control", (v) => v === "no-store" || (kind === "asset" && v === "public, max-age=86400"), kind === "asset" ? "no-store or a day's public cache" : "no-store");
  // Each HTML document, the 404 included: passkeys for this site only, no camera, microphone or location; its own window.
  if (kind === "page" || kind === "not-found") {
    want("content-type", (v) => v.startsWith("text/html"), "text/html");
    want("permissions-policy", (v) => ["publickey-credentials-get=(self)", "camera=()", "microphone=()", "geolocation=()", "payment=()", "usb=()"].every((p) => v.includes(p)), "passkeys for self; camera, microphone, geolocation, payment and usb off");
    want("cross-origin-opener-policy", (v) => v === "same-origin", "same-origin");
  }
  if (kind === "json") want("content-type", (v) => v.startsWith("application/json"), "application/json");
  if (kind === "redirect") want("location", (v) => v.startsWith("/"), "a path on this site");
  return faults;
}
