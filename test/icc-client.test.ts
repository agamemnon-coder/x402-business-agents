// The ICC client (src/icc/client.ts) against the TEST STAND-IN (test/support/iccStandIn.ts), which is built from the
// documented request and response shapes and is not Visa's or Cybersource's service. No network: the stand-in is a
// fetch function. What is proven here is the client's own behaviour: the allowlist, the budget, the log, the timeout,
// nothing sent twice, and nothing private in an error or a log.
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { countByEndpoint, readCallLog } from "../src/airwallex/callBudget.js";
import { sharedSecretKey, type IccSigner } from "../src/icc/auth.js";
import { IccBudgetSpent, iccBudgetFromEnv } from "../src/icc/callBudget.js";
import { ICC_TEST_HOST, IccApiError, IccClient, IccCredential, IccNoAnswer, IccNotAllowed, allowedCall, type IccClientConfig } from "../src/icc/client.js";
import { makeIccTestKeys, type IccTestKeys } from "./support/iccKeys.js";
import { IccStandIn, type StandInConfig } from "./support/iccStandIn.js";

const MERCHANT = "purser_sandbox";
/** A made-up instrument identifier of the documented length (32). Not a card number and not a real ID. */
const INSTRUMENT = "A1B2C3D4".repeat(4);
const NAME = ["Northwind", "test", "shop"].join(" ");

let keys: IccTestKeys;
let log: string;
beforeAll(() => { keys = makeIccTestKeys(); });
beforeEach(() => { log = join(mkdtempSync(join(tmpdir(), "icc-client-test-")), "calls.jsonl"); });

function setup(o: { client?: Partial<IccClientConfig>; standIn?: Partial<StandInConfig>; scheme?: IccSigner["scheme"]; mle?: boolean } = {}) {
  const standIn = new IccStandIn({ keys, merchantId: MERCHANT, jwtKeyId: "jwt-key-1", sharedKeyId: "shared-key-1", responseMleKeyId: "response-key-1", ...o.standIn });
  const scheme = o.scheme ?? "jwt-p12";
  const signer: IccSigner = scheme === "jwt-p12" ? { scheme, keyId: "jwt-key-1", privateKey: keys.signing.privateKey } : { scheme, keyId: "shared-key-1", secret: sharedSecretKey(keys.sharedSecret) };
  const client = new IccClient({
    merchantId: MERCHANT, signer, budget: 10, callLog: log, fetchImpl: standIn.fetch,
    mle: o.mle === false ? null : { request: { publicKey: keys.request.publicKey, keyId: keys.request.keyId }, responseKeyId: "response-key-1", responsePrivateKey: keys.response.privateKey },
    ...o.client,
  });
  return { standIn, client };
}

const device = () => ({ applicationName: "Purser sourcing agent", fingerprintSessionId: "fp-session-1", deviceData: { type: "Mobile", brand: "Test" }, ipAddress: "192.168.0.100" });
const assurance = () => [{ verificationMethod: "23", verificationResults: "01", verificationTimestamp: "1794477000", authenticatedIdentities: { id: "identity-1" } }];
const createBody = (over: Record<string, unknown> = {}) => ({
  clientCorrelationId: "corr-1", paymentInformation: { instrumentIdentifier: { id: INSTRUMENT } }, deviceInformation: device(), assuranceData: assurance(),
  mandates: [{ mandateId: "P-0001", preferredMerchantName: NAME, declineThreshold: { amount: "12.00", currencyCode: "EUR" }, effectiveUntilTime: "1794479400", description: "order 1" }],
  consumerPrompt: "The sourcing agent may pay at most 12.00 EUR", ...over,
});
const credentialsBody = () => ({
  clientCorrelationId: "corr-1", paymentInformation: { instrumentIdentifier: { id: INSTRUMENT } },
  transactionData: [{
    clientReferenceInformation: { code: "P-0001" }, mandateReferenceData: [{ mandateId: "P-0001" }], type: "PURCHASE",
    orderInformation: { amountDetail: { totalAmount: "12.00", currency: "EUR" } },
    merchantInformation: { merchantName: NAME, merchantDescriptor: { url: "https://kit11.max-31b.workers.dev/", country: "NL" } },
  }],
});

