// TEST STAND-IN. This file answers the ICC client's requests inside the tests. It is built only from the request and
// response shapes that docs/visa-icc.md documents. It is not Visa's or Cybersource's service, it was never compared with
// that service, and a test that passes against it proves nothing about that service: it proves that Purser's client
// sends what the documentation describes and handles the documented answers. It lives under test/ only; nothing under
// src/ imports it (test/icc-rail-off.test.ts asserts that).
//
// It is a fetch function, not a server: no port, no network. It checks what the documentation lets it check:
//   - the JWT: its signature with the test's public key (RS256) or shared secret (HS256), the documented claims, two
//     minutes at most, a version 4 token ID used once, and the digest of the HTTP body exactly as received;
//   - or the HTTP Signature: the HmacSHA256 of the validation string rebuilt from the headers it received;
//   - Message-Level Encryption on the ICC paths: {"encryptedRequest": <JWE>} opened with the test's private key, and
//     the answer encrypted for the test's response key when the token names it;
//   - the required fields and the limits of the four ICC request bodies, as listed in the published spec files.
// It answers in the documented shapes and nothing more. It enforces no limit of its own: whether the real service
// refuses a credential above a mandate's amount is not documented, so this stand-in does not pretend to know.
//
// A test can tell it to lose an answer (the request is taken, then the connection fails), to never answer, to answer
// 202 PENDING, to answer a documented error, or to answer with something unreadable.
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual, verify } from "node:crypto";
import { decryptResponse } from "../../src/icc/auth.js";
import { responseJwe, type IccTestKeys } from "./iccKeys.js";

export const STAND_IN_LABEL = "TEST STAND-IN: built from the documented shapes; not Visa's or Cybersource's service";
export const STAND_IN_HOST = "apitest.cybersource.com";

export type StandInOp = "create" | "credentials" | "confirm" | "cancel" | "instrument" | "tokenized-card";
type Behaviour =
  | { kind: "lose" }
  | { kind: "hang" }
  | { kind: "pending" }
  | { kind: "garble" }
  | { kind: "plain" }
  | { kind: "error"; status: number; reason: string }
  | { kind: "answer"; body: Record<string, unknown> };

export interface StandInSeen {
  op: StandInOp;
  method: string;
  path: string;
  /** The request's JSON after decryption, as the client meant it. */
  body: unknown;
  encrypted: boolean;
  scheme: "jwt-rs256" | "jwt-hs256" | "http-signature";
  claims: Record<string, unknown> | null;
  answered: number | "lost" | "hung";
}

export interface StandInConfig {
  keys: IccTestKeys;
  merchantId: string;
  jwtKeyId: string;
  sharedKeyId: string;
  responseMleKeyId: string;
  pathPrefix?: "/icc/v1" | "/acp/v1";
  digestForm?: "raw" | "hex";
  now?: () => Date;
  /** Called when a request arrives, before anything else: a test reads the call log here. */
  onRequest?: (method: string, path: string) => void;
}

type Rule = { at: string; required?: boolean; min?: number; max?: number; kind?: "array" | "object" | "ipv4" | "free"; oneOf?: string[] };

