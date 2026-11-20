// The Airwallex API version every Airwallex HTTP client in this repo pins (outside audit, finding 2.5, 20 November 2026).
// Imported by the runner's client (src/airwallex/client.ts) and by the relay Worker's clients (worker/src/awx*.ts,
// worker/src/fxQuote.ts), so it holds no Node-only import.
//
// Why 2025-11-11: the repo records no x-api-version on any REST call, and the sandbox does not say which version its
// REST answers follow (docs/runs/2026-10-29-s3.md, item 6: "the exact version string is not exposed"). The only API
// version string recorded against this sandbox account is 2025-11-11:
//   - docs/runs/2026-10-30-webhooks.md, step 1: the webhook subscription made live was created "(API version 2025-11-11)";
//   - src/airwallex/webhooks.ts (CARD_EVENTS) and src/policy/cardHooks.ts: the events the sandbox sent under 2025-11-11,
//     and their shape (the object is `data` itself), are what the code parses (checked against the sandbox, 29 October);
//   - docs/feedback-for-metal-and-airwallex.md: "the Airwallex sandbox (API version 2025-11-11), from 29 October to
//     3 November", the period of the recorded runs the REST adapter and its contract tests were written against.
// That the account's default REST version was also 2025-11-11 during those runs is an inference from the above, not a
// recorded fact. Pinned and tested offline only (test/airwallex-api-version.test.ts); not yet re-run against the sandbox.
//
// FX calls carry no version: the hackathon kit says "Leave `x-api-version` off FX calls" (docs/requirements-matrix.md,
// K8-api), so a path under /fx/ (quotes, rates, conversions) keeps the account's default as before.

export const AIRWALLEX_API_VERSION = "2025-11-11";

/** An Airwallex FX path (`/fx/…`, or `/api/v1/fx/…` where the client keeps the prefix in its path). */
export function isFxPath(path: string): boolean {
  return /^(?:\/api\/v1)?\/fx(?:\/|$)/.test(path);
}

/** The version header for one call to `path`: `x-api-version` on every call except an FX call (kit, K8-api). */
export function apiVersionHeader(path: string): Record<string, string> {
  return isFxPath(path) ? {} : { "x-api-version": AIRWALLEX_API_VERSION };
}
