// The ICC rail's environment reader, the client it builds and the private assurance file (src/icc/config.ts). The
// client is tried against the TEST STAND-IN (test/support/iccStandIn.ts: not Visa's or Cybersource's service). Keys
// are made at run time and written to a fresh private folder for the test.
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { ICC_ENV_NAMES, IccAssuranceFileError, iccClientFromEnv, iccEnvProblem, readAssuranceFile, readIccEnv } from "../src/icc/config.js";
import { ICC_MERCHANTS, ICC_MERCHANT_NAME_MAX, iccMerchantById, iccMerchantOf, iccRailOn } from "../src/icc/policy.js";
import { makeIccTestKeys, writeIccKeyFiles, type IccTestKeys } from "./support/iccKeys.js";
import { IccStandIn } from "./support/iccStandIn.js";

/** A made-up instrument identifier of the documented length (32). Not a card number and not a real ID. */
const INSTRUMENT = "A1B2C3D4".repeat(4);
let keys: IccTestKeys;
let files: ReturnType<typeof writeIccKeyFiles>;
beforeAll(() => { keys = makeIccTestKeys(); files = writeIccKeyFiles(keys); });

const full = (over: Record<string, string | undefined> = {}): Record<string, string | undefined> => ({
  KIT11_ICC_RAIL: "on", ICC_CALL_BUDGET: "3", ICC_CALL_LOG: join(files.dir, "calls.jsonl"), ICC_MERCHANT_ID: "purser_sandbox",
  ICC_JWT_KEY_ID: "jwt-key-1", ICC_JWT_PRIVATE_KEY_FILE: files.jwtKey,
  ICC_MLE_REQUEST_CERT_FILE: files.requestCert, ICC_MLE_RESPONSE_KEY_ID: "response-key-1", ICC_MLE_RESPONSE_PRIVATE_KEY_FILE: files.responseKey,
  ICC_INSTRUMENT_IDENTIFIER_ID: INSTRUMENT, ICC_ASSURANCE_FILE: join(files.dir, "assurance.json"), ...over,
});

describe("the rail's switch and its merchants", () => {
  it("is off unless KIT11_ICC_RAIL is exactly on", () => {
    expect(iccRailOn({})).toBe(false);
    expect(iccRailOn({ KIT11_ICC_RAIL: "1" })).toBe(false);
    expect(iccRailOn({ KIT11_ICC_RAIL: "on" })).toBe(true);
  });
  it("every merchant's name fits the API's 40 characters, and its URL is plain https", () => {
    expect(ICC_MERCHANTS.length).toBeGreaterThan(0);
    for (const m of ICC_MERCHANTS) {
      expect(m.name.length).toBeLessThanOrEqual(ICC_MERCHANT_NAME_MAX);
      expect(new URL(m.url).protocol).toBe("https:");
      expect(m.country).toMatch(/^[A-Z]{2}$/);
      expect(iccMerchantById(m.id)).toBe(m);
      expect(iccMerchantOf(m)).toBe(m);
      expect(iccMerchantOf({ ...m, name: `${m.name}!` })).toBeUndefined();
    }
  });
});

