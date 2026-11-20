// Which requests are security events, and what each one records (cloud/src/securityLog.ts writes them). Decided once,
// after the answer, from the route's pattern, its status and what the request found out about the caller: so every
// refusal is logged however deep in a route it was decided, and no route can forget to.
//
// - 401: auth.failure (a passkey route: passkey.failure; a platform route: admin.auth_failure; an inbound webhook:
//   webhook.signature_failure). 403: access.denied. 429: rate.limited.
// - A platform admin's request that succeeded: admin.action.
// - The successes that change who can do what (sign-ins, passkeys, keys, people, settings) and bulk reads (exports):
//   their own kinds below. Passkey and key changes are also told to the company's owners: a security event they read in
//   the console (GET /v1/security/events) and an event to the company's alert webhook when one is set.
// - Each read of personal or financial data (ASVS V8.3.5): data.access, with who, which route and from which network;
//   never what was read.
import { keyIdOf } from "./auth.js";
import type { CloudEnv } from "./app.js";
import { tellEveryOwner } from "./ownerNotice.js";
import { recordSecurityEvent } from "./securityLog.js";
import { alarmRules, type SecurityKind } from "../../src/lib/securityEvents.js";

type CloudEnvLike = Pick<CloudEnv, "sql" | "outbound" | "retryDelayMs" | "waitUntil" | "securityAlarms"> & { alerts?: CloudEnv["alerts"] };

/** What a request found out on its way, for its security event: the caller, the platform admin key, and what a route adds. */
export interface Audit {
  tenant?: string | null;
  actor?: string | null;
  /** The platform admin key that made the request (its id; "legacy" for the old single token). */
  admin?: string | null;
  /** Whether the route needs the platform admin (set from the route table). */
  platform?: boolean;
  detail?: Record<string, unknown>;
  /** A tamper alarm: a pushed record that changed or a broken chain, or the runner newly reporting tampered terms. */
  tamper?: boolean;
  /** The calling key's expiry, for its renewal header (./keyExpiry.ts). */
  keyExpiresAt?: string | null;
}

/** Successful requests that are security events, by "METHOD pattern". */
export const SECURITY_ROUTES: Record<string, SecurityKind> = {
  "POST /v1/auth/login": "passkey.success",
  "POST /v1/auth/step-up": "passkey.success",
  "POST /v1/engine/proposals/{id}/approve": "passkey.success",
  "POST /v1/auth/guest": "auth.success",
  "POST /v1/auth/enrol": "passkey.enrolled",
  "POST /v1/engine/passkey/finish": "passkey.enrolled",
  "POST /v1/engine/security-key/finish": "passkey.enrolled",
  "DELETE /v1/users/{id}/passkeys/{credential}": "passkey.removed",
  "POST /v1/keys": "key.created",
  "DELETE /v1/keys/{id}": "key.revoked",
  "POST /v1/claude/connectors": "key.created",
  "DELETE /v1/claude/connectors/{id}": "key.revoked",
  "POST /v1/users": "access.change",
  "POST /v1/users/{id}/enrolment": "access.change",
  "POST /v1/users/{id}/erase": "access.change",
  "POST /v1/connect/{provider}/finish": "access.change",
  "DELETE /v1/connect/{provider}": "access.change",
  "POST /v1/close": "access.change",
  "POST /v1/offboarding": "access.change",
  "DELETE /v1/sessions/{id}": "access.change",
  "POST /v1/webhook": "policy.change",
  "DELETE /v1/webhook": "policy.change",
  "POST /v1/security/settings": "policy.change",
  "POST /v1/alerts/targets": "policy.change",
  "DELETE /v1/alerts/targets/{id}": "policy.change",
  "POST /v1/engine/policy/second-key": "policy.change",
  "POST /v1/company": "policy.change",
  "GET /v1/export": "data.export",
  "POST /v1/export/staged": "data.export",
  "GET /v1/export/csv/{format}/{kind}": "data.export",
  "GET /v1/export/download/{id}/{part}": "data.export",
  ...Object.fromEntries([
    "/v1/users", "/v1/users/{id}/passkeys", "/v1/vendors", "/v1/invoices", "/v1/invoices/{id}", "/v1/invoices/{id}/document", "/v1/payments",
    "/v1/transactions", "/v1/transactions/{id}", "/v1/transactions/export.csv", "/v1/ledger/entries", "/v1/reports/{name}",
    "/v1/books/bookings", "/v1/books/invoices/{id}/journal", "/v1/documents/{sha256}", "/v1/mail", "/v1/mail/{id}/raw",
    "/v1/engine/invoices", "/v1/engine/suppliers", "/v1/engine/vault", "/v1/engine/vault/file", "/v1/engine/export", "/v1/engine/export.pdf",
  ].map((p) => [`GET ${p}`, "data.access" as const])),
  // A Claude connector's tools read the same records (cloud/src/claude/).
  "POST /mcp": "data.access",
};

