// Step-up for sensitive settings (13 Nov, zero-trust hardening of the console). A session is a bearer token that lives
// 15 minutes in the browser tab; a stolen one could otherwise change who hears about payments, make a connector token,
// add a person or a key. On the routes listed here a session must also show a FRESH passkey check: either it was
// signed in with the passkey less than five minutes ago, or it carries a step-up token from a passkey assertion made
// less than five minutes ago. The step-up token is bound to the session it was made for (the hash of that session
// token, the person and the company): copied next to any other session it is refused, and it ends with its session.
//
// Keys are not people and cannot make a passkey assertion: on a step-up route an admin key keeps working as before
// (it is scoped, expiring, revocable and logged), except on the SESSION_ONLY routes, which only a signed-in owner may
// call (who hears about payments is a person's decision). test/cloud-step-up.test.ts and test/cloud-route-auth.test.ts
// hold the lists to the route table.

import { verifyAssertion, type AssertionB64 } from "../../worker/src/webauthn.js";
import { AuthError, SESSION_TTL_MS, type Caller } from "./auth.js";
import { hmacB64u, sha256Hex, signedPayload, toB64u } from "./crypto.js";
import type { Sql } from "./store.js";
import { TenantDb } from "./tenant.js";

/** How long a passkey check counts for sensitive settings: a sign-in, or a step-up. */
export const STEP_UP_TTL_MS = 5 * 60 * 1000;
export const STEP_UP_HEADER = "x-purser-step-up";

/**
 * Sensitive settings: alert targets, the signed webhook, connector tokens (Claude and OAuth connections), API keys, team
 * members and their passkeys, the company's export and closing, its Airwallex account and onboarding link, and its name
 * and language. "METHOD path" as in the route table.
 * Spending limits are not set in Purser Cloud (they live in the CFO's policy on the runner, changed with the CFO's own
 * passkey there): when a route that changes a limit is added here, it belongs on this list.
 */
export const STEP_UP_ROUTES: ReadonlySet<string> = new Set([
  "POST /v1/alerts/targets", "DELETE /v1/alerts/targets/{id}",
  "POST /v1/webhook", "DELETE /v1/webhook",
  "POST /v1/claude/connectors", "DELETE /v1/claude/connectors/{id}",
  "POST /v1/connect/{provider}/start", "DELETE /v1/connect/{provider}",
  "POST /v1/keys", "DELETE /v1/keys/{id}",
  "POST /v1/users", "POST /v1/users/{id}/enrolment", "DELETE /v1/users/{id}/passkeys/{credential}", "POST /v1/users/{id}/erase",
  "POST /v1/export/staged", "POST /v1/close",
  "POST /v1/airwallex/account", "POST /v1/airwallex/onboarding-link", "POST /v1/company",
]);
/** Step-up routes a key may not call at all: a signed-in owner only. */
export const SESSION_ONLY_ROUTES: ReadonlySet<string> = new Set(["POST /v1/alerts/targets", "DELETE /v1/alerts/targets/{id}"]);

export class StepUpRequired extends Error {
  readonly code = "step_up_required";
  constructor() { super("this setting needs a fresh passkey check: confirm with your passkey (Face ID), then send it again with the step-up token"); }
}

const bearer = (authorization: string | null) => /^Bearer (\S+)$/.exec(authorization ?? "")?.[1] ?? "";
const bindingOf = async (session: string) => (await sha256Hex(`purser-step-up|${session}`)).slice(0, 43);

/** When a session token was issued (its expiry less the session's life); null for anything that is not one. */
export async function sessionIssuedAt(secret: string, token: string): Promise<number | null> {
  if (!token.startsWith("pcs.")) return null;
  const p = await signedPayload(secret, "pcs", token, Infinity) as { exp?: unknown } | null;
  return p && typeof p.exp === "number" ? p.exp - SESSION_TTL_MS : null;
}

