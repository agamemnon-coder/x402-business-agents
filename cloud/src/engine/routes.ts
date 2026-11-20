// The engine's actions as routes of the cloud's API: one block of the route table (cloud/src/app.ts ROUTES), behind
// the cloud's own gates (the caller's key or session, its scope, the rate limits, the same-origin check on writes).
// The company is always the caller's own (c.caller.tenantId): no route takes one from the request. A cloud with no
// engine wired (CloudEnv.engine absent) answers 404 on every one of them.
//
// Test money only: the engine behind these routes pays on its stand-in bank (GET /v1/engine says mode "test_money").
//
// A key cannot run a passkey ceremony for a person: setting up the approval passkey and approving with it are for a
// signed-in person's session only.
//
// Only the engine's interface is imported (cloud/src/engine/api.ts, types): the engine itself is never part of the
// Worker's bundle through this file.
import { z } from "zod";
import { verifyAssertion } from "../../../worker/src/webauthn.js";
import { AuthError, type Caller } from "../auth.js";
import { BadRequest } from "../read.js";
import type { TenantDb } from "../tenant.js";
import type { Sql } from "../store.js";
import { reserveStorage, type StorageQuota } from "../storageQuota.js";
import { SlowDown, type EngineApi } from "./api.js";

/** What a handler needs of the request's context (cloud/src/app.ts Ctx is one). */
export interface EngineCtx {
  env: { engine?: (tenantId: string) => EngineApi; rpId: string; origin: string; approvalKeyCoolingHours?: number; production?: boolean; sql?: Sql; storageQuota?: StorageQuota };
  req: Request;
  url: URL;
  params: string[];
  caller: Caller | null;
  db: TenantDb | null;
  /** The request's time (the cloud's clock). */
  now: Date;
}

/** The route table's own helpers, handed in by cloud/src/app.ts (it imports this file, so this file cannot import it). */
export interface EngineKit<C extends EngineCtx> {
  json(status: number, body: unknown): Response;
  err(status: number, error: string): Response;
  body<T>(c: C, schema: z.ZodType<T>, maxBytes?: number): Promise<T>;
  /** Told of each approval's answer (stage mode's wall, cloud/src/try/stage.ts); never fails the request. */
  approved?(c: C, answer: { status: string }): Promise<void>;
  /**
   * A change to the approval keys or a refusal, told to every owner: a security event they read in the console (GET
   * /v1/security/events, actor the caller) and an event to the company's alert webhook (security.<kind, dots as _>).
   */
  tellOwners?(c: C, kind: string, detail: Record<string, string | null>): Promise<void>;
}

/** The default cooling-off of a new approval key (src/engine/host.ts APPROVAL_KEY_COOLING_OFF_MS), and its floor in production. */
export const COOLING_OFF_HOURS = 72;
export const COOLING_OFF_MIN_PRODUCTION_HOURS = 24;
/** How long after a recovery its owner may enrol one approval key on the recovery's strength alone. */
export const RECOVERY_KEY_GRANT_DAYS = 7;
export const TRY_COOLING_NOTE = "A test company of /try: no cooling-off. In a real company a new or recovered approval key waits 72 hours before it approves.";

/**
 * How long a new approval key of this company waits before it approves (review finding 2): APPROVAL_KEY_COOLING_HOURS,
 * 72 by default, never under 24 hours in production (the deployed Worker); a test company of /try waits 0, labelled.
 */
export function coolingOffMs(env: { approvalKeyCoolingHours?: number; production?: boolean }, tenantId: string): number {
  if (tenantId.startsWith("t_try_")) return 0;
  const set = env.approvalKeyCoolingHours;
  const hours = typeof set === "number" && Number.isFinite(set) && set >= 0 ? set : COOLING_OFF_HOURS;
  return Math.round((env.production ? Math.max(COOLING_OFF_MIN_PRODUCTION_HOURS, hours) : hours) * 3_600_000);
}

export interface EngineRoute<C extends EngineCtx> { method: "GET" | "POST"; path: string; summary: string; need: "read" | "admin" | "propose" | "approve"; run: (c: C) => Promise<Response> }

/** An upload's whole request body, and the document in it once decoded (the inbox's own limit, src/ap/inbox.ts; it checks again). */
export const UPLOAD_BODY_MAX_BYTES = 22_000_000;
export const DOCUMENT_MAX_BYTES = 15 * 1024 * 1024;