describe("readIccEnv", () => {
  it("with nothing set: everything a purchase needs is listed by name, and there is no configuration", () => {
    const r = readIccEnv({});
    expect(r.config).toBeNull();
    expect(r.missing).toEqual([
      "KIT11_ICC_RAIL", "ICC_CALL_BUDGET", "ICC_CALL_LOG", "ICC_MERCHANT_ID", "ICC_JWT_KEY_ID", "ICC_JWT_PRIVATE_KEY_FILE",
      "ICC_MLE_REQUEST_CERT_FILE", "ICC_MLE_RESPONSE_KEY_ID", "ICC_MLE_RESPONSE_PRIVATE_KEY_FILE", "ICC_INSTRUMENT_IDENTIFIER_ID", "ICC_ASSURANCE_FILE",
    ]);
    expect(r.invalid).toEqual([]);
    expect(iccEnvProblem(r)).toMatch(/^not set: KIT11_ICC_RAIL, ICC_CALL_BUDGET/);
    // The preflight needs neither the assurance file nor, for its two reads, encryption.
    expect(readIccEnv({}, "preflight").missing).toEqual(["KIT11_ICC_RAIL", "ICC_CALL_BUDGET", "ICC_CALL_LOG", "ICC_MERCHANT_ID", "ICC_JWT_KEY_ID", "ICC_JWT_PRIVATE_KEY_FILE", "ICC_INSTRUMENT_IDENTIFIER_ID"]);
  });

  it("a complete environment gives the typed configuration with the document's defaults", () => {
    const r = readIccEnv(full());
    expect(r).toMatchObject({ missing: [], invalid: [] });
    expect(r.config).toEqual({
      budget: 3, callLog: join(files.dir, "calls.jsonl"), host: "apitest.cybersource.com", pathPrefix: "/icc/v1", merchantId: "purser_sandbox",
      scheme: "jwt-p12", keyId: "jwt-key-1", jwtPrivateKeyFile: files.jwtKey, digestForm: "raw", dateHeader: "v-c-date",
      mle: { requestCertFile: files.requestCert, responseKeyId: "response-key-1", responsePrivateKeyFile: files.responseKey },
      instrumentIdentifierId: INSTRUMENT, tokenizedCardId: null, assuranceFile: join(files.dir, "assurance.json"),
    });
    expect(iccEnvProblem(r)).toBe("");
  });

  it("the three switches and the other two schemes", () => {
    const r = readIccEnv(full({ ICC_PATH_PREFIX: "/acp/v1", ICC_DIGEST_FORM: "hex", ICC_HTTP_SIGNATURE_DATE: "date", ICC_AUTH_SCHEME: "http-signature", ICC_KEY_ID: "shared-key-1", ICC_SHARED_SECRET: keys.sharedSecret, ICC_HOST: "apitest.cybersource.com", ICC_TOKENIZED_CARD_ID: "tok-card-0001" }));
    expect(r.config).toMatchObject({ pathPrefix: "/acp/v1", digestForm: "hex", dateHeader: "date", scheme: "http-signature", keyId: "shared-key-1", jwtPrivateKeyFile: null, tokenizedCardId: "tok-card-0001" });
    // The shared-secret schemes need their own two names; with the HTTP Signature a purchase does not need encryption.
    const bare = full({ ICC_AUTH_SCHEME: "http-signature", ICC_MLE_REQUEST_CERT_FILE: undefined, ICC_MLE_RESPONSE_KEY_ID: undefined, ICC_MLE_RESPONSE_PRIVATE_KEY_FILE: undefined });
    expect(readIccEnv(bare).missing).toEqual(["ICC_KEY_ID", "ICC_SHARED_SECRET"]);
    expect(readIccEnv({ ...bare, ICC_KEY_ID: "k", ICC_SHARED_SECRET: keys.sharedSecret }).config).toMatchObject({ mle: null });
    expect(readIccEnv(full({ ICC_AUTH_SCHEME: "jwt-shared-secret", ICC_MLE_RESPONSE_KEY_ID: undefined })).missing).toEqual(["ICC_KEY_ID", "ICC_SHARED_SECRET", "ICC_MLE_RESPONSE_KEY_ID"]);
  });

  it("names what is not valid and never repeats a value", () => {
    const marker = ["value", "that", "must", "not", "be", "repeated"].join("-");
    const r = readIccEnv(full({
      ICC_CALL_BUDGET: `3 ${marker}`, ICC_HOST: "api.cybersource.com", ICC_PATH_PREFIX: `/x/${marker}`, ICC_MERCHANT_ID: `bad id ${marker}`, ICC_AUTH_SCHEME: "jwt-shared-secret",
      ICC_KEY_ID: `bad key ${marker}`, ICC_SHARED_SECRET: `not base64 ${marker}`, ICC_DIGEST_FORM: marker, ICC_HTTP_SIGNATURE_DATE: marker,
      ICC_INSTRUMENT_IDENTIFIER_ID: "short", ICC_TOKENIZED_CARD_ID: "x", ICC_MLE_RESPONSE_KEY_ID: `bad ${marker}`,
    }));
    expect(r.config).toBeNull();
    expect(r.invalid.map((x) => x.split(":")[0])).toEqual([
      "ICC_CALL_BUDGET", "ICC_HOST", "ICC_PATH_PREFIX", "ICC_MERCHANT_ID", "ICC_KEY_ID", "ICC_SHARED_SECRET", "ICC_DIGEST_FORM", "ICC_HTTP_SIGNATURE_DATE",
      "ICC_MLE_RESPONSE_KEY_ID", "ICC_INSTRUMENT_IDENTIFIER_ID", "ICC_TOKENIZED_CARD_ID",
    ]);
    expect(JSON.stringify(r) + iccEnvProblem(r)).not.toContain(marker);
  });

  it("a configuration holds no secret: not the shared secret, not a passphrase", () => {
    const r = readIccEnv(full({ ICC_AUTH_SCHEME: "jwt-shared-secret", ICC_KEY_ID: "k", ICC_SHARED_SECRET: keys.sharedSecret, ICC_JWT_PRIVATE_KEY_PASSPHRASE: "pass-one", ICC_MLE_RESPONSE_PRIVATE_KEY_PASSPHRASE: "pass-two" }));
    const text = JSON.stringify(r);
    for (const secret of [keys.sharedSecret, "pass-one", "pass-two"]) expect(text).not.toContain(secret);
  });

  it("section 9 of docs/visa-icc.md lists exactly the names the code knows, in the same order", () => {
    const doc = readFileSync(new URL("../docs/visa-icc.md", import.meta.url), "utf8");
    const section = doc.slice(doc.indexOf("## 9. Environment variables"), doc.indexOf("## 10."));
    const names = [...section.matchAll(/^\| `([A-Z0-9_]+)` \|/gm)].map((m) => m[1]);
    expect(names).toEqual([...ICC_ENV_NAMES]);
    expect(section).not.toMatch(/P12_FILE|P12_PASSWORD|KEY_PASSWORD|TOKEN_REFERENCE/);
  });
});