describe("the six documented calls", () => {
  it("creates an instruction, requests the credential, confirms and cancels: signed, encrypted, in the documented shapes", async () => {
    const { standIn, client } = setup();
    const created = await client.createInstruction(createBody());
    expect(created).toMatchObject({ httpStatus: 200, clientCorrelationId: "corr-1", pendingEvents: [], encrypted: true });
    expect(created.instructionId).toMatch(/^[A-Za-z0-9-]{36,50}$/);
    const id = created.instructionId!;

    const cred = await client.requestCredentials(id, credentialsBody());
    if (cred.kind !== "complete") throw new Error("expected the complete answer");
    expect(cred).toMatchObject({ clientCorrelationId: "corr-1", instructionId: id, status: "COMPLETED" });
    expect(cred.credential).toBeInstanceOf(IccCredential);
    expect(cred.credential.envelope()).toEqual({ authorization: true, signedPayload: true, signedPayloadForm: "three parts" });

    const confirmed = await client.confirm(id, { clientCorrelationId: "corr-1", paymentInformation: { instrumentIdentifier: { id: INSTRUMENT } }, confirmationData: [{ clientReferenceInformation: { code: "P-0001" }, processorInformation: { transactionType: "PURCHASE", transactionStatus: "CANCELLED", amountDetail: { totalAmount: "12.00", currency: "EUR" } } }] });
    expect(confirmed).toEqual({ httpStatus: 202, clientCorrelationId: "corr-1" });

    const cancelled = await client.cancel(id, { clientCorrelationId: "corr-1", paymentInformation: { instrumentIdentifier: { id: INSTRUMENT } }, deviceInformation: device(), assuranceData: assurance() });
    expect(cancelled).toMatchObject({ httpStatus: 200, instructionId: id, status: "CANCELLED" });

    // The stand-in verified each token and opened each body: what it saw is what the client was given.
    expect(standIn.seen.map((s) => `${s.method} ${s.op} ${s.scheme} ${s.encrypted} ${s.answered}`)).toEqual([
      "POST create jwt-rs256 true 200", "POST credentials jwt-rs256 true 200", "POST confirm jwt-rs256 true 202", "PUT cancel jwt-rs256 true 200",
    ]);
    expect(standIn.seen[0]!.body).toEqual(createBody());
    expect(standIn.seen[1]!.path).toBe(`/icc/v1/instructions/${id}/credentials`);
    expect(standIn.seen[0]!.claims).toMatchObject({ "request-method": "post", "request-resource-path": "/icc/v1/instructions", "v-c-response-mle-kid": "response-key-1" });
  });

  it("reads the instrument identifier and the tokenized card, returning the state only", async () => {
    const { standIn, client } = setup();
    expect(await client.getInstrumentIdentifier(INSTRUMENT)).toEqual({ httpStatus: 200, state: "ACTIVE" });
    expect(await client.getTokenizedCard("tok-card-0001")).toEqual({ httpStatus: 200, state: "ACTIVE" });
    expect(standIn.seen.map((s) => `${s.method} ${s.path}`)).toEqual([`GET /tms/v1/instrumentidentifiers/${INSTRUMENT}`, "GET /tms/v2/tokenized-cards/tok-card-0001"]);
    expect(standIn.seen[0]!.claims).not.toHaveProperty("digest");
  });

  it("the other two documented schemes sign the reads: the shared-secret JWT and the HTTP Signature", async () => {
    for (const scheme of ["jwt-shared-secret", "http-signature"] as const) {
      const { standIn, client } = setup({ scheme, mle: false });
      expect(await client.getInstrumentIdentifier(INSTRUMENT)).toEqual({ httpStatus: 200, state: "ACTIVE" });
      expect(standIn.seen[0]!.scheme).toBe(scheme === "http-signature" ? "http-signature" : "jwt-hs256");
    }
    // With the one switch, the HTTP Signature names its date header `date`.
    const { standIn, client } = setup({ scheme: "http-signature", mle: false, client: { dateHeader: "date" } });
    await client.getTokenizedCard("tok-card-0001");
    expect(standIn.seen[0]!.answered).toBe(200);
  });

  it("the one switch each: the /acp/v1 prefix, and the digest of the hexadecimal text", async () => {
    const { standIn, client } = setup({ client: { pathPrefix: "/acp/v1", digestForm: "hex" }, standIn: { pathPrefix: "/acp/v1", digestForm: "hex" } });
    const created = await client.createInstruction(createBody());
    expect(created.httpStatus).toBe(200);
    expect(standIn.seen[0]!.path).toBe("/acp/v1/instructions");
    // A client on the default digest is not accepted by a stand-in that expects the other form.
    const other = setup({ standIn: { digestForm: "hex" } });
    await expect(other.client.createInstruction(createBody())).rejects.toMatchObject({ name: "IccApiError", httpStatus: 401, reason: "UNAUTHENTICATED" });
  });

  it("reads the credentials answer in the published spec's wrapped shape (either spelling) as well as flat", async () => {
    // The spec's 200 schema holds TransactionResponseComplete or TransactionResponseWithPendingEvents; its example spells
    // them in lower camel case and gives pendingEvents as one string. Which shape the sandbox sends: unknown until access.
    const { standIn, client } = setup();
    const id = (await client.createInstruction(createBody())).instructionId!;
    const complete = { clientCorrelationId: "corr-1", instructionId: id, status: "COMPLETED", authorization: standIn.credential.authorization, signedPayload: standIn.credential.signedPayload };
    for (const wrapper of ["TransactionResponseComplete", "transactionResponseComplete"]) {
      standIn.answerNext("credentials", { [wrapper]: complete });
      const cred = await client.requestCredentials(id, credentialsBody());
      expect(cred).toMatchObject({ kind: "complete", clientCorrelationId: "corr-1", instructionId: id, status: "COMPLETED" });
      if (cred.kind === "complete") expect(cred.credential.envelope()).toEqual({ authorization: true, signedPayload: true, signedPayloadForm: "three parts" });
    }
    for (const wrapper of ["TransactionResponseWithPendingEvents", "transactionResponseWithPendingEvents"]) {
      standIn.answerNext("credentials", { [wrapper]: { clientCorrelationId: "corr-1", instructionId: id, status: "PENDING", pendingEvents: "PENDING_CARDHOLDER_AUTHENTICATION" } });
      expect(await client.requestCredentials(id, credentialsBody())).toMatchObject({ kind: "pending", instructionId: id, pendingEvents: ["PENDING_CARDHOLDER_AUTHENTICATION"] });
    }
    // An answer with neither a credential nor a pending event is not "pending": it is a complete answer with nothing in
    // it, which the flow refuses as not the documented shape (a credential may have come in a form not read here).
    standIn.answerNext("credentials", { somethingElse: { clientCorrelationId: "corr-1" } });
    const odd = await client.requestCredentials(id, credentialsBody());
    expect(odd.kind).toBe("complete");
    if (odd.kind === "complete") expect(odd.credential.envelope().signedPayload).toBe(false);
  });

  it("202 PENDING and the pending credentials answer come back as documented, not as errors", async () => {
    const { standIn, client } = setup();
    standIn.pendingNext("create");
    const pending = await client.createInstruction(createBody());
    expect(pending).toMatchObject({ httpStatus: 202, status: "PENDING", pendingEvents: ["PENDING_CARDHOLDER_AUTHENTICATION"] });
    standIn.pendingNext("credentials");
    expect(await client.requestCredentials(pending.instructionId!, credentialsBody())).toMatchObject({ kind: "pending", pendingEvents: ["PENDING_CARDHOLDER_AUTHENTICATION"] });
  });
});