const Upload = z.object({
  // eslint-disable-next-line no-control-regex
  filename: z.string().min(1).max(200).regex(/^[^\u0000-\u001f\u007f]+$/, "a file name has no control characters"),
  mime: z.string().min(1).max(100).optional(),
  base64: z.string().min(1).max(UPLOAD_BODY_MAX_BYTES),
}).strict();
/** A WebAuthn credential as the browser gives it; the engine checks every field of it itself (src/passkey/process.ts). */
const Credential = z.record(z.string(), z.unknown());
const Assertion = z.object({ authenticatorData: z.string().max(4000), clientDataJSON: z.string().max(8000), signature: z.string().max(400) }).strict();
/**
 * The new approval key; while another is active, with an `endorsement` (an active approval key's WebAuthn assertion
 * over the challenge the first answer named) or a `cosign` (another owner's sign-in passkey over that same challenge).
 */
const PasskeyFinish = z.object({ code: z.string().min(1).max(32), credential: Credential, endorsement: Credential.optional(),
  cosign: z.object({ credential_id: z.string().min(8).max(400), assertion: Assertion }).strict().optional() }).strict();
const Approve = z.object({ terms_sha256: z.string().regex(/^[0-9a-f]{64}$/, "the SHA-256 of the terms, in hex"), credential: Credential }).strict();

const Supplier = z.object({
  how: z.string().trim().min(20, "say how the account was confirmed: who you called, on which number from your own records").max(300),
  street: z.string().trim().min(1).max(120), city: z.string().trim().min(1).max(80), postcode: z.string().trim().min(1).max(20),
}).strict();
const Batch = z.object({ invoice_ids: z.array(z.string().min(1).max(64)).min(1).max(20) }).strict();
/** Money in on the bank's simulation: at most 500.00 at a time (the daily caps apply on top at Airwallex). */
const DepositIn = z.object({ amount: z.string().regex(/^\d{1,3}\.\d{2}$/, "an amount such as 25.00, at most 500.00") }).strict();

/** The request bodies of the engine's routes, as the OpenAPI document shows them (cloud/src/app.ts openApi). */
export const ENGINE_BODIES: Record<string, z.ZodType> = {
  "POST /v1/engine/documents": Upload, "POST /v1/engine/passkey/finish": PasskeyFinish, "POST /v1/engine/proposals/{id}/approve": Approve,
  "POST /v1/engine/invoices/{id}/supplier": Supplier, "POST /v1/engine/batch": Batch, "POST /v1/engine/deposit": DepositIn,
};

/** Standard base64 into bytes, refused before it is decoded when it is not base64 or holds more than the limit. */
function documentBytes(base64: string): Uint8Array {
  const pad = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  if (base64.length % 4 !== 0 || /[^A-Za-z0-9+/]/.test(base64.slice(0, base64.length - pad))) throw new BadRequest("base64 is not base64 (the standard alphabet, padded)");
  const size = (base64.length / 4) * 3 - pad;
  if (size > DOCUMENT_MAX_BYTES) throw new BadRequest(`the document is larger than ${DOCUMENT_MAX_BYTES / 1024 / 1024} MB`);
  // In pieces of whole groups of four, so the decoded document is held once, not twice.
  const bytes = new Uint8Array(size);
  const STEP = 4 * 16_384;
  let at = 0;
  for (let i = 0; i < base64.length; i += STEP) {
    const bin = atob(base64.slice(i, i + STEP));
    for (let j = 0; j < bin.length; j++) bytes[at++] = bin.charCodeAt(j);
  }
  return bytes;
}

/** A whole number from the query, or the default when it is not there. */
function whole(c: EngineCtx, name: string, min: number, max: number, fallback: number): number {
  const raw = c.url.searchParams.get(name);
  if (raw === null) return fallback;
  const n = /^\d{1,15}$/.test(raw) ? Number(raw) : NaN;
  if (!(n >= min && n <= max)) throw new BadRequest(`${name} is a whole number from ${min} to ${max}`);
  return n;
}

/** The signed-in person behind the call; a key is refused, whatever its scopes. */
function signedIn(c: EngineCtx): string {
  const who = c.caller!;
  if (who.kind !== "session" || !who.user) throw new AuthError(403, "only a signed-in person sets up the approval passkey or approves with it; a key cannot");
  return who.user;
}

