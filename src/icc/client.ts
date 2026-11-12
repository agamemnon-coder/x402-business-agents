// The client for Intelligent Commerce Connect, built from the public documentation only (docs/visa-icc.md). Nothing
// here has been sent to the service. It is the only code that holds the signing key, the encryption keys and, for one
// step, a payment credential.
//
// What it will and will not do, all enforced in `request`, the one door every call goes through:
//   1. The endpoint allowlist, first: https to the documented test host only (a production host is refused by name),
//      and only six method and path shapes: the four instruction calls and two token reads. Enrolment and the passkey
//      calls are one-time set-up by the owner and are not here.
//   2. A JWT call to an ICC path without Message-Level Encryption configured is refused before sending: the API
//      reference marks encryption mandatory there. The two token reads may go without.
//   3. The call budget (src/icc/callBudget.ts): the call is counted and written to the log before it is sent; a call
//      over the approved number sends nothing. The client does not exist without a budget and a log.
//   4. Every call has a timeout (20 s unless set).
//   5. Nothing is sent twice. There is no retry, for a write or for a read. A write whose answer did not come, or
//      cannot be opened or read, ends as IccNoAnswer: the caller records it as unconfirmed and stops, because no
//      idempotency key is documented and no read call can tell what happened.
//
// An error or a log line never carries a request or response body, a header, a key, or an id: the documented error
// body gives its HTTP status, its `reason` code and the field it names (kept only when they look like plain codes);
// its message text is dropped. A credential comes back inside IccCredential, which prints nothing.

import { randomUUID, type KeyObject } from "node:crypto";
import { inspect } from "node:util";
import { IccCryptoError, decryptResponse, encryptRequest, requestHeaders, type IccDateHeader, type IccDigestForm, type IccMethod, type IccSigner, type MleRequestKey } from "./auth.js";
import { assertIccBudget, countIccCall, type IccBudget } from "./callBudget.js";

export const ICC_TEST_HOST = "apitest.cybersource.com";
/** The documented production hosts: named so that the refusal can say what they are. Never called. */
const PRODUCTION_HOSTS = ["api.cybersource.com", "api.in.cybersource.com"];
export const ICC_PATH_PREFIXES = ["/icc/v1", "/acp/v1"] as const;
export type IccPathPrefix = (typeof ICC_PATH_PREFIXES)[number];
export const ICC_DEFAULT_TIMEOUT_MS = 20_000;
const MAX_ANSWER_BYTES = 1024 * 1024;

/** Refused here, before the budget is counted and before anything is sent. */
export class IccNotAllowed extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IccNotAllowed";
  }
}

/** The service answered with an error. Only codes are kept: the HTTP status, the reason, the field it names. */
export class IccApiError extends Error {
  constructor(readonly method: string, readonly endpoint: string, readonly httpStatus: number, readonly reason: string | null, readonly detailReason: string | null, readonly source: string | null) {
    super(`ICC ${method} ${endpoint} -> ${httpStatus}${reason ? ` ${reason}` : ""}${source ? ` (field ${source})` : ""}`);
    this.name = "IccApiError";
  }
}

export type IccNoAnswerWhy = "timeout" | "network" | "unreadable" | "server error" | "unexpected status";

/** The request was sent and no usable answer came. For a write the outcome is unknown: it is never sent again. */
export class IccNoAnswer extends Error {
  constructor(readonly method: string, readonly endpoint: string, readonly why: IccNoAnswerWhy, readonly write: boolean, readonly httpStatus: number | null = null) {
    super(`ICC ${method} ${endpoint}: no usable answer (${why}${httpStatus ? `, HTTP ${httpStatus}` : ""})${write ? "; the outcome is unknown and the call is not sent again" : ""}`);
    this.name = "IccNoAnswer";
  }
}

// The six shapes, as fixed patterns. An instruction ID is 36 to 50 characters where it is a path parameter.
const ICC_PATH = /^(\/icc\/v1|\/acp\/v1)\/instructions(?:\/[A-Za-z0-9-]{36,50}\/(credentials|confirmations|cancel))?$/;
const INSTRUMENT_PATH = /^\/tms\/v1\/instrumentidentifiers\/[A-Za-z0-9]{12,32}$/;
const TOKENIZED_CARD_PATH = /^\/tms\/v2\/tokenized-cards\/[A-Za-z0-9_-]{8,64}$/;