describe("the endpoint allowlist", () => {
  it("only the test host over https; a production host is refused by name, before anything", () => {
    const base = () => setup().client;
    expect(base().host).toBe(ICC_TEST_HOST);
    for (const host of ["api.cybersource.com", "api.in.cybersource.com", "apitest.cybersource.com.evil.example", "localhost", "http://apitest.cybersource.com", "apitest.cybersource.com:8443"]) {
      expect(() => setup({ client: { host } }), host).toThrow(IccNotAllowed);
    }
    expect(() => setup({ client: { host: "api.cybersource.com" } })).toThrow(/production/);
    expect(() => setup({ client: { host: ICC_TEST_HOST } })).not.toThrow();
    expect(() => setup({ client: { pathPrefix: "/pts/v2" as never } })).toThrow(IccNotAllowed);
  });

  it("only the six method and path shapes: anything else sends nothing and is not counted", async () => {
    const { standIn, client } = setup();
    const id = `1-${"A".repeat(12)}${"0".repeat(8)}-0000-4000-8000-${"0".repeat(12)}`;
    const refused: [string, string][] = [
      ["POST", "/pts/v2/payments"], ["POST", "/icc/v1/tokens"], ["POST", "/tms/v1/instrumentidentifiers"], ["GET", "/icc/v1/instructions"],
      ["GET", `/icc/v1/instructions/${id}`], ["PUT", `/icc/v1/instructions/${id}`], ["DELETE", `/icc/v1/instructions/${id}/cancel`],
      ["POST", `/acp/v1/instructions`], ["POST", "/icc/v1/instructions?x=1"], ["POST", "/icc/v1/instructions/"], ["POST", `/icc/v1/instructions/${id}/../x/credentials`],
      ["POST", "/icc/v1/instructions/short/credentials"], ["GET", "/tms/v1/instrumentidentifiers/abc"], ["GET", `/tms/v1/instrumentidentifiers/${INSTRUMENT}/x`],
      ["POST", `/tms/v2/tokens/${INSTRUMENT}/payment-credentials`], ["POST", "/icc/v1/mpp/credentials"], ["GET", "//evil.example/tms/v2/tokenized-cards/abc"],
    ];
    for (const [method, path] of refused) {
      await expect(client.request(method as "GET", path, method === "GET" ? undefined : {}), `${method} ${path}`).rejects.toBeInstanceOf(IccNotAllowed);
    }
    expect(standIn.seen).toEqual([]);
    expect(existsSync(log)).toBe(false);
    // The pure table behind it: the masked endpoint for the log, and whether the path is an ICC path.
    expect(allowedCall("POST", `/icc/v1/instructions/${id}/credentials`, "/icc/v1")).toEqual({ endpoint: "/icc/v1/instructions/{id}/credentials", icc: true, write: true });
    expect(allowedCall("GET", `/tms/v1/instrumentidentifiers/${INSTRUMENT}`, "/icc/v1")).toEqual({ endpoint: "/tms/v1/instrumentidentifiers/{id}", icc: false, write: false });
    expect(allowedCall("POST", "/acp/v1/instructions", "/acp/v1")).toEqual({ endpoint: "/acp/v1/instructions", icc: true, write: true });
  });

  it("a JWT call to an ICC path without MLE configured is refused here, before sending; the reads may go without", async () => {
    const { standIn, client } = setup({ mle: false });
    await expect(client.createInstruction(createBody())).rejects.toThrow(/Message-Level Encryption/);
    expect(standIn.seen).toEqual([]);
    expect(existsSync(log)).toBe(false);
    expect(await client.getInstrumentIdentifier(INSTRUMENT)).toMatchObject({ state: "ACTIVE" });
    expect(standIn.seen[0]!.encrypted).toBe(false);
  });
});

