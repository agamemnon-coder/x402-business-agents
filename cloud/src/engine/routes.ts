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
import { AuthError, type Caller } from "../auth.js";
import { BadRequest } from "../read.js";
import type { TenantDb } from "../tenant.js";
import { SlowDown, type EngineApi } from "./api.js";

/** What a handler needs of the request's context (cloud/src/app.ts Ctx is one). */
export interface EngineCtx {
  env: { engine?: (tenantId: string) => EngineApi; rpId: string };
  req: Request;
  url: URL;
  params: string[];
  caller: Caller | null;
  db: TenantDb | null;
}

/** The route table's own helpers, handed in by cloud/src/app.ts (it imports this file, so this file cannot import it). */
export interface EngineKit<C extends EngineCtx> {
  json(status: number, body: unknown): Response;
  err(status: number, error: string): Response;
  body<T>(c: C, schema: z.ZodType<T>, maxBytes?: number): Promise<T>;
}

export interface EngineRoute<C extends EngineCtx> { method: "GET" | "POST"; path: string; summary: string; need: "read" | "admin"; run: (c: C) => Promise<Response> }

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
const PasskeyFinish = z.object({ code: z.string().min(1).max(32), credential: Credential }).strict();
const Approve = z.object({ terms_sha256: z.string().regex(/^[0-9a-f]{64}$/, "the SHA-256 of the terms, in hex"), credential: Credential }).strict();

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

const FILE_TYPES: Record<string, string> = { pdf: "application/pdf", json: "application/json; charset=utf-8", csv: "text/csv; charset=utf-8" };

export function engineRoutes<C extends EngineCtx>(kit: EngineKit<C>): EngineRoute<C>[] {
  const { json, err } = kit;
  /** The caller's own company's engine, or 404 when this cloud has none. */
  const on = (run: (c: C, engine: EngineApi) => Promise<Response>) => async (c: C): Promise<Response> => {
    const engine = c.env.engine?.(c.caller!.tenantId);
    return engine ? run(c, engine) : err(404, "the engine is not switched on for this cloud");
  };
  return [
    { method: "GET", path: "/v1/engine", summary: "Where the company's engine stands: the mode (test_money: it pays on a stand-in bank), the approval passkey, the stand-in bank's balances, and whether the audit and ledger chains verify. 404 on every /v1/engine route when the cloud runs no engine.", need: "read", run: on(async (_c, e) => json(200, await e.status())) },
    { method: "POST", path: "/v1/engine/documents", summary: "Upload a supplier invoice to the engine: { filename (1 to 200 characters), mime?, base64 }, at most 15 MB once decoded. It is filed, read and checked; answers { kind, sha256, invoice }. The same file again answers kind duplicate_document.", need: "admin", run: on(async (c, e) => {
      const b = await kit.body(c, Upload, UPLOAD_BODY_MAX_BYTES);
      const bytes = documentBytes(b.base64);
      try {
        return json(200, await e.upload({ bytes, filename: b.filename, ...(b.mime ? { mime: b.mime } : {}) }));
      } catch (x) {
        // What the inbox refuses (not a PDF, a photo or an e-mail; too large) is said in its own words; anything else is an internal error.
        const said = x instanceof Error ? x.message : String(x);
        if (/nothing was filed$/.test(said)) throw new BadRequest(said.slice(0, 500));
        throw x;
      }
    }) },
    { method: "GET", path: "/v1/engine/invoices", summary: "The engine's invoices: status, whether it can be paid, what the checks found, and its payment proposal if one was filed; { items }.", need: "read", run: on(async (_c, e) => json(200, { items: await e.invoices() })) },
    { method: "POST", path: "/v1/engine/invoices/{id}/pay", summary: "File the invoice's payment for approval: answers { proposal } with the exact terms' hash and what the passkey signs; 409 with the engine's reason when it will not (the invoice is held, waiting or paid). Nothing is paid before the approval.", need: "admin", run: on(async (c, e) => {
      if (!(await e.invoice(c.params[0]!))) return err(404, "no invoice");
      const out = await e.propose(c.params[0]!);
      return out.ok ? json(200, { proposal: out.proposal }) : err(409, out.reason);
    }) },
    { method: "GET", path: "/v1/engine/proposals/{id}", summary: "One payment proposal: its status, the hash of its exact terms, the challenge a passkey signs and the facts a person reads; { proposal }.", need: "read", run: on(async (c, e) => {
      const proposal = await e.proposal(c.params[0]!);
      return proposal ? json(200, { proposal }) : err(404, "no proposal");
    }) },
    { method: "POST", path: "/v1/engine/passkey/start", summary: "Start the approval passkey of the signed-in person (a session only, never a key): the challenge and code of a short enrolment window, the relying party, the person, and the passkeys to exclude.", need: "admin", run: on(async (c, e) => {
      const user = signedIn(c);
      const name = await displayName(c, user);
      const s = await e.passkeyStart();
      return json(200, { challenge: s.challenge, code: s.code, rp: { id: c.env.rpId, name: "Purser" }, user: { id: user, name, displayName: name }, exclude: s.exclude });
    }) },
    { method: "POST", path: "/v1/engine/passkey/finish", summary: "Finish the approval passkey (a session only): { code, credential } with the passkey the browser made for the challenge; it is labelled with the signed-in person's name. 409 with the engine's reason when it is refused.", need: "admin", run: on(async (c, e) => {
      const user = signedIn(c);
      const b = await kit.body(c, PasskeyFinish, 64_000);
      const out = await e.passkeyFinish({ code: b.code, credential: b.credential, label: await displayName(c, user), person: user });
      return out.ok ? json(200, { credential_id: out.credential_id }) : err(409, out.reason);
    }) },
    { method: "POST", path: "/v1/engine/proposals/{id}/approve", summary: "Approve a proposal with the approval passkey (a session only): { terms_sha256, credential } with the passkey's signature over the proposal's challenge. Answers { status, message, settled }: only status approved pays (on the stand-in bank), and settled says paid, booked, archived and fed; a signature over other terms is refused and nothing runs.", need: "admin", run: on(async (c, e) => {
      signedIn(c);
      if (!(await e.proposal(c.params[0]!))) return err(404, "no proposal");
      const b = await kit.body(c, Approve, 64_000);
      // A visitor's test company (hands-on demo): the approval is stored and the payment held for the one pay route.
      return json(200, await e.approve({ proposal_id: c.params[0]!, terms_sha256: b.terms_sha256, credential: b.credential, ...(c.caller!.tenantId.startsWith("t_try_") ? { hold: true } : {}) }));
    }) },
    { method: "POST", path: "/v1/engine/proposals/{id}/retry", summary: "Try again: an approved payment whose execution failed (the bank was away, say) is run once more by the executor's own resume path, which never pays twice. Answers { status: retried, message, settled } with where things stand; 409 with the engine's reason when there is nothing to retry (paid, never approved, refused).", need: "admin", run: on(async (c, e) => {
      if (!(await e.proposal(c.params[0]!))) return err(404, "no proposal");
      const out = await e.retry(c.params[0]!);
      return out.status === "retried" ? json(200, out) : err(409, out.message);
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