/**
 * The allowlist as a pure table: the call's endpoint with its ids replaced (what the log gets), whether it is an ICC
 * path and whether it is a write; null for anything that is not one of the six shapes under this prefix.
 */
export function allowedCall(method: string, path: string, prefix: IccPathPrefix): { endpoint: string; icc: boolean; write: boolean } | null {
  if (method === "GET") {
    if (INSTRUMENT_PATH.test(path)) return { endpoint: "/tms/v1/instrumentidentifiers/{id}", icc: false, write: false };
    if (TOKENIZED_CARD_PATH.test(path)) return { endpoint: "/tms/v2/tokenized-cards/{id}", icc: false, write: false };
    return null;
  }
  const hit = ICC_PATH.exec(path);
  if (!hit || hit[1] !== prefix) return null;
  const tail = hit[2];
  // POST creates, asks for the credential and confirms; PUT cancels. Nothing else.
  const ok = method === "POST" ? tail !== "cancel" : method === "PUT" && tail === "cancel";
  return ok ? { endpoint: `${prefix}/instructions${tail ? `/{id}/${tail}` : ""}`, icc: true, write: true } : null;
}

/** The single-use payment credential of one answer. It prints nothing, serialises to nothing, and can be dropped. */
export class IccCredential {
  #authorization: string | null;
  #signedPayload: string | null;

  constructor(authorization: unknown, signedPayload: unknown) {
    this.#authorization = typeof authorization === "string" && authorization ? authorization : null;
    this.#signedPayload = typeof signedPayload === "string" && signedPayload ? signedPayload : null;
  }

  /** What the documented shape lets us say without opening it: which of the two fields came, and the payload's form. */
  envelope(): { authorization: boolean; signedPayload: boolean; signedPayloadForm: "three parts" | "other" | "absent" } {
    const p = this.#signedPayload;
    return { authorization: this.#authorization !== null, signedPayload: p !== null, signedPayloadForm: p === null ? "absent" : /^[\w-]+\.[\w-]+\.[\w-]+$/.test(p) ? "three parts" : "other" };
  }

  /** Lets go of both values. A JavaScript string cannot be overwritten; nothing here holds it after this. */
  drop(): void {
    this.#authorization = null;
    this.#signedPayload = null;
  }

  toJSON(): string { return "[ICC credential: never printed]"; }
  toString(): string { return this.toJSON(); }
  [inspect.custom](): string { return this.toJSON(); }
}

export interface IccMle {
  /** The certificate requests are encrypted for. */
  request: MleRequestKey;
  /** The key ID of the Response MLE key, sent in the token so that the answer is encrypted for it. */
  responseKeyId: string;
  responsePrivateKey: KeyObject;
}

export interface IccClientConfig {
  merchantId: string;
  signer: IccSigner;
  mle: IccMle | null;
  /** The approved number of calls and the log they are counted in: both required. */
  budget: number;
  callLog: string;
  /** Only the documented test host is accepted; this may repeat it. */
  host?: string;
  pathPrefix?: IccPathPrefix;
  digestForm?: IccDigestForm;
  dateHeader?: IccDateHeader;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  uuid?: () => string;
  pid?: number;
}

export interface IccInstructionAnswer {
  httpStatus: number;
  clientCorrelationId: string | null;
  instructionId: string | null;
  status: string | null;
  pendingEvents: string[];
  /** Whether the answer came encrypted. */
  encrypted: boolean;
}

export type IccCredentialsAnswer =
  | { kind: "complete"; httpStatus: number; clientCorrelationId: string | null; instructionId: string | null; status: string | null; credential: IccCredential; encrypted: boolean }
  | { kind: "pending"; httpStatus: number; clientCorrelationId: string | null; instructionId: string | null; status: string | null; pendingEvents: string[]; encrypted: boolean };

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown, max = 255): string | null => (typeof v === "string" && v.length > 0 && v.length <= max ? v : null);
/** A code as the documentation's examples show them (INVALID_ARGUMENT, PENDING): kept only in that plain form. */
const code = (v: unknown): string | null => (typeof v === "string" && /^[A-Z][A-Z0-9_]{0,63}$/.test(v) ? v : null);
/** A field path (mandates[].description): letters, digits, points and brackets, short, and no long digit run. */
const fieldName = (v: unknown): string | null => (typeof v === "string" && /^[A-Za-z][A-Za-z0-9_.[\]]{0,79}$/.test(v) && !/\d{8,}/.test(v) ? v : null);
const codes = (v: unknown): string[] => (Array.isArray(v) ? v.map(code).filter((c): c is string => c !== null).slice(0, 8) : []);

