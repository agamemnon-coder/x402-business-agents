// The hands-on demo on the site's own address (12 Nov, owner: "The demo must live on the main site under the Try tab:
// https://kit11.max-31b.workers.dev/try. No jump to purser-try."). One deployment of the engine (purser-try,
// cloud/wrangler.try.jsonc), one database, one spend cap: the site passes /try and the paths its page calls to that
// Worker through a service binding (TRY_ENGINE, worker/wrangler.jsonc), the request unchanged, so its URL keeps the
// site's host and purser-try binds the passkey to it (cloud/src/hostOrigin.ts). Nothing else is passed: /try/sign and
// every path under it, /api/*, /hooks/airwallex, /health, /go, the x402 and Metal paths and the site's /assets/* stay
// the site's. /assets/inter.woff2, which the page loads, is the site's own: the same bytes (src/ui/inter.woff2, held
// equal by test/relay-try-engine.test.ts). Without the binding (local tests, an older deploy) none of this applies and
// the site answers /try with its own page, as before.

/** The service binding's one method used here. */
export interface TryEngine { fetch(req: Request): Promise<Response> }

const ID = "[^/]+";
/** The paths, each in full, and the methods the page (cloud/src/tryPage.ts) calls them with. */
export const TRY_ENGINE_PATHS: readonly (readonly [methods: readonly string[], path: RegExp])[] = [
  [["GET", "HEAD"], /^\/try$/],
  [["POST"], /^\/v1\/try\/(start|session)$/],
  [["GET"], /^\/v1\/engine$/],
  [["GET"], /^\/v1\/engine\/(events|samples|suppliers|invoices|vault|vault\/file|export)$/],
  [["POST"], new RegExp(`^/v1/engine/samples/${ID}$`)],
  [["POST"], /^\/v1\/engine\/(compose|passkey\/start|passkey\/finish)$/],
  [["POST"], new RegExp(`^/v1/engine/invoices/${ID}/pay$`)],
  [["GET"], new RegExp(`^/v1/engine/proposals/${ID}(/terms)?$`)],
  [["POST"], new RegExp(`^/v1/engine/proposals/${ID}/(approve|pay|retry)$`)],
  [["GET"], /^\/v1\/(payments|transactions|ledger\/entries)$/],
];

/** Whether the site passes this request to purser-try. */
export const isTryEngineRequest = (method: string, path: string): boolean =>
  TRY_ENGINE_PATHS.some(([methods, re]) => methods.includes(method) && re.test(path));

/** purser-try's answer when the binding is there and the request is one of its paths; otherwise null (the site's own). */
export function tryEngineResponse(req: Request, engine: TryEngine | undefined): Promise<Response> | null {
  if (!engine || !isTryEngineRequest(req.method, new URL(req.url).pathname)) return null;
  return engine.fetch(req);
}