async function displayName(c: EngineCtx, userId: string): Promise<string> {
  const person = await c.db!.one<{ display_name: string }>("users", { id: userId });
  if (!person) throw new AuthError(403, "this sign-in is no longer valid");
  return person.display_name;
}

/**
 * A second owner's co-signature over a new approval key's challenge: a sign-in passkey of this company, of an owner who
 * is not the person enrolling and not erased, verified here (as a sign-in is). Answers that owner's id.
 */
async function cosigner(c: EngineCtx, enrolling: string, challenge: string, cosign: { credential_id: string; assertion: z.infer<typeof Assertion> }): Promise<string> {
  const cred = await c.db!.one<{ user_id: string; x: string; y: string; counter: number }>("credentials", { credential_id: cosign.credential_id });
  const owner = cred ? await c.db!.one<{ role: string; erased_at: string | null }>("users", { id: cred.user_id }) : null;
  if (!cred || cred.user_id === enrolling || !owner || owner.erased_at || owner.role !== "owner") throw new AuthError(403, "a co-signature must come from another owner of this company, with their own passkey");
  const v = await verifyAssertion(cosign.assertion, { x: cred.x, y: cred.y }, { challenge, origin: c.env.origin, rpId: c.env.rpId, lastCounter: cred.counter });
  if (!v.ok) throw new AuthError(403, `the second owner's co-signature does not verify (${v.why}): it must sign this new key's challenge`);
  await c.db!.apply([c.db!.update("credentials", { credential_id: cosign.credential_id, counter: { op: "<=", v: v.counter } }, { counter: v.counter })]);
  return cred.user_id;
}

/**
 * The person's recovery, when it may stand for a new approval key: a recovery of this person completed in the last
 * RECOVERY_KEY_GRANT_DAYS days (two platform admins issued it), not yet used for one. Its admins, or null.
 */
async function recoveryGrant(c: EngineCtx, user: string, now: Date): Promise<{ by: string } | null> {
  const since = new Date(now.getTime() - RECOVERY_KEY_GRANT_DAYS * 86_400_000).toISOString();
  const done = (await c.db!.select<{ at: string; detail_json: string }>("security_events", { kind: "recovery.completed", actor: user, at: { op: ">=", v: since } }, { order: ["at"] })).at(-1);
  if (!done) return null;
  const used = await c.db!.select<{ detail_json: string }>("security_events", { kind: "approval_key.added", actor: user, at: { op: ">=", v: done.at } });
  if (used.some((u) => /"how":"recovery"/.test(u.detail_json))) return null;
  const key = (JSON.parse(done.detail_json) as { recovery_key?: string }).recovery_key;
  const issued = (await c.db!.select<{ detail_json: string }>("security_events", { kind: "recovery.issued" })).map((r) => JSON.parse(r.detail_json) as { recovery_key?: string; requested_by?: string; approved_by?: string }).find((d) => d.recovery_key === key);
  return { by: issued?.requested_by && issued.approved_by ? `recovery ${key ?? ""} (platform admins ${issued.requested_by} and ${issued.approved_by})` : `recovery ${key ?? ""}` };
}

const FILE_TYPES: Record<string, string> = { pdf: "application/pdf", json: "application/json; charset=utf-8", csv: "text/csv; charset=utf-8" };

