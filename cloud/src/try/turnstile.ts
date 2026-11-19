// Cloudflare Turnstile before a /try start (security hardening, 19 November). The page's Turnstile widget hands the
// browser a one-time token; POST /v1/try/start sends it as `turnstile`, and this asks Cloudflare's siteverify about it
// before any company or Durable Object exists (the same place as the proof of work, ./botCheck.ts).
//
// Behind the switch `turnstile` (off while its row is missing). The widget's site key is public; the secret is a Worker
// secret the owner sets (wrangler secret put TURNSTILE_SECRET -c cloud/wrangler.try.jsonc), never in a file. It fails
// closed: with the switch on and no secret, starts are paused; a missing token, a token Cloudflare refuses (wrong,
// expired after 300 s, or used before), a siteverify that cannot be reached, errs or answers anything but
// { success: true }, each refuses the start. Nothing about the visitor is kept: the address goes to Cloudflare as
// `remoteip` with the token, as Cloudflare documents, and nowhere else.
// https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
import { TryRefused } from "./start.js";

export const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
/** A Turnstile token is at most 2048 characters (Cloudflare's server-side validation). */
export const MAX_TOKEN = 2048;
/** The action the page's widget names (data-action), checked when Cloudflare reports one. */
export const START_ACTION = "try_start";
const TIMEOUT_MS = 10_000;

export type SiteverifyFetch = (url: string, init: RequestInit) => Promise<Response>;
export type TurnstileVerdict = { ok: true } | { ok: false; why: "shape" | "unreachable" | "refused" | "action"; codes?: string[] };

/** Asks siteverify about one token. Never throws: an answer that is not a plain success is a refusal. */
export async function verifyTurnstile(a: { secret: string; token: string; ip: string | null; fetch: SiteverifyFetch; action?: string }): Promise<TurnstileVerdict> {
  if (!a.token || a.token.length > MAX_TOKEN) return { ok: false, why: "shape" };
  const form = new URLSearchParams({ secret: a.secret, response: a.token, idempotency_key: crypto.randomUUID() });
  if (a.ip && a.ip !== "unknown") form.set("remoteip", a.ip);
  let body: unknown;
  try {
    const res = await a.fetch(SITEVERIFY_URL, { method: "POST", body: form.toString(), headers: { "content-type": "application/x-www-form-urlencoded" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return { ok: false, why: "unreachable" };
    body = await res.json();
  } catch {
    return { ok: false, why: "unreachable" };
  }
  const r = (body && typeof body === "object" ? body : {}) as { success?: unknown; action?: unknown; "error-codes"?: unknown };
  const codes = Array.isArray(r["error-codes"]) ? r["error-codes"].filter((c): c is string => typeof c === "string").slice(0, 5) : [];
  if (r.success !== true) return { ok: false, why: "refused", codes };
  if (a.action && typeof r.action === "string" && r.action !== a.action) return { ok: false, why: "action" };
  return { ok: true };
}

const REFUSED = "The check that you are a person did not pass. Please reload the page and press Start again.";

/** The start's Turnstile gate: nothing while the switch is off; else a token siteverify accepts, or a refusal. */
export async function gateTurnstile(a: { switchOn: boolean; secret: string | undefined; fetch: SiteverifyFetch | undefined; token: string | undefined; ip: string | null }): Promise<void> {
  if (!a.switchOn) return;
  // Switched on without the secret (or without a way out to Cloudflare): paused, never waved through.
  if (!a.secret || !a.fetch) throw new TryRefused(503, "paused", "The hands-on demo is paused right now. Please try again later.");
  if (!a.token) throw new TryRefused(403, "turnstile", REFUSED);
  const v = await verifyTurnstile({ secret: a.secret, token: a.token, ip: a.ip, fetch: a.fetch, action: START_ACTION });
  if (!v.ok) throw new TryRefused(v.why === "unreachable" ? 503 : 403, v.why === "unreachable" ? "paused" : "turnstile", v.why === "unreachable" ? "The check that you are a person could not be made right now. Please try again in a minute." : REFUSED);
}