describe("the call budget and the call log", () => {
  it("refuses to exist without a budget and a log", () => {
    expect(() => setup({ client: { budget: undefined as never } })).toThrow(/budget/);
    expect(() => setup({ client: { callLog: "" } })).toThrow(/log/);
    expect(() => setup({ client: { budget: -1 } })).toThrow(/budget/);
    expect(() => iccBudgetFromEnv({})).toThrow(/ICC_CALL_BUDGET.*ICC_CALL_LOG/);
    expect(() => iccBudgetFromEnv({ ICC_CALL_BUDGET: "3" })).toThrow(/ICC_CALL_LOG/);
    expect(() => iccBudgetFromEnv({ ICC_CALL_BUDGET: "three", ICC_CALL_LOG: log })).toThrow(/whole number/);
    expect(iccBudgetFromEnv({ ICC_CALL_BUDGET: "3", ICC_CALL_LOG: log })).toEqual({ budget: 3, file: log });
  });

  it("counts and logs before the request is sent; the log holds time, method, masked endpoint and pid only", async () => {
    let atRequest = -1;
    const { client } = setup({ standIn: { onRequest: () => { atRequest = readCallLog(log).length; }, now: () => new Date("2026-11-12T10:00:30Z") }, client: { now: () => new Date("2026-11-12T10:00:00Z"), pid: 4242 } });
    const created = await client.createInstruction(createBody());
    expect(atRequest).toBe(1);
    await client.requestCredentials(created.instructionId!, credentialsBody());
    await client.getInstrumentIdentifier(INSTRUMENT);
    const lines = readCallLog(log);
    expect(lines).toEqual([
      { at: "2026-11-12T10:00:00.000Z", method: "POST", endpoint: "/icc/v1/instructions", pid: 4242 },
      { at: "2026-11-12T10:00:00.000Z", method: "POST", endpoint: "/icc/v1/instructions/{id}/credentials", pid: 4242 },
      { at: "2026-11-12T10:00:00.000Z", method: "GET", endpoint: "/tms/v1/instrumentidentifiers/{id}", pid: 4242 },
    ]);
    expect(countByEndpoint(lines)).toEqual([
      { endpoint: "POST /icc/v1/instructions", calls: 1 }, { endpoint: "POST /icc/v1/instructions/{id}/credentials", calls: 1 }, { endpoint: "GET /tms/v1/instrumentidentifiers/{id}", calls: 1 },
    ]);
    const text = readFileSync(log, "utf8");
    expect(text).not.toContain(created.instructionId!);
    expect(text).not.toContain(INSTRUMENT);
  });

  it("an over-budget call sends nothing; a call the service refuses still counts", async () => {
    const { standIn, client } = setup({ client: { budget: 2 } });
    standIn.errorNext("create", 400, "INVALID_ARGUMENT");
    await expect(client.createInstruction(createBody())).rejects.toBeInstanceOf(IccApiError);
    await client.getInstrumentIdentifier(INSTRUMENT);
    const spent = await client.createInstruction(createBody()).catch((e: unknown) => e);
    expect(spent).toBeInstanceOf(IccBudgetSpent);
    expect((spent as Error).message).toBe("the approved ICC call budget of 2 is spent; POST /icc/v1/instructions was not sent (ask the owner before any further call)");
    expect(standIn.seen).toHaveLength(2);
    expect(readCallLog(log)).toHaveLength(2);
    // The count is the log's: another client on the same log has nothing left either.
    const second = setup({ client: { budget: 2 } });
    await expect(second.client.getInstrumentIdentifier(INSTRUMENT)).rejects.toBeInstanceOf(IccBudgetSpent);
    expect(second.standIn.seen).toEqual([]);
  });
});