describe("iccClientFromEnv", () => {
  it("builds a client that the stand-in accepts: keys from the PEM files, encryption on", async () => {
    const standIn = new IccStandIn({ keys, merchantId: "purser_sandbox", jwtKeyId: "jwt-key-1", sharedKeyId: "shared-key-1", responseMleKeyId: "response-key-1" });
    const env = full({ ICC_CALL_LOG: join(mkdtempSync(join(tmpdir(), "icc-config-test-")), "calls.jsonl") });
    const { client, config } = iccClientFromEnv(env, "purchase", { fetchImpl: standIn.fetch });
    expect(config.merchantId).toBe("purser_sandbox");
    expect(await client.getInstrumentIdentifier(INSTRUMENT)).toEqual({ httpStatus: 200, state: "ACTIVE" });
    expect(standIn.seen[0]).toMatchObject({ scheme: "jwt-rs256", answered: 200 });
    expect(standIn.seen[0]!.claims).toMatchObject({ "v-c-response-mle-kid": "response-key-1" });
    // The shared secret from the environment signs too.
    const shared = iccClientFromEnv({ ...env, ICC_AUTH_SCHEME: "jwt-shared-secret", ICC_KEY_ID: "shared-key-1", ICC_SHARED_SECRET: keys.sharedSecret }, "preflight", { fetchImpl: standIn.fetch });
    expect(await shared.client.getInstrumentIdentifier(INSTRUMENT)).toMatchObject({ state: "ACTIVE" });
    expect(standIn.seen[1]!.scheme).toBe("jwt-hs256");
  });

  it("refuses to start with something missing, by name; and with a key file others can read", () => {
    expect(() => iccClientFromEnv(full({ ICC_MERCHANT_ID: undefined }))).toThrow("the ICC rail cannot start (not set: ICC_MERCHANT_ID); nothing was called");
    const open = writeIccKeyFiles(keys);
    chmodSync(open.responseKey, 0o644);
    expect(() => iccClientFromEnv(full({ ICC_MLE_RESPONSE_PRIVATE_KEY_FILE: open.responseKey }))).toThrow(/ICC_MLE_RESPONSE_PRIVATE_KEY_FILE.*readable by others/);
    const locked = writeIccKeyFiles(keys, { passphrase: "a test passphrase" });
    expect(() => iccClientFromEnv(full({ ICC_JWT_PRIVATE_KEY_FILE: locked.jwtKey }))).toThrow(/ICC_JWT_PRIVATE_KEY_FILE/);
    expect(() => iccClientFromEnv(full({ ICC_JWT_PRIVATE_KEY_FILE: locked.jwtKey, ICC_JWT_PRIVATE_KEY_PASSPHRASE: "a test passphrase", ICC_MLE_RESPONSE_PRIVATE_KEY_FILE: locked.responseKey, ICC_MLE_RESPONSE_PRIVATE_KEY_PASSPHRASE: "a test passphrase" }))).not.toThrow();
  });
});

describe("the assurance file", () => {
  const write = (content: string, mode = 0o600) => { const f = join(mkdtempSync(join(tmpdir(), "icc-assurance-test-")), "assurance.json"); writeFileSync(f, content, { mode }); return f; };
  const data = { deviceInformation: { fingerprintSessionId: "fp-session-value", deviceData: { type: "Mobile", brand: "Test" }, ipAddress: "192.168.0.100" }, assuranceData: [{ verificationMethod: "23", verificationResults: "01", verificationTimestamp: "1794477000", authenticatedIdentities: { id: "identity-value" } }] };

  it("gives the device and assurance data unchanged", () => {
    expect(readAssuranceFile(write(JSON.stringify(data)))).toEqual(data);
  });

  it("refuses a file others can read, a missing file, and a file of another shape, naming keys only", () => {
    expect(() => readAssuranceFile(write(JSON.stringify(data), 0o640))).toThrow(/ICC_ASSURANCE_FILE: the file is readable by others/);
    expect(() => readAssuranceFile(join(tmpdir(), "icc-none", "assurance.json"))).toThrow(/could not be opened \(ENOENT\)/);
    expect(() => readAssuranceFile(write("fp-session-value"))).toThrow(/not JSON/);
    expect(() => readAssuranceFile(write(""))).toThrow(/empty/);
    for (const bad of [{ deviceInformation: data.deviceInformation }, { ...data, assuranceData: [] }, { ...data, assuranceData: ["identity-value"] }, { ...data, deviceInformation: "fp-session-value" }, ["identity-value"]]) {
      let e: unknown;
      try { readAssuranceFile(write(JSON.stringify(bad))); } catch (x) { e = x; }
      expect(e).toBeInstanceOf(IccAssuranceFileError);
      expect((e as Error).message).not.toMatch(/fp-session-value|identity-value|192\.168/);
    }
    expect(() => readAssuranceFile(write(JSON.stringify({ deviceInformation: 1, other: 2 })))).toThrow(/it has the keys: deviceInformation, other/);
  });
});
