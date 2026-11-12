// The passkeys' relying party per request (12 Nov, owner: "The demo must live on the main site under the Try tab"):
// purser-try is reached on its own address and, through kit11's service binding (worker/src/index.ts TRY_ENGINE), on
// the site's address, with the request's URL unchanged. A passkey is bound to the host its page was served on, so the
// RP id and origin follow the request's host when that host is one of these, or the deployment's own (RP_ID, ORIGIN);
// any other host gets the deployment's own. The POSTs' same-origin check (cloud/src/app.ts) reads the same origin.

/** The hosts whose pages may make and use a passkey here, besides the deployment's own (its ORIGIN's host). */
export const RP_HOSTS: readonly string[] = ["purser-try.max-31b.workers.dev", "kit11.max-31b.workers.dev"];

export interface RelyingParty { rpId: string; origin: string }

/** The relying party for a request to `url`: its own host's when that host is allowed, else the deployment's own. */
export function relyingPartyFor(url: string, own: RelyingParty): RelyingParty {
  const host = new URL(url).host;
  if (host === new URL(own.origin).host) return { rpId: own.rpId, origin: own.origin };
  return RP_HOSTS.includes(host) ? { rpId: host, origin: `https://${host}` } : { rpId: own.rpId, origin: own.origin };
}

/** Whether a relying party is one this deployment may enrol a passkey for (the engine's object checks what it is handed). */
export const rpAllowed = (rp: RelyingParty, own: RelyingParty): boolean =>
  (rp.rpId === own.rpId && rp.origin === own.origin) || (RP_HOSTS.includes(rp.rpId) && rp.origin === `https://${rp.rpId}`);

/** The cloud's environment for one request: its rpId and origin as relyingPartyFor says, the rest unchanged. */
export const forRequest = <E extends RelyingParty>(env: E, req: Request): E => ({ ...env, ...relyingPartyFor(req.url, env) });