describe("answers that do not come, or cannot be read", () => {
  it("every call has a timeout: a call that is never answered ends as no answer, and is not sent again", async () => {
    const { standIn, client } = setup({ client: { timeoutMs: 30 } });
    standIn.hangNext("create");
    const e = await client.createInstruction(createBody()).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(IccNoAnswer);
    expect(e).toMatchObject({ why: "timeout", write: true, endpoint: "/icc/v1/instructions" });
    expect(standIn.count("create")).toBe(1);
    expect(setup().client.timeoutMs).toBe(20_000);
  });

  it("a lost answer, an answer that cannot be decrypted and a server error on a write: no answer, nothing sent twice", async () => {
    for (const [arrange, why] of [
      [(s: IccStandIn) => s.loseNext("create"), "network"],
      [(s: IccStandIn) => s.garbleNext("create"), "unreadable"],
      [(s: IccStandIn) => s.errorNext("create", 500, "INTERNAL_SERVER_ERROR"), "server error"],
      [(s: IccStandIn) => s.answerNext("create", [] as never), "unreadable"],
    ] as const) {
      const { standIn, client } = setup();
      arrange(standIn);
      const e = await client.createInstruction(createBody()).catch((x: unknown) => x);
      expect(e, why).toBeInstanceOf(IccNoAnswer);
      expect(e).toMatchObject({ why, write: true });
      expect(standIn.count("create")).toBe(1);
      expect(readCallLog(log).filter((l) => l.endpoint === "/icc/v1/instructions").length).toBeGreaterThanOrEqual(1);
    }
  });

  it("a read is not retried either: a server error is a typed error, a lost answer is no answer", async () => {
    const { standIn, client } = setup();
    standIn.errorNext("instrument", 500, "INTERNAL_SERVER_ERROR").loseNext("instrument");
    await expect(client.getInstrumentIdentifier(INSTRUMENT)).rejects.toMatchObject({ name: "IccApiError", httpStatus: 500, reason: "INTERNAL_SERVER_ERROR" });
    await expect(client.getInstrumentIdentifier(INSTRUMENT)).rejects.toMatchObject({ name: "IccNoAnswer", why: "network", write: false });
    expect(standIn.count("instrument")).toBe(2);
  });

  it("an answer in plain JSON is read too, and the result says it was not encrypted", async () => {
    const { standIn, client } = setup();
    standIn.plainNext("create");
    expect(await client.createInstruction(createBody())).toMatchObject({ httpStatus: 200, encrypted: false });
  });
});

