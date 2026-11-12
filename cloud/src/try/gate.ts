// The try-only gate (cloud/src/app.ts route()): a session of a visitor's test company (tenant id t_try_...) may call
// only the routes listed here, one by one, by method and path; there is no wildcard. Everything else answers 403
// try_only. The visitor's own file upload is in the list only while the switch own_upload is on (a missing switch is
// off); the runner's push (POST /v1/engine/sync) is never in it. A company past its 24 hours answers 410 on every route.
//
// And a try session's 401: a session token the cloud signed itself, for a try company, that no longer works (it expired,
// or its company was swept) is counted against that company, never against the caller's address: one phone that wakes
// up with an old session must not turn away a room on the same Wi-Fi. Forged and unknown tokens are counted per
// address, as for every other caller.
import { fromB64, hmacValid } from "../crypto.js";
import type { Sql } from "../store.js";
import { isTryTenant, TryRefused } from "./start.js";
import { on, readSwitches } from "./switches.js";

export const TRY_ROUTES: readonly string[] = [
  "POST /v1/auth/logout",
  "GET /v1/me",
  // The read model.
  "GET /v1/invoices",
  "GET /v1/invoices/{id}",
  "GET /v1/payments",
  "GET /v1/transactions",
  "GET /v1/ledger/entries",
  // The engine.
  "GET /v1/engine",
  "GET /v1/engine/invoices",
  "POST /v1/engine/invoices/{id}/pay",
  "GET /v1/engine/proposals/{id}",
  "POST /v1/engine/passkey/start",
  "POST /v1/engine/passkey/finish",
  "POST /v1/engine/proposals/{id}/approve",
  "POST /v1/engine/proposals/{id}/retry",
  "GET /v1/engine/events",
  "GET /v1/engine/vault",
  "GET /v1/engine/vault/file",
  // The hands-on demo's own engine routes.
  "GET /v1/engine/samples",
  "POST /v1/engine/samples/{key}",
  "GET /v1/engine/suppliers",
  "POST /v1/engine/compose",
  // The demo extras (./extraEngineRoutes.ts), each behind its own switch.
  "GET /v1/try/books/effect",
  "GET /v1/try/scenarios/{seed}",
  "POST /v1/try/scenarios/{seed}",
  "GET /v1/engine/proposals/{id}/terms",
  "POST /v1/engine/proposals/{id}/pay",
  "GET /v1/engine/export",
];
/** In the list only while the switch own_upload is on. */
export const UPLOAD_ROUTE = "POST /v1/engine/documents";

/**
 * Whether a try company's session may call this route (its method and its pattern in the route table), and whether the
 * company is still there. Throws the refusal; returns when the call may go on.
 */
export async function tryGate(sql: Sql, tenantId: string, method: string, pattern: string, now: Date): Promise<void> {
  const row = await sql.first<{ expires_at: string; wiped_at: string | null }>("SELECT expires_at, wiped_at FROM try_companies WHERE tenant_id = ?", [tenantId]);
  if (!row || row.wiped_at || row.expires_at <= now.toISOString()) throw new TryRefused(410, "gone", "Your test company was deleted after 24 hours.");
  const route = `${method} ${pattern}`;
  if (TRY_ROUTES.includes(route)) return;
  if (route === UPLOAD_ROUTE) {
    let upload: boolean;
    try { upload = on(await readSwitches(sql), "own_upload"); } catch { upload = false; }
    if (upload) return;
  }
  throw new TryRefused(403, "try_only", "A test company can use the hands-on demo's own routes only.");
}

/**
 * The try company a bearer token names when it is a session token this cloud signed (its HMAC is valid), else null.
 * Used only after the token was refused, to count the failure against the company instead of the address.
 */
export async function signedTrySession(secret: string, authorization: string | null): Promise<string | null> {
  const token = /^Bearer (pcs\.\S+)$/.exec(authorization ?? "")?.[1];
  if (!token) return null;
  const [, body, sig] = token.split(".");
  if (!body || !sig || !(await hmacValid(secret, body, sig))) return null;
  try {
    const p = JSON.parse(new TextDecoder().decode(fromB64(body))) as { t?: unknown };
    return typeof p.t === "string" && isTryTenant(p.t) ? p.t : null;
  } catch { return null; }
}