export function engineRoutes<C extends EngineCtx>(kit: EngineKit<C>): EngineRoute<C>[] {
  const { json, err } = kit;
  /** The caller's own company's engine, or 404 when this cloud has none. */
  const on = (run: (c: C, engine: EngineApi) => Promise<Response>) => async (c: C): Promise<Response> => {
    const engine = c.env.engine?.(c.caller!.tenantId);
    return engine ? run(c, engine) : err(404, "the engine is not switched on for this cloud");
  };
  return [
    { method: "GET", path: "/v1/engine", summary: "Where the company's engine stands: the mode (test_money: it pays on a stand-in bank), the approval passkey, the stand-in bank's balances, and whether the audit and ledger chains verify. 404 on every /v1/engine route when the cloud runs no engine.", need: "read", run: on(async (c, e) => {
      // The caller's own approval key, and how long a new one waits here (review finding 2).
      const st = await e.status();
      const mine = (st.passkeys ?? []).find((p) => p.person === c.caller!.user) ?? null;
      const ms = coolingOffMs(c.env, c.caller!.tenantId);
      return json(200, { ...st, my_passkey: mine, cooling_off: { hours: ms / 3_600_000, ...(ms === 0 ? { note: TRY_COOLING_NOTE } : {}) } });
    }) },
    { method: "POST", path: "/v1/engine/documents", summary: "Upload a supplier invoice to the engine: { filename (1 to 200 characters), mime?, base64 }, at most 15 MB once decoded. It is filed, read and checked; answers { kind, sha256, invoice }. The same file again answers kind duplicate_document.", need: "admin", run: on(async (c, e) => {
      const b = await kit.body(c, Upload, UPLOAD_BODY_MAX_BYTES);
      const bytes = documentBytes(b.base64);
      // The file counts toward the company's storage quota (../storageQuota.ts; ASVS V12.1.3); a duplicate or a refusal gives it back.
      const release = c.env.sql ? await reserveStorage(c.env.sql, c.caller!.tenantId, bytes.length, 1, new Date(), c.env.storageQuota) : null;
      try {
        const r = await e.upload({ bytes, filename: b.filename, ...(b.mime ? { mime: b.mime } : {}) });
        if (release && r.kind === "duplicate_document") await release();
        return json(200, r);
      } catch (x) {
        if (release) await release().catch(() => undefined);
        // What the inbox refuses (not a PDF, a photo or an e-mail; too large) is said in its own words; anything else is an internal error.
        const said = x instanceof Error ? x.message : String(x);
        if (/nothing was filed$/.test(said)) throw new BadRequest(said.slice(0, 500));
        throw x;
      }
    }) },
    { method: "GET", path: "/v1/engine/invoices", summary: "The engine's invoices: status, whether it can be paid, what the checks found, and its payment proposal if one was filed; { items }.", need: "read", run: on(async (_c, e) => json(200, { items: await e.invoices() })) },
    { method: "POST", path: "/v1/engine/invoices/{id}/pay", summary: "File the invoice's payment for approval: answers { proposal } with the exact terms' hash and what the passkey signs; 409 with the engine's reason when it will not (the invoice is held, waiting or paid). Nothing is paid before the approval, except within the company's limit to pay alone (a test company of /try): when the agents and code's checks say pay, code approves the exact terms and the agent pays at once, and the answer adds { alone: { limit, by, why }, settled, airwallex_payout (the Airwallex sandbox transfer of the policy-approved terms, or why the simulated bank alone paid) }. Needs the propose scope (an admin key or an owner covers it); no key approves.", need: "propose", run: on(async (c, e) => {
      if (!(await e.invoice(c.params[0]!))) return err(404, "no invoice");
      const out = await e.propose(c.params[0]!);
      return out.ok ? json(200, { proposal: out.proposal, ...(out.alone ? { alone: out.alone, settled: out.settled ?? null, ...(out.airwallex_payout ? { airwallex_payout: out.airwallex_payout } : {}) } : {}) }) : err(409, out.reason);
    }) },
    { method: "GET", path: "/v1/engine/proposals/{id}", summary: "One payment proposal: its status, the hash of its exact terms, the challenge a passkey signs and the facts a person reads; { proposal }.", need: "read", run: on(async (c, e) => {
      const proposal = await e.proposal(c.params[0]!);
      return proposal ? json(200, { proposal }) : err(404, "no proposal");
    }) },
    { method: "POST", path: "/v1/engine/passkey/start", summary: "Start the approval passkey of the signed-in person (a session only, never a key): the challenge and code of a short enrolment window, the relying party, the person, and the passkeys to exclude.", need: "approve", run: on(async (c, e) => {
      const user = signedIn(c);
      const name = await displayName(c, user);
      // The relying party is this request's (../hostOrigin.ts): a passkey made on the site's /try is bound to the site.
      const s = await e.passkeyStart({ rpId: c.env.rpId, origin: c.env.origin });
      return json(200, { challenge: s.challenge, code: s.code, rp: { id: c.env.rpId, name: "Purser" }, user: { id: user, name, displayName: name }, exclude: s.exclude });
    }) },
    { method: "POST", path: "/v1/engine/passkey/finish", summary: "Finish the approval passkey (a session only; the approve scope): { code, credential } with the passkey the browser made for the challenge; it is labelled with the signed-in person's name. Answers { credential_id, how, cooling_until }. The company's first key needs nothing more; while another approval key is active, the first answer is 409 endorsement_required with the challenge (endorse), and the same request again must carry endorsement (an active approval key's assertion over it) or cosign { credential_id, assertion } (another owner's passkey over it); a recovered owner's first new key needs neither. 403 endorsement_refused for a bad one. Such a key approves nothing before cooling_until (72 hours; 0 on a /try test company, said in cooling_note). 409 with the engine's reason when it is refused otherwise.", need: "approve", run: on(async (c, e) => {
      const user = signedIn(c);
      const b = await kit.body(c, PasskeyFinish, 64_000);
      const tenant = c.caller!.tenantId;
      const ms = coolingOffMs(c.env, tenant);
      const tell = async (kind: string, detail: Record<string, string | null>) => { await kit.tellOwners?.(c, kind, detail); };
      // A recovery of this person by two platform admins stands for one new key (it then cools off like any other).
      const recovered = b.endorsement ? null : await recoveryGrant(c, user, c.now);
      const base = { code: b.code, credential: b.credential, label: await displayName(c, user), person: user, coolingOffMs: ms,
        ...(b.endorsement ? { endorsement: b.endorsement } : {}), ...(recovered ? { recovered } : {}) };
      let out = await e.passkeyFinish(base);
      // A second owner's co-signature over the challenge the engine names for this new key.
      if (!out.ok && out.code === "endorsement_required" && b.cosign && out.endorse) {
        let by: string | null = null, refused: string | null = null;
        try { by = await cosigner(c, user, out.endorse.challenge, b.cosign); } catch (x) {
          if (!(x instanceof AuthError)) throw x;
          refused = x.message;
        }
        // A refused co-signature goes to the engine too, which writes it to its audit log and refuses the key.
        out = await e.passkeyFinish(by ? { ...base, cosigned: { by } } : { ...base, cosignRefused: refused! });
      }
      if (!out.ok) {
        if (out.code === "endorsement_required") return json(409, { error: out.reason, code: out.code, endorse: out.endorse });
        if (out.code === "endorsement_refused") {
          await tell("approval_key.refused", { person: user, code: out.code, reason: out.reason });
          return json(403, { error: out.reason, code: out.code });
        }
        return err(409, out.reason);
      }
      if (out.how !== "first") await tell("approval_key.added", { person: user, how: out.how, by: out.by, cooling_until: out.cooling_until, credential: out.credential_id.slice(0, 12) });
      return json(200, { credential_id: out.credential_id, how: out.how, cooling_until: out.cooling_until, ...(out.how !== "first" && ms === 0 ? { cooling_note: TRY_COOLING_NOTE } : {}) });
    }) },
    { method: "POST", path: "/v1/engine/policy/second-key", summary: "Propose the CFO's rule for high-risk payments (off by default): { changes: [{ key, to }] } of approval.second_key_eur (an amount or \"\"), approval.second_key_new_payee, approval.second_key_bank_changed, approval.second_key_new_country (on or off). Answers { proposal }, a policy change the CFO approves with Face ID (POST /v1/engine/proposals/{id}/approve); nothing changes before that.", need: "admin", run: on(async (c, e) => {
      signedIn(c);
      const b = await kit.body(c, z.object({ changes: z.array(z.object({ key: z.string().max(60), to: z.string().max(20) }).strict()).min(1).max(4) }).strict(), 4_000);
      const out = await e.proposeSecondKey(b.changes);
      return out.ok ? json(200, { proposal: out.proposal }) : err(409, out.reason);
    }) },
    { method: "POST", path: "/v1/engine/security-key/start", summary: "Start registering a security key for the signed-in person (a session only): the second key of high-risk payments (USB or NFC, such as a YubiKey), beside their approval passkey, which must exist. Answers the challenge, the user handle, the relying party and the credentials to exclude; the page asks with authenticatorAttachment cross-platform.", need: "approve", run: on(async (c, e) => {
      const user = signedIn(c);
      const name = await displayName(c, user);
      const s = await e.securityKeyStart({ label: name, rp: { rpId: c.env.rpId, origin: c.env.origin } });
      return s.ok ? json(200, { challenge: s.challenge, user: { id: s.user_id, name, displayName: name }, rp: { id: c.env.rpId, name: "Purser" }, exclude: s.exclude }) : err(409, s.reason);
    }) },
    { method: "POST", path: "/v1/engine/security-key/finish", summary: "Finish registering the security key (a session only): { credential } as the browser made it; a credential the browser reports as a platform authenticator (Face ID, Touch ID) is refused, and so is one already registered.", need: "approve", run: on(async (c, e) => {
      const user = signedIn(c);
      const b = await kit.body(c, z.object({ credential: Credential }).strict(), 64_000);
      const out = await e.securityKeyFinish({ label: await displayName(c, user), credential: b.credential });
      return out.ok ? json(200, { credential_id: out.credential_id }) : err(409, out.reason);
    }) },
    { method: "POST", path: "/v1/engine/proposals/{id}/approve", summary: "Approve a proposal with the approval passkey (a session only; the approve scope: the CFO, or an owner of a company with no CFO): { terms_sha256, credential } with the passkey's signature over the proposal's challenge. Answers { status, message, settled }: only status approved pays (on the stand-in bank), and settled says paid, booked, archived and fed; a signature over other terms is refused and nothing runs. A key still in its cooling-off (new or recovered) is refused: 403 cooling_off with cooling_until, nothing paid, told to the owners.", need: "approve", run: on(async (c, e) => {
      signedIn(c);
      if (!(await e.proposal(c.params[0]!))) return err(404, "no proposal");
      const b = await kit.body(c, Approve, 64_000);
      // A visitor's test company (hands-on demo): the approval is stored and the payment held for the one pay route.
      const out = await e.approve({ proposal_id: c.params[0]!, terms_sha256: b.terms_sha256, credential: b.credential, ...(c.caller!.tenantId.startsWith("t_try_") ? { hold: true } : {}) });
      // A key in its cooling-off (review finding 2): refused with its reason, in the security log (a 403) and told to the owners.
      if (out.code === "cooling_off") {
        await kit.tellOwners?.(c, "approval.refused_cooling_off", { person: c.caller!.user, proposal: c.params[0]!, cooling_until: out.cooling_until ?? null });
        return json(403, { error: out.message, code: "cooling_off", status: "refused", message: out.message, cooling_until: out.cooling_until ?? null });
      }
      if (kit.approved && c.caller!.tenantId.startsWith("t_try_")) await kit.approved(c, out).catch(() => undefined);
      return json(200, out);
    }) },
    { method: "POST", path: "/v1/engine/proposals/{id}/retry", summary: "Try again: an approved payment whose execution failed (the bank was away, say) is run once more by the executor's own resume path, which never pays twice. Answers { status: retried, message, settled } with where things stand; 409 with the engine's reason when there is nothing to retry (paid, never approved, refused).", need: "admin", run: on(async (c, e) => {
      if (!(await e.proposal(c.params[0]!))) return err(404, "no proposal");
      const out = await e.retry(c.params[0]!);
      return out.status === "retried" ? json(200, out) : err(409, out.message);
    }) },
    // Purser Cloud's Airwallex actions (src/engine/awxActions.ts): each at the Airwallex sandbox when the admin's switch
    // and the daily caps allow it, else on the simulated bank, labelled. Test money either way; every payment still
    // waits for the CFO's passkey over its exact terms (POST /v1/engine/proposals/{id}/approve).
    { method: "GET", path: "/v1/engine/airwallex", summary: "Which bank each invoice was planned and paid at (the Airwallex sandbox or the simulated bank, test money either way), with Airwallex's ids: the payee (beneficiary id), the payee's bank check, the quote and conversion for a shortfall, the transfer (id, request_id, status, approval hash), a batch; the caps used today; and the labels of every fallback. { airwallex: { on, why }, caps, invoices, deposits, notes }.", need: "read", run: on(async (_c, e) => json(200, await e.airwallex())) },
    { method: "POST", path: "/v1/engine/invoices/{id}/supplier", summary: "A new supplier from an invoice waiting for one (a session only): { how, street, city, postcode }, how you confirmed the account on a contact you already had. The payee's bank is asked whether the account carries the supplier's name (Airwallex's account verification, or a labelled stand-in), then a payee_add proposal waits for the CFO's passkey; once signed, the supplier is added at the bank (Airwallex: schema, validation, create). Answers { proposal, name_check }; 409 with the reason and the check when it is refused.", need: "admin", run: on(async (c, e) => {
      const user = signedIn(c);
      if (!(await e.invoice(c.params[0]!))) return err(404, "no invoice");
      const b = await kit.body(c, Supplier, 4_000);
      const out = await e.addSupplier(c.params[0]!, { by: await displayName(c, user), how: b.how, address: { street: b.street, city: b.city, postcode: b.postcode } });
      return out.ok ? json(201, out) : json(409, { error: out.reason, name_check: out.name_check });
    }) },
    { method: "POST", path: "/v1/engine/batch", summary: "Pay all approved: { invoice_ids } (1 to 20 ready invoices). Each is planned as on its own (its own exact terms, FX for its shortfall only), then one batch proposal over them waits for one passkey signature over the batch's totals and every line. At the Airwallex sandbox the signed batch runs as one batch transfer. Answers { proposal, planned, not_planned }; 409 when none could be planned.", need: "admin", run: on(async (c, e) => {
      const b = await kit.body(c, Batch, 4_000);
      const out = await e.proposeBatch(b.invoice_ids);
      return out.ok ? json(201, out) : json(409, { error: out.reason, not_planned: out.not_planned ?? [] });
    }) },
    { method: "POST", path: "/v1/engine/deposit", summary: "Money in (a session only): { amount } up to 500.00 USD, a deposit on the bank's simulation into the company's USD account (the Airwallex sandbox's deposit simulation, or the simulated bank), recorded once and booked as a payment that names no invoice (held in suspense). Test money. Answers { deposit_id, status, amount, currency, settled }.", need: "admin", run: on(async (c, e) => {
      signedIn(c);
      const b = await kit.body(c, DepositIn, 1_000);
      const cents = Math.round(Number(b.amount) * 100);
      if (!(cents > 0 && cents <= 50_000)) return err(400, "an amount above 0.00 and at most 500.00");
      const out = await e.depositIn({ amountCents: cents, reference: `PURSER-IN-${Date.now().toString(36).toUpperCase()}`, payer: "Test customer (simulation)" });
      return out.ok ? json(201, out) : err(409, out.reason);
    }) },
    { method: "POST", path: "/v1/engine/sync", summary: "Follow the payments, book them, archive and feed the read model again; safe to repeat. Answers where things stand (ledger_entries, vault_added, fed, error).", need: "admin", run: on(async (_c, e) => json(200, await e.sync())) },
    { method: "GET", path: "/v1/engine/events", summary: "What the engine did, oldest first: ?after=<seq>&limit=<1 to 200>; { items, next }, where next is the seq to ask after. An event carries a short list of fields, never a bank account. 429 slow_down with retry_ms past 2 reads a second per company.", need: "read", run: on(async (c, e) => {
      const after = whole(c, "after", 0, Number.MAX_SAFE_INTEGER, 0), limit = whole(c, "limit", 1, 200, 100);
      try { return json(200, await e.events(after, limit)); } catch (x) {
        if (x instanceof SlowDown) return json(429, { error: x.message, code: "slow_down", retry_ms: x.retryMs });
        throw x;
      }
    }) },
    { method: "GET", path: "/v1/engine/vault", summary: "The files of the company's archive as its indexes list them: { files: [{ path, kind, bytes, sha256, added_at }] }.", need: "read", run: on(async (_c, e) => json(200, { files: await e.vaultFiles() })) },
    { method: "GET", path: "/v1/engine/vault/file", summary: "One file of the archive, ?path= as the list gives it; 404 for a path the archive's index does not list.", need: "read", run: on(async (c, e) => {
      const path = c.url.searchParams.get("path") ?? "";
      const bytes = path && path.length <= 1000 ? await e.vaultFile(path) : null;
      if (!bytes) return err(404, "no file");
      const name = path.slice(path.lastIndexOf("/") + 1).replace(/[^\w.-]+/g, "_");
      const type = FILE_TYPES[name.slice(name.lastIndexOf(".") + 1).toLowerCase()] ?? "application/octet-stream";
      return new Response(new Uint8Array(bytes), { status: 200, headers: { "content-type": type, "content-disposition": `attachment; filename="${name}"`, "cache-control": "no-store", "x-content-type-options": "nosniff" } });
    }) },
  ];
}