/** Routes whose 401 is a passkey that did not verify, and inbound webhooks whose 401 is a bad signature. */
const PASSKEY_ROUTES = new Set(["POST /v1/auth/login", "POST /v1/auth/enrol", "POST /v1/auth/step-up", "POST /v1/engine/proposals/{id}/approve", "POST /v1/engine/passkey/finish", "POST /v1/engine/security-key/finish"]);
const WEBHOOK_ROUTES = new Set(["POST /v1/airwallex/webhook", "POST /v1/connect/airwallex/webhook"]);
/** Told to the company's owners (ASVS V2.2.3, V2.5.5): a passkey or a key added or taken away. */
const TOLD_TO_OWNERS = new Set<SecurityKind>(["passkey.enrolled", "passkey.removed", "key.created", "key.revoked"]);
/** Routes that tell every owner themselves, with what changed (cloud/src/engine/routes.ts): not told twice here. */
const TELLS_ITSELF = new Set(["POST /v1/engine/passkey/finish", "POST /v1/engine/security-key/finish"]);

/** What kind of token a request carried (never the token): for an auth failure. */
function tokenKind(authorization: string | null): string {
  const t = /^Bearer (\S+)$/.exec(authorization ?? "")?.[1];
  if (!t) return authorization ? "malformed" : "none";
  return t.startsWith("pck_") ? "api_key" : t.startsWith("pcs.") ? "session" : t.startsWith("pca.") ? "access_token" : t.startsWith("pak_") ? "admin_key" : "other";
}

/** The kind of security event a request is, or null. */
export function securityKindOf(method: string, pattern: string, status: number, audit: Audit): SecurityKind | null {
  const key = `${method} ${pattern}`;
  if (audit.tamper) return "tamper.alarm";
  if (status === 401) return audit.platform ? "admin.auth_failure" : WEBHOOK_ROUTES.has(key) ? "webhook.signature_failure" : PASSKEY_ROUTES.has(key) ? "passkey.failure" : "auth.failure";
  if (status === 403) return PASSKEY_ROUTES.has(key) && /passkey|signature|assertion/i.test(String(audit.detail?.reason ?? "")) ? "passkey.failure" : "access.denied";
  if (status === 429) return "rate.limited";
  if (status >= 200 && status < 300) return audit.platform ? "admin.action" : SECURITY_ROUTES[key] ?? null;
  return null;
}

/** Records the request's security event, if it is one; never throws. */
export async function auditRequest(env: CloudEnvLike, req: Request, res: Response, pattern: string, audit: Audit, now: Date): Promise<void> {
  const kind = securityKindOf(req.method, pattern, res.status, audit);
  if (!kind) return;
  // Claude's connector first asks /mcp without a token to learn where to sign in: that is the protocol, not a failure.
  if (kind === "auth.failure" && pattern === "/mcp" && !req.headers.get("authorization")) return;
  const detail: Record<string, unknown> = { method: req.method, ...(audit.detail ?? {}) };
  if (kind.endsWith("failure") || kind === "access.denied" || kind === "rate.limited") {
    detail.credential_kind = tokenKind(req.headers.get("authorization"));
    const keyId = keyIdOf(/^Bearer (\S+)$/.exec(req.headers.get("authorization") ?? "")?.[1]);
    if (keyId) detail.key_id = keyId;
    try { const body = await res.clone().json() as { error?: unknown; code?: unknown }; if (typeof body.error === "string") detail.reason = body.error; } catch { /* not JSON */ }
  }
  const actor = audit.admin ? `platform:${audit.admin}` : audit.actor ?? null;
  const event = { kind, tenant: audit.tenant ?? null, actor, ip: req.headers.get("cf-connecting-ip"), route: `${req.method} ${pattern}`, status: res.status, detail };
  const work = (async () => {
    await recordSecurityEvent(env.sql, event, now, alarmRules(env.securityAlarms));
    if (TOLD_TO_OWNERS.has(kind) && audit.tenant && !TELLS_ITSELF.has(`${req.method} ${pattern}`)) await tellOwners(env, audit.tenant, kind, actor, pattern, audit.detail, now);
  })();
  if (env.waitUntil) env.waitUntil(work); else await work;
}

/**
 * A passkey or key change, told to every owner of the company (./ownerNotice.ts): a security event in the console, the
 * alert webhook if set, and an e-mail to each owner with an address when the alert e-mail provider is set.
 */
async function tellOwners(env: CloudEnvLike, tenantId: string, kind: SecurityKind, actor: string | null, pattern: string, detail: Record<string, unknown> | undefined, now: Date): Promise<void> {
  const ids = Object.fromEntries(["credential_id", "key_id", "enrolment_id"].filter((k) => typeof detail?.[k] === "string").map((k) => [k, String(detail![k]).slice(0, 20)]));
  await tellEveryOwner(env, tenantId, { kind, actor: actor ?? "unknown", detail: { route: pattern, ...ids }, hook: `security.${kind}` }, now);
}