// The documented pattern of most string fields: not only the characters * . , ' # _ / - and no "./"; one line.
const TEXT = /^(?![*.,'#_/-]+$)(?!.*\.\/.*).*$/;
const IPV4 = /^(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)$/;

const PAYMENT: Rule[] = [
  { at: "clientCorrelationId", required: true, max: 255 },
  { at: "paymentInformation.instrumentIdentifier", required: true, kind: "object" },
  { at: "paymentInformation.instrumentIdentifier.id", required: true, min: 12, max: 32, kind: "free" },
  { at: "paymentInformation.customer.id", min: 1, max: 32, kind: "free" },
  { at: "paymentInformation.paymentInstrument.id", min: 1, max: 32, kind: "free" },
];
const DEVICE_AND_ASSURANCE: Rule[] = [
  { at: "deviceInformation", required: true, kind: "object" },
  { at: "deviceInformation.applicationName", required: true, max: 255 },
  { at: "deviceInformation.fingerprintSessionId", required: true, max: 255 },
  { at: "deviceInformation.deviceData", required: true, kind: "object" },
  { at: "deviceInformation.deviceData.type", required: true, max: 255 },
  { at: "deviceInformation.deviceData.brand", required: true, max: 255 },
  { at: "deviceInformation.deviceData.manufacturer", max: 255 },
  { at: "deviceInformation.deviceData.model", max: 255 },
  { at: "deviceInformation.ipAddress", required: true, max: 255, kind: "ipv4" },
  { at: "deviceInformation.clientDeviceId", max: 255 },
  { at: "deviceInformation.userAgent", max: 2048 },
  { at: "deviceInformation.country", min: 2, max: 2 },
  { at: "assuranceData", required: true, kind: "array" },
  { at: "assuranceData[].verificationMethod", required: true, kind: "free" },
  { at: "assuranceData[].verificationResults", required: true, kind: "free" },
  { at: "assuranceData[].verificationTimestamp", required: true, min: 1, max: 12 },
];
const RULES: Record<"create" | "credentials" | "confirm" | "cancel", Rule[]> = {
  create: [
    ...PAYMENT, { at: "paymentInformation", required: true, kind: "object" }, ...DEVICE_AND_ASSURANCE,
    { at: "assuranceData[].authenticatedIdentities.id", required: true, min: 1, max: 50 },
    { at: "mandates", required: true, kind: "array" },
    { at: "mandates[].mandateId", required: true, max: 50 },
    { at: "mandates[].preferredMerchantName", max: 255 },
    { at: "mandates[].merchantCategory", max: 255 },
    { at: "mandates[].merchantCategoryCode", max: 255 },
    { at: "mandates[].declineThreshold", required: true, kind: "object" },
    { at: "mandates[].declineThreshold.amount", min: 1, max: 12 },
    { at: "mandates[].declineThreshold.currencyCode", min: 3, max: 3 },
    { at: "mandates[].effectiveUntilTime", required: true, max: 12 },
    { at: "mandates[].quantity", max: 10, kind: "free" },
    { at: "mandates[].description", required: true, max: 255 },
    { at: "buyerInformation.merchantCustomerId", max: 255 },
    { at: "consumerPrompt", max: 4098 },
  ],
  credentials: [
    ...PAYMENT, { at: "paymentInformation", required: true, kind: "object" },
    { at: "transactionData", required: true, kind: "array" },
    { at: "transactionData[].clientReferenceInformation", required: true, kind: "object" },
    { at: "transactionData[].clientReferenceInformation.code", required: true, max: 50 },
    { at: "transactionData[].mandateReferenceData[].mandateId", max: 50 },
    { at: "transactionData[].type", kind: "free", oneOf: ["PURCHASE", "BILL_PAYMENT", "MONEY_TRANSFER", "DISBURSEMENT", "P2P"] },
    { at: "transactionData[].orderInformation", required: true, kind: "object" },
    { at: "transactionData[].orderInformation.amountDetail", required: true, kind: "object" },
    { at: "transactionData[].orderInformation.amountDetail.totalAmount", required: true, min: 1, max: 12 },
    { at: "transactionData[].orderInformation.amountDetail.currency", required: true, min: 3, max: 3 },
    { at: "transactionData[].orderInformation.lineItems[].items.productName", max: 10 },
    { at: "transactionData[].orderInformation.lineItems[].items.additionalInfo[].key", max: 255 },
    { at: "transactionData[].orderInformation.lineItems[].items.additionalInfo[].value", max: 255 },
    { at: "transactionData[].merchantOrderId", max: 50 },
    { at: "transactionData[].merchantInformation", required: true, kind: "object" },
    { at: "transactionData[].merchantInformation.merchantName", required: true, max: 40 },
    { at: "transactionData[].merchantInformation.merchantDescriptor", required: true, kind: "object" },
    { at: "transactionData[].merchantInformation.merchantDescriptor.country", required: true, min: 2, max: 2 },
    { at: "transactionData[].merchantInformation.merchantDescriptor.url", required: true, max: 255 },
    { at: "transactionData[].paymentOptions.dpaDynamicDataTtlMinutes", max: 10 },
    { at: "transactionData[].paymentOptions.dynamicDataType", kind: "free", oneOf: ["TAVV", "DAVV", "NONE"] },
  ],
  confirm: [
    ...PAYMENT, { at: "paymentInformation", required: true, kind: "object" },
    { at: "confirmationData", required: true, kind: "array" },
    { at: "confirmationData[].clientReferenceInformation", required: true, kind: "object" },
    { at: "confirmationData[].clientReferenceInformation.code", required: true, max: 50 },
    { at: "confirmationData[].processorInformation", required: true, kind: "object" },
    { at: "confirmationData[].processorInformation.transactionType", required: true, kind: "free", oneOf: ["PURCHASE", "AUTHORIZATION", "CAPTURE", "REFUND", "REVERSAL", "VERIFICATION", "CHARGEBACK", "FRAUD"] },
    { at: "confirmationData[].processorInformation.transactionStatus", required: true, kind: "free", oneOf: ["APPROVED", "DECLINED", "PENDING", "ERROR", "CANCELLED"] },
    { at: "confirmationData[].processorInformation.amountDetail.totalAmount", required: true, min: 1, max: 12 },
    { at: "confirmationData[].processorInformation.amountDetail.currency", required: true, min: 3, max: 3 },
    { at: "confirmationData[].processorInformation.responseCode", max: 2 },
    { at: "confirmationData[].processorInformation.approvalCode", max: 128 },
    { at: "confirmationData[].processorInformation.transactionTimestamp", min: 1, max: 12 },
    { at: "confirmationData[].orderInformation.orderId", max: 100 },
    { at: "confirmationData[].orderInformation.orderStatus", max: 50 },
    { at: "confirmationData[].orderInformation.orderDate", max: 12 },
    { at: "confirmationData[].merchantInformation.merchantName", max: 255 },
  ],
  cancel: [{ at: "clientCorrelationId", required: true, max: 255 }, { at: "paymentInformation.instrumentIdentifier.id", required: true, min: 12, max: 32, kind: "free" }, ...DEVICE_AND_ASSURANCE],
};

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** Every value at a dotted path ("a[].b"): one entry per parent that exists, undefined where the leaf is missing. */
function valuesAt(root: unknown, path: string): unknown[] {
  let level: unknown[] = [root];
  const segments = path.split(".");
  for (const [i, raw] of segments.entries()) {
    const each = raw.endsWith("[]");
    const key = each ? raw.slice(0, -2) : raw;
    const next: unknown[] = [];
    for (const parent of level) {
      if (!isObject(parent)) continue;
      const v = parent[key];
      if (each) { if (Array.isArray(v)) next.push(...v); else if (v !== undefined && i < segments.length - 1) next.push(v); }
      else if (v !== undefined || i === segments.length - 1) next.push(v);
    }
    level = next;
  }
  return level;
}

/** The first field of a body that breaks a rule, or null. */
export function firstInvalidField(op: keyof typeof RULES, body: unknown): string | null {
  if (!isObject(body)) return "(body)";
  for (const r of RULES[op]) {
    for (const v of valuesAt(body, r.at)) {
      if (v === undefined) { if (r.required) return r.at; continue; }
      if (r.kind === "array") { if (!Array.isArray(v) || v.length === 0) return r.at; continue; }
      if (r.kind === "object") { if (!isObject(v)) return r.at; continue; }
      if (typeof v !== "string") return r.at;
      if ((r.min !== undefined && v.length < r.min) || (r.max !== undefined && v.length > r.max)) return r.at;
      if (r.oneOf && !r.oneOf.includes(v)) return r.at;
      if (r.kind === "ipv4" ? !IPV4.test(v) : r.kind !== "free" && !TEXT.test(v)) return r.at;
    }
  }
  return null;
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export class IccStandIn {
  readonly label = STAND_IN_LABEL;
  readonly seen: StandInSeen[] = [];
  /** Instruction ID to the create body it was made from. */
  readonly instructions = new Map<string, { body: Record<string, unknown>; cancelled: boolean }>();
  /** What the complete credentials answer carries: random markers, new for every stand-in. Never a card number. */
  readonly credential = {
    authorization: `standin-authorization-${randomBytes(18).toString("base64url")}`,
    signedPayload: [randomBytes(24), randomBytes(96), randomBytes(48)].map((b) => b.toString("base64url")).join("."),
  };
  /** The text of every error answer's message, to prove the client never repeats it. */
  readonly errorMessage = `standin-error-message-${randomBytes(9).toString("base64url")}`;
  /** A masked card number in the instrument identifier answer, as the guide's example shows one. Built from parts. */
  readonly maskedNumber = `${"4" + "1".repeat(5)}${"X".repeat(6)}${"1".repeat(4)}`;
  private readonly usedTokenIds = new Set<string>();
  private readonly behaviours = new Map<StandInOp, Behaviour[]>();
  private readonly prefix: string;

  constructor(private readonly cfg: StandInConfig) {
    this.prefix = cfg.pathPrefix ?? "/icc/v1";
  }

  /** The next call of this kind: the request is taken, then the connection fails, so the answer is lost. */
  loseNext(op: StandInOp): this { return this.queue(op, { kind: "lose" }); }
  /** The next call of this kind is never answered (until the caller gives up). */
  hangNext(op: StandInOp): this { return this.queue(op, { kind: "hang" }); }
  /** The next call of this kind is answered 202 PENDING with pendingEvents, as documented. */
  pendingNext(op: StandInOp): this { return this.queue(op, { kind: "pending" }); }
  /** The next call of this kind is answered with something that cannot be opened. */
  garbleNext(op: StandInOp): this { return this.queue(op, { kind: "garble" }); }
  /** The next call of this kind is answered in plain JSON although the request asked for an encrypted answer. */
  plainNext(op: StandInOp): this { return this.queue(op, { kind: "plain" }); }
  /** The next call of this kind is answered with a documented error body. */
  errorNext(op: StandInOp, status: number, reason: string): this { return this.queue(op, { kind: "error", status, reason }); }
  /** The next call of this kind is answered 200 with this body instead of the usual one. */
  answerNext(op: StandInOp, body: Record<string, unknown>): this { return this.queue(op, { kind: "answer", body }); }

  private queue(op: StandInOp, b: Behaviour): this {
    this.behaviours.set(op, [...(this.behaviours.get(op) ?? []), b]);
    return this;
  }

  /** How many requests of this kind arrived. */
  count(op: StandInOp): number { return this.seen.filter((s) => s.op === op).length; }

  readonly fetch: typeof fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const method = (init?.method ?? "GET").toUpperCase();
    this.cfg.onRequest?.(method, url.pathname);
    const headers = new Headers(init?.headers);
    const raw = typeof init?.body === "string" ? init.body : null;
    if (url.protocol !== "https:" || url.host !== STAND_IN_HOST) throw new TypeError("fetch failed: the stand-in only answers for the documented test host");
    const route = this.route(method, url.pathname);
    if (!route) return this.error(404, "NOT_FOUND", null);

    // Who is calling.
    const auth = this.authenticate(method, url.pathname, headers, raw);
    if (!auth) return this.error(401, "UNAUTHENTICATED", null);

    // The body: encrypted on the ICC paths with a JWT (the reference marks MLE mandatory there).
    let body: unknown = null, encrypted = false;
    const responseKid = typeof auth.claims?.["v-c-response-mle-kid"] === "string" ? auth.claims["v-c-response-mle-kid"] as string : null;
    if (raw !== null) {
      try {
        const parsed = JSON.parse(raw) as unknown;
        if (isObject(parsed) && typeof parsed.encryptedRequest === "string" && Object.keys(parsed).length === 1) {
          const header = JSON.parse(Buffer.from(parsed.encryptedRequest.split(".")[0]!, "base64url").toString("utf8")) as Record<string, unknown>;
          if (header.alg !== "RSA-OAEP" || header.enc !== "A256GCM" || header.kid !== this.cfg.keys.request.keyId) return this.error(400, "INVALID_ARGUMENT", null);
          body = JSON.parse(decryptResponse(parsed.encryptedRequest, this.cfg.keys.request.privateKey));
          encrypted = true;
        } else body = parsed;
      } catch {
        return this.error(400, "INVALID_ARGUMENT", null);
      }
    }
    const mleRequired = route.icc && auth.scheme !== "http-signature";
    if (mleRequired && ((raw !== null && !encrypted) || responseKid !== this.cfg.responseMleKeyId)) return this.error(400, "INVALID_ARGUMENT", null);
    if (responseKid !== null && responseKid !== this.cfg.responseMleKeyId) return this.error(400, "INVALID_ARGUMENT", null);

    const record: StandInSeen = { op: route.op, method, path: url.pathname, body, encrypted, scheme: auth.scheme, claims: auth.claims, answered: 0 };
    this.seen.push(record);
    const reply = (status: number, json: unknown, plain = false): Response => {
      record.answered = status;
      const text = JSON.stringify(json);
      const out = responseKid && !plain ? JSON.stringify({ encryptedResponse: responseJwe(text, this.cfg.keys.response.publicKey, this.cfg.responseMleKeyId) }) : text;
      return new Response(out, { status, headers: { "content-type": "application/json" } });
    };
    const fail = (status: number, reason: string, source: string | null) => reply(status, this.errorBody(status, reason, source));

    const behaviour = this.behaviours.get(route.op)?.shift();
    if (behaviour?.kind === "hang") {
      record.answered = "hung";
      return new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) return;
        const abort = () => reject(signal.reason instanceof Error ? signal.reason : new DOMException("The operation was aborted.", "AbortError"));
        if (signal.aborted) abort(); else signal.addEventListener("abort", abort, { once: true });
      });
    }
    if (behaviour?.kind === "error") return fail(behaviour.status, behaviour.reason, null);

    // The documented requests, checked against the published field rules; then the documented answers.
    const id = route.id;
    const correlation = isObject(body) && typeof body.clientCorrelationId === "string" ? body.clientCorrelationId : "";
    let status = 200;
    let answer: Record<string, unknown>;
    if (route.op === "instrument") answer = { id, object: "instrumentIdentifier", state: "ACTIVE", card: { number: this.maskedNumber } };
    else if (route.op === "tokenized-card") answer = { id, state: "ACTIVE" };
    else {
      const invalid = firstInvalidField(route.op, body);
      if (invalid) return fail(400, "INVALID_ARGUMENT", invalid);
      if (route.op === "create") {
        const instructionId = `1-${randomBytes(6).toString("hex").toUpperCase()}${randomUUID()}`;
        this.instructions.set(instructionId, { body: body as Record<string, unknown>, cancelled: false });
        answer = behaviour?.kind === "pending"
          ? { clientCorrelationId: correlation, instructionId, status: "PENDING", pendingEvents: ["PENDING_CARDHOLDER_AUTHENTICATION"], propertyName: "" }
          : { clientCorrelationId: correlation, instructionId };
        if (behaviour?.kind === "pending") status = 202;
      } else {
        const instruction = this.instructions.get(id!);
        if (!instruction) return fail(404, "NOT_FOUND", null);
        if (route.op === "credentials") {
          answer = behaviour?.kind === "pending"
            ? { clientCorrelationId: correlation, instructionId: id, pendingEvents: ["PENDING_CARDHOLDER_AUTHENTICATION"] }
            : { clientCorrelationId: correlation, instructionId: id, status: "COMPLETED", authorization: this.credential.authorization, signedPayload: this.credential.signedPayload };
        } else if (route.op === "confirm") {
          status = 202;
          answer = { clientCorrelationId: correlation };
        } else {
          instruction.cancelled = true;
          answer = { clientCorrelationId: correlation, instructionId: id, status: "CANCELLED" };
        }
      }
    }
    if (behaviour?.kind === "answer") answer = behaviour.body;
    if (behaviour?.kind === "lose") { record.answered = "lost"; throw new TypeError("fetch failed"); }
    if (behaviour?.kind === "garble") { record.answered = status; return new Response(JSON.stringify({ encryptedResponse: "this.is.not.a.jwe" }), { status }); }
    return reply(status, answer, behaviour?.kind === "plain");
  }) as typeof fetch;

  private route(method: string, path: string): { op: StandInOp; id: string | null; icc: boolean } | null {
    const p = this.prefix.replaceAll("/", "\\/");
    const table: [string, RegExp, StandInOp, boolean][] = [
      ["POST", new RegExp(`^${p}\\/instructions$`), "create", true],
      ["POST", new RegExp(`^${p}\\/instructions\\/([A-Za-z0-9-]{36,50})\\/credentials$`), "credentials", true],
      ["POST", new RegExp(`^${p}\\/instructions\\/([A-Za-z0-9-]{36,50})\\/confirmations$`), "confirm", true],
      ["PUT", new RegExp(`^${p}\\/instructions\\/([A-Za-z0-9-]{36,50})\\/cancel$`), "cancel", true],
      ["GET", /^\/tms\/v1\/instrumentidentifiers\/([A-Za-z0-9]{12,32})$/, "instrument", false],
      ["GET", /^\/tms\/v2\/tokenized-cards\/([A-Za-z0-9_-]{1,64})$/, "tokenized-card", false],
    ];
    for (const [m, re, op, icc] of table) {
      const hit = m === method ? re.exec(path) : null;
      if (hit) return { op, id: hit[1] ?? null, icc };
    }
    return null;
  }

  private digestOf(raw: string): string {
    const hash = createHash("sha256").update(raw, "utf8");
    return this.cfg.digestForm === "hex" ? Buffer.from(hash.digest("hex"), "ascii").toString("base64") : hash.digest("base64");
  }

  private authenticate(method: string, path: string, headers: Headers, raw: string | null): { scheme: StandInSeen["scheme"]; claims: Record<string, unknown> | null } | null {
    const now = Math.floor((this.cfg.now ?? (() => new Date()))().getTime() / 1000);
    const bearer = /^Bearer ([\w-]+)\.([\w-]+)\.([\w-]+)$/.exec(headers.get("authorization") ?? "");
    if (bearer) {
      const [, h, c, s] = bearer as unknown as [string, string, string, string];
      let header: Record<string, unknown>, claims: Record<string, unknown>;
      try {
        header = JSON.parse(Buffer.from(h, "base64url").toString("utf8")) as Record<string, unknown>;
        claims = JSON.parse(Buffer.from(c, "base64url").toString("utf8")) as Record<string, unknown>;
      } catch { return null; }
      if (header.typ !== "JWT") return null;
      const signature = Buffer.from(s, "base64url");
      let scheme: StandInSeen["scheme"];
      if (header.alg === "RS256" && header.kid === this.cfg.jwtKeyId) {
        if (!verify("sha256", Buffer.from(`${h}.${c}`, "ascii"), this.cfg.keys.signing.publicKey, signature)) return null;
        scheme = "jwt-rs256";
      } else if (header.alg === "HS256" && header.kid === this.cfg.sharedKeyId) {
        const expected = createHmac("sha256", Buffer.from(this.cfg.keys.sharedSecret, "base64")).update(`${h}.${c}`, "ascii").digest();
        if (expected.length !== signature.length || !timingSafeEqual(expected, signature)) return null;
        scheme = "jwt-hs256";
      } else return null;
      const { iat, exp, jti } = claims;
      if (typeof iat !== "number" || typeof exp !== "number" || exp <= iat || exp - iat > 120 || now < iat - 5 || now > exp) return null;
      if (typeof jti !== "string" || !UUID_V4.test(jti) || this.usedTokenIds.has(jti)) return null;
      this.usedTokenIds.add(jti);
      if (claims["request-host"] !== STAND_IN_HOST || claims["request-method"] !== method.toLowerCase() || claims["request-resource-path"] !== path) return null;
      if (claims["v-c-jwt-version"] !== "2" || claims.iss !== this.cfg.merchantId || claims["v-c-merchant-id"] !== this.cfg.merchantId) return null;
      if (raw === null ? "digest" in claims || "digestAlgorithm" in claims : claims.digestAlgorithm !== "SHA-256" || claims.digest !== this.digestOf(raw)) return null;
      return { scheme, claims };
    }
    const sig = /^keyid="([^"]+)", algorithm="HmacSHA256", headers="([a-z -]+)", signature="([A-Za-z0-9+/=]+)"$/.exec(headers.get("signature") ?? "");
    if (!sig || sig[1] !== this.cfg.sharedKeyId) return null;
    const names = sig[2]!.split(" ");
    const dateName = names.includes("date") ? "date" : "v-c-date";
    const wanted = raw === null ? ["host", dateName, "request-target", "v-c-merchant-id"] : ["host", dateName, "request-target", "digest", "v-c-merchant-id"];
    if (names.join(" ") !== wanted.join(" ")) return null;
    if (headers.get("v-c-merchant-id") !== this.cfg.merchantId) return null;
    const date = Date.parse(headers.get(dateName) ?? "");
    if (!Number.isFinite(date) || Math.abs(date / 1000 - now) > 300) return null;
    if (raw !== null && headers.get("digest") !== `SHA-256=${this.digestOf(raw)}`) return null;
    const value = (n: string) => (n === "host" ? STAND_IN_HOST : n === "request-target" ? `${method.toLowerCase()} ${path}` : headers.get(n) ?? "");
    const expected = createHmac("sha256", Buffer.from(this.cfg.keys.sharedSecret, "base64")).update(names.map((n) => `${n}: ${value(n)}`).join("\n"), "utf8").digest();
    const given = Buffer.from(sig[3]!, "base64");
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
    return { scheme: "http-signature", claims: null };
  }

  private errorBody(status: number, reason: string, source: string | null): Record<string, unknown> {
    return { error: { status: String(status), reason, message: this.errorMessage, detail: { reason: "", source: source ?? "", sourceType: source ? "FIELD" : "", message: "" } } };
  }

  /** An error before the request is taken: plain JSON, since nothing says whether an error body is encrypted. */
  private error(status: number, reason: string, source: string | null): Response {
    return new Response(JSON.stringify(this.errorBody(status, reason, source)), { status, headers: { "content-type": "application/json" } });
  }
}