describe("the documented error body, and what never leaves the client", () => {
  it("a typed error with the HTTP status, the reason and the field the service names; never its message text", async () => {
    const { standIn, client } = setup();
    const e = await client.createInstruction(createBody({ mandates: [{ mandateId: "P-0001", declineThreshold: { amount: "12.00", currencyCode: "EUR" }, description: "order 1" }] })).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(IccApiError);
    expect(e).toMatchObject({ httpStatus: 400, reason: "INVALID_ARGUMENT", source: "mandates[].effectiveUntilTime", endpoint: "/icc/v1/instructions" });
    expect((e as Error).message).toBe("ICC POST /icc/v1/instructions -> 400 INVALID_ARGUMENT (field mandates[].effectiveUntilTime)");
    expect(JSON.stringify(e) + String(e) + (e as Error).stack).not.toContain(standIn.errorMessage);
    for (const [status, reason] of [[401, "UNAUTHENTICATED"], [403, "FORBIDDEN"], [404, "NOT_FOUND"], [409, "UNAVAILABLE"]] as const) {
      standIn.errorNext("create", status, reason);
      await expect(client.createInstruction(createBody())).rejects.toMatchObject({ name: "IccApiError", httpStatus: status, reason });
    }
    // A reason or a field that does not look like a plain code is dropped, not repeated.
    standIn.errorNext("create", 400, `${standIn.credential.signedPayload}`);
    const odd = await client.createInstruction(createBody()).catch((x: unknown) => x);
    expect(odd).toMatchObject({ httpStatus: 400, reason: null });
  });

  it("a wrong signing key is refused by the stand-in with the documented 401", async () => {
    const { client } = setup({ client: { signer: { scheme: "jwt-p12", keyId: "jwt-key-1", privateKey: keys.response.privateKey } } });
    await expect(client.getInstrumentIdentifier(INSTRUMENT)).rejects.toMatchObject({ httpStatus: 401, reason: "UNAUTHENTICATED" });
  });

  it("the credential is held in an object that prints nothing, and is gone after drop()", async () => {
    const { standIn, client } = setup();
    const created = await client.createInstruction(createBody());
    const cred = await client.requestCredentials(created.instructionId!, credentialsBody());
    if (cred.kind !== "complete") throw new Error("expected the complete answer");
    const { inspect } = await import("node:util");
    const printed = `${JSON.stringify(cred)} ${inspect(cred, { depth: 6, showHidden: true })} ${String(cred.credential)} ${Object.keys(cred.credential).join()}`;
    expect(printed).not.toContain(standIn.credential.signedPayload);
    expect(printed).not.toContain(standIn.credential.authorization);
    expect(printed).toContain("[ICC credential: never printed]");
    cred.credential.drop();
    expect(cred.credential.envelope()).toEqual({ authorization: false, signedPayload: false, signedPayloadForm: "absent" });
  });

  it("no error and no log line carries a body, a header, a key, the credential, or the masked card number", async () => {
    const { standIn, client } = setup({ client: { timeoutMs: 30 } });
    const errors: unknown[] = [];
    const tryIt = async (p: Promise<unknown>) => { try { await p; } catch (e) { errors.push(e); } };
    await client.getInstrumentIdentifier(INSTRUMENT);
    const created = await client.createInstruction(createBody());
    standIn.garbleNext("credentials").loseNext("credentials").errorNext("credentials", 409, "UNAVAILABLE").hangNext("credentials");
    for (let i = 0; i < 4; i++) await tryIt(client.requestCredentials(created.instructionId!, credentialsBody()));
    const bodyMarker = ["body", "marker", "value"].join("-");
    await tryIt(client.request("POST", "/pts/v2/payments", { note: bodyMarker }));
    expect(errors).toHaveLength(5);
    const { inspect } = await import("node:util");
    const text = errors.map((e) => `${String(e)} ${JSON.stringify(e)} ${(e as Error).stack} ${inspect(e, { depth: 8 })}`).join("\n") + readFileSync(log, "utf8");
    const authorization = standIn.seen.map((s) => String(s.claims?.jti));
    for (const marker of [standIn.credential.signedPayload, standIn.credential.authorization, standIn.errorMessage, standIn.maskedNumber, bodyMarker, "fp-session-1", "identity-1", "192.168.0.100", "Bearer ", "encryptedRequest", created.instructionId!, INSTRUMENT, ...authorization]) {
      expect(text, marker.slice(0, 24)).not.toContain(marker);
    }
    expect(text).not.toMatch(/\b\d{12,19}\b/);
  });
});