export class IccClient {
  readonly host = ICC_TEST_HOST;
  readonly pathPrefix: IccPathPrefix;
  readonly timeoutMs: number;
  private readonly budget: IccBudget;
  private readonly fetch: typeof fetch;
  private readonly now: () => Date;
  private readonly uuid: () => string;

  constructor(private readonly cfg: IccClientConfig) {
    const host = cfg.host ?? ICC_TEST_HOST;
    if (PRODUCTION_HOSTS.includes(host)) throw new IccNotAllowed(`${host} is a production host; this build only talks to the test host ${ICC_TEST_HOST}`);
    if (host !== ICC_TEST_HOST) throw new IccNotAllowed(`the ICC host must be exactly ${ICC_TEST_HOST}`);
    this.pathPrefix = cfg.pathPrefix ?? "/icc/v1";
    if (!ICC_PATH_PREFIXES.includes(this.pathPrefix)) throw new IccNotAllowed(`the ICC path prefix must be one of ${ICC_PATH_PREFIXES.join(", ")}`);
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(cfg.merchantId)) throw new IccNotAllowed("the merchant ID is not a plain ID");
    const budget = { budget: cfg.budget, file: cfg.callLog };
    assertIccBudget(budget);
    this.budget = budget;
    this.timeoutMs = cfg.timeoutMs ?? ICC_DEFAULT_TIMEOUT_MS;
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0) throw new IccNotAllowed("every ICC call needs a timeout");
    this.fetch = cfg.fetchImpl ?? ((...a) => fetch(...a));
    this.now = cfg.now ?? (() => new Date());
    this.uuid = cfg.uuid ?? randomUUID;
  }

  /**
   * One HTTP call, through the allowlist, the encryption rule, the budget and the timeout, in that order. Returns the
   * answer's JSON for a 2xx status. Sent once: no retry.
   */
  async request(method: IccMethod, path: string, body?: unknown): Promise<{ httpStatus: number; json: unknown; encrypted: boolean }> {
    const allowed = allowedCall(method, path, this.pathPrefix);
    if (!allowed || (method === "GET") !== (body === undefined)) throw new IccNotAllowed(`${method} on this path is not one of the ICC calls this client makes; nothing was sent`);
    const { endpoint, icc, write } = allowed;
    const jwt = this.cfg.signer.scheme !== "http-signature";
    const mle = jwt ? this.cfg.mle : null;
    if (icc && jwt && !mle) throw new IccNotAllowed(`${method} ${endpoint} needs Message-Level Encryption, which is not configured; nothing was sent`);

    // Built and signed here, before the budget: a local failure costs no call.
    const at = this.now();
    const payload = body === undefined ? null : mle ? JSON.stringify({ encryptedRequest: encryptRequest(JSON.stringify(body), mle.request) }) : JSON.stringify(body);
    const headers = requestHeaders(this.cfg.signer, {
      method, host: this.host, path, body: payload, merchantId: this.cfg.merchantId, at, jti: this.uuid(),
      digestForm: this.cfg.digestForm, dateHeader: this.cfg.dateHeader, ...(mle ? { responseMleKeyId: mle.responseKeyId } : {}),
    });

    countIccCall(this.budget, { method, endpoint, at, pid: this.cfg.pid });

    let res: Response, raw: string;
    try {
      res = await this.fetch(`https://${this.host}${path}`, { method, headers: { accept: "application/json", ...headers }, ...(payload === null ? {} : { body: payload }), redirect: "error", signal: AbortSignal.timeout(this.timeoutMs) });
      raw = await res.text();
    } catch (e) {
      const name = (e as { name?: string } | null)?.name;
      throw new IccNoAnswer(method, endpoint, name === "TimeoutError" || name === "AbortError" ? "timeout" : "network", write);
    }
    const status = res.status;
    let json: unknown = null, encrypted = false, readable = raw.length <= MAX_ANSWER_BYTES;
    if (readable && raw.trim() !== "") {
      try {
        json = JSON.parse(raw) as unknown;
        if (isObject(json) && typeof json.encryptedResponse === "string") {
          if (!this.cfg.mle) throw new IccCryptoError("no response key");
          json = JSON.parse(decryptResponse(json.encryptedResponse, this.cfg.mle.responsePrivateKey)) as unknown;
          encrypted = true;
        }
      } catch {
        json = null;
        readable = false;
      }
    }
    if (status >= 200 && status < 300) {
      if (!readable || !isObject(json)) throw new IccNoAnswer(method, endpoint, "unreadable", write, status);
      return { httpStatus: status, json, encrypted };
    }
    // A write the service failed on (5xx) may or may not have happened: the outcome is unknown.
    if (status >= 500 && write) throw new IccNoAnswer(method, endpoint, "server error", write, status);
    if (status < 400) throw new IccNoAnswer(method, endpoint, "unexpected status", write, status);
    const error = isObject(json) && isObject(json.error) ? json.error : {};
    const detail = isObject(error.detail) ? error.detail : {};
    throw new IccApiError(method, endpoint, status, code(error.reason), code(detail.reason), fieldName(detail.source));
  }

  private instructionAnswer(r: { httpStatus: number; json: unknown; encrypted: boolean }): IccInstructionAnswer {
    const j = r.json as Record<string, unknown>;
    return { httpStatus: r.httpStatus, clientCorrelationId: text(j.clientCorrelationId), instructionId: text(j.instructionId, 50), status: code(j.status), pendingEvents: codes(j.pendingEvents), encrypted: r.encrypted };
  }

  /** POST {prefix}/instructions: creates the instruction with its mandates. 200 with an ID, or 202 PENDING. */
  async createInstruction(body: Record<string, unknown>): Promise<IccInstructionAnswer> {
    return this.instructionAnswer(await this.request("POST", `${this.pathPrefix}/instructions`, body));
  }

  /** POST {prefix}/instructions/{id}/credentials: the credential for one transaction, or the pending answer. */
  async requestCredentials(instructionId: string, body: Record<string, unknown>): Promise<IccCredentialsAnswer> {
    const r = await this.request("POST", `${this.pathPrefix}/instructions/${instructionId}/credentials`, body);
    const j = r.json as Record<string, unknown>;
    const common = { httpStatus: r.httpStatus, clientCorrelationId: text(j.clientCorrelationId), instructionId: text(j.instructionId, 50), status: code(j.status), encrypted: r.encrypted };
    const pendingEvents = codes(j.pendingEvents);
    if (pendingEvents.length > 0 || (j.authorization === undefined && j.signedPayload === undefined)) return { kind: "pending", ...common, pendingEvents };
    const credential = new IccCredential(j.authorization, j.signedPayload);
    // The parsed answer is let go of here; only the credential object holds the two values now.
    delete j.authorization;
    delete j.signedPayload;
    return { kind: "complete", ...common, credential };
  }

  /** POST {prefix}/instructions/{id}/confirmations: reports a payment's outcome. 202 with the correlation ID. */
  async confirm(instructionId: string, body: Record<string, unknown>): Promise<{ httpStatus: number; clientCorrelationId: string | null }> {
    const r = await this.request("POST", `${this.pathPrefix}/instructions/${instructionId}/confirmations`, body);
    return { httpStatus: r.httpStatus, clientCorrelationId: text((r.json as Record<string, unknown>).clientCorrelationId) };
  }

  /** PUT {prefix}/instructions/{id}/cancel: cancels before credentials are used. Needs fresh assurance data. */
  async cancel(instructionId: string, body: Record<string, unknown>): Promise<IccInstructionAnswer> {
    return this.instructionAnswer(await this.request("PUT", `${this.pathPrefix}/instructions/${instructionId}/cancel`, body));
  }

  /** GET /tms/v1/instrumentidentifiers/{id}: the token's state only; the masked number in the answer is not kept. */
  async getInstrumentIdentifier(id: string): Promise<{ httpStatus: number; state: string | null }> {
    const r = await this.request("GET", `/tms/v1/instrumentidentifiers/${id}`);
    return { httpStatus: r.httpStatus, state: code((r.json as Record<string, unknown>).state) };
  }

  /** GET /tms/v2/tokenized-cards/{id}: the tokenized card's state only. */
  async getTokenizedCard(id: string): Promise<{ httpStatus: number; state: string | null }> {
    const r = await this.request("GET", `/tms/v2/tokenized-cards/${id}`);
    return { httpStatus: r.httpStatus, state: code((r.json as Record<string, unknown>).state) };
  }
}