/** A step-up token for this session, after a passkey assertion: five minutes, this session only. */
export async function stepUpToken(secret: string, session: string, caller: Caller, now: Date): Promise<{ token: string; expires_at: string }> {
  const exp = now.getTime() + STEP_UP_TTL_MS;
  const body = toB64u(new TextEncoder().encode(JSON.stringify({ t: caller.tenantId, u: caller.principal, s: await bindingOf(session), exp })));
  return { token: `pcu.${body}.${await hmacB64u(`step-up:${secret}`, body)}`, expires_at: new Date(exp).toISOString() };
}

/** Whether this session's last passkey check is fresh: a sign-in, or a step-up token bound to it, under five minutes old. */
export async function freshPasskey(secret: string, req: Request, caller: Caller, now: Date): Promise<boolean> {
  if (caller.kind !== "session") return false;
  const session = bearer(req.headers.get("authorization"));
  const issued = await sessionIssuedAt(secret, session);
  if (issued !== null && issued <= now.getTime() && now.getTime() - issued < STEP_UP_TTL_MS) return true;
  const up = req.headers.get(STEP_UP_HEADER) ?? "";
  if (!up.startsWith("pcu.") || up.length > 1000) return false;
  const p = await signedPayload(`step-up:${secret}`, "pcu", up, Infinity) as { t?: unknown; u?: unknown; s?: unknown; exp?: unknown } | null;
  if (!p || typeof p.exp !== "number" || p.exp <= now.getTime() || p.exp - now.getTime() > STEP_UP_TTL_MS) return false;
  return p.t === caller.tenantId && p.u === caller.principal && p.s === (await bindingOf(session));
}

/** The gate the router runs on a step-up route, after the route's scope check. */
export async function requireStepUp(secret: string, routeKey: string, req: Request, caller: Caller, now: Date): Promise<void> {
  if (!STEP_UP_ROUTES.has(routeKey)) return;
  if (caller.kind === "key") {
    if (SESSION_ONLY_ROUTES.has(routeKey)) throw new AuthError(403, "only a signed-in owner changes who hears about payments, after a fresh passkey check; a key cannot");
    return;
  }
  if (!(await freshPasskey(secret, req, caller, now))) throw new StepUpRequired();
}

/**
 * The passkey check behind a step-up: the signed-in person's own passkey signs a challenge the company issued (used once,
 * five minutes). A passkey of anyone else in the company is refused.
 */
export async function stepUpAssertion(sql: Sql, a: { caller: Caller; challengeId: string; credentialId: string; assertion: AssertionB64; rpId: string; origin: string; now: Date }): Promise<void> {
  if (a.caller.kind !== "session") throw new AuthError(403, "a step-up is a signed-in person's passkey check; a key has none");
  const iso = a.now.toISOString();
  // Only a step-up challenge ("u…", cloud/src/auth.ts newChallenge): a sign-in challenge is never taken here.
  if (!a.challengeId.startsWith("u")) throw new AuthError(401, "the passkey challenge is unknown, used or expired");
  const taken = await sql.run("UPDATE challenges SET used_at = ? WHERE id = ? AND tenant_id = ? AND used_at IS NULL AND expires_at > ?", [iso, a.challengeId, a.caller.tenantId, iso]);
  if (taken.changes !== 1) throw new AuthError(401, "the passkey challenge is unknown, used or expired");
  const ch = (await sql.first<{ challenge: string }>("SELECT challenge FROM challenges WHERE id = ? AND tenant_id = ?", [a.challengeId, a.caller.tenantId]))!;
  const db = new TenantDb(sql, a.caller.tenantId);
  const cred = await db.one<{ user_id: string; x: string; y: string; counter: number }>("credentials", { credential_id: a.credentialId });
  if (!cred || cred.user_id !== a.caller.principal) throw new AuthError(403, "a step-up needs your own passkey");
  const v = await verifyAssertion(a.assertion, { x: cred.x, y: cred.y }, { challenge: ch.challenge, origin: a.origin, rpId: a.rpId, lastCounter: cred.counter });
  if (!v.ok) throw new AuthError(401, `the passkey check failed (${v.why})`);
  await db.apply([db.update("credentials", { credential_id: a.credentialId, counter: { op: "<=", v: v.counter } }, { counter: v.counter })]);
}
